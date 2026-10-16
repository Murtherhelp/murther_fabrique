# MURTHER FABRIQUE — website generator

A visual website generator that runs entirely in your browser. You fill in a
form, watch the real page update beside it, and download a folder of plain
static files to upload anywhere.

- **No account, no server, no build step, no dependency.**
- **French / English interface**, and generated sites can be bilingual too.
- **Nothing leaves your browser.** No cookie, no CDN, no remote font, no
  analytics, no telemetry.

---

## Where this lives

```
C:\Users\Miyabo\Documents\Website Generator\
├─ 01-legacy-generator-ORIGINAL\    the first generator (logic untouched)
│  └─ index.html
└─ 02-website-generator-NEXT\       ← this project. Start here.
   ├─ package.json
   ├─ server.mjs
   ├─ README.md
   ├─ src\
   ├─ desktop\                    the Windows launcher and its build script
   └─ test\
```

## Run it

```bash
cd "C:\Users\Miyabo\Documents\Website Generator\02-website-generator-NEXT"
npm start
```

Then open **<http://localhost:5173/>**.

The folder names contain no spaces, so `cd` works without quoting in cmd,
PowerShell and Git Bash alike.

There is nothing to install. `npm install` is not needed and would install
nothing — `package.json` has no dependencies on purpose. Node 18+ is required
(`node:http`, `CompressionStream`, `DecompressionStream`).

A server is needed for one reason only: ES modules are blocked over `file://`
by the browser's CORS rules. `server.mjs` is a 60-line read-only static file
server bound to `localhost`. You can also serve `src/` with any other static
server, or open the folder in an IDE that provides one.

## One file, no server

If you would rather not run anything at all, build the single file and open it
by double-click:

```bash
npm run build     # writes dist/generator.html
```

`dist/generator.html` is the whole generator — CSS, all ten modules, everything
— in one 255 KB file. It needs no server, no Node, no install, and no network,
exactly like the legacy generator. Double-click it.

The eleven source modules stay exactly as they are. `build.mjs` flattens them
into one inlined `<script type="module">`, wrapping each in its own scope so
their names cannot collide. That is why the test suite is untouched by it: the
tests still import `src/js/*.js` directly. **`dist/generator.html` is generated
— edit `src/`, never the bundle.**

## Test it

```bash
npm test          # 111 core checks, no browser needed
npm run verify    # everything: core + 5 more suites, starting its own servers
```

Each browser suite can also be run alone - `npm run test:browser`, `test:a11y`,
`test:i18n`, `test:export` - and starts the server it needs, then stops it
again. Add `--head` to any of them to watch the browser work.

| suite | checks | what it covers |
|---|---:|---|
| **core** (`npm test`) | 111 | The pure engine in Node: XSS boundary, `safeHref`, contrast maths, dark-mode derivation, block registry, all 9 templates and their distinctness, bilingual output, nav integrity, hostile project import, undo/redo, ZIP writer, and that the exported contact form speaks its own page's language. |
| **browser** | 83 | The real editor: language switching, every template and all 18 section types, inspector, quality report, undo/redo, drag-to-reorder, preview-frame navigation guard, the live contrast readout, accessible names, the theme's light and dark output. |
| **accessibility** | 31 | Real Tab keypresses, accessible names on every control, focus visibility, landmarks, focus retention across a language switch, overflow at maximum text size. |
| **i18n** | 11 | Autosave and reload round-trip, language independence, both site languages surviving a reload. |
| **export** | 91 | Builds a real ZIP, re-reads it with an **independent** reader (Node's `zlib`, not our writer), then serves the extracted tree over HTTP, renders it, and clicks the theme toggle the generated site ships, and reads its console — twice, once with the system pinned to light and once to dark. |
| **single-file** | 11 | Builds `dist/generator.html`, then **opens it over `file://`** — no server, no Node — and checks it produces the identical file tree, template by template, that the modules do. |
| **original** | 6 | Loads the archived legacy generator over a real origin and reads the self-check it already runs at start-up. Silence counts as a failure: the suite requires the positive report, so a generator that never checks itself cannot pass. |
| **server** | 14 | Malformed URL is a 400 **and the process survives it**, reads stay under `src/`, and the CSP carries the live SHA-256 of the scripts it hashes at start-up. |
That last one is the important one: a bug in the ZIP writer cannot hide behind a
matching bug in a reader that shares no code with it, and "the export works" is
verified by looking at the rendered page, not by trusting the builder.

No dependency is needed for any of this — Node's test runner and its built-in
WebSocket client speak the Chrome DevTools Protocol directly.

## What it produces

```
your-site.zip
├─ index.html              one file per page
├─ about.html
├─ 404.html
├─ privacy.html
├─ legal.html
├─ css/style.css
├─ js/site.js              theme toggle + form, ~60 lines, no framework
├─ assets/…                your images
├─ favicon.svg
├─ og.png                  social card, generated from your colours
├─ robots.txt
├─ sitemap.xml
├─ _headers                CSP + HSTS, read by Netlify and Cloudflare Pages
└─ DEPLOY.txt              hosting notes, in the site's language
```

Upload the folder as-is. No compilation, no framework, no runtime dependency.
The preview you saw and the ZIP come from the same `build()` call, so they
cannot drift apart.

## Light and dark

The **Design → Theme** control has three settings:

- **Auto** (default) — follow the visitor's system, and ship the ◐ toggle so
  they can override it. The choice is remembered in *their* `localStorage`.
- **Light** / **Dark** — pinned. The toggle is not rendered, because there is
  nothing for it to decide.

One stylesheet carries both. The light tokens sit in `:root`, and the dark set
is derived from them by `darken()` and written to `[data-theme="dark"]` and to
a `prefers-color-scheme` media query, so the toggle and the system preference
can never disagree. The derived accent is lifted until it clears 4.5:1 against
**both** the page and the card surface — the navigation sits on the surface, not
on the page, and checking only the page is how a dark theme once shipped an
active link at 3.85:1.

The preview pane's **Desktop / Tablet / Phone** buttons render the page at
1280 / 820 / 390 px. The stage scrolls when the frame is wider than the pane,
so choosing Desktop really does give you a 1280 px page. The current width is
printed under the frame.

## Architecture

One idea holds it together: **`build(doc)` is a pure function from a JSON
document to a file tree.** No DOM, no clock, no network. The preview renders it,
the export zips it, the quality report reads it, and the tests assert on it.

```
src/
├─ index.html              the editor shell
├─ app.css                 editor styles (shares nothing with generated sites)
└─ js/
   ├─ i18n.js              generator interface dictionary (FR/EN)
   ├─ site-strings.js      generated site's own dictionary (FR/EN)
   ├─ safe.js              THE TRUST BOUNDARY: esc, safeHref, md, contrast
   ├─ themes.js            palettes, dark derivation, stylesheet emitter
   ├─ blocks.js            component registry — 18 section types
   ├─ icons.js             18 inline SVG glyphs - no icon font, no CDN, no request
   ├─ build.js             doc → files
   ├─ templates.js         9 starter projects
   ├─ presets.js           the visual character of each starter (colours, radius)
   ├─ store.js             document schema, validation, undo/redo, persistence
   ├─ zip.js               ZIP writer built on CompressionStream
   └─ ui.js                the editor
```

### Why no framework

The ladder starts at "does this need to exist". The output must be plain static
HTML, so a framework could only ever serve the editor chrome — the one part that
must load instantly and stay readable. React and Vite would add ~45 KB of
runtime and a build step to buy that, and nothing else. The platform already
provides what looked like dependencies: `CompressionStream` *is* the ZIP
writer, the File System Access API *is* "save into a folder", native drag
events and `<dialog>` *are* the editor primitives, CSS custom properties *are*
the theme system.

### Adding a section type

One object in `BLOCKS`, one line in `BLOCK_ORDER`, and at least one template
that uses it - the core suite fails on a block nobody can reach. Everything else
is automatic: the "Look" field comes from `effectField()`, the icon and alt
pickers from `t: "img"`, and the stylesheet needs a rule only if your markup
introduces a new class.

```js
myBlock: {
  label: ["Testimonial", "Témoignage"],
  hint:  ["What this section is for.", "À quoi sert cette section."],
  defaults: () => ({ quote: bi("", ""), author: bi("", "") }),
  fields: [
    { k: "quote",  t: "text", lbl: ["Quote", "Citation"], i18n: true },
    { k: "author", t: "text", lbl: ["Author", "Auteur"], i18n: true }
  ],
  render(b, c) {
    return `<section class="section"><div class="wrap">
  <blockquote>${esc(bT(b.quote, c.lang))}</blockquote>
  <p><small>${esc(bT(b.author, c.lang))}</small></p>
</div></section>`;
  }
}
```

The field spec drives the inspector form, the bilingual toggle, the outline and
the audit automatically. `render` must escape every value: the exported site
carries user text straight into HTML.

### Adding a template

One object in `TEMPLATES` returning a document, one line in `TEMPLATE_ORDER`,
one entry in `PRESET_FOR`. No engine, no inheritance, no partials.

A template is a *kind* of page, not a colour. Each one gets its own preset in
`presets.js` — background, surface, ink, accent, chip colour, corner radius —
so the nine are told apart at a glance. The suite enforces that: no two
templates may share a background, share a block structure, or ship fewer than
six sections. `forum` borrows the `community` preset and `blank` borrows
`basic`, which is why `PRESET_FOR` is written out instead of inferred.

`muted` is deliberately absent from every preset — the theme derives it from the
ink, so it cannot be authored into a failing state. `alt` has no natural
derivation (a chip colour is a taste decision), so each preset names one.

## The French / English feature

Two independent languages, deliberately kept apart:

| | lives in | affects |
|---|---|---|
| **Interface language** | `i18n.js` | the generator only |
| **Site language** | the document, `meta.lang` | the exported files only |

Switching the interface re-labels controls via `paintLabels()`. It never writes
an input value and never rebuilds an element that holds one, so your cursor
does not move and in-progress edits survive. There is a browser check for this
specifically: it writes markers into a title, switches language, and asserts the
markers are untouched.

Every dictionary entry is a **tuple** `[English, French]` rather than two
objects, so a missing translation is impossible to hide. The core suite asserts
that every key in all three dictionaries (interface, block registry, templates)
carries both languages, and that no French entry is a silent copy of its English
outside the words French genuinely borrows unchanged ("Design", "Export",
"Blog", "Pages", the product name).

The browser suite then checks the languages on the screens a static file scan
would never reach: the four collapsed panel headers, every row of the quality
report, the template picker, the section picker, and the section editor's own
labels — all in both languages, with no raw dictionary key leaking into the DOM.
That last check is the one that matters: it fails if any label reads as
`auAltOk` or `lblSiteName` instead of a sentence.

**Bilingual sites** are separate and opt-in (SEO panel → *Make the site
bilingual*). Each text field gets an editable FR and EN version with a
"copy to the other language" button, and the export writes **two real files per
page** (`about.html` + `about.fr.html`) rather than one file plus a JavaScript
toggle. That keeps a distinct URL per language, a correct `<html lang>`, working
`hreflang`, and no flash of the wrong language before scripts run.

Your language choice is remembered in `localStorage` and never enters the
project file. First run follows the browser's language if we speak it.

## Security

- **Escaping happens once, in `safe.js`.** `esc()` for text, `safeHref()` for
  URLs. `md()` escapes before decorating, so user text can never produce a tag.
- **`safeHref` rejects by scheme, not by filtering.** Stripping "unfriendly"
  characters is not validation: `javascript:alert(1)` becomes `javascript:alert1`
  and still executes. It also rejects `//evil.com`, which is protocol-relative
  and silently leaves your origin — a hole the previous generator had.
- **Project files are normalised, not trusted.** Import rebuilds every block
  from its spec, clamps every number, accepts only base64 image data URIs, and
  refuses any asset whose name could escape `assets/`.
- **Custom CSS is sanitised**: remote `@import` and `url()` are stripped, so an
  exported site never calls a third party. The quality report tells you how
  many rules it removed.
- **The generated site ships a strict CSP** in `_headers`, and the editor's own
  server sends one too: `script-src 'self'` with no inline script and no eval.
- **No secrets in the code.** There is no server-side code, no database, no
  credential, and nothing to leak.

## Accessibility

- Semantic landmarks, a skip link, and `<main tabindex="-1">` in every generated
  page.
- All 15 contrast pairs of all 5 palettes verified at build time against WCAG
  AA, light and dark, including dark mode and text on chips. `muted`, the accent
  and the ink that sits on a chip are **derived**, not hand-picked, so they stay
  compliant when you change a colour.
- Keyboard reachable throughout: every outline row is a real focusable control,
  dialogs are native `<dialog>`, `Ctrl+Z` / `Ctrl+Y` undo and redo.
- Visible focus rings, `prefers-reduced-motion` honoured, no image ships
  without declared dimensions (no layout shift) or a way to declare alt text.
- The editor's text size scales the whole UI through the root font size, so
  spacing and touch targets grow with it.

## What is **not** built

Stated plainly, because a generator that fakes these is worse than one that
omits them.

| Feature | Status |
|---|---|
| Real accounts, login, roles | Needs a server and a database. Not here. |
| Forum posting, comments, moderation | Static pages show content. Writing to it needs a backend. |
| Store checkout, cart, payments | Product grid and prices only. Needs a payment provider. |
| SaaS dashboards with live data | Marketing pages only. Live data needs an API. |
| Contact form → mailbox | **Works**, via a `mailto:` link that opens the visitor's mail client. Point it at a form service for server-side delivery. |
| Saving to the cloud | Project autosaves to `localStorage`; export is a file. No cloud. |

The extension points are real, not decorative: the block registry takes new
sections, `templates.js` takes new starters, and the export is a plain file
tree any backend can serve.

## Verified

`npm run verify` currently reports **358 checks passing across 8 suites** and
exits 0:

```
81 core · 80 browser · 31 accessibility · 11 i18n · 32 export · 11 single-file
```

The generated site was also confirmed to render correctly on its own: a
thrown-together project was exported, the ZIP was re-read by an independent
reader, extracted to disk, served over HTTP, and loaded in a browser — twice,
once with the system pinned to light and once to dark, each time measured for
real rendered contrast on the hero title, the lede, the primary button, the
eyebrow chip, the navigation, the header, the footer and the body text.
Correct styles, correct heading, working navigation, and an image that loads
over HTTP with zero external requests.

## Performance

The editor is ~11 modules of plain ES, no runtime to parse. A build is a
function call, so the preview updates on every keystroke without debouncing the
render. The exported site is one stylesheet, one small script, no framework, no
web fonts (system font stack), `loading="lazy"` on images, and images resized
only when you supply them already sized.

## Files created

```
MURTHER FABRIQUE — website generator/
├─ package.json           scripts only, zero dependencies
├─ build.mjs              emits dist/generator.html (the one-file build)
├─ server.mjs             static file server, Node stdlib only
├─ README.md              this file
├─ src/                   the application (see Architecture)
├─ desktop/               the Win32 + WebView2 launcher and its build script
├─ dist/                  generated: generator.html
└─ test/
   ├─ test.mjs            111 core checks (node --test)
   ├─ browser.mjs         83 end-to-end editor checks
   ├─ a11y.mjs            31 accessibility checks
   ├─ i18n.mjs            11 language and persistence checks
   ├─ export.mjs          91 export checks (real ZIP, real HTTP, real render)
   ├─ single.mjs          11 single-file checks (real file:// load)
  original.mjs          6 original checks (reads the legacy self-check)
  server.mjs            14 server checks (traversal, 400 survival, live CSP hashes)
   └─ verify.mjs          runs all eight suites
   serve.mjs           the server a browser suite starts for itself
```

## The Windows application

```powershell
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
# -> ..\..\MurtherFabrique.exe   (655 KB, one file)
```

A native Win32 window hosting the **WebView2** runtime that Windows 10 21H2 and
Windows 11 already ship, so the executable is half a megabyte rather than the
150 MB an Electron wrapper would cost. **Both** generators are compiled into it:
double-clicking opens a chooser for NEXT or for the archived ORIGINAL. The
applications are unpacked to `%LOCALAPPDATA%\MurtherFabrique\` on first run,
keyed by a hash of their own bytes.

The page is served from a `https://murther-fabrique.local/` virtual host rather
than `file://`, because a real origin is what `localStorage` needs: over
`file://` the origin is opaque and autosave would not survive a restart. One
controller serves both, so switching generators is a remap and a navigate.

```powershell
..\..\MurtherFabrique.exe --selftest ; $LASTEXITCODE   # 0 = both healthy
```

It probes NEXT, then navigates the same window to ORIGINAL and probes that too,
checking each is genuinely rendered rather than merely loaded. A page that has
painted but whose script died still has a title, a script element and its static
markup, so rendering alone proves nothing: a hook installed before any page
script runs records uncaught exceptions and unhandled rejections, and a verdict
fails on any of them. ORIGINAL exposes no `window.wgn`, so it is verified through
that hook rather than through NEXT's own API. The transcript lands in
`%LOCALAPPDATA%\MurtherFabrique\selftest.txt`.

Building it needs the MSVC build tools (*Desktop development with C++*) and the
Windows SDK; it fetches one pinned NuGet package into `desktop/.cache/` the
first time. See the [root README](../README.md) for the details.

---

**The first generator, at `..\01-legacy-generator-ORIGINAL\index.html`, keeps
its original logic exactly — the SHA-256 below is of the file *after* the
interface was put into the MURTHER FABRIQUE palette, which is the one change
made to it. Nothing in its form handling, its builder, its audit or its export
was touched; SHA-256 `758D7A0C788F64AFCD0A09F9375A7CB187CDFACA1EBCF547A98215186E2C2F04`
was the file before that change and
`F7C4EAB78936F68DEC84936D2E745DF900C4FEEA91A1EA3966C4110D3D63879E` is it now.

Its internal project identifiers (`fabrique.ui` in `localStorage`, the
`fabrique: 1` format marker) are deliberately **not** renamed: they identify
project files people have already saved, and changing them would break every
one of those files for no visible gain.**
