export interface PaletteEntry {
  id: string;
  name: string;
  color: string;
}

// A color choice shared by every tinted surface: the palette entry wins while paletteId is
// set (and the project's palette is enabled), otherwise `custom` applies. `custom` is kept
// even while a palette entry is selected, so switching back to custom restores the last
// hand-picked value.
export interface ColorSelection {
  paletteId: string | null;
  custom: string;
}

export interface PaletteSettings {
  enabled: boolean;
  entries: PaletteEntry[];
}

export interface TopBarSettings {
  enabled: boolean;
  color: ColorSelection;
  height: number;
  stripes: boolean;
}

export interface PlatformBarSettings {
  enabled: boolean;
  color: ColorSelection;
  stripes: boolean;
}

export interface PlatformBarTextSettings {
  enabled: boolean;
  color: ColorSelection;
  // Pick black/white automatically by WCAG contrast against the platform bar color.
  auto: boolean;
}

// One object per tinted surface, mirroring the settings UI's cards.
export interface ProjectSettings {
  palette: PaletteSettings;
  topBar: TopBarSettings;
  platformBar: PlatformBarSettings;
  platformBarText: PlatformBarTextSettings;
}

// How a ProjectRule's pattern is compared against the console URL's ?project= param.
export type MatchType = 'prefix' | 'suffix' | 'exact' | 'regex';

export interface ProjectRule {
  id: string;
  matchType: MatchType;
  // For 'prefix' | 'suffix' | 'exact': a literal string compared against the project id.
  // For 'regex': a regular expression source that must match the ENTIRE project id.
  pattern: string;
  settings: ProjectSettings;
}

export interface TintSettings {
  schemaVersion: string;
  // Ordered: earlier rules take priority; first matching rule wins.
  // When no rule matches (or the URL has no project param), nothing is applied.
  projectRules: ProjectRule[];
}
