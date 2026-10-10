import { Card, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import type { ReactNode } from 'react';
import type { Theme } from '../../../../../domain/tint-settings';

export const THEME_LABELS: Record<Theme, string> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

// Left to right on screen: sun, half-lit disc, moon. The domain's THEMES order stays as is.
const THEME_OPTIONS = ['light', 'auto', 'dark'] as const satisfies readonly Theme[];

// The hint under the label spells out what the highlighted icon means. Kept short: it shares the
// row with the 96px switch, and a longer line wraps once the panel is about 350px wide.
const THEME_HINTS: Record<Theme, string> = {
  light: 'Light',
  auto: 'Auto (follows system)',
  dark: 'Dark',
};

function ThemeIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// Light: a sun.
function SunIcon() {
  return (
    <ThemeIcon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </ThemeIcon>
  );
}

// Auto: one disc, outlined on its left half and solid on its right — light and dark in one body,
// so the row reads all light / half and half / all dark. It is the half-filled circle that icon
// sets draw for appearance and contrast, on the sun's and the moon's own grid: the ring is their
// 2-unit stroke, and r=8.5 keeps it just inside the moon's footprint (19 of the moon's 20 units
// across, the same 14 pixel columns at 16px on a 1x screen). The half is the only filled shape in
// the set; its stroke="none" keeps the straight edge exactly on x=12, a pixel boundary at 16px.
function HalfDiscIcon() {
  return (
    <ThemeIcon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </ThemeIcon>
  );
}

// Dark: a crescent moon.
function MoonIcon() {
  return (
    <ThemeIcon>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </ThemeIcon>
  );
}

const THEME_ICONS: Record<Theme, () => ReactNode> = {
  light: SunIcon,
  auto: HalfDiscIcon,
  dark: MoonIcon,
};

interface AppearanceCardProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
}

// The Settings tab's side panel theme picker: a segmented icon control (a single-selection
// radiogroup) whose look is defined in style.css (.theme-switch). The buttons carry no tooltips
// because style.css positions the sliding thumb with :has() and :nth-child over the group's direct
// .toggle-button children: the three buttons must stay the group's only children, in THEME_OPTIONS
// order, with no wrapper (such as a tooltip's) between them. The hint under the label names the
// current choice instead, and each button's accessible name is its aria-label. App saves the pick
// and useTheme applies it.
export default function AppearanceCard({ theme, onChange }: AppearanceCardProps) {
  return (
    <Card>
      <Card.Content className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">Appearance</div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <div className="flex min-h-8 items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm">Theme</span>
              <span className="text-xs text-muted">{THEME_HINTS[theme]}</span>
            </div>
            <ToggleButtonGroup
              aria-label="Theme"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[theme]}
              size="sm"
              className="theme-switch"
              // Clicking the checked radio again re-reports its own key, so only a different key saves.
              onSelectionChange={(keys) => {
                const [key] = keys;
                if (key != null && key !== theme) onChange(key as Theme);
              }}
            >
              {THEME_OPTIONS.map((option) => {
                const Icon = THEME_ICONS[option];
                return (
                  <ToggleButton key={option} id={option} isIconOnly aria-label={THEME_LABELS[option]}>
                    <Icon />
                  </ToggleButton>
                );
              })}
            </ToggleButtonGroup>
          </div>
        </div>
      </Card.Content>
    </Card>
  );
}
