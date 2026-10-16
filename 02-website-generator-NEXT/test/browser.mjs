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
import { serve } from "./serve.mjs";
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
  try { stopServer(); } catch {}
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
  // Each suite starts its own server; if one is already answering, serve adopts
  // it rather than fighting for the port.
  const stopServer = await serve(PORT);
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

  /* ------------------------- a green row must not be green by accident */
  /*
  * Six of the nine templates ship https://example.com rather than a blank field.
  * The SEO row only asked whether robots.txt and sitemap.xml had been produced,
  * so it read green while the canonical link, the og:url, the sitemap and
  * robots.txt all named a domain that was not the user's. A placeholder that
  * looks plausible is worse than an empty one, because an empty field invites
  * you to fill it in.
  */
  const canonRow = await tryEval(`
    window.wgn.applyTemplate('business');
    const row = () => window.wgn.audit().find(r => r.key === 'auSeoOk' || r.key === 'auCanonKo');
    const shipped = row();
    const doc = window.wgn.doc();
    doc.baseUrl = 'https://studio-marcel.example';
    const set = row();
    doc.baseUrl = '';
    const blank = row();
    doc.baseUrl = 'https://example.org/';
    const bare = row();
    return {
      shippedKey: shipped.key, shippedOk: shipped.ok,
      setKey: set.key, setOk: set.ok,
      blankKey: blank.key, blankOk: blank.ok,
      bareKey: bare.key, bareOk: bare.ok,
    };
  `);
  ok("the placeholder canonical URL is reported, not passed over",
     canonRow.shippedKey === "auCanonKo" && canonRow.shippedOk === false,
     JSON.stringify(canonRow));
  ok("a blank canonical URL is reported too",
     canonRow.blankKey === "auCanonKo" && canonRow.blankOk === false, JSON.stringify(canonRow));
  ok("example.org is a placeholder as well, not a pass",
     canonRow.bareKey === "auCanonKo", JSON.stringify(canonRow));
  ok("and a real URL turns the row green",
     canonRow.setKey === "auSeoOk" && canonRow.setOk === true, JSON.stringify(canonRow));

  // With the canonical URL the user's own, the rest of the template is clean.
  const auditClean = await tryEval(`
    window.wgn.applyTemplate('business');
    window.wgn.doc().baseUrl = 'https://studio-marcel.example';
    const res = window.wgn.audit();
    return res.filter(r=>!r.ok).map(r=>r.key);
  `);
  ok("a clean template has nothing to fix",
     (auditClean?.length ?? 9) === 0, auditClean?.join(", "));

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

  /* ------------------------------------------- the toast is not furniture */
// The live region is a fixed pill. With nothing to say it still drew a 34x15
// box with a border over the editor, and it swallowed clicks aimed at whatever
// was underneath. Not display:none, which would pull it out of the a11y tree
// and silence every announcement. Both halves are asserted, because hiding it
// unconditionally is the easy way to break the thing it exists for.
const toast = await tryEval(`
const el = document.querySelector('.live');
const st = () => getComputedStyle(el);
const idle = { opacity: st().opacity, pe: st().pointerEvents };
const under = document.elementFromPoint(innerWidth / 2, innerHeight - 30);
const passesThrough = !(under === el || (el.contains && el.contains(under)));
el.textContent = 'Project saved.';
await new Promise(r => setTimeout(r, 80));
const said = { opacity: st().opacity, pe: st().pointerEvents };
el.textContent = '';
return { idle, said, passesThrough, hit: under ? under.tagName + '.' + (under.className || '-') : 'none' };
`);
ok("the live region is invisible and click-through while it has nothing to say",
  toast.idle.opacity === "0" && toast.idle.pe === "none" && toast.passesThrough,
  `opacity=${toast.idle.opacity}, pointer-events=${toast.idle.pe}, click lands on ${toast.hit}`);
ok("the live region becomes visible once it has something to report",
  toast.said.opacity === "1" && toast.said.pe !== "none",
  `opacity=${toast.said.opacity}, pointer-events=${toast.said.pe}`);

/* ------------------------------------- a label cannot lose its control */
// The toolbar is flex-wrap. With the label and its <select> as siblings of
// .topbar, the wrap landed between them: at 1280px "Text size" ended one row
// and its menu began 1239px away at the far left of the next. Structural, not
// pixel-based: the shared parent must not be the wrapping container itself, or
// a line break can fall between them at whatever width happens to overflow.
const pair = await tryEval(`
const stranded = [];
for (const l of document.querySelectorAll('.topbar label[for]')) {
  const c = document.getElementById(l.getAttribute('for'));
  if (!c) { stranded.push(l.getAttribute('for') + ': no control'); continue; }
  const p = l.parentElement;
  if (p === c.parentElement && p.classList.contains('topbar')) {
    stranded.push(l.getAttribute('for') + ': siblings of the wrapping toolbar');
  }
}
return stranded;
`);
ok("every topbar label shares a wrapper with the control it names",
  pair.length === 0, pair.length ? pair.join("; ") : "no pair can be split by a wrap");

/* ----------------------------------------- the preview is not a letterbox */
// The live preview is the product. Its iframe asked for height:100% inside a
// chain where nothing had a definite height, so it fell back to the 150px
// default: a strip with most of the stage empty below it. Every screenshot
// still showed *a* page, which is why it survived this long.
const frame = await tryEval(`
const stage = document.querySelector('.stage');
const f = document.querySelector('.frame-shell iframe');
const s = stage.getBoundingClientRect().height;
const h = f.getBoundingClientRect().height;
return { stage: Math.round(s), frame: Math.round(h), pct: Math.round((h / s) * 100) };
`);
ok("the preview fills its stage instead of collapsing to the 150px default",
  frame.frame >= frame.stage * 0.8,
  `iframe ${frame.frame}px in a ${frame.stage}px stage (${frame.pct}%)`);

/* ------------------------------------------- nothing overflows sideways */
const ovf = await tryEval(`
window.wgn.applyTemplate('business');
await new Promise(r => setTimeout(r, 200));
// A pane with nothing selected never grows: the widest thing in the inspector
// is a repeater's button row, so one has to be on screen before this means
// anything. The check used to measure #outline only, which is why the content
// pane could sit 56px too wide for months behind a passing test.
const rows = [...document.querySelectorAll('#outline li, #outline .row, #outline [data-block]')];
const withItems = rows.find(r => /frequently asked|case studies|what we do/i.test(r.textContent));
if (withItems) withItems.click();
await new Promise(r => setTimeout(r, 250));
const panes = ['outline', 'inspect'].map(id => {
  const p = document.getElementById(id);
  return { id, scroll: p.scrollWidth, client: p.clientWidth };
});
const bad = [];
for (const n of document.querySelectorAll('#outline *, #inspect *')) {
  const cs = getComputedStyle(n);
  if (cs.display === 'none' || n.closest('.sr') || cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
  // A label with text-overflow:ellipsis is SUPPOSED to have scrollWidth >
  // clientWidth - that is the ellipsis. Flagging it would report the fix as
  // the bug, so only unhandled overflow counts.
  if (cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden') continue;
  if (n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1) {
    bad.push((n.tagName + '.' + (n.className||'').split(' ')[0]) + ' ' + n.clientWidth + '<' + n.scrollWidth);
  }
}
return { panes, bad: bad.slice(0, 5), n: bad.length };
`);
ok("no panel scrolls sideways at desktop width",
  ovf.n === 0 && ovf.panes.every((p) => p.scroll <= p.client + 1),
  ovf.panes.map((p) => `${p.id} ${p.scroll}/${p.client}`).join(", ") + (ovf.n ? ' :: ' + ovf.bad.join(' | ') : ''));
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

  /* ---------------------- the note and the headers file must not drift apart */
  /*
  * DEPLOY.txt travels with every export and tells the user which headers the
  * _headers file next to it applies. It named HSTS while _headers carried no
  * Strict-Transport-Security at all: the note was reassuring the user about a
  * header that was never written, and it ships to every site the user deploys.
  */
  const headerTruth = await tryEval(`
    const f = await window.wgn.files();
    const note = String(f['DEPLOY.txt'] || '');
    const headers = String(f['_headers'] || '');
    const NAMED = [
      [/CSP|Content-Security-Policy/i, 'Content-Security-Policy'],
      [/HSTS/i, 'Strict-Transport-Security'],
      [/nosniff/i, 'X-Content-Type-Options'],
      [/Referrer-Policy/i, 'Referrer-Policy'],
      [/Permissions-Policy/i, 'Permissions-Policy'],
    ];
    const missing = NAMED.filter(([re, header]) => re.test(note) && !headers.includes(header))
      .map(([, header]) => header);
    return {
      noteLen: note.length,
      headersLen: headers.length,
      missing,
      hsts: /^\\s*Strict-Transport-Security: max-age=\\d+$/m.test(headers),
      subdomains: /includeSubDomains/i.test(headers),
    };
  `);
  ok("every header DEPLOY.txt names is in the _headers file beside it",
     headerTruth.noteLen > 400 && headerTruth.headersLen > 80 &&
     headerTruth.missing.length === 0,
     headerTruth.missing.length ? "promised but absent: " + headerTruth.missing.join(", ")
                                : JSON.stringify(headerTruth));
  ok("the promised HSTS carries a max-age and strands no sibling host",
     headerTruth.hsts && headerTruth.subdomains === false,
     JSON.stringify(headerTruth));

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

  /* ----------------------------------- exporting says when the theme fails */
  /* The files are the user's, so the export is never blocked. But a palette
     that fails the audit used to ship in silence: the red rows sat in another
     panel and the confirmation said nothing. */
  const exportSays = await tryEval(`
    const live = () => document.getElementById('live');
    const out = {};
    // A clean theme first: nothing should be said about contrast at all.
    window.wgn.applyTemplate('business');
    live().textContent = '';
    window.wgn.sayContrast();
    out.clean = live().textContent.trim();
    // Now a theme whose pairs fail the audit.
    const d = window.wgn.doc();
    d.theme.palette = 'custom';
    d.theme.colors = { bg: '#ffffff', surface: '#f0f0f0', ink: '#777777', accent: '#ffdd00' };
    window.wgn.state.history.reset(d);
    live().textContent = '';
    window.wgn.sayContrast();
    out.dirty = live().textContent.trim();
    return out;
  `);
  const badWords = /contrast|below|4\.5|pair|contraste|paire/i;
  ok("exporting a failing theme says so", badWords.test(exportSays?.dirty || ""),
     `status: "${exportSays?.dirty || "(nothing said)"}"`);
  ok("exporting a readable theme says nothing about contrast", !badWords.test(exportSays?.clean || ""),
     `status: "${exportSays?.clean || "(silent, as intended)"}"`);

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

  /* A menu label that was never edited follows the page title, and stops
     following the moment it is edited. The rule is a single comparison inside
     the inspector's title handler, and nothing tested either direction of it. */
  const menuFollow = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 300));
    window.wgn.select(1, 0);
    await new Promise(r => setTimeout(r, 300));
    const page = () => window.wgn.doc().pages[1];
    // Re-queried each time: a commit re-renders the inspector, so a cached
    // element would be detached and the event would go nowhere.
    const type = async (i, v) => {
      const el = document.querySelectorAll('#blockForm input')[i];
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 350));
      return el.value;
    };
    const start = { title: page().title.en, menu: page().menu.en };
    await type(0, 'Services');
    const afterTitle = { title: page().title.en, menu: page().menu.en };
    await type(1, 'Portfolio');
    const menuTyped = page().menu.en;
    await type(0, 'Case studies');
    const afterBoth = { title: page().title.en, menu: page().menu.en };
    return { start, afterTitle, menuTyped, afterBoth };
  `);
  ok("a menu label that was never edited follows the page title",
     menuFollow.start.title === menuFollow.start.menu &&
     menuFollow.afterTitle.menu === menuFollow.afterTitle.title &&
     menuFollow.afterTitle.menu === "Services",
     JSON.stringify({ shipped: menuFollow.start, afterTitle: menuFollow.afterTitle }));
  ok("once the menu is edited it stops following the title",
     menuFollow.menuTyped === "Portfolio" &&
     menuFollow.afterBoth.menu === "Portfolio" &&
     menuFollow.afterBoth.title === "Case studies",
     JSON.stringify({ menuTyped: menuFollow.menuTyped, afterBoth: menuFollow.afterBoth }));

  /* A picked file is the one input the generator cannot vouch for. This function
     decides what enters a site, and nothing called it before now. */
  const intake = await tryEval(`
    const PNG = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,1,15,99,136,0,0,0,11,73,68,65,84,120,64,160,99,248,207,0,0,3,1,1,0,24,221,141,176,0,0,0,0,73,69,78,68,174,66,96,130];
    const file = (bytes, name, type) => new File([new Uint8Array(bytes)], name, { type });
    const attempt = async (f) => {
      try { const a = await window.wgn.readAsset(f); return { ok: true, name: a.name, type: a.type, data: a.data.slice(0, 30) }; }
      catch (e) { return { ok: false, why: String(e.message || e) }; }
    };
    const accepted = await attempt(file(PNG, 'holiday photo.png', 'image/png'));
    // Real image bytes, but the browser is told it is text: the data URI is what
    // gets checked, so this must be refused however the file is named.
    const disguised = await attempt(file(PNG, 'holiday.png', 'text/plain'));
    const notImage = await attempt(file([1,2,3,4], 'notes.txt', 'text/plain'));
    const overLimit = await attempt(file(new Array(2 * 1024 * 1024 + 1).fill(0), 'huge.png', 'image/png'));
    const renamedExe = await attempt(file(PNG, 'totally-safe.png.exe', 'image/png'));
    return { accepted, disguised, notImage, overLimit, renamedExe };
  `);
  ok("a real image is taken in and named from its own bytes",
     intake.accepted.ok === true && /^data:image\/png;base64,/.test(intake.accepted.data) &&
       intake.accepted.type === "image/png" && intake.accepted.name.endsWith(".png"),
     JSON.stringify(intake.accepted));
  ok("image bytes declared as text are refused",
     intake.disguised.ok === false && intake.disguised.why.startsWith("img-type"),
     JSON.stringify(intake.disguised));
  ok("a file that is not an image at all is refused",
     intake.notImage.ok === false && intake.notImage.why.startsWith("img-type"),
     JSON.stringify(intake.notImage));
  ok("a file over the size limit is refused before it is read",
     intake.overLimit.ok === false && intake.overLimit.why.startsWith("img-too-big"),
     JSON.stringify(intake.overLimit));
  ok("the exported file is named from the image type, not from the picked name",
     intake.renamedExe.ok === true && !/\.exe$/i.test(intake.renamedExe.name) &&
       intake.renamedExe.name.endsWith(".png"),
     `picked totally-safe.png.exe -> ${intake.renamedExe.name}`);

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

  /* The receiving half of the channel the guard exists for: the message the
     preview posts on an internal link click, and the editor swapping pages.
     The frame is sandboxed without allow-same-origin on purpose, so the sender
     hop cannot be driven from here; what the check above reads out of the frame
     covers that side, and this covers everything after it. */
  const navChannel = await tryEval(`
    window.wgn.applyTemplate('business');
    await new Promise(r => setTimeout(r, 400));
    const note = () => document.getElementById('previewNote').textContent.split(' ·')[0];
    const before = note();
    const target = before === 'about.html' ? 'contact.html' : 'about.html';
    window.postMessage({ type: 'wgn:nav', href: target }, '*');
    await new Promise(r => setTimeout(r, 600));
    const after = note();
    return { before, target, after, moved: after === target };
  `);
  ok("the editor takes the navigation message the preview sends and renders that page",
     navChannel.moved === true,
     `${navChannel.before} -> ${navChannel.after} (asked for ${navChannel.target})`);

  /* "What you see cannot drift from what you ship" is the promise the whole tool
     rests on. previewHtml() gets there with four regex substitutions on the
     exported page; every one of them fails silently, so a changed link or script
     tag leaves the preview unstyled and broken with nothing to say so. The body
     is what carries the content, and it must be the exported body. */
  const fidelity = await tryEval(`
    window.wgn.applyTemplate('portfolio');
    await new Promise(r => setTimeout(r, 300));
    const d = window.wgn.doc();
    const g = d.pages[0].blocks.find(b => b.type === 'gallery');
    g.items = [{ image: { assetId: 'a1', alt: { en: 'Cover', fr: 'Couverture' } }, caption: { en: 'C', fr: 'C' } }];
    d.assets = [{ id: 'a1', name: 'shot.png', type: 'image/png', data: 'data:image/png;base64,iVBORw0KGgo=' }];
    window.wgn.state.history.reset(d);
    window.wgn.select(0, 0);
    await new Promise(r => setTimeout(r, 500));
    const built = window.wgn.build();
    const exported = built.files['index.html'] || '';
    const src = document.getElementById('frame').getAttribute('srcdoc') || '';
    const bodyOf = (h) => (h.match(/<body>[\\s\\S]*<\\/body>/) || [''])[0];
    // Two adaptations happen inside <body> and are not drift: the asset paths
    // become data URIs, and the script tag becomes the script inline. src is
    // blanked and script elements dropped on both sides, and what is left has to
    // be the same document.
    const norm = (h) => bodyOf(h)
      .replace(/<script[\\s\\S]*?<\\/script>/g, '')
      .replace(/ src="[^"]*"/g, ' src="#"');
    return {
      len: src.length,
      sameBody: norm(src) === norm(exported) && norm(exported).length > 500,
      bodyLens: [norm(src).length, norm(exported).length],
      inlinedCss: /<style>[\\s\\S]{500,}<\\/style>/.test(src) && !/<link rel="stylesheet"/.test(src),
      noScriptSrc: !/<script src=/.test(src),
      guardPresent: /addEventListener\\("click", function \\(\\) \\{/.test(src) || /addEventListener\\("submit"/.test(src),
      imageInlined: /<img[^>]+src="data:image\\/png/.test(src) && !/src="assets\\//.test(src),
      faviconInlined: /rel="icon" href="data:image\\/svg\\+xml/.test(src)
    };
  `);
  ok("the preview body is the exported body, unchanged",
     fidelity.sameBody === true, `bodies ${(fidelity.bodyLens || []).join(" vs ")} chars, preview ${fidelity.len}`);
  ok("the preview carries the real stylesheet, not a link to one",
     fidelity.inlinedCss === true, `inline <style>: ${fidelity.inlinedCss}`);
  ok("the preview carries the site's own script plus the guard, not a link",
     fidelity.noScriptSrc === true && fidelity.guardPresent === true,
     `no script src: ${fidelity.noScriptSrc}, guard: ${fidelity.guardPresent}`);
  ok("images and the favicon travel into the preview as data",
     fidelity.imageInlined === true && fidelity.faviconInlined === true,
     `image: ${fidelity.imageInlined}, favicon: ${fidelity.faviconInlined}`);

  // And the other end of it: a message naming nothing in the document must do
  // nothing at all, or a crafted href could steer the preview anywhere.
  const navReject = await tryEval(`
    const before = document.getElementById('previewNote').textContent;
    window.postMessage({ type: 'wgn:nav', href: 'https://elsewhere.test/' }, '*');
    window.postMessage({ type: 'wgn:nav', href: '../../etc/passwd' }, '*');
    await new Promise(r => setTimeout(r, 400));
    return { before, after: document.getElementById('previewNote').textContent };
  `);
  ok("a navigation message naming no page in the document is ignored",
     navReject.before === navReject.after, navReject.before);

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