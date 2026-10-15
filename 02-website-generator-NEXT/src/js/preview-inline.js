/**
 * The preview's inline script, in its own module.
 *
 * A `srcdoc` document inherits the embedding page's Content-Security-Policy,
 * and the editor serves itself under `script-src 'self'` with no
 * `unsafe-inline`. So this script was silently blocked: the preview filled the
 * console with a CSP error on every keystroke, and without it a clicked link
 * navigated the frame away from the generated page.
 *
 * Hashing it is the fix that keeps the policy strict. `server.mjs` computes the
 * digest from this export at start-up, so editing the script here needs no
 * matching edit anywhere else -- there is nothing to forget, and no second copy
 * of the text to drift.
 *
 * `PREVIEW_SITE_JS` is exported from build.js rather than copied here: the
 * preview runs the generated site's real script, and a second copy of it would
 * be a second thing that could disagree with the export.
 */

/* eslint-disable */
export const PREVIEW_GUARD = `(function(){
  // The preview is a DOCUMENT, not a browser. It used to let any link carrying a
  // scheme through untouched, so clicking a CTA or a contact entry navigated the
  // frame away from the generated page — and on a dev machine a link to
  // localhost:5173 loaded the generator itself, which then rendered inside its
  // own preview. Nothing ever put the preview back.
  //
  // So: internal links are reported to the editor, which swaps the rendered
  // page; mailto:/tel: still hand off to the OS; everything else is dropped.
  // The href is matched against the known file list on the parent side, so this
  // channel cannot be used to load anything.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a");
    if (!a) return;
    var h = a.getAttribute("href") || "";
    if (h.charAt(0) === "#") return;                       // in-page jump, stays put
    if (/^(mailto:|tel:)/i.test(h)) return;                 // handed to the OS
    e.preventDefault();
    if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.slice(0, 2) === "//") return;
    try { parent.postMessage({ type: "wgn:nav", href: h.split("#")[0] }, "*"); } catch (err) {}
  }, true);

  // Same reason: a real form needs a server, and submitting here would replace
  // the preview exactly as badly as a link would.
  document.addEventListener("submit", function (e) { e.preventDefault(); }, true);
})();`;