// --- Translations ---

const STRINGS = {
  ar: {
    dir: 'rtl',
    langTitle: 'English',
    options: 'كل القواعد والمواقع المعطّلة ←',
    count: (n) => `${n} عنصر RTL في الصفحة`,
    themeTitle: 'الوضع الداكن / الفاتح',
    subtitle: 'اتجاه تلقائي لكل فقرة',
    label: 'تفعيل الإضافة',
    scrollLabel: 'زر التمرير',
    scrollHint: 'للأعلى / للأسفل',
    on: 'مفعّلة',
    off: 'مطفية',
    siteDisable: 'تعطيل على هذا الموقع',
    siteEnable: 'تفعيل على هذا الموقع',
    unavailable: 'غير متاح في هذه الصفحة',
    pick: 'تصحيح عنصر يدويًا',
    clear: (n) => `مسح قواعد الموقع (${n})`,
    cleared: 'تم مسح القواعد ✓',
    reasonPage: 'الأداة مش متاحة في الصفحة دي',
    reasonOff: 'فعّل الإضافة الأول عشان تستخدم الأداة',
    reasonSite: 'الإضافة معطّلة على هذا الموقع',
    pickFail: 'مقدرتش أشغّل الأداة على الصفحة دي'
  },
  en: {
    dir: 'ltr',
    langTitle: 'العربية',
    options: 'All rules & disabled sites →',
    count: (n) => `${n} RTL elements on this page`,
    themeTitle: 'Dark / light mode',
    subtitle: 'Auto direction for every paragraph',
    label: 'Enable extension',
    scrollLabel: 'Scroll button',
    scrollHint: 'Jump to top / bottom',
    on: 'Enabled',
    off: 'Disabled',
    siteDisable: 'Disable on this site',
    siteEnable: 'Enable on this site',
    unavailable: 'Not available on this page',
    pick: 'Fix an element manually',
    clear: (n) => `Clear site rules (${n})`,
    cleared: 'Rules cleared ✓',
    reasonPage: 'This tool is not available on this page',
    reasonOff: 'Turn the extension on to use this tool',
    reasonSite: 'The extension is disabled on this site',
    pickFail: "Couldn't start the tool on this page"
  }
};

// --- Elements & state ---

const toggle = document.getElementById('toggle');
const statusEl = document.getElementById('status');
const siteBtn = document.getElementById('siteBtn');
const siteHost = document.getElementById('siteHost');
const langBtn = document.getElementById('langBtn');
const themeBtn = document.getElementById('themeBtn');
const subtitleEl = document.getElementById('subtitle');
const labelEl = document.getElementById('label');
const scrollToggle = document.getElementById('scrollToggle');
const scrollLabelEl = document.getElementById('scrollLabel');
const scrollHintEl = document.getElementById('scrollHint');
const pickBtn = document.getElementById('pickBtn');
const clearBtn = document.getElementById('clearBtn');
const optionsBtn = document.getElementById('optionsBtn');
const countEl = document.getElementById('count');
const noteEl = document.getElementById('note');
const toastEl = document.getElementById('toast');

let host = null; // hostname of the active tab (null on system pages)
let tabId = null;

// --- Helpers ---

// Short message at the bottom
let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// Saved settings (extension on and Arabic UI by default)
async function getState() {
  const { enabled, disabledSites = [], lang, rules = {}, scrollBtn, theme } =
    await chrome.storage.local.get(['enabled', 'disabledSites', 'lang', 'rules', 'scrollBtn', 'theme']);
  return {
    enabled: enabled !== false,
    scrollBtn: scrollBtn !== false,
    theme: theme === 'dark' || theme === 'light' ? theme : null, // null = follow system
    disabledSites,
    lang: lang === 'en' ? 'en' : 'ar',
    rules
  };
}

// Saved theme, or the system preference
function effectiveTheme(theme) {
  if (theme) return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Active tab id and hostname (http/https only, "www." removed)
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let hostname = null;
  try {
    const url = new URL(tab.url);
    if (url.protocol.startsWith('http')) hostname = url.hostname.replace(/^www\./, '');
  } catch { /* no accessible URL (e.g. chrome:// pages) */ }
  return { id: tab && tab.id, hostname };
}

// Ask the background worker to start the picker on this tab
async function startPicker() {
  const res = await chrome.runtime.sendMessage({ type: 'START_PICKER', tabId });
  return !!(res && res.ok);
}

// Ask the page how many elements are RTL (hidden when 0 or unavailable)
async function loadCount(lang) {
  countEl.textContent = '';
  await new Promise((r) => setTimeout(r, 150)); // let the page react to a fresh toggle
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_COUNT' });
    if (res && res.count > 0) countEl.textContent = STRINGS[lang].count(res.count);
  } catch { /* no content script on this page: show nothing */ }
}

// --- Render ---

// Disable the picker button and say why
function setPickState(disabled, reason) {
  pickBtn.disabled = disabled;
  pickBtn.title = disabled ? reason : '';
  noteEl.textContent = disabled ? reason : '';
  noteEl.className = disabled ? 'info' : '';
}

async function render() {
  const { enabled, disabledSites, lang, rules, scrollBtn, theme } = await getState();
  const t = STRINGS[lang];

  // Popup language and direction
  document.documentElement.lang = lang;
  document.documentElement.dir = t.dir;

  // Theme
  document.documentElement.dataset.theme = effectiveTheme(theme);
  themeBtn.title = t.themeTitle;

  // Texts
  langBtn.title = t.langTitle;
  subtitleEl.textContent = t.subtitle;
  labelEl.textContent = t.label;
  pickBtn.textContent = t.pick;
  optionsBtn.textContent = t.options;
  scrollLabelEl.textContent = t.scrollLabel;
  scrollHintEl.textContent = t.scrollHint;
  scrollToggle.checked = scrollBtn;

  // Main switch
  toggle.checked = enabled;
  statusEl.textContent = enabled ? t.on : t.off;
  statusEl.className = 'status ' + (enabled ? 'on' : 'off');

  // No usable page: disable everything
  if (!host) {
    siteHost.textContent = '';
    siteBtn.textContent = t.unavailable;
    siteBtn.className = 'block';
    siteBtn.disabled = true;
    countEl.textContent = '';
    setPickState(true, t.reasonPage);
    clearBtn.disabled = true;
    return;
  }

  const blocked = disabledSites.includes(host);
  siteHost.textContent = host;
  siteBtn.textContent = blocked ? t.siteEnable : t.siteDisable;
  siteBtn.className = blocked ? 'allow' : 'block';
  siteBtn.disabled = !enabled; // pointless while globally disabled

  // Picker only works while the extension is active on this site
  if (!enabled) setPickState(true, t.reasonOff);
  else if (blocked) setPickState(true, t.reasonSite);
  else setPickState(false, '');

  if (enabled && !blocked) loadCount(lang);
  else countEl.textContent = '';

  const count = (rules[host] || []).length;
  clearBtn.textContent = t.clear(count);
  clearBtn.disabled = count === 0;
}

// --- Events ---

// Language ar <-> en
langBtn.addEventListener('click', async () => {
  const { lang } = await getState();
  await chrome.storage.local.set({ lang: lang === 'ar' ? 'en' : 'ar' });
  await render();
});

// Dark <-> light
themeBtn.addEventListener('click', async () => {
  const { theme } = await getState();
  const next = effectiveTheme(theme) === 'dark' ? 'light' : 'dark';
  await chrome.storage.local.set({ theme: next });
  await render();
});

// Main on/off
toggle.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: toggle.checked });
  await render();
});

// Scroll button on/off
scrollToggle.addEventListener('change', async () => {
  await chrome.storage.local.set({ scrollBtn: scrollToggle.checked });
});

// Per-site on/off
siteBtn.addEventListener('click', async () => {
  if (!host) return;
  const { disabledSites } = await getState();

  const updated = disabledSites.includes(host)
    ? disabledSites.filter((h) => h !== host) // re-enable this site
    : [...disabledSites, host];  // disable this site

  await chrome.storage.local.set({ disabledSites: updated });
  await render();
});

// Start the picker, then close the popup
pickBtn.addEventListener('click', async () => {
  if (await startPicker()) {
    window.close();
  } else {
    const { lang } = await getState();
    noteEl.textContent = STRINGS[lang].pickFail;
    noteEl.className = '';  // red = error
  }
});

// Delete all manual rules of this site
clearBtn.addEventListener('click', async () => {
  const { rules, lang } = await getState();
  delete rules[host];
  await chrome.storage.local.set({ rules });
  await render();
  showToast(STRINGS[lang].cleared);
});

// Open the settings page
optionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// Init
(async () => {
  const tab = await getCurrentTab();
  host = tab.hostname;
  tabId = tab.id;
  await render();
})();
