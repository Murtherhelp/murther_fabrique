/**
 * Dev server checks.
 *
 *   node test/server.mjs
 *
 * Every browser suite already runs this server as a fixture, which proves it
 * starts and serves index.html. It proves nothing about what it does with a
 * request it does not like, and that is where the interesting behaviour lives.
 *
 * Three claims in server.mjs are currently made only by comments:
 *
 *   - a malformed percent-encoding is a 400. The comment adds that this handler
 *     is async and that an uncaught throw became an unhandled rejection, which
 *     killed the Node process outright: one request to /%zz used to take the
 *     whole server down. A server that answers 400 and is then dead passes any
 *     test that only looks at the status code, so every case here is followed by
 *     a request that must still work.
 *   - reads stay under src/. Note what actually stops them: normalize() already
 *     collapses every one of these paths back under the root, so the explicit
 *     `startsWith(ROOT + sep)` test further down is insurance that no input
 *     currently reaches. Removing that test changes nothing here -- measured, not
 *     assumed -- and it is kept because guessing at security boundaries is how
 *     they get deleted by accident. These checks pin the observable contract:
 *     a traversal is refused, whatever ends up refusing it.
 *   - the CSP script hashes are computed from the real exports, so editing a
 *     script cannot leave the policy stale. That is the whole point of computing
 *     them, and nothing checked it: a hash that stopped matching would block the
 *     preview in a way only a human clicking the theme toggle would notice.
 *
 * The traversal cases go out through node:http rather than fetch, because fetch
 * normalises `..` in the path before it is sent. The point is to see what the
 * server does with the bytes it actually receives.
 */
import { request } from "node:http";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { SITE_JS } from "../src/js/build.js";
import { PREVIEW_GUARD } from "../src/js/preview-inline.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5203;

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

/** Ask for a raw path, exactly as written, and get the whole answer back. */
function ask(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

const stop = await serve(PORT);
const base = `http://127.0.0.1:${PORT}`;

try {
  /* ------------------------------------------------- 1. it serves the editor */

  const root = await ask(PORT, "/");
  ok("the server answers on its root with the editor",
     root.status === 200 && /<title>/i.test(root.body),
     `${root.status}, ${root.body.length} bytes`);

  const same = await ask(PORT, "/index.html");
  ok("a directory resolves to its index.html rather than a 404",
     same.status === 200 && same.body === root.body,
     `/ -> index.html: ${same.body === root.body}`);

  /* ---------------------------------- 2. a malformed URL is a 400, not a death */

  const bad = await ask(PORT, "/%zz");
  ok("a malformed percent-encoding is answered as a bad request",
     bad.status === 400, `${bad.status}`);

  const afterBad = await ask(PORT, "/");
  ok("the server is still alive after one, which is the regression the comment describes",
     afterBad.status === 200,
     `second request: ${afterBad.status}`);

  /* ------------------------------------------ 3. reads stay under src/ */

  const escapes = [
    "/../server.mjs",
    "/../../../../Windows/win.ini",
    "/%2e%2e/server.mjs",
    "/..%5c..%5c..%5cWindows%5cwin.ini",
    "/js/../../server.mjs",
  ];
  const leaked = [];
  for (const p of escapes) {
    const r = await ask(PORT, p);
    // 403 is the guard firing, 404 is the file not being there. Both refuse.
    // Anything else that came back 200 with content would be a real escape.
    const served = r.status === 200 && r.body.length > 0;
    if (served || (r.status !== 403 && r.status !== 404)) {
      leaked.push(`${p} -> ${r.status}/${r.body.length}b`);
    }
  }
  ok("no traversal out of src/ serves a file", leaked.length === 0,
     leaked.join(" | ") || `${escapes.length} attempts, all refused`);

  const blocked = await ask(PORT, "/%2e%2e/server.mjs");
  ok("a traversal is refused by status, not answered with a page",
     blocked.status === 403 || blocked.status === 404,
     `${blocked.status}`);

  /* ------------------------------------------------- 4. headers, and the CSP */

  const h = root.headers;
  ok("every response says not to sniff its type",
     h["x-content-type-options"] === "nosniff", h["x-content-type-options"]);
  ok("every response refuses to leak its address",
     h["referrer-policy"] === "no-referrer", h["referrer-policy"]);

  const csp = h["content-security-policy"] || "";
  ok("the editor is served under a closed default policy",
     /(^|;\s*)default-src 'none'/.test(csp) && csp.includes("script-src 'self'"),
     csp.slice(0, 46) + "...");

  // Recompute the digests from the same exports the server hashes at start-up.
  // If the policy and the code could drift apart, the preview would stop running
  // and nothing in the test suite would say why.
  const sha = (t) => `'sha256-${createHash("sha256").update(t, "utf8").digest("base64")}'`;
  const wantsSite = sha(SITE_JS);
  const wantsGuard = sha(PREVIEW_GUARD);
  ok("the CSP carries the live hash of the site script",
     csp.includes(wantsSite),
     csp.includes(wantsSite) ? `${wantsSite.slice(0, 20)}...` : "hash is stale");
  ok("the CSP carries the live hash of the preview guard",
     csp.includes(wantsGuard),
     csp.includes(wantsGuard) ? `${wantsGuard.slice(0, 20)}...` : "hash is stale");

  /* ------------------------------------------------------ 5. ordinary files */

  const mod = await ask(PORT, "/js/build.js");
  ok("a module is served as JavaScript, not as a download",
     mod.status === 200 && /javascript/.test(mod.headers["content-type"] || ""),
     `${mod.status} ${mod.headers["content-type"]}`);

  const missing = await ask(PORT, "/js/nope.js");
  ok("a file that does not exist is a 404, not a 500", missing.status === 404, `${missing.status}`);

  const stillThere = await ask(PORT, "/");
  ok("the server survived every request above", stillThere.status === 200, `${stillThere.status}`);
} catch (e) {
  ok("the server suite ran to the end", false, e.message);
} finally {
  stop();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} server checks passed`);
process.exit(failed.length ? 1 : 0);