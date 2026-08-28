import { Entity } from './base/entity';
import { ValueObject } from './base/value-object';
import { ProjectSettings } from './project-settings';

// How a ProjectRule's pattern is compared against the console URL's ?project= param.
export const MATCH_TYPES = ['prefix', 'suffix', 'exact', 'regex'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

// Identity of a ProjectRule. The raw string is private so this type stays nominally distinct
// from other ids; only the boundaries (settings repository, React keys) read it via toString().
export class ProjectRuleId extends ValueObject<ProjectRuleId> {
  private constructor(private readonly value: string) {
    super();
  }

  // A brand-new identity.
  static create(): ProjectRuleId {
    return new ProjectRuleId(crypto.randomUUID());
  }

  // Rehydrates an existing identity (from storage or the UI). Ids carry no format invariant
  // beyond being a string.
  static recreate(value: string): ProjectRuleId {
    return new ProjectRuleId(value);
  }

  equals(other: ProjectRuleId): boolean {
    return this.value === other.value;
  }

  override toString(): string {
    return this.value;
  }
}

export class ProjectRule extends Entity<ProjectRule> {
  private constructor(
    readonly id: ProjectRuleId,
    readonly matchType: MatchType,
    // For 'prefix' | 'suffix' | 'exact': a literal string compared against the project id.
    // For 'regex': a regular expression source that must match the ENTIRE project id.
    readonly pattern: string,
    readonly settings: ProjectSettings,
  ) {
    super();
  }

  // Entity identity: same id means the same rule, whatever its current attributes.
  equals(other: ProjectRule): boolean {
    return this.id.equals(other.id);
  }

  // A brand-new rule under a fresh identity, starting from the default settings.
  static create(matchType: MatchType, pattern: string): ProjectRule {
    return new ProjectRule(ProjectRuleId.create(), matchType, pattern, ProjectSettings.DEFAULT);
  }

  // Rebuilds a persisted rule under its existing identity (settings repository).
  static recreate(id: ProjectRuleId, matchType: MatchType, pattern: string, settings: ProjectSettings): ProjectRule {
    return new ProjectRule(id, matchType, pattern, settings);
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
    return new ProjectRule(ProjectRuleId.create(), this.matchType, this.pattern, this.settings);
  }
}
