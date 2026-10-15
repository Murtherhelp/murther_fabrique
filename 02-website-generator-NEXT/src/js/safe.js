/**
 * The trust boundary. Everything a user types or imports passes through here
 * before it reaches a preview iframe or an exported file.
 *
 * Rule of the file: escape FIRST, then decorate. Never build markup from
 * unescaped text, never build an href from an unchecked string.
 */

/** HTML-escape a value for text nodes and quoted attribute values. */
export const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/**
 * Allow-list for href/src. Returns the URL unchanged, or null.
 *
 * Rule: a URL that carries a scheme must carry an allowed one. A URL with no
 * scheme is a relative path or a fragment and is safe — that is what makes
 * `contact.html` and `index.html#gallery` work inside the generated site.
 *
 * Two traps this closes:
 *   - `//evil.com` is protocol-relative and leaves the origin; rejected above
 *     because it starts with a slash but is not a single-slash path.
 *   - stripping disallowed characters is NOT enough: "javascript:alert(1)"
 *     stripped of its parentheses is still "javascript:alert1", which still
 *     runs. The scheme check must be a rejection, not a filter.
 */
const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export const safeHref = (u) => {
  const s = String(u == null ? "" : u).trim();
  if (!s) return null;
  if (s.startsWith("//")) return null; // protocol-relative
  if (HAS_SCHEME.test(s)) return SAFE_SCHEME.test(s) ? s : null;
  return s; // relative path, query or fragment
};

/** Internal link to a generated page; falls back to the home page when unknown. */
export const pageHref = (slug, pages) =>
  pages.some((p) => p.slug === slug) ? `${slug}.html` : "index.html";

/** "Héllo World" -> "hello-world". Stable, ASCII-only, safe as a file name. */
export const slugify = (v) =>
  String(v == null ? "" : v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "page";

/** Reverse `esc`. Needed because markdown runs on already-escaped text. */
export const unesc = (v) =>
  String(v == null ? "" : v)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** Inline markdown. Input is already escaped by the caller. */
const inline = (s) =>
  s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]*)\)/g, (whole, label, href) => {
      // The text is pre-escaped, so the captured href holds `&amp;` for `&`.
      // Decode it, validate the real scheme, then re-encode exactly once.
      const raw = unesc(href);
      const safe = safeHref(raw);
      // A refused scheme keeps the label visible instead of eating the text.
      return safe ? `<a href="${esc(safe)}">${label}</a>` : label;
    });

/**
 * Minimal Markdown -> HTML. Supports ## headings, - and 1. lists, paragraphs,
 * bold/italic/code/links. Deliberately not CommonMark: a generator does not
 * need a full parser, and every construct here is testable in a few lines.
 *
 * @param {string} src  already-escaped text
 * @param {number} base heading level for the first `##` (1 => renders <h2>)
 */
export function md(src, base = 2) {
  const lines = String(src == null ? "" : src).split(/\r?\n/);
  const out = [];
  let list = null; // "ul" | "ol" | null
  let items = [];
  let para = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`), (para = []);
  };
  const closeList = () => {
    if (list) out.push(`<${list}>${items.join("")}</${list}>`);
    list = null;
    items = [];
  };
  const addItem = (tag, text) => {
    flushPara();
    if (list !== tag) {
      closeList();
      list = tag;
    }
    items.push(`<li>${inline(text)}</li>`);
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      flushPara();
      continue;
    }
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      flushPara();
      // Cap at h4 so block content can never outrank the page's own headings.
      const level = Math.min(4, base + h[1].length - 2);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      addItem("ul", ul[1]);
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      addItem("ol", ol[1]);
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  closeList();
  flushPara();
  return out.join("\n");
}

/* ---------- colour, for the theme system and the audit ---------- */

const hexOf = (h) => /^#[0-9a-f]{6}$/i.test(String(h || "").trim());
export const isHex = hexOf;

/** WCAG 2.1 relative luminance. */
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio, 1..21. Returns 1 for unparseable input. */
export const contrast = (a, b) => {
  if (!hexOf(a) || !hexOf(b)) return 1;
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Mix two colours; p=0 returns a, p=1 returns b. */
export const mix = (a, b, p) => {
  if (!hexOf(a) || !hexOf(b)) return a;
  const [A, B] = [a, b].map((h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  return (
    "#" +
    A.map((v, i) =>
      Math.round(v + (B[i] - v) * p)
        .toString(16)
        .padStart(2, "0")
    ).join("")
  );
};

/** Pick whichever of two inks reads better on `bg`. Used for auto-contrast labels. */
export const readableInk = (bg, dark = "#111111", light = "#ffffff") =>
  contrast(bg, dark) >= contrast(bg, light) ? dark : light;

/* ---------- short ids, stable within a session ---------- */

let seq = 0;
export const uid = (prefix = "b") => `${prefix}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;