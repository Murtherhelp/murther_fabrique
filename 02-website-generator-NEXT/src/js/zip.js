/**
 * ZIP writer. No dependency, and none needed:
 *
 *   - DEFLATE comes from the platform's own `CompressionStream("deflate-raw")`,
 *     which is exactly what a ZIP entry (method 8) wants. No pako, no fflate.
 *   - CRC-32 is 12 lines. Node has `zlib.crc32` since 20.12, but the browser
 *     does not, so one implementation covers both runtimes and the test suite.
 *
 * If `CompressionStream` is missing, entries fall back to STORED (method 0),
 * which is always valid — a bigger archive beats a broken download.
 */

const enc = new TextEncoder();

let TABLE = null;
/** Build the CRC table once, lazily: 256 entries of pure arithmetic. */
function table() {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  return TABLE;
}

export function crc32(u8) {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** "data:image/png;base64,AAA" -> bytes. Returns null for anything else. */
export function decodeDataUri(uri) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(uri || ""));
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function deflateRaw(u8) {
  if (typeof CompressionStream !== "function") return null;
  try {
    const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

const mkdir = (size) => new Uint8Array(size);
const u16 = (dv, o, v) => dv.setUint16(o, v, true);
const u32 = (dv, o, v) => dv.setUint32(o, v >>> 0, true);

/** MS-DOS date/time. Deterministic when `when` is given, so tests can compare. */
function dosStamp(when) {
  const d = when || new Date();
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/**
 * @param {[string, string|Uint8Array][]} entries path -> content
 * @returns {Promise<Blob>}
 */
export async function zip(entries, when) {
  const { time, date } = dosStamp(when);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [path, content] of entries) {
    const name = enc.encode(path);
    const data = typeof content === "string" ? enc.encode(content) : content;
    const crc = crc32(data); // always the CRC of the UNCOMPRESSED bytes
    const packed = await deflateRaw(data);
    // ponytail: per-entry size check. Deflate can make incompressible input
    // bigger (already-compressed PNGs), and a method-8 entry larger than its
    // source is wasted space for no gain.
    const useDeflate = packed && packed.length < data.length;
    const body = useDeflate ? packed : data;
    const method = useDeflate ? 8 : 0;

    const l = mkdir(30);
    const lv = new DataView(l.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20); // version needed
    u16(lv, 6, 0x0800); // UTF-8 names
    u16(lv, 8, method);
    u16(lv, 10, time);
    u16(lv, 12, date);
    u32(lv, 14, crc);
    u32(lv, 18, body.length); // compressed
    u32(lv, 22, data.length); // uncompressed
    u16(lv, 26, name.length);
    u16(lv, 28, 0);
    locals.push(l, name, body);

    const c = mkdir(46);
    const cv = new DataView(c.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 0x0800);
    u16(cv, 10, method);
    u16(cv, 12, time);
    u16(cv, 14, date);
    u32(cv, 16, crc);
    u32(cv, 20, body.length);
    u32(cv, 24, data.length);
    u16(cv, 28, name.length);
    u16(cv, 30, 0); // extra field length
    u16(cv, 32, 0); // comment length
    u16(cv, 34, 0); // disk number start
    u16(cv, 36, 0); // internal attributes
    // External attributes: a regular file with 0644 permissions.
    u32(cv, 38, (((0o100 << 16) >>> 0) | ((0o644 << 16) >>> 0)) >>> 0);
    u32(cv, 42, offset); // relative offset of the local header
    centrals.push(c, name);

    offset += l.length + name.length + body.length;
  }

  const size = centrals.reduce((a, b) => a + b.length, 0);
  const n = entries.length;
  const end = mkdir(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, n);
  u16(ev, 10, n);
  u32(ev, 12, size);
  u32(ev, 16, offset);
  return new Blob([...locals, ...centrals, end], { type: "application/zip" });
}

/**
 * Turn a `build()` file tree into ZIP entries, decoding data URIs to bytes.
 * A value that is not a data URI is written as text, which is what every
 * generated file is.
 */
/**
 * Write an export map into a picked directory. Returns the number of files.
 *
 * The map is keyed by site-relative path, and every template's paths carry
 * directories -- css/style.css and js/site.js, in all nine of them -- while
 * `getFileHandle` refuses any name holding a separator. Without the loop below
 * the write throws on the second file, after the HTML pages are already on
 * disk: the user gets a folder of unstyled pages, and a message blaming their
 * browser for it.
 */
export async function writeFilesTo(dir, files) {
  const enc = new TextEncoder();
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    let d = dir;
    for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
    const file = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await file.createWritable();
    // Data URIs are stored as text in the document; write real bytes.
    const bytes = typeof content === "string" && content.startsWith("data:") ? decodeDataUri(content) : content;
    await w.write(bytes ?? enc.encode(String(content)));
    await w.close();
  }
  return Object.keys(files).length;
}

export function toEntries(files) {
  return Object.entries(files).map(([path, content]) => {
    if (typeof content === "string" && content.startsWith("data:")) {
      const bytes = decodeDataUri(content);
      return [path, bytes || new TextEncoder().encode("")];
    }
    return [path, content];
  });
}

/** Trigger a download without leaving the page. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}