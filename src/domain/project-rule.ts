import { z } from 'zod';
import { ProjectSettingsSchema } from './project-settings';

// How a ProjectRule's pattern is compared against the console URL's ?project= param.
export const MatchTypeSchema = z.enum(['prefix', 'suffix', 'exact', 'regex']);
export type MatchType = z.infer<typeof MatchTypeSchema>;

export const MATCH_TYPES: readonly MatchType[] = MatchTypeSchema.options;

// A rule is only ever dropped for having a non-string `pattern` (see settings.ts, which parses
// projectRules per-element and drops whichever fail this schema) — every other field recovers
// via its own default instead of invalidating the whole rule.
export const ProjectRuleSchema = z.object({
  id: z.string().catch(() => crypto.randomUUID()),
  matchType: MatchTypeSchema.catch('regex'),
  // For 'prefix' | 'suffix' | 'exact': a literal string compared against the project id.
  // For 'regex': a regular expression source that must match the ENTIRE project id.
  pattern: z.string(),
  settings: ProjectSettingsSchema,
});
export type ProjectRule = z.infer<typeof ProjectRuleSchema>;
