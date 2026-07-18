import { describe, it, expect } from 'vitest';
import { loadSettings, resolveProjectSettings, DEFAULT_SETTINGS, DEFAULT_PROJECT_SETTINGS } from './settings';

const CURRENT_VERSION = '0.1.0';

describe('loadSettings', () => {
  it('returns fresh defaults stamped with the current version for null/undefined input', () => {
    expect(loadSettings(null, CURRENT_VERSION)).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: CURRENT_VERSION });
    expect(loadSettings(undefined, CURRENT_VERSION)).toEqual({
      ...DEFAULT_SETTINGS,
      schemaVersion: CURRENT_VERSION,
    });
  });

  it('returns fresh defaults for non-object input', () => {
    expect(loadSettings('a string', CURRENT_VERSION)).toEqual({
      ...DEFAULT_SETTINGS,
      schemaVersion: CURRENT_VERSION,
    });
    expect(loadSettings(42, CURRENT_VERSION)).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: CURRENT_VERSION });
  });

  it('discards data with no schemaVersion (old flat v1 shape) and returns defaults', () => {
    const oldFlatShape = {
      topBarEnabled: true,
      topBarColor: '#111111',
      paletteEnabled: false,
    };

    const loaded = loadSettings(oldFlatShape, CURRENT_VERSION);

    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: CURRENT_VERSION });
  });

  it('discards data whose schemaVersion is below SCHEMA_MIN_VERSION', () => {
    const loaded = loadSettings(
      { schemaVersion: '0.0.9', defaultProject: { topBarColor: '#123456' } },
      CURRENT_VERSION,
    );

    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: CURRENT_VERSION });
  });

  it('discards data whose schemaVersion is missing or not a string', () => {
    expect(loadSettings({ schemaVersion: 123, defaultProject: {} }, CURRENT_VERSION)).toEqual({
      ...DEFAULT_SETTINGS,
      schemaVersion: CURRENT_VERSION,
    });
    expect(loadSettings({ defaultProject: { topBarColor: '#123456' } }, CURRENT_VERSION)).toEqual({
      ...DEFAULT_SETTINGS,
      schemaVersion: CURRENT_VERSION,
    });
  });

  it('reads data at exactly SCHEMA_MIN_VERSION, merging defaultProject with defaults', () => {
    const stored = {
      schemaVersion: '0.1.0',
      paletteEnabled: true,
      palette: [{ id: 'default', name: 'Primary', color: '#ff6d00' }],
      defaultProject: { topBarColor: '#654321' },
      projects: {},
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.schemaVersion).toBe('0.1.0');
    expect(loaded.defaultProject).toEqual({ ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#654321' });
    expect(loaded.projects).toEqual({});
  });

  it('reads data with a schemaVersion newer than SCHEMA_MIN_VERSION as-is', () => {
    const stored = {
      schemaVersion: '9.9.9',
      paletteEnabled: true,
      palette: [{ id: 'default', name: 'Primary', color: '#ff6d00' }],
      defaultProject: { topBarColor: '#00ff00' },
      projects: {},
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.schemaVersion).toBe('9.9.9');
    expect(loaded.defaultProject.topBarColor).toBe('#00ff00');
  });

  it('merges each project entry in a valid projects map with the ProjectSettings defaults', () => {
    const stored = {
      schemaVersion: '0.1.0',
      defaultProject: {},
      projects: {
        'my-project': { topBarColor: '#00ff00' },
        'other-project': { platformBarStripes: true },
      },
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projects['my-project']).toEqual({ ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#00ff00' });
    expect(loaded.projects['other-project']).toEqual({
      ...DEFAULT_PROJECT_SETTINGS,
      platformBarStripes: true,
    });
  });

  it('defaults to an empty projects map and default defaultProject when both are absent from otherwise-valid data', () => {
    const loaded = loadSettings({ schemaVersion: '0.1.0', paletteEnabled: false }, CURRENT_VERSION);

    expect(loaded.paletteEnabled).toBe(false);
    expect(loaded.defaultProject).toEqual(DEFAULT_PROJECT_SETTINGS);
    expect(loaded.projects).toEqual({});
  });
});

describe('resolveProjectSettings', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    defaultProject: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#default' },
    projects: {
      'known-project': { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#known' },
    },
  };

  it('returns the matching project settings when projectId is known', () => {
    expect(resolveProjectSettings(settings, 'known-project').topBarColor).toBe('#known');
  });

  it('returns defaultProject when projectId is null', () => {
    expect(resolveProjectSettings(settings, null).topBarColor).toBe('#default');
  });

  it('returns defaultProject when projectId does not match any known project', () => {
    expect(resolveProjectSettings(settings, 'unknown-project').topBarColor).toBe('#default');
  });
});
