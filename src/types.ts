export interface PaletteEntry {
  id: string;
  name: string;
  color: string;
}

export interface ProjectSettings {
  paletteEnabled: boolean;
  palette: PaletteEntry[];
  topBarEnabled: boolean;
  topBarColor: string;
  topBarPaletteId: string | null;
  topBarHeight: number;
  topBarStripes: boolean;
  platformBarEnabled: boolean;
  platformBarColor: string;
  platformBarPaletteId: string | null;
  platformBarStripes: boolean;
  platformBarTextEnabled: boolean;
  platformBarTextColor: string;
  platformBarTextPaletteId: string | null;
  platformBarTextAuto: boolean;
}

export interface ProjectRule {
  id: string;
  // Regular expression source matched against the console URL's ?project= param.
  pattern: string;
  settings: ProjectSettings;
}

export interface TintSettings {
  schemaVersion: string;
  // Ordered: earlier rules take priority; first matching rule wins.
  // When no rule matches (or the URL has no project param), nothing is applied.
  projectRules: ProjectRule[];
}
