import { useEffect, useState } from 'react';
import { Button, Card, Input, Switch } from '@heroui/react';
import type { PaletteEntry, ProjectSettings, TintSettings } from '../../types';
import { contrastTextColor } from '../../utils/color';
import { DEFAULT_SETTINGS, DEFAULT_PROJECT_SETTINGS, loadSettings } from '../../utils/settings';
import PaletteColorPicker from '../../components/PaletteColorPicker';
import ColorSwatchField from '../../components/ColorSwatchField';

const nameInputClassName = 'h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm';

const resolveColor = (
  paletteEnabled: boolean,
  palette: PaletteEntry[],
  paletteId: string | null,
  ownColor: string,
): string => {
  if (paletteEnabled && paletteId) {
    const entry = palette.find((e) => e.id === paletteId);
    if (entry) return entry.color;
  }
  return ownColor;
};

function PlusIcon() {
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
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
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
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function App() {
  const [settings, setSettings] = useState<TintSettings>(DEFAULT_SETTINGS);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectId, setNewProjectId] = useState('');

  useEffect(() => {
    const currentVersion = browser.runtime.getManifest().version;
    browser.storage.local.get('tintSettings').then((result) => {
      setSettings(loadSettings(result.tintSettings, currentVersion));
    });
  }, []);

  const save = (next: TintSettings) => {
    const stamped: TintSettings = { ...next, schemaVersion: browser.runtime.getManifest().version };
    setSettings(stamped);
    browser.storage.local.set({ tintSettings: stamped });
  };

  const updateCurrentProject = (patch: Partial<ProjectSettings>) => {
    if (selectedProjectId === null) {
      save({ ...settings, defaultProject: { ...settings.defaultProject, ...patch } });
    } else {
      const base = settings.projects[selectedProjectId] ?? DEFAULT_PROJECT_SETTINGS;
      save({
        ...settings,
        projects: { ...settings.projects, [selectedProjectId]: { ...base, ...patch } },
      });
    }
  };

  const handleSelectProject = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedProjectId(e.target.value === '' ? null : e.target.value);
  };

  const handleAddProject = () => {
    const id = newProjectId.trim();
    if (!id || settings.projects[id]) return;
    save({
      ...settings,
      projects: { ...settings.projects, [id]: { ...settings.defaultProject } },
    });
    setSelectedProjectId(id);
    setNewProjectId('');
  };

  const handleRemoveProject = () => {
    if (selectedProjectId === null) return;
    const rest = { ...settings.projects };
    delete rest[selectedProjectId];
    save({ ...settings, projects: rest });
    setSelectedProjectId(null);
  };

  const handlePaletteEnabledChange = (isSelected: boolean) => {
    save({ ...settings, paletteEnabled: isSelected });
  };

  const handleAddColor = () => {
    const entry: PaletteEntry = {
      id: crypto.randomUUID(),
      name: `Color ${settings.palette.length + 1}`,
      color: DEFAULT_PROJECT_SETTINGS.topBarColor,
    };
    save({ ...settings, palette: [...settings.palette, entry] });
  };

  const handlePaletteNameChange = (id: string, name: string) => {
    save({ ...settings, palette: settings.palette.map((e) => (e.id === id ? { ...e, name } : e)) });
  };

  const handlePaletteColorChange = (id: string, color: string) => {
    save({ ...settings, palette: settings.palette.map((e) => (e.id === id ? { ...e, color } : e)) });
  };

  const handleRemoveColor = (id: string) => {
    const clearReference = (project: ProjectSettings): ProjectSettings => ({
      ...project,
      topBarPaletteId: project.topBarPaletteId === id ? null : project.topBarPaletteId,
      platformBarPaletteId: project.platformBarPaletteId === id ? null : project.platformBarPaletteId,
      platformBarTextPaletteId:
        project.platformBarTextPaletteId === id ? null : project.platformBarTextPaletteId,
    });

    save({
      ...settings,
      palette: settings.palette.filter((e) => e.id !== id),
      defaultProject: clearReference(settings.defaultProject),
      projects: Object.fromEntries(
        Object.entries(settings.projects).map(([projectId, project]) => [projectId, clearReference(project)]),
      ),
    });
  };

  const handleTopBarEnabledChange = (isSelected: boolean) => {
    updateCurrentProject({ topBarEnabled: isSelected });
  };

  const handlePlatformBarEnabledChange = (isSelected: boolean) => {
    updateCurrentProject({ platformBarEnabled: isSelected });
  };

  const handleTopBarHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.valueAsNumber;
    if (!Number.isFinite(value)) return;
    updateCurrentProject({ topBarHeight: value });
  };

  const handleTopBarStripesChange = (isSelected: boolean) => {
    updateCurrentProject({ topBarStripes: isSelected });
  };

  const handlePlatformBarStripesChange = (isSelected: boolean) => {
    updateCurrentProject({ platformBarStripes: isSelected });
  };

  const handlePlatformBarTextEnabledChange = (isSelected: boolean) => {
    updateCurrentProject({ platformBarTextEnabled: isSelected });
  };

  const handleTopBarPaletteSelect = (id: string) => {
    updateCurrentProject({ topBarPaletteId: id });
  };

  const handleTopBarCustomColorChange = (color: string) => {
    updateCurrentProject({ topBarPaletteId: null, topBarColor: color });
  };

  const handlePlatformBarPaletteSelect = (id: string) => {
    updateCurrentProject({ platformBarPaletteId: id });
  };

  const handlePlatformBarCustomColorChange = (color: string) => {
    updateCurrentProject({ platformBarPaletteId: null, platformBarColor: color });
  };

  const handlePlatformBarTextPaletteSelect = (id: string) => {
    updateCurrentProject({ platformBarTextPaletteId: id, platformBarTextAuto: false });
  };

  const handlePlatformBarTextCustomColorChange = (color: string) => {
    updateCurrentProject({ platformBarTextPaletteId: null, platformBarTextColor: color, platformBarTextAuto: false });
  };

  const handlePlatformBarTextAutoSelect = () => {
    updateCurrentProject({ platformBarTextAuto: true });
  };

  const projectIds = Object.keys(settings.projects);
  const currentProject: ProjectSettings =
    selectedProjectId !== null
      ? (settings.projects[selectedProjectId] ?? DEFAULT_PROJECT_SETTINGS)
      : settings.defaultProject;

  const topBarEffectiveColor = resolveColor(
    settings.paletteEnabled,
    settings.palette,
    currentProject.topBarPaletteId,
    currentProject.topBarColor,
  );
  const platformBarEffectiveColor = resolveColor(
    settings.paletteEnabled,
    settings.palette,
    currentProject.platformBarPaletteId,
    currentProject.platformBarColor,
  );
  const platformBarTextEffectiveColor = currentProject.platformBarTextAuto
    ? contrastTextColor(platformBarEffectiveColor)
    : resolveColor(
        settings.paletteEnabled,
        settings.palette,
        currentProject.platformBarTextPaletteId,
        currentProject.platformBarTextColor,
      );

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-base font-semibold">GCP Console Tint</h1>

      <Card>
        <Card.Content className="flex flex-col gap-2">
          <div className="flex min-h-8 items-center justify-between">
            <span className="text-sm">Project</span>
            <select
              aria-label="Project"
              value={selectedProjectId ?? ''}
              onChange={handleSelectProject}
              className="h-8 rounded-md border border-border bg-transparent px-2 text-sm"
            >
              <option value="">Default</option>
              {projectIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Input
              aria-label="New project ID"
              placeholder="my-project-123"
              value={newProjectId}
              onChange={(e) => setNewProjectId(e.target.value)}
              className={nameInputClassName}
            />
            <Button
              isIconOnly
              variant="outline"
              aria-label="Add project"
              className="shrink-0"
              onPress={handleAddProject}
            >
              <PlusIcon />
            </Button>
          </div>
          {selectedProjectId !== null && (
            <div className="flex min-h-8 items-center justify-between">
              <span className="text-sm">Remove project</span>
              <Button
                isIconOnly
                variant="outline"
                aria-label="Remove project"
                className="shrink-0"
                onPress={handleRemoveProject}
              >
                <TrashIcon />
              </Button>
            </div>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Content className="flex flex-col gap-2">
          <Switch className="w-full" isSelected={settings.paletteEnabled} onChange={handlePaletteEnabledChange}>
            <Switch.Content className="flex w-full items-center justify-between">
              Color palette
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          {settings.paletteEnabled && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              {settings.palette.map((entry) => (
                <div key={entry.id} className="@container flex items-center justify-between gap-2">
                  <Input
                    aria-label="Color name"
                    placeholder="Name"
                    value={entry.name}
                    onChange={(e) => handlePaletteNameChange(entry.id, e.target.value)}
                    className={nameInputClassName}
                  />
                  <ColorSwatchField
                    ariaLabel={`${entry.name || '(unnamed)'} color`}
                    value={entry.color}
                    onChange={(e) => handlePaletteColorChange(entry.id, e.target.value)}
                    hexHidableOnNarrow
                  />
                  <Button
                    isIconOnly
                    variant="outline"
                    size="sm"
                    aria-label="Remove color"
                    className="shrink-0"
                    onPress={() => handleRemoveColor(entry.id)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              ))}
              <Button isIconOnly variant="outline" aria-label="Add color" onPress={handleAddColor}>
                <PlusIcon />
              </Button>
            </div>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Content className="flex flex-col gap-2">
          <Switch className="w-full" isSelected={currentProject.topBarEnabled} onChange={handleTopBarEnabledChange}>
            <Switch.Content className="flex w-full items-center justify-between">
              Top bar
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          {currentProject.topBarEnabled && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <div className="flex min-h-8 items-center justify-between">
                <span className="text-sm">Color</span>
                <PaletteColorPicker
                  ariaLabel="Top bar color"
                  paletteEnabled={settings.paletteEnabled}
                  palette={settings.palette}
                  paletteId={currentProject.topBarPaletteId}
                  customColor={currentProject.topBarColor}
                  effectiveColor={topBarEffectiveColor}
                  onSelectPaletteEntry={handleTopBarPaletteSelect}
                  onSelectCustomColor={handleTopBarCustomColorChange}
                />
              </div>
              <div className="flex min-h-8 items-center justify-between">
                <span className="text-sm">Height</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    aria-label="Top bar height"
                    min={1}
                    max={40}
                    value={currentProject.topBarHeight}
                    onChange={handleTopBarHeightChange}
                    className="h-8 w-16 rounded-md border border-border bg-transparent px-2 text-sm"
                  />
                  <span className="text-sm text-muted">px</span>
                </div>
              </div>
              <Switch
                className="min-h-8 w-full"
                isSelected={currentProject.topBarStripes}
                onChange={handleTopBarStripesChange}
              >
                <Switch.Content className="flex w-full items-center justify-between">
                  <span className="text-sm font-normal">Stripes</span>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
            </div>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Content className="flex flex-col gap-2">
          <Switch
            className="w-full"
            isSelected={currentProject.platformBarEnabled}
            onChange={handlePlatformBarEnabledChange}
          >
            <Switch.Content className="flex w-full items-center justify-between">
              Platform Bar
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          {currentProject.platformBarEnabled && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <div className="flex min-h-8 items-center justify-between">
                <span className="text-sm">Color</span>
                <PaletteColorPicker
                  ariaLabel="Platform Bar color"
                  paletteEnabled={settings.paletteEnabled}
                  palette={settings.palette}
                  paletteId={currentProject.platformBarPaletteId}
                  customColor={currentProject.platformBarColor}
                  effectiveColor={platformBarEffectiveColor}
                  onSelectPaletteEntry={handlePlatformBarPaletteSelect}
                  onSelectCustomColor={handlePlatformBarCustomColorChange}
                />
              </div>
              <Switch
                className="min-h-8 w-full"
                isSelected={currentProject.platformBarStripes}
                onChange={handlePlatformBarStripesChange}
              >
                <Switch.Content className="flex w-full items-center justify-between">
                  <span className="text-sm font-normal">Stripes</span>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Content>
              </Switch>
            </div>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Content className="flex flex-col gap-2">
          <Switch
            className="w-full"
            isSelected={currentProject.platformBarTextEnabled}
            onChange={handlePlatformBarTextEnabledChange}
          >
            <Switch.Content className="flex w-full items-center justify-between">
              Platform Bar text color
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          {currentProject.platformBarTextEnabled && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <div className="flex min-h-8 items-center justify-between">
                <span className="text-sm">Color</span>
                <PaletteColorPicker
                  ariaLabel="Platform Bar text color"
                  paletteEnabled={settings.paletteEnabled}
                  palette={settings.palette}
                  paletteId={currentProject.platformBarTextPaletteId}
                  customColor={currentProject.platformBarTextColor}
                  effectiveColor={platformBarTextEffectiveColor}
                  onSelectPaletteEntry={handlePlatformBarTextPaletteSelect}
                  onSelectCustomColor={handlePlatformBarTextCustomColorChange}
                  supportsAuto
                  autoSelected={currentProject.platformBarTextAuto}
                  onSelectAuto={handlePlatformBarTextAutoSelect}
                />
              </div>
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

export default App;
