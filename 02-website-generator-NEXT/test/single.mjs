/**
 * Single-file build checks.
 *
 *   node build.mjs          (produces dist/generator.html)
 *   node test/single.mjs    (proves the result is real)
 *
 * The point of the bundle is that it opens by double-click with no server and
 * no Node, like the legacy generator. So the decisive check here loads it over
 * file:// — not over http — and asks whether it produces the same output as the
 * eleven modules it came from. A bundle that boots but builds something else is
 * worse than no bundle at all.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "generator.html");

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

/* --------------------------------------------------- 1. build it */

const build = spawn(process.execPath, ["build.mjs"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
let buildErr = "";
build.stderr.on("data", (d) => (buildErr += d.toString()));
const buildCode = await new Promise((r) => build.on("exit", r));
ok("the build runs", buildCode === 0, buildCode === 0 ? "" : buildErr.slice(0, 300));
ok("it produces dist/generator.html", existsSync(OUT));

if (!existsSync(OUT)) {
  console.log("\n0/3 single-file checks passed");
  process.exit(1);
}

const html = readFileSync(OUT, "utf8");

/* -------------------------------- 2. static: nothing external is left */

/* Only the HTML shell is checked. Inside the inlined script sit the literal
   strings that DESCRIBE the generated site — `<script src="js/site.js">` and
   friends — and those are exactly what should still be there. */
const shell = html.replace(/<script type="module">[\s\S]*?<\/script>/i, "<script type=\"module\">/* bundle */</script>");

ok("the shell has no external stylesheet or script",
   !/<link[^>]+rel=["']?stylesheet/i.test(shell) && !/<script[^>]+src=/i.test(shell));
ok("no ES import or export survives into the inlined script",
   !/^\s*(import|export)\s/m.test(html.replace(/^\s*(\/\*.*?\*\/|const __m = \{\};)/gms, "")));
ok("it really is one file: the only src/href left are data: URIs or anchors",
   !/(?:src|href)\s*=\s*"(?!data:|#)[^"]*"/i.test(shell),
   shell.match(/(?:src|href)\s*=\s*"(?!data:|#)[^"]*"/i)?.[0] || `${(html.length / 1024).toFixed(0)} KB, nothing external`);

/* ---------------------- 3. the modules it came from still behave */

const themes = await import(pathToFileURL(join(ROOT, "src/js/themes.js")).href);
const buildMod = await import(pathToFileURL(join(ROOT, "src/js/build.js")).href);
const tplMod = await import(pathToFileURL(join(ROOT, "src/js/templates.js")).href);
const storeMod = await import(pathToFileURL(join(ROOT, "src/js/store.js")).href);
const expected = {};
for (const key of tplMod.TEMPLATE_ORDER) {
  expected[key] = Object.keys(buildMod.build(storeMod.normalizeDoc(tplMod.fromTemplate(key)).doc).files).sort();
}
ok("the modular source still builds every template",
   Object.keys(expected).length === 9, `${Object.keys(expected).length} templates`);

/* --------------------------------- 4. the real thing: file:// in Chrome */

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
].find((p) => existsSync(p));

if (!EDGE) {
  console.log("\nno Chromium browser found; the file:// check could not run");
} else {
  const profile = mkdtempSync(join(tmpdir(), "wgn-single-"));
  let browser = null, ws = null, stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { ws?.close(); } catch {}
    try { browser?.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  };
  for (const s of ["exit", "SIGINT", "SIGTERM"]) process.on(s, stop);

  let nextId = 1;
  const pending = new Map();
  let S = (m, p) => send(m, p);
  function send(method, params = {}, sid) {
    const id = nextId++;
    const msg = { id, method, params };
    if (sid) msg.sessionId = sid;
    pending.set(id, { resolve: null, reject: null });
    const p = new Promise((res, rej) => { pending.get(id).resolve = res; pending.get(id).reject = rej; });
    try { ws.send(JSON.stringify(msg)); }
    catch (e) { pending.delete(id); return Promise.reject(new Error(method + ": " + e.message)); }
    return p;
  }
  async function ev(body) {
    const r = await S("Runtime.evaluate", { expression: `(async () => {\n${body}\n})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || "threw" };
    return r.result.value;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // file:// — no server, exactly what a double-click gives you
  const fileUrl = pathToFileURL(OUT).href + "?probe=1";
  browser = spawn(EDGE, ["--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--hide-scrollbars", "--window-size=1440,900", "--allow-file-access-from-files", fileUrl],
    { stdio: ["ignore", "pipe", "pipe"] });

  const wsUrl = await new Promise((res, rej) => {
    let buf = ""; const t = setTimeout(() => rej(new Error("no debug port")), 20000);
    browser.stderr.on("data", (d) => { buf += d.toString(); const m = /ws:\/\/[^\s]+/.exec(buf); if (m) { clearTimeout(t); res(m[0]); } });
  });
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("socket")); });
  const consoleErrors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const en = pending.get(m.id); pending.delete(m.id);
      if (m.error) en.reject(new Error(en.method + ": " + m.error.message)); else en.resolve(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown")
      consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  S = (m, p) => send(m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable");
  await S("Page.navigate", { url: fileUrl });
  for (let i = 0; i < 40; i++) {
    await wait(250);
    const ready = await S("Runtime.evaluate", { expression: "!!window.wgn", returnByValue: true });
    if (ready.result.value) break;
  }

  const boot = await ev("return { probe: !!window.wgn, errors: window.wgn ? window.wgn.errors() : null };");
  ok("the single file opens straight from disk with no server",
     boot.probe === true && Array.isArray(boot.errors) && boot.errors.length === 0,
     JSON.stringify(boot));

  const same = await ev(`
    const want = ${JSON.stringify(expected)};
    const bad = [];
    for (const key of Object.keys(want)) {
      window.wgn.applyTemplate(key);
      await new Promise(r => setTimeout(r, 120));
      const got = Object.keys(window.wgn.build().files).sort();
      if (JSON.stringify(got) !== JSON.stringify(want[key])) {
        bad.push(key + ': got ' + got.length + ' want ' + want[key].length);
      }
    }
    return { bad, templates: Object.keys(want).length };
  `);
  ok("the single file builds the identical file tree, template by template",
     same.bad.length === 0, same.bad.join(" | ") || `${same.templates} templates`);

  const feat = await ev(`
    window.wgn.applyTemplate('business');
    window.wgn.setBilingual(true);
    await new Promise(r => setTimeout(r, 300));
    const f = window.wgn.build().files;
    const files = await window.wgn.files();
    return {
      bilingual: !!f['index.fr.html'],
      exportFiles: Object.keys(files).length,
      contrastRows: document.querySelectorAll('#designFields .cr').length,
      named: [...document.querySelectorAll('.node')].filter(n => (n.getAttribute('aria-label')||'').trim()).length,
      nodes: document.querySelectorAll('.node').length,
      audit: window.wgn.audit().length,
      hasZip: typeof window.wgn.files === 'function'
    };
  `);
  ok("bilingual output, export and the quality report all work from the bundle",
     feat.bilingual && feat.exportFiles > 15 && feat.audit >= 10,
     `${feat.exportFiles} files, ${feat.audit} checks`);
  ok("the accessibility fixes survive the build",
     feat.contrastRows === 15 && feat.nodes > 0 && feat.named === feat.nodes,
     `${feat.named}/${feat.nodes} named, ${feat.contrastRows} contrast rows`);
  ok("no console errors from the bundle", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  stop();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} single-file checks passed`);
process.exit(failed.length ? 1 : 0);