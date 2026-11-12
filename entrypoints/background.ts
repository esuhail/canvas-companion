export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel. The worker does nothing else:
  // no alarms, no background sync, no requests while the panel is closed.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
