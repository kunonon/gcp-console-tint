import { SettingsImportError, type SettingsImportIssue } from '../../port/settings-store';
import { compareVersions, VersionComparisonResult } from './version';

// One schema upgrade step. `to` is the extension release version that first ships the target
// shape; do not use an independent schema counter. `migrate` receives data in the shape that
// immediately precedes `to` and returns data in the `to` shape. The full chain must yield the
// complete current shape: storage and the import both read the result with the same strict
// checks (settings-file's readSettingsValue), so a chain that leaves a field missing makes older
// data unreadable.
//
// A step never passes through what it cannot interpret. Along the path it walks, anything that is
// not the shape its input version guarantees (a missing key, a wrong container type, a slot it
// converts holding the wrong type) is an issue at that path. A step collects every issue in one
// pass and then throws one SettingsImportError (invalid-fields), returning nothing partial; the
// import reports it as is and storage as a StoredSettingsError. Values off its walk (a rule's
// pattern, say) are left to the checks after the chain. A step never mutates its input.
export interface SchemaMigration {
  to: string;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

// Ascending by `to`. A shape change must ship with a step whose `to` is the first extension
// release that introduces it (and is therefore above every prior release); update
// CURRENT_SCHEMA_VERSION to that same release version. Each step is a frozen snapshot of its
// release: write literal values, never reference live domain defaults that may change later.
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  // 0.2.0 constrains topBar.height to a whole number of pixels from 1 to 40: its side panel
  // started refusing anything else at write time. 0.1.x saved any finite number and clamped it
  // only when painting (round, then 0.1.x's default 4 when the rounded value is outside 1..40), so
  // this step stores what 0.1.x painted. An imported 0.1.x stored shape gets the same, since a
  // release wrote such a height; one that is not a finite number no release could write.
  {
    to: '0.2.0',
    migrate: (data) =>
      strictly((reject) =>
        mapRuleSettings(data, reject, (settings, at) => {
          const topBar = recordAt(settings, 'topBar', at, reject);
          if (!topBar) return settings;
          const height = topBar.height;
          if (typeof height !== 'number' || !Number.isFinite(height)) {
            reject(`${at}.topBar.height`, 'expected a finite number');
            return settings;
          }
          const rounded = Math.round(height);
          return { ...settings, topBar: { ...topBar, height: rounded >= 1 && rounded <= 40 ? rounded : 4 } };
        }),
      ),
  },
  // 0.3.0 adds the side panel theme; data from earlier releases starts on 'auto'.
  { to: '0.3.0', migrate: (data) => ({ ...data, theme: 'auto' }) },
  // 0.5.0 makes palette entries' and the bars' custom fills tagged objects, so they can also be
  // gradients: { type: 'solid', color } or { type: 'gradient', stops: [{ color, position }, ...] }.
  // The '#rrggbb' strings of 0.4.x and earlier are wrapped as { type: 'solid', color }; the
  // platform bar text's custom stays a string. A fill slot holding anything but a string (a tagged
  // object under a pre-0.5.0 stamp included) is an issue; whether a string is a usable color is
  // judged after the chain.
  {
    to: '0.5.0',
    migrate: (data) =>
      strictly((reject) =>
        mapRuleSettings(data, reject, (settings, at) => {
          const next = { ...settings };
          const palette = recordAt(settings, 'palette', at, reject);
          if (palette) {
            const entriesAt = `${at}.palette.entries`;
            const { entries } = palette;
            if (isArray(entries)) {
              next.palette = {
                ...palette,
                entries: entries.map((entry, index) => {
                  if (isRecord(entry)) return solidAt(entry, 'color', `${entriesAt}[${index}]`, reject);
                  reject(`${entriesAt}[${index}]`, 'expected an object');
                  return entry;
                }),
              };
            } else {
              reject(entriesAt, 'expected an array');
            }
          }
          for (const key of ['topBar', 'platformBar']) {
            const bar = recordAt(settings, key, at, reject);
            const color = bar && recordAt(bar, 'color', `${at}.${key}`, reject);
            if (bar && color) next[key] = { ...bar, color: solidAt(color, 'custom', `${at}.${key}.color`, reject) };
          }
          return next;
        }),
      ),
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Array.isArray narrows to any[]; this keeps the elements unknown so each one is checked before use.
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

// The most issues one check keeps, in a step and in each of the import's validation stages
// (settings-file.ts), so data that is wrong everywhere is neither walked nor reported in full.
export const MAX_ISSUES = 100;

type Reject = (path: string, message: string) => void;

// Thrown by a step's collector instead of keeping the issue past MAX_ISSUES, and caught only by
// strictly(), so the walk stops on the spot.
class WalkStopped {}

// Runs a step's walk, collecting the issues it reports, and returns its result only when there
// were none. Otherwise throws them all at once; the 101st issue stops the walk and sets
// validationStopped, as the import's own stages do.
function strictly(walk: (reject: Reject) => Record<string, unknown>): Record<string, unknown> {
  const issues: SettingsImportIssue[] = [];
  const reject: Reject = (path, message) => {
    if (issues.length === MAX_ISSUES) throw new WalkStopped();
    issues.push({ path, message });
  };
  let result: Record<string, unknown>;
  try {
    result = walk(reject);
  } catch (error) {
    if (!(error instanceof WalkStopped)) throw error;
    throw new SettingsImportError({ reason: 'invalid-fields', issues, validationStopped: true });
  }
  if (issues.length > 0) throw new SettingsImportError({ reason: 'invalid-fields', issues });
  return result;
}

// The record at `record[key]`, or undefined after reporting `${at}.${key}`. Paths read as in the
// file, like the import's (`projectRules[1].settings.topBar.color.custom`).
function recordAt(record: Record<string, unknown>, key: string, at: string, reject: Reject) {
  const value = record[key];
  if (isRecord(value)) return value;
  reject(`${at}.${key}`, 'expected an object');
  return undefined;
}

// The walk every step shares: projectRules must be an array, each rule an object and its settings
// an object; `map` converts each rule's settings, given their path. Every record on the path is
// copied, so the input is never mutated.
function mapRuleSettings(
  data: Record<string, unknown>,
  reject: Reject,
  map: (settings: Record<string, unknown>, at: string) => Record<string, unknown>,
): Record<string, unknown> {
  const { projectRules } = data;
  if (!isArray(projectRules)) {
    reject('projectRules', 'expected an array');
    return data;
  }
  return {
    ...data,
    projectRules: projectRules.map((rule, index) => {
      const at = `projectRules[${index}]`;
      if (!isRecord(rule)) {
        reject(at, 'expected an object');
        return rule;
      }
      const settings = recordAt(rule, 'settings', at, reject);
      return settings ? { ...rule, settings: map(settings, `${at}.settings`) } : rule;
    }),
  };
}

// The 0.5.0 step's wrap: the '#rrggbb' string at `record[key]` becomes { type: 'solid', color };
// anything else is reported at `${at}.${key}`.
function solidAt(record: Record<string, unknown>, key: string, at: string, reject: Reject) {
  const color = record[key];
  if (typeof color === 'string') return { ...record, [key]: { type: 'solid', color } };
  reject(`${at}.${key}`, 'expected a color like #rrggbb');
  return record;
}

// The oldest schemaVersion the migration chain can read. Anything below predates every released
// shape: storage and the import both refuse it as unsupported-version.
export const SCHEMA_MIN_VERSION = '0.1.0';

// The version of the current schema shape. Must equal the last SCHEMA_MIGRATIONS entry's
// `to` (asserted in tests). Bump it only in the release that introduces a new shape.
export const CURRENT_SCHEMA_VERSION = '0.5.0';

// Applies every migration step newer than `fromVersion`, in order, so data recorded under
// any past release folds forward step by step into the current shape. `steps` is
// injectable for tests; production callers use the real registry. A step's error propagates
// as the same object.
export function runMigrations(
  data: Record<string, unknown>,
  fromVersion: string,
  steps: readonly SchemaMigration[] = SCHEMA_MIGRATIONS,
): { data: Record<string, unknown>; version: string } {
  let current = data;
  let version = fromVersion;
  for (const step of steps) {
    if (compareVersions(version, step.to) === VersionComparisonResult.Older) {
      current = step.migrate(current);
      version = step.to;
    }
  }
  return { data: current, version };
}
