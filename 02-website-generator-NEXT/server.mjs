// Static file server for the generator UI. Node stdlib only, no dependencies.
// Needed because ES modules are blocked over file:// (CORS). Nothing here serves
// the generated sites, uploads anything, or accepts a request body: it is a
// read-only file server bound to localhost.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PREVIEW_GUARD } from "./src/js/preview-inline.js";
import { SITE_JS } from "./src/js/build.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "src");
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

/**
 * The editor is served under a strict policy: `script-src 'self'`, no inline,
 * no eval. The preview frame is a srcdoc document and inherits it, so its two
 * inline scripts were blocked -- the preview's theme toggle did nothing and the
 * console filled with a CSP error on every keystroke.
 *
 * Hashing them fixes that without weakening anything. The digests are computed
 * from the same exports the editor inlines, at start-up: editing either script
 * needs no matching edit here, because there is no second copy of the text.
 */
const sha256 = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

const CSP = [
  "default-src 'none'",
  // 'unsafe-inline' is granted to styles alone because the inspector builds its
  // layout with inline style attributes; that permits CSS and does not open the
  // script path.
  `script-src 'self' ${sha256(SITE_JS)} ${sha256(PREVIEW_GUARD)}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'none'",
  "font-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'self' data: blob:"
].join("; ");

const server = createServer(async (req, res) => {
  const send = (code, type, body) => {
    res.writeHead(code, {
      "content-type": type,
      "x-content-type-options": "nosniff",
      // The editor is same-origin and makes no third-party request at all.
      "content-security-policy": CSP,
      "referrer-policy": "no-referrer"
    });
    res.end(body);
  };

  // `decodeURIComponent` throws on malformed percent-encoding, and this handler is
  // async: an uncaught throw became an unhandled rejection, which kills the Node
  // process outright. One request to `/%zz` used to take the whole server down
  // and it never came back. A bad request is a 400, nothing more.
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return send(400, TYPES[".txt"], "Bad request");
  }
  if (path.endsWith("/")) path += "index.html";

  // Path traversal guard: normalise, then require the result to stay under ROOT.
  const target = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return send(403, TYPES[".txt"], "Forbidden");

  try {
    const info = await stat(target);
    if (!info.isFile()) return send(404, TYPES[".txt"], "Not found");
    const body = await readFile(target);
    send(200, TYPES[extname(target).toLowerCase()] || "application/octet-stream", body);
  } catch {
    send(404, TYPES[".txt"], "Not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MURTHER FABRIQUE -> http://localhost:${PORT}/`);
  console.log(`serving ${ROOT}`);
});