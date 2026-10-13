// RTL Smart - content script
// Sets text direction per block, manual fixes, floating scroll button.

// Run once per page (the popup or a shortcut may inject this file again)
(() => {
  if (window.__rtlSmartLoaded) return;
  window.__rtlSmartLoaded = true;

  // --- Config ---

  // Turn off if text-align changes break a site
  const FIX_TEXT_ALIGN = true;

  // Look inside Shadow DOM (Web Components)
  const SUPPORT_SHADOW_DOM = true;

  // RTL if Arabic words are at least this share of all words
  const RTL_THRESHOLD = 0.25;

  // Streaming text: keep the old direction under MIN_WORDS words; flipping needs HYSTERESIS extra
  const MIN_WORDS = 4;
  const HYSTERESIS = 0.1;

  // Process DOM changes at most once per this many ms
  const THROTTLE_MS = 250;

  // Never touched by automatic detection
  const EXCLUDE_SELECTORS = [
    'pre', 'code', 'kbd', 'samp',
    'nav', 'header', 'footer', 'aside',
    '.navbar', '.sidebar', '.code-block',
    '[class*="code"]', '[class*="Code"]', '[class*="hljs"]',
    '[class*="language-"]', '[class*="highlight"]',
    'button', 'a', 'select', 'textarea', 'input', 'svg',
    '[role="menu"]', '[role="menubar"]', '[role="tablist"]',
    '[role="navigation"]', '[role="toolbar"]',
    '[contenteditable="true"]'
  ].join(', ');

  // Blocks that get a direction
  const TARGET_SELECTOR =
    'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th';

  // Lists and tables: the direction goes on the container itself
  const CONTAINER_SELECTOR = 'ol, ul, table';

  // An element containing these is just a layout wrapper
  const BLOCK_CHILDREN =
    'p, ul, ol, li, div, table, blockquote, pre, section, article, h1, h2, h3, h4, h5, h6';

  const ARABIC_CHAR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const LATIN_CHAR = /[A-Za-z]/;
  const ARABIC_PUNCT = /[\u061F\u060C\u061B]/; // ؟ ، ؛

  // Latin tokens that are really code or links (not counted)
  const TECH_TOKEN = /^(?:https?:\/\/|www\.)|[\/\\_@=<>{}]/;

  // Inline code is ignored when detecting direction
  const INLINE_CODE = 'code, kbd, samp, tt, var';

  // www.example.com and example.com share settings
  const HOST = location.hostname.replace(/^www\./, '');

  // Manual rules for this site: [{ selector, dir }]
  let rules = [];

  // --- Direction detection ---

  // Returns 'rtl', 'ltr' or null (nothing to decide). `current` = direction set before.
  function detectDir(text, current = null) {
    // Arabic punctuation is a strong RTL signal
    if (ARABIC_PUNCT.test(text)) return 'rtl';

    let arabic = 0;
    let latin = 0;
    for (const word of text.split(/\s+/)) {
      if (ARABIC_CHAR.test(word)) arabic++;
      else if (LATIN_CHAR.test(word) && !TECH_TOKEN.test(word)) latin++;
    }

    const total = arabic + latin;
    if (total === 0) return null;

    // Too little text to change an earlier decision
    if (current && total < MIN_WORDS) return current;

    const ratio = arabic / total;
    if (current === 'rtl') return ratio >= RTL_THRESHOLD - HYSTERESIS ? 'rtl' : 'ltr';
    if (current === 'ltr') return ratio >= RTL_THRESHOLD + HYSTERESIS ? 'rtl' : 'ltr';
    return ratio >= RTL_THRESHOLD ? 'rtl' : 'ltr';
  }

  // --- Helpers ---

  // Text used for detection: textContent without inline code
  function textForDetection(el) {
    if (!el.querySelector(INLINE_CODE)) return el.textContent;
    let out = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const code = n.parentElement && n.parentElement.closest(INLINE_CODE);
      if (code && el.contains(code)) { out += ' '; continue; }
      out += n.nodeValue;
    }
    return out;
  }

  // closest() that also climbs out of shadow roots
  function closestComposed(el, selector) {
    while (el) {
      const hit = el.closest(selector);
      if (hit) return hit;
      const root = el.getRootNode();
      el = root instanceof ShadowRoot ? root.host : null;
    }
    return null;
  }

  // Parent element (a shadow root's parent is its host)
  function parentOf(node) {
    const p = node.parentNode;
    if (!p) return null;
    if (p instanceof ShadowRoot) return p.host;
    return p.nodeType === 1 ? p : null;
  }

  // Leaf block: has text, no nested blocks
  function isLeafTextBlock(el) {
    if (!el.textContent.trim()) return false;
    return !el.querySelector(BLOCK_CHILDREN);
  }

  // Layout tables must not be flipped
  function isLayoutTable(el) {
    if (el.tagName !== 'TABLE') return false;
    const role = el.getAttribute('role');
    if (role === 'presentation' || role === 'none') return true;
    return !!el.querySelector('table');
  }

  function isMarked(el) {
    return el.dataset.rtlSmartApplied === 'true';
  }

  // Skip: manual rule, site-set dir, excluded area, or preformatted text
  function shouldSkip(el) {
    if (el.dataset.rtlSmartRule) return true;
    if (el.hasAttribute('dir') && !isMarked(el)) return true;
    if (closestComposed(el, EXCLUDE_SELECTORS)) return true;
    return getComputedStyle(el).whiteSpace.startsWith('pre');
  }

  function safeMatches(el, selector) {
    try { return el.matches(selector); } catch { return false; }
  }

  // Set the direction on one block (re-runs as streaming text grows)
  function setDir(el) {
    const current = isMarked(el) ? el.getAttribute('dir') : null;
    const dir = detectDir(textForDetection(el), current);
    if (!dir) return;

    if (el.getAttribute('dir') !== dir) el.setAttribute('dir', dir);
    el.dataset.rtlSmartApplied = 'true';  // mark: added by us

    if (FIX_TEXT_ALIGN) fixAlign(el);
  }

  // Replace hard-coded left/right with "start"
  function fixAlign(el) {
    if ('rtlSmartOldAlign' in el.dataset) return; // already handled

    const align = getComputedStyle(el).textAlign;
    if (align === 'left' || align === 'right') {
      // Remember the original inline value for restore
      el.dataset.rtlSmartOldAlign = el.style.getPropertyValue('text-align');
      el.style.setProperty('text-align', 'start', 'important');
    }
  }

  // Undo everything we did to one element
  function restoreEl(el) {
    if ('rtlSmartOldDir' in el.dataset) {
      const old = el.dataset.rtlSmartOldDir;  // dir the site had (maybe '')
      if (old) el.setAttribute('dir', old);
      else el.removeAttribute('dir');
    } else {
      el.removeAttribute('dir');
    }

    if ('rtlSmartOldAlign' in el.dataset) {
      const oldAlign = el.dataset.rtlSmartOldAlign;
      if (oldAlign) el.style.setProperty('text-align', oldAlign);
      else el.style.removeProperty('text-align');
    }

    delete el.dataset.rtlSmartApplied;
    delete el.dataset.rtlSmartOldDir;
    delete el.dataset.rtlSmartOldAlign;
    delete el.dataset.rtlSmartRule;
  }

  // --- Shadow DOM (Web Components) ---
  // Queries and observers stop at shadow boundaries, so each root is tracked on its own.
  // Closed roots: chrome.dom.openOrClosedShadowRoot (custom elements only).
  // Manual rules are plain CSS selectors: they only reach the main document.

  const shadowRoots = new Set();  // every ShadowRoot we process / observe
  const retryHosts = [];  // custom elements that may get a shadow root later
  const MAX_RETRY_TRIES = 3;
  const MAX_RETRY_LIST = 20000;
  let retryTimer = null;

  function getShadowRoot(el) {
    if (el.hasAttribute('data-rtl-smart-ui')) return null;  // our own floating UI
    if (el.shadowRoot) return el.shadowRoot;  // open root
    if (!el.localName.includes('-')) return null;
    try {
      return (chrome.dom && chrome.dom.openOrClosedShadowRoot(el)) || null;  // closed root
    } catch { return null; }
  }

  // Register new shadow roots inside `start` (nested too) and return them
  function discoverShadowRoots(start) {
    const fresh = [];
    if (!SUPPORT_SHADOW_DOM) return fresh;

    const queue = [start];
    while (queue.length) {
      const root = queue.pop();
      const visit = (el) => {
        const sr = getShadowRoot(el);
        if (sr) {
          if (!shadowRoots.has(sr)) {
            shadowRoots.add(sr);
            observeRoot(sr);
            fresh.push(sr);
            queue.push(sr);
          }
        } else if (el.localName.includes('-') && retryHosts.length < MAX_RETRY_LIST) {
          retryHosts.push({ el, tries: 0 });
        }
      };
      if (root.nodeType === 1) visit(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) visit(n);
    }
    scheduleRetry();
    return fresh;
  }

  // Components often attach their root a moment after being added
  function scheduleRetry() {
    if (retryTimer || !retryHosts.length || !observer) return;
    retryTimer = setTimeout(() => { retryTimer = null; retryPass(); }, 1000);
  }

  function retryPass() {
    const batch = retryHosts.splice(0, 500);
    visited = new Set();
    try {
      for (const entry of batch) {
        if (!entry.el.isConnected) continue;
        const sr = getShadowRoot(entry.el);
        if (!sr) {
          if (++entry.tries < MAX_RETRY_TRIES) retryHosts.push(entry);
          continue;
        }
        if (shadowRoots.has(sr)) continue;
        shadowRoots.add(sr);
        observeRoot(sr);
        const nested = discoverShadowRoots(sr);
        processNode(sr, true, false);
        for (const r of nested) processNode(r, true, false);
      }
    } finally {
      visited = null;
    }
    scheduleRetry();
  }

  function pruneRoots() {
    for (const r of shadowRoots) if (!r.host.isConnected) shadowRoots.delete(r);
  }

  // --- Apply / remove ---

  const RTL_MARKED = '[data-rtl-smart-applied="true"][dir="rtl"], [data-rtl-smart-rule="rtl"]';
  const ALL_MARKED = '[data-rtl-smart-applied="true"], [data-rtl-smart-rule]';

  // RTL elements right now (the popup shows this)
  function countRtl() {
    let n = document.querySelectorAll(RTL_MARKED).length;
    for (const r of shadowRoots) n += r.querySelectorAll(RTL_MARKED).length;
    return n;
  }

  // Elements already handled in this incremental pass
  let visited = null;
  function firstVisit(el) {
    if (!visited) return true;
    if (visited.has(el)) return false;
    visited.add(el);
    return true;
  }

  // Lists / tables: direction from all their content
  function processContainer(box) {
    if (!firstVisit(box)) return;
    if (shouldSkip(box)) return;
    if (isLayoutTable(box)) return;
    const current = isMarked(box) ? box.getAttribute('dir') : null;
    const dir = detectDir(textForDetection(box), current);
    if (!dir) return;
    if (box.getAttribute('dir') !== dir) box.setAttribute('dir', dir);
    box.dataset.rtlSmartApplied = 'true';
  }

  // Text blocks
  function processBlock(el) {
    if (!firstVisit(el)) return;
    if (shouldSkip(el)) return;
    if (!isLeafTextBlock(el)) return;
    setDir(el);
  }

  // Process a node. deep: everything inside it. up: ancestors that depend on it.
  function processNode(node, deep, up) {
    if (node.nodeType === 1) {
      if (node.matches(CONTAINER_SELECTOR)) processContainer(node);
      if (node.matches(TARGET_SELECTOR)) processBlock(node);
    }
    if (deep) {
      node.querySelectorAll(CONTAINER_SELECTOR).forEach(processContainer);
      node.querySelectorAll(TARGET_SELECTOR).forEach(processBlock);
    }
    if (up && node.nodeType === 1) {
      for (let a = parentOf(node); a; a = parentOf(a)) {
        if (a.matches(CONTAINER_SELECTOR)) processContainer(a);
        if (a.matches(TARGET_SELECTOR)) processBlock(a);
      }
    }
  }

  // Full pass: startup, settings change, or a huge burst
  function applyAutoDir() {
    visited = null;
    processNode(document, true, false);
    discoverShadowRoots(document);
    for (const root of shadowRoots) processNode(root, true, false);

    // Manual rules win
    applyRules();
    pruneRoots();
  }

  function applyRuleTo(el, rule) {
    if (el.dataset.rtlSmartRule === rule.dir) return;

    // Remember the site's own dir once
    if (!('rtlSmartOldDir' in el.dataset)) {
      el.dataset.rtlSmartOldDir = isMarked(el) ? '' : (el.getAttribute('dir') || '');
    }
    el.setAttribute('dir', rule.dir);
    el.dataset.rtlSmartRule = rule.dir;
    if (FIX_TEXT_ALIGN) fixAlign(el);
  }

  // Rules over the whole document
  function applyRules() {
    for (const rule of rules) {
      let nodes;
      try { nodes = document.querySelectorAll(rule.selector); }
      catch { continue; }  // invalid selector: ignore
      nodes.forEach((el) => applyRuleTo(el, rule));
    }
  }

  // Rules inside a newly added subtree
  function applyRulesIn(root) {
    for (const rule of rules) {
      try {
        if (root.matches(rule.selector)) applyRuleTo(root, rule);
        root.querySelectorAll(rule.selector).forEach((el) => applyRuleTo(el, rule));
      } catch { /* invalid selector: ignore */ }
    }
  }

  // Remove manual-rule effects only
  function clearRuled() {
    document.querySelectorAll('[data-rtl-smart-rule]').forEach(restoreEl);
  }

  // Remove everything we added
  function removeAutoDir() {
    document.querySelectorAll(ALL_MARKED).forEach(restoreEl);
    for (const r of shadowRoots) r.querySelectorAll(ALL_MARKED).forEach(restoreEl);
    shadowRoots.clear();
    retryHosts.length = 0;
  }

  // --- Observer: only changed nodes are re-checked ---

  const OBSERVE_OPTS = {
    childList: true,  // elements added/removed
    characterData: true,  // text changed (streaming)
    subtree: true
  };
  const MAX_DIRTY = 3000;  // a bigger burst falls back to one full pass

  let timer = null;
  let lastRun = 0;
  let observer = null;
  const addedNodes = new Set();  // new elements: process them and everything inside
  const touchedNodes = new Set();  // elements whose children / text changed
  let needFull = false;

  // Record what changed (no DOM queries here)
  function onMutations(records) {
    for (const m of records) {
      if (m.type === 'characterData') {
        const p = parentOf(m.target);
        if (p) touchedNodes.add(p);
        continue;
      }
      if (m.target.nodeType === 1) touchedNodes.add(m.target);
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) addedNodes.add(n);
      }
    }
    if (addedNodes.size + touchedNodes.size > MAX_DIRTY) {
      needFull = true;
      addedNodes.clear();
      touchedNodes.clear();
    }
    scheduleApply();
  }

  // Throttle: first change runs now, then at most once per THROTTLE_MS (a debounce could starve)
  function scheduleApply() {
    if (timer) return;
    const wait = Math.max(0, THROTTLE_MS - (performance.now() - lastRun));
    timer = setTimeout(() => {
      timer = null;
      lastRun = performance.now();
      applyDirty();
    }, wait);
  }

  function applyDirty() {
    if (needFull) {
      needFull = false;
      addedNodes.clear();
      touchedNodes.clear();
      applyAutoDir();
      return;
    }

    const added = [...addedNodes];
    const touched = [...touchedNodes];
    addedNodes.clear();
    touchedNodes.clear();

    // A new subtree already covers the elements inside it
    const addedSet = new Set(added);
    const roots = added.filter((el) => {
      for (let a = parentOf(el); a; a = parentOf(a)) if (addedSet.has(a)) return false;
      return true;
    });

    visited = new Set();
    try {
      for (const el of roots) {
        if (!el.isConnected) continue;
        const fresh = discoverShadowRoots(el);
        processNode(el, true, true);
        applyRulesIn(el);
        for (const r of fresh) processNode(r, true, false);
      }
      for (const el of touched) {
        if (el.isConnected) processNode(el, false, true);
      }
    } finally {
      visited = null;
    }
    pruneRoots();
  }

  function observeRoot(root) {
    if (observer) observer.observe(root, OBSERVE_OPTS);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, OBSERVE_OPTS);
    for (const r of shadowRoots) observer.observe(r, OBSERVE_OPTS);
    scheduleRetry();
  }

  function stopObserver() {
    clearTimeout(timer);
    timer = null;
    clearTimeout(retryTimer);
    retryTimer = null;
    addedNodes.clear();
    touchedNodes.clear();
    needFull = false;
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  // --- State sync ---

  async function syncState() {
    const { enabled, disabledSites = [], rules: allRules = {} } =
      await chrome.storage.local.get(['enabled', 'disabledSites', 'rules']);

    rules = allRules[HOST] || [];

    // Active only if enabled and the site isn't disabled
    const active = enabled !== false && !disabledSites.includes(HOST);

    if (active) {
      clearRuled();  // drop old rule effects, then re-apply current rules
      applyAutoDir();
      startObserver();
    } else {
      stopObserver();
      removeAutoDir();
    }
  }

  syncState();

  // Fires in every tab when storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled || changes.disabledSites || changes.rules) syncState();
    if (changes.scrollBtn || changes.lang || changes.fabPos || changes.theme) syncScrollBtn();
  });

  // --- Rule selector builder ---
  // Uses only stable hooks; returns null rather than guess.

  const STABLE_ATTRS = ['data-testid', 'data-message-author-role', 'role'];
  const STABLE_CLASS = /^[a-zA-Z][a-zA-Z-]{2,24}$/;  // letters/hyphens only: no hashes or digits
  const STABLE_VALUE = /^[\w-]{1,40}$/;

  function stablePart(el) {
    const tag = el.tagName.toLowerCase();

    if (el.id && STABLE_VALUE.test(el.id) && !/\d{3,}/.test(el.id)) {
      return { sel: `${tag}#${CSS.escape(el.id)}`, hook: true };
    }

    for (const attr of STABLE_ATTRS) {
      const v = el.getAttribute(attr);
      if (v && STABLE_VALUE.test(v) && !/\d{3,}/.test(v)) {
        return { sel: `${tag}[${attr}="${v}"]`, hook: true };
      }
    }

    const classes = [...el.classList].filter((c) => STABLE_CLASS.test(c)).slice(0, 2);
    if (classes.length) {
      return { sel: tag + classes.map((c) => '.' + CSS.escape(c)).join(''), hook: true };
    }

    return { sel: tag, hook: false };
  }

  // Climb up to 4 levels for a stable, not-too-broad selector
  function buildSelector(el) {
    const parts = [];
    let hook = false;
    let cur = el;

    for (let depth = 0;
      depth < 4 && cur && cur !== document.body && cur !== document.documentElement;
      depth++) {
      const p = stablePart(cur);
      parts.unshift(p.sel);
      hook = hook || p.hook;

      if (hook) {
        const sel = parts.join(' > ');
        try {
          const found = document.querySelectorAll(sel);
          if (found.length <= 300 && [...found].includes(el)) return sel;
        } catch { /* invalid selector: keep climbing */ }
      }
      cur = cur.parentElement;
    }
    return null;
  }

  async function saveRule(el, selector, dir) {
    const { rules: all = {} } = await chrome.storage.local.get('rules');
    let list = all[HOST] || [];

    // Drop rules that already target this element
    list = list.filter((r) => r.selector !== selector && !safeMatches(el, r.selector));
    if (dir !== 'auto') list.push({ selector, dir });

    if (list.length) all[HOST] = list;
    else delete all[HOST];
    await chrome.storage.local.set({ rules: all });
  }

  // --- Manual picker UI (closed shadow root) ---

  const UI = {
    ar: {
      dir: 'rtl',
      hint: 'اضغط على العنصر اللي عايز تصلحه (Esc للإلغاء)',
      rtl: 'RTL (يمين)',
      ltr: 'LTR (شمال)',
      auto: 'تلقائي',
      cancel: 'إلغاء',
      saved: 'تم الحفظ ✓',
      reset: 'رجع تلقائي ✓',
      noRule: 'مقدرتش أعمل قاعدة ثابتة للعنصر ده، جرّب عنصر تاني'
    },
    en: {
      dir: 'ltr',
      hint: 'Click the element you want to fix (Esc to cancel)',
      rtl: 'RTL (right)',
      ltr: 'LTR (left)',
      auto: 'Auto',
      cancel: 'Cancel',
      saved: 'Saved ✓',
      reset: 'Back to auto ✓',
      noRule: "Couldn't build a stable rule for this element, try another one"
    }
  };

  const PICKER_CSS = `
    .box { position: fixed; display: none; box-sizing: border-box;
           border: 2px solid #7c3aed; background: rgba(124,58,237,.12);
           border-radius: 4px; pointer-events: none; }
    .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
            background: #1f2937; color: #fff; padding: 8px 14px; border-radius: 999px;
            font: 13px system-ui, sans-serif; pointer-events: none; white-space: nowrap; }
    .menu { position: fixed; display: flex; flex-direction: column; gap: 6px;
            width: 150px; padding: 8px; background: #fff; border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,.25); pointer-events: auto;
            font: 13px system-ui, sans-serif; }
    .menu button { padding: 8px; border: 1px solid #e5e7eb; border-radius: 8px;
                   background: #fff; color: #1f2937; cursor: pointer; font: inherit; }
    .menu button:hover { background: #f3f4f6; }
    .menu button.cancel { color: #6b7280; border-style: dashed; }
    .menu button.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
    .menu button.primary:hover { background: #4338ca; }
    .menu.dark { background: #232327; box-shadow: 0 8px 24px rgba(0,0,0,.6); }
    .menu.dark button { background: #2e2e33; border-color: #3f3f46; color: #f4f4f5; }
    .menu.dark button:hover { background: #3a3a41; }
    .menu.dark button.cancel { color: #a1a1aa; }
    .menu.dark button.primary { background: #6366f1; border-color: #6366f1; color: #fff; }
    .menu.dark button.primary:hover { background: #4f46e5; }
  `;

  // Saved theme, or the system preference
  function isDark(theme) {
    return theme === 'dark' ||
      (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  let picker = null; // { host, box, hint, menu, hovered, ui, handlers }

  async function startPicker() {
    if (picker) return;
    const { lang, theme } = await chrome.storage.local.get(['lang', 'theme']);
    const ui = UI[lang === 'en' ? 'en' : 'ar'];
    const dark = isDark(theme);

    const host = document.createElement('div');
    host.setAttribute('data-rtl-smart-ui', '1');
    host.style.cssText =
      'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = PICKER_CSS;
    const box = document.createElement('div');
    box.className = 'box';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.style.direction = ui.dir;
    hint.textContent = ui.hint;
    shadow.append(style, box, hint);
    document.documentElement.appendChild(host);

    picker = { host, shadow, box, hint, menu: null, hovered: null, ui, dark, handlers: [] };

    const isOurs = (e) => {
      const path = e.composedPath();
      return path.includes(host) || (fab && path.includes(fab.host));
    };

    // Element to fix: nearest text block, or itself
    const resolveTarget = (t) => {
      if (!(t instanceof Element)) return null;
      if (t === document.body || t === document.documentElement) return null;
      return t.closest(TARGET_SELECTOR) || t;
    };

    const positionBox = (el) => {
      if (!el) { box.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, {
        display: 'block',
        left: r.left + 'px', top: r.top + 'px',
        width: r.width + 'px', height: r.height + 'px'
      });
    };

    const onMove = (e) => {
      if (isOurs(e) || picker.menu) return;  // freeze while the menu is open
      const el = resolveTarget(e.target);
      if (el !== picker.hovered) {
        picker.hovered = el;
        positionBox(el);
      }
    };

    // Block page handlers while picking; a click opens the menu
    const onBlock = (e) => {
      if (isOurs(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'click') return;

      const el = resolveTarget(e.target);
      if (el) openMenu(el, e.clientX, e.clientY);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); stopPicker(); }
    };

    const onScroll = () => positionBox(picker && picker.hovered);

    const add = (type, fn) => {
      window.addEventListener(type, fn, true);
      picker.handlers.push([type, fn]);
    };
    add('mousemove', onMove);
    add('scroll', onScroll);
    add('keydown', onKey);
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click'].forEach((t) => add(t, onBlock));
  }

  function stopPicker() {
    if (!picker) return;
    picker.handlers.forEach(([type, fn]) => window.removeEventListener(type, fn, true));
    picker.host.remove();
    picker = null;
  }

  function openMenu(el, x, y) {
    const { ui, shadow, box, hint } = picker;

    const selector = buildSelector(el);
    if (!selector) {
      // No stable selector: say so
      hint.textContent = ui.noRule;
      setTimeout(() => { if (picker) hint.textContent = ui.hint; }, 2500);
      return;
    }

    if (picker.menu) picker.menu.remove();
    picker.hovered = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: r.left + 'px', top: r.top + 'px',
      width: r.width + 'px', height: r.height + 'px'
    });

    const menu = document.createElement('div');
    menu.className = picker.dark ? 'menu dark' : 'menu';
    menu.style.direction = ui.dir;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - 166)) + 'px';
    menu.style.top = Math.max(8, Math.min(y + 8, window.innerHeight - 170)) + 'px';

    const choose = async (dir) => {
      await saveRule(el, selector, dir);
      if (!picker) return;

      // Show a short message, then leave picking mode
      menu.remove();
      picker.menu = null;
      hint.style.background = '#16a34a';
      hint.textContent = dir === 'auto' ? ui.reset : ui.saved;
      setTimeout(stopPicker, 900);
    };

    const makeBtn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', fn);
      return b;
    };

    menu.append(
      makeBtn(ui.cancel, 'cancel', stopPicker),  // back out without changing anything
      makeBtn(ui.rtl, 'primary', () => choose('rtl')),
      makeBtn(ui.ltr, 'primary', () => choose('ltr')),
      makeBtn(ui.auto, '', () => choose('auto'))
    );
    shadow.appendChild(menu);
    picker.menu = menu;
  }

  // --- Floating scroll button ---
  // Works with window scroll and inner containers (chats). Closed shadow root.

  const SCROLL_TEXT = {
    ar: { top: 'لأعلى الصفحة', bottom: 'لأسفل الصفحة' },
    en: { top: 'Scroll to top', bottom: 'Scroll to bottom' }
  };

  const FAB_CSS = `
    .pill { --bg: #ffffff; --ring: rgba(0,0,0,.12); --line: rgba(0,0,0,.1);
            --icon: #52525b; --hover-bg: rgba(79,70,229,.10); --hover-icon: #4f46e5;
            --shadow: 0 2px 10px rgba(0,0,0,.14);
            position: fixed; right: 18px; bottom: 18px; display: flex;
            flex-direction: column; align-items: center; padding: 2px; border-radius: 999px;
            -webkit-user-select: none; user-select: none;
            background: var(--bg);
            box-shadow: 0 0 0 1px var(--ring), var(--shadow);
            opacity: 0; transform: translateY(8px) scale(var(--s, 1)); pointer-events: none;
            transition: opacity .2s, transform .2s; }
    .pill.dark { --bg: #27272a; --ring: rgba(255,255,255,.22); --line: rgba(255,255,255,.14);
                 --icon: #d4d4d8; --hover-bg: rgba(129,140,248,.2); --hover-icon: #c7d2fe;
                 --shadow: 0 2px 12px rgba(0,0,0,.5); }
    .pill.show { opacity: .94; transform: scale(var(--s, 1)); pointer-events: auto; }
    .pill.show.idle { opacity: .6; }
    .pill.show:hover, .pill.show:focus-within, .pill.dragging { opacity: 1; }
    .pill.dragging, .pill.dragging button { cursor: grabbing; }
    .sep { width: 16px; height: 1px; background: var(--line); }
    button { all: unset; box-sizing: border-box; width: 30px; height: 30px;
             display: flex; align-items: center; justify-content: center;
             border-radius: 50%; color: var(--icon); cursor: pointer;
             transition: background .15s, color .15s, opacity .15s; }
    button:hover { background: var(--hover-bg); color: var(--hover-icon); }
    button:focus-visible { outline: 2px solid var(--hover-icon); outline-offset: -2px; }
    button:disabled { opacity: .35; cursor: default; background: none; color: var(--icon); pointer-events: none; }
    svg { width: 16px; height: 16px; }
  `;

  const ICON_TOP = 'M5 4h14M12 20V9m-6 5 6-5 6 5';
  const ICON_BOTTOM = 'M5 20h14M12 4v11m-6-5 6 5 6-5';

  // Less scrollable distance than this = nothing to scroll
  const SCROLL_MIN = 200;

  let fab = null;  // { host, pill, up, down, onScroll, blockMenu, ro, pos, saved, zoom }
  let activeScroller = null; // container that scrolls the page (window or inner)
  let rafPending = false;

  function makeIcon(pathData) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
  }

  function pageScroller() {
    return document.scrollingElement || document.documentElement;
  }

  // Big and really scrollable
  function isBigScroller(el) {
    return el.clientHeight >= window.innerHeight * 0.4 &&
      el.clientWidth >= window.innerWidth * 0.3 &&
      el.scrollHeight - el.clientHeight > SCROLL_MIN;
  }

  // Largest inner scroller (walks the DOM: on demand only)
  function scanInnerScroller() {
    let best = null;
    let bestArea = 0;
    for (const el of document.body.querySelectorAll('*')) {
      if (!isBigScroller(el)) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    return best;
  }

  // scan = also look for an inner scroller (walks the DOM)
  function currentScroller(scan = false) {
    if (activeScroller && (activeScroller === pageScroller() || activeScroller.isConnected) &&
      isBigScroller(activeScroller)) {
      return activeScroller;
    }
    const page = pageScroller();
    if (page.scrollHeight - page.clientHeight > SCROLL_MIN) return page;
    activeScroller = scan ? scanInnerScroller() : null;
    return activeScroller;
  }

  function updateFab() {
    if (!fab) return;
    const sc = currentScroller();
    const max = sc ? sc.scrollHeight - sc.clientHeight : 0;
    const scrollable = !!sc && max > SCROLL_MIN;

    // Always visible; dimmed when nothing scrolls
    fab.pill.classList.add('show');
    fab.pill.classList.toggle('idle', !scrollable);
    fab.up.disabled = !scrollable || sc.scrollTop < 20;
    fab.down.disabled = !scrollable || max - sc.scrollTop < 20;
  }

  let edgeRun = 0;

  // Instant jump, re-checked for ~2s (lazy content changes the height)
  function scrollToEdge(toTop) {
    const run = ++edgeRun;
    let first = true;
    const started = performance.now();
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((t) =>
      window.addEventListener(t, cancel, { capture: true, once: true, passive: true }));

    const step = () => {
      if (cancelled || run !== edgeRun) return;
      const sc = currentScroller(first);  // scan for an inner scroller on the first try only
      first = false;
      if (!sc) return;
      const max = sc.scrollHeight - sc.clientHeight;
      const done = toTop ? sc.scrollTop <= 1 : max - sc.scrollTop <= 1;
      sc.scrollTo({ top: toTop ? 0 : sc.scrollHeight, behavior: 'instant' });
      if (done || performance.now() - started > 2000) return;
      setTimeout(step, 120);
    };
    step();
  }

  // Position: nearest corner + distance in screen px, counter-scaled by browser zoom,
  // so resizing or zooming keeps the button in the same spot and size.
  const FAB_EDGE = 4;  // min gap to the edges (screen px)
  const DEFAULT_POS = { ax: 'r', x: 18, ay: 'b', y: 18 };
  let lastZoom = 1;

  // Zoom comes from the background worker (chrome.tabs.getZoom)
  function setZoom(z) {
    if (!Number.isFinite(z) || z < 0.1 || z > 10 || z === lastZoom) return;
    lastZoom = z;
    applyFab();
  }
  function requestZoom() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_ZOOM' })
        .then((res) => { if (res) setZoom(res.zoom); })
        .catch(() => { });
    } catch { /* extension was reloaded */ }
  }

  // Place the button ox / oy px from its edges (clamped)
  function placeFab(ax, ox, ay, oy) {
    const pill = fab.pill;
    const inv = 1 / fab.zoom;
    const vw = pill.offsetWidth * inv;
    const vh = pill.offsetHeight * inv;
    const edge = FAB_EDGE * inv;
    const W = fab.host.offsetWidth;
    const H = fab.host.offsetHeight;
    ox = Math.min(Math.max(edge, ox), Math.max(edge, W - vw - edge));
    oy = Math.min(Math.max(edge, oy), Math.max(edge, H - vh - edge));

    const s = pill.style;
    s.left = ax === 'l' ? ox + 'px' : 'auto';
    s.right = ax === 'r' ? ox + 'px' : 'auto';
    s.top = ay === 't' ? oy + 'px' : 'auto';
    s.bottom = ay === 'b' ? oy + 'px' : 'auto';
    s.transformOrigin = (ax === 'l' ? 'left' : 'right') + ' ' + (ay === 't' ? 'top' : 'bottom');
    s.setProperty('--s', String(inv));
    fab.pos = { ax, ox, ay, oy };
  }

  // Saved screen px -> CSS px for the current zoom
  function applyFab() {
    if (!fab) return;
    fab.zoom = lastZoom;
    const p = fab.saved || DEFAULT_POS;
    const inv = 1 / fab.zoom;
    placeFab(p.ax, p.x * inv, p.ay, p.y * inv);
  }

  // Current position -> nearest corner + screen px
  function currentToSaved() {
    const r = fab.pill.getBoundingClientRect();
    const W = fab.host.offsetWidth;
    const H = fab.host.offsetHeight;
    const ax = (r.left + r.right) / 2 > W / 2 ? 'r' : 'l';
    const ay = (r.top + r.bottom) / 2 > H / 2 ? 'b' : 't';
    return {
      ax, x: (ax === 'r' ? W - r.right : r.left) * fab.zoom,
      ay, y: (ay === 'b' ? H - r.bottom : r.top) * fab.zoom
    };
  }

  // Validate what is in storage
  function parseSaved(p) {
    if (p && (p.ax === 'l' || p.ax === 'r') && (p.ay === 't' || p.ay === 'b') &&
      Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return { ax: p.ax, x: p.x, ay: p.ay, y: p.y };
    }
    return null;
  }

  function createFab() {
    const host = document.createElement('div');
    host.setAttribute('data-rtl-smart-ui', '1');
    host.style.cssText =
      'all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = FAB_CSS;

    const pill = document.createElement('div');
    pill.className = 'pill';

    const makeBtn = (icon, toTop) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.appendChild(makeIcon(icon));
      b.addEventListener('click', () => scrollToEdge(toTop));
      return b;
    };
    const up = makeBtn(ICON_TOP, true);
    const down = makeBtn(ICON_BOTTOM, false);
    const sep = document.createElement('div');
    sep.className = 'sep';
    pill.append(up, sep, down);

    // Move only while the RIGHT button is held; window events keep it working off the button
    let drag = null;

    const onMouseMove = (e) => {
      if (!drag) return;
      if (!(e.buttons & 2)) { endDrag(); return; }  // button released where we missed it
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      placeFab(
        drag.ax, drag.ax === 'r' ? drag.ox - dx : drag.ox + dx,
        drag.ay, drag.ay === 'b' ? drag.oy - dy : drag.oy + dy
      );
    };
    const onMouseUp = (e) => { if (e.button === 2) endDrag(); };

    function endDrag() {
      if (!drag) return;
      drag = null;
      pill.classList.remove('dragging');
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('blur', endDrag);
      fab.saved = currentToSaved();  // nearest corner + screen px
      applyFab();
      chrome.storage.local.set({ fabPos: fab.saved });  // shared by every tab
    }

    pill.addEventListener('mousedown', (e) => {
      if (e.button !== 2 || !fab || !fab.pos) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, ...fab.pos };
      pill.classList.add('dragging');
      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('mouseup', onMouseUp, true);
      window.addEventListener('blur', endDrag);
    });

    // No context menu on the button (also caught on window)
    const blockMenu = (e) => {
      if (drag || e.composedPath().includes(host)) e.preventDefault();
    };
    pill.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('contextmenu', blockMenu, true);

    shadow.append(style, pill);
    document.documentElement.appendChild(host);

    // Scrolling or resizing refreshes the button
    const onScroll = (e) => {
      if (e.type === 'resize' && fab) { applyFab(); requestZoom(); }  // window resize or browser zoom
      const t = e.target === document ? pageScroller() : e.target;
      if (t instanceof Element && t !== activeScroller && isBigScroller(t)) {
        activeScroller = t;
      }
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; updateFab(); });
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    // Content loading changes the height
    const ro = new ResizeObserver(() => onScroll({}));
    ro.observe(document.documentElement);

    fab = { host, pill, up, down, onScroll, blockMenu, ro, pos: null, saved: null, zoom: lastZoom };
    requestZoom();

    // Chats scroll an inner container: look once
    setTimeout(() => {
      if (fab && !activeScroller) { currentScroller(true); updateFab(); }
    }, 1500);
  }

  function removeFab() {
    if (!fab) return;
    window.removeEventListener('scroll', fab.onScroll, true);
    window.removeEventListener('resize', fab.onScroll);
    window.removeEventListener('contextmenu', fab.blockMenu, true);
    fab.ro.disconnect();
    fab.host.remove();
    fab = null;
    activeScroller = null;
  }

  async function syncScrollBtn() {
    const { scrollBtn, lang, fabPos, theme } =
      await chrome.storage.local.get(['scrollBtn', 'lang', 'fabPos', 'theme']);
    if (scrollBtn === false) { removeFab(); return; }

    if (!fab) createFab();

    fab.pill.classList.toggle('dark', isDark(theme));

    // Saved position (shared by tabs); not during a drag
    if (!fab.pill.classList.contains('dragging')) {
      fab.saved = parseSaved(fabPos);
      applyFab();
    }
    const text = SCROLL_TEXT[lang === 'en' ? 'en' : 'ar'];
    fab.up.title = text.top;
    fab.up.setAttribute('aria-label', text.top);
    fab.down.title = text.bottom;
    fab.down.setAttribute('aria-label', text.bottom);
    updateFab();
  }

  syncScrollBtn();

  // Messages from the popup / background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'START_PICKER') {
      startPicker();
      sendResponse({ ok: true });
    } else if (msg.type === 'GET_COUNT') {
      sendResponse({ count: countRtl() });
    } else if (msg.type === 'ZOOM') {
      setZoom(msg.zoom);
    }
  });
})();
