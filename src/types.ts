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
