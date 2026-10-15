/**
 * build(): the single source of truth.
 *
 * Document in, file tree out. The preview and the exported ZIP both call this,
 * so what you see cannot drift from what you ship. Pure and synchronous: no
 * DOM, no network, no clock — which is also why the test suite can run it in
 * Node and compare bytes.
 *
 * Bilingual sites produce TWO files per page (`about.html` and `about.fr.html`)
 * rather than one file plus a client-side toggle. That keeps a real URL per
 * language, a correct `<html lang>`, working `hreflang`, and no flash of the
 * wrong language before JavaScript runs.
 */
import { esc, md, safeHref } from "./safe.js";
import { siteCss, resolve } from "./themes.js";
import { BLOCKS, T } from "./blocks.js";
import { st, fillLegal } from "./site-strings.js";

export const FORMAT = "wgn/1";
const MAX_TEXT = 40000;
/** File names the generator owns. A page cannot take one of these. */
export const RESERVED = new Set(["index", "404", "privacy", "legal", "robots", "sitemap", "favicon", "assets", "css", "js"]);
const HOME = "index"; // the first page is always the home page

/** Path of a page in a given language. */
export function pagePath(doc, page, lang) {
  const base = page.slug === HOME ? HOME : page.slug;
  return lang === "fr" && doc.meta.bilingual ? `${base}.fr.html` : `${base}.html`;
}

/* ------------------------------------------------------------------ head */

/**
 * JSON for a `<script type="application/ld+json">` body.
 *
 * NOT `esc()`. The content of a script element is raw text: the HTML parser
 * hands it to the script verbatim and never decodes entities, so escaping the
 * quotes shipped every exported page a JSON-LD block full of `&quot;` that no
 * search engine can parse. Silent loss of every rich result.
 *
 * What the block does need is protection from its own payload closing the tag:
 * `<` is escaped as the JSON-legal `<`, which cannot open a tag and still
 * parses. `>` and `&` go with it for good measure.
 */
const jsonLdScript = (o) =>
  JSON.stringify(o)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

function head(doc, page, lang, otherPath, selfPath) {
  const name = T(doc.name, lang) || doc.name.en || "Site";
  const title = T(page.title, lang) || name;
  /*
   * Meta description: the page's own, falling back to the site's. Never
   * synthesised from the title — a title repeated as a description is a
   * duplicated snippet, which reads worse than none at all, and the quality
   * report flags the pages that still need one.
   */
  const desc = T(page.desc, lang) || T(doc.description, lang);
  const base = (doc.baseUrl || "").replace(/\/+$/, "");
  const canon = base ? `${base}/${selfPath}` : "";
  const alt = (l) => (base ? `${base}/${pagePath(doc, page, l)}` : pagePath(doc, page, l));
  const hue = resolve(doc.theme);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": doc.jsonLdType || "Organization",
    name,
    url: base || undefined,
    description: desc || undefined,
    email: doc.email || undefined,
    address: doc.address || undefined
  };
  const hreflang = otherPath
    ? `<link rel="alternate" hreflang="fr" href="${esc(otherPath.startsWith("http") ? otherPath : alt("fr"))}">\n` +
      `<link rel="alternate" hreflang="en" href="${esc(alt("en"))}">\n` +
      `<link rel="alternate" hreflang="x-default" href="${esc(alt("en"))}">`
    : "";

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${desc ? `<meta name="description" content="${esc(desc)}">` : ""}
${doc.meta.noindex ? `<meta name="robots" content="noindex,nofollow">` : ""}
${canon ? `<link rel="canonical" href="${esc(canon)}">` : ""}
${hreflang}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
${desc ? `<meta property="og:description" content="${esc(desc)}">` : ""}
${canon ? `<meta property="og:url" content="${esc(canon)}">` : ""}
<meta property="og:site_name" content="${esc(name)}">
<meta property="og:locale" content="${lang === "fr" ? "fr_FR" : "en_US"}">
<meta property="og:image" content="${esc(base ? `${base}/og.png` : "og.png")}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="${hue.bg}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="css/style.css">
<script type="application/ld+json">${jsonLdScript(jsonLd)}</script>`;
}

/* --------------------------------------------------------------- chrome */

function chrome(doc, page, lang, inner) {
  const name = T(doc.name, lang) || doc.name.en || "";
  const menus = doc.pages.filter((p) => p.inMenu !== false);
  const nav = menus.map((p) => {
    const href = pagePath(doc, p, lang);
    const cur = p.id === page.id ? ' aria-current="page"' : "";
    return `<a href="${esc(href)}"${cur}>${esc(T(p.menu, lang) || T(p.title, lang) || p.slug)}</a>`;
  }).join("\n      ");

  const pick = doc.meta.bilingual
    ? `<div class="langpick" role="group" aria-label="${esc(st("langLabel", lang))}">
        <a href="${esc(pagePath(doc, page, "en"))}" hreflang="en"${lang === "en" ? ' aria-current="page"' : ""}>EN</a>
        <a href="${esc(pagePath(doc, page, "fr"))}" hreflang="fr"${lang === "fr" ? ' aria-current="page"' : ""}>FR</a>
      </div>`
    : "";

  const themeBtn =
    doc.theme.scheme === "auto"
      ? `<button class="theme-toggle" type="button" data-theme-toggle aria-label="${esc(st("themeToggle", lang))}" title="${esc(st("themeToggle", lang))}">◐</button>`
      : "";

  const year = doc.year || "2026";
  const sfx = doc.meta.bilingual && lang === "fr" ? ".fr" : "";
  return `<a class="skip" href="#main">${esc(st("skip", lang))}</a>
<header class="site-head">
  <div class="wrap">
    ${themeBtn}
    <a class="brand" href="${esc(pagePath(doc, doc.pages[0], lang))}">${esc(name)}</a>
    <nav class="site-nav" aria-label="${esc(st("nav", lang))}">
      ${nav}
      ${pick}
    </nav>
  </div>
</header>
<main id="main" tabindex="-1">
${inner}
</main>
<footer class="site-foot">
  <div class="wrap">
    <span>© ${esc(year)} ${esc(name)}. ${esc(st("copyright", lang))}.</span>
    <span><a href="privacy${sfx}.html">${esc(st("privacyTitle", lang))}</a> · <a href="legal${sfx}.html">${esc(st("legalTitle", lang))}</a></span>
  </div>
</footer>`;
}

/* --------------------------------------------------------------- render */

function renderBlocks(doc, page, lang, assetPath) {
  const c = {
    doc,
    lang,
    st: (k) => st(k, lang),
    T: (v) => T(v, lang),
    img: (spec) => {
      const a = (doc.assets || []).find((x) => x.id === spec?.assetId);
      return a ? `assets/${a.name}` : "";
    },
    btn: (label, href) => {
      const l = T(label, lang);
      const h = safeHref(href);
      return l && h ? `<p><a class="btn" href="${esc(h)}">${esc(l)}</a></p>` : "";
    },
    btnRaw: (label, href, fallback) => {
      const h = safeHref(href);
      if (!h) return "";
      return `<a class="btn btn--ghost" href="${esc(h)}">${esc(label || fallback)}</a>`;
    }
  };
  return (page.blocks || [])
    .map((b) => {
      const def = BLOCKS[b.type];
      if (!def) return "";
      try {
        return def.render(b, c);
      } catch {
        // One broken block must never take the whole page down.
        return `<section class="section"><div class="wrap"><p><small>${esc(b.type)}</small></p></div></section>`;
      }
    })
    .filter(Boolean)
    .join("\n");
}

/* ----------------------------------------------------------------- build */

/**
 * @param {object} doc project document
 * @returns {{files: Record<string,string>, pages: object[], assets: object[], warnings: string[]}}
 */
export function build(doc) {
  const langs = doc.meta.bilingual ? ["en", "fr"] : [doc.meta.lang === "fr" ? "fr" : "en"];
  const main = doc.meta.lang === "fr" ? "fr" : "en";
  const files = {};
  const warnings = [];

  for (const lang of langs) {
    for (const page of doc.pages) {
      const self = pagePath(doc, page, lang);
      // On the main language the alternate points at the other one; on the other
      // language it points back at the main one. Either way the two files cross-link.
      const other = doc.meta.bilingual ? pagePath(doc, page, lang === main ? "fr" : "en") : null;
      const inner = renderBlocks(doc, page, lang);
      files[self] = `<!doctype html>
<html lang="${lang}">
<head>
${head(doc, page, lang, other, self)}
</head>
<body>
${chrome(doc, page, lang, inner)}
<script src="js/site.js" defer><\/script>
</body>
</html>
`;
    }
  }

  /* Legal and error pages: dictionary-controlled bodies, user values substituted
     inside them. They get a real canonical URL, not a path guessed from a title. */
  for (const lang of langs) {
    const sfx = doc.meta.bilingual ? (lang === "fr" ? ".fr" : "") : "";
    // Cross-link to the same document in the other language.
    const flip = (stem) => (doc.meta.bilingual ? `${stem}${sfx ? "" : ".fr"}.html` : null);

    files[`privacy${sfx}.html`] = page(doc, lang, st("privacyTitle", lang), (d, l) =>
      md(esc(fillLegal(st("privacyBody", l), d)), 2), `privacy${sfx}.html`, flip("privacy"));
    files[`legal${sfx}.html`] = page(doc, lang, st("legalTitle", lang), (d, l) =>
      md(esc(fillLegal(st("legalBody", l), d)), 2), `legal${sfx}.html`, flip("legal"));
    files[`404${sfx}.html`] = page(doc, lang, `404 — ${st("notFoundTitle", lang)}`, (d, l) =>
      `<p class="lede">${esc(st("notFoundBody", l))}</p>
<p><a class="btn" href="${esc(pagePath(d, d.pages[0], l))}">${esc(st("backHome", l))}</a></p>`,
      `404${sfx}.html`, flip("404"));
  }

  files["css/style.css"] = siteCss(doc.theme, { wide: doc.wide });

  files["js/site.js"] = SITE_JS;

  files["favicon.svg"] = favicon(doc);

  const base = (doc.baseUrl || "").replace(/\/+$/, "");
  files["robots.txt"] = doc.meta.noindex
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\n\nSitemap: ${base ? `${base}/sitemap.xml` : "/sitemap.xml"}\n`;

  const urls = [];
  if (base) {
    for (const lang of langs) {
      for (const pg of doc.pages) {
        const loc = `${base}/${pagePath(doc, pg, lang)}`;
        const alts = doc.meta.bilingual
          ? ["en", "fr"]
              .map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(`${base}/${pagePath(doc, pg, l)}`)}"/>`)
              .join("")
          : "";
        urls.push(`  <url><loc>${esc(loc)}</loc>${alts}</url>`);
      }
    }
  }
  files["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;

  /* Security headers for Netlify / Cloudflare Pages. Ignored elsewhere, never a
     third-party request. A plain `file://` or Apache host does not read this
     file — the README says so rather than implying the site is hardened there. */
  files["_headers"] = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self' mailto:; base-uri 'self'; frame-ancestors 'none'
`;

  /* Assets are stored as data URIs so the project stays one self-contained file.
     `build` stays pure and string-only; `zip.toEntries` decodes them to bytes. */
  const assets = doc.assets || [];
  const used = new Set();
  for (const a of assets) {
    // Sanitise to a flat name: no path separators, and no ".." that could walk
    // out of assets/ when the host unpacks the archive.
    let name = String(a.name || "")
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/^[.\-]+/, "")
      .slice(0, 60);
    if (!name || !/\.[a-z0-9]{2,5}$/i.test(name)) {
      warnings.push(`asset "${a.name}" skipped: no usable file name`);
      continue;
    }
    // Two uploads with the same name must not overwrite each other on export.
    let n = name;
    let i = 2;
    while (used.has(n)) {
      const dot = name.lastIndexOf(".");
      n = `${dot > 0 ? name.slice(0, dot) : name}-${i++}${dot > 0 ? name.slice(dot) : ""}`;
    }
    used.add(n);
    files[`assets/${n}`] = a.data;
  }

  return { files, pages: doc.pages, assets, warnings, langs };
}

/** Wrap a body fragment in the standard chrome. Used by legal + error pages. */
function page(doc, lang, title, bodyFn, selfPath, otherPath) {
  const homePage = doc.pages[0];
  const shell = { ...homePage, title: { en: title, fr: title } };
  return `<!doctype html>
<html lang="${lang}">
<head>
${head(doc, shell, lang, otherPath, selfPath)}
</head>
<body>
${chrome(doc, homePage, lang, `<section class="section"><div class="wrap"><h1>${esc(title)}</h1>${bodyFn(doc, lang)}</div></section>`)}
<script src="js/site.js" defer><\/script>
</body>
</html>
`;
}

function favicon(doc) {
  const hue = resolve(doc.theme);
  const initial = (T(doc.name, doc.meta.lang) || "?").trim().charAt(0).toUpperCase() || "?";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${esc(initial)}">
<rect width="64" height="64" rx="14" fill="${hue.accent}"/>
<text x="32" y="43" font-family="system-ui,sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="${hue.accentOn}">${esc(initial)}</text>
</svg>
`;
}

/* The generated site's only JavaScript: theme toggle + the static form.
   No framework, no analytics, no network. */
export const SITE_JS = `/* MURTHER FABRIQUE — theme toggle + static form. */
(function () {
  "use strict";
  var KEY = "theme";
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  } catch (e) {}

  var toggle = document.querySelector("[data-theme-toggle]");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var now = root.getAttribute("data-theme") || (dark ? "dark" : "light");
      var next = now === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
    });
  }

  /* The form is static. Rather than POST to nowhere, a mailto: destination is
     turned into a real composed message on submit. A non-mailto destination is
     left alone: that is a form service, and it needs its own endpoint. */
  var form = document.querySelector("[data-static-form]");
  if (form && /^mailto:/i.test(form.getAttribute("action") || "")) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var data = new FormData(form);
      var body = "";
      data.forEach(function (v, k) { if (String(v).trim()) body += k + ": " + v + "\\n"; });
      var email = String(data.get("email") || "").trim();
      if (email && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) {
        var status = form.querySelector("[data-form-status]");
        if (status) { status.textContent = "${st("formBadEmail", "en").replace(/"/g, '\\"')}"; status.hidden = false; }
        return;
      }
      window.location.href = form.getAttribute("action") + "?subject=" +
        encodeURIComponent(String(data.get("subject") || "")) + "&body=" + encodeURIComponent(body);
      var ok = form.querySelector("[data-form-status]");
      if (ok) { ok.textContent = "${st("formSent", "en").replace(/"/g, '\\"')}"; ok.hidden = false; }
    });
  }
})();
`;

/* --------------------------------------------------------------- checks */

/** Problems that must be visible BEFORE export rather than after. */
export function docWarnings(doc) {
  const out = [];
  const seen = new Set();
  for (const [i, p] of doc.pages.entries()) {
    const s = String(p.slug || "");
    if (!s) out.push({ key: "errSlugEmpty" });
    // The first page IS index.html, so it is exempt from its own reserved list.
    else if (RESERVED.has(s) && !(i === 0 && s === HOME)) out.push({ key: "errSlugReserved", args: [s] });
    else if (seen.has(s)) out.push({ key: "errSlugDup", args: [s] });
    else seen.add(s);
  }
  return out;
}

/** Every translatable string in the document, walked generically. */
export function walkI18n(doc, fn) {
  const visit = (v, path) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x, i) => visit(x, `${path}[${i}]`));
    if (typeof v.en === "string" || typeof v.fr === "string") return fn(v, path);
    for (const [k, x] of Object.entries(v)) visit(x, `${path}.${k}`);
  };
  visit(doc, "");
}

export { MAX_TEXT };
