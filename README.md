<p align="center">
  <img src="assets/logo/logo-720.png" alt="MURTHER FABRIQUE" width="540">
</p>

<p align="center">
  <strong>Two website generators. One desktop application. No accounts, no servers, no tracking.</strong>
</p>

---

MURTHER FABRIQUE builds real, static websites: plain HTML, one stylesheet, one
small script, nothing to compile and nothing to install. Everything here runs on
**Windows**, offline, on the machine it is on.

| | What it is | Who it is for |
|---|---|---|
| [**02-website-generator-NEXT**](02-website-generator-NEXT/) | The current generator. A visual editor, nine starter templates, thirteen section types, a quality report, and a ZIP of finished static files. | Anyone shipping a small business site, portfolio, CV, brochure or landing page — with or without coding experience. |
| [**01-legacy-generator-ORIGINAL**](01-legacy-generator-ORIGINAL/) | The previous generator, kept whole. One 156 KB HTML file, opened by double-click. | Reference. Kept byte for byte as the historical original; it still runs. |

---

## Quick start

Nothing to install for the generator itself — `package.json` has **no
dependencies on purpose**. Node 18 or newer is the only requirement.

```bash
git clone https://github.com/Murtherhelp/murther_fabrique.git
cd "murther_fabrique/02-website-generator-NEXT"

npm start          # editor at http://localhost:5173/
npm test           # 80 core checks, no browser needed
npm run verify     # 241 checks across 6 suites, browsers included
npm run build      # dist/generator.html — one file, opens by double-click
```

A server is needed for exactly one reason: browsers block ES modules over
`file://`. `server.mjs` is a read-only static server bound to `127.0.0.1`. If you
would rather not run anything, `npm run build` produces `dist/generator.html` —
255 KB containing the entire editor, which opens by double-click with no server,
no Node and no network.

## The Windows application

```powershell
cd "murther_fabrique\02-website-generator-NEXT"
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
# -> dist\MurtherFabrique.exe   (495 KB)
```

`MurtherFabrique.exe` is **one self-contained file**. Double-click it. There is
no installer, no sidecar DLL, and nothing is downloaded after launch. The
application itself is compiled into the executable and unpacked to your profile
on first run.

It is a native Win32 window hosting the Microsoft Edge **WebView2** runtime —
the component Windows 10 21H2 and Windows 11 already ship, which is why the file
is half a megabyte instead of the 150 MB an Electron wrapper would cost. Your
projects autosave to the application profile, so they survive a restart and a
reinstall.

**Requirements to build it:** the MSVC build tools with the *Desktop development
with C++* workload and the Windows SDK. The build downloads one pinned NuGet
package (the WebView2 SDK, ~10 MB) into `desktop/.cache/` and never a second
time. **Requirements to run it:** Windows. Nothing else.

The packaged application can check itself:

```powershell
.\dist\MurtherFabrique.exe --selftest ; $LASTEXITCODE
```

It boots the real application, confirms the editor is alive, builds a site,
verifies that storage works, and exits `0` on success. A transcript is written
to `%LOCALAPPDATA%\MurtherFabrique\selftest.txt`.

### Known limitation

In the editor's **preview pane** the generated site's own script does not run —
the theme toggle there is inert. The preview is a `srcdoc` document and inherits
the editor's strict Content-Security-Policy, which forbids inline script. The
**exported site is unaffected**: it loads `js/site.js` as an external file, which
that policy allows. Use *Export → download*, or open `index.html` over HTTP, if
you need the toggle to respond.

## Languages

The application interface is **English or French**, and only those two. Choose
in the top bar; the choice is remembered on the device and never written into
your project file.

The *site* language is separate and independent: your content can be English,
French, or **both** (one real file per language, correct `<html lang>`, working
`hreflang`, no client-side toggle and no flash of the wrong language). Nothing
translates your content for you.

## What comes out

```
your-site.zip
├─ index.html, about.html, 404.html, privacy.html, legal.html
├─ css/style.css        one stylesheet, light and dark
├─ js/site.js           theme toggle + form, ~60 lines, no framework
├─ assets/…             your images
├─ favicon.svg, og.png  generated from your colours
├─ robots.txt, sitemap.xml
├─ _headers             CSP + HSTS, read by Netlify and Cloudflare Pages
└─ DEPLOY.txt           hosting notes, in the site's own language
```

Upload the folder as-is. The preview you saw and the ZIP come from the same
`build()` call, so they cannot drift apart.

## Security

- **Zero runtime dependencies.** There is no supply chain to audit for the
  generator, and no credential, no database and no server-side code anywhere in
  the project.
- **Escaping happens once**, in `src/js/safe.js`. `esc()` for text, `safeHref()`
  for URLs, rejecting by scheme rather than filtering characters — stripping
  characters is not validation, `javascript:alert(1)` is still executable
  without its parentheses.
- **Imported project files are normalised, not trusted**: every block is rebuilt
  from its specification, every number clamped, only base64 image data URIs
  accepted, and no asset name allowed to escape `assets/`.
- **Custom CSS is sanitised**: remote `@import` and `url()` are stripped, so an
  exported site never calls a third party. The quality report says how many
  rules it removed.
- **The desktop shell** serves the application from a WebView2 virtual host with
  cross-origin access denied, disables DevTools and host objects, and opens
  external links in your browser rather than in its own window.

None of this makes the application vulnerability-free. It means the obvious
mistakes are not present.

## Accessibility

Semantic landmarks, a skip link, visible focus rings, real keyboard control
everywhere, `prefers-reduced-motion` honoured, and a text-size control that
scales the whole interface. Every colour pair of every shipped palette is
verified against WCAG AA **at build time**, in light and dark; the muted tone
and the accent are derived rather than hand-picked, so changing a colour cannot
silently produce an unreadable theme.

## Project layout

```
murther_fabrique/
├─ assets/logo/              MURTHER FABRIQUE logo, icon and .ico (original artwork)
├─ 01-legacy-generator-ORIGINAL/
│  └─ index.html             the previous generator, unchanged, SHA-256 recorded
├─ 02-website-generator-NEXT/
│  ├─ src/                   the editor: index.html, app.css, js/*.js
│  ├─ test/                  6 suites, 241 checks
│  ├─ desktop/               the Win32 + WebView2 launcher and its build script
│  ├─ build.mjs              -> dist/generator.html (the one-file build)
│  ├─ server.mjs             read-only static server, Node stdlib only
│  └─ package.json           scripts only, zero dependencies
├─ LICENSE
└─ README.md
```

## Contributing

Keep the ladder in mind: does this need to exist, does it already exist, can the
standard library do it, can the platform do it. The generator has stayed at zero
dependencies for that reason, and a pull request that adds one has to argue
against it.

```bash
npm test        # fast, pure, no browser
npm run verify  # the full suite; keep it green
```

Changes to the editor's behaviour should come with a check in `test/`. The
suites talk to Chrome directly through the DevTools Protocol using Node's
built-in WebSocket client, so there is nothing to install to run them.

## Branding

The logo, the application icon and every image under `assets/logo/` are original
artwork created for this repository — no third-party brand, no stock image, no
traced asset. `assets/logo/make-logos.ps1` regenerates the PNGs and the Windows
`.ico` from the SVG; the SVG is the source of truth.

The legacy generator in `01-legacy-generator-ORIGINAL/` is preserved byte for
byte, including the old name inside it. It is the historical original, and
rewriting history inside an archived artefact would be the only thing less
useful than leaving it alone.

## Licence

[MIT](LICENSE). Replace the `<<COPYRIGHT HOLDER TO BE CONFIRMED>>` placeholder in
`LICENSE` with the owner of the project before publishing.