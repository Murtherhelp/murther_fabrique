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
import { T, t, tf, tr, ui } from "../src/js/i18n.js";
import { S, st } from "../src/js/site-strings.js";
import { PALETTES, contrastChecks, paletteOf, resolve, sanitizeCss, siteCss } from "../src/js/themes.js";
import { BLOCKS, BLOCK_ORDER, makeBlock, bi, missing, blockTypeLabel } from "../src/js/blocks.js";
import { ICON_KEYS, icon } from "../src/js/icons.js";
import { build, pagePath, docWarnings, FORMAT, SITE_JS, walkI18n } from "../src/js/build.js";
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

test("the FAQ keeps an affordance on a summary that stopped being a list item", () => {
  // .faq summary is display:flex, which takes it off display:list-item and so
  // removes the native disclosure triangle. ::marker cannot bring it back --
  // it only applies to list-item -- so the only thing left telling a visitor
  // that a question expands is this generated content, and an open row needs
  // its own glyph.
  const css = siteCss({ palette: "ink", colors: {} });
  assert.match(css, /\.faq summary::after\{content:"\+"/,
    "a collapsed FAQ question must show it can be opened");
  assert.match(css, /\.faq details\[open\]>summary::after\{content:"\\2212"\}/,
    "an open FAQ question must change glyph, or the state is invisible");
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
    timeline: /<ul class="time"[^>]*>[\s\S]*time__item/,
    skills: /<dl class="skills">[\s\S]*skills__bar/,
    steps: /<ol class="steps"[^>]*>[\s\S]*<h3>/,
    logos: /<ul class="logos"[^>]*>[\s\S]*<li>/,
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

/**
 * The thirteen original blocks build their own <section> tag, so the look used
 * to reach only the six written after it existed. The dispatcher is what fixes
 * that; this is the test that notices if it is removed. One block per build, so
 * a failure names the type instead of a count.
 */
test("the look reaches every block type, including the ones that predate it", () => {
  // A real 1x1 PNG, so the three blocks that render nothing without a picture
  // still render and the loop actually covers all eighteen.
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  for (const type of BLOCK_ORDER) {
    const doc = blankDoc();
    doc.assets = [{ id: "a1", name: "pic.png", type: "image/png", data: PNG }];
    const b = { ...makeBlock(type), effect: "outline" };
    for (const item of b.items || []) {
      if (item.image) item.image = { assetId: "a1", alt: bi("A picture", "Une image") };
    }
    if (b.image) b.image = { assetId: "a1", alt: bi("A picture", "Une image") };
    doc.pages[0].blocks = [b];
    const html = build(doc).files["index.html"];
    const sections = (html.match(/<section/g) || []).length;
    assert.ok(sections > 0, `${type} rendered no section at all`);
    assert.match(html, /<section class="section fx-outline[ "]/, `${type} ignored its look`);
    assert.equal((html.match(/fx-outline/g) || []).length, sections, `${type} painted only some of its sections`);
  }
});

test("the look never lands twice on the same section", () => {
  const doc = blankDoc();
  doc.pages[0].blocks = [
    { ...makeBlock("steps"), effect: "card" },
    { ...makeBlock("text"), effect: "card" },
    { ...makeBlock("faq"), effect: "card" }
  ];
  const html = build(doc).files["index.html"];
  assert.doesNotMatch(html, /fx-card fx-card/);
  assert.equal((html.match(/fx-card/g) || []).length, (html.match(/<section/g) || []).length);
});

test("a look does not corrupt a section that already carries a variant class", () => {
  const doc = blankDoc();
  doc.pages[0].blocks = [{ ...makeBlock("stats"), effect: "soft" }];
  const html = build(doc).files["index.html"];
  // "section--tight" must survive intact; a naive insert after `class="section`
  // would produce "section fx-soft--tight", which matches no rule at all.
  assert.doesNotMatch(html, /fx-\w+--/);
  assert.doesNotMatch(html, /class="section fx-soft--/);
});

test("the motion rules hang off selectors the renderer really emits", () => {
  // Union the classes all nine templates actually produce, then reject any
  // motion rule whose subject matches nothing anywhere. This is what catches
  // a utility class written for markup that was never emitted.
  const used = new Set();
  const collect = (html) => {
    for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) used.add(c);
  };
  for (const key of TEMPLATE_ORDER) {
    const files = build(fromTemplate(key)).files;
    for (const name of Object.keys(files)) if (name.endsWith(".html")) collect(files[name]);
  }
  // `.hero__media` only exists once somebody uploads a picture, so give one
  // hero an image rather than declaring that rule dead.
  const withPic = fromTemplate("portfolio");
  withPic.assets = [{ id: "a1", name: "pic.png", type: "image/png", data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }];
  for (const p of withPic.pages) {
    for (const b of p.blocks) if (b.type === "hero") b.image = { assetId: "a1", alt: bi("A picture", "Une image") };
  }
  for (const name of Object.keys(build(withPic).files)) {
    if (name.endsWith(".html")) collect(build(withPic).files[name]);
  }
  for (const motion of ["subtle", "expressive"]) {
    const css = siteCss({ ...blankDoc().theme, motion }, { title: "T", slug: "t", lang: "en" });
    const dead = [];
    for (const m of css.matchAll(/(^|[};])\s*([^{};]*)\{[^}]*animation:/g)) {
      for (const sel of m[2].split(",")) {
        const cls = sel.trim().match(/^\.([a-z][\w-]*)/);
        if (cls && !used.has(cls[1]) && !["keyframes"].includes(cls[1])) dead.push(`.${cls[1]}`);
      }
    }
    assert.equal([...new Set(dead)].join(" "), "", `${motion}: motion CSS targets nothing on any page`);
  }
});

test("the feature card carries the class its icon CSS is written against", () => {
  const doc = blankDoc();
  const b = makeBlock("features");
  b.items = [{ ...b.items[0], icon: "bolt" }];
  doc.pages[0].blocks = [b];
  const html = build(doc).files["index.html"];
  assert.match(html, /class="card feature"/);
  assert.match(html, /<svg class="ico"/);
  // And the icon must sit inside the element the size rule is written against.
  assert.match(html, /class="card feature"><svg class="ico"/);
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

test("an accent fill repaints every text token, not just the accent pair", () => {
  const css = siteCss({ ...blankDoc().theme }, { title: "T", slug: "t", lang: "en" });
  // One rule, instead of an override per component: an accent-filled section
  // swaps the tokens everything inside it is drawn with. Flipping only
  // --accent left page ink and muted grey on the fill, and left cards and
  // panels painted in the page surface - all present in the DOM, invisible on
  // screen. --alt and --alt-on stay: a chip carries its own audited pair.
  for (const token of ["--accent", "--accent-on", "--ink", "--muted", "--border", "--surface", "--bg"]) {
    assert.match(css, new RegExp(`\\.fx-accent\\{[^}]*${token}:var\\(--mf-accent`), `${token} is not repainted inside an accent fill`);
  }
  assert.doesNotMatch(css, /\.fx-accent\{[^}]*--alt[a-z-]*:var\(/, "the chip pair is audited on its own and must not be flipped");
});

test("a panel inside an accent fill takes the other ground, not the same one", () => {
  const css = siteCss({ ...blankDoc().theme }, { title: "T", slug: "t", lang: "en" });
  // An accent fill offers two colours, so a panel sitting on it has to take the
  // one the section is not using - and then carry accent text. Giving it the
  // same ground as the section measured 1.00:1 in the browser: white card on a
  // white card. This is the layer the flat token swap could not express.
  assert.match(css, /\.fx-accent\{[^}]*--surface:var\(--mf-accent-on\)/, "a panel needs a ground of the other colour");

  // Every component that paints its own --surface inside a section is a panel,
  // and every one of them was missing at some point: the card and the quote
  // first, then the CTA on the cv template at 1.00:1. The list has to be
  // checked against the stylesheet, not trusted.
  const painted = [...css.matchAll(/^([^{}]+)\{[^}]*background:var\(--surface\)/gm)]
    .map((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean));
  const panels = new Set();
  for (const group of painted) {
    for (const sel of group) {
      // Only components that live INSIDE a section. The wrappers that paint a
      // section's own ground (.fx-card > .wrap) are the section, not a panel,
      // and the page chrome is outside every look.
      if (sel.includes(">")) continue;
      const m = sel.match(/^\.([a-z][\w-]*)/);
      if (!m || m[1].startsWith("fx-")) continue;
      if (["site-head", "skip", "theme-toggle", "section--alt"].includes(m[1])) continue;
      panels.add(m[1]);
    }
  }
  const uncovered = [...panels].filter((c) => !new RegExp(`\\.fx-accent \\.${c}[,\\s]`).test(css));
  assert.equal(uncovered.length, 0, `painted with --surface but not given accent text inside an accent fill: ${uncovered.join(", ")}`);
});

test("the accent snapshots are literal colours, not var() of themselves", () => {
  const css = siteCss({ ...blankDoc().theme }, { title: "T", slug: "t", lang: "en" });
  // Custom properties are substituted where they are USED, not where they are
  // declared. A snapshot written --mf-accent: var(--accent) is not a snapshot:
  // --accent: var(--mf-accent-on) would resolve straight back to --accent and
  // the browser would drop the whole declaration as a cycle.
  const snap = [...css.matchAll(/--mf-accent(?:-on)?:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(snap.length >= 2, "no accent snapshots in the stylesheet");
  for (const v of snap) {
    assert.doesNotMatch(v, /var\(/, `snapshot ${v} is a reference, not a copy`);
    assert.match(v, /^#[0-9a-f]{3,8}$|^\d+$/, `snapshot ${v} is not a colour literal`);
  }
});

test("the accent fill's own background is the accent, not the colour meant to sit on it", () => {
  const css = siteCss({ ...blankDoc().theme }, { title: "T", slug: "t", lang: "en" });
  // If the fill itself used the swapped --accent it would come out the colour
  // of the text, and the section would vanish into the page.
  assert.match(css, /\.fx-accent\{[^}]*background:var\(--mf-accent\)/);
  assert.match(css, /\.fx-accent > \.wrap\{[^}]*background:var\(--mf-accent\)/);
});

test("a component that fills with the accent gets the unflipped one", () => {
  const css = siteCss({ ...blankDoc().theme }, { title: "T", slug: "t", lang: "en" });
  // The skill bar, the timeline dot and the step number paint the accent as a
  // FILL. Inside an accent fill --accent has been swapped to the text colour,
  // so a fill taken from it lands on its own ground: the bar's track and its
  // fill came out identical, and the dot disappeared. Found by putting all
  // eighteen blocks under one accent fill - no template happens to do that.
  for (const sel of [".skills__bar i", ".time__item::before", ".steps li::before"]) {
    const name = sel.split(" ")[0].replace(/[.]/g, "\\.");
    assert.match(css, new RegExp(`\\.fx-accent ${name}[^{]*\\{[^}]*background:var\\(--mf-accent\\)`),
      `${sel} fills with the flipped accent, so it lands on its own ground`);
  }
  // And the step number is text ON that fill, so it needs the other colour.
  assert.match(css, /\.fx-accent \.steps li::before\{[^}]*color:var\(--mf-accent-on\)/);
});

test("a descendant rule does not leak into a panel it was not meant for", () => {
  const css = siteCss({ ...blankDoc().theme }, { title: "T", slug: "t", lang: "en" });
  // The section rule once named the small element. A descendant selector has no
  // idea it is inside a card, so every <small> in a panel got the section's
  // text colour painted on the panel's own ground: 1.00:1, measured.
  assert.doesNotMatch(css, /\.fx-accent small/);
  assert.doesNotMatch(css, /\.fx-accent [a-z]+,[^{]*\.fx-accent small/);
});

test("every marker-less list still announces itself as a list", () => {
  // WebKit drops a <ul> or <ol> out of the accessibility tree the moment its
  // markers are removed, and `display: grid` does the same: a screen reader
  // then hears a flat run of items with no count and no position. role="list"
  // puts it back. Which lists those are is decided by the STYLESHEET, so the
  // check reads the stylesheet rather than a hand-kept list.
  const css = siteCss({ ...blankDoc().theme }, { title: "T", slug: "t", lang: "en" });
  const stripped = new Set();
  for (const m of css.matchAll(/\.([a-z][\w-]*)[^{]*\{[^}]*(?:list-style:none|display:grid)/g)) {
    stripped.add(m[1]);
  }
  assert.ok(stripped.size >= 3, `expected several marker-less lists, found ${[...stripped].join(", ")}`);

  const missing = [];
  for (const key of TEMPLATE_ORDER) {
    const files = build(fromTemplate(key)).files;
    for (const [name, html] of Object.entries(files)) {
      if (!name.endsWith(".html")) continue;
      for (const m of html.matchAll(/<(ul|ol)\b([^>]*)>/g)) {
        const cls = (m[2].match(/class="([^"]*)"/) || ["", ""])[1].split(/\s+/);
        const isStripped = cls.some((c) => stripped.has(c));
        if (isStripped && !/\brole="list"/.test(m[2])) {
          missing.push(`${key}/${name}: <${m[1]} class="${cls.join(" ")}">`);
        }
      }
    }
  }
  assert.equal(missing.length, 0, `lists WebKit would drop from the accessibility tree:\n  ${missing.join("\n  ")}`);
});

test("the skip link is hidden until it is focused, and comes back on focus", () => {
  const css = siteCss({ ...blankDoc().theme }, { title: "T", slug: "t", lang: "en" });
  const hidden = css.match(/\.skip\{[^}]*\}/);
  assert.ok(hidden, "the stylesheet never hides the skip link, so it is always on screen");
  assert.match(hidden[0], /left:-9999px/, "hidden by moving it off-screen, not by display:none");

  const shown = css.match(/\.skip:focus\{[^}]*\}/);
  assert.ok(shown, "nothing brings the skip link back when it is focused");
  assert.match(shown[0], /left:1rem/, "the focused skip link stays at the off-screen position");
  assert.match(shown[0], /z-index:\d+/, "it must land above the header it sits on");
  // Same specificity, so the focused rule has to come second.
  assert.ok(css.indexOf(".skip:focus{") > css.indexOf(".skip{"), "the focused rule is declared before the hidden one");
});

test("printing cannot leave content at the start of an entrance animation", () => {
  // Every entrance rule uses animation-fill-mode: both, which leaves an
  // element at its "from" state - opacity 0 - if the browser holds that state
  // when the animation never runs. Chrome happens not to; another browser
  // might, and the result is a page that prints blank. So the guarantee is in
  // the stylesheet rather than in the browser's goodwill.
  const css = siteCss({ ...blankDoc().theme, motion: "expressive" }, { title: "T", slug: "t", lang: "en" });
  const at = css.indexOf("@media print");
  assert.ok(at >= 0, "the stylesheet has no print rules at all");
  const print = css.slice(at, at + 300);
  assert.match(print, /animation:none!important/);
  assert.match(print, /transition:none!important/);
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

/**
 * Enum options are a different shape from labels - [value, [en, fr]] - and
 * the shape is what the inspector reads. A flat [value, en, fr] renders eight
 * blank options with no error anywhere, so the shape is asserted here.
 */
test("every enum option is a value plus an EN/FR pair, not a flat tuple", () => {
  const bad = [];
  const check = (type, where, options) => {
    for (const o of options || []) {
      if (!Array.isArray(o) || o.length !== 2) { bad.push(`${type}.${where}: ${JSON.stringify(o)}`); continue; }
      if (typeof o[0] !== "string" || !o[0]) bad.push(`${type}.${where}: value is not a string`);
      const pair = o[1];
      if (!Array.isArray(pair) || !pair[0] || !pair[1]) bad.push(`${type}.${where}.${o[0]}: label is not an EN/FR pair`);
    }
  };
  for (const [type, def] of Object.entries(BLOCKS)) {
    for (const f of def.fields) {
      if (f.t === "enum") check(type, f.k, f.options);
      for (const sf of f.of || []) if (sf.t === "enum") check(type, `${f.k}.${sf.k}`, sf.options);
    }
  }
  assert.equal(bad.length, 0, `malformed enum options: ${bad.join(", ")}`);
});

test("every enum option value survives normalisation instead of becoming a blank control", () => {
  const doc = normalizeDoc(JSON.parse(JSON.stringify(fromTemplate("cv")))).doc;
  const empty = [];
  for (const page of doc.pages) {
    for (const b of page.blocks) {
      const def = BLOCKS[b.type];
      for (const f of def.fields) {
        const options = f.options || [];
        if (!options.length) continue;
        const v = b[f.k];
        if (v == null) continue;
        if (!options.some(([val]) => val === v)) empty.push(`${b.type}.${f.k}=${v}`);
      }
    }
  }
  assert.equal(empty.length, 0, `no matching option, the control renders blank: ${empty.join(", ")}`);
});

/**
 * The quality report flags an image with no alt, so every image the inspector
 * can reach needs an alt control beside it. The picker used to be the whole
 * field: the hero had a second, separately written alt input, and every image
 * added after it - gallery items, logos, a testimonial photo - had a warning
 * with no way to act on it.
 */
test("every image field the inspector offers also offers alt text", () => {
  // The alt input writes into `spec.alt`, so an image spec without that slot
  // would silently drop what the user typed. The picker used to be the whole
  // field: the hero had a second, separately written alt input, and every image
  // added after it had a quality warning with no way to act on it.
  const missing = [];
  const ok = (v) => v && typeof v === "object" && "alt" in v && v.alt && "en" in v.alt && "fr" in v.alt;
  for (const [type, def] of Object.entries(BLOCKS)) {
    const d = def.defaults();
    for (const f of def.fields) {
      if (f.t === "img" && !ok(d[f.k])) missing.push(`${type}.${f.k} default has no alt slot`);
      for (const sf of f.of || []) {
        if (sf.t !== "img") continue;
        const row = (d[f.k] || [])[0] || {};
        if (!ok(row[sf.k])) missing.push(`${type}.${f.k}[].${sf.k} default has no alt slot`);
      }
    }
  }
  assert.equal(missing.length, 0, `alt cannot be entered for: ${missing.join(", ")}`);
});

test("an image written through the inspector lands an alt in the built page", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const doc = blankDoc();
  doc.assets = [{ id: "a1", name: "pic.png", type: "image/png", data: PNG }];
  const b = makeBlock("logos");
  b.items = [{ name: bi("Client", "Client"), image: { assetId: "a1", alt: bi("Client wordmark", "Logotype du client") } }];
  doc.pages[0].blocks = [b];
  const html = build(doc).files["index.html"];
  assert.match(html, /<img src="assets\/pic\.png" alt="Client wordmark"/);
  // And the quality report has nothing to complain about.
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(imgs.filter((t) => !/\balt="[^"]+"/.test(t)).length, 0, `images without alt: ${imgs.join(" ")}`);
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

test("the contact form answers in its own page's language", () => {
  // site.js is one constant for the whole export, so a message written into it
  // is English on every page of every site. It used to be: the invalid-address
  // and sent messages were baked with st(..., "en"), and a French visitor was
  // told to enter a valid email address in English. The words live on the page
  // now, where the page knows its own language.
  const d = doc("portfolio");
  d.meta.bilingual = true;
  d.email = "hello@example.test"; // portfolio ships an empty address; without one there is no form
  const files = build(d).files;
  const unescapeHtml = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const forms = Object.entries(files).filter(([n, h]) => /^[^/]+\.html$/.test(n) && /data-form-status/.test(h));

  assert.ok(forms.length > 0, "no exported page carries a contact form at all");
  const languages = new Set();
  for (const [name, html] of forms) {
    const lang = /<html lang="(\w+)"/.exec(html)?.[1];
    const bad = /data-bad-email="([^"]*)"/.exec(html)?.[1];
    const sent = /data-sent="([^"]*)"/.exec(html)?.[1];
    assert.ok(bad && sent, `${name}: the status element carries no message to show`);
    assert.equal(unescapeHtml(bad), st("formBadEmail", lang), `${name}: invalid-address message is not in ${lang}`);
    assert.equal(unescapeHtml(sent), st("formSent", lang), `${name}: sent message is not in ${lang}`);
    languages.add(lang);
  }
  assert.deepEqual([...languages].sort(), ["en", "fr"], "the form was only checked in one language");
});

test("site.js never writes a status message of its own", () => {
  // The half of the bug the page-side test cannot see: correct strings on the
  // page are worthless if the shipped script ignores them and uses its own. This
  // file is one constant for the whole export, so any literal it carries is
  // English on every page. The message has to be read off the element.
  assert.ok(!/\.textContent\s*=\s*"/.test(SITE_JS),
    "site.js still assigns a baked message instead of reading it from the page");
  assert.ok(SITE_JS.includes('getAttribute("data-bad-email")'), "the invalid-address message is not read off the page");
  assert.ok(SITE_JS.includes('getAttribute("data-sent")'), "the sent message is not read off the page");
});

test("a project survives being saved and loaded again, unchanged", () => {
  // The format is documented as portable, which means a document that has been
  // through normalizeDoc once must be a fixed point: loading it again changes
  // nothing at all. A second pass that quietly rewrites or drops a field is not
  // visible until the third save, long after the user stopped thinking about it.
  let compared = 0;
  for (const key of TEMPLATE_ORDER) {
    const once = JSON.stringify(normalizeDoc(JSON.parse(JSON.stringify(fromTemplate(key)))).doc);
    const twice = JSON.stringify(normalizeDoc(JSON.parse(once)).doc);
    // Guards against passing on emptiness: two blank documents are equal too.
    compared += once.length;
    assert.equal(twice, once, `the ${key} document changes on a second load`);
  }
  assert.ok(TEMPLATE_ORDER.length >= 9, `only ${TEMPLATE_ORDER.length} templates were compared`);
  // Measured at ~55 000 characters across the nine templates; the floor is set
  // well under that so it cannot start failing on ordinary template edits, and
  // well over zero so the comparison cannot pass by comparing nothing.
  assert.ok(compared > 30000, `only ${compared} chars compared across ${TEMPLATE_ORDER.length} templates`);
});

test("one broken block never takes the whole page down", () => {
  // The render loop wraps every block in a try/catch, and that catch is the only
  // thing between a single bad block and an export with an empty page. Nothing
  // tested it, so deleting the try would break every site without turning a
  // single check red.
  const d = fromTemplate("portfolio");
  const victim = d.pages[0].blocks.find((b) => b.type === "features");
  const original = BLOCKS.features.render;
  BLOCKS.features.render = () => { throw new Error("deliberate failure"); };
  try {
    const html = build(d).files["index.html"];
    assert.ok(/<main/.test(html) && /<h1/.test(html), "the page around the broken block still rendered");
    assert.ok(/<small>features<\/small>/.test(html), "the broken block shows its own name rather than vanishing");
    assert.ok(!/deliberate failure/.test(html), "the error message does not leak into the page");
  } finally {
    BLOCKS.features.render = original;
  }
});

test("the legal page escapes the company's own text exactly once", () => {
  // fillLegal() used to escape the substituted values and then the caller
  // escaped the whole body again, so "Tom & Jerry Ltd" shipped as
  // "Tom &amp;amp; Jerry Ltd" and the user read the entities on their own site.
  const d = fromTemplate("business");
  d.company = "Tom & Jerry <Ltd>";
  d.email = "a&b@example.test";
  const legal = build(d).files["legal.html"];

  assert.ok(!/&amp;amp;|&lt;lt;|&gt;gt;/.test(legal),
    `double escaping reached the page: ${legal.match(/&(?:amp|lt|gt);(?:amp|lt|gt);/)?.[0]}`);
  assert.ok(legal.includes("Tom &amp; Jerry &lt;Ltd&gt;"),
    "the name is present and escaped exactly once");
  assert.ok(legal.includes("a&amp;b@example.test"), "the address is escaped exactly once");

  // Dropping the inner escaper is only safe because the caller still escapes.
  // If that ever changes, this is the assertion that fails first.
  d.company = "<script>alert(1)</script>";
  const attack = build(d).files["legal.html"];
  assert.ok(!/<script>alert\(1\)<\/script>/.test(attack),
    "a company name carrying markup must not reach the page as markup");
});

test("tr picks the half the current language reads, and falls back", () => {
  // The editor used to write this selection out by hand eleven times. Getting it
  // wrong blanks a label in one language only, which is the kind of bug nobody
  // sees in review and every reader of that language notices.
  const was = ui.lang;
  try {
    const row = ["Title", "Titre"];
    ui.lang = "en";
    assert.equal(tr(row), "Title");
    ui.lang = "fr";
    assert.equal(tr(row), "Titre");
    // An untranslated half falls back rather than showing nothing.
    assert.equal(tr(["Only English", ""]), "Only English");
    assert.equal(tr(undefined), "");
    assert.equal(tr([]), "");
  } finally {
    ui.lang = was;
  }
});

test("walkI18n finds every translatable string and stops at it", () => {
  // The untranslated audit walks the document with this, and the editor has a
  // second copy of the walk. It had no test of its own until it was the only one
  // left: two implementations of "what is a translatable string", and nothing to
  // notice when they stopped agreeing.
  const doc = {
    name: { en: "Studio", fr: "Atelier" },
    count: 3,
    meta: { lang: "en" },
    pages: [{ slug: "a", title: { en: "A", fr: "B" } }],
    nested: { deep: { list: [{ text: { en: "T", fr: "U" } }] } }
  };
  const seen = [];
  walkI18n(doc, (_v, path) => seen.push(path));
  // The leading dot is the walk's own shape: it starts at the root path "" and
  // appends ".key". Nothing renders the path today, so it stays as it is.
  assert.deepEqual(seen.sort(),
    [".name", ".nested.deep.list[0].text", ".pages[0].title"],
    "every pair, at any depth, by path");
});

/**
 * A bilingual field is {en, fr}. Hand one to esc() and String() gives you the
 * literal text "[object Object]" -- which is how the store and saas templates
 * shipped their stat figures as that string instead of a number. Nothing
 * downstream crashed, the page still validated, and the value was simply gone.
 */
test("no translated object ever leaks into a rendered page as [object Object]", () => {
  const leaks = [];
  for (const key of TEMPLATE_ORDER) {
    for (const [rel, html] of Object.entries(build(TEMPLATES[key].build()).files)) {
      if (typeof html !== "string" || !html.includes("[object Object]")) continue;
      leaks.push(`${key}/${rel}`);
    }
  }
  assert.deepEqual(leaks, [],
    "esc(T(value, lang)) is required wherever a field is declared i18n");
});

/**
 * A key the block's field list does not declare is invisible to the editor:
 * it renders nowhere today and is dropped the moment anyone opens the template
 * and saves. Nine "lead" sentences across six templates were written, never
 * shown, and never recoverable. Either the block declares the field or the
 * template does not ship the key.
 */
test("no template hands a block a field the editor would silently drop", () => {
  const declared = (type) => {
    const keys = new Set();
    const walk = (fields) => {
      for (const f of fields || []) {
        keys.add(f.k);
        if (f.of) walk(f.of);
      }
    };
    walk(BLOCKS[type]?.fields);
    return keys;
  };
  const STRUCTURAL = new Set(["id", "type", "effect"]);
  const orphans = [];
  for (const key of TEMPLATE_ORDER) {
    for (const page of TEMPLATES[key].build().pages || []) {
      for (const block of page.blocks || []) {
        const type = Array.isArray(block) ? block[0] : block.type;
        const data = Array.isArray(block) ? block[1] : block;
        if (!data || typeof data !== "object") continue;
        const known = declared(type);
        for (const k of Object.keys(data)) {
          if (!STRUCTURAL.has(k) && !known.has(k)) orphans.push(`${key}/${type}.${k}`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(orphans)].sort(), [],
    "every key a template writes must be a field its block declares");
});