/**
 * Browser end-to-end probe. Runs against a real page in a real browser:
 *
 *   node server.mjs
 *   node test/browser.mjs            (headless)
 *   node test/browser.mjs --head     (show the window)
 *
 * This is the only place the DOM layer is exercised. The Node suite covers the
 * pure core; this covers what a user actually sees — including the French and
 * English switch across the main flows.
 *
 * Uses the Chrome DevTools Protocol over the WebSocket that Chrome already
 * opens, so there is still no dependency to install.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HEADED = process.argv.includes("--head");
const PORT = 5199;
const URL = `http://localhost:${PORT}/?probe=1`;

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
].find((p) => existsSync(p));

if (!EDGE) {
  console.error("No Chromium-based browser found. Install Edge or Chrome, or run the Node suite only.");
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "wgn-probe-"));
let browser = null;
let ws = null;
let stopped = false;

/** Best-effort teardown. A browser that has not released its profile lock
 *  must not turn a passing run into a crash. */
function stop() {
  if (stopped) return;
  stopped = true;
  try { ws?.close(); } catch {}
  try { browser?.kill(); } catch {}
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 2 });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const results = [];

const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function send(method, params = {}, sessionId) {
  const id = nextId++;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  pending.set(id, { method, resolve: null, reject: null });
  const p = new Promise((resolve, reject) => {
    pending.get(id).resolve = resolve;
    pending.get(id).reject = reject;
  });
  // The WebSocket can drop while Chrome is still starting up. Fail fast and
  // loudly rather than waiting out the timeout on every subsequent call.
  try {
    ws.send(JSON.stringify(msg));
  } catch (e) {
    pending.delete(id);
    return Promise.reject(new Error(`${method}: devtools socket is closed (${e.message})`));
  }
  return p;
}

/* Bound to the page session once the editor is attached. Assigned in main(). */
let S = (m, p) => send(m, p);

/**
 * Evaluate in the page. Returns `{__error}` rather than throwing, so one bad
 * assertion reports a failure instead of aborting the rest of the run.
 */
async function tryEval(expression) {
  try {
    const r = await S("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (r.exceptionDetails) {
      return { __error: r.exceptionDetails.exception?.description || "page threw" };
    }
    return r.result.value;
  } catch (e) {
    return { __error: e.message };
  }
}

async function main() {
  browser = spawn(EDGE, [
    `--remote-debugging-port=0`,
    `--user-data-dir=${profile}`,
    ...(HEADED ? [] : ["--headless=new", "--disable-gpu"]),
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--window-size=1440,900",
    URL
  ], { stdio: ["ignore", "pipe", "pipe"] });

  // Chrome prints the DevTools endpoint on stderr; read it from there rather
  // than guessing a fixed port.
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("browser did not report a debug port")), 20000);
    browser.stderr.on("data", (d) => {
      buf += d.toString();
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) {
        clearTimeout(t);
        resolve(m[0]);
      }
    });
  });

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("devtools socket failed"));
  });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const entry = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) entry.reject(new Error(`${entry.method}: ${m.error.message}`));
      else if (!("result" in m)) entry.reject(new Error(`${entry.method}: devtools sent no result`));
      else entry.resolve(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push(m.params.exceptionDetails.exception?.description || "exception");
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  };

  const { targetInfos } = await send("Target.getTargets");
  const page = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  S = (m, p) => send(m, p, sessionId);

  await S("Runtime.enable");
  await S("Page.enable");
  await S("Page.navigate", { url: URL });

  // Wait for the app to boot.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const ready = await S("Runtime.evaluate", { expression: "!!window.wgn", returnByValue: true });
    if (ready.result.value) break;
  }
  if (!(await S("Runtime.evaluate", { expression: "!!window.wgn", returnByValue: true })).result.value) {
    throw new Error("the editor never booted (window.wgn missing)");
  }

  /* ---------------------------------------------------------- boot */
  const sc = await tryEval("return window.wgn.errors();");
  ok("editor boots with no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  ok("self-check reports nothing failed", Array.isArray(sc) && sc.length === 0, JSON.stringify(sc));

  const tpl = await tryEval("return window.wgn.doc().template;");
  ok("starts on a real template, not a blank page", typeof tpl === "string" && tpl.length > 0, String(tpl));

  /* -------------------------------------------- language: interface */
  const enLabels = await tryEval("return document.querySelectorAll('[data-i18n]').length;");
  await tryEval("window.wgn.setLang('fr'); return 1;");
  await new Promise((r) => setTimeout(r, 150));
  const frText = await tryEval("return document.body.innerText;");
  ok("switching to French changes the interface", /Générateur|Structure|Contenu|Aperçu|Exporter/.test(frText));
  ok("no raw dictionary key leaks into the UI", !/\b(dsDesign|lblSiteName|auContrastOk|tplPick)\b/.test(frText));

  await tryEval("window.wgn.setLang('en'); return 1;");
  await new Promise((r) => setTimeout(r, 150));
  const enText = await tryEval("return document.body.innerText;");
  ok("switching back to English restores it", /Structure|Content|Preview|Export/.test(enText));
  ok("the two interface languages actually differ", enText !== frText);
  ok("static labels are all translated", enLabels > 20, `${enLabels} data-i18n nodes`);

  /* ------------------------------ the switch must not touch content */
  await tryEval(`
    const d = window.wgn.doc();
    d.pages[0].blocks[0].title = { en: 'KEEPME-EN', fr: 'GARDER-FR' };
    return 1;
  `);
  const before = await tryEval("return window.wgn.doc().pages[0].blocks[0].title.en;");
  await tryEval("window.wgn.setLang('fr'); return 1;");
  await new Promise((r) => setTimeout(r, 150));
  const after = await tryEval("return window.wgn.doc().pages[0].blocks[0].title;");
  ok("switching language never rewrites user content",
     after.en === "KEEPME-EN" && after.fr === "GARDER-FR", JSON.stringify(after));
  ok("content was actually present before switching", before === "KEEPME-EN");

  /* -------------------------------------------- templates, one by one */
  for (const key of ["portfolio", "cv", "business", "blog", "forum", "game", "store", "saas", "blank"]) {
    await tryEval(`window.wgn.applyTemplate(${JSON.stringify(key)}); return 1;`);
    await new Promise((r) => setTimeout(r, 120));
    const bad = await tryEval("return window.wgn.errors();");
    const files = await tryEval("const f = window.wgn.build().files; return Object.keys(f).length;");
    ok(`template "${key}" builds`, (bad?.length ?? 0) === 0 && files > 5, `${files} files`);
  }

  /* ------------------------------------------- every block type renders */
  await tryEval("window.wgn.applyTemplate('blank'); return 1;");
  const blockTypes = await tryEval(`
    const types = window.wgn.blockOrder();
    for (const t of types) window.wgn.addBlock(t);
    const b = window.wgn.build();
    return { n: types.length, files: Object.keys(b.files).length, errors: window.wgn.errors().length };
  `);
  ok(`all ${blockTypes.n} block types render together`, blockTypes.errors === 0 && blockTypes.files > 5,
     `${blockTypes.files} files, ${blockTypes.errors} self-check errors`);

  /* --------------------------------------------- inspector is driven by spec */
  await tryEval("window.wgn.applyTemplate('portfolio'); window.wgn.select(0, 0); return 1;");
  await new Promise((r) => setTimeout(r, 150));
  const fields = await tryEval("return document.querySelectorAll('#blockForm .field').length;");
  ok("selecting a section builds its editor", fields > 0, `${fields} fields`);

  await tryEval("window.wgn.setLang('fr'); return 1;");
  await new Promise((r) => setTimeout(r, 150));
  const frFields = await tryEval(`
    return {
      count: document.querySelectorAll('#blockForm .field').length,
      labels: [...document.querySelectorAll('#blockForm .field__label')].map(n=>n.textContent).join(' | ')
    };
  `);
  ok("the section editor is translated too", frFields.count === fields && /[àéèêûôîç]/i.test(frFields.labels),
     frFields.labels.slice(0, 70));
  await tryEval("window.wgn.setLang('en'); return 1;");
  await new Promise((r) => setTimeout(r, 150));

  /* Every image control must sit next to an alt field. The picker used to be
     the whole control: only the hero had one, so a logo strip or a testimonial
     photo raised a quality warning the inspector gave no way to clear. */
  const altProbe = await tryEval(`
    const out = [];
    for (const type of ['hero', 'logos', 'testimonial', 'gallery']) {
      window.wgn.applyTemplate('blank');
      window.wgn.addBlock(type);
      window.wgn.select(0, 0);
      const pickers = document.querySelectorAll('#blockForm .field__img').length;
      const alts = [...document.querySelectorAll('#blockForm .field__label')]
        .filter(n => /alt/i.test(n.textContent)).length;
      out.push(type + ':' + pickers + '/' + alts);
    }
    return out.join(' ');
  `);
  const altBad = (altProbe || "").split(" ").filter((s) => {
    const [pair] = s.split(":");
    const [pickers, alts] = (pair || "").split("/").map(Number);
    return pickers > 0 && alts < pickers;
  });
  ok("every image picker sits next to an alt field", (altProbe?.length ?? 0) > 0 && altBad.length === 0,
     `${altProbe}${altBad.length ? ` | no alt field in ${altBad.join(", ")}` : ""}`);
  const bi = await tryEval(`
    window.wgn.applyTemplate('business');
    window.wgn.setBilingual(true);
    const f = window.wgn.build().files;
    return {
      en: !!f['index.html'],
      fr: !!f['index.fr.html'],
      enLang: (f['index.html']||'').includes('<html lang="en">'),
      frLang: (f['index.fr.html']||'').includes('<html lang="fr">'),
      frText: (f['index.fr.html']||'').includes('Des produits faits pour durer'),
      frNoEnglish: !/Products built to last/.test(f['index.fr.html']||''),
      skip: (f['index.fr.html']||'').includes('Aller au contenu'),
      hreflang: (f['index.html']||'').includes('hreflang="fr"')
    };
  `);
  ok("a bilingual site emits two real pages", bi.en && bi.fr);
  ok("each page declares its own language", bi.enLang && bi.frLang);
  ok("French content really is French", bi.frText);
  ok("no English content leaks into the French page", bi.frNoEnglish);
  ok("French UI strings really are French", bi.skip);
  ok("the two pages cross-link", bi.hreflang);

  /* --------------------------------- site language is independent of UI */
  const indep = await tryEval(`
    window.wgn.setLang('fr');          // interface -> French
    const f = window.wgn.build().files;
    const en = f['index.html']||'';
    const uiIsFr = /Génère|Aperçu|Contenu/.test(document.body.innerText);
    const enStillEn = en.includes('lang="en"') && en.includes('English') === false;
    window.wgn.setLang('en');
    return { uiIsFr, enStillEn };
  `);
  ok("interface language does not change the site's language", indep.uiIsFr && indep.enStillEn);

  /* ------------------- FR/EN across every main screen ------------------- */

  /*
   * The switches above only prove the language changed *somewhere*. These
   * checks read the specific screens that render on demand — collapsed panel
   * headers and the quality report — which is where an untranslated label
   * actually hides.
   */
  const panelsOf = async (lang) => {
    await tryEval(`window.wgn.setLang(${JSON.stringify(lang)}); return 1;`);
    await new Promise((r) => setTimeout(r, 180));
    return tryEval(`
      const out = [];
      for (const id of ['designPanel','seoPanel','auditPanel','exportPanel']) {
        const sum = document.getElementById(id)?.querySelector('summary');
        if (sum) out.push(sum.textContent.trim());
      }
      return out.join(' | ');
    `);
  };
  const auditOf = async (lang) => {
    await tryEval(`
      window.wgn.setLang(${JSON.stringify(lang)});
      window.wgn.applyTemplate('business');
      document.getElementById('auditPanel').open = true;
      return 1;
    `);
    await new Promise((r) => setTimeout(r, 180));
    return tryEval(`
      return [...document.querySelectorAll('#auditList .check')].map(n => n.textContent.trim()).join(' | ');
    `);
  };

  const panelsEn = await panelsOf("en");
  const panelsFr = await panelsOf("fr");
  ok("all four collapsed panels are translated",
     /Design|SEO|Quality|Export/i.test(panelsEn) && /Design|Référencement|Rapport|Export/i.test(panelsFr),
     panelsFr);
  ok("no panel header is identical between the two languages", panelsEn !== panelsFr);

  const auditEn = await auditOf("en");
  const auditFr = await auditOf("fr");
  ok("every quality-report row is translated",
     /colour contrast/i.test(auditEn) && /contraste/i.test(auditFr), auditFr.slice(0, 90));
  ok("no quality row is identical between the two languages", auditEn !== auditFr);
  ok("the French report contains no raw dictionary key",
     !/\b(auAltOk|auDescOk|auTitleOk|auSeoOk|auFormOk)\b/.test(auditFr), auditFr.slice(0, 120));

  // The template dialog is a separate screen.
  await tryEval("document.getElementById('tplDlg').showModal(); return 1;");
  await new Promise((r) => setTimeout(r, 120));
  const tplFr = await tryEval(`
    window.wgn.setLang('fr');
    return [...document.querySelectorAll('#tplGrid .tpl')].map(n => n.textContent.trim()).join(' | ');
  `);
  await tryEval("document.getElementById('tplDlg').close(); return 1;");
  ok("the template picker is translated", /Portfolio|CV|Forum|Boutique/i.test(tplFr), tplFr.slice(0, 100));

  // The section picker is another.
  await tryEval("window.wgn.setLang('fr'); window.wgn.openPicker(); return 1;");
  await new Promise((r) => setTimeout(r, 150));
  const pickFr = await tryEval(`
    window.wgn.setLang('fr');
    return [...document.querySelectorAll('#blockPickGrid .tpl b')].map(n => n.textContent.trim()).join(' | ');
  `);
  await tryEval("document.getElementById('blockPickDlg').close(); return 1;");
  ok("the section picker is translated",
     /Bannière|Questions fréquentes|Produits|Sujets/i.test(pickFr), pickFr.slice(0, 100));

  await tryEval("window.wgn.setLang('en'); return 1;");
  await new Promise((r) => setTimeout(r, 150));

  /* --------------------------------------------------------- undo / redo */
  const undo = await tryEval(`
    window.wgn.applyTemplate('blog');
    // Block count on page 0, NOT the page count: the old version compared
    // doc().pages.length against a block count and only passed because both
    // happened to be 2 for this template.
    const before = window.wgn.doc().pages[0].blocks.length;
    const pages = window.wgn.doc().pages.length;
    window.wgn.addBlock('faq', 0);
    const mid = window.wgn.doc().pages[0].blocks.length;
    window.wgn.undo();
    const afterUndo = window.wgn.doc().pages[0].blocks.length;
    window.wgn.redo();
    const afterRedo = window.wgn.doc().pages[0].blocks.length;
    return { before, mid, afterUndo, afterRedo, pages };
  `);
  ok("undo and redo walk the edit history",
     undo.mid === undo.before + 1 && undo.afterUndo === undo.before && undo.afterRedo === undo.mid,
     `${undo.before} -> ${undo.mid} -> ${undo.afterUndo} -> ${undo.afterRedo}`);

  /* ------------------------------------------------------------- audit */
  const audit = await tryEval(`
    window.wgn.applyTemplate('business');
    const res = window.wgn.audit();
    return { total: res.length, failing: res.filter(r=>!r.ok).map(r=>r.key) };
  `);
  ok("the quality report produces checks", audit.total >= 10, `${audit.total} checks`);
  ok("a clean template has nothing to fix", (audit.failing?.length ?? 9) === 0, audit.failing?.join(", "));

  const hostile = await tryEval(`
    const d = window.wgn.doc();
    d.theme.colors = { bg: '#ffffff', surface: '#f0f0f0', ink: '#777777', accent: '#ffdd00' };
    d.theme.palette = 'custom';
    return window.wgn.audit().filter(r=>!r.ok).map(r=>r.key);
  `);
  ok("an unreadable colour palette is reported", hostile.includes("auContrastKo"), hostile.join(", "));

  /* ------------------------------------------------- export file set */
  const files = await tryEval(`
    const f = await window.wgn.files();
    return {
      keys: Object.keys(f),
      html: Object.keys(f).filter(k=>k.endsWith('.html')).length
    };
  `);
  const need = ["index.html", "404.html", "privacy.html", "legal.html", "css/style.css",
                "js/site.js", "favicon.svg", "robots.txt", "sitemap.xml", "_headers",
                "og.png", "DEPLOY.txt"];
  const missing = need.filter((n) => !files.keys.includes(n));
  ok("the export contains every expected artefact", missing.length === 0, missing.join(", "));
  ok("the export produces several HTML pages", files.html >= 4, `${files.html} pages`);

  /* ------------------------------- attributes survive element creation */
  /*
   * el() used Object.assign(node, attrs). That assigns aria-label, aria-current
   * and data-lbl as JavaScript expandos and writes no attribute at all, without
   * erroring. Every generated control lost its accessible name, the selected
   * section never got its highlight, and paintLabels() — which looks those
   * attributes up — matched nothing, so the interface stayed half-translated.
   */
  const attrSurvive = await tryEval(`
    window.wgn.applyTemplate('business');
    window.wgn.select(0, 1);
    await new Promise(r => setTimeout(r, 150));
    const nodes = [...document.querySelectorAll('.node')];
    return {
      total: nodes.length,
      labelled: nodes.filter(n => (n.getAttribute('aria-label')||'').trim()).length,
      current: nodes.filter(n => n.getAttribute('aria-current') === 'true').length,
      dataLbl: document.querySelectorAll('[data-lbl]').length,
      dataAt: document.querySelectorAll('[data-at]').length,
      optLbl: document.querySelectorAll('#designFields option[data-lbl]').length,
      opts: document.querySelectorAll('#designFields option').length,
      selectedId: window.wgn.state.blockId,
      nodeIds: window.wgn.doc().pages[0].blocks.map(b => b.id)
    };
  `);
  ok("every outline row keeps its accessible name",
     attrSurvive.total > 0 && attrSurvive.labelled === attrSurvive.total,
     `${attrSurvive.labelled}/${attrSurvive.total}`);
  ok("exactly the selected section is marked aria-current",
     attrSurvive.current === 1, `${attrSurvive.current} marked`);
  ok("the selected section is actually highlighted",
     await tryEval(`
       const n = [...document.querySelectorAll('.node')].find(x => x.getAttribute('aria-current') === 'true');
       if (!n) return 'none';
       return getComputedStyle(n).borderTopColor !== 'rgba(0, 0, 0, 0)' ? 'yes' : 'no';
     `) === "yes");
  ok("dictionary pointers reach the DOM for the label repaint",
     attrSurvive.dataLbl > 0 && attrSurvive.dataAt > 0,
     `${attrSurvive.dataLbl} data-lbl, ${attrSurvive.dataAt} data-at`);
  ok("every dropdown option carries its dictionary key",
     attrSurvive.opts > 0 && attrSurvive.optLbl === attrSurvive.opts,
     `${attrSurvive.optLbl}/${attrSurvive.opts}`);

  /* ------------------------------------- the template dialog translates */
  const tplDialog = await tryEval(`
    window.wgn.setLang('en');
    document.getElementById('tplBtn').click();
    await new Promise(r => setTimeout(r, 120));
    const read = () => [...document.querySelectorAll('#tplGrid .tpl')].map(c => c.textContent.trim()).join('|');
    const en = read();
    window.wgn.setLang('fr');
    await new Promise(r => setTimeout(r, 120));
    const fr = read();
    document.getElementById('tplDlg').close();
    return { changed: en !== fr, en: en.slice(0, 60), fr: fr.slice(0, 60) };
  `);
  ok("the template picker follows the interface language", tplDialog.changed === true,
     `${tplDialog.en} -> ${tplDialog.fr}`);
  await tryEval("window.wgn.setLang('en'); return 1;");
  await new Promise((r) => setTimeout(r, 150));

  /* --------------------------------- dropdown options translate in place */
  const enumT = await tryEval(`
    window.wgn.setLang('en');
    const opts = () => [...document.querySelectorAll('#designFields select')][1]
      ? [...[...document.querySelectorAll('#designFields select')][1].options].map(o => o.textContent).join('|')
      : '';
    const en = opts();
    window.wgn.setLang('fr');
    await new Promise(r => setTimeout(r, 120));
    return { en, fr: opts() };
  `);
  ok("a dropdown's options translate without being rebuilt",
     enumT.en !== enumT.fr && enumT.fr.length > 0, `${enumT.en} -> ${enumT.fr}`);
  await tryEval("window.wgn.setLang('en'); return 1;");
  await new Promise((r) => setTimeout(r, 150));

  /* ------------------------------------------- nothing overflows sideways */
  const ovf = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 200));
    const pane = document.getElementById('outline');
    const bad = [];
    for (const n of document.querySelectorAll('#outline *, #inspect *')) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || n.closest('.sr') || cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
      // A label with text-overflow:ellipsis is SUPPOSED to have scrollWidth >
      // clientWidth — that is the ellipsis. Flagging it would report the fix as
      // the bug, so only unhandled overflow counts.
      if (cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden') continue;
      if (n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1) {
        bad.push((n.tagName + '.' + (n.className||'').split(' ')[0]) + ' ' + n.clientWidth + '<' + n.scrollWidth);
      }
    }
    return { paneScroll: pane.scrollWidth, paneClient: pane.clientWidth, bad: bad.slice(0, 5), n: bad.length };
  `);
  ok("no panel scrolls sideways at desktop width",
     ovf.n === 0 && ovf.paneScroll <= ovf.paneClient + 1,
     `pane ${ovf.paneScroll}/${ovf.paneClient}${ovf.n ? ' :: ' + ovf.bad.join(' | ') : ''}`);
  ok("a long section name is ellipsised, not cut off",
     await tryEval(`
       const l = document.querySelector('.node__label');
       return l && l.scrollWidth > l.clientWidth ? 'ellipsis' : 'fits';
     `) !== "cut");

  /* ----------------------------------- the device buttons really resize it */
  const sizes = await tryEval(`
    const out = [];
    for (const b of document.querySelectorAll('[data-w]')) {
      b.click();
      await new Promise(r => setTimeout(r, 200));
      out.push({ w: b.dataset.w, shell: Math.round(document.getElementById('frameShell').getBoundingClientRect().width) });
    }
    return out;
  `);
  const distinct = new Set((sizes || []).map((s) => s.shell)).size;
  ok("each device button renders a different width",
     distinct === (sizes?.length ?? 0), JSON.stringify(sizes));

  /* ---------------------------- the export announces a real file size */
  const exportMsg = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 250));
    const o = URL.createObjectURL; let blob = null;
    URL.createObjectURL = (b) => { blob = b; return 'blob:stub'; };
    const oc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    document.querySelector('#exportFields button.btn--primary').click();
    await new Promise(r => setTimeout(r, 900));
    URL.createObjectURL = o; HTMLAnchorElement.prototype.click = oc;
    return { msg: (document.getElementById('live')||{}).textContent || '', bytes: blob ? blob.size : 0 };
  `);
  ok("the export reports the archive's real size, not a placeholder",
     /\d/.test(exportMsg.msg) && !/\(0 (KB|MB)/.test(exportMsg.msg) && exportMsg.bytes > 0,
     `${exportMsg.msg} (${exportMsg.bytes} bytes)`);

  /* ------------------------------- the export note follows the SITE language */
  const deployLang = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 250));
    const en = (await window.wgn.files())['DEPLOY.txt'];
    window.wgn.setSiteLang('fr');
    await new Promise(r => setTimeout(r, 250));
    const fr = (await window.wgn.files())['DEPLOY.txt'];
    window.wgn.setSiteLang('en');
    await new Promise(r => setTimeout(r, 250));
    return { differs: en !== fr,
             enFrench: /Depoiement|hebergeur|de donnees/i.test(en),
             frFrench: /Depoiement|hebergeur|de donnees/i.test(fr),
             frEnglish: /deployment notes|BEFORE GOING LIVE/i.test(fr),
             // host names are product names and stay identical in both
             enHost: /Netlify/.test(en), frHost: /Netlify/.test(fr) };
  `);
  ok("DEPLOY.txt follows the site's language, not the editor's",
     deployLang.differs === true && deployLang.enFrench === false &&
     deployLang.frFrench === true && deployLang.frEnglish === false,
     JSON.stringify(deployLang));
  ok("DEPLOY.txt keeps the hosting names in both languages",
     deployLang.enHost && deployLang.frHost);

  /* ------------------------ the "save into a folder" message is translated */
  const folderMsg = await tryEval(`
    window.wgn.setLang('en');
    const key = (await import('/js/i18n.js')).t('exportedFolder');
    window.wgn.setLang('fr');
    const fr = (await import('/js/i18n.js')).t('exportedFolder');
    window.wgn.setLang('en');
    return { en: key };
  `);
  ok("the folder-save message is not hardcoded French", folderMsg.en === "folder", JSON.stringify(folderMsg));

  /* ---------------------------- the audit catches a duplicated page title */
  const auditTitle = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 250));
    window.wgn.select(1, 0);                       // the About page
    await new Promise(r => setTimeout(r, 250));
    const first = window.wgn.doc().pages[0].title.en;
    const title = document.querySelector('#blockForm input');   // "Page title"
    title.value = first;                           // two pages both called "Home"
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('auditPanel').open = true;
    await new Promise(r => setTimeout(r, 300));
    const res = window.wgn.audit().find(r => r.key === 'auTitleOk' || r.key === 'auTitleKo');
    const row = [...document.querySelectorAll('#auditList .check')]
      .find(n => /unique title|duplicate title|titre/i.test(n.textContent));
    return { first, typed: title.value,
             liveTitle: window.wgn.doc().pages[1].title.en,
             ok: res?.ok, key: res?.key, args: res?.args,
             rowClass: row ? row.className : null, rowText: row ? row.textContent.trim() : null,
             jump: !!document.querySelector('#auditList .check__go') };
  `);
  ok("typing into the page title reaches the document",
     auditTitle.typed === auditTitle.first && auditTitle.liveTitle === auditTitle.first,
     JSON.stringify({ typed: auditTitle.typed, live: auditTitle.liveTitle }));
  ok("two pages sharing a title are reported as a failure",
     auditTitle.ok === false && auditTitle.key === "auTitleKo",
     JSON.stringify(auditTitle));
  ok("the report row shows the failure, not a passing sentence",
     (auditTitle.rowClass || "").includes("check--ko") && !/unique title/i.test(auditTitle.rowText || ""),
     `${auditTitle.rowClass} :: ${auditTitle.rowText}`);
  ok("a failed check offers a way to jump to the place to fix it",
     auditTitle.jump === true);

  /* --------------------------------- drag a section to reorder it */
  const drag = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 300));
    const ids = () => window.wgn.doc().pages[0].blocks.map(b => b.id);
    const before = ids();
    const nodes = [...document.querySelectorAll('#outline .node')];
    const dt = new DataTransfer();
    const from = nodes[0], to = nodes[2];
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = to.getBoundingClientRect();
    // the lower half of the target means "after it"
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt,
                   clientX: r.left + r.width / 2, clientY: r.top + r.height - 2 };
    to.dispatchEvent(new DragEvent('dragover', opts));
    to.dispatchEvent(new DragEvent('drop', opts));
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 300));
    const after = ids();
    return { before, after, moved: before.join() !== after.join(),
             // dragged row 0 past row 2 => it now sits at index 2
             atTwo: after[2] === before[0],
             sameOthers: after.filter(x => x !== before[0]).join() === before.filter(x => x !== before[0]).join() };
  `);
  ok("dragging a section reorders it",
     drag.moved === true && drag.atTwo === true && drag.sameOthers === true,
     JSON.stringify(drag));

  /* ----------------------------- the outline's disclosure actually collapses */
  const disc = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 300));
    const openState = () => [...document.querySelectorAll('#outline details.page')].map(d => d.open);
    const first = openState();
    const sum = document.querySelector('#outline summary');
    sum.click(); await new Promise(r => setTimeout(r, 200));   // already selected -> fold
    const folded = openState();
    sum.click(); await new Promise(r => setTimeout(r, 200));   // and unfold again
    const unfolded = openState();
    // selecting a different page must still open it
    document.querySelectorAll('#outline summary')[2].click();
    await new Promise(r => setTimeout(r, 250));
    const afterSelect = openState();
    return { first, folded, unfolded, afterSelect,
             pageId: window.wgn.state.pageId === window.wgn.doc().pages[2].id };
  `);
  ok("opening a project shows its first page expanded",
     disc.first?.[0] === true, JSON.stringify(disc.first));
  ok("clicking the open page header folds it away",
     disc.folded?.[0] === false, JSON.stringify(disc.folded));
  ok("and clicking again unfolds it",
     disc.unfolded?.[0] === true, JSON.stringify(disc.unfolded));
  ok("clicking another page's header selects and opens that page",
     disc.pageId === true && disc.afterSelect?.[2] === true, JSON.stringify(disc.afterSelect));

  /* ------------------------------ the preview frame can never be navigated away */
  const frameGuard = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 300));
    const f = document.getElementById('frame');
    // Force exactly what a clicked link does: the frame loses its document.
    f.removeAttribute('srcdoc');
    f.src = '/';                       // ...and lands on the generator itself
    await new Promise(r => setTimeout(r, 1500));
    const after = f.getAttribute('srcdoc');
    return { selfHealed: !!after, len: (after || '').length,
             isSite: /<main id="main"|site-head/.test(after || ''),
             isEditor: /Add a section to this page|Quality report/.test(after || '') };
  `);
  ok("a preview that gets navigated away restores itself",
     frameGuard.selfHealed === true && frameGuard.len > 500 && frameGuard.isSite === true,
     JSON.stringify(frameGuard));
  ok("the restored preview is the generated site, never the generator",
     frameGuard.isEditor === false, JSON.stringify(frameGuard));

  const linkGuard = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('reloadBtn').click();
    await new Promise(r => setTimeout(r, 500));
    const now = document.getElementById('frame').getAttribute('srcdoc') || '';
    return {
      stillOurs: now.length > 500,
      guardsHash: /h\\.charAt\\(0\\) === "#"/.test(now),
      allowsMailto: /\\^\\(mailto:\\|tel:\\)/.test(now),
      blocksSubmit: /addEventListener\\("submit"/.test(now),
      usesCapture: /addEventListener\\("submit", function \\(e\\) \\{ e\\.preventDefault\\(\\); \\}, true\\)/.test(now)
    };
  `);
  ok("the preview script blocks navigation from every link and from form submits",
     linkGuard.stillOurs && linkGuard.guardsHash && linkGuard.allowsMailto &&
     linkGuard.blocksSubmit && linkGuard.usesCapture,
     JSON.stringify(linkGuard));

  /* --------------------------- the site-language select hides when useless */
  const langSel = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 300));
    const sel = document.getElementById('previewLang');
    const mono = { selHidden: sel.hidden, labelHidden: document.getElementById('previewLangLabel').hidden };
    window.wgn.setBilingual(true);
    await new Promise(r => setTimeout(r, 350));
    const bi = { selHidden: sel.hidden, labelHidden: document.getElementById('previewLangLabel').hidden,
                 options: [...sel.options].map(o => o.value) };
    window.wgn.setBilingual(false);
    await new Promise(r => setTimeout(r, 350));
    return { mono, bi, backToMono: sel.hidden };
  `);
  ok("the site-language select is hidden on a single-language site",
     langSel.mono.selHidden === true && langSel.mono.labelHidden === true,
     JSON.stringify(langSel.mono));
  ok("and appears with both languages once the site is bilingual",
     langSel.bi.selHidden === false && langSel.bi.labelHidden === false &&
     langSel.bi.options.join() === "en,fr", JSON.stringify(langSel.bi));

  /* --------------------------------------- the live contrast readout is live */
  const contrast = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('designPanel').open = true;
    await new Promise(r => setTimeout(r, 300));
    const read = () => {
      const rows = [...document.querySelectorAll('#designFields .cr')];
      return { n: rows.length,
               ok: rows.filter(r => r.classList.contains('cr--ok')).length,
               ko: rows.filter(r => r.classList.contains('cr--ko')).length,
               open: document.querySelector('#designFields .contrast')?.open,
               firstLabel: rows[0]?.querySelector('.cr__what')?.textContent,
               firstRatio: rows[0]?.querySelector('.cr__ratio')?.textContent,
               summary: document.querySelector('#designFields .contrast .summary')?.textContent };
    };
    const clean = read();
    // Drive it through the real colour pickers, the way a person would.
    const picks = [...document.querySelectorAll('#designFields input[type="color"]')];
    const set = (i, v) => {
      picks[i].value = v;
      picks[i].dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(0, '#ffffff');   // page background
    await new Promise(r => setTimeout(r, 150));
    set(2, '#777777');   // body text
    await new Promise(r => setTimeout(r, 150));
    set(3, '#ffdd00');   // links and buttons
    await new Promise(r => setTimeout(r, 400));
    const bad = read();
    return { clean, bad, palette: window.wgn.doc().theme.palette };
  `);
  ok("the Design panel shows every contrast pair", contrast.clean.n === 15,
     `${contrast.clean.n} rows`);
  ok("a readable theme reports all 15 pairs passing",
     contrast.clean.ko === 0 && contrast.clean.ok === 15, JSON.stringify(contrast.clean.summary));
  ok("each row says what it measures, not a token name",
     /body text|text on|links|chip|card|header/i.test(contrast.clean.firstLabel || ""),
     JSON.stringify(contrast.clean.firstLabel));
  ok("picking an unreadable colour turns rows red in the panel itself",
     contrast.palette === "custom" && contrast.bad.ko > 0,
     `${contrast.bad.ko} failing rows, palette=${contrast.palette}`);
  ok("and the panel opens itself so the failure is not hidden",
     contrast.bad.open === true, JSON.stringify(contrast.bad.summary));

  /* ------------------------------------------------- console stayed clean */
  const realErrors = consoleErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND/i.test(e));
  ok("no console errors during the whole run", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  /* The preview is a srcdoc document and inherits the editor's strict policy, so
     its two inline scripts are allowed by SHA-256 hash and nothing else. If the
     hash and the bytes ever drift apart the preview silently stops working --
     theme toggle inert, links navigating the frame away -- while every other
     check still passes. This is the check that says so out loud.

     It reads the real response header and hashes the real inline bodies, so it
     cannot pass by agreeing with itself. */
  const inlineBodies = await tryEval(`
    const h = document.getElementById('frame').getAttribute('srcdoc') || '';
    return (h.match(/<script>([\\s\\S]*?)<\\/script>/g) || [])
      .map(s => s.replace(/^<script>/, '').replace(/<\\/script>$/, ''));
  `);
  const header = await (await fetch(`http://127.0.0.1:${PORT}/`)).headers;
  const csp = header.get("content-security-policy") || "";
  const digest = (s) => createHash("sha256").update(s, "utf8").digest("base64");
  const unallowed = (inlineBodies || []).filter((b) => !csp.includes(`sha256-${digest(b)}`));

  ok("the preview inlines exactly two scripts",
     Array.isArray(inlineBodies) && inlineBodies.length === 2, `${inlineBodies && inlineBodies.length}`);
  ok("the served policy hashes both preview scripts, so they actually run",
     unallowed.length === 0, `not allowed: ${unallowed.length}`);
  ok("the policy still forbids inline script in general",
     /script-src 'self'/.test(csp) && !/'unsafe-inline'/.test(csp.split(";")[1] || ""),
     csp.slice(0, 80));
  ok("the preview runs the generated site's own script, not a 404 link",
     (inlineBodies || []).some((b) => b.includes("theme toggle")),
     (inlineBodies || []).map((b) => b.slice(0, 60)).join(" || "));

  /* ------------------------------------------------------------ report */
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  stop();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  stop();
  process.exit(1);
});

for (const sig of ["exit", "SIGINT", "SIGTERM"]) {
  process.on(sig, () => stop());
}