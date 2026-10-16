/**
 * Theme system: palettes, dark derivation, and the stylesheet emitter.
 *
 * The generator and the generated site share ONE token vocabulary. The editor
 * does not re-declare these values: it shows them, the emitter turns them into
 * CSS custom properties, and the audit checks the real rendered pairs.
 */
import { contrast, mix, readableInk } from "./safe.js";
import { BLOCKS } from "./blocks.js";

/**
 * Five complete sets. `ink` and `accent` are chosen to clear 4.5:1 on `bg`.
 * `alt` is deliberately pale: it decorates (chips, pills) and is never used for
 * small text — the colour that goes ON it is computed, not chosen.
 *
 * `muted` is absent on purpose: it is derived, so it cannot be authored into a
 * failing state. See `legible`.
 */
export const PALETTES = {
  ink: { bg: "#f4f6fb", surface: "#ffffff", ink: "#141a2e", accent: "#1d4ed8", alt: "#f59e0b", border: "#d7dce8" },
  forest: { bg: "#f1f8f5", surface: "#ffffff", ink: "#0f2a26", accent: "#0f766e", alt: "#a7f3d0", border: "#cfe2dc" },
  plum: { bg: "#f7f5fc", surface: "#ffffff", ink: "#231a3b", accent: "#6d28d9", alt: "#f0abfc", border: "#ddd6ee" },
  clay: { bg: "#fff8f1", surface: "#ffffff", ink: "#2a211b", accent: "#9a3412", alt: "#fbbf24", border: "#e9dacb" },
  slate: { bg: "#0b1120", surface: "#141c2e", ink: "#f1f5f9", accent: "#60a5fa", alt: "#34d399", border: "#253148" }
};

export const TONES = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Iowan Old Style, Charter, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
};

export const SCALES = { compact: 0.94, normal: 1, large: 1.1, huge: 1.22 };
export const CHIP_MIX = 0.2;

/**
 * The most washed-out version of `fg` that still reaches 4.5:1 on EVERY
 * background it lands on. Secondary text appears on the page and inside cards,
 * so it is checked against both — checking only the page background is how a
 * "compliant" palette ends up shipping unreadable card text.
 */
function legible(fg, ...bgs) {
  const ok = (c) => bgs.every((bg) => contrast(c, bg) >= 4.5);
  let best = fg;
  if (!ok(best)) return best; // authored colour already fails: the audit reports it
  const base = bgs[0];
  for (let k = 0.3; k <= 0.85 + 1e-9; k += 0.05) {
    const c = mix(fg, base, k);
    if (ok(c)) best = c;
    else break; // contrast decreases monotonically with k: first failure ends it
  }
  return best;
}

/**
 * The same guarantee in the other direction: the palest version of `fg` that
 * still reaches 4.5:1 on every background, moving toward WHITE.
 *
 * `legible()` walks toward the page to keep secondary text quiet. This one is
 * for the dark palette's accent, which has to get brighter — and it has to get
 * bright enough on `surface`, not just on `bg`, because the navigation and the
 * header sit on the surface colour. Checking only `bg` is how a dark theme
 * shipped an active nav link at 3.85:1 while the audit reported everything
 * green.
 */
function liftUntil(fg, ...bgs) {
  const ok = (c) => bgs.every((bg) => contrast(c, bg) >= 4.5);
  if (ok(fg)) return fg;
  // Contrast rises monotonically as we approach white, so the first step that
  // passes is the smallest lift that clears — one step better than a constant.
  for (let k = 0.05; k <= 1 + 1e-9; k += 0.05) {
    const c = mix(fg, "#ffffff", k);
    if (ok(c)) return c;
  }
  return "#ffffff"; // nothing lifted enough; white is the best available
}

/** Background of the decorative chips/pills. */
export const chipOf = (t) => mix(t.alt, t.bg, CHIP_MIX);

/** Add the two colours nothing authors directly: both are computed. */
const finish = (t) => ({
  ...t,
  muted: legible(t.ink, t.bg, t.surface),
  accentOn: readableInk(t.accent),
  altOn: readableInk(chipOf(t))
});

/**
 * Derive a dark set from a light one. Brighter accent, near-black background,
 * ink lifted towards white. The result is finished exactly like resolve()
 * returns it, because those three tokens are computed and cannot be carried
 * over from a light palette — emitting them raw wrote the literal text
 * `undefined` into the stylesheet, and `--accent-on` is what puts button text
 * on the accent colour.
 *
 * `mix(a, b, p)` moves `a` toward `b`, so every "lifted towards white" is
 * `mix(colour, "#ffffff", amount)`. Written the other way round it produces
 * dark ink on a dark background, which is what the contrast audit caught.
 */
export function darken(p) {
  // A background is already dark when it contrasts MORE with white than with
  // black. Tested the other way round, every light palette is declared dark and
  // returned unchanged: the `[data-theme="dark"]` block then re-declared the
  // light colours and the theme toggle changed nothing at all.
if (contrast(p.bg, "#ffffff") > contrast(p.bg, "#000000")) return { ...p };
  const bg = mix("#05070d", p.bg, 0.12);
  const ink = mix(p.ink, "#ffffff", 0.92);
  const surface = mix(p.surface, bg, 0.88);
  return finish({
    bg,
    // A touch lighter than the page, derived from it rather than from the light
    // surface: mixing the light surface toward black gave a mid-grey card on a
    // near-black page, and the old formula produced a near-white border line.
    surface,
    ink,
    // 0.45, not the 0.34 this started at: plum and clay landed at 4.42 and 4.47
    // against the near-black background, just under the 4.5 the audit enforces.
    // liftUntil then keeps going while the accent is still short on `surface`.
    accent: liftUntil(mix(p.accent, "#ffffff", 0.45), bg, surface),
    alt: mix(p.alt, "#ffffff", 0.3),
    border: mix(ink, bg, 0.84)
  });
}

const css = (t) => `  --${t}: `;

/** The real pairs the audit checks — not the ones that merely look plausible. */
export function contrastChecks(theme) {
  const light = resolve(theme);
  const dark = finish(darken(light));
  // [key, foreground, background, technical label, what a person would call it].
  // The last field is what the Design panel shows: "dark.accent/dark.surface"
  // means nothing to someone picking their first colour pair.
  const pairs = [
    ["ink", light.ink, light.bg, "light.ink/light.bg", "Body text on the page"],
    ["accent", light.accent, light.bg, "light.accent/light.bg", "Links and buttons on the page"],
    ["accentOn", light.accentOn, light.accent, "light.accentOn/light.accent", "Text on a button"],
    ["muted", light.muted, light.bg, "light.muted/light.bg", "Secondary text on the page"],
    ["surface", light.ink, light.surface, "light.ink/light.surface", "Body text in a card"],
    // The header and the navigation sit on `surface`, so the accent is checked
    // there too. An accent that clears the page but not the surface is how the
    // active nav link shipped at 3.85:1 in dark mode with a green audit.
    ["accentOnSurface", light.accent, light.surface, "light.accent/light.surface", "Links in the header"],
    ["border", light.muted, light.surface, "light.muted/light.surface", "Card borders and captions"],
    ["chip", light.altOn, chipOf(light), "light.inkOnChip", "Text on a coloured chip"],
    ["darkInk", dark.ink, dark.bg, "dark.ink/dark.bg", "Body text, dark mode"],
    ["darkAccent", dark.accent, dark.bg, "dark.accent/dark.bg", "Links and buttons, dark mode"],
    ["darkAccentOn", dark.accentOn, dark.accent, "dark.accentOn/dark.accent", "Text on a button, dark mode"],
    ["darkMuted", dark.muted, dark.bg, "dark.muted/dark.bg", "Secondary text, dark mode"],
    ["darkSurface", dark.ink, dark.surface, "dark.ink/dark.surface", "Body text in a card, dark mode"],
    ["darkAccentOnSurface", dark.accent, dark.surface, "dark.accent/dark.surface", "Links in the header, dark mode"],
    ["darkChip", dark.altOn, chipOf(dark), "dark.inkOnChip", "Text on a chip, dark mode"]
  ];
  return pairs.map(([key, fg, bg, label, what]) => ({
    key,
    label,
    what,
    fg,
    bg,
    ratio: contrast(fg, bg),
    ok: contrast(fg, bg) >= 4.5
  }));
}

/** Merge theme over the chosen palette, then derive. Unknown palette -> ink. */
export function resolve(theme) {
  const base = PALETTES[theme?.palette] || PALETTES.ink;
  const c = theme?.colors || {};
  const out = { ...base };
  for (const k of ["bg", "surface", "ink", "accent", "alt", "border"]) {
    if (typeof c[k] === "string" && /^#[0-9a-f]{6}$/i.test(c[k])) out[k] = c[k];
  }
  if (typeof c.border !== "string") out.border = mix(out.ink, out.bg, 0.84);
  return finish(out);
}

/** True when the theme's colours match a palette exactly. */
export function paletteOf(theme) {
  const c = resolve(theme);
  const hit = Object.keys(PALETTES).find((k) =>
    ["bg", "surface", "ink", "accent", "alt"].every((f) => PALETTES[k][f] === c[f])
  );
  return hit || "custom";
}

/**
 * Remote CSS is a third-party request, and the audit promises there is none.
 * Strip `@import` and any `url()` pointing at an absolute remote location.
 * Returns { css, removed } so the UI can report exactly what was cut.
 */
export function sanitizeCss(input) {
  let removed = 0;
  let out = String(input || "");
  out = out.replace(/@import[^;]*;?/gi, () => (removed++, ""));
  out = out.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (whole, q, url) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//") || url.includes("://")) {
      removed++;
      return "none";
    }
    return whole;
  });
  return { css: out.trim(), removed };
}

/**
 * The token block. Geometry is emitted as literals, not `var()`, so the custom
 * CSS a user appends can rely on the values being plain numbers.
 */
const vars = (t, g) =>
  `${css("bg")}${t.bg};\n${css("surface")}${t.surface};\n${css("ink")}${t.ink};\n` +
  `${css("muted")}${t.muted};\n${css("accent")}${t.accent};\n${css("accent-on")}${t.accentOn};\n` +
  // The same two colours as literals, under names a rule may swap. An
  // accent-filled section reassigns --accent and --accent-on so every link,
  // icon, bar and bullet inside it flips at once. They have to be literal
  // copies: a snapshot written as var(--accent) is not a snapshot. Custom
  // properties are substituted where they are used, not where they are
  // declared, so --accent: var(--mf-accent-on) would resolve back to --accent
  // and the browser would drop the whole declaration as a cycle.
  `${css("mf-accent")}${t.accent};\n${css("mf-accent-on")}${t.accentOn};\n` +
  `${css("alt")}${t.alt};\n${css("alt-on")}${t.altOn};\n${css("border")}${t.border};\n` +
  `${css("radius")}${g.radius}px;\n` +
  `${css("font")}${TONES[g.tone] || TONES.sans};\n${css("step--1")}calc(var(--step-0) * 0.84);\n` +
  `${css("step-0")}clamp(1rem, 0.95rem + 0.25vw, ${(1.02 * g.scale).toFixed(3)}rem);\n` +
  `${css("step-1")}clamp(1.25rem, 1.15rem + 0.5vw, ${(1.42 * g.scale).toFixed(3)}rem);\n` +
  `${css("step-2")}clamp(1.6rem, 1.4rem + 1vw, ${(2.05 * g.scale).toFixed(3)}rem);\n` +
  `${css("step-3")}clamp(2rem, 1.6rem + 2vw, ${(3.1 * g.scale).toFixed(3)}rem);\n` +
  `${css("wrap")}min(100% - 2.5rem, ${g.wrap}rem);\n`;

/**
 * Emit the whole stylesheet of the generated site.
 * Layout primitives are shared by every block, which is why adding a block does
 * not add CSS: it only uses the classes below.
 */
/* ---------------------------------------------------------------- sections */

/**
 * Section wrappers.
 *
 * `.fx-*` is the one place a "look" lives, so a new effect is one class here
 * and one enum value in the block spec -- not a new branch in every render.
 * Every variant is built from tokens, never from a literal colour, so all of
 * them follow the theme and both colour schemes without being written twice.
 */
const EFFECT_CSS = `
.fx > .wrap{position:relative}
.fx-card > .wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:clamp(1.25rem,3vw,2rem)}
.fx-outline > .wrap{border:1px solid var(--border);border-radius:var(--radius);padding:clamp(1.25rem,3vw,2rem)}
.fx-soft > .wrap{background:var(--surface);border-radius:var(--radius);padding:clamp(1.25rem,3vw,2rem)}
/*
 * An accent fill inverts itself, in two layers.
 *
 * Everything drawn inside a section uses --ink, --muted, --border or --accent,
 * and panels are filled with --surface. Flipping only the accent pair left page
 * ink on the fill: present in the DOM, invisible on screen.
 *
 * Two layers, because an accent fill offers exactly two colours. The section
 * ground is the accent and its text is the accent-on. A panel sitting on that
 * ground then needs the OTHER ground - accent-on - and accent text inside it,
 * which is the pair the quality report already measures. Making the panel the
 * same colour as the section would read as nothing at all.
 */
.fx-accent{--accent:var(--mf-accent-on);--accent-on:var(--mf-accent);
 --ink:var(--mf-accent-on);--muted:var(--mf-accent-on);--border:var(--mf-accent-on);
 --surface:var(--mf-accent-on);--bg:var(--mf-accent-on);
 background:var(--mf-accent);color:var(--mf-accent-on)}
.fx-accent .card,.fx-accent .quote,.fx-accent .thread,.fx-accent .cta,
.fx-accent pre,.fx-accent code,.fx-accent th,
.fx-accent blockquote,.fx-accent .tag,.fx-accent .price{
 --ink:var(--mf-accent);--muted:var(--mf-accent);--accent:var(--mf-accent);
 --accent-on:var(--mf-accent-on);color:var(--mf-accent)}
.fx-accent > .wrap{background:var(--mf-accent);color:var(--mf-accent-on);border-radius:var(--radius);padding:clamp(1.5rem,3vw,2.5rem)}
/* Only the lead paragraph. This used to name the small element here as well,
   and a descendant selector has no idea it is inside a card: every <small> in a
   panel got the section's text colour painted on the panel's own ground,
   measured at 1.00:1. Small needs no rule here at all - the section already
   repoints --muted, and a panel repoints it back. */
.fx-accent .lede{color:var(--mf-accent-on);opacity:.85}
/* Three components paint the accent as a FILL rather than as text. At section
   level --accent has been swapped to the text colour, so the fill would land on
   its own ground: the skill bar's track and its fill came out identical and the
   timeline dot vanished. They take the unflipped accent, which is readable
   both on the section and inside a panel. */
.fx-accent .skills__bar i,.fx-accent .time__item::before{background:var(--mf-accent)}
.fx-accent .steps li::before{background:var(--mf-accent);color:var(--mf-accent-on)}
.fx-gradient > .wrap{background:linear-gradient(160deg,var(--surface),var(--bg));border:1px solid var(--border);border-radius:var(--radius);padding:clamp(1.25rem,3vw,2rem)}
.fx-shadow > .wrap{background:var(--surface);border-radius:var(--radius);padding:clamp(1.25rem,3vw,2rem);box-shadow:0 18px 50px -24px rgb(0 0 0 / .55)}
.fx-inset > .wrap{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:clamp(1.25rem,3vw,2rem)}
.section--alt{background:var(--surface)}
.section--flush{padding-block:0}`;

/* ----------------------------------------------------------------- motion */

/**
 * Motion.
 *
 * Three settings, and the default is none. Everything is CSS animation on load
 * rather than an IntersectionObserver: the exported site keeps its "one small
 * script" promise, and a page that animates before its images land still reads
 * as a page. The prefers-reduced-motion rule at the end of
 * the stylesheet turns all of it off for anyone who asked the system to.
 *
 * The rules hang off selectors the renderer already emits rather than off
 * utility classes nobody writes. A motion setting that needs markup edits to
 * take effect is a motion setting that silently does nothing on the thirteen
 * blocks that were written before it existed.
 */
function MOTION_CSS(motion) {
  if (motion === "none") return "";
  const dur = motion === "expressive" ? ".62s" : ".42s";
  const rise = motion === "expressive" ? "1.4rem" : ".7rem";
  const stagger = motion === "expressive";
  return `
${stagger ? "" : `.hero > .wrap > *{animation:mf-rise ${dur} cubic-bezier(.2,.7,.3,1) both}
.hero > .wrap > :nth-child(2){animation-delay:.05s}
.hero > .wrap > :nth-child(3){animation-delay:.1s}`}
.grid > *,.steps > *,.time > *,.logos > *{animation:mf-rise ${dur} cubic-bezier(.2,.7,.3,1) both}
.section > .wrap > .prose,.section > .wrap > p.lede{animation:mf-fade ${dur} ease both}
.card,.quote,.feature{transition:transform .2s cubic-bezier(.2,.7,.3,1),box-shadow .2s cubic-bezier(.2,.7,.3,1)}
.card:hover,.quote:hover{transform:translateY(-3px)}
@keyframes mf-rise{from{opacity:0;transform:translateY(${rise})}to{opacity:1;transform:none}}
@keyframes mf-fade{from{opacity:0}to{opacity:1}}
${stagger ? `.grid > *:nth-child(1),.steps > *:nth-child(1),.time > *:nth-child(1),.logos > *:nth-child(1){animation-delay:.04s}
.grid > *:nth-child(2),.steps > *:nth-child(2),.time > *:nth-child(2),.logos > *:nth-child(2){animation-delay:.11s}
.grid > *:nth-child(3),.steps > *:nth-child(3),.time > *:nth-child(3),.logos > *:nth-child(3){animation-delay:.18s}
.grid > *:nth-child(4),.steps > *:nth-child(4),.time > *:nth-child(4),.logos > *:nth-child(4){animation-delay:.25s}
.grid > *:nth-child(5),.steps > *:nth-child(5),.time > *:nth-child(5),.logos > *:nth-child(5){animation-delay:.32s}
.hero > .wrap > *{animation:mf-rise ${dur} cubic-bezier(.2,.7,.3,1) both}
.hero > .wrap > :nth-child(2){animation-delay:.07s}
.hero > .wrap > :nth-child(3){animation-delay:.14s}
.hero__media{animation:mf-float 7s ease-in-out infinite alternate}
@keyframes mf-float{from{transform:translateY(-6px)}to{transform:translateY(6px)}}` : ""}`;
}

/* -------------------------------------------------------------- components */

const COMPONENT_CSS = `
.ico{width:1.6em;height:1.6em;flex:none;color:var(--accent)}
.feature{display:grid;gap:.4rem;align-content:start}
.feature .ico{width:2.1rem;height:2.1rem;margin-bottom:.3rem}
.feature p{color:var(--muted);margin:0}

.quote{display:grid;gap:.9rem;background:var(--surface);border:1px solid var(--border);
 border-radius:var(--radius);padding:clamp(1.1rem,2.5vw,1.6rem)}
.quote p{font-size:var(--step-1);text-wrap:pretty;margin:0}
.quote footer{display:flex;align-items:center;gap:.7rem;font-size:var(--step--1)}
.quote img{width:2.75rem;height:2.75rem;border-radius:999px;object-fit:cover;border:1px solid var(--border)}
.quote cite{font-style:normal;font-weight:650}
.quote small{display:block;font-weight:400}

.time{position:relative;margin:0;padding:0;list-style:none}
.time::before{content:"";position:absolute;inset-block:1rem;inset-inline-start:.45rem;width:2px;background:var(--border)}
.time__item{position:relative;padding-inline-start:2.1rem;padding-bottom:1.6rem}
.time__item:last-child{padding-bottom:0}
.time__item::before{content:"";position:absolute;inset-inline-start:0;top:.45rem;width:.95rem;height:.95rem;
 border-radius:999px;background:var(--accent);box-shadow:0 0 0 4px var(--bg)}
.time__when{font-size:var(--step--1);color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
.time h3{margin:.2rem 0 .1rem}
.time p{color:var(--muted);margin:0}
.time ul{margin:.4rem 0 0;padding-inline-start:1.1rem;color:var(--muted)}

.steps{counter-reset:mf-step;display:grid;gap:1.25rem;margin:0;padding:0;list-style:none}
.steps li{counter-increment:mf-step;position:relative;padding-inline-start:3.1rem}
.steps li::before{content:counter(mf-step);position:absolute;inset-inline-start:0;top:-.1rem;
 width:2.2rem;height:2.2rem;border-radius:999px;display:grid;place-items:center;
 background:var(--accent);color:var(--accent-on);font-weight:700;font-size:var(--step--1)}
.steps h3{margin:0 0 .2rem}
.steps p{margin:0;color:var(--muted)}

.skills{display:grid;gap:.7rem}
.skills div{display:grid;gap:.3rem}
.skills dt{font-weight:600;display:flex;justify-content:space-between;gap:1rem}
.skills dt span{font-weight:400;color:var(--muted);font-size:var(--step--1)}
.skills__bar{height:.45rem;border-radius:999px;background:var(--border);overflow:hidden}
.skills__bar i{display:block;height:100%;background:var(--accent);border-radius:999px}

.logos{display:flex;flex-wrap:wrap;gap:1.25rem 2.25rem;align-items:center;justify-content:center;list-style:none;padding:0;margin:0}
.logos img{height:2.1rem;width:auto;opacity:.75;filter:grayscale(1)}
.logos span{font-size:var(--step--1);color:var(--muted)}

.dropzone{border:1px dashed var(--border);border-radius:var(--radius);padding:.9rem;color:var(--muted);font-size:var(--step--1)}`;

export function siteCss(theme, opts = {}) {
  const g = {
    radius: theme.radius ?? 8,
    tone: theme.tone in TONES ? theme.tone : "sans",
    scale: SCALES[theme.scale] ?? 1,
    wrap: opts.wide ? 84 : 72
  };

  const light = resolve(theme);
  const dark = darken(light);
  const darkRule =
    theme.scheme === "light" ? "" : `@media (prefers-color-scheme: dark){\n:root:not([data-theme="light"]){\n${vars(dark, g)}}\n}\n`;

  // The light block MUST sit inside a :root rule. Bare declarations at the top
  // of a stylesheet are invalid and the browser drops them, so a light-mode
  // visitor got no custom properties at all: a transparent background, default
  // 16px headings, and unstyled text. It went unnoticed because darken() used
  // to hand back the light palette unchanged, so the media query happened to
  // supply a complete set of tokens that looked exactly right.
  return `/* Generated by MURTHER FABRIQUE. Editable: append your own rules after this block. */
:root{${vars(light, g)}}
[data-theme="dark"]{${vars(dark, g)}}
${darkRule}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:var(--step-0);line-height:1.65;
-webkit-text-size-adjust:100%;overflow-wrap:break-word}
img,svg,video{max-width:100%;height:auto;display:block}
:where(a){color:var(--accent)}
:where(a,button,summary,[tabindex]):focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:3px}
h1,h2,h3,h4{line-height:1.18;text-wrap:balance;margin:0 0 .5em;letter-spacing:-.015em}
h1{font-size:var(--step-3)}h2{font-size:var(--step-2)}h3{font-size:var(--step-1)}h4{font-size:var(--step-0)}
p,ul,ol{margin:0 0 1em}
small{font-size:var(--step--1);color:var(--muted)}
hr{border:0;border-top:1px solid var(--border);margin:2rem 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em;
background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:.1em .35em}
pre{overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem}
pre code{border:0;background:none;padding:0}
blockquote{margin:0 0 1em;padding:.25em 0 .25em 1rem;border-left:3px solid var(--alt);color:var(--muted)}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--border);padding:.55rem .7rem;text-align:left;vertical-align:top}
th{background:var(--surface)}

.wrap{width:var(--wrap);margin-inline:auto}
.skip{position:absolute;left:-9999px}
.skip:focus{left:1rem;top:1rem;z-index:9;background:var(--surface);padding:.6rem 1rem;border:2px solid var(--accent);border-radius:var(--radius)}
.site-head{border-bottom:1px solid var(--border);background:var(--surface)}
.site-head .wrap{display:flex;flex-wrap:wrap;gap:.6rem 1.25rem;align-items:center;padding-block:.9rem}
.brand{font-weight:700;letter-spacing:-.02em;color:var(--ink);text-decoration:none;margin-inline-end:auto}
.site-nav{display:flex;flex-wrap:wrap;gap:.25rem 1.1rem;align-items:center}
.site-nav a{color:var(--ink);text-decoration:none;padding:.35rem 0;border-bottom:2px solid transparent;min-height:24px;display:inline-flex;align-items:center}
.site-nav a:hover,.site-nav a[aria-current="page"]{color:var(--accent);border-bottom-color:var(--accent)}
.langpick{display:flex;gap:.3rem;align-items:center;margin-inline-start:.5rem}
.langpick a,.langpick button{font:inherit;font-size:var(--step--1);color:var(--muted);background:none;border:1px solid var(--border);
border-radius:999px;padding:.2rem .6rem;cursor:pointer;min-height:24px;text-decoration:none}
.langpick [aria-pressed="true"]{color:var(--accent-on);background:var(--accent);border-color:var(--accent)}
/* First in the header, inside the flow: an absolutely positioned toggle lands
   on top of the language picker, which is exactly where it sits on a bilingual
   site. */
.theme-toggle{font:inherit;font-size:var(--step--1);background:var(--surface);
color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:.2rem .6rem;cursor:pointer;min-height:24px}

.section{padding-block:clamp(2.2rem,1.6rem + 3vw,4.5rem)}
.section--tight{padding-block:clamp(1.4rem,1rem + 2vw,2.6rem)}
.section + .section{border-top:1px solid var(--border)}
.eyebrow{display:inline-block;font-size:var(--step--1);letter-spacing:.08em;text-transform:uppercase;
color:var(--alt-on);background:var(--alt);border-radius:999px;padding:.2rem .7rem;margin-bottom:.9rem}
.lede{font-size:var(--step-1);color:var(--muted);max-width:62ch;text-wrap:pretty}

.btn{display:inline-flex;align-items:center;gap:.5rem;background:var(--accent);color:var(--accent-on);
border:1px solid var(--accent);border-radius:var(--radius);padding:.65rem 1.15rem;text-decoration:none;
font:inherit;font-weight:600;cursor:pointer;min-height:44px}
.btn--ghost{background:transparent;color:var(--accent)}
.btn:hover{filter:brightness(1.08)}
.prose{max-width:68ch;text-wrap:pretty}
.prose > :last-child{margin-bottom:0}

.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem}
.card h3{margin-top:0}
/* margin/padding/list-style reset, like .time, .steps and .logos above.
   Without it the <ul> kept the browser's 40px indent and a visible bullet
   beside every card, which pushed the grid 40px right of its own heading.
   Note the comment markers: this text is emitted into the stylesheet, and
   "//" is not a CSS comment - it turns the whole rule into an invalid
   selector and silently drops the reset. */
.grid{display:grid;gap:1.25rem;margin:0;padding:0;list-style:none;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))}
.grid--2{grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr))}
.grid--3{grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))}
.grid--4{grid-template-columns:repeat(auto-fit,minmax(min(100%,12.5rem),1fr))}
.hero{display:grid;gap:clamp(1.5rem,4vw,3rem);align-items:center}
@media (min-width:56rem){.hero{grid-template-columns:1.05fr .95fr}}
/* The theme toggle is a sibling of .langpick, not a child, so it never picked
   up those pill styles -- it rendered as an unstyled native button, 33x31 with
   the platform font, in a header where everything else is a styled control.
   Its whole content is one glyph, so nothing tells a finger it is tappable. */
.theme-toggle{font:inherit;font-size:var(--step--1);line-height:1;color:var(--muted);background:none;
border:1px solid var(--border);border-radius:999px;min-width:44px;min-height:44px;cursor:pointer;
display:inline-flex;align-items:center;justify-content:center;padding:.4rem .5rem}
.theme-toggle:hover{color:var(--ink);border-color:var(--ink)}
.hero__title{font-size:var(--step-3);margin-bottom:.35em}
.hero__media img{border-radius:var(--radius);border:1px solid var(--border)}
.stats{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr))}
.stat b{display:block;font-size:var(--step-2);line-height:1.1}
.stat span{color:var(--muted);font-size:var(--step--1)}
.faq details{border-bottom:1px solid var(--border);padding:.85rem 0}
.faq summary{cursor:pointer;font-weight:600;min-height:24px;display:flex;align-items:center}
/* display:flex took summary off display:list-item, which killed the native
   disclosure triangle -- and ::marker, which only applies to list-item, never
   fired. The questions looked like plain text with a pointer cursor and nothing
   to click. The affordance has to be drawn explicitly now. */
.faq summary::after{content:"+";margin-left:auto;color:var(--accent);font-size:1.25rem;line-height:1;font-weight:400}
.faq details[open]>summary::after{content:"\\2212"}
.gallery{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))}
.gallery figure{margin:0}
.gallery img{border-radius:var(--radius);border:1px solid var(--border);aspect-ratio:4/3;object-fit:cover;width:100%}
.gallery figcaption{font-size:var(--step--1);color:var(--muted);margin-top:.4rem}
.pill{display:inline-block;font-size:var(--step--1);background:var(--alt);color:var(--alt-on);
border-radius:999px;padding:.15rem .6rem;margin:0 .35rem .35rem 0}
.tag{font-size:var(--step--1);color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:.1rem .5rem;margin-inline-end:.3rem}
.post{border-bottom:1px solid var(--border);padding-block:1rem}
.post time{font-size:var(--step--1);color:var(--muted)}
.price{font-size:var(--step-1);font-weight:700}
.price small{font-weight:400;color:var(--muted);display:block}
.thread{border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);padding:1rem 1.1rem}
.thread__meta{display:flex;gap:1rem;flex-wrap:wrap;font-size:var(--step--1);color:var(--muted);margin-bottom:.4rem}
.notfound{text-align:center;padding-block:6rem}
.cta{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:clamp(1.5rem,3vw,2.5rem);text-align:center}
.cta h2{margin-top:0}
${COMPONENT_CSS}
${EFFECT_CSS}
${MOTION_CSS(theme.motion)}
form.stack{display:grid;gap:.9rem;max-width:38rem}
/* Grid items stretch to the column by default, which stretched the submit
   button across all 38rem while every other .btn in the product sits at its
   content width. The fields stay full width; only the button is pinned. */
form.stack>.btn{justify-self:start}
form.stack label{display:grid;gap:.3rem;font-size:var(--step--1);font-weight:600}
input,textarea,select{font:inherit;font-size:var(--step-0);color:var(--ink);background:var(--bg);
border:1px solid var(--border);border-radius:var(--radius);padding:.55rem .7rem;width:100%;min-height:44px}
input[type="checkbox"]{width:auto;min-height:auto}
textarea{min-height:7rem;resize:vertical}
.site-foot{border-top:1px solid var(--border);margin-top:3rem;padding-block:2rem;color:var(--muted);font-size:var(--step--1)}
.site-foot .wrap{display:flex;flex-wrap:wrap;gap:.6rem 1.5rem;justify-content:space-between}
@media print{.site-head,.site-foot,.langpick,.theme-toggle{display:none}
 *{animation:none!important;transition:none!important}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
${sanitizeCss(theme.customCss).css}
`;
}