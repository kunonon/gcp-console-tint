import { migrateStoredSettings } from '../utils/settings';

export default defineBackground(() => {
  // Single writer for schema migrations: persist stored settings in the newest shape as
  // soon as the extension starts after an update. Content scripts and the side panel also
  // migrate in memory on read, so nothing depends on this write having happened yet.
  migrateStoredSettings(browser.runtime.getManifest().version).catch(() => {});

  const sidePanel = (browser as any).sidePanel;
  if (sidePanel?.setPanelBehavior) {
    sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }

  const sidebarAction = (browser as any).sidebarAction;
  if (!sidePanel && sidebarAction) {
    const action = (browser as any).action ?? (browser as any).browserAction;
    action?.onClicked.addListener(() => {
      sidebarAction.toggle();
    });
  }
});
