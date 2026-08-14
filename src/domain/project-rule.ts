import { z } from 'zod';
import { ProjectSettings, ProjectSettingsSchema } from './project-settings';

// How a ProjectRule's pattern is compared against the console URL's ?project= param.
const MatchTypeSchema = z.enum(['prefix', 'suffix', 'exact', 'regex']);
export type MatchType = z.infer<typeof MatchTypeSchema>;

export const MATCH_TYPES: readonly MatchType[] = MatchTypeSchema.options;

export class ProjectRule {
  constructor(
    readonly id: string,
    readonly matchType: MatchType,
    // For 'prefix' | 'suffix' | 'exact': a literal string compared against the project id.
    // For 'regex': a regular expression source that must match the ENTIRE project id.
    readonly pattern: string,
    readonly settings: ProjectSettings,
  ) {}

  static create(matchType: MatchType, pattern: string): ProjectRule {
    return new ProjectRule(crypto.randomUUID(), matchType, pattern, ProjectSettings.DEFAULT);
  }

  matches(projectId: string): boolean {
    switch (this.matchType) {
      case 'prefix':
        return projectId.startsWith(this.pattern);
      case 'suffix':
        return projectId.endsWith(this.pattern);
      case 'exact':
        return projectId === this.pattern;
      case 'regex':
        try {
          // Full match: the pattern must cover the entire project id. The non-capturing
          // group keeps top-level alternation (a|b) from escaping the anchors.
          return new RegExp(`^(?:${this.pattern})$`).test(projectId);
        } catch {
          // invalid regex: the rule never matches
          return false;
        }
    }
  }

  withPattern(pattern: string): ProjectRule {
    return new ProjectRule(this.id, this.matchType, pattern, this.settings);
  }

  withMatchType(matchType: MatchType): ProjectRule {
    return new ProjectRule(this.id, matchType, this.pattern, this.settings);
  }

  withSettings(settings: ProjectSettings): ProjectRule {
    return new ProjectRule(this.id, this.matchType, this.pattern, settings);
  }

  // A copy under a new id. Sharing the settings instance is safe: ProjectSettings is
  // immutable, so editing either rule replaces its own reference instead of mutating.
  duplicated(): ProjectRule {
    return new ProjectRule(crypto.randomUUID(), this.matchType, this.pattern, this.settings);
  }
}

// A rule is only ever dropped for having a non-string `pattern` (see TintSettings.fromStored,
// which parses projectRules per-element and drops whichever fail this schema) — every other
// field recovers via its own default instead of invalidating the whole rule.
/** @internal — domain modules only */
export const ProjectRuleSchema = z
  .object({
    id: z.string().catch(() => crypto.randomUUID()),
    matchType: MatchTypeSchema.catch('regex'),
    pattern: z.string(),
    settings: ProjectSettingsSchema,
  })
  .transform((value) => new ProjectRule(value.id, value.matchType, value.pattern, value.settings));
