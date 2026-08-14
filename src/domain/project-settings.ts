import { z } from 'zod';
import { DEFAULT_COLOR, DEFAULT_TEXT_COLOR } from './color';
import { colorSelectionSchema } from './color-selection';
import { PaletteSettingsSchema } from './palette';

export const DEFAULT_TOP_BAR_HEIGHT = 4;

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

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = ProjectSettingsSchema.parse({});

export function cloneProjectSettings(settings: ProjectSettings): ProjectSettings {
  return {
    palette: {
      enabled: settings.palette.enabled,
      entries: settings.palette.entries.map((entry) => ({ ...entry })),
    },
    topBar: { ...settings.topBar, color: { ...settings.topBar.color } },
    platformBar: { ...settings.platformBar, color: { ...settings.platformBar.color } },
    platformBarText: { ...settings.platformBarText, color: { ...settings.platformBarText.color } },
  };
}
