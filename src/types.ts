import { z } from 'zod';

// Primitive defaults the schemas below fall back to. Exported because settings.ts re-exports
// them (its public API predates this file owning the values).
export const DEFAULT_COLOR = '#ff6d00';
export const DEFAULT_TEXT_COLOR = '#ffffff';
export const DEFAULT_TOP_BAR_HEIGHT = 4;

// Generic "is this a plain record" guard, used by settings.ts to sanity-check the raw value
// read from storage before it's handed to the schemas below (and to runMigrations, which
// still operates on untyped data by design).
export const UnknownRecordSchema = z.record(z.string(), z.unknown());

export const PaletteEntrySchema = z.object({
  id: z.string().catch(() => crypto.randomUUID()),
  name: z.string().catch(''),
  color: z.string().catch(DEFAULT_COLOR),
});
export type PaletteEntry = z.infer<typeof PaletteEntrySchema>;

// A color choice shared by every tinted surface: the palette entry wins while paletteId is
// set (and the project's palette is enabled), otherwise `custom` applies. `custom` is kept
// even while a palette entry is selected, so switching back to custom restores the last
// hand-picked value.
//
// Parameterized by defaults because each surface falls back to a different selection: topBar
// and platformBar point at the default palette entry, while platformBarText has no palette
// reference and falls back to a plain custom color instead.
function colorSelectionSchema(defaults: { paletteId: string | null; custom: string }) {
  return z
    .object({
      paletteId: z.string().nullable().catch(defaults.paletteId),
      custom: z.string().catch(defaults.custom),
    })
    .catch(() => ({ ...defaults }));
}
export const ColorSelectionSchema = colorSelectionSchema({ paletteId: null, custom: DEFAULT_COLOR });
export type ColorSelection = z.infer<typeof ColorSelectionSchema>;

// The palette's own default entries (a single "Primary" swatch). Its id is the stable literal
// 'default' — not a generated one — because topBar/platformBar's default color selection
// (below) references it by that id; resolveSelectedColor() would fail to resolve it otherwise.
// Returns a fresh array/object on every call so callers never share mutable state.
function defaultPaletteEntries(): PaletteEntry[] {
  return [{ id: 'default', name: 'Primary', color: DEFAULT_COLOR }];
}

// Parses `value` as a PaletteEntry[]: a non-array value (missing or junk) falls back to the
// default entries wholesale, otherwise each element is parsed independently and invalid
// elements are dropped (not substituted) so one bad entry can't nuke its valid siblings.
function parsePaletteEntries(value: unknown): PaletteEntry[] {
  if (!Array.isArray(value)) return defaultPaletteEntries();
  return value.reduce<PaletteEntry[]>((kept, item) => {
    const parsed = PaletteEntrySchema.safeParse(item);
    if (parsed.success) kept.push(parsed.data);
    return kept;
  }, []);
}

const PaletteSettingsObjectSchema = z.object({
  enabled: z.boolean().catch(true),
  // `.optional()` is required (not just cosmetic) even though parsePaletteEntries already
  // handles `undefined`: without it, Zod treats an entirely-absent `entries` key as an error
  // ("expected nonoptional") before the transform ever runs, regardless of what the transform
  // itself would accept.
  entries: z.unknown().optional().transform(parsePaletteEntries),
});
export const PaletteSettingsSchema = PaletteSettingsObjectSchema.catch(() => PaletteSettingsObjectSchema.parse({}));
export type PaletteSettings = z.infer<typeof PaletteSettingsSchema>;

const TopBarSettingsObjectSchema = z.object({
  enabled: z.boolean().catch(true),
  color: colorSelectionSchema({ paletteId: 'default', custom: DEFAULT_COLOR }),
  height: z.number().catch(DEFAULT_TOP_BAR_HEIGHT),
  stripes: z.boolean().catch(false),
});
export const TopBarSettingsSchema = TopBarSettingsObjectSchema.catch(() => TopBarSettingsObjectSchema.parse({}));
export type TopBarSettings = z.infer<typeof TopBarSettingsSchema>;

const PlatformBarSettingsObjectSchema = z.object({
  enabled: z.boolean().catch(true),
  color: colorSelectionSchema({ paletteId: 'default', custom: DEFAULT_COLOR }),
  stripes: z.boolean().catch(false),
});
export const PlatformBarSettingsSchema = PlatformBarSettingsObjectSchema.catch(() =>
  PlatformBarSettingsObjectSchema.parse({}),
);
export type PlatformBarSettings = z.infer<typeof PlatformBarSettingsSchema>;

const PlatformBarTextSettingsObjectSchema = z.object({
  enabled: z.boolean().catch(true),
  color: colorSelectionSchema({ paletteId: null, custom: DEFAULT_TEXT_COLOR }),
  // Pick black/white automatically by WCAG contrast against the platform bar color.
  auto: z.boolean().catch(false),
});
export const PlatformBarTextSettingsSchema = PlatformBarTextSettingsObjectSchema.catch(() =>
  PlatformBarTextSettingsObjectSchema.parse({}),
);
export type PlatformBarTextSettings = z.infer<typeof PlatformBarTextSettingsSchema>;

// One object per tinted surface, mirroring the settings UI's cards.
const ProjectSettingsObjectSchema = z.object({
  palette: PaletteSettingsSchema,
  topBar: TopBarSettingsSchema,
  platformBar: PlatformBarSettingsSchema,
  platformBarText: PlatformBarTextSettingsSchema,
});
export const ProjectSettingsSchema = ProjectSettingsObjectSchema.catch(() => ProjectSettingsObjectSchema.parse({}));
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

// How a ProjectRule's pattern is compared against the console URL's ?project= param.
export const MatchTypeSchema = z.enum(['prefix', 'suffix', 'exact', 'regex']);
export type MatchType = z.infer<typeof MatchTypeSchema>;

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

export const TintSettingsSchema = z.object({
  schemaVersion: z.string(),
  // Ordered: earlier rules take priority; first matching rule wins.
  // When no rule matches (or the URL has no project param), nothing is applied.
  projectRules: z.array(ProjectRuleSchema),
});
export type TintSettings = z.infer<typeof TintSettingsSchema>;
