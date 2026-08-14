import type { ProjectRule } from './project-rule';
import type { ProjectSettings } from './project-settings';

export class TintSettings {
  constructor(
    // Ordered: earlier rules take priority; first matching rule wins.
    // When no rule matches (or the URL has no project param), nothing is applied.
    readonly projectRules: readonly ProjectRule[],
  ) {}

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

  withRuleRemoved(id: string): TintSettings {
    return new TintSettings(this.projectRules.filter((rule) => rule.id !== id));
  }

  // Inserts the copy right after its original. Unknown id: nothing to duplicate, so no change.
  withRuleDuplicated(id: string): TintSettings {
    const index = this.projectRules.findIndex((rule) => rule.id === id);
    const original = this.projectRules[index];
    if (!original) return this;
    const next = [...this.projectRules];
    next.splice(index + 1, 0, original.duplicated());
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

  withRuleUpdated(id: string, update: (rule: ProjectRule) => ProjectRule): TintSettings {
    return new TintSettings(this.projectRules.map((rule) => (rule.id === id ? update(rule) : rule)));
  }
}
