// RTL Smart - service worker
// Keyboard shortcuts and browser zoom.

// --- Helpers ---

// Short badge flash as feedback ("ON" / "OFF" / "!")
async function flash(tabId, text, color) {
  if (tabId == null) return;
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeText({ tabId, text });
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 1500);
  } catch { /* tab closed */ }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// Start the picker; inject content.js first if the page has no listener
async function startPickerOn(tabId) {
  const msg = { type: 'START_PICKER' };
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    return true;
  } catch { /* no listener yet: inject */ }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, msg);
    return true;
  } catch {
    return false;
  }
}

// --- Keyboard shortcuts ---

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab) return;

  if (command === 'toggle-extension') {
    const { enabled } = await chrome.storage.local.get('enabled');
    const next = enabled === false;  // was off -> turn on
    await chrome.storage.local.set({ enabled: next });
    flash(tab.id, next ? 'ON' : 'OFF', next ? '#16a34a' : '#6b7280');
    return;
  }

  if (command === 'pick-element') {
    const { enabled, disabledSites = [] } =
      await chrome.storage.local.get(['enabled', 'disabledSites']);

    // Only while the extension is active on this site (same as the popup)
    let host = null;
    try { host = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { /* no url access */ }
    if (enabled === false || (host && disabledSites.includes(host))) {
      flash(tab.id, 'OFF', '#6b7280');
      return;
    }

    if (!(await startPickerOn(tab.id))) flash(tab.id, '!', '#dc2626');  // e.g. chrome:// pages
  }
});

// --- Browser zoom and popup requests ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'GET_ZOOM' && sender.tab) {
    chrome.tabs.getZoom(sender.tab.id)
      .then((zoom) => sendResponse({ zoom }))
      .catch(() => sendResponse({ zoom: 1 }));
    return true;  // answer asynchronously
  }

  if (msg.type === 'START_PICKER') {  // from the popup
    startPickerOn(msg.tabId).then((ok) => sendResponse({ ok }));
    return true;
  }
});

chrome.tabs.onZoomChange.addListener(({ tabId, newZoomFactor }) => {
  chrome.tabs.sendMessage(tabId, { type: 'ZOOM', zoom: newZoomFactor }).catch(() => {});
});
