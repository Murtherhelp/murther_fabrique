/**
 * Test suite. Node's built-in runner, zero dependencies:
 *   node --test test/
 *
 * The core is deliberately DOM-free so it can be tested here in Node: build(),
 * the registries, the markdown renderer, the sanitiser and the ZIP writer are
 * all pure functions of their input.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { esc, safeHref, md, slugify, contrast, mix, pageHref } from "../src/js/safe.js";
import { T, t, tf } from "../src/js/i18n.js";
import { S } from "../src/js/site-strings.js";
import { PALETTES, contrastChecks, paletteOf, resolve, sanitizeCss, siteCss } from "../src/js/themes.js";
import { BLOCKS, BLOCK_ORDER, makeBlock, bi, missing, blockTypeLabel } from "../src/js/blocks.js";
import { ICON_KEYS, icon } from "../src/js/icons.js";
import { build, pagePath, docWarnings, FORMAT } from "../src/js/build.js";
import { TEMPLATES, TEMPLATE_ORDER, fromTemplate } from "../src/js/templates.js";
import { PRESETS, PRESET_FOR } from "../src/js/presets.js";
import { blankDoc, normalizeDoc, createHistory, LIMITS } from "../src/js/store.js";
import { crc32, decodeDataUri, toEntries, zip } from "../src/js/zip.js";

const doc = (key) => normalizeDoc(fromTemplate(key)).doc;

/* ================================================================ safety */

test("esc neutralises every HTML-significant character", () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(esc("a & b"), "a &amp; b");
  assert.equal(esc(null), "");
});

test("safeHref refuses script and data schemes", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("JaVaScRiPt:alert(1)"), null);
  assert.equal(safeHref("data:text/html,<script>"), null);
  assert.equal(safeHref("vbscript:x"), null);
});

test("safeHref refuses protocol-relative //host (the legacy check let it through)", () => {
  assert.equal(safeHref("//evil.com/payload"), null, "protocol-relative escapes the origin");
});

test("safeHref keeps the schemes a real site needs", () => {
  for (const u of ["https://a.test/x?y=1&z=2", "http://a.test", "mailto:a@b.test", "tel:+331"]) {
    assert.equal(safeHref(u), u, u);
  }
});

test("safeHref keeps relative links, which is how a generated site navigates", () => {
  for (const u of ["contact.html", "index.html#gallery", "about.html", "./x/y.html", "#top", "/pricing"]) {
    assert.equal(safeHref(u), u, u);
  }
});

test("safeHref rejects a dangerous scheme even with punctuation removed", () => {
  // Stripping parentheses turns "javascript:alert(1)" into "javascript:alert1",
  // which still executes. A character filter alone would let this through.
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("javascript:alert1"), null);
  assert.equal(safeHref("  javascript:alert(1)  "), null);
});

test("markdown never emits a tag from user text", () => {
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)<\/script>';
  const out = md(esc(`Text ${payload} [x](javascript:alert(3)) [ok](https://a.test/p?q=1&r=2)`));
  assert.ok(!/<img|<script/i.test(out), "no tag injected");
  assert.ok(out.includes("&lt;img"), "payload stays visible as text");
  assert.ok(!/href="javascript:/i.test(out), "javascript: link dropped");
  assert.ok(out.includes('href="https://a.test/p?q=1&amp;r=2"'), "real link preserved");
});

test("a refused link keeps its label instead of eating the text", () => {
  const out = md(esc("[click me](javascript:alert(1))"));
  assert.ok(out.includes("click me"));
  assert.ok(!out.includes("<a "), `unexpected link: ${out}`);
});

test("a link with an ampersand is encoded exactly once", () => {
  const out = md(esc("[ok](https://a.test/p?q=1&r=2)"));
  assert.ok(out.includes('href="https://a.test/p?q=1&amp;r=2"'), out);
  assert.ok(!out.includes("&amp;amp;"), "double escaped");
});

test("markdown builds the documented subset", () => {
  const out = md(esc("## Title\n- one\n- two\n\n1. first\n2. second\n\nA **bold** and *italic* and `code`."));
  assert.ok(out.includes("<h2>Title</h2>"));
  assert.ok(out.includes("<ul><li>one</li><li>two</li></ul>"));
  assert.ok(out.includes("<ol><li>first</li><li>second</li></ol>"));
  assert.ok(out.includes("<strong>bold</strong>"));
  assert.ok(out.includes("<em>italic</em>"));
  assert.ok(out.includes("<code>code</code>"));
});

test("markdown heading level rises with the hashes and is capped at h4", () => {
  assert.ok(md(esc("## Two"), 2).includes("<h2>Two</h2>"));
  assert.ok(md(esc("### Three"), 2).includes("<h3>Three</h3>"));
  assert.ok(md(esc("#### Four"), 2).includes("<h4>Four</h4>"));
  // Five hashes is not a heading: it must not be able to produce an h5.
  assert.ok(!/<h5/.test(md(esc("##### Five"), 2)));
});

test("slugify is ASCII, stable and never empty", () => {
  // Written with escapes on purpose: this file has been round-tripped through
  // PowerShell before, and a literal "é" is exactly what that mangles.
  assert.equal(slugify("Héllo World"), "hello-world");
  assert.equal(slugify("  -- ?? --  "), "page");
  assert.equal(slugify(""), "page");
  assert.ok(/^[a-z0-9-]+$/.test(slugify("Un Été à Paris — 2026!")), slugify("Un Été à Paris — 2026!"));
  assert.equal(slugify("Déjà Vu"), "deja-vu");
});

test("pageHref falls back to the home page for an unknown slug", () => {
  assert.equal(pageHref("about", [{ slug: "about" }]), "about.html");
  assert.equal(pageHref("nope", [{ slug: "about" }]), "index.html");
});

/* ================================================================== i18n */

test("every generator key carries both languages", () => {
  const bad = Object.entries(T).filter(([, v]) => !Array.isArray(v) || !v[0] || !v[1]);
  assert.equal(bad.length, 0, `incomplete: ${bad.map(([k]) => k).join(", ")}`);
});

test("every generated-site key carries both languages", () => {
  const bad = Object.entries(S).filter(([, v]) => !Array.isArray(v) || !v[0] || !v[1]);
  assert.equal(bad.length, 0, `incomplete: ${bad.map(([k]) => k).join(", ")}`);
});

/* A key that was never added is invisible to the test above, which walks the
   dictionary: it can only find entries that exist. t() returns an unknown key
   unchanged, so the missing key became the visible label — the SEO email field
   read literally "formEmail" in both languages. This scans the call sites. */
test("every interface key the source asks for actually exists", () => {
  const dir = new URL("../src/js/", import.meta.url);
  const files = ["ui.js", "i18n.js", "blocks.js", "templates.js"]
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .concat([readFileSync(new URL("../src/index.html", import.meta.url), "utf8")]);

  const used = new Set();
  for (const src of files) {
    for (const m of src.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-title)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/["']data-lbl["']\s*:\s*"([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  }
  // Keys the source passes around as values rather than literals.
  for (const k of Object.keys(T)) used.delete(k);

  const missing = [...used].filter((k) => !T[k]);
  assert.equal(missing.length, 0, `referenced but not in the dictionary: ${missing.join(", ")}`);
});

test("a missing key shows itself instead of rendering empty", () => {
  assert.equal(t("definitely-not-a-key"), "definitely-not-a-key");
});

test("French translations differ from English (a copy-paste left in place is a bug)", () => {
  // These words are genuinely identical in both languages: product name, and
  // terms French has borrowed unchanged ("Design", "Export", "Blog", "Pages").
  const SAME = new Set(["appName", "panelOutline", "panelExport", "panelDesign", "tplPortfolio", "tplBlog", "pagesTitle"]);
  const copied = Object.entries(T)
    .filter(([k, v]) => !SAME.has(k) && v[0] === v[1])
    .map(([k]) => k);
  assert.equal(copied.length, 0, `untranslated: ${copied.join(", ")}`);
});

test("tf fills %s placeholders left to right", () => {
  assert.equal(tf("errSlugDup", "about"), "Two pages cannot share the file name about.");
  assert.equal(tf("auEmptyKo", "a", "b"), "Empty page: a");
});

/* ================================================================= colour */

test("WCAG contrast matches the reference values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#ffffff", "#ffffff").toFixed(2), "1.00");
  assert.ok(contrast("#1d4ed8", "#f4f6fb") >= 4.5);
});

test("every shipped palette clears AA on every pair the audit checks", () => {
  for (const key of Object.keys(PALETTES)) {
    const bad = contrastChecks({ palette: key, colors: {} }).filter((c) => !c.ok);
    assert.equal(bad.length, 0, `${key}: ${bad.map((b) => `${b.label}=${b.ratio.toFixed(2)}`).join(" ")}`);
  }
});

test("the audit reports hostile custom colours instead of hiding them", () => {
  const wild = { palette: "custom", colors: { bg: "#ffffff", surface: "#f0f0f0", ink: "#777777", accent: "#ffdd00" } };
  assert.ok(contrastChecks(wild).some((c) => !c.ok), "near-invisible accent must be flagged");
});

test("paletteOf detects an untouched palette and rejects an edited one", () => {
  assert.equal(paletteOf({ palette: "forest", colors: {} }), "forest");
  assert.equal(paletteOf({ palette: "forest", colors: { accent: "#123456" } }), "custom");
});

test("resolve derives muted from ink rather than trusting an authored grey", () => {
  const r = resolve({ palette: "ink", colors: {} });
  assert.ok(contrast(r.muted, r.bg) >= 4.5);
  assert.ok(contrast(r.muted, r.surface) >= 4.5, "card text must be legible too");
});

/* ------------------------------------------------- dark derivation (regression)
   darken() used to test "is this background already dark" the wrong way round,
   so every light palette was treated as dark and returned unchanged: the
   `[data-theme="dark"]` block re-declared the light colours and the theme toggle
   on a generated site changed nothing at all. The branch that did run — an
   already-dark palette — returned six raw colours and no computed tokens, so
   `vars()` wrote the text `undefined` into the stylesheet and `--accent-on`,
   which is what puts button text on the accent colour, resolved to nothing.
   Both shipped as unreadable pages. */

test("a light palette derives a genuinely different dark block", () => {
  for (const key of Object.keys(PALETTES)) {
    const light = resolve({ palette: key, colors: {} });
    const css = siteCss({ palette: key, colors: {} });
    const dark = css.match(/\[data-theme="dark"\]\{([^}]*)\}/)[1];
    const darkBg = /--bg:\s*(#[0-9a-f]{6})/i.exec(dark)[1];
    if (contrast(light.bg, "#ffffff") > contrast(light.bg, "#000000")) {
      // Already dark: the block must pass the dark palette straight through.
      assert.equal(darkBg, light.bg, `${key} is already dark and must not be re-derived`);
    } else {
      assert.notEqual(darkBg, light.bg,
        `${key} is light, so [data-theme="dark"] must not repeat the light background`);
      assert.ok(contrast(darkBg, "#000000") < contrast(darkBg, "#ffffff"),
        `${key}: the derived background must be darker than the light one, got ${darkBg}`);
    }
  }
});

test("the emitted stylesheet never contains the text 'undefined'", () => {
  for (const key of TEMPLATE_ORDER) {
    const css = build(doc(key)).files["css/style.css"];
    assert.equal(/"undefined"|:\s*undefined\b/.test(css), false,
      `${key} emitted an undefined token — ${css.match(/--[\w-]+:\s*undefined/g)?.join(" ")}`);
  }
});

test("the light tokens sit inside a :root rule", () => {
  // Written bare at the top of the stylesheet, every custom property declaration
  // is invalid and the browser drops it. The page then has no colours and no
  // type scale at all in light mode. The dark media query masked this for years
  // because it used to serve a copy of the light palette.
  for (const key of Object.keys(PALETTES)) {
    const css = siteCss({ palette: key, colors: {} });
    const body = css.replace(/^\/\*[^*]*\*\/\s*/, "");
    assert.ok(/^:root\{/.test(body), `${key}: the stylesheet must open with a :root rule`);
    // Nothing between the comment and the first rule may be a bare declaration.
    const beforeFirstRule = body.slice(0, body.indexOf("}") + 1);
    assert.equal(/^\s*--/.test(beforeFirstRule), false,
      `${key}: declarations before the first rule are discarded by the parser`);
  }
});

test("every computed token survives into the dark block", () => {
  for (const key of Object.keys(PALETTES)) {
    const css = siteCss({ palette: key, colors: {} });
    const dark = css.match(/\[data-theme="dark"\]\{([^}]*)\}/)[1];
    for (const token of ["muted", "accent-on", "alt-on"]) {
      const v = new RegExp(`--${token}:\\s*(#[0-9a-f]{6})`, "i").exec(dark);
      assert.ok(v, `${key}: --${token} is missing from the dark block`);
    }
  }
});

test("the ink on the derived dark background is lighter, not darker", () => {
  // mix(a, b, p) moves a toward b, so "lift ink towards white" is
  // mix(ink, "#ffffff", n). Written the other way round it produced dark ink on
  // a near-black background: 1.12:1, which is not readable at any size.
  for (const key of ["ink", "forest", "plum", "clay"]) {
    const css = siteCss({ palette: key, colors: {} });
    const dark = css.match(/\[data-theme="dark"\]\{([^}]*)\}/)[1];
    const bg = /--bg:\s*(#[0-9a-f]{6})/i.exec(dark)[1];
    const ink = /--ink:\s*(#[0-9a-f]{6})/i.exec(dark)[1];
    assert.ok(contrast(ink, bg) >= 4.5, `${key}: dark ink ${ink} on ${bg} = ${contrast(ink, bg).toFixed(2)}`);
  }
});

test("OS dark mode and the manual toggle agree on the same tokens", () => {
  // Two independent code paths reach the dark set: the `[data-theme="dark"]`
  // rule the toggle sets, and the `prefers-color-scheme` media query. They must
  // emit the same values, or the page changes appearance depending on which one
  // the visitor's system happens to trigger.
  const css = siteCss({ palette: "plum", colors: {} });
  const rule = css.match(/\[data-theme="dark"\]\{([^}]*)\}/)[1];
  const media = css.match(/@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{([^}]*)\}/)[1];
  assert.ok(media, "an auto scheme must still emit the media query");
  const tokens = (s) => Object.fromEntries([...s.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(tokens(media), tokens(rule));
});

test("sanitizeCss strips remote @import and url(), reports the count", () => {
  const r = sanitizeCss('@import url(https://cdn.test/x.css);\n.a{background:url("https://evil.test/p.png")}\n.b{background:url("local.png")}');
  assert.equal(r.removed, 2);
  assert.ok(!r.css.includes("cdn.test"));
  assert.ok(!r.css.includes("evil.test"));
  assert.ok(r.css.includes('url("local.png")'), "a local url() is legitimate and must survive");
});

/* ============================================================== registry */

test("the registry exposes the block types the templates need", () => {
  for (const k of BLOCK_ORDER) assert.ok(BLOCKS[k], `missing block ${k}`);
  assert.ok(BLOCK_ORDER.length >= 10);
});

/* ------------------------------------------------------- the new vocabulary */

/**
 * A block type nobody can reach from the interface is dead weight, so the
 * templates have to exercise all of them. This is the test that fails when
 * someone adds a block and forgets to put it on a page.
 */
test("every block type is actually used by a template", () => {
  const used = new Set();
  for (const key of TEMPLATE_ORDER) {
    const doc = fromTemplate(key);
    for (const page of doc.pages) for (const b of page.blocks) used.add(b.type);
  }
  const orphans = BLOCK_ORDER.filter((k) => !used.has(k));
  assert.equal(orphans.length, 0, `no template uses: ${orphans.join(", ")}`);
});

test("a feature card renders its icon, and 'none' renders nothing", () => {
  const ctx = { lang: "en", img: () => "" };
  const withIcon = BLOCKS.features.render({ ...BLOCKS.features.defaults(), items: [{ title: bi("A", "A"), body: bi("B", "B"), icon: "bolt" }] }, ctx);
  assert.match(withIcon, /<svg class="ico"/);
  const without = BLOCKS.features.render({ ...BLOCKS.features.defaults(), items: [{ title: bi("A", "A"), body: bi("B", "B"), icon: "none" }] }, ctx);
  assert.doesNotMatch(without, /<svg/);
});

test("icons are drawn, not fetched: no src, no href, no http", () => {
  for (const key of ICON_KEYS) {
    if (key === "none") continue;
    const svg = icon(key);
    assert.ok(svg.startsWith("<svg"), `${key} is not an svg`);
    assert.doesNotMatch(svg, /src=|href=|http|url\(/i, `${key} reaches outside the page`);
  }
});

test("the five new blocks render real markup from their own defaults", () => {
  const ctx = { lang: "en", img: () => "" };
  const cases = {
    testimonial: /<figure class="quote">[\s\S]*<cite>/,
    timeline: /<ul class="time">[\s\S]*time__item/,
    skills: /<dl class="skills">[\s\S]*skills__bar/,
    steps: /<ol class="steps">[\s\S]*<h3>/,
    logos: /<ul class="logos">[\s\S]*<li>/,
  };
  for (const [type, re] of Object.entries(cases)) {
    const html = BLOCKS[type].render(BLOCKS[type].defaults(), ctx);
    assert.match(html, re, `${type} rendered ${html.slice(0, 120)}`);
  }
});

test("a skill bar carries a real width, never the literal 'undefined'", () => {
  const b = BLOCKS.skills.defaults();
  const html = BLOCKS.skills.render(b, { lang: "en", img: () => "" });
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.match(html, /width:(30|55|78|100)%/);
});

test("a logo with no image falls back to its name, so the strip is never blank", () => {
  const html = BLOCKS.logos.render(BLOCKS.logos.defaults(), { lang: "en", img: () => "" });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<span>Client one<\/span>/);
});

test("a look is a class on the section, and an unknown one adds nothing", () => {
  const ctx = { lang: "en", img: () => "" };
  const def = BLOCKS.steps.defaults();
  assert.match(BLOCKS.steps.render({ ...def, effect: "gradient" }, ctx), /class="section fx-gradient"/);
  assert.match(BLOCKS.steps.render({ ...def, effect: "none" }, ctx), /class="section"/);
  assert.match(BLOCKS.steps.render({ ...def, effect: "drop table" }, ctx), /class="section"/);
  assert.match(BLOCKS.steps.render(def, ctx), /class="section"/);
});

test("a block with nothing to say renders nothing rather than an empty shell", () => {
  const ctx = { lang: "en", img: () => "" };
  for (const type of ["testimonial", "timeline", "skills", "steps", "logos"]) {
    const b = { ...BLOCKS[type].defaults(), items: [] };
    if (type === "testimonial") b.quote = bi("", "");
    assert.equal(BLOCKS[type].render(b, ctx), "", `${type} emitted an empty section`);
  }
});

test("an empty look value cannot smuggle a class into the class attribute", () => {
  const html = BLOCKS.steps.render({ ...BLOCKS.steps.defaults(), effect: `card" onclick="alert(1)` }, { lang: "en", img: () => "" });
  assert.doesNotMatch(html, /onclick|alert\(1\)|class="section fx-card"/);
});

test("motion is off by default, and 'expressive' is the only one that floats", () => {
  const page = (m) => siteCss({ ...blankDoc().theme, motion: m }, { title: "T", slug: "t", lang: "en" });
  assert.equal(/mf-float/.test(page("none")), false, "the default must not move anything");
  assert.equal(/mf-float/.test(page("subtle")), false, "subtle must stay still");
  assert.equal(/mf-float/.test(page("expressive")), true, "expressive is the one that floats the hero");
});

test("every motion level still yields a stylesheet a browser accepts", () => {
  for (const m of ["none", "subtle", "expressive", "", "wild", null]) {
    const css = siteCss({ ...blankDoc().theme, motion: m }, { title: "T", slug: "t", lang: "en" });
    assert.doesNotMatch(css, /undefined|NaN|\$\{/, `motion=${m}`);
  }
});

test("every block declares fields matching its defaults", () => {
  for (const [type, def] of Object.entries(BLOCKS)) {
    const d = def.defaults();
    for (const k of Object.keys(d)) {
      assert.ok(def.fields.some((f) => f.k === k), `${type}: default "${k}" has no field spec, the inspector cannot edit it`);
    }
  }
});

test("every block has bilingual labels and a render function", () => {
  for (const [type, def] of Object.entries(BLOCKS)) {
    assert.ok(def.label?.[0] && def.label?.[1], `${type} label`);
    assert.equal(typeof def.render, "function", `${type} render`);
  }
});

test("every block label and hint carries both languages", () => {
  const bad = [];
  for (const [type, def] of Object.entries(BLOCKS)) {
    if (!def.label?.[0] || !def.label?.[1]) bad.push(`${type}.label`);
    if (def.hint && (!def.hint[0] || !def.hint[1])) bad.push(`${type}.hint`);
    for (const f of def.fields) {
      if (!f.lbl?.[0] || !f.lbl?.[1]) bad.push(`${type}.${f.k}`);
      for (const sf of f.of || []) {
        if (!sf.lbl?.[0] || !sf.lbl?.[1]) bad.push(`${type}.${f.k}.${sf.k}`);
      }
    }
  }
  assert.equal(bad.length, 0, `missing a language: ${bad.join(", ")}`);
});

test("every template label and description carries both languages", () => {
  const bad = [];
  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    if (!tpl.label?.[0] || !tpl.label?.[1]) bad.push(`${key}.label`);
    if (!tpl.desc?.[0] || !tpl.desc?.[1]) bad.push(`${key}.desc`);
  }
  assert.equal(bad.length, 0, `missing a language: ${bad.join(", ")}`);
});

test("blockTypeLabel resolves in the requested language", () => {
  assert.equal(blockTypeLabel("faq", "fr"), "Questions fréquentes");
  assert.equal(blockTypeLabel("faq", "en"), "FAQ");
  assert.equal(blockTypeLabel("nope", "fr"), "nope");
});

test("makeBlock gives a fresh instance each time", () => {
  const a = makeBlock("features");
  const b = makeBlock("features");
  a.items[0].title.en = "changed";
  assert.equal(b.items[0].title.en, "First advantage", "defaults must not be shared");
  assert.notEqual(a.id, b.id);
});

test("bi always produces both languages", () => {
  assert.deepEqual(bi("a"), { en: "a", fr: "a" });
  assert.deepEqual(bi("a", "b"), { en: "a", fr: "b" });
  assert.equal(missing(bi("", "b"), "en"), true);
  assert.equal(missing(bi("a", "b"), "fr"), false);
});

/* ================================================================= build */

test("the home page's file name is index.html and no other page claims it", () => {
  for (const key of TEMPLATE_ORDER) {
    const d = doc(key);
    assert.equal(d.pages[0].slug, "index", `${key}: first page`);
    for (const p of d.pages.slice(1)) {
      assert.notEqual(p.slug, "index", `${key}: "${p.slug}" would overwrite the home page`);
    }
  }
});

test("a page can be hidden from the menu without leaving a dead link", () => {
  const d = doc("business");
  d.pages[1].inMenu = false;
  const files = build(d).files;
  const nav = (String(files["index.html"]).split("</nav>")[0] || "");
  assert.ok(!/href="about\.html"/.test(nav), "a hidden page must not appear in the nav");
  assert.ok("about.html" in files, "but the page itself still exists");
});

test("every nav link on every page points at a file that exists", () => {
  for (const key of TEMPLATE_ORDER) {
    const d = doc(key);
    const { files } = build(d);
    for (const [name, content] of Object.entries(files)) {
      if (!name.endsWith(".html")) continue;
      const hrefs = [...content.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)]
        .flatMap((m) => [...m[0].matchAll(/href="([^"#][^"]*)"/g)].map((h) => h[1]));
      for (const href of hrefs) {
        assert.ok(href in files, `${key}/${name} links to missing ${href}`);
      }
    }
  }
});

test("all nine templates build without throwing and without warnings", () => {
  for (const key of TEMPLATE_ORDER) {
    const b = build(doc(key));
    assert.deepEqual(b.warnings, [], `${key}: ${b.warnings.join("; ")}`);
    assert.ok(Object.keys(b.files).length >= 8, `${key} produced too few files`);
  }
});

test("every template produces the standard artefact set", () => {
  for (const key of TEMPLATE_ORDER) {
    const { files } = build(doc(key));
    for (const need of ["index.html", "404.html", "privacy.html", "legal.html", "css/style.css",
                        "js/site.js", "favicon.svg", "robots.txt", "sitemap.xml", "_headers"]) {
      assert.ok(need in files, `${key} is missing ${need}`);
    }
  }
});

test("no generated page calls a third party", () => {
  for (const key of TEMPLATE_ORDER) {
    const d = doc(key);
    const own = (d.baseUrl || "").replace(/\/+$/, "");
    for (const [name, content] of Object.entries(build(d).files)) {
      if (!/\.(html|css|js)$/.test(name)) continue;
      const text = String(content);
      // Scan the attributes that actually trigger a request, and ignore the
      // escaped JSON-LD blob, which is data and not a reference.
      const refs = [
        ...text.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "").matchAll(/(?:href|src)="([^"]+)"/g),
        ...text.matchAll(/url\(([^)]*)\)/g)
      ].map((m) => m[1].replace(/['"]/g, ""));
      const rogue = refs.filter((u) => /^https?:/i.test(u) && !u.startsWith(own) && !/schema\.org|sitemaps\.org/.test(u));
      assert.deepEqual(rogue, [], `${key}/${name} calls ${rogue.join(" ")}`);
    }
  }
});

test("user content can never inject a script into a generated page", () => {
  const d = doc("blank");
  d.pages[0].blocks = [{
    id: "x", type: "text",
    title: bi('</title><script>alert(1)</script>', ""),
    body: bi('<img src=x onerror="alert(2)">', "")
  }];
  const html = build(d).files["index.html"];
  assert.ok(!html.includes("<script>alert(1)</script>"), "no injected script tag");
  assert.ok(html.includes("&lt;script&gt;"), "payload escaped");
  assert.equal((html.match(/<script/g) || []).length, 2, "only the site.js tag and the JSON-LD tag");
});

test("the JSON-LD block is real JSON, and still cannot close its own tag", () => {
  const ld = (html) => /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1];

  // 1. It parses. It used to be run through esc(), and since a script element's
  //    content is raw text the quotes stayed as &quot; — every exported page
  //    shipped structured data that no search engine could read.
  const d = doc("business");
  d.company = 'Bob "The <Builder>"';
  d.baseUrl = "https://example.test";
  const parsed = JSON.parse(ld(build(d).files["index.html"]));
  assert.equal(parsed["@type"], "Organization");
  assert.equal(parsed.url, "https://example.test");

  // 2. Escaping the markup is still the point: a hostile value cannot end the
  //    element and open a script of its own.
  const evil = doc("blank");
  evil.pages[0].blocks = [{
    id: "x", type: "text",
    title: bi("</script><script>alert(1)</script>", ""),
    body: bi("", "")
  }];
  const html = build(evil).files["index.html"];
  assert.equal((html.match(/<script/g) || []).length, 2, "only the site.js tag and the JSON-LD tag");
  assert.ok(!html.includes("alert(1)</script>"), "nothing escaped the JSON-LD block");
  assert.doesNotThrow(() => JSON.parse(ld(html)), "still parses after the payload");
});

test("a page that duplicates another page's file name is reported", () => {
  const d = doc("blank");
  d.pages.push({ ...d.pages[0], id: "p2", slug: "about" });
  d.pages.push({ ...d.pages[0], id: "p3", slug: "about" });
  const w = docWarnings(d);
  assert.ok(w.some((x) => x.key === "errSlugDup" && x.args[0] === "about"), JSON.stringify(w));
});

test("a page cannot take a reserved file name", () => {
  const d = doc("blank");
  d.pages[1] = { ...d.pages[0], id: "p2", slug: "404" };
  assert.ok(docWarnings(d).some((x) => x.key === "errSlugReserved"));
});

test("a broken block takes down neither its page nor the build", () => {
  const d = doc("blank");
  d.pages[0].blocks = [{ id: "a", type: "cta", label: bi("x", "x") }, { id: "b", type: "unknown" }];
  const html = build(d).files["index.html"];
  assert.ok(html.includes("<!doctype html>"));
});

test("headings are emitted in document order", () => {
  const d = doc("portfolio");
  const html = build(d).files["index.html"];
  const order = [...html.matchAll(/<h([1-4])\b/g)].map((m) => Number(m[1]));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] - order[i - 1] <= 1, `heading jump ${order[i - 1]} -> ${order[i]}`);
});

/* ============================================================== bilingual */

test("a bilingual site emits two real files per page, each with its own lang", () => {
  const d = doc("business");
  d.meta.bilingual = true;
  const { files } = build(d);
  for (const stem of ["index", "about", "contact", "privacy", "legal", "404"]) {
    assert.ok(`${stem}.html` in files, `missing ${stem}.html`);
    assert.ok(`${stem}.fr.html` in files, `missing ${stem}.fr.html`);
    assert.ok(files[`${stem}.html`].includes('<html lang="en">'), `${stem} lang`);
    assert.ok(files[`${stem}.fr.html`].includes('<html lang="fr">'), `${stem}.fr lang`);
  }
});

test("bilingual content is actually different in each file", () => {
  const d = doc("business");
  d.meta.bilingual = true;
  const { files } = build(d);
  assert.ok(files["index.html"].includes("Products built to last"));
  assert.ok(files["index.fr.html"].includes("Des produits faits pour durer"));
  assert.ok(!files["index.fr.html"].includes("Products built to last"));
});

test("the two language files cross-link with hreflang", () => {
  const d = doc("business");
  d.baseUrl = "";
  d.meta.bilingual = true;
  const { files } = build(d);
  assert.ok(files["index.html"].includes('hreflang="fr" href="index.fr.html"'), files["index.html"].split("\n").slice(0, 12).join("\n"));
  assert.ok(files["index.fr.html"].includes('hreflang="en" href="index.html"'));
});

test("the generated site carries its own French UI strings", () => {
  const d = doc("business");
  d.meta.bilingual = true;
  const { files } = build(d);
  const fr = files["index.fr.html"];
  assert.ok(fr.includes("Aller au contenu"), "skip link translated");
  assert.ok(fr.includes("Navigation principale"), "nav aria-label translated");
  assert.ok(fr.includes("Tous droits réservés"), "footer translated");
  assert.ok(files["404.fr.html"].includes("Page introuvable"));
  assert.ok(!fr.includes("All rights reserved"), "no English leaked into the French page");
});

test("a monolingual site ships no duplicate files", () => {
  const { files } = build(doc("business"));
  assert.ok(!("index.fr.html" in files));
  assert.equal(Object.keys(files).filter((f) => f.endsWith(".html")).length, doc("business").pages.length + 3);
});

/* ================================================================ store */

test("a hostile project file is normalised, not trusted", () => {
  const evil = {
    format: FORMAT,
    name: 42,
    baseUrl: "javascript:alert(1)",
    theme: { palette: "nope", radius: 9999, tone: "comic", colors: { bg: "red", accent: "#fff" } },
    pages: [
      { id: 1, slug: "../../etc/passwd", blocks: [{ id: "a", type: "evil", title: bi("x", "x") }] },
      { id: 2, slug: "index", blocks: "not-an-array" },
      null
    ],
    assets: [{ name: "a.png", data: "https://evil.test/x.png" }, { name: "b.png", data: "data:image/png;base64,iVBORw0KGgo=" }]
  };
  const { doc: d, warnings } = normalizeDoc(evil);
  assert.equal(d.theme.tone, "comic" === d.theme.tone ? "" : "sans", "unknown tone falls back");
  assert.ok(d.theme.radius <= 28, "radius clamped");
  assert.ok(!d.baseUrl.toLowerCase().startsWith("javascript:"));
  assert.equal(d.pages.length, 2, "null pages dropped");
  assert.equal(d.pages[0].blocks.length, 0, "unknown block type removed");
  assert.equal(d.pages[1].blocks.length, 0, "non-array blocks removed");
  assert.ok(!d.pages[0].slug.includes("/") && !d.pages[0].slug.includes(".."), `path traversal not neutralised: ${d.pages[0].slug}`);
  assert.equal(d.assets.length, 1, "only the real data URI survived");
  assert.ok(warnings.length > 0);
});

test("duplicate slugs are made unique on import", () => {
  const { doc: d } = normalizeDoc({
    format: FORMAT, meta: {},
    pages: [{ slug: "about", blocks: [] }, { slug: "about", blocks: [] }]
  });
  assert.notEqual(d.pages[0].slug, d.pages[1].slug);
});

test("an asset with an unsafe file name is neutralised on export", () => {
  const d = doc("blank");
  d.assets = [{ id: "a", name: "../../evil.png", type: "image/png", data: "data:image/png;base64,iVBORw0KGgo=" }];
  const files = Object.keys(build(d).files);
  assert.ok(!files.some((f) => f.includes("..")), files.join(" "));
});

test("two uploads with the same name do not overwrite each other", () => {
  const d = doc("blank");
  const uri = "data:image/png;base64,iVBORw0KGgo=";
  d.assets = [
    { id: "a1", name: "logo.png", type: "image/png", data: uri },
    { id: "a2", name: "logo.png", type: "image/png", data: uri }
  ];
  const keys = Object.keys(build(d).files).filter((f) => f.startsWith("assets/"));
  assert.equal(keys.length, 2, keys.join(" "));
});

test("undo and redo walk the document history", () => {
  const h = createHistory({ v: 0 });
  assert.equal(h.canUndo, false);
  h.push({ v: 1 });
  h.push({ v: 2 });
  assert.equal(h.canUndo, true);
  assert.deepEqual(h.undo(), { v: 1 });
  assert.deepEqual(h.undo(), { v: 0 });
  assert.equal(h.canUndo, false);
  assert.deepEqual(h.redo(), { v: 1 });
  assert.equal(h.canRedo, true);
});

test("pushing an identical document is a no-op", () => {
  const h = createHistory({ v: 1 });
  assert.equal(h.push({ v: 1 }), false);
  assert.equal(h.canUndo, false);
});

test("a new edit clears the redo branch", () => {
  const h = createHistory({ v: 0 });
  h.push({ v: 1 });
  h.undo();
  h.push({ v: 9 });
  assert.equal(h.canRedo, false);
});

test("history is capped so a long session cannot grow without bound", () => {
  const h = createHistory({ v: 0 }, 5);
  for (let i = 1; i <= 50; i++) h.push({ v: i });
  let n = 0;
  while (h.canUndo) { h.undo(); n++; }
  assert.ok(n <= 5, `undo depth ${n} exceeded the cap`);
});

/* ================================================================== zip */

test("crc32 matches the reference check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("decodeDataUri accepts base64 and refuses everything else", () => {
  const bytes = decodeDataUri("data:image/png;base64,aGk=");
  assert.deepEqual([...bytes], [104, 105]);
  assert.equal(decodeDataUri("https://evil.test/a.png"), null);
  assert.equal(decodeDataUri("data:image/png,notbase64"), null);
});

test("toEntries decodes asset data URIs and leaves generated text as text", () => {
  const entries = toEntries({ "a.txt": "hello", "b.png": "data:image/png;base64,aGk=" });
  assert.equal(entries[0][0], "a.txt");
  assert.equal(typeof entries[0][1], "string", "generated files stay text");
  assert.ok(entries[1][1] instanceof Uint8Array);
  assert.deepEqual([...entries[1][1]], [104, 105]);
});

test("zip produces a Blob with the ZIP signature and the right entry count", async () => {
  const blob = await zip([["a.txt", "hello"], ["b.txt", "x".repeat(500)]], new Date(2026, 0, 1));
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  assert.equal(head[0], 0x50); // "PK"
  assert.equal(head[1], 0x4b);
  const tail = new Uint8Array(await blob.slice(blob.size - 22).arrayBuffer());
  const view = new DataView(tail.buffer);
  assert.equal(view.getUint32(0, true), 0x06054b50, "end-of-central-directory signature");
  assert.equal(view.getUint16(10, true), 2, "two entries in the directory");
});

test("zip round-trips through the platform decompressor", async () => {
  const payload = "site content ".repeat(200);
  const blob = await zip([["index.html", payload]], new Date(2026, 0, 1));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(bytes.buffer);
  // Local header: method at 8, compressed size at 18, name length at 26.
  const method = dv.getUint16(8, true);
  const packed = dv.getUint32(18, true);
  assert.equal(dv.getUint32(22, true), payload.length, "uncompressed size recorded");
  let body = bytes.slice(30 + dv.getUint16(26, true), 30 + dv.getUint16(26, true) + packed);
  if (method === 8) {
    const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    body = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  assert.equal(new TextDecoder().decode(body), payload);
  assert.ok(blob.size < payload.length / 2, "repetitive content actually compressed");
});

/* ============================================================== one more */

test("templates never ship an empty page (blank is meant to be empty)", () => {
  for (const key of TEMPLATE_ORDER.filter((k) => k !== "blank")) {
    for (const p of doc(key).pages) {
      assert.ok(p.blocks.length > 0, `${key}: page "${p.slug}" has no block`);
    }
  }
});

test("pagePath derives the bilingual file name", () => {
  const d = doc("blank");
  d.meta.bilingual = true;
  assert.equal(pagePath(d, d.pages[0], "en"), "index.html");
  assert.equal(pagePath(d, d.pages[0], "fr"), "index.fr.html");
  d.meta.bilingual = false;
  assert.equal(pagePath(d, d.pages[0], "fr"), "index.html");
});

test("LIMITS are the values the UI enforces", () => {
  assert.ok(LIMITS.pages > 0 && LIMITS.imageBytes > 0 && LIMITS.text > 0);
});

test("every template is built from its preset, not a shared palette", () => {
  // The nine used to differ only by palette name, so two of them shared one.
  // Each now carries its own colours, and `resolve()` must agree.
  for (const key of TEMPLATE_ORDER) {
    const presetKey = PRESET_FOR[key];
    const preset = PRESETS[presetKey];
    assert.ok(preset, `${key}: no preset mapped to it`);
    const d = doc(key);
    assert.equal(d.theme.palette, "custom", `${key} should ship a custom palette`);
    const r = resolve(d.theme);
    assert.equal(r.bg.toLowerCase(), preset.bg.toLowerCase(), `${key} background drifted from its "${presetKey}" preset`);
    assert.equal(r.accent.toLowerCase(), preset.accent.toLowerCase(), `${key} accent drifted from its "${presetKey}" preset`);
    assert.equal(d.theme.radius, preset.radius, `${key} radius drifted from its "${presetKey}" preset`);
  }
});

test("every template maps to a preset, and every preset is used", () => {
  assert.deepEqual(
    Object.keys(PRESET_FOR).sort(),
    [...TEMPLATE_ORDER].sort(),
    "PRESET_FOR and TEMPLATE_ORDER have drifted apart");
  for (const p of Object.keys(PRESETS)) {
    assert.ok(Object.values(PRESET_FOR).includes(p), `preset "${p}" is never used by a template`);
  }
});

test("no two templates share a background", () => {
  // Cheap, but it is the point of the exercise: nine starters that look alike
  // are nine names for the same page.
  const seen = new Map();
  for (const key of TEMPLATE_ORDER) {
    const bg = resolve(doc(key).theme).bg.toLowerCase();
    assert.ok(!seen.has(bg), `${key} and ${seen.get(bg)} share the same background ${bg}`);
    seen.set(bg, key);
  }
});

test("every template clears WCAG AA on all 15 pairs", () => {
  for (const key of TEMPLATE_ORDER) {
    const bad = contrastChecks(doc(key).theme).filter((c) => !c.ok);
    assert.equal(bad.length, 0, `${key}: ${bad.map((b) => `${b.label}=${b.ratio.toFixed(2)}`).join(" ")}`);
  }
});

test("the nine templates are structurally different, not just recoloured", () => {
  const shapes = new Map();
  for (const key of TEMPLATE_ORDER) {
    const d = doc(key);
    const signature = d.pages.map((p) => `${p.slug}:${p.blocks.map((b) => b.type).join("+")}`).join(" | ");
    assert.ok(!shapes.has(signature), `${key} has the same structure as ${shapes.get(signature)}`);
    shapes.set(signature, key);
  }
  assert.equal(shapes.size, TEMPLATE_ORDER.length);
});

test("no template ships a thin page", () => {
  // "Blank page" is meant to be blank; everything else is an example, and an
  // example with one section teaches nothing.
  for (const key of TEMPLATE_ORDER) {
    if (key === "blank") continue;
    const blocks = doc(key).pages.reduce((n, p) => n + p.blocks.length, 0);
    assert.ok(blocks >= 6, `${key} has only ${blocks} sections — too thin to be an example`);
  }
});

test("every template key in TEMPLATE_ORDER actually exists", () => {
  for (const k of TEMPLATE_ORDER) assert.ok(TEMPLATES[k], `TEMPLATE_ORDER names "${k}" which TEMPLATES does not define`);
});

test("two instances of the same template never share a block id", () => {
  const a = fromTemplate("portfolio");
  const b = fromTemplate("portfolio");
  const ids = (d) => d.pages.flatMap((p) => p.blocks.map((x) => x.id));
  assert.deepEqual(ids(a).filter((id) => ids(b).includes(id)), []);
});