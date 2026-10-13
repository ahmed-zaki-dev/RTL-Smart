// --- Translations ---

const STRINGS = {
  ar: {
    dir: 'rtl',
    langTitle: 'English',
    themeTitle: 'الوضع الداكن / الفاتح',
    subtitle: 'إدارة القواعد اليدوية والمواقع المعطّلة',

    rulesTitle: 'القواعد اليدوية',
    rulesDesc: 'العناصر اللي صلّحت اتجاهها بإيدك. تقدر تحذف قاعدة واحدة من غير ما تمسح باقي قواعد الموقع.',
    noRules: 'مفيش قواعد يدوية لسه',
    deleteRule: 'حذف القاعدة',
    clearSite: 'مسح الكل',
    confirmClear: (h, n) => `تمسح كل قواعد ${h} (${n})؟`,
    deleted: 'تم الحذف ✓',

    sitesTitle: 'المواقع المعطّلة',
    sitesDesc: 'المواقع اللي الإضافة متعطّلة عليها. فعّل أي موقع بضغطة، أو عطّل موقع جديد من هنا.',
    noSites: 'مفيش مواقع معطّلة',
    enable: 'تفعيل',
    add: 'تعطيل الموقع',
    invalidHost: 'اكتب اسم موقع صحيح (مثال: example.com)',
    already: 'الموقع ده معطّل بالفعل',
    enabledToast: 'تم التفعيل ✓',
    addedToast: 'تم التعطيل ✓',

    keysTitle: 'اختصارات لوحة المفاتيح',
    keysDesc: 'تشتغل من أي صفحة من غير ما تفتح النافذة. تقدر تغيّرها من صفحة اختصارات كروم.',
    keysChange: 'تغيير الاختصارات',
    keyNotSet: 'غير معيّن',
    keyNames: {
      'pick-element': 'تصحيح عنصر يدويًا',
      'toggle-extension': 'تشغيل / إيقاف الإضافة'
    }
  },
  en: {
    dir: 'ltr',
    langTitle: 'العربية',
    themeTitle: 'Dark / light mode',
    subtitle: 'Manage manual rules and disabled sites',

    rulesTitle: 'Manual rules',
    rulesDesc: 'Elements whose direction you fixed by hand. Delete a single rule without clearing the rest of the site.',
    noRules: 'No manual rules yet',
    deleteRule: 'Delete rule',
    clearSite: 'Clear all',
    confirmClear: (h, n) => `Clear all rules for ${h} (${n})?`,
    deleted: 'Deleted ✓',

    sitesTitle: 'Disabled sites',
    sitesDesc: 'Sites where the extension is turned off. Re-enable one with a click, or disable a new site here.',
    noSites: 'No disabled sites',
    enable: 'Enable',
    add: 'Disable site',
    invalidHost: 'Enter a valid site name (e.g. example.com)',
    already: 'This site is already disabled',
    enabledToast: 'Enabled ✓',
    addedToast: 'Disabled ✓',

    keysTitle: 'Keyboard shortcuts',
    keysDesc: 'They work from any page without opening the popup. Change them on Chrome\'s shortcuts page.',
    keysChange: 'Change shortcuts',
    keyNotSet: 'Not set',
    keyNames: {
      'pick-element': 'Fix an element manually',
      'toggle-extension': 'Turn the extension on / off'
    }
  }
};

// --- Helpers ---

const $ = (id) => document.getElementById(id);
const rulesList = $('rulesList');
const sitesList = $('sitesList');
const addInput = $('addInput');
const addBtn = $('addBtn');
const addMsg = $('addMsg');
const toastEl = $('toast');
const keysList = $('keysList');

let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// Small DOM builder (text only, never HTML)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function getState() {
  const { disabledSites = [], rules = {}, lang, theme } =
    await chrome.storage.local.get(['disabledSites', 'rules', 'lang', 'theme']);
  return {
    disabledSites,
    rules,
    lang: lang === 'en' ? 'en' : 'ar',
    theme: theme === 'dark' || theme === 'light' ? theme : null // null = follow system
  };
}

function effectiveTheme(theme) {
  if (theme) return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// "https://www.Example.com/path" -> "example.com"
function normalizeHost(input) {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  try {
    s = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : 'http://' + s).hostname;
  } catch {
    return null;
  }
  s = s.replace(/^www\./, '');
  return /^[a-z0-9.-]+$/.test(s) && s.length > 0 ? s : null;
}

// --- Render ---

function renderRules(rules, t) {
  rulesList.replaceChildren();
  const hosts = Object.keys(rules).filter((h) => (rules[h] || []).length).sort();

  if (!hosts.length) {
    rulesList.append(el('div', 'empty', t.noRules));
    return;
  }

  for (const host of hosts) {
    const list = rules[host];
    const box = el('div', 'site');

    const head = el('div', 'site-head');
    head.append(el('span', 'host', host), el('span', 'count', String(list.length)), el('span', 'spacer'));
    const clearAll = el('button', 'btn danger', t.clearSite);
    clearAll.type = 'button';
    clearAll.addEventListener('click', () => clearSiteRules(host, list.length, t));
    head.append(clearAll);
    box.append(head);

    for (const rule of list) {
      const row = el('div', 'rule');
      const dir = el('span', 'dir ' + (rule.dir === 'rtl' ? 'rtl' : 'ltr'), rule.dir === 'rtl' ? 'RTL' : 'LTR');
      const sel = el('span', 'selector', rule.selector);
      sel.title = rule.selector;
      const del = el('button', 'btn danger icon', '✕');
      del.type = 'button';
      del.title = t.deleteRule;
      del.setAttribute('aria-label', t.deleteRule);
      del.addEventListener('click', () => deleteRule(host, rule, t));
      row.append(dir, sel, del);
      box.append(row);
    }
    rulesList.append(box);
  }
}

function renderSites(disabledSites, t) {
  sitesList.replaceChildren();

  if (!disabledSites.length) {
    sitesList.append(el('div', 'empty', t.noSites));
    return;
  }

  for (const host of [...disabledSites].sort()) {
    const row = el('div', 'site-row');
    const enableBtn = el('button', 'btn allow', t.enable);
    enableBtn.type = 'button';
    enableBtn.addEventListener('click', () => enableSite(host, t));
    row.append(el('span', 'host', host), enableBtn);
    sitesList.append(row);
  }
}

// Shortcuts currently assigned in Chrome
async function renderShortcuts(t) {
  let commands = [];
  try { commands = await chrome.commands.getAll(); } catch { /* API unavailable */ }

  keysList.replaceChildren();
  for (const name of Object.keys(t.keyNames)) {
    const cmd = commands.find((c) => c.name === name);
    const row = el('div', 'shortcut');
    const key = cmd && cmd.shortcut
      ? el('kbd', '', cmd.shortcut)
      : el('kbd', 'unset', t.keyNotSet);
    row.append(el('span', 'name', t.keyNames[name]), key);
    keysList.append(row);
  }
}

async function render() {
  const { disabledSites, rules, lang, theme } = await getState();
  const t = STRINGS[lang];

  document.documentElement.lang = lang;
  document.documentElement.dir = t.dir;
  document.documentElement.dataset.theme = effectiveTheme(theme);

  $('langBtn').title = t.langTitle;
  $('themeBtn').title = t.themeTitle;
  $('subtitle').textContent = t.subtitle;
  $('rulesTitle').textContent = t.rulesTitle;
  $('rulesDesc').textContent = t.rulesDesc;
  $('sitesTitle').textContent = t.sitesTitle;
  $('sitesDesc').textContent = t.sitesDesc;
  addBtn.textContent = t.add;

  $('keysTitle').textContent = t.keysTitle;
  $('keysDesc').textContent = t.keysDesc;
  $('keysBtn').textContent = t.keysChange;

  renderRules(rules, t);
  renderSites(disabledSites, t);
  renderShortcuts(t);
}

// --- Actions (re-read storage first) ---

async function deleteRule(host, rule, t) {
  const { rules } = await getState();
  const list = rules[host] || [];
  const i = list.findIndex((r) => r.selector === rule.selector && r.dir === rule.dir);
  if (i === -1) return;

  list.splice(i, 1);
  if (list.length) rules[host] = list;
  else delete rules[host];

  await chrome.storage.local.set({ rules });
  showToast(t.deleted);
}

async function clearSiteRules(host, count, t) {
  if (!confirm(t.confirmClear(host, count))) return;
  const { rules } = await getState();
  delete rules[host];
  await chrome.storage.local.set({ rules });
  showToast(t.deleted);
}

async function enableSite(host, t) {
  const { disabledSites } = await getState();
  await chrome.storage.local.set({ disabledSites: disabledSites.filter((h) => h !== host) });
  showToast(t.enabledToast);
}

async function addSite() {
  const { disabledSites, lang } = await getState();
  const t = STRINGS[lang];
  const host = normalizeHost(addInput.value);

  if (!host) { addMsg.textContent = t.invalidHost; return; }
  if (disabledSites.includes(host)) { addMsg.textContent = t.already; return; }

  addMsg.textContent = '';
  addInput.value = '';
  await chrome.storage.local.set({ disabledSites: [...disabledSites, host] });
  showToast(t.addedToast);
}

// --- Events ---

addBtn.addEventListener('click', addSite);
addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSite(); });
addInput.addEventListener('input', () => { addMsg.textContent = ''; });

// chrome:// pages can only be opened through the tabs API
$('keysBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

$('langBtn').addEventListener('click', async () => {
  const { lang } = await getState();
  await chrome.storage.local.set({ lang: lang === 'ar' ? 'en' : 'ar' });
});

$('themeBtn').addEventListener('click', async () => {
  const { theme } = await getState();
  await chrome.storage.local.set({ theme: effectiveTheme(theme) === 'dark' ? 'light' : 'dark' });
});

// Any storage change refreshes the lists
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.rules || changes.disabledSites || changes.lang || changes.theme) render();
});

render();
