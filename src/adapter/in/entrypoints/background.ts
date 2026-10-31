import { migrateStoredSettings } from '../../out/browser-settings-store';

export default defineBackground(() => {
  // Single writer for schema migrations: persist stored settings in the newest shape as
  // soon as the extension starts after an update. Content scripts and the side panel also
  // migrate in memory on read, so nothing depends on this write having happened yet.
  migrateStoredSettings(browser.runtime.getManifest().version).catch((error) =>
    console.error('[gcp-console-tint] settings migration failed', error),
  );

  // Each API exists only in some browsers (Chrome: sidePanel and action; Firefox MV2: sidebarAction
  // and browserAction), and Firefox's sidebarAction is missing from WXT's Chrome-based types.
  const ext: Partial<Pick<typeof browser, 'sidePanel' | 'action' | 'browserAction'>> & {
    sidebarAction?: { toggle(): Promise<void> };
  } = browser;

  const sidePanel = ext.sidePanel;
  if (sidePanel?.setPanelBehavior) {
    sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }

  const sidebarAction = ext.sidebarAction;
  if (!sidePanel && sidebarAction) {
    const action = ext.action ?? ext.browserAction;
    action?.onClicked.addListener(() => {
      sidebarAction.toggle();
    });
  }
});
