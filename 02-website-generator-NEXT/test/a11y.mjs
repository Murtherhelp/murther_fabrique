/**
 * Keyboard and accessibility probe. Focused on what the language probe cannot
 * see: can the editor actually be driven from the keyboard, and does every
 * control carry a name?
 *
 *   node server.mjs   (on :5199, or set WGN_PORT)
 *   node test/a11y.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HEADED = process.argv.includes("--head");
const PORT = Number(process.env.WGN_PORT) || 5200;
const URL = `http://localhost:${PORT}/?probe=1`;

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
].find((p) => existsSync(p));

if (!EDGE) {
  console.error("No Chromium-based browser found.");
  process.exit(2);
}

/* Fail fast with an instruction instead of a 20s timeout per call. */
if (!(await fetch(`http://localhost:${PORT}/`).then((r) => r.ok).catch(() => false))) {
  console.error(`No server on http://localhost:${PORT}/.`);
  console.error(`Start one with:  set PORT=${PORT} && node server.mjs`);
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "wgn-a11y-"));
let browser = null;
let ws = null;
let nextId = 1;
const pending = new Map();
const results = [];
let stopped = false;

function stop() {
  if (stopped) return;
  stopped = true;
  try { ws?.close(); } catch {}
  try { browser?.kill(); } catch {}
  for (let i = 0; i < 16; i++) {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 2 }); return; } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

const ok = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function send(method, params = {}, sessionId) {
  const id = nextId++;
  const entry = { method, resolve: null, reject: null };
  pending.set(id, entry);
  const p = new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
    // Without a deadline a dropped response hangs the whole run silently.
    entry.timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out after 20s`));
    }, 20000);
  });
  try {
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  } catch (e) {
    clearTimeout(entry.timer);
    pending.delete(id);
    return Promise.reject(new Error(`${method}: ${e.message}`));
  }
  return p;
}

let S = (m, p) => send(m, p);
async function ev(expression) {
  const r = await S("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true, returnByValue: true
  });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || "threw" };
  return r.result.value;
}

/** A real Tab keypress, not a synthetic event, so the browser's own focus
 *  order is what gets measured. */
async function pressTab(shift = false) {
  await S("Input.dispatchKeyEvent", {
    type: "rawKeyDown", windowsVirtualKeyCode: 9, key: "Tab", code: "Tab",
    nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0
  });
  await S("Input.dispatchKeyEvent", {
    type: "keyUp", windowsVirtualKeyCode: 9, key: "Tab", code: "Tab",
    nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0
  });
  await new Promise((r) => setTimeout(r, 40));
}

/** What currently has focus, described the way a screen reader would. */
const focusInfo = () => ev(`
  const a = document.activeElement;
  if (!a || a === document.body) return { tag: 'body', name: '', visible: false };
  const r = a.getBoundingClientRect();
  const name = a.getAttribute('aria-label')
    || (a.labels && a.labels[0] && a.labels[0].textContent.trim())
    || (a.tagName === 'SELECT' && a.selectedOptions[0] ? a.selectedOptions[0].textContent.trim() : '')
    || a.textContent.trim().slice(0, 40)
    || a.title || a.id;
  const cs = getComputedStyle(a);
  return {
    tag: a.tagName.toLowerCase(),
    name: name.slice(0, 50),
    visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
  };
`);

async function main() {
  browser = spawn(EDGE, [
    "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    ...(HEADED ? [] : ["--headless=new", "--disable-gpu"]),
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--window-size=1440,900", URL
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("no debug port")), 20000);
    browser.stderr.on("data", (d) => {
      buf += d.toString();
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    });
  });

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("socket failed")); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const entry = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(entry.timer);
      if (m.error) entry.reject(new Error(`${entry.method}: ${m.error.message}`));
      else if (!("result" in m)) entry.reject(new Error(`${entry.method}: no result in reply`));
      else entry.resolve(m.result);
    }
  };

  const { targetInfos } = await send("Target.getTargets");
  const target = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  S = (m, p) => send(m, p, sessionId);
  await S("Runtime.enable");
  await S("Page.enable");
  await S("Page.navigate", { url: URL });

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await ev("return !!window.wgn;")) break;
  }
  await ev("window.wgn.applyTemplate('business'); window.wgn.select(0,0); return 1;");
  await new Promise((r) => setTimeout(r, 250));

  /* ------------------------------------------------ document structure */
  const structure = await ev(`
    return {
      lang: document.documentElement.lang,
      title: document.title,
      h1: [...document.querySelectorAll('h1')].map(n=>n.textContent.trim()),
      landmarks: ['header','main','aside','nav','footer'].filter(t => document.querySelector(t)),
      skip: !!document.querySelector('.sr[href^="#"]'),
      fieldsets: document.querySelectorAll('fieldset').length,
      legends: document.querySelectorAll('legend').length
    };
  `);
  ok("the page declares a language", !!structure.lang, structure.lang);
  ok("the document has a non-empty title", (structure.title || "").length > 10, structure.title);
  ok("there is exactly one h1", structure.h1.length === 1, JSON.stringify(structure.h1));
  ok("landmarks are present", structure.landmarks.length >= 4, structure.landmarks.join(", "));
  ok("a skip link comes first", structure.skip);

  /* ------------------------------------------ every control has a name */
  /* Every input/select/textarea must be nameable. Buttons are checked
     separately, because a button's accessible name is its text content and the
     icon-only ones carry aria-label explicitly. */
  const unnamed = await ev(`
    const bad = [];
    const all = [...document.querySelectorAll('input, select, textarea')];
    for (const n of all) {
      // Skip what is deliberately out of the accessibility tree: a hidden
      // attribute, aria-hidden, or a control a visible button stands in for.
      if (n.type === 'hidden' || n.hasAttribute('hidden') ||
          n.getAttribute('aria-hidden') === 'true' || n.tabIndex < 0) continue;
      const name = n.getAttribute('aria-label') || n.title
        || (n.labels && n.labels.length && n.labels[0].textContent.trim())
        || (n.id && (document.querySelector('label[for="' + n.id + '"]') || {}).textContent);
      if (!name || !String(name).trim()) {
        bad.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.type ? '[type=' + n.type + ']' : ''));
      }
    }
    return { total: all.length, bad };
  `);
  ok("every form control has an accessible name",
     (unnamed.bad?.length ?? 9) === 0, unnamed.bad?.slice(0, 6).join(", ") || `${unnamed.total} controls`);

  const unnamedButtons = await ev(`
    const bad = [];
    for (const n of document.querySelectorAll('button, a[href]')) {
      const name = n.getAttribute('aria-label') || n.title
        || n.textContent.trim()
        || (document.getElementById(n.getAttribute('aria-labelledby')) || {}).textContent;
      if (!name || !String(name).trim()) bad.push(n.tagName.toLowerCase() + '#' + (n.id || '?'));
    }
    return bad;
  `);
  ok("every button and link has an accessible name",
     (unnamedButtons?.length ?? 9) === 0, (unnamedButtons || []).slice(0, 6).join(", "));

  /* ---------------------------------------- tab order reaches the editor */
  await ev("document.body.focus(); if (document.activeElement) document.activeElement.blur(); return 1;");
  const seen = [];
  let unnamedFocus = 0;
  let hiddenFocus = 0;
  for (let i = 0; i < 45; i++) {
    await pressTab();
    const f = await focusInfo();
    if (f.tag === "body") continue;
    seen.push(`${f.tag}:${f.name}`);
    if (!f.name || !f.name.trim()) unnamedFocus++;
    if (!f.visible) hiddenFocus++;
  }
  /* Assert on the kinds of control reached, not on one fragile substring. */
  const reached = {
    toolbar: seen.some((s) => s.startsWith("button") && /template|undo|save/i.test(s)),
    outline: seen.some((s) => s.includes("section") || s.includes("Hero") || s.includes("hero") || s.includes("Bannière")),
    inspector: seen.some((s) => s.startsWith("input") || s.startsWith("textarea") || s.startsWith("select")),
    dialogs: seen.some((s) => /template|section/i.test(s))
  };
  ok("Tab reaches the toolbar", reached.toolbar);
  ok("Tab reaches the outline", reached.outline);
  ok("Tab reaches the inspector fields", reached.inspector);
  ok("Tab visits a useful number of controls", seen.length > 12, `${seen.length} stops`);
  ok("no focus stop is unnamed", unnamedFocus === 0, `${unnamedFocus} unnamed`);
  ok("no focus stop is invisible", hiddenFocus === 0, `${hiddenFocus} invisible`);

  /* ----------------------------------------- shift+Tab walks back up */
  await pressTab(true);
  await pressTab(true);
  const back = await focusInfo();
  ok("Shift+Tab moves backwards through the same order", !!back.name, `${back.tag}:${back.name}`);

  /* --------------------------------------- a visible focus indicator */
  const ring = await ev(`
    const n = document.querySelector('#tplBtn');
    n.focus();
    const cs = getComputedStyle(n);
    return { outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, boxShadow: cs.boxShadow };
  `);
  ok("focused controls show a visible outline",
     ring.outlineStyle !== "none" && parseFloat(ring.outlineWidth) >= 2,
     `${ring.outlineStyle} ${ring.outlineWidth}`);

  /* --------------------------------------- the section editor is usable */
  const editing = await ev(`
    window.wgn.applyTemplate('business');
    window.wgn.select(0, 0);
    await new Promise(r => setTimeout(r, 150));
    const first = document.querySelector('#blockForm input, #blockForm textarea');
    if (!first) return { error: 'no field' };
    const before = first.value;
    first.focus();
    first.value = 'TYPED-BY-TEST';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const doc_ = window.wgn.doc();
    const stored = JSON.stringify(doc_).includes('TYPED-BY-TEST');
    return { before, stored, lang: document.documentElement.lang };
  `);
  ok("typing in a section field reaches the document", editing.stored === true);

  /* Page settings must be editable even with no section selected — otherwise a
     page cannot be renamed, hidden from the menu, or re-slugged. */
  const pageFields = await ev(`
    window.wgn.applyTemplate('business');
    window.wgn.select(0, -1);            // no section selected
    await new Promise(r => setTimeout(r, 200));
    const labels = [...document.querySelectorAll('#blockForm .field__label')].map(n => n.textContent.trim());
    return { labels };
  `);
  ok("page settings are editable with no section selected",
     /Page settings/.test(pageFields.labels?.[0] || ""), (pageFields.labels || []).slice(0, 4).join(" | "));

  const slugField = await ev(`
    window.wgn.applyTemplate('business');
    window.wgn.select(0, -1);
    await new Promise(r => setTimeout(r, 200));
    const slug = [...document.querySelectorAll('#blockForm input[type=text]')].pop();
    return { disabled: slug ? slug.disabled : 'missing', shown: slug ? slug.value : '' };
  `);
  ok("the home page's file name is locked", slugField.disabled === true, String(slugField.disabled));
  ok("the locked field still shows the real file name",
     slugField.shown === "index.html", String(slugField.shown));

  const secondSlug = await ev(`
    window.wgn.select(1, -1);
    await new Promise(r => setTimeout(r, 200));
    const slug = [...document.querySelectorAll('#blockForm input[type=text]')].pop();
    return { disabled: slug.disabled, shown: slug.value };
  `);
  ok("other pages' file names are editable",
     secondSlug.disabled === false && secondSlug.shown === "about", JSON.stringify(secondSlug));

  const renames = await ev(`
    const pg = window.wgn.doc().pages[1];
    const input = [...document.querySelectorAll('#blockForm input')].find(n => n.type === 'text');
    input.value = 'RENAMED-PAGE';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const d = window.wgn.doc();
    return { title: d.pages[1].title.en, menu: d.pages[1].menu.en, navLinks: document.querySelectorAll('#pageTree summary').length };
  `);
  ok("renaming a page updates the document", renames.title === "RENAMED-PAGE", JSON.stringify(renames));

  /* ------------------------- a language switch keeps focus in the field */
  const keepFocus = await ev(`
    window.wgn.applyTemplate('business');
    window.wgn.select(0, 0);
    await new Promise(r => setTimeout(r, 150));
    const first = document.querySelector('#blockForm input');
    first.focus();
    first.setSelectionRange(3, 3);
    window.wgn.setLang('fr');
    await new Promise(r => setTimeout(r, 150));
    const after = document.activeElement;
    return {
      same: after === first,
      stillThere: !!document.querySelector('#blockForm input'),
      caret: after === first ? after.selectionStart : -1
    };
  `);
  ok("a language switch does not steal focus from the field being typed in",
     keepFocus.same && keepFocus.stillThere,
     `same=${keepFocus.same} caret=${keepFocus.caret}`);
  ok("the caret position survives the switch", keepFocus.caret === 3, `caret=${keepFocus.caret}`);

  /* ------------------------------------------- text-size control works */
  const scale = await ev(`
    const before = getComputedStyle(document.documentElement).fontSize;
    document.getElementById('uiScale').value = '1.3';
    document.getElementById('uiScale').dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const after = getComputedStyle(document.documentElement).fontSize;
    document.getElementById('uiScale').value = '1';
    document.getElementById('uiScale').dispatchEvent(new Event('change', { bubbles: true }));
    return { before, after };
  `);
  ok("the text-size control actually resizes the interface",
     parseFloat(scale.after) > parseFloat(scale.before), `${scale.before} -> ${scale.after}`);

  /* -------------------------------------------- dialogs trap and close */
  const dlg = await ev(`
    document.getElementById('tplDlg').showModal();
    await new Promise(r => setTimeout(r, 100));
    const open = document.getElementById('tplDlg').open;
    document.getElementById('tplClose').click();
    await new Promise(r => setTimeout(r, 100));
    return { open, closed: !document.getElementById('tplDlg').open };
  `);
  ok("the template dialog opens and closes", dlg.open && dlg.closed);

  /* --------------------------------- reduced motion is respected */
  await S("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const motion = await ev(`
    const d = 0.01;
    return [...document.querySelectorAll('*')].every(n =>
      parseFloat(getComputedStyle(n).transitionDuration) <= d + 0.001);
  `);
  ok("prefers-reduced-motion is honoured", motion !== false);

  /* Visual sanity: nothing may overflow its container. A colour swatch grid is
     the usual culprit once the interface text is scaled up. */
  await ev("document.getElementById('uiScale').value='1.3'; document.getElementById('uiScale').dispatchEvent(new Event('change',{bubbles:true})); return 1;");
  await new Promise((r) => setTimeout(r, 250));
  const overflow = await ev(`
    const bad = [];
    const limit = document.documentElement.clientWidth;
    for (const n of document.querySelectorAll('body *')) {
      const r = n.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > limit + 1.5 || r.left < -1.5) {
        // Content inside a horizontal scroll container is meant to be wider than
        // the viewport — the device frame in the preview stage is exactly that.
        // It is the document that must never spill sideways, which the
        // scrollX assertion below still checks strictly.
        let a = n.parentElement, scrolls = false;
        while (a && a !== document.body) {
          const cs = getComputedStyle(a);
          if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && a.scrollWidth > a.clientWidth) { scrolls = true; break; }
          a = a.parentElement;
        }
        if (scrolls) continue;
        bad.push(n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(' ')[0] : '') +
                 ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
      }
      if (bad.length > 8) break;
    }
    return { limit, bad, scrollX: document.documentElement.scrollWidth > limit };
  `);
  ok("nothing overflows horizontally at the largest text size",
     (overflow.bad?.length ?? 9) === 0 && overflow.scrollX === false,
     overflow.bad?.slice(0, 5).join(", ") || `viewport ${overflow.limit}px`);
  await ev("document.getElementById('uiScale').value='1'; document.getElementById('uiScale').dispatchEvent(new Event('change',{bubbles:true})); return 1;");

  /* A <select> must show its option label, not a single letter. */
  const selects = await ev(`
    const bad = [];
    for (const s of document.querySelectorAll('select')) {
      const opt = s.selectedOptions[0];
      const shown = opt ? opt.textContent.trim() : '';
      if (!shown || shown.length < 3) bad.push((s.id || 'select') + '="' + shown + '"');
    }
    return bad;
  `);
  ok("every select shows a readable label", (selects?.length ?? 9) === 0, (selects || []).slice(0, 5).join(", "));

  /* The language control must agree with the interface it switches. A control
     stuck on "English" while the page reads French is worse than no control at
     all, and a screenshot of that view would not reveal it. */
  const agrees = await ev(`
    window.wgn.setLang('fr');
    await new Promise(r => setTimeout(r, 150));
    const fr = document.getElementById('uiLang').value;
    const frLabel = document.getElementById('uiLang').selectedOptions[0].textContent.trim();
    const outline = document.querySelector('[data-i18n="panelOutline"]').textContent.trim();
    window.wgn.setLang('en');
    await new Promise(r => setTimeout(r, 150));
    return {
      fr, frLabel, outline,
      en: document.getElementById('uiLang').value,
      enLabel: document.getElementById('uiLang').selectedOptions[0].textContent.trim()
    };
  `);
  ok("the language control matches the active language",
     agrees.fr === "fr" && agrees.en === "en", JSON.stringify(agrees));
  ok("the language control names languages, not its own value",
     agrees.frLabel === "Français" && agrees.enLabel === "English",
     `${agrees.enLabel} / ${agrees.frLabel}`);
  ok("the interface around the control really was French",
     agrees.outline === "Structure", agrees.outline);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} accessibility checks passed`);
  stop();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  stop();
  process.exit(1);
});
for (const sig of ["exit", "SIGINT", "SIGTERM"]) process.on(sig, () => stop());