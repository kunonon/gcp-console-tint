export default defineBackground(() => {
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
