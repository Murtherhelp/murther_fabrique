/**
 * Icons.
 *
 * A small set of original 24x24 line glyphs, inlined rather than loaded.
 *
 * An icon font or an icon CDN would be one more request to a third party, which
 * is the one thing this generator promises never to make. Drawing them here
 * costs a few hundred bytes and a dependency-free guarantee.
 *
 * Its own module, not part of themes.js: themes.js already imports the block
 * registry for the quality report, so blocks.js importing icons from there
 * would close a cycle and leave `ICON_KEYS` uninitialised at import time.
 */

export const ICONS = {
  none: "",
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  shield: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/>',
  heart: '<path d="M12 20S3 14.5 3 9a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c0 5.5-9 11-9 11Z"/>',
  star: '<path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8L12 3Z"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 20v-6m5 6V9m5 11v-9"/>',
  code: '<path d="m9 8-5 4 5 4m6-8 5 4-5 4"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.7 0 2-1 1.2-1.8-.9-.9.1-2.2 1.3-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10Z"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15 0 18M12 3c-2.5 2.6-2.5 15 0 18"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  rocket: '<path d="M12 2c3.5 2.5 5 6 5 10l-3 3h-4l-3-3c0-4 1.5-7.5 5-10Z"/><circle cx="12" cy="9" r="1.5"/><path d="M9 18c-2 1-3 3-3 5 2-2 4-3 6-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/><path d="M17 9a3 3 0 0 0 0-6m2 17c0-2.4-1-4.2-2.6-5.2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  pin: '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  leaf: '<path d="M4 20C3 12 8 4 20 4c0 12-8 16-16 16Z"/><path d="M4 20 14 10"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  sparkle: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m18.5 16 .9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z"/>'
};

export const ICON_KEYS = Object.keys(ICONS);

/** Icon names as an enum option list, English = French. */
export const ICON_OPTIONS = ICON_KEYS.map((k) => [k, [k, k]]);

/** The inline markup for one icon. Returns "" for "none" or an unknown key. */
export function icon(name) {
  const body = ICONS[String(name || "none")] ?? ICONS.none;
  if (!body) return "";
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}