export interface PaletteEntry {
  id: string;
  name: string;
  color: string;
}

export interface ProjectSettings {
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

export interface TintSettings {
  schemaVersion: string;
  paletteEnabled: boolean;
  palette: PaletteEntry[];
  defaultProject: ProjectSettings;
  projects: Record<string, ProjectSettings>;
}
