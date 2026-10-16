/**
 * Project state: the document, its schema, undo/redo, and persistence.
 *
 * THE PROJECT FORMAT (documented, versioned, portable)
 *   { format: "wgn/1", meta, theme, company, address, email, host, assets, pages }
 *
 * Every user-visible string is `{en, fr}` rather than a bare string. That is a
 * deliberate cost: a union type would need a guard at every read site and would
 * let a half-bilingual site through. One shape, checked once at load.
 *
 * Undo/redo snapshots the serialised document. It is the laziest thing that is
 * actually correct: no diff algorithm, no command objects. For a document
 * of a few hundred KB it costs less than a millisecond.
 */
import { slugify, uid } from "./safe.js";
import { bi, makeBlock, BLOCKS } from "./blocks.js";
import { FORMAT, docWarnings, RESERVED } from "./build.js";

export const LIMITS = {
  pages: 40,
  blocksPerPage: 60,
  itemsPerList: 60,
  text: 40000,
  images: 16,
  imageBytes: 2 * 1024 * 1024,
  fileBytes: 24 * 1024 * 1024
};

/** A brand-new document. One page, one block, nothing to undo. */
export function blankDoc() {
  return {
    format: FORMAT,
    name: bi("My site", "Mon site"),
    description: bi("One sentence describing this site for search engines.", "Une phrase décrivant ce site pour les moteurs de recherche."),
    baseUrl: "",
    meta: { lang: "en", bilingual: false, noindex: false },
    theme: { palette: "ink", colors: {}, radius: 8, tone: "sans", scale: "normal", scheme: "auto", motion: "none", customCss: "" },
    company: "",
    address: "",
    email: "",
    host: "",
    jsonLdType: "Organization",
    assets: [],
    pages: [
      { id: uid("p"), slug: "index", title: bi("Home", "Accueil"), menu: bi("Home", "Accueil"), desc: bi("", ""), inMenu: true, blocks: [] }
    ]
  };
}

export const newPage = () => ({
  id: uid("p"),
  slug: slugify("new page"),
  title: bi("New page", "Nouvelle page"),
  menu: bi("New page", "Nouvelle page"),
  desc: bi("", ""),
  inMenu: true,
  blocks: []
});

/* ------------------------------------------------------------ validation */

/**
 * The canonical URL must be a real http(s) origin. Stripping "unfriendly"
 * characters is not a validation: "javascript:alert(1)" becomes
 * "javascript:alert1" and is still executable, so the scheme is checked first
 * and anything that is not http(s) is discarded outright.
 */
function sanitiseBaseUrl(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:/i.test(s)) return "";
  const withScheme = /^https?:/i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
  try {
    const u = new URL(withScheme);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

/**
 * Truncate to a maximum. The editor never caps what you can type, so this is
 * where a long article loses its tail -- on the save that reopens the file, not
 * while you write. Silently, until now. Short fields like a company name have
 * their own small maximum and do not need to announce a cut.
 */
const str = (v, max = LIMITS.text, warnings, label) => {
  if (typeof v !== "string") return "";
  if (v.length <= max) return v;
  if (warnings && max >= LIMITS.text) {
    warnings.push(`${label} was ${v.length} characters; the last ${v.length - max} were not loaded (limit ${max})`);
  }
  return v.slice(0, max);
};
const isBi = (v) => v && typeof v === "object" && !Array.isArray(v) && ("en" in v || "fr" in v);
const asBi = (v, warnings, label = "A field") => (isBi(v)
  ? { en: str(v.en, LIMITS.text, warnings, label), fr: str(v.fr, LIMITS.text, warnings, label) }
  : { en: str(v, LIMITS.text, warnings, label), fr: str(v, LIMITS.text, warnings, label) });

/**
 * Normalise an imported document into a shape the editor can trust.
 *
 * This is the trust boundary for project files: an .json can be hand-edited,
 * truncated, or hostile. Nothing here throws - a bad field is replaced, not
 * rejected, because losing the whole project over one typo is worse than
 * dropping one string.
 *
 * @returns {{doc: object, warnings: string[]}}
 */
export function normalizeDoc(raw) {
  const warnings = [];
  if (!raw || typeof raw !== "object") return { doc: blankDoc(), warnings: ["not an object"] };
  if (raw.format !== FORMAT) warnings.push(`unknown format ${raw.format}, expected ${FORMAT}`);

  const base = blankDoc();
  const doc = {
    format: FORMAT,
    name: asBi(raw.name ?? base.name, warnings, "The site name"),
    description: asBi(raw.description ?? base.description, warnings, "The site description"),
    baseUrl: sanitiseBaseUrl(raw.baseUrl),
    meta: {
      lang: raw.meta?.lang === "fr" ? "fr" : "en",
      bilingual: !!raw.meta?.bilingual,
      noindex: !!raw.meta?.noindex
    },
    theme: {
      palette: str(raw.theme?.palette, 20) || "ink",
      colors: sanitiseColors(raw.theme?.colors),
      // `Number(x) || 8` turns a radius of 0 into 8. The editor's slider starts at 0
      // (square corners is a real choice), so every project saved with it came
      // back rounded on reopen -- the same class of loss as replies, and just
      // as invisible.
      radius: raw.theme?.radius == null ? 8 : clamp(Number(raw.theme.radius), 0, 28),
      tone: ["sans", "serif", "mono"].includes(raw.theme?.tone) ? raw.theme.tone : "sans",
      scale: ["compact", "normal", "large", "huge"].includes(raw.theme?.scale) ? raw.theme.scale : "normal",
      scheme: ["auto", "light", "dark"].includes(raw.theme?.scheme) ? raw.theme.scheme : "auto",
      motion: ["none", "subtle", "expressive"].includes(raw.theme?.motion) ? raw.theme.motion : "none",
      customCss: str(raw.theme?.customCss, 60000)
    },
    company: str(raw.company, 120),
    address: str(raw.address, 200),
    email: str(raw.email, 160),
    host: str(raw.host, 120),
    jsonLdType: ["Organization", "Person", "LocalBusiness", "SoftwareApplication"].includes(raw.jsonLdType)
      ? raw.jsonLdType
      : "Organization",
    assets: sanitiseAssets(raw.assets, warnings),
    pages: []
  };

  const allPages = Array.isArray(raw.pages) ? raw.pages : [];
  const rawPages = allPages.slice(0, LIMITS.pages);
  if (!rawPages.length) warnings.push("no pages found, a blank page was created");
  // The limits are there to keep the editor responsive. Dropping the user's
  // forty-fifth page without saying so is not part of that: a site that quietly
  // loses pages on every open is worse than one that refuses the file. The
  // warning channel already exists -- oversized images use it.
  if (allPages.length > LIMITS.pages) {
    warnings.push(`${allPages.length - LIMITS.pages} page(s) past the ${LIMITS.pages}-page limit were not loaded`);
  }

  const slugs = new Set();
  for (const p of rawPages) {
    if (!p || typeof p !== "object") continue;
    // A duplicated or reserved slug would silently overwrite a file on export.
    let slug = slugify(p.slug || p.title?.en || "page");
    if (RESERVED.has(slug) || slugs.has(slug)) slug = `${slug}-${slugs.size + 1}`;
    slugs.add(slug);
    doc.pages.push({
      id: typeof p.id === "string" ? p.id : uid("p"),
      slug,
      title: asBi(p.title, warnings, `The title of "${p.slug || "page"}"`),
      menu: asBi(p.menu ?? p.title, warnings, `The menu label of "${p.slug || "page"}"`),
      desc: asBi(p.desc, warnings, `The description of "${p.slug || "page"}"`),
      inMenu: p.inMenu !== false,
      blocks: sanitiseBlocks(p.blocks, warnings)
    });
  }
  if (!doc.pages.length) doc.pages = blankDoc().pages;
  doc.pages[0].slug = "index";
  return { doc, warnings: warnings.concat(docWarnings(doc).map((w) => w.key)) };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

function sanitiseColors(c) {
  const out = {};
  if (!c || typeof c !== "object") return out;
  for (const [k, v] of Object.entries(c)) {
    if (/^[a-z]+$/.test(k) && typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v;
  }
  return out;
}

/**
 * Rebuild every block from its SPEC rather than trusting the imported object.
 * A block whose type is unknown, or whose fields do not match the spec, is
 * dropped - the alternative is a malformed document that throws during render.
 */
function sanitiseBlocks(list, warnings) {
  if (!Array.isArray(list)) return [];
  const out = [];
  if (list.length > LIMITS.blocksPerPage) {
    warnings.push(`${list.length - LIMITS.blocksPerPage} block(s) past the ${LIMITS.blocksPerPage}-block limit were not loaded`);
  }
  for (const b of list.slice(0, LIMITS.blocksPerPage)) {
    const def = BLOCKS[b?.type];
    if (!def) {
      warnings.push(`unknown block type "${b?.type}" removed`);
      continue;
    }
    const block = { id: typeof b.id === "string" ? b.id : uid("b"), type: b.type };
    for (const f of def.fields) block[f.k] = coerceField(b[f.k], f, warnings);
    // Safety net: a block author who forgets to list a field in `fields` still
    // gets a well-formed value here, and the render below cannot explode.
    for (const [k, v] of Object.entries(def.defaults())) {
      if (!(k in block)) block[k] = coerceField(v, f0(k, def));
    }
    out.push(block);
  }
  return out;
}
const f0 = (k, def) => def.fields.find((f) => f.k === k) || { k, t: "text" };

function coerceField(value, f, warnings) {
  // A bilingual field is ALWAYS {en, fr}, whatever it renders as. Checking
  // `i18n` first is what stops a text field from being wiped to "" because its
  // value is an object rather than a string.
  if (f.i18n) return asBi(value, warnings, f.lbl ? f.lbl[0] : "A field");
  switch (f.t) {
    case "text":
    case "long":
    case "md":
      // A template may store a number in a text field -- threads.replies is
      // `24`, not `"24"` -- and it renders fine on first build. Strictly
      // requiring a string here dropped it to "" on the first save, so a forum
      // project lost every reply count the moment it was reopened.
      if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return "";
  return str(value, LIMITS.text, warnings, f.lbl ? f.lbl[0] : "a field");
    case "url":
    case "date":
      return typeof value === "string" ? value.slice(0, 500) : "";
    case "bool":
      return !!value;
    case "enum":
      return f.options?.some((o) => o[0] === value) ? value : f.options?.[0]?.[0] || "";
    case "img":
      return { assetId: typeof value?.assetId === "string" ? value.assetId : "", alt: asBi(value?.alt) };
    case "list": {
      const src = Array.isArray(value) ? value : [];
      // Same contract as pages and blocks: keep the limit, say what it cost.
      if (warnings && src.length > LIMITS.itemsPerList) {
        warnings.push(`${src.length - LIMITS.itemsPerList} entries past the ${LIMITS.itemsPerList}-entry limit were not loaded`);
      }
      return src.slice(0, LIMITS.itemsPerList).map((item) => {
        const row = {};
        for (const sf of f.of || []) row[sf.k] = coerceField(item?.[sf.k], sf, warnings);
        return row;
      });
    }
    default:
      return "";
  }
}

function sanitiseAssets(list, warnings) {
  if (!Array.isArray(list)) return [];
  if (list.length > LIMITS.images) warnings.push(`only the first ${LIMITS.images} images were kept`);
  const out = [];
  for (const a of list.slice(0, LIMITS.images)) {
    if (!a || typeof a.data !== "string") continue;
    // Only data URIs, and only image types. No remote URL ever becomes a file.
    const m = /^data:(image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(a.data);
    if (!m) {
      warnings.push(`asset "${a.name}" rejected: only base64 image data URIs are accepted`);
      continue;
    }
    if (m[3].length * 0.75 > LIMITS.imageBytes) {
      warnings.push(`asset "${a.name}" rejected: larger than ${LIMITS.imageBytes} bytes`);
      continue;
    }
    out.push({
      id: typeof a.id === "string" ? a.id : uid("a"),
      name: String(a.name || `image-${out.length + 1}`).slice(0, 60),
      type: m[1],
      data: a.data
    });
  }
  return out;
}

/* --------------------------------------------------------------- history */

/**
 * Undo/redo over document snapshots.
 *
 * `push` is debounced by the caller for typing; structural edits call it
 * directly. `past`/`future` are capped so a long session cannot grow unbounded.
 */
export function createHistory(initial, cap = 80) {
  let present = initial;
  let past = [];
  let future = [];
  return {
    get current() {
      return present;
    },
    /** Replace the document without recording (used by undo/redo themselves). */
    reset(next) {
      present = next;
    },
    /** Record a new state. Ignored when identical, which kills most no-ops. */
    push(next) {
      const a = JSON.stringify(present);
      const b = JSON.stringify(next);
      if (a === b) return false;
      past.push(present);
      if (past.length > cap) past.shift();
      future = [];
      present = next;
      return true;
    },
    undo() {
      if (!past.length) return null;
      future.push(present);
      present = past.pop();
      return present;
    },
    redo() {
      if (!future.length) return null;
      past.push(present);
      present = future.pop();
      return present;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    }
  };
}

/* ------------------------------------------------------------ persistence */

const DOC_KEY = "wgn.project";

/**
 * @returns {object|null} null when storage is unavailable - private browsing
 * throws on write, and the editor must keep working without persistence.
 */
export function loadStored() {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (!raw) return null;
    if (raw.length > LIMITS.fileBytes) return null;
    return normalizeDoc(JSON.parse(raw)).doc;
  } catch {
    return null;
  }
}

export function storeSaved(doc) {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

/** Extension for a validated image type, used to name the exported file. */
const ASSET_EXT = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg"
};

/** Turn a picked File into an asset, or report why it cannot be used. */
export function readAsset(file) {
  return new Promise((resolve, reject) => {
    if (file.size > LIMITS.imageBytes) {
      reject(new Error(`img-too-big:${file.size}:${LIMITS.imageBytes}`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("img-unreadable"));
    reader.onload = () => {
      const data = String(reader.result || "");
      if (!/^data:image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml);base64,/.test(data)) {
        reject(new Error("img-type"));
        return;
      }
      const type = /^data:(image\/[a-z+]+);/.exec(data)?.[1] || "image/png";
      resolve({
        id: uid("a"),
        // The extension comes from the validated type, never from the picked
        // name. That name is the user's text: "totally-safe.png.exe" otherwise
        // ships a file called .exe inside the site's assets, right next to the
        // <img> that points at it.
        name: `${slugify(file.name.replace(/\.[^.]+$/g, "") || "image")}.${ASSET_EXT[type] || "png"}`,
        type,
        data
      });
    };
    reader.readAsDataURL(file);
  });
}