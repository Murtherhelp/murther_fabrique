/**
 * Project persistence. Autocomplete AND on every field, `spellcheck=false` on
 * the ones that want URLs and slugs, and a swap between the interface language
 * and the two site languages, all in one pass.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HEADED = process.argv.includes("--head");
const PORT = Number(process.env.WGN_PORT) || 5201;
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
if (!(await fetch(`http://localhost:${PORT}/`).then((r) => r.ok).catch(() => false))) {
  console.error(`No server on http://localhost:${PORT}/.  Start:  set PORT=${PORT} && node server.mjs`);
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "wgn-i18n-"));
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
    expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true
  });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || "threw" };
  return r.result.value;
}

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
      else if (!("result" in m)) entry.reject(new Error(`${entry.method}: no result`));
      else entry.resolve(m.result);
    }
  };

  const { targetInfos } = await send("Target.getTargets");
  const { sessionId } = await send("Target.attachToTarget", { targetId: targetInfos.find((t) => t.type === "page").targetId, flatten: true });
  S = (m, p) => send(m, p, sessionId);
  await S("Runtime.enable");
  await S("Page.enable");
  await S("Page.navigate", { url: URL });

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await ev("return !!window.wgn;")) break;
  }
  await ev("window.wgn.applyTemplate('business'); return 1;");
  await new Promise((r) => setTimeout(r, 200));

  /* --------------------- persistence survives a real reload -------------- */
  const saved = await ev(`
    const d = window.wgn.doc();
    d.name = { en: 'PERSISTED-NAME', fr: 'NOM-PERSISTE' };
    d.pages[0].blocks[0].title = { en: 'PERSISTED-TITLE', fr: 'TITRE-PERSISTE' };
    window.wgn.state.history.reset(d);
    window.dispatchEvent(new Event('beforeunload'));
    // The autosave is debounced; give it room, then force it.
    await new Promise(r => setTimeout(r, 900));
    return { raw: localStorage.getItem('wgn.project') ? 'stored' : 'empty' };
  `);
  ok("the project autosaves to this device", saved.raw === "stored", saved.raw);

  const lang = await ev("window.wgn.setLang('fr'); return localStorage.getItem('wgn.device');");
  ok("the language choice is remembered", /"fr"/.test(lang || ""), lang);

  await S("Page.reload", { ignoreCache: false });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await ev("return !!window.wgn;")) break;
  }
  await new Promise((r) => setTimeout(r, 400));

  const after = await ev(`
    const d = window.wgn.doc();
    return {
      name: d.name,
      title: d.pages[0].blocks[0].title,
      lang: document.documentElement.lang,
      label: document.querySelector('[data-i18n="panelOutline"]').textContent
    };
  `);
  ok("reloading restores the project", after.name?.en === "PERSISTED-NAME" && after.title?.en === "PERSISTED-TITLE",
     JSON.stringify(after.name));
  ok("reloading restores BOTH languages of the content",
     after.name?.fr === "NOM-PERSISTE" && after.title?.fr === "TITRE-PERSISTE", JSON.stringify(after.title));
  ok("reloading restores the interface language", after.lang === "fr", after.lang);
  ok("reloading shows the restored language in the labels", after.label === "Structure", after.label);

  /* ------------------------- the three languages are independent ------- */
  /* Apply the template FIRST: switching template replaces the whole project, so
   setting the site language before it would be discarded. */
  const three = await ev(`
    window.wgn.applyTemplate('business');
    const out = {};
    for (const [ui, site] of [['en','en'], ['fr','en'], ['en','fr'], ['fr','fr']]) {
      window.wgn.setLang(ui);
      window.wgn.setSiteLang(site);
      const f = window.wgn.build().files;
      out[ui + '-' + site] = {
        ui: document.documentElement.lang,
        htmlLang: (f['index.html']||'').match(/<html lang="(\\w+)"/)?.[1],
        title: (f['index.html']||'').match(/<title>([^<]*)<\\/title>/)?.[1],
        frPage: !!f['index.fr.html']
      };
    }
    window.wgn.setLang('en'); window.wgn.setSiteLang('en');
    return out;
  `);
  ok("interface and site languages move independently",
     three["fr-en"]?.ui === "fr" && three["fr-en"]?.htmlLang === "en" &&
     three["en-fr"]?.ui === "en" && three["en-fr"]?.htmlLang === "fr",
     JSON.stringify(three["fr-en"]) + " " + JSON.stringify(three["en-fr"]));

  /* A site whose main language is French must ship French even while the
     editor is in English — the two are not the same setting. */
  const siteName = await ev(`
    window.wgn.applyTemplate('business');
    const d = window.wgn.doc();
    d.name = { en: 'NAME-IN-ENGLISH', fr: 'NOM-EN-FRANCAIS' };
    d.description = { en: 'A description written in English.', fr: 'Une description redigee en francais.' };
    window.wgn.state.history.reset(d);

    window.wgn.setLang('en');
    window.wgn.setSiteLang('en');
    const enFile = window.wgn.build().files['index.html'];

    window.wgn.setLang('en');   // interface deliberately left in English
    window.wgn.setSiteLang('fr');
    const frFile = window.wgn.build().files['index.html'];

    const grab = (s, re) => (s.match(re) || [])[1];
    return {
      en: grab(enFile, /og:site_name" content="([^"]*)"/),
      fr: grab(frFile, /og:site_name" content="([^"]*)"/),
      enDesc: grab(enFile, /name="description" content="([^"]*)"/),
      frDesc: grab(frFile, /name="description" content="([^"]*)"/)
    };
  `);
  ok("the exported site name follows the SITE language",
     siteName.en === "NAME-IN-ENGLISH" && siteName.fr === "NOM-EN-FRANCAIS",
     `${siteName.en} / ${siteName.fr}`);
  ok("the exported description follows the SITE language",
     siteName.enDesc?.startsWith("A description") && siteName.frDesc?.startsWith("Une description"),
     `${siteName.enDesc} / ${siteName.frDesc}`);

  /* ------------------------------ no autofill on the text fields -------- */
  /* Only the text-like controls are checked: a hidden file input is opened by a
   named button, so autofill has nothing to do with it. */
  const auto = await ev(`
    window.wgn.setLang('en');
    window.wgn.applyTemplate('business');
    window.wgn.select(0, 0);
    await new Promise(r => setTimeout(r, 200));
    // Only text-like controls: a checkbox carries no text to autofill, and a
    // hidden file input is opened by a named button.
    const inputs = [...document.querySelectorAll('#blockForm input, #blockForm textarea')]
      .filter(n => n.type !== 'file' && n.type !== 'checkbox');
    const ok = inputs.filter(n =>
      n.getAttribute('autocomplete') === 'off' &&
      n.getAttribute('autocapitalize') === 'off').length;
    const bad = inputs.filter(n => n.getAttribute('autocomplete') !== 'off')
      .map(n => n.type + (n.id ? '#' + n.id : ''));
    return { total: inputs.length, ok, bad };
  `);
  ok("section text fields opt out of autofill",
     auto.total > 0 && auto.ok === auto.total, `${auto.ok}/${auto.total} ${(auto.bad || []).join(', ')}`);

  const formOff = await ev("const f = document.getElementById('editorForm'); return f ? f.getAttribute('autocomplete') : 'missing';");
  ok("the whole editor form opts out of autofill", formOff === "off", String(formOff));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} i18n/persistence checks passed`);
  stop();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("probe failed:", e.message); stop(); process.exit(1); });
for (const sig of ["exit", "SIGINT", "SIGTERM"]) process.on(sig, () => stop());