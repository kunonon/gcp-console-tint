import { ValueObject } from './base/value-object';
import type { ProjectRule, ProjectRuleId } from './project-rule';
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

  withRuleAdded(rule: ProjectRule): TintSettings {
    return new TintSettings([...this.projectRules, rule]);
  }

  withRuleRemoved(id: ProjectRuleId): TintSettings {
    return new TintSettings(this.projectRules.filter((rule) => !rule.id.equals(id)));
  }

  // Inserts the copy right after its original. Unknown id: nothing to duplicate, so no change.
  withRuleDuplicated(id: ProjectRuleId): TintSettings {
    const index = this.projectRules.findIndex((rule) => rule.id.equals(id));
    const original = this.projectRules[index];
    if (!original) return this;
    const next = [...this.projectRules];
    next.splice(index + 1, 0, original.duplicate());
    return new TintSettings(next);
  }

  // Drag-and-drop reorder: the rule at `fromIndex` is lifted out and re-inserted at `toIndex`
  // of the remaining list (so dropping on a row before it inserts above, after inserts below).
  withRuleMoved(fromIndex: number, toIndex: number): TintSettings {
    const next = [...this.projectRules];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return this;
    next.splice(toIndex, 0, moved);
    return new TintSettings(next);
  }

  withRuleUpdated(id: ProjectRuleId, update: (rule: ProjectRule) => ProjectRule): TintSettings {
    return new TintSettings(this.projectRules.map((rule) => (rule.id.equals(id) ? update(rule) : rule)));
  }
}
