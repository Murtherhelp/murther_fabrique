<!-- Plain Markdown image syntax, not <img>. GitHub rewrites relative URLs in
     raw HTML through its own sanitiser; the Markdown form is resolved by the
     renderer directly and is the one that has never failed to display. -->
[![MURTHER FABRIQUE](assets/logo/logo-720.png)](assets/logo/mark.svg)

**Two website generators. One desktop application. No accounts, no servers, no tracking.**

---

MURTHER FABRIQUE builds real, static websites: plain HTML, one stylesheet, one
small script, nothing to compile and nothing to install. Everything here runs on
**Windows**, offline, on the machine it is on.

| | What it is | Who it is for |
|---|---|---|
| [**02-website-generator-NEXT**](02-website-generator-NEXT/) | The current generator. A visual editor, nine starter templates, eighteen section types, a quality report, and a ZIP of finished static files. | Anyone shipping a small business site, portfolio, CV, brochure or landing page — with or without coding experience. |
| [**01-legacy-generator-ORIGINAL**](01-legacy-generator-ORIGINAL/) | The first generator, kept whole. One 156 KB HTML file, opened by double-click. Its logic is untouched; its interface now wears the same brand. | Reference and history. Still runs, still generates sites. |

---

## Quick start

Nothing to install for the generator itself — `package.json` has **no
dependencies on purpose**. Node 18 or newer is the only requirement.

```bash
git clone https://github.com/Murtherhelp/murther_fabrique.git
cd "murther_fabrique/02-website-generator-NEXT"

npm start          # editor at http://localhost:5173/
npm test           # 109 core checks, no browser needed
npm run verify     # 401 checks across 8 suites, browsers included
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
# -> MutherFabrique.exe, at the root of the repository   (655 KB)
```

`MurtherFabrique.exe` is **one self-contained file**. Double-click it and a
chooser asks which generator to open — **NEXT**, the current one, or
**ORIGINAL**, the archived first version. Both are compiled into the executable,
so the choice costs no download and no install. There is no installer, no
sidecar DLL, and nothing is fetched after launch.

```
MurtherFabrique.exe --original    # skip the chooser, open ORIGINAL
MurtherFabrique.exe --selftest    # check both, then exit
```

It is a native Win32 window hosting the Microsoft Edge **WebView2** runtime —
the component Windows 10 21H2 and Windows 11 already ship, which is why the file
is half a megabyte instead of the 150 MB an Electron wrapper would cost. The
applications are unpacked to your profile on first run and served from a real
`https://murther-fabrique.local/` origin, so projects autosave and survive a
restart.

**Requirements to build it:** the MSVC build tools with the *Desktop development
with C++* workload and the Windows SDK. The build downloads one pinned NuGet
package (the WebView2 SDK) into `desktop/.cache/` and never a second time.
**Requirements to run it:** Windows. Nothing else.

`--selftest` boots both generators in turn and checks each one is really
rendered — correct origin, working storage, a real viewport, and for NEXT that
it builds a site and passes its own self-check. It exits `0` only when both are
healthy; a transcript lands in `%LOCALAPPDATA%\MurtherFabrique\selftest.txt`.

### What "offline" means here, exactly

The application **never opens a network connection**. There is no telemetry, no
update check, no CDN, no web font and no remote asset. You can pull the network
cable out after the first launch and nothing changes.

What it does depend on is the **Microsoft Edge WebView2 Runtime**, because that
is what draws the window. This is an operating-system component:

| Windows | WebView2 present? |
|---|---|
| Windows 11 | yes, always |
| Windows 10 21H2 and later | yes, with any current Edge |
| Windows 10 LTSC, Server, stripped images | **not always** |

It is **not bundled**. Bundling it would add roughly 130 MB and turn a
half-megabyte file into a distribution problem. If the runtime is missing, the
launcher says so and **opens the generator in your default browser instead** —
same application, same files, a browser tab instead of a native window. Nothing
is installed and nothing is downloaded at that point either.

### Where your projects are stored

Not next to the `.exe`. The executable is fully portable — copy it to a USB
stick and it runs — so its user data goes to the Windows profile:

```
%LOCALAPPDATA%\MurtherFabrique\
├─ app\generator-<hash>.html     NEXT, unpacked from the executable
├─ original\generator-<hash>.html ORIGINAL, unpacked from the executable
├─ webview2\                      browser profile, including your projects
└─ selftest.txt                   last self-test report
```

Projects and interface preferences live in the `webview2\` profile under
`localStorage`. **Moving or deleting the `.exe` does not move or delete your
projects** — the two are independent. Use *Export → Download project* for a file
you control; that `.json` reopens in either generator.

## What was verified, and what was not

Being precise about this, because "audited" and "looked at carefully" are not
the same word.

**Verified by running it.** 401 automated checks across eight suites
(`npm run verify`, exit 0), plus the packaged application's own self-test
exercising both generators inside the built `.exe`.

**Verified by reading the code.** Escaping and URL handling, project-import
normalisation, asset path sanitisation, custom-CSS sanitisation, the ZIP writer,
the file server's path handling, the desktop shell's boundary and resource
handling, dependencies (there are none), and a search for committed secrets
(none found).

**Not done.** No third-party penetration test, no fuzzing, no supply-chain
audit, and no run on a physically clean machine — this was built on one Windows
11 box. Two concrete defects were found and fixed during review (invalid JSON-LD
on every exported page, and a dev server that crashed on a malformed URL); both
have regression tests. That is a careful self-review with tests, not a security
audit, and it does not make the application vulnerability-free.

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
- **Exporting never blocks, but it never hides either.** The files are yours,
  so a failing palette does not hold them hostage — yet the export says how
  many colour pairs are below 4.5:1 as it happens, instead of leaving the red
  rows sitting in another panel.
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
├─ MutherFabrique.exe         built by desktop\build.ps1 — opens either generator
├─ assets/logo/              MURTHER FABRIQUE logo, icon and .ico (original artwork)
├─ 01-legacy-generator-ORIGINAL/
│  └─ index.html             the archived first generator, now wearing the brand
├─ 02-website-generator-NEXT/
│  ├─ src/                   the editor: index.html, app.css, js/*.js
│  ├─ test/                  8 suites, 401 checks
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