import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, runMigrations } from './migrations';
import type { ProjectRule } from './project-rule';
import { ProjectRuleSchema } from './project-rule';
import type { ProjectSettings } from './project-settings';
import { compareVersions, VersionComparisonResult } from './version';

// Generic "is this a plain record" guard, used by loadSettings below and the storage adapter
// to sanity-check the raw value read from storage before it's handed to the schemas below (and
// to runMigrations, which still operates on untyped data by design).
export const UnknownRecordSchema = z.record(z.string(), z.unknown());

export const TintSettingsSchema = z.object({
  schemaVersion: z.string(),
  // Ordered: earlier rules take priority; first matching rule wins.
  // When no rule matches (or the URL has no project param), nothing is applied.
  projectRules: z.array(ProjectRuleSchema),
});
export type TintSettings = z.infer<typeof TintSettingsSchema>;

// The oldest schemaVersion the migration chain can read. Anything below (or missing, or
// invalid) predates every released shape and is replaced by fresh defaults.
export const SCHEMA_MIN_VERSION = '0.1.0';

export const DEFAULT_SETTINGS: TintSettings = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  projectRules: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return UnknownRecordSchema.safeParse(value).success;
}

// The schemaVersion to stamp on anything we write: the running release version, floored at
// CURRENT_SCHEMA_VERSION. The floor is the invariant that matters — data written in the
// current shape must never carry a label older than that shape's schema version, or the
// next load would re-run migration steps against already-migrated data and silently reset
// the user's values (reachable if a new migration step ships without the manifest version
// catching up).
export function effectiveSchemaVersion(currentVersion: string): string {
  return compareVersions(currentVersion, CURRENT_SCHEMA_VERSION) === VersionComparisonResult.Older
    ? CURRENT_SCHEMA_VERSION
    : currentVersion;
}

function freshDefaults(currentVersion: string): TintSettings {
  return {
    schemaVersion: effectiveSchemaVersion(currentVersion),
    projectRules: [],
  };
}

// Reads whatever is in storage and returns it in the CURRENT schema shape:
// - no/invalid schemaVersion, or below SCHEMA_MIN_VERSION -> fresh defaults (nothing to
//   migrate from),
// - otherwise the migration chain folds the data forward version by version, then each rule
//   is parsed by ProjectRuleSchema (dropping only the ones whose pattern isn't a string;
//   every other field recovers via its own default) and merged with defaults. While the
//   chain is empty (pre-release), old-shaped fields are simply not recognized by the schemas
//   below and defaults fill in — destructive by design; rules' id/matchType/pattern still
//   survive.
// Pure: never writes storage. The background script persists the migrated form once via
// migrateStoredSettings (adapter/out/browser-settings-store.ts).
export function loadSettings(stored: unknown, currentVersion: string): TintSettings {
  if (!isRecord(stored)) {
    return freshDefaults(currentVersion);
  }
  const schemaVersion = stored.schemaVersion;
  if (
    typeof schemaVersion !== 'string' ||
    compareVersions(schemaVersion, SCHEMA_MIN_VERSION) === VersionComparisonResult.Older
  ) {
    return freshDefaults(currentVersion);
  }

  const { data, version } = runMigrations(stored, schemaVersion);

  const projectRules: ProjectRule[] = [];
  if (Array.isArray(data.projectRules)) {
    for (const value of data.projectRules) {
      const parsed = ProjectRuleSchema.safeParse(value);
      if (parsed.success) projectRules.push(parsed.data);
    }
  }

  return {
    schemaVersion: version,
    projectRules,
  };
}

function ruleMatches(rule: ProjectRule, projectId: string): boolean {
  switch (rule.matchType) {
    case 'prefix':
      return projectId.startsWith(rule.pattern);
    case 'suffix':
      return projectId.endsWith(rule.pattern);
    case 'exact':
      return projectId === rule.pattern;
    case 'regex':
      try {
        // Full match: the pattern must cover the entire project id. The non-capturing
        // group keeps top-level alternation (a|b) from escaping the anchors.
        return new RegExp(`^(?:${rule.pattern})$`).test(projectId);
      } catch {
        // invalid regex: the rule never matches
        return false;
      }
  }
}

// Rules are ordered by priority (top of the list first). The first rule that matches the
// project id (per its matchType) wins; 'regex' rules with invalid patterns are skipped.
// Returns null when the URL has no project id or no rule matches — nothing is applied.
export function resolveProjectSettings(settings: TintSettings, projectId: string | null): ProjectSettings | null {
  if (projectId) {
    for (const rule of settings.projectRules) {
      if (ruleMatches(rule, projectId)) return rule.settings;
    }
  }
  return null;
}
