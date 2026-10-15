/**
 * Export integration. Builds a real project, writes the real file tree, and
 * checks it the way a browser would: open the ZIP, read index.html, look at
 * what a visitor sees.
 *
 * This is the one path the pure-core suite cannot cover, because it needs
 * CompressionStream and a Blob, i.e. a real browser.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { inflateRawSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const HEADED = process.argv.includes("--head");
const PORT = Number(process.env.WGN_PORT) || 5202;
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
/* Start the server this suite needs, so `npm run test:export` works alone. */
const stopServer = await serve(PORT);

const profile = mkdtempSync(join(tmpdir(), "wgn-zip-"));
let browser = null;
let ws = null;
let nextId = 1;
const pending = new Map();
const results = [];
let stopped = false;

function stop() {
  if (stopped) return;
  stopped = true;
  try { stopServer(); } catch {}
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
      if (pending.delete(id)) reject(new Error(`${method} timed out after 30s`));
    }, 30000);
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

  /* Build a realistic project, then zip it exactly as the export button does. */
  const zip = await ev(`
    const { zip, toEntries } = await import('./js/zip.js');
    window.wgn.applyTemplate('portfolio');
    const d = window.wgn.doc();
    d.baseUrl = 'https://portfolio.test';
    d.company = 'Iris Faye Studio';
    d.email = 'hello@portfolio.test';
    // Keep the hero (it carries the h1) and attach the image to the gallery.
    const gallery = d.pages[0].blocks.find(b => b.type === 'gallery');
    gallery.items = [
      { image: { assetId: 'a1', alt: { en: 'Cover art', fr: 'Couverture' } }, caption: { en: 'Cover', fr: 'Couverture' } }
    ];
    d.assets = [{
      id: 'a1',
      name: 'work.png',
      type: 'image/png',
      // 1x1 transparent PNG
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    }];
    window.wgn.state.history.reset(d);
    const files = await window.wgn.files();
    const entries = toEntries(files);
    const blob = await zip(entries, new Date(2026, 0, 1));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return {
      size: blob.size,
      b64: btoa(bin),
      count: Object.keys(files).length,
      names: Object.keys(files)
    };
  `);
  ok("the export produces a non-empty ZIP", zip.size > 2000, `${zip.size} bytes, ${zip.count} files`);

  /* Verify the archive with a real unzip implementation, not our own writer. */
  const check = spawnSyncZip(zip.b64);
  ok("the ZIP is readable by an independent implementation", check.ok, check.error || `${check.entries.length} entries`);

  const names = check.entries.map((e) => e.name);
  const need = ["index.html", "about.html", "contact.html", "404.html", "privacy.html",
                "legal.html", "css/style.css", "js/site.js", "favicon.svg", "og.png",
                "robots.txt", "sitemap.xml", "_headers", "DEPLOY.txt", "assets/work.png"];
  const missing = need.filter((n) => !names.includes(n));
  ok("the archive contains every expected file", missing.length === 0, missing.join(", "));
  ok("no file name escapes its folder",
     !names.some((n) => n.includes("..") || n.startsWith("/") || n.includes("\\")), names.length + " names");

  /* Read the actual decompressed content back. */
  const index = check.entry("index.html");
  ok("index.html is real HTML", /^<!doctype html>/i.test(index));
  ok("index.html links the stylesheet", index.includes('href="css/style.css"'));
  ok("index.html links the script", index.includes('src="js/site.js"'));
  ok("index.html has a title", /<title>[^<]{4,}<\/title>/.test(index));
  ok("index.html has a viewport", index.includes('name="viewport"'));
  ok("index.html carries the canonical URL", index.includes('https://portfolio.test/'));
  ok("the sitemap uses the canonical URL",
     check.entry("sitemap.xml").includes("https://portfolio.test/index.html"));
  ok("robots.txt points at the sitemap",
     check.entry("robots.txt").includes("Sitemap: https://portfolio.test/sitemap.xml"));
  ok("the security headers are present",
     check.entry("_headers").includes("Content-Security-Policy") && check.entry("_headers").includes("X-Content-Type-Options"));
  ok("the deployment notes ship with the site",
     /Netlify|Cloudflare|GitHub Pages/i.test(check.entry("DEPLOY.txt")));
  /* The legal bodies come from the dictionary, with COMPANY/ADDRESS/EMAIL
     substituted from the document. Check the substitution actually happened. */
  const legalText = check.entry("legal.html").replace(/<[^>]*>/g, " ");
  const privacyText = check.entry("privacy.html").replace(/<[^>]*>/g, " ");
  ok("the legal page shows the company name", legalText.includes("Iris Faye Studio"),
     legalText.match(/.{0,40}Iris.{0,40}/)?.[0]?.trim() || legalText.slice(0, 120));
  ok("no template placeholder survived into the export",
     !/\b(COMPANY|ADDRESS|EMAIL|HOSTING_ADDRESS)\b/.test(legalText + privacyText));

  /* The image is stored as real PNG bytes, not as its data URI text. */
  const png = check.binary("assets/work.png");
  ok("the image is written as real PNG bytes",
     png && png.length > 8 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47,
     png ? `${png.length} bytes, magic ${[...png.slice(0, 4)].map((b) => b.toString(16)).join(" ")}` : "missing");
  ok("the page references the image by path", index.includes('src="assets/work.png"'));

  /* Render the exported page for real, from the file tree, with no editor code. */
  const rendered = await renderExported(check);
  ok("the exported page renders on its own, served over HTTP",
     (rendered.title || "").length > 0, JSON.stringify(rendered.title));
  /* The page title is the page's own title field ("Work"), not the site name —
     both are legitimate; what matters is that the head survived the export. */
  ok("the exported head produced a usable title",
     (rendered.title || "").length >= 3, JSON.stringify(rendered.title));
  ok("the exported stylesheet is applied", rendered.styleSheets >= 1 && rendered.bg !== "rgba(0, 0, 0, 0)",
     `bg=${rendered.bg} sheets=${rendered.styleSheets}`);
  ok("the exported typography is applied", (rendered.h1Size || 0) > 20, `h1 = ${rendered.h1Size}px`);
  ok("the exported page has a real heading", (rendered.h1 || "").length > 8, `"${rendered.h1}"`);
  ok("the exported page's nav links exist", rendered.navLinks > 0, `${rendered.navLinks} links`);
  ok("the image in the exported page loads over HTTP",
     rendered.imgLoaded === true, `naturalWidth=${rendered.naturalWidth}`);
  ok("the exported page loads no external resource",
     rendered.external === 0, `${rendered.external} external request(s)`);

  /* Render the same archive a second time with the system pinned to LIGHT.
     The dark media query used to be the only thing supplying tokens, because
     siteCss() wrote the light ones as bare top-level declarations — which CSS
     discards. A light-mode visitor therefore got no custom properties at all:
     transparent background, default 16px headings. The default render above runs
     dark, so it could never see this. */
  const lightRendered = await renderExported(check, "light");
  ok("the exported page is styled in light mode too, not just dark",
     lightRendered.bg !== "rgba(0, 0, 0, 0)" && (lightRendered.h1Size || 0) > 20,
     `bg=${lightRendered.bg} h1=${lightRendered.h1Size}px`);
  ok("light and dark are actually different renderings",
     lightRendered.bg !== rendered.bg,
     `${lightRendered.bg} vs ${rendered.bg}`);

  /* French export, read back from the archive. */
  const frZip = await ev(`
    const { zip, toEntries } = await import('./js/zip.js');
    window.wgn.applyTemplate('portfolio');
    window.wgn.setBilingual(true);
    const d = window.wgn.doc();
    d.name = { en: 'Iris Studio', fr: 'Studio Iris' };
    window.wgn.state.history.reset(d);
    const files = await window.wgn.files();
    const blob = await zip(toEntries(files), new Date(2026, 0, 1));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return { b64: btoa(bin) };
  `);
  const frCheck = spawnSyncZip(frZip.b64);
  const frNames = frCheck.entries.map((e) => e.name);
  ok("a bilingual export carries both languages",
     frNames.includes("index.html") && frNames.includes("index.fr.html"),
     frNames.filter((n) => /index/.test(n)).join(", "));
  const frIndex = frCheck.entry("index.fr.html");
  ok("the French page declares French", frIndex.includes('<html lang="fr">'));
  ok("the French page is written in French", /Studio Iris/.test(frIndex));
  ok("the French page links back to English",
     /hreflang="en"/.test(frIndex) && frIndex.includes('href="index.html"'));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} export checks passed`);
  stop();
  // `failed` is an array: an empty array is truthy in JS, so `failed ? 1 : 0` exits 1 even
  // when every check passed.
  process.exit(failed.length ? 1 : 0);
  process.exit(failed.length ? 1 : 0);
}

/** Read the archive with `unzip -l` / a pure-JS reader, NOT our own zip.js. */
function spawnSyncZip(b64) {
  const out = { ok: false, entries: [], error: "" };
  try {
    const buf = Buffer.from(b64, "base64");
    // Minimal independent reader: locate the central directory from the EOCD,
    // then walk its records. Deliberately does not use the app's writer.
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("no end-of-central-directory record");
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central header at ${i}`);
      const method = buf.readUInt16LE(p + 10);
      const csize = buf.readUInt32LE(p + 20);
      const usize = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const cmtLen = buf.readUInt16LE(p + 32);
      const localOff = buf.readUInt32LE(p + 42);
      const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");

      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.slice(dataStart, dataStart + csize);
      let body = raw;
      if (method === 8) body = zlibInflateRawSync(raw);
      if (body.length !== usize) throw new Error(`${name}: size mismatch ${body.length} != ${usize}`);
      entries.push({ name, method, body });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    out.ok = true;
    out.entries = entries.map((e) => ({ name: e.name, method: e.method }));
    out.all = entries;
  } catch (e) {
    out.error = e.message;
  }
  out.entry = (name) => {
    const e = out.all?.find((x) => x.name === name);
    return e ? e.body.toString("utf8") : "";
  };
  out.binary = (name) => {
    const e = out.all?.find((x) => x.name === name);
    return e ? new Uint8Array(e.body) : null;
  };
  return out;
}

/**
 * Raw DEFLATE via Node's own zlib. This is the point of the exercise: the
 * archive is read back by code that shares nothing with the writer, so a bug
 * in zip.js cannot hide behind a matching bug in the reader.
 */
function zlibInflateRawSync(buf) {
  return inflateRawSync(buf);
}

/**
 * Render the exported tree the way a visitor would: write the archive's real
 * files into a throwaway folder under the app's own src/, navigate a browser at
 * it over HTTP, and look at the result.
 *
 * Nothing is stubbed. The stylesheet is the one from the ZIP, the image is the
 * one from the ZIP, and the only thing that gets removed afterwards is the
 * temporary folder.
 */
async function renderExported(zipRead, scheme = null) {
  const folder = `_export-probe-${process.pid}-${Date.now()}`;
  const base = join(ROOT, "src", folder);
  mkdirSync(base, { recursive: true });
  try {
    for (const e of zipRead.all) {
      const target = join(base, e.name);
      // The archive's own names were already checked for traversal; this is
      // belt-and-braces before touching the filesystem.
      if (!resolve(target).startsWith(resolve(base))) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, e.body);
    }

    const { targetId } = await send("Target.createTarget", { url: `http://localhost:${PORT}/${folder}/index.html` });
    const { sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true });
    const ask = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description };
      return r.result.value;
    };
    await send("Runtime.enable", {}, sid);
    await send("Page.enable", {}, sid);
    if (scheme) {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] }, sid);
    }
    await new Promise((r) => setTimeout(r, 1200));
    const info = await ask(`JSON.stringify({
      title: document.title,
      bg: getComputedStyle(document.body).backgroundColor,
      fontFamily: getComputedStyle(document.body).fontFamily,
      h1: (document.querySelector('h1') || {}).textContent || '',
      h1Size: (() => { const h = document.querySelector('h1'); return h ? parseFloat(getComputedStyle(h).fontSize) : 0; })(),
      navLinks: document.querySelectorAll('.site-nav a').length,
      imgLoaded: (() => { const i = document.querySelector('img'); return i ? (i.complete && i.naturalWidth > 0) : null; })(),
      naturalWidth: (() => { const i = document.querySelector('img'); return i ? i.naturalWidth : -1; })(),
      external: performance.getEntriesByType('resource')
        .filter(r => !r.name.startsWith(location.origin) && !r.name.startsWith('data:') && !r.name.startsWith('blob:')).length,
      styleSheets: document.styleSheets.length,
      scriptsRan: typeof document.querySelector('[data-theme-toggle]') !== 'undefined'
    })`);
    await send("Target.closeTarget", { targetId });
    return JSON.parse(info || "{}");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error("probe failed:", e.message); stop(); process.exit(1); });
for (const sig of ["exit", "SIGINT", "SIGTERM"]) process.on(sig, () => stop());
