import { ValueObject } from './base/value-object';
import { ProjectRule, ProjectRuleId } from './project-rule';
import type { ProjectSettings } from './project-settings';

export class TintSettings extends ValueObject<TintSettings> {
  constructor(
    // Ordered: earlier rules take priority; first matching rule wins.
    // When no rule matches (or the URL has no project param), nothing is applied.
    readonly projectRules: readonly ProjectRule[],
  ) {
    super();
  }

  // Rules are compared as entities (by id, in order); a rule's current pattern/settings do not
  // take part.
  equals(other: TintSettings): boolean {
    return (
      this.projectRules.length === other.projectRules.length &&
      this.projectRules.every((rule, i) => {
        const otherRule = other.projectRules[i];
        return otherRule !== undefined && rule.equals(otherRule);
      })
    );
  }

  // Rules are ordered by priority (top of the list first). The first rule that matches the
  // project id (per its matchType) wins; 'regex' rules with invalid patterns are skipped.
  // Returns undefined when the URL has no project id or no rule matches — nothing is applied.
  resolveProjectSettings(projectId: string | undefined): ProjectSettings | undefined {
    if (projectId) {
      for (const rule of this.projectRules) {
        if (rule.matches(projectId)) return rule.settings;
      }
    }
    return undefined;
  }

  addRule(rule: ProjectRule): TintSettings {
    return new TintSettings([...this.projectRules, rule]);
  }

  removeRule(id: ProjectRuleId): TintSettings {
    return new TintSettings(this.projectRules.filter((rule) => !rule.id.equals(id)));
  }

  // Inserts the copy right after its original. Unknown id: nothing to duplicate, so no change.
  duplicateRule(id: ProjectRuleId): TintSettings {
    const index = this.projectRules.findIndex((rule) => rule.id.equals(id));
    const original = this.projectRules[index];
    if (!original) return this;
    const next = [...this.projectRules];
    next.splice(index + 1, 0, original.duplicate());
    return new TintSettings(next);
  }

  // Drag-and-drop reorder: the rule at `fromIndex` is lifted out and re-inserted at `toIndex`
  // of the remaining list (so dropping on a row before it inserts above, after inserts below).
  moveRule(fromIndex: number, toIndex: number): TintSettings {
    const next = [...this.projectRules];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return this;
    next.splice(toIndex, 0, moved);
    return new TintSettings(next);
  }

  updateRule(id: ProjectRuleId, update: (rule: ProjectRule) => ProjectRule): TintSettings {
    return new TintSettings(this.projectRules.map((rule) => (rule.id.equals(id) ? update(rule) : rule)));
  }

  // Merges `incoming` (e.g. the rules picked from an imported file) into the list, in order: a
  // rule that duplicates an existing one (ProjectRule.isDuplicateOf) replaces that rule's settings
  // in place, keeping its id and position; any other rule is appended under a fresh id, so
  // importing the same file twice never yields two rules with one id. Duplicates inside
  // `incoming` itself fold left to right, so the later one wins.
  mergeRules(incoming: readonly ProjectRule[]): TintSettings {
    const rules = [...this.projectRules];
    for (const rule of incoming) {
      const index = rules.findIndex((existing) => existing.isDuplicateOf(rule));
      const duplicate = rules[index];
      if (duplicate) {
        rules[index] = duplicate.changeSettings(rule.settings);
      } else {
        rules.push(ProjectRule.recreate(ProjectRuleId.create(), rule.matchType, rule.pattern, rule.settings));
      }
    }
    return new TintSettings(rules);
  }
}
