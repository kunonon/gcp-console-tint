import type { ColorSelection } from './color-selection';
import { CURRENT_SCHEMA_VERSION, runMigrations } from './migrations';
import { type ProjectRule, ProjectRuleSchema } from './project-rule';
import type { ProjectSettings } from './project-settings';
import { compareVersions, VersionComparisonResult } from './version';

// The oldest schemaVersion the migration chain can read. Anything below (or missing, or
// invalid) predates every released shape and is replaced by fresh defaults.
const SCHEMA_MIN_VERSION = '0.1.0';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class TintSettings {
  private constructor(
    readonly schemaVersion: string,
    // Ordered: earlier rules take priority; first matching rule wins.
    // When no rule matches (or the URL has no project param), nothing is applied.
    readonly projectRules: readonly ProjectRule[],
  ) {}

  // Reads whatever is in storage and returns it in the CURRENT schema shape:
  // - no/invalid schemaVersion, or below SCHEMA_MIN_VERSION -> fresh defaults (nothing to
  //   migrate from),
  // - otherwise the migration chain folds the data forward version by version, then each rule
  //   is parsed by ProjectRuleSchema (dropping only the ones whose pattern isn't a string;
  //   every other field recovers via its own default) and merged with defaults. While the
  //   chain is empty (pre-release), old-shaped fields are simply not recognized by the schemas
  //   and defaults fill in — destructive by design; rules' id/matchType/pattern still survive.
  // Pure: never writes storage. The background script persists the migrated form once via
  // migrateStoredSettings (adapter/out/browser-settings-store.ts).
  static fromStored(stored: unknown, currentVersion: string): TintSettings {
    if (!isRecord(stored)) {
      return TintSettings.freshDefaults(currentVersion);
    }
    const schemaVersion = stored.schemaVersion;
    if (
      typeof schemaVersion !== 'string' ||
      compareVersions(schemaVersion, SCHEMA_MIN_VERSION) === VersionComparisonResult.Older
    ) {
      return TintSettings.freshDefaults(currentVersion);
    }

    const { data, version } = runMigrations(stored, schemaVersion);

    const projectRules: ProjectRule[] = [];
    if (Array.isArray(data.projectRules)) {
      for (const value of data.projectRules) {
        const parsed = ProjectRuleSchema.safeParse(value);
        if (parsed.success) projectRules.push(parsed.data);
      }
    }

    return new TintSettings(version, projectRules);
  }

  // The schemaVersion to stamp on anything we write: the running release version, floored at
  // CURRENT_SCHEMA_VERSION. The floor is the invariant that matters — data written in the
  // current shape must never carry a label older than that shape's schema version, or the
  // next load would re-run migration steps against already-migrated data and silently reset
  // the user's values (reachable if a new migration step ships without the manifest version
  // catching up).
  static effectiveSchemaVersion(currentVersion: string): string {
    return compareVersions(currentVersion, CURRENT_SCHEMA_VERSION) === VersionComparisonResult.Older
      ? CURRENT_SCHEMA_VERSION
      : currentVersion;
  }

  private static freshDefaults(currentVersion: string): TintSettings {
    return new TintSettings(TintSettings.effectiveSchemaVersion(currentVersion), []);
  }

  withEffectiveVersion(currentVersion: string): TintSettings {
    return new TintSettings(TintSettings.effectiveSchemaVersion(currentVersion), this.projectRules);
  }

  // The stored JSON shape. Colors leave the model as '#rrggbb' strings, everything else is
  // written verbatim — this is the persisted contract, so keep it in sync with the schemas
  // that read it back (adapter/out/tests/browser-settings-store.test.ts asserts it).
  toStored(): Record<string, unknown> {
    return {
      schemaVersion: this.schemaVersion,
      projectRules: this.projectRules.map((rule) => ({
        id: rule.id,
        matchType: rule.matchType,
        pattern: rule.pattern,
        settings: {
          palette: {
            enabled: rule.settings.palette.enabled,
            entries: rule.settings.palette.entries.map((entry) => ({
              id: entry.id,
              name: entry.name,
              color: entry.color.toHex(),
            })),
          },
          topBar: {
            enabled: rule.settings.topBar.enabled,
            color: storedSelection(rule.settings.topBar.color),
            height: rule.settings.topBar.height,
            stripes: rule.settings.topBar.stripes,
          },
          platformBar: {
            enabled: rule.settings.platformBar.enabled,
            color: storedSelection(rule.settings.platformBar.color),
            stripes: rule.settings.platformBar.stripes,
          },
          platformBarText: {
            enabled: rule.settings.platformBarText.enabled,
            color: storedSelection(rule.settings.platformBarText.color),
            auto: rule.settings.platformBarText.auto,
          },
        },
      })),
    };
  }

  // Rules are ordered by priority (top of the list first). The first rule that matches the
  // project id (per its matchType) wins; 'regex' rules with invalid patterns are skipped.
  // Returns null when the URL has no project id or no rule matches — nothing is applied.
  resolveProjectSettings(projectId: string | null): ProjectSettings | null {
    if (projectId) {
      for (const rule of this.projectRules) {
        if (rule.matches(projectId)) return rule.settings;
      }
    }
    return null;
  }

  withRuleAdded(rule: ProjectRule): TintSettings {
    return new TintSettings(this.schemaVersion, [...this.projectRules, rule]);
  }

  withRuleRemoved(id: string): TintSettings {
    return new TintSettings(
      this.schemaVersion,
      this.projectRules.filter((rule) => rule.id !== id),
    );
  }

  // Inserts the copy right after its original. Unknown id: nothing to duplicate, so no change.
  withRuleDuplicated(id: string): TintSettings {
    const index = this.projectRules.findIndex((rule) => rule.id === id);
    const original = this.projectRules[index];
    if (!original) return this;
    const next = [...this.projectRules];
    next.splice(index + 1, 0, original.duplicated());
    return new TintSettings(this.schemaVersion, next);
  }

  // Drag-and-drop reorder: the rule at `fromIndex` is lifted out and re-inserted at `toIndex`
  // of the remaining list (so dropping on a row before it inserts above, after inserts below).
  withRuleMoved(fromIndex: number, toIndex: number): TintSettings {
    const next = [...this.projectRules];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return this;
    next.splice(toIndex, 0, moved);
    return new TintSettings(this.schemaVersion, next);
  }

  withRuleUpdated(id: string, update: (rule: ProjectRule) => ProjectRule): TintSettings {
    return new TintSettings(
      this.schemaVersion,
      this.projectRules.map((rule) => (rule.id === id ? update(rule) : rule)),
    );
  }
}

function storedSelection(selection: ColorSelection) {
  return { paletteId: selection.paletteId, custom: selection.custom.toHex() };
}
