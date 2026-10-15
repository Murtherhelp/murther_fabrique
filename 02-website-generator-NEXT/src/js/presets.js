/**
 * Per-template design presets.
 *
 * A template is not just a different colour: it should feel like a different
 * kind of page. These carry the visual character — background, surface, ink,
 * accent, the decorative chip colour and the corner rounding — so the nine
 * starters are distinguishable at a glance rather than by a palette name.
 *
 * Kept apart from `templates.js` on purpose: this file is *design*, that one is
 * *content*. Neither imports the other, and neither touches build().
 *
 * `muted` is deliberately absent. The theme derives it from the ink so it cannot
 * be authored into a failing state — see `legible()` in themes.js. `alt` has no
 * natural derivation (a chip colour is a taste decision), so each preset names
 * one that belongs to its family.
 */
export const PRESETS = {
  /* A quiet, centred starting point. Generous radius, one green, no noise. */
  basic: {
    bg: "#f7f7f4", surface: "#ffffff", ink: "#17211b",
    accent: "#276749", alt: "#d6e9df", radius: 20
  },

  /* Editorial. Warm paper, a terracotta accent, serif voice, tight radius. */
  portfolio: {
    bg: "#f4f1eb", surface: "#ffffff", ink: "#201c19",
    accent: "#b24c32", alt: "#f0dcd3", radius: 12
  },

  /* A document you scan quickly: cool neutral, firm blue, low radius. */
  cv: {
    bg: "#f6f8fb", surface: "#ffffff", ink: "#182536",
    accent: "#3157a4", alt: "#d8e2f4", radius: 8
  },

  /* Trust. Deep teal, soft neutral, rounded enough to feel approachable. */
  business: {
    bg: "#f5f6f4", surface: "#ffffff", ink: "#19221f",
    accent: "#187a70", alt: "#d2ebe7", radius: 16
  },

  /* Long-form reading. Paper white, brown ink accent, small radius so the
     measure and not the furniture does the work. */
  blog: {
    bg: "#faf9f6", surface: "#ffffff", ink: "#22221f",
    accent: "#7b4a32", alt: "#eadfd6", radius: 6
  },

  /* A place, not a brochure. Cool blue, roomy, built for scanning. */
  community: {
    bg: "#f3f6fa", surface: "#ffffff", ink: "#1c2938",
    accent: "#4668d8", alt: "#dde4f7", radius: 12
  },

  /* Cinematic: near-black, a lime that only a game would dare, tight radius. */
  game: {
    bg: "#101116", surface: "#1a1b24", ink: "#f5f3f0",
    accent: "#b9f349", alt: "#c8f56b", radius: 4
  },

  /* Product first. Warm off-white, rust accent, marketplace radius. */
  store: {
    bg: "#fbf9f5", surface: "#ffffff", ink: "#25231f",
    accent: "#a9472f", alt: "#f2ddd4", radius: 12
  },

  /* Software. Cool white, confident violet, the softest radius of the nine. */
  saas: {
    bg: "#f7f8fc", surface: "#ffffff", ink: "#171c2f",
    accent: "#6257e8", alt: "#e2dffa", radius: 18
  }
};

/** Preset -> the theme shape store.js and themes.js already speak. */
export function themeOf(key, extra = {}) {
  const p = PRESETS[key];
  if (!p) throw new Error(`no preset called "${key}"`);
  return {
    palette: "custom",
    colors: { bg: p.bg, surface: p.surface, ink: p.ink, accent: p.accent, alt: p.alt },
    radius: p.radius,
    tone: "sans",
    scale: "normal",
    scheme: "auto",
    customCss: "",
    ...extra
  };
}

/**
 * Which preset each template uses. Spelled out rather than inferred: two of
 * the nine do not go by the same word on both sides — the template is called
 * "Blank page" but its preset is "basic", and the forum template borrows the
 * "community" preset. Deriving one name from the other was how the two
 * `slate` templates drifted into being the same page.
 */
export const PRESET_FOR = {
  blank: "basic",
  portfolio: "portfolio",
  cv: "cv",
  business: "business",
  blog: "blog",
  forum: "community",
  game: "game",
  store: "store",
  saas: "saas"
};