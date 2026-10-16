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
import { EFFECTS } from "../src/js/blocks.js";
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
// Console errors and uncaught exceptions, per CDP session. The exported-page
// probe clears this before it navigates and reports what arrived after.
const pageProblems = [];
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
      return;
    }
    // Whatever a page logs or throws, attributed to the session it came from.
    // This connection is shared: the editor and each exported page are separate
    // targets, so an unfiltered catch would blame one page for another's noise.
    // Until now nothing listened at all, which meant an exception thrown by the
    // site.js shipped on every generated site passed this suite in silence.
    if (m.method === "Runtime.exceptionThrown") {
      const where = m.sessionId || "?";
      pageProblems.push(`${where}: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      pageProblems.push(`${m.sessionId || "?"}: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
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

  /* The social card. Two suites require the NAME; nobody looked at the bytes.
     A canvas that drew nothing still produces a valid PNG - a flat rectangle of
     one colour, a few hundred bytes - and that ships silently. */
  const og = check.all.find((e) => e.name === "og.png");
  const ogBytes = og ? Buffer.from(og.body) : null;
  const isPng = ogBytes && ogBytes.length > 24 &&
    ogBytes[0] === 0x89 && ogBytes.subarray(1, 4).toString("latin1") === "PNG";
  ok("the social card is a real PNG", isPng,
     ogBytes ? `magic=${ogBytes.subarray(0, 4).toString("hex")}` : "og.png is missing");
  if (isPng) {
    // IHDR: width and height are big-endian 32-bit values at offsets 16 and 20.
    const w = ogBytes.readUInt32BE(16), h = ogBytes.readUInt32BE(20);
    ok("the social card is the size every platform asks for", w === 1200 && h === 630, `${w}x${h}`);
    // A flat fill compresses to almost nothing. Text and an accent rule do not.
    ok("the social card actually has something drawn on it", ogBytes.length > 3000,
       `${ogBytes.length} bytes - a blank 1200x630 fill is under 1 KB`);
  }

  /* Read the actual decompressed content back. */
  const index = check.entry("index.html");
  ok("index.html is real HTML", /^<!doctype html>/i.test(index));
  ok("index.html links the stylesheet", index.includes('href="css/style.css"'));
  ok("index.html links the script", index.includes('src="js/site.js"'));
  ok("index.html has a title", /<title>[^<]{4,}<\/title>/.test(index));
  ok("index.html has a viewport", index.includes('name="viewport"'));
  const favicon = check.entry("favicon.svg");
  ok("index.html links the favicon it ships", /<link rel="icon"[^>]*href="favicon\.svg"/.test(index),
     (index.match(/<link rel="icon"[^>]*>/) || ["no icon link"])[0]);
  ok("the favicon is an SVG, not an empty placeholder",
     /<svg[\s>]/.test(favicon) && /<\/svg>/.test(favicon) && favicon.length > 200,
     `${favicon.length} bytes`);
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

  // The generated site is the product. Its own script has to work, not merely
  // produce a page that renders.
  const tg = rendered.toggle || {};
  ok("the exported page ships a visible theme toggle with an accessible name",
     tg.present === true && tg.visible === true && tg.w > 0 && (tg.name || "").length > 0,
     tg.present ? `${tg.tag} ${tg.w}x${tg.h}, name="${tg.name}", visible=${tg.visible}` : "no toggle on the page");
  ok("clicking the theme toggle actually switches the page",
     tg.present === true && tg.visible === true && !!tg.after && tg.after !== tg.bg,
     tg.after ? `${tg.bg} -> ${tg.after}` : "not clicked");
  ok("and it switches back, leaving the page as it was found",
     tg.after && tg.restored === tg.bg,
     tg.restored ? `${tg.after} -> ${tg.restored}` : "no return trip");
  const probs = rendered.problems || [];
  ok("the generated site logs no error and throws nothing while it runs",
     probs.length === 0,
     probs.slice(0, 2).join(" | ") || "console clean, no exception");
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

  /* Every "look", on every template, measured rather than assumed.
     An accent fill painted itself in --accent while everything inside it kept
     --ink, --muted or --accent: present in the DOM, invisible on screen. The
     quality report never saw it, because its fifteen pairs only measure what
     sits on the page background.

     This goes through the real pipeline - applyTemplate, then the effect
     field, then the export button - rather than patching the finished HTML, so
     it also covers withEffect() and the dispatcher. Each template's blocks get
     the looks round-robin, so one render covers all eight at once and all nine
     templates across the run. Both colour schemes: the tokens are emitted
     twice, and a palette that only reads well in one of them is broken. */
  const lookRuns = await ev(`
    const { toEntries, zip } = await import('./js/zip.js');
    const { EFFECTS } = await import('./js/blocks.js');
    const looks = EFFECTS.map(([value]) => value).filter(v => v !== 'none');
    const out = [];
    for (const template of window.wgn.templates()) {
      window.wgn.applyTemplate(template);
      const d = window.wgn.doc();
      d.baseUrl = 'https://look.test';
      d.company = 'Look Co';
      d.email = 'hello@look.test';
      // Both languages, because half of a bilingual site is .fr.html files and
      // a French visitor is not a visitor with fewer pixels to read.
      d.meta.bilingual = true;
      let i = 0;
      for (const p of d.pages) for (const b of p.blocks) b.effect = looks[i++ % looks.length];
      window.wgn.state.history.reset(d);
      const files = await window.wgn.files();
      const blob = await zip(toEntries(files), new Date(2026, 0, 1));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      const CH = 0x8000;
      for (let k = 0; k < bytes.length; k += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(k, k + CH));
      }
      out.push({ template, count: Object.keys(files).length, b64: btoa(bin),
             // From the files themselves, not from the document: a bilingual
             // project emits a .fr.html for every page, and those are the half
             // of the site a French visitor sees. The 404 and the legal pages
             // carry no sections, so they have nothing to measure.
             pages: Object.keys(files).filter(f => f.endsWith('.html') && !/^(404|privacy|legal)/.test(f)) });
    }
    return out;
  `);

  for (const scheme of [null, "light"]) {
    const perPage = [];
    for (const run of lookRuns || []) {
      const read = spawnSyncZip(run.b64);
      const rendered = await renderExported(read, scheme);
      if (!read.ok) ok(`template "${run.template}" exports a readable archive (${scheme || "dark"})`, false, read.error);
      // Every page, not just the home page. A template puts different blocks on
      // each one, and the blocks added last - the timeline, the skills, the
      // logo strip - landed on the about page of a template nobody was opening.
      // The .fr.html twin is checked for equivalence further down rather than
      // measured again: contrast is a property of the colour pair, not of the
      // string sitting on it.
      for (const page of (run.pages || ["index.html"]).filter((p) => !p.endsWith(".fr.html"))) {
        const r = page === "index.html" ? rendered : await renderExported(read, scheme, page);
        perPage.push({
          template: run.template, page,
          worst: r.look?.worst ?? 0,
          sampled: r.look?.sampled ?? 0,
          sections: r.look?.sections ?? 0,
          looks: r.look?.perLook ?? {},
          components: r.look?.components ?? {},
          first: r.look?.first,
          detail: r.look?.detail
        });
      }
    }
    const expected = (lookRuns || []).reduce((n, r) => n + (r.pages || []).filter((p) => !p.endsWith(".fr.html")).length, 0);
    const broken = perPage.filter((t) => t.sections > 0 && t.worst < 4.5);
    const unmeasured = perPage.filter((t) => t.sections === 0);
    const measured = perPage.filter((t) => t.sections > 0);
    const weakest = measured.slice().sort((a, b) => a.worst - b.worst)[0];
    ok(`every look stays readable on every page of every template (${scheme || "dark"})`,
       perPage.length === expected && expected > 0 && broken.length === 0 && !!weakest,
       `${measured.length}/${perPage.length} pages with sections, ${perPage.reduce((n, t) => n + t.sampled, 0)} elements measured, worst ${weakest?.worst.toFixed(2)}:1 on ${weakest?.template}/${weakest?.page}${unmeasured.length ? `, nothing to measure on ${unmeasured.map((t) => t.template + "/" + t.page).join(", ")}` : ""}${broken.length ? ` - failing: ${broken.map((b) => b.template + "/" + b.page + " " + b.worst.toFixed(2) + " [" + b.first + "] " + (b.detail || "")).join("; ")}` : ""}`);

    // No look may be missing from the run: a look that never got exercised is
    // not a look that passed.
    const seen = new Set(perPage.flatMap((t) => Object.keys(t.looks)));
    const missing = (EFFECTS.map(([v]) => v).filter((v) => v !== "none")).filter((v) => !seen.has(v));
    ok(`every look was actually exercised (${scheme || "dark"})`, missing.length === 0,
       `measured: ${[...seen].join(", ")}${missing.length ? ` - never exercised: ${missing.join(", ")}` : ""}`);

    // The components added last live on the about page of one template and the
    // home page of another. A suite that opened only index.html would never see
    // half of them, and would still report green.
    const NEW = ["steps", "skills", "logos", "quote", "time"];
    const rendered = {};
    for (const t of perPage) for (const [k, n] of Object.entries(t.components)) rendered[k] = (rendered[k] || 0) + n;
    const notRendered = NEW.filter((c) => !rendered[c]);
    ok(`the last five sections reached a browser and were measured (${scheme || "dark"})`,
       notRendered.length === 0,
       `${NEW.map((c) => c + "=" + (rendered[c] || 0)).join(" ")}${notRendered.length ? ` - never rendered: ${notRendered.join(", ")}` : ""}`);

    // The French twin of each page shares the stylesheet and the section set,
    // so its contrast is the same measurement. That is a claim, so it gets
    // checked - against the markup rather than a second render, because which
    // sections a page carries is decided in the HTML, not by the renderer.
    const frDrift = [];
    let frChecked = 0;
    for (const run of lookRuns || []) {
      const read = spawnSyncZip(run.b64);
      const byName = new Map(read.all.map((e) => [e.name, e.body.toString("utf8")]));
      for (const name of (run.pages || []).filter((p) => p.endsWith(".fr.html"))) {
        const twin = byName.get(name.replace(".fr.html", ".html"));
        const fr = byName.get(name);
        if (!twin || !fr) { frDrift.push(`${run.template}/${name}: missing file`); continue; }
        const sections = (html) => [...html.matchAll(/<section class="([^"]*)"/g)]
          .map((m) => [...m[1].split(/\s+/)].filter((c) => c === "section" || c.startsWith("fx-")).join("."))
          .join("|");
        frChecked++;
        if (sections(fr) !== sections(twin)) {
          frDrift.push(`${run.template}/${name}: ${sections(fr)} vs ${sections(twin)}`);
        }
      }
    }
    ok(`every French page carries the same sections as its English twin (${scheme || "dark"})`,
       frChecked > 0 && frDrift.length === 0,
       frDrift.length ? frDrift.join("; ") : `${frChecked} French pages, same sections in the same order`);

    // A comparator that always says "same" proves nothing, so it is shown two
    // pages that genuinely differ.
    const sample = (lookRuns || [])[0];
    if (sample) {
      const read = spawnSyncZip(sample.b64);
      const byName = new Map(read.all.map((e) => [e.name, e.body.toString("utf8")]));
      const signature = (html) => [...html.matchAll(/<section class="([^"]*)"/g)]
        .map((m) => [...m[1].split(/\s+/)].filter((c) => c === "section" || c.startsWith("fx-")).join("."))
        .join("|");
      const names = [...byName.keys()].filter((n) => n.endsWith(".html") && !n.endsWith(".fr.html"));
      const distinct = names.some((a) => names.some((b) => a !== b && signature(byName.get(a)) !== signature(byName.get(b))));
      ok("the French-page check can tell two different pages apart", distinct,
         distinct ? "comparing pages really does compare them" : "every page looks identical - the comparison is vacuous");

    // The pages with no sections: the 404, the legal notice and the privacy
    // policy. They carry no look, so the question is only whether they clear
    // the audited text pairs, and they do use --ink and --muted on --bg.
    // Measured on one template: build.js writes all three from the same
    // template, so a second palette would repeat the same pair.
    const chrome = ["404.html", "privacy.html", "legal.html"];
    const first = (lookRuns || [])[0];
    if (first) {
      const read = spawnSyncZip(first.b64);
      for (const page of chrome) {
        if (!read.all.some((e) => e.name === page)) { frDrift.push(`missing ${page}`); continue; }
        for (const scheme of [null, "light"]) {
          const r = await renderExported(read, scheme, page);
          const p = r.page;
          ok(`${page} stays readable (${scheme || "dark"})`, (p?.worst ?? 0) >= 4.5 && (p?.sampled ?? 0) > 0,
             p?.sampled ? `worst ${p.worst.toFixed(2)}:1 over ${p.sampled} elements — ${p.first} ${p.detail}` : "nothing was measured");
        }
      }
    }
    }
  }

  /* Every block type under every look.
     The nine templates each exercise a handful of blocks with a handful of
     looks; the combination nobody ships - a link inside a card inside a section
     - is exactly where a colour scheme falls over. All eighteen at once, once
     per look, in both colour schemes. Outside the loop above on purpose: this
     one iterates the schemes itself. */
  const buildAllInOne = async (look) => ev(`
    const { toEntries, zip } = await import('./js/zip.js');
    window.wgn.applyTemplate('blank');
    const d = window.wgn.doc();
    d.baseUrl = 'https://all.test';
    d.company = 'All Co';
    d.email = 'hello@all.test';
    d.meta.bilingual = false;
    d.theme.motion = 'expressive';
    d.pages[0].blocks = window.wgn.blockOrder().map((type, i) => ({ ...window.wgn.makeBlock(type), id: 'b' + i, effect: '${look}' }));
    window.wgn.state.history.reset(d);
    const files = await window.wgn.files();
    const blob = await zip(toEntries(files), new Date(2026, 0, 1));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    const CH = 0x8000;
    for (let k = 0; k < bytes.length; k += CH) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + CH));
    return { b64: btoa(bin), types: d.pages[0].blocks.map(b => b.type) };
  `);

  for (const look of EFFECTS.map(([v]) => v).filter((v) => v !== "none")) {
    const run = await buildAllInOne(look);
    for (const scheme of [null, "light"]) {
      const r = await renderExported(spawnSyncZip(run.b64), scheme);
      // WCAG asks 4.5:1 for text and 3:1 for a graphical object that carries
      // information. A skill bar is the second: holding it to the text
      // threshold flagged a passing design as a failure.
      ok(`all ${run.types.length} block types under the "${look}" look (${scheme || "dark"})`,
         (r.look?.textWorst ?? 0) >= 4.5 && (r.look?.fillWorst ?? 99) >= 3 && (r.look?.sampled ?? 0) > 0,
         `text ${(r.look?.textWorst ?? 0).toFixed(2)}:1 (needs 4.5), fills ${(r.look?.fillWorst ?? 0).toFixed(2)}:1 (needs 3), ${r.look?.sampled ?? 0} elements in ${r.look?.sections ?? 0} sections — ${r.look?.first || "none"}`);
    }
  }

  /* Printed on paper. Animations never run in print, and every entrance rule
     here uses animation-fill-mode: both - which leaves an element sitting at
     the animation's "from" state, opacity 0, if the browser holds that state.
     A site that prints blank is worse than a site that prints plainly, and no
     other check would ever see it. The document above has motion switched on
     precisely so this has something to catch. */
  {
    const run = await buildAllInOne("soft");
    const read = spawnSyncZip(run.b64);
    for (const [label, media] of [["screen", null], ["print", "print"]]) {
      const r = await renderExported(read, null, "index.html", media);
      ok(`nothing is left invisible when the page is ${label === "print" ? "printed" : "shown"} (${label})`,
         (r.visible?.total ?? 0) > 20 && (r.visible?.hidden ?? 1) === 0,
         `${r.visible?.total ?? 0} elements, ${r.visible?.hidden ?? 0} invisible${r.visible?.sample?.length ? " — " + r.visible.sample.join("; ") : ""}`);
      ok(`every marker-less list keeps its list semantics (${label})`,
         (r.lists?.bare?.length ?? 1) === 0 && (r.lists?.fixed?.length ?? 0) > 0,
         `${r.lists?.fixed?.length ?? 0} lists carry role="list"${r.lists?.bare?.length ? ", missing: " + r.lists.bare.join(", ") : ""}`);
      ok(`no card grid shows a bullet or the browser's indent (${label})`,
         (r.lists?.stray?.length ?? 1) === 0,
         (r.lists?.stray?.length ?? 0) ? r.lists.stray.slice(0, 3).join(" | ") : "grids are clean");

      const ax = r.a11y || {};
      const missingLandmarks = ["header", "nav", "main", "footer"].filter((t) => !(ax.landmarks || []).includes(t));
      ok(`the ${label} page has its four landmarks`, missingLandmarks.length === 0,
         `found ${(ax.landmarks || []).join(", ")}${missingLandmarks.length ? " - missing " + missingLandmarks.join(", ") : ""}`);
      ok(`every control on the ${label} page has an accessible name`, (ax.nameless?.length ?? 1) === 0,
         ax.nameless?.length ? ax.nameless.slice(0, 4).join(", ") : "none missing");
      ok(`heading levels on the ${label} page never skip a step`, (ax.headingJumps?.length ?? 1) === 0,
         ax.headingJumps?.length ? ax.headingJumps.join(", ") : "no jumps");
      ok(`the skip link on the ${label} page is first, targets main, and shows a focus ring`,
         ax.skip?.present === true && ax.skip?.target === true && ax.skip?.focused === true &&
           (ax.skip?.outlined ?? 0) > 0,
         // Its position is deliberately NOT asserted here: reading it straight
         // after a programmatic focus returned the pre-focus value on screen and
         // the post-focus value in print, with identical CSS. The rule itself is
         // checked in the core suite, where the answer is deterministic.
         `present=${ax.skip?.present} first=${ax.skip?.first} target=${ax.skip?.target} focused=${ax.skip?.focused} matchesFocus=${ax.skip?.matchesFocus} outline=${ax.skip?.outlined}px`);
    }
  }

  /* French export, read back from the archive. */
  const frZip = await ev(`
    const { zip, toEntries } = await import('./js/zip.js');
    window.wgn.applyTemplate('portfolio');
    window.wgn.setBilingual(true);
    const d = window.wgn.doc();
    d.name = { en: 'Iris Studio', fr: 'Studio Iris' };
    // The same bilingual alt the English archive carries. Without an image on
    // this page there is nothing to check, and a check that cannot fail is worse
    // than no check: it reads as coverage.
    const g = d.pages[0].blocks.find(b => b.type === 'gallery');
    g.items = [{ image: { assetId: 'a1', alt: { en: 'Cover art', fr: 'Couverture' } }, caption: { en: 'Cover', fr: 'Couverture' } }];
    d.assets = [{ id: 'a1', name: 'work.png', type: 'image/png',
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }];
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

  // The alt is a bilingual pair on the document, not a string with an accent on
  // it. Nothing below asserts that the language actually reaches the rendered
  // attribute: T(alt, lang) could pass every other test while always returning
  // the English half, and the French site would quietly describe its images in
  // the wrong language for a screen reader.
  const enIndex = frCheck.entry("index.html");
  // width="800" is the gallery figure (blocks.js renders it at 800x600). Taking
  // the first <img> on the page instead would read the hero, whose template ships
  // an empty alt on purpose, and pass or fail for an unrelated reason.
  const altOf = (html) => (/<img\b[^>]*\bwidth="800"[^>]*>/.exec(html) || ["" ])[0].match(/\balt="([^"]*)"/)?.[1] ?? "(no 800px image)";
  ok("the English page describes its image in English", altOf(enIndex) === "Cover art", `alt="${altOf(enIndex)}"`);
  ok("the French page describes the same image in French", altOf(frIndex) === "Couverture", `alt="${altOf(frIndex)}"`);
  ok("the French page carries no leftover English alt",
     !/alt="Cover art"/.test(frIndex), "no English alt survives on the French page");

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} export checks passed`);
  stop();
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
async function renderExported(zipRead, scheme = null, page = "index.html", media = null) {
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

    // Opened blank on purpose and navigated after attaching: a target created
    // straight at the page can answer a probe before it has navigated, and
    // `about:blank` reports readyState "complete" with a body and no content -
    // so a fixed sleep measured the blank tab and reported zero sections.
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true });
    const ask = async (expr, label = 'probe') => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      if (r.exceptionDetails) {
        throw new Error(label + " threw at line " + (r.exceptionDetails.lineNumber ?? "?") + ": " +
          (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      }
      return r.result.value;
    };
    await send("Runtime.enable", {}, sid);
    await send("Page.enable", {}, sid);
    if (scheme) {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] }, sid);
    }
    if (media) {
      await send("Emulation.setEmulatedMedia", { media }, sid);
    }
    // Wait for the document, not for a stopwatch. This suite renders forty-odd
    // pages in a row; a fixed 1200 ms is enough on a quiet machine and not
    // enough on a busy one, and a page measured before its stylesheet landed
    // reports zero sections - which reads as a design failure.
    pageProblems.length = 0;
await send("Page.navigate", { url: `http://localhost:${PORT}/${folder}/${page}` }, sid);
    await send("Page.bringToFront", {}, sid);
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      ready = await ask(`location.pathname.endsWith('/${page}') && document.readyState === 'complete' && !!document.body`);
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) throw new Error(`${folder}/${page} never finished loading`);
    // Then wait for the entrance animations to finish. The visibility check
    // below asks whether anything is left at opacity 0; measuring mid-animation
    // answers that question about the animation, not about the page. Capped,
    // because a document with an endless animation would hang the suite.
    for (let i = 0; i < 40; i++) {
      const running = await ask("document.getAnimations ? document.getAnimations().some(a => a.playState === 'running') : false");
      if (!running) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // One frame for layout and computed styles to settle.
    await new Promise((r) => setTimeout(r, 120));
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
      // typeof on a querySelector result can never be 'undefined', so the old
      // wording asserted nothing at all: it was true on every page ever rendered.
      scriptsRan: !!document.querySelector('[data-theme-toggle]'),
      // Everything a reader would actually see: no element left at the start
      // of an entrance animation, nothing transparent, nothing off-screen. A
      // printed page is the case where animations never run.
      // A marker-less list is out of the accessibility tree in WebKit unless
      // role="list" puts it back. Chrome keeps the semantics either way, so the
      // browser cannot prove this; the attribute is what is checked.
      lists: (() => {
        const bare = [], fixed = [], stray = [];
        for (const el of document.querySelectorAll('ul, ol')) {
          const s = getComputedStyle(el);
          // "Marker-less" means the marker is suppressed, nothing else. Treating
          // display:grid as equivalent was wrong and hid a real defect: Chrome
          // still paints a disc beside every item of a grid list, so a broken
          // .grid rule shipped a bullet next to every card while this file
          // called the list marker-less and only asked for role="list".
          if (s.listStyleType !== 'none') continue;
          const name = el.tagName.toLowerCase() + '.' + (el.className || '-');
          (el.getAttribute('role') === 'list' ? fixed : bare).push(name);
        }
        // Every card grid must also give back the browser's own indent, or the
        // cards sit 40px right of the heading they belong to.
        for (const el of document.querySelectorAll('ul.grid, ol.grid')) {
          const s = getComputedStyle(el);
          if (s.listStyleType !== 'none' || parseFloat(s.paddingLeft) !== 0) {
            stray.push((el.className || '-') + ': list-style=' + s.listStyleType + ' padding-left=' + s.paddingLeft);
          }
        }
        return { bare, fixed, stray };
      })(),
      // Landmarks, headings and names on the generated page. The accessibility
      // suite drives the EDITOR; nothing until now had checked the artefact the
      // editor produces, which is the half a visitor actually sees.
      a11y: (() => {
        const out = { landmarks: [], nameless: [], headingJumps: [] };
        for (const t of ['header', 'nav', 'main', 'footer']) {
          if (document.querySelector(t)) out.landmarks.push(t);
        }
        const named = (el) => {
          if (el.getAttribute('aria-label')?.trim()) return true;
          if (el.getAttribute('aria-labelledby')) return true;
          if (el.id && document.querySelector('label[for="' + el.id + '"]')) return true;
          if (el.closest('label')) return true;
          if (el.getAttribute('alt')?.trim()) return true;
          if (el.getAttribute('title')?.trim()) return true;
          return !!el.textContent.trim();
        };
        for (const el of document.querySelectorAll('a, button, input, select, textarea, summary')) {
          if (el.type === 'hidden') continue;
          if (!named(el)) out.nameless.push(el.tagName.toLowerCase() + '.' + (el.className || '-'));
        }
        let last = 0;
        for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
          const n = Number(h.tagName[1]);
          if (last && n > last + 1) out.headingJumps.push(h.tagName + ' after h' + last);
          last = n;
        }
        // The skip link: first in the tab order, and it has to become visible
        // when focused. Position absolute with a far-off left edge is fine
        // until focus, and wrong after it.
        const skip = document.querySelector('a.skip');
        out.skip = {
          present: !!skip,
          first: document.body.firstElementChild === skip || (skip && skip.compareDocumentPosition(document.querySelector('main')) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false),
          target: !!(skip && document.querySelector(skip.getAttribute('href'))),
          offLeft: 0
        };
        if (skip) {
          // element.focus() on a background tab can be ignored, which reads as a
          // broken skip link rather than as an unfocused tab.
          skip.focus();
          out.skip.focused = document.activeElement === skip;
          out.skip.matchesFocus = skip.matches(':focus');
          out.skip.offLeft = parseFloat(getComputedStyle(skip).left) || 0;
          out.skip.outlined = parseFloat(getComputedStyle(skip).outlineWidth) || 0;
          skip.blur();
        }
        return out;
      })(),
      visible: (() => {
        const out = { hidden: 0, total: 0, worst: '', sample: [] };
        for (const el of document.querySelectorAll('main *')) {
          const s = getComputedStyle(el);
          if (s.display === 'none') continue;
          if (!el.textContent.trim() && el.tagName !== 'IMG' && el.tagName !== 'SVG') continue;
          out.total++;
          const opacity = parseFloat(s.opacity);
          const off = s.visibility === 'hidden' || opacity < 0.9;
          if (off) {
            out.hidden++;
            if (out.sample.length < 3) out.sample.push((el.className || el.tagName) + ' opacity=' + s.opacity + ' visibility=' + s.visibility);
          }
        }
        return out;
      })(),
      look: (() => {
        const secs = document.querySelectorAll('[class*=" fx-"]');
        if (!secs.length) return null;
        // rgba parse, alpha included: "is this background transparent" must be
        // decided on the alpha, not by matching a string a browser may format
        // its own way.
        const rgba = (c) => {
          const n = (c.match(/-?[\\d.]+/g) || []).map(Number);
          return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 };
        };
        const lum = ([r, g, b]) => {
          const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
        // The background an element is actually read against: its own if it
        // paints an opaque one, otherwise the nearest ancestor that does. A
        // chip, a card and a button all carry their own fill, so measuring
        // them against the section would report failures that are not real.
        const behind = (el, skipSelf = true) => {
          // A fill is measured against what it sits on, not against itself,
          // which would always be 1.00:1.
          for (let n = skipSelf ? el.parentElement : el; n && n !== document.documentElement; n = n.parentElement) {
            const c = rgba(getComputedStyle(n).backgroundColor);
            if (c.a > 0.05) return c.rgb;
          }
          return rgba(getComputedStyle(document.body).backgroundColor).rgb;
        };
        let textWorst = 99, fillWorst = 99, sampled = 0, first = '', detail = '';
        const perLook = {};
        for (const sec of secs) {
          // Which look this section carries, so the breakdown can name it.
          const key = ([...sec.classList].find(c => c.startsWith('fx-')) || 'none').slice(3);
          if (!perLook[key]) perLook[key] = { worst: 99, n: 0 };
          for (const el of sec.querySelectorAll('a, h2, h3, h4, p, li, small, .ico, .skills__bar i, .btn, .eyebrow, figcaption, .tag')) {
            const own = getComputedStyle(el);
            if (own.display === 'none' || own.visibility === 'hidden') continue;
            // A bar is a fill, not text: measure it against what it sits on.
            const isFill = el.tagName === 'I';
            const fg = isFill ? rgba(own.backgroundColor).rgb : rgba(own.color).rgb;
            const r = ratio(fg, behind(el, isFill));
            perLook[key].worst = Math.min(perLook[key].worst, r);
            perLook[key].n++;
            if (isFill) fillWorst = Math.min(fillWorst, r);
            else textWorst = Math.min(textWorst, r);
            if (!first) {
              first = (el.className || el.tagName) + ' in ' + key + (isFill ? ' (a fill)' : ' (text)');
              const chain = [];
              for (let n = el; n && n !== document.documentElement && chain.length < 7; n = n.parentElement) {
                chain.push(n.tagName + '.' + (n.className || '-') + '=' + getComputedStyle(n).backgroundColor);
              }
              detail = own.color + ' on ' + own.backgroundColor + ' inside ' + sec.className + ' | ' + chain.join(' > ');
            }
            sampled++;
          }
        }
        const cs = getComputedStyle(secs[0]);
        // Which of the components added last actually rendered, so a suite that
        // opens only the home page cannot pass without them.
        const components = {};
        for (const sel of ['.steps', '.skills', '.logos', '.quote', '.time', '.feature', '.ico']) {
          const n = document.querySelectorAll(sel).length;
          if (n) components[sel.slice(1)] = n;
        }
        return { worst: Math.min(textWorst, fillWorst), textWorst, fillWorst, sampled, sections: secs.length, perLook, components, first, detail, bg: cs.backgroundColor, fg: cs.color };
      })()
})`, "look");

    // The same measurement over the whole document, for the pages that carry no
    // look at all: the 404, the legal notice, the privacy policy. A separate
    // expression, because one probe per question is easier to read than one
    // expression that answers three.
    const whole = await ask(`(function(){
      function rgba(c){ var n=(c.match(/-?[0-9.]+/g)||[]).map(Number); return {rgb:n.slice(0,3), a:n.length>3?n[3]:1}; }
      function lum(v){ var f=function(x){ x/=255; return x<=0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055,2.4); };
        return 0.2126*f(v[0])+0.7152*f(v[1])+0.0722*f(v[2]); }
      function behind(el){ for (var n=el; n && n!==document.documentElement; n=n.parentElement) {
          var c=rgba(getComputedStyle(n).backgroundColor); if (c.a>0.05) return c.rgb; }
        return rgba(getComputedStyle(document.body).backgroundColor).rgb; }
      var worst=99, n=0, first='', colour='';
      var els=document.querySelectorAll('h1,h2,h3,p,li,a,small,td,th,dt,dd,cite,figcaption');
      for (var i=0;i<els.length;i++){
        var el=els[i], s=getComputedStyle(el);
        if (s.display==='none'||s.visibility==='hidden') continue;
        if (!el.textContent.trim()) continue;
        var fg=rgba(s.color).rgb, bg=behind(el);
        var x=lum(fg), y=lum(bg);
        var r=((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05));
        n++;
        if (r<worst){ worst=r; first=el.className||el.tagName; colour=s.color; }
      }
      return { worst: n?worst:null, sampled:n, first:first, detail:colour };
    })()`, "whole");

    // Every site this generator produces ships js/site.js, and nothing above
    // operated it: the probes read the rendered page, they never clicked it. A
    // theme toggle that does nothing is invisible to a contrast measurement and
    // to a screenshot, and it is a control on every generated site.
    const toggleProbe = await ask(`(function(){
      var b = document.querySelector('[data-theme-toggle]');
      if (!b) return JSON.stringify({ present: false });
      var box = b.getBoundingClientRect(), cs = getComputedStyle(b);
      return JSON.stringify({ present: true, tag: b.tagName,
        name: (b.getAttribute('aria-label') || b.textContent || '').trim(),
        x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2),
        w: Math.round(box.width), h: Math.round(box.height),
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && box.width > 0 && box.height > 0,
        bg: getComputedStyle(document.body).backgroundColor });
    })()`, "toggle");
    const toggle = JSON.parse(toggleProbe || "{}");
    if (toggle.present && toggle.visible) {
      // A real press and release at the control's own centre rather than
      // element.click(), which also proves nothing is painted on top of it.
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: toggle.x, y: toggle.y, button: "left", clickCount: 1 }, sid);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: toggle.x, y: toggle.y, button: "left", clickCount: 1 }, sid);
      await new Promise((done) => setTimeout(done, 250));
      toggle.after = await ask("getComputedStyle(document.body).backgroundColor", "toggle-after");
      // Click it back. The contrast scans that follow measure the page in the
      // scheme this run pinned, and a probe that leaves the page switched makes
      // every one of them read a pairing that was never asked about.
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: toggle.x, y: toggle.y, button: "left", clickCount: 1 }, sid);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: toggle.x, y: toggle.y, button: "left", clickCount: 1 }, sid);
      await new Promise((done) => setTimeout(done, 250));
      toggle.restored = await ask("getComputedStyle(document.body).backgroundColor", "toggle-restored");
      // The generated site remembers the reader's choice, which is the point of
      // a toggle. A probe that clicks twice has therefore written a preference
      // that the next render inherits: the light pass came back dark because the
      // dark pass had just been stored. Clear it, so each render starts from the
      // state the suite pins rather than the state the previous probe left.
      await ask("localStorage.clear(), 1", "toggle-clear");
    }

await send("Target.closeTarget", { targetId });
return Object.assign(JSON.parse(info || "{}"), { page: whole, toggle, problems: pageProblems.slice() });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error("probe failed:", e.message); stop(); process.exit(1); });
for (const sig of ["exit", "SIGINT", "SIGTERM"]) process.on(sig, () => stop());
