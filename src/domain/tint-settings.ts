import { ValueObject } from './base/value-object';
import { ProjectRule, ProjectRuleId } from './project-rule';
import type { ProjectSettings } from './project-settings';

// The side panel's color scheme.
export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

// Guard for untrusted input (an imported settings file): whether a string names a theme.
export function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

export class TintSettings extends ValueObject<TintSettings> {
  // 'auto' follows the system color scheme until the user picks one.
  static readonly DEFAULT_THEME: Theme = 'auto';

  constructor(
    // Ordered: earlier rules take priority; first matching rule wins.
    // When no rule matches (or the URL has no project param), nothing is applied.
    readonly projectRules: readonly ProjectRule[],
    readonly theme: Theme,
  ) {
    super();
  }

  // The theme must match; rules are compared as entities (by id, in order), so a rule's current
  // pattern/settings do not take part.
  equals(other: TintSettings): boolean {
    return (
      this.theme === other.theme &&
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

  changeTheme(theme: Theme): TintSettings {
    return new TintSettings(this.projectRules, theme);
  }

  addRule(rule: ProjectRule): TintSettings {
    return new TintSettings([...this.projectRules, rule], this.theme);
  }

  removeRule(id: ProjectRuleId): TintSettings {
    return new TintSettings(
      this.projectRules.filter((rule) => !rule.id.equals(id)),
      this.theme,
    );
  }

  // Inserts the copy right after its original. Unknown id: nothing to duplicate, so no change.
  duplicateRule(id: ProjectRuleId): TintSettings {
    const index = this.projectRules.findIndex((rule) => rule.id.equals(id));
    const original = this.projectRules[index];
    if (!original) return this;
    const next = [...this.projectRules];
    next.splice(index + 1, 0, original.duplicate());
    return new TintSettings(next, this.theme);
  }

  // Drag-and-drop reorder: the rule at `fromIndex` is lifted out and re-inserted at `toIndex`
  // of the remaining list (so dropping on a row before it inserts above, after inserts below).
  moveRule(fromIndex: number, toIndex: number): TintSettings {
    const next = [...this.projectRules];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return this;
    next.splice(toIndex, 0, moved);
    return new TintSettings(next, this.theme);
  }

  updateRule(id: ProjectRuleId, update: (rule: ProjectRule) => ProjectRule): TintSettings {
    return new TintSettings(
      this.projectRules.map((rule) => (rule.id.equals(id) ? update(rule) : rule)),
      this.theme,
    );
  }

  // Pairs each incoming rule with the first unused matching original rule, if there is one;
  // appended rules are never replacement targets.
  private replacements(
    incoming: readonly ProjectRule[],
  ): readonly { rule: ProjectRule; target?: { index: number; original: ProjectRule } }[] {
    const used = new Set<number>();
    return incoming.map((rule) => {
      const index = this.projectRules.findIndex((existing, i) => !used.has(i) && existing.isDuplicateOf(rule));
      // No match leaves the index at -1, where there is no rule.
      const original = this.projectRules[index];
      if (!original) return { rule };
      used.add(index);
      return { rule, target: { index, original } };
    });
  }

  // The index of the original rule each incoming rule replaces, or undefined where it appends.
  replacementTargets(incoming: readonly ProjectRule[]): readonly (number | undefined)[] {
    return this.replacements(incoming).map(({ target }) => target?.index);
  }

  // Merges incoming rules in order: each can replace one original rule's settings in place,
  // keeping its id and position; unmatched rules append under fresh ids.
  mergeRules(incoming: readonly ProjectRule[]): TintSettings {
    const rules = [...this.projectRules];
    for (const { rule, target } of this.replacements(incoming)) {
      if (target) {
        rules[target.index] = target.original.changeSettings(rule.settings);
      } else {
        rules.push(ProjectRule.recreate(ProjectRuleId.create(), rule.matchType, rule.pattern, rule.settings));
      }
    }
    return new TintSettings(rules, this.theme);
  }
}
