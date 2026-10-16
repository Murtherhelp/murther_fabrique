/**
 * Archived generator checks.
 *
 *   node test/original.mjs
 *
 * ORIGINAL is the first version, kept as-is next to the rewrite. Nothing in this
 * repository tested it: the editor suites drive NEXT, and the desktop self-test
 * only proves a page appeared. So the legacy generator shipped on the strength
 * of a title, a script element and whatever static markup the document carried.
 *
 * It already knows how to check itself. At start-up it runs its own list and
 * prints the result to the console. That output was written for a human with
 * DevTools open, so nothing ever read it, and silence was indistinguishable from
 * a pass. This suite reads it, and treats silence as a failure rather than as
 * a result: the self-check has to actually report before its verdict counts.
 *
 * It is served over http rather than file:// because autosave needs a real
 * origin, and a generator that cannot restore its own state is not working.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY = join(ROOT, "..", "01-legacy-generator-ORIGINAL", "index.html");

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

if (!existsSync(LEGACY)) {
  console.log(`FAIL  the archived generator is missing at ${LEGACY}`);
  console.log("\n0/1 original checks passed");
  process.exit(1);
}

const EDGE = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

if (!EDGE) {
  console.log("No Chromium-based browser found. Install Edge or Chrome, or run the Node suite only.");
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), "mf-original-"));
let browser = null;
let ws = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  /* One file, one route. The archived generator is a single document, so a
     whole static server would be scaffolding for nothing. */
  const page = await readFile(LEGACY, "utf8");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  let nextId = 1;
  const pending = new Map();
  const send = (method, params = {}, sid) => {
    const id = nextId++;
    pending.set(id, { method });
    const p = new Promise((res, rej) => { pending.get(id).resolve = res; pending.get(id).reject = rej; });
    ws.send(JSON.stringify(sid ? { id, method, params, sessionId: sid } : { id, method, params }));
    return p;
  };

  browser = spawn(EDGE, [
    "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--hide-scrollbars", "--window-size=1440,900", "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const wsUrl = await new Promise((res, rej) => {
    let buf = "";
    const t = setTimeout(() => rej(new Error("the browser did not report a debug port")), 20000);
    browser.stderr.on("data", (d) => {
      buf += d.toString();
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) { clearTimeout(t); res(m[0]); }
    });
  });

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("devtools socket failed")); });

  const lines = [];
  const thrown = [];
  const consoleErrors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const en = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) en.reject(new Error(en.method + ": " + m.error.message));
      else en.resolve(m.result);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled") {
      const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      lines.push(text);
      if (m.params.type === "error") consoleErrors.push(text);
    }
    if (m.method === "Runtime.exceptionThrown") {
      thrown.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Page.enable");
  // Before the navigation, not after: a console message the self-check printed
  // while the document was parsing is gone for good once Runtime is enabled late.
  await S("Runtime.enable");
  await S("Page.navigate", { url });

  // Wait for the self-check to report, not merely for the page to load. A page
  // that never runs its checks has to end this loop as a failure.
  let reported = null;
  for (let i = 0; i < 60; i++) {
    await wait(250);
    const m = /self-check:\s*(\d+)\/(\d+)/.exec(lines.join("\n"));
    if (m) { reported = { pass: +m[1], total: +m[2] }; break; }
    if (lines.some((l) => /SELF-CHECK FAILED/.test(l))) break;
  }

  const state = (await S("Runtime.evaluate", {
    expression: `JSON.stringify({
      title: document.title,
      text: (document.body ? document.body.innerText : "").length,
      inputs: document.querySelectorAll("input,textarea,select,button").length,
      ready: document.readyState
    })`,
    returnByValue: true,
  })).result.value;
  const s = JSON.parse(state);

  ok("the archived generator serves and runs over a real origin",
     s.ready === "complete" && s.text > 200 && s.inputs > 20,
     `readyState=${s.ready}, ${s.inputs} controls, ${s.text} chars`);

  ok("its own self-check actually reported, rather than staying silent",
     reported !== null,
     reported ? `self-check ${reported.pass}/${reported.total}` : `no self-check line in ${lines.length} console message(s)`);

  ok("the self-check is a real list, not an empty one",
     reported !== null && reported.total > 0,
     reported ? `${reported.total} checks` : "nothing reported");

  ok("every check the legacy generator ran passed",
     reported !== null && reported.total > 0 && reported.pass === reported.total,
     reported ? `${reported.pass}/${reported.total}` : "nothing reported");

  const failedNames = lines.filter((l) => /SELF-CHECK FAILED/.test(l)).map((l) => l.split("FAILED:")[1].trim());
  ok("it named no failing check", failedNames.length === 0, failedNames.slice(0, 3).join(" | ") || "none named");

  ok("nothing threw while it started up", thrown.length === 0, thrown.slice(0, 2).join(" | ") || "no exception");

  ok("and it logged no error while doing so",
     consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | ") || "console clean");

  const verdict = failedNames.length === 0 && thrown.length === 0 &&
                  reported !== null && reported.pass === reported.total;
  server.close();
  browser.kill();
  return verdict;
}

try {
  await main();
} catch (e) {
  ok("the suite reached the archived generator", false, e.message);
}

if (browser) browser.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} original checks passed`);
process.exit(failed.length ? 1 : 0);