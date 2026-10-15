/**
 * Block registry — the extensible component library.
 *
 * A block is a plain object: a field SPEC (which drives the inspector form
 * automatically) plus a render function. The generator core knows nothing
 * about any specific block, so adding one means adding one entry to `BLOCKS`
 * and nothing else. The inspector, the outline, the preview and the exporter
 * all pick it up for free.
 *
 * Field spec
 *   k      field name
 *   t      text | long | md | url | img | enum | list | bool | date
 *   lbl    [enLabel, frLabel]  — generator interface label
 *   i18n   true  => stored as {en, fr} and shown per site-language
 *   options [[value, [enLabel, frLabel]]]  for enum
 *   of     [subfield spec]                 for list
 *   hint   [enHint, frHint]                optional
 *
 * i18n is opt-in per field. A French-only generator must not force every
 * template to carry an unused English string, so templates ship the fields they
 * need and `tpl()` back-fills the other language when a user turns bilingual on.
 */
import { esc, md, safeHref, uid } from "./safe.js";
import { st } from "./site-strings.js";
import { icon, ICON_OPTIONS } from "./icons.js";

/** Build a bilingual value. Every template seeds both at once. */
export const bi = (en, fr = en) => ({ en: String(en ?? ""), fr: String(fr ?? "") });

/* ----------------------------------------------------------------- shared */

/**
 * The one "look" field, and the one "look" wrapper.
 *
 * A section is emitted through `sec()` so an effect is a class on the section
 * rather than a conditional branch inside thirteen render functions. Adding a
 * look means one entry here, one enum value here, one rule in the stylesheet --
 * and no render function is touched.
 */
export const EFFECTS = [
  ["none", "None", "Aucun"],
  ["soft", "Soft panel", "Panneau doux"],
  ["card", "Card", "Carte"],
  ["outline", "Outline", "Contour"],
  ["inset", "Inset", "Enfoncé"],
  ["gradient", "Gradient", "Dégradé"],
  ["shadow", "Shadow", "Ombre"],
  ["accent", "Accent fill", "Fond accent"]
];

export const effectField = () => ({
  k: "effect", t: "enum", lbl: ["Look", "Apparence"],
  options: EFFECTS, hint: [
    "How this section sits on the page. Purely visual — it changes nothing a visitor reads.",
    "Comment cette section s'insère dans la page. Purement visuel — cela ne change rien au contenu."
  ]
});

/**
 * A section wrapper. `b.effect` is optional, so a block without the field still
 * renders, and an unknown value falls back to no class rather than emitting a
 * class that means nothing.
 */
export const sec = (b, inner, extra = "") => {
  const fx = EFFECTS.some(([v]) => v === b?.effect) && b.effect !== "none" ? ` fx-${esc(b.effect)}` : "";
  const cls = `section${fx}${extra ? ` ${extra}` : ""}`;
  return `<section class="${cls}"><div class="wrap">${inner}</div></section>`;
};

/** Resolve a {en,fr} field for the target language, falling back to the other. */
export const T = (v, lang) =>
  v == null ? "" : typeof v === "string" ? v : v[lang] || v.en || v.fr || "";

/** True when a bilingual field has no usable value in that language. */
export const missing = (v, lang) =>
  v == null || typeof v === "string" ? !String(v || "").trim() : !String(v[lang] || v.en || "").trim();

const list = (items, fn, cls) =>
  items?.length ? `<ul class="${cls}">${items.map(fn).join("")}</ul>` : "";

/* ------------------------------------------------------------------ */

export const BLOCKS = {
  hero: {
    label: ["Hero", "Bannière"],
    hint: ["Big opening block: title, text, image and one button.", "Grand bloc d'ouverture : titre, texte, image et un bouton."],
    defaults: () => ({
      eyebrow: bi("", ""), title: bi("A title worth reading", "Un titre qui mérite d'être lu"),
      lead: bi("One paragraph that says what this is and who it is for.", "Un paragraphe qui explique ce que c'est et pour qui."),
      image: { assetId: "", alt: bi("", "") },
      ctaLabel: bi("Get in touch", "Nous contacter"), ctaHref: "index.html"
    }),
    fields: [
      { k: "eyebrow", t: "text", lbl: ["Eyebrow (small line above the title)", "Sur-titre (petite ligne au-dessus du titre)"], i18n: true },
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "lead", t: "md", lbl: ["Text", "Texte"], i18n: true },
      { k: "image", t: "img", lbl: ["Image", "Image"] },
      { k: "ctaLabel", t: "text", lbl: ["Button label", "Libellé du bouton"], i18n: true },
      { k: "ctaHref", t: "url", lbl: ["Button destination", "Destination du bouton"] }
    ],
    render(b, c) {
      const img = c.img(b.image);
      return `<section class="section"><div class="wrap hero">
  <div>
    ${T(b.eyebrow, c.lang) ? `<p class="eyebrow">${esc(T(b.eyebrow, c.lang))}</p>` : ""}
    <h1 class="hero__title">${esc(T(b.title, c.lang))}</h1>
    <div class="lede">${md(esc(T(b.lead, c.lang)), 2)}</div>
    ${c.btn(b.ctaLabel, b.ctaHref)}
  </div>
  ${img ? `<div class="hero__media"><img src="${esc(img)}" alt="${esc(T(b.image.alt, c.lang))}" width="1200" height="800"></div>` : ""}
</div></section>`;
    }
  },

  text: {
    label: ["Text", "Texte"],
    hint: ["A title and a block of text. Markdown subset supported.", "Un titre et un bloc de texte. Markdown simplifié accepté."],
    defaults: () => ({
      title: bi("Section title", "Titre de section"),
      body: bi("## A subheading\n- First point\n- Second point\n\nA closing paragraph.", "## Un sous-titre\n- Premier point\n- Deuxième point\n\nUn paragraphe de conclusion.")
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "body", t: "md", lbl: ["Body", "Contenu"], i18n: true }
    ],
    render(b, c) {
      return `<section class="section"><div class="wrap"><h2>${esc(T(b.title, c.lang))}</h2><div class="prose">${md(esc(T(b.body, c.lang)), 3)}</div></div></section>`;
    }
  },

  features: {
    label: ["Features", "Fonctionnalités"],
    hint: ["Cards: services, pillars, reasons to choose you.", "Cartes : services, piliers, raisons de vous choisir."],
    defaults: () => ({
      title: bi("What you get", "Ce que vous obtenez"),
      lead: bi("Short line above the cards.", "Une ligne au-dessus des cartes."),
      items: [
        { title: bi("First advantage", "Premier avantage"), body: bi("What it brings, in one sentence.", "Ce que cela apporte, en une phrase.") },
        { title: bi("Second advantage", "Deuxième avantage"), body: bi("What it brings, in one sentence.", "Ce que cela apporte, en une phrase.") },
        { title: bi("Third advantage", "Troisième avantage"), body: bi("What it brings, in one sentence.", "Ce que cela apporte, en une phrase.") }
      ]
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "lead", t: "text", lbl: ["Intro line", "Chapeau"], i18n: true },
      { k: "items", t: "list", lbl: ["Items", "Éléments"], of: [
        { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
        { k: "icon", t: "enum", lbl: ["Icon", "Icône"], options: ICON_OPTIONS },
        { k: "body", t: "long", lbl: ["Text", "Texte"], i18n: true }
      ] }
    ],
    render(b, c) {
      return sec(b, `
  <h2>${esc(T(b.title, c.lang))}</h2>
  ${T(b.lead, c.lang) ? `<p class="lede">${esc(T(b.lead, c.lang))}</p>` : ""}
  ${list(b.items, (it) => `<li class="card">${icon(it.icon)}<h3>${esc(T(it.title, c.lang))}</h3><p>${esc(T(it.body, c.lang))}</p></li>`, "grid grid--3")}`);
    }
  },

  stats: {
    label: ["Key figures", "Chiffres clés"],
    hint: ["Large numbers: clients, years, results.", "Grands nombres : clients, années, résultats."],
    defaults: () => ({
      title: bi("", ""),
      items: [
        { value: "120", label: bi("clients served", "clients servis") },
        { value: "12", label: bi("years of practice", "ans de pratique") },
        { value: "98%", label: bi("satisfaction", "satisfaction") }
      ]
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title (optional)", "Titre (facultatif)"], i18n: true },
      { k: "items", t: "list", lbl: ["Figures", "Chiffres"], of: [
        { k: "value", t: "text", lbl: ["Value", "Valeur"] },
        { k: "label", t: "text", lbl: ["Label", "Libellé"], i18n: true }
      ] }
    ],
    render(b, c) {
      return `<section class="section section--tight"><div class="wrap">
  ${T(b.title, c.lang) ? `<h2>${esc(T(b.title, c.lang))}</h2>` : ""}
  <div class="stats">${(b.items || []).map((it) =>
    `<div class="stat"><b>${esc(it.value)}</b><span>${esc(T(it.label, c.lang))}</span></div>`).join("")}</div>
</div></section>`;
    }
  },

  gallery: {
    label: ["Gallery", "Galerie"],
    hint: ["Image grid with captions and required alt text.", "Grille d'images avec légendes et texte alternatif obligatoire."],
    defaults: () => ({
      title: bi("Selected work", "Travaux sélectionnés"),
      items: [{ image: { assetId: "", alt: bi("", "") }, caption: bi("", "") }]
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "items", t: "list", lbl: ["Images", "Images"], of: [
        { k: "image", t: "img", lbl: ["Image", "Image"] },
        { k: "caption", t: "text", lbl: ["Caption", "Légende"], i18n: true }
      ] }
    ],
    render(b, c) {
      const figs = (b.items || []).map((it) => {
        const src = c.img(it.image);
        if (!src) return "";
        return `<figure><img src="${esc(src)}" alt="${esc(T(it.image?.alt, c.lang))}" width="800" height="600" loading="lazy" decoding="async">
          ${T(it.caption, c.lang) ? `<figcaption>${esc(T(it.caption, c.lang))}</figcaption>` : ""}</figure>`;
      }).filter(Boolean).join("");
      if (!figs) return "";
      return `<section class="section"><div class="wrap"><h2>${esc(T(b.title, c.lang))}</h2><div class="gallery">${figs}</div></div></section>`;
    }
  },

  faq: {
    label: ["FAQ", "Questions fréquentes"],
    hint: ["Collapsible questions. No JavaScript needed.", "Questions repliables. Aucun JavaScript nécessaire."],
    defaults: () => ({
      title: bi("Frequently asked questions", "Questions fréquentes"),
      items: [
        { q: bi("How long does it take?", "Combien de temps cela prend-il ?"), a: bi("Answer in two sentences. The reader wants an answer, not an argument.", "Répondez en deux phrases. Le lecteur veut une réponse, pas un argument.") },
        { q: bi("Do you work remotely?", "Travaillez-vous à distance ?"), a: bi("Answer.", "Réponse.") }
      ]
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "items", t: "list", lbl: ["Questions", "Questions"], of: [
        { k: "q", t: "text", lbl: ["Question", "Question"], i18n: true },
        { k: "a", t: "md", lbl: ["Answer", "Réponse"], i18n: true }
      ] }
    ],
    render(b, c) {
      return `<section class="section"><div class="wrap"><h2>${esc(T(b.title, c.lang))}</h2><div class="faq">
  ${(b.items || []).map((it) => `<details><summary>${esc(T(it.q, c.lang))}</summary><div class="prose">${md(esc(T(it.a, c.lang)), 4)}</div></details>`).join("")}
  </div></div></section>`;
    }
  },

  posts: {
    label: ["Article list", "Liste d'articles"],
    hint: ["News, blog or changelog entries.", "Actualités, articles ou notes de version."],
    defaults: () => ({
      title: bi("Latest news", "Dernières actualités"),
      lead: bi("", ""),
      items: [
        { title: bi("First post", "Premier article"), date: "2026-01-15", excerpt: bi("What this post is about.", "De quoi parle cet article."), href: "" },
        { title: bi("Second post", "Deuxième article"), date: "2026-02-02", excerpt: bi("What this post is about.", "De quoi parle cet article."), href: "" }
      ]
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "lead", t: "text", lbl: ["Intro line", "Chapeau"], i18n: true },
      { k: "items", t: "list", lbl: ["Entries", "Entrées"], of: [
        { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
        { k: "date", t: "date", lbl: ["Date", "Date"] },
        { k: "excerpt", t: "long", lbl: ["Summary", "Résumé"], i18n: true },
        { k: "href", t: "url", lbl: ["Link (optional)", "Lien (facultatif)"] }
      ] }
    ],
    render(b, c) {
      const date = (d) => {
        const t = Date.parse(d || "");
        if (Number.isNaN(t)) return "";
        return new Date(t).toLocaleDateString(c.lang === "fr" ? "fr-FR" : "en-GB", { year: "numeric", month: "long", day: "numeric" });
      };
      return `<section class="section"><div class="wrap">
  <h2>${esc(T(b.title, c.lang))}</h2>
  ${T(b.lead, c.lang) ? `<p class="lede">${esc(T(b.lead, c.lang))}</p>` : ""}
  ${(b.items || []).map((it) => {
    const href = safeHref(it.href);
    const inner = `<h3>${esc(T(it.title, c.lang))}</h3>${T(it.excerpt, c.lang) ? `<p>${esc(T(it.excerpt, c.lang))}</p>` : ""}`;
    return `<article class="post">
    ${it.date ? `<time datetime="${esc(String(it.date).slice(0, 10))}">${esc(date(it.date))}</time>` : ""}
    ${href ? `<a href="${esc(href)}">${inner}</a>` : inner}
  </article>`;
  }).join("")}
</div></section>`;
    }
  },

  table: {
    label: ["Rows (CV, pricing, specs)", "Lignes (CV, tarifs, caractéristiques)"],
    hint: ["A two-column list. Great for experience, pricing, specifications.", "Une liste à deux colonnes. Idéal pour l'expérience, les tarifs, les caractéristiques."],
    defaults: () => ({
      title: bi("Experience", "Expérience"),
      items: [
        { label: bi("2023 — today, Studio", "2023 — aujourd'hui, Studio"), value: bi("What you did and what you shipped.", "Ce que vous avez fait et livré.") },
        { label: bi("2020 — 2023, Agency", "2020 — 2023, Agence"), value: bi("What you did and what you shipped.", "Ce que vous avez fait et livré.") }
      ]
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "items", t: "list", lbl: ["Rows", "Lignes"], of: [
        { k: "label", t: "text", lbl: ["Left column", "Colonne de gauche"], i18n: true },
        { k: "value", t: "md", lbl: ["Right column", "Colonne de droite"], i18n: true }
      ] }
    ],
    render(b, c) {
      const rows = (b.items || []).map((it) =>
        `<tr><th scope="row">${esc(T(it.label, c.lang))}</th><td>${md(esc(T(it.value, c.lang)), 4)}</td></tr>`).join("");
      if (!rows) return "";
      return `<section class="section"><div class="wrap"><h2>${esc(T(b.title, c.lang))}</h2>
  <table><tbody>${rows}</tbody></table></div></section>`;
    }
  },

  products: {
    label: ["Products", "Produits"],
    hint: ["Shop grid: name, price, image, link. Prices are display only.", "Grille de boutique : nom, prix, image, lien. Les prix sont affichés uniquement."],
    defaults: () => ({
      title: bi("The catalogue", "Le catalogue"),
      lead: bi("Prices shown for information only.", "Prix affichés à titre indicatif."),
      items: [
        { name: bi("First product", "Premier produit"), price: "29", blurb: bi("One line about it.", "Une ligne à ce sujet."), image: { assetId: "", alt: bi("", "") }, href: "" },
        { name: bi("Second product", "Deuxième produit"), price: "49", blurb: bi("One line about it.", "Une ligne à ce sujet."), image: { assetId: "", alt: bi("", "") }, href: "" }
      ]
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "lead", t: "text", lbl: ["Intro line", "Chapeau"], i18n: true },
      { k: "items", t: "list", lbl: ["Products", "Produits"], of: [
        { k: "image", t: "img", lbl: ["Image", "Image"] },
        { k: "name", t: "text", lbl: ["Name", "Nom"], i18n: true },
        { k: "price", t: "text", lbl: ["Price", "Prix"] },
        { k: "blurb", t: "long", lbl: ["Description", "Description"], i18n: true },
        { k: "href", t: "url", lbl: ["Link (optional)", "Lien (facultatif)"] }
      ] }
    ],
    render(b, c) {
      const cards = (b.items || []).map((it) => {
        const name = T(it.name, c.lang);
        const src = c.img(it.image);
        if (!name.trim() && !src) return ""; // an entirely blank row adds nothing
        return `<li class="card">
        ${src ? `<img src="${esc(src)}" alt="${esc(T(it.image?.alt, c.lang))}" width="600" height="450" loading="lazy" decoding="async" style="border-radius:var(--radius);margin-bottom:.8rem">` : ""}
        <h3>${esc(name)}</h3>
        ${T(it.blurb, c.lang) ? `<p>${esc(T(it.blurb, c.lang))}</p>` : ""}
        ${String(it.price || "").trim() ? `<p class="price">${esc(it.price)} <small>${esc(c.lang === "fr" ? "TTC" : "incl. tax")}</small></p>` : ""}
        ${c.btnRaw(name, it.href, st("buy", c.lang))}
      </li>`;
      }).filter(Boolean).join("");
      return `<section class="section"><div class="wrap">
  <h2>${esc(T(b.title, c.lang))}</h2>
  ${T(b.lead, c.lang) ? `<p class="lede">${esc(T(b.lead, c.lang))}</p>` : ""}
  ${cards ? `<ul class="grid grid--3">${cards}</ul>` : ""}
</div></section>`;
    }
  },

  threads: {
    label: ["Threads", "Sujets"],
    hint: ["Forum listing: title, author, replies, tags. Content only — a real forum needs a server.", "Liste de sujets : titre, auteur, réponses, étiquettes. Contenu seul — un vrai forum nécessite un serveur."],
    defaults: () => ({
      title: bi("Latest topics", "Derniers sujets"),
      items: [
        { title: bi("A question worth answering", "Une question à laquelle répondre"), author: "user01", replies: 12, date: "2026-03-04", tags: bi("help, tips", "aide, conseils"), pinned: true },
        { title: bi("Sharing a small discovery", "Partage d'une petite découverte"), author: "user02", replies: 4, date: "2026-03-01", tags: bi("showcase", "partage"), pinned: false }
      ]
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "items", t: "list", lbl: ["Topics", "Sujets"], of: [
        { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
        { k: "author", t: "text", lbl: ["Author", "Auteur"] },
        { k: "replies", t: "text", lbl: ["Reply count", "Nombre de réponses"] },
        { k: "date", t: "date", lbl: ["Date", "Date"] },
        { k: "tags", t: "text", lbl: ["Tags (comma separated)", "Étiquettes (séparées par des virgules)"], i18n: true },
        { k: "pinned", t: "bool", lbl: ["Pinned", "Épinglé"] }
      ] }
    ],
    render(b, c) {
      const date = (d) => {
        const t = Date.parse(d || "");
        return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString(c.lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
      };
      return `<section class="section"><div class="wrap"><h2>${esc(T(b.title, c.lang))}</h2>
  ${(b.items || []).map((it) => `<article class="thread">
    <div class="thread__meta">
      ${it.pinned ? `<span class="tag">${esc(st("pinned", c.lang))}</span>` : ""}
      <span>${esc(st("by", c.lang))} ${esc(it.author)}</span>
      <span>${esc(it.replies)} ${esc(st("replies", c.lang))}</span>
      ${it.date ? `<span>${esc(st("lastPost", c.lang))} ${esc(date(it.date))}</span>` : ""}
    </div>
    <h3><a href="#">${esc(T(it.title, c.lang))}</a></h3>
    ${T(it.tags, c.lang) ? String(T(it.tags, c.lang)).split(",").map((x) => x.trim()).filter(Boolean).map((x) => `<span class="tag">${esc(x)}</span>`).join("") : ""}
  </article>`).join("")}
</div></section>`;
    }
  },

  links: {
    label: ["Link row", "Rangee de liens"],
    hint: ["Platforms, social links, downloads.", "Plateformes, réseaux sociaux, téléchargements."],
    defaults: () => ({
      title: bi("Get it here", "Disponible ici"),
      items: [
        { label: bi("Windows", "Windows"), url: "#", note: bi("Download", "Télécharger") },
        { label: bi("macOS", "macOS"), url: "#", note: bi("Download", "Télécharger") }
      ]
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "items", t: "list", lbl: ["Links", "Liens"], of: [
        { k: "label", t: "text", lbl: ["Label", "Libellé"], i18n: true },
        { k: "url", t: "url", lbl: ["Address", "Adresse"] },
        { k: "note", t: "text", lbl: ["Small note", "Petite note"], i18n: true }
      ] }
    ],
    render(b, c) {
      const links = (b.items || []).map((it) => {
        const href = safeHref(it.url);
        if (!href) return "";
        return `<li class="card"><h3><a href="${esc(href)}">${esc(T(it.label, c.lang))}</a></h3>${T(it.note, c.lang) ? `<p><small>${esc(T(it.note, c.lang))}</small></p>` : ""}</li>`;
      }).filter(Boolean).join("");
      if (!links) return "";
      return `<section class="section"><div class="wrap"><h2>${esc(T(b.title, c.lang))}</h2><ul class="grid grid--3">${links}</ul></div></section>`;
    }
  },

  cta: {
    label: ["Call to action", "Appel à l'action"],
    hint: ["A closing block that asks for one thing.", "Bloc de conclusion qui demande une seule chose."],
    defaults: () => ({
      title: bi("Let's talk", "Parlons-en"),
      body: bi("Tell me what you are building and when you need it.", "Dites-moi ce que vous construisez et pour quand."),
      label: bi("Book a call", "Prendre rendez-vous"), href: "mailto:hello@example.com"
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "body", t: "md", lbl: ["Text", "Texte"], i18n: true },
      { k: "label", t: "text", lbl: ["Button label", "Libellé du bouton"], i18n: true },
      { k: "href", t: "url", lbl: ["Button destination", "Destination du bouton"] }
    ],
    render(b, c) {
      return `<section class="section"><div class="wrap"><div class="cta">
  <h2>${esc(T(b.title, c.lang))}</h2>
  <div class="prose" style="margin-inline:auto">${md(esc(T(b.body, c.lang)), 3)}</div>
  ${c.btn(b.label, b.href)}
</div></div></section>`;
    }
  },

  contact: {
    label: ["Contact form", "Formulaire de contact"],
    hint: ["A static form. mailto: works with no server; a POST endpoint needs one.", "Formulaire statique. mailto: fonctionne sans serveur ; un point d'entrée POST en exige un."],
    defaults: () => ({
      title: bi("Get in touch", "Nous contacter"),
      intro: bi("A few lines about your project, and I reply within two working days.", "Quelques lignes sur votre projet, je réponds sous deux jours ouvrés."),
      action: "mailto:hello@example.com", wantName: true, wantEmail: true, wantSubject: true, wantMessage: true
    }),
    fields: [
      { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
      { k: "intro", t: "long", lbl: ["Intro", "Chapeau"], i18n: true },
      { k: "action", t: "url", lbl: ["Destination (mailto: or a form endpoint)", "Destination (mailto: ou point d'entrée)"], hint: ["A form service URL needs a server. mailto: needs nothing.", "L'URL d'un service de formulaire nécessite un serveur. mailto: ne demande rien."] },
      { k: "wantName", t: "bool", lbl: ["Name field", "Champ nom"] },
      { k: "wantEmail", t: "bool", lbl: ["Email field", "Champ email"] },
      { k: "wantSubject", t: "bool", lbl: ["Subject field", "Champ objet"] },
      { k: "wantMessage", t: "bool", lbl: ["Message field", "Champ message"] }
    ],
    render(b, c) {
      const action = safeHref(b.action) || "#";
      const isMail = /^mailto:/i.test(action);
      const field = (name, label, type = "text", rows = 0) =>
        rows
          ? `<label for="f-${name}">${esc(label)}</label><textarea id="f-${name}" name="${name}" rows="6" required></textarea>`
          : `<label for="f-${name}">${esc(label)}</label><input id="f-${name}" name="${name}" type="${type}"${type === "email" ? ' autocomplete="email"' : ""} required>`;
      return `<section class="section"><div class="wrap">
  <h2>${esc(T(b.title, c.lang))}</h2>
  ${T(b.intro, c.lang) ? `<p class="lede">${esc(T(b.intro, c.lang))}</p>` : ""}
  <form class="stack" method="${isMail ? "post" : "post"}" action="${esc(action)}" enctype="text/plain" novalidate data-static-form>
    ${b.wantName ? field("name", st("formName", c.lang)) : ""}
    ${b.wantEmail ? field("email", st("formEmail", c.lang), "email") : ""}
    ${b.wantSubject ? field("subject", st("formSubject", c.lang)) : ""}
    ${b.wantMessage ? field("message", st("formMessage", c.lang), "text", 6) : ""}
    <button class="btn" type="submit">${esc(st("formSend", c.lang))}</button>
    <p><small>${esc(st("formNote", c.lang))}</small></p>
    <p role="status" aria-live="polite" data-form-status hidden></p>
  </form>
</div></section>`;
    }
  }
};

/* ------------------------------------------------------------------ added */

/** Skill levels, and the two things derived from them: a width and a word. */
const SKILL_LEVELS = [
  ["beginner", ["Beginner", "Débutant"]],
  ["familiar", ["Familiar", "Familier"]],
  ["advanced", ["Advanced", "Avancé"]],
  ["expert", ["Expert", "Expert"]]
];
const SKILL_PCT = { beginner: 30, familiar: 55, advanced: 78, expert: 100 };
const SKILL_WORD = Object.fromEntries(SKILL_LEVELS);

/**
 * Five blocks that close the gaps the first thirteen left.
 *
 * Every one of them exists because a real page of that kind has it and ours
 * could not: a testimonial, a dated career timeline, skills with a level, a
 * numbered "how it works", and a logo strip. Before these, a CV was a table
 * and a business page had nowhere to say how it worked.
 */

BLOCKS.testimonial = {
  label: ["Testimonial", "Témoignage"],
  hint: ["What somebody said. One quote, one person.", "Ce que quelqu'un a dit. Une citation, une personne."],
  defaults: () => ({
    title: bi("", ""),
    quote: bi("They shipped it in three weeks and it has not needed a rewrite since.",
      "Livré en trois semaines, et aucune réécriture depuis."),
    author: bi("A name", "Un nom"),
    role: bi("Role, company", "Fonction, entreprise"),
    avatar: { assetId: "", alt: bi("", "") },
    effect: "soft"
  }),
  fields: [
    { k: "title", t: "text", lbl: ["Title (optional)", "Titre (facultatif)"], i18n: true },
    { k: "quote", t: "long", lbl: ["Quote", "Citation"], i18n: true },
    { k: "author", t: "text", lbl: ["Author", "Auteur"], i18n: true },
    { k: "role", t: "text", lbl: ["Role", "Fonction"], i18n: true },
    { k: "avatar", t: "img", lbl: ["Photo", "Photo"] },
    effectField()
  ],
  render(b, c) {
    const img = c.img(b.avatar);
    const q = T(b.quote, c.lang);
    if (!q) return "";
    return sec(b, `
  ${T(b.title, c.lang) ? `<h2>${esc(T(b.title, c.lang))}</h2>` : ""}
  <figure class="quote">
    <p>${esc(q)}</p>
    <figcaption><footer>
      ${img ? `<img src="${esc(img)}" alt="${esc(T(b.avatar.alt, c.lang))}" width="44" height="44">` : ""}
      <div><cite>${esc(T(b.author, c.lang))}</cite><small>${esc(T(b.role, c.lang))}</small></div>
    </footer></figcaption>
  </figure>`);
  }
};

BLOCKS.timeline = {
  label: ["Timeline", "Parcours"],
  hint: ["Dated entries: jobs, studies, milestones. Best for a CV.", "Entrées datées : postes, études, étapes. Idéal pour un CV."],
  defaults: () => ({
    title: bi("Experience", "Parcours"),
    items: [
      { when: bi("2022 — now", "2022 — aujourd'hui"), title: bi("Job title", "Intitulé du poste"), org: bi("Company", "Entreprise"), body: bi("What you did there.", "Ce que vous y avez fait.") },
      { when: bi("2019 — 2022", "2019 — 2022"), title: bi("Earlier role", "Poste précédent"), org: bi("Somewhere else", "Ailleurs"), body: bi("What you did there.", "Ce que vous y avez fait.") }
    ],
    effect: "none"
  }),
  fields: [
    { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
    { k: "items", t: "list", lbl: ["Entries", "Entrées"], of: [
      { k: "when", t: "text", lbl: ["When", "Période"], i18n: true },
      { k: "title", t: "text", lbl: ["Role or degree", "Poste ou diplôme"], i18n: true },
      { k: "org", t: "text", lbl: ["Company or school", "Entreprise ou école"], i18n: true },
      { k: "body", t: "long", lbl: ["What you did", "Ce que vous avez fait"], i18n: true }
    ] },
    effectField()
  ],
  render(b, c) {
    const items = b.items || [];
    if (!items.length) return "";
    return sec(b, `
  <h2>${esc(T(b.title, c.lang))}</h2>
  <ul class="time">${items.map((it) => `<li class="time__item">
    ${T(it.when, c.lang) ? `<p class="time__when">${esc(T(it.when, c.lang))}</p>` : ""}
    <h3>${esc(T(it.title, c.lang))}</h3>
    ${T(it.org, c.lang) ? `<p>${esc(T(it.org, c.lang))}</p>` : ""}
    ${T(it.body, c.lang) ? `<div class="prose">${md(esc(T(it.body, c.lang)), 3)}</div>` : ""}
  </li>`).join("")}</ul>`);
  }
};

BLOCKS.skills = {
  label: ["Skills", "Compétences"],
  hint: ["Named skills with a level. Also good for the languages you speak.", "Compétences nommées avec un niveau. Également utile pour les langues que vous parlez."],
  defaults: () => ({
    title: bi("Skills", "Compétences"),
    showBar: true,
    items: [
      { name: bi("Design", "Design"), level: "advanced" },
      { name: bi("Development", "Développement"), level: "advanced" },
      { name: bi("Strategy", "Stratégie"), level: "familiar" }
    ],
    effect: "none"
  }),
  fields: [
    { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
    { k: "showBar", t: "bool", lbl: ["Show a level bar", "Afficher une barre de niveau"] },
    { k: "items", t: "list", lbl: ["Skills", "Compétences"], of: [
      { k: "name", t: "text", lbl: ["Name", "Nom"], i18n: true },
      { k: "level", t: "enum", lbl: ["Level", "Niveau"], options: SKILL_LEVELS }
    ] },
    effectField()
  ],
  render(b, c) {
    const items = b.items || [];
    if (!items.length) return "";
    return sec(b, `
  <h2>${esc(T(b.title, c.lang))}</h2>
  <dl class="skills">${items.map((it) => {
      const pct = SKILL_PCT[it.level] ?? 60;
      const word = SKILL_WORD[it.level]?.[c.lang === "fr" ? 1 : 0] || "";
      return `<div>
    <dt>${esc(T(it.name, c.lang))}${word ? `<span>${esc(word)}</span>` : ""}</dt>
    ${b.showBar === false ? "" : `<dd class="skills__bar"><i style="width:${pct}%"></i></dd>`}
  </div>`;
    }).join("")}</dl>`);
  }
};

BLOCKS.steps = {
  label: ["Steps", "Étapes"],
  hint: ["Numbered steps: how it works, what happens next.", "Étapes numérotées : comment ça marche, la suite."],
  defaults: () => ({
    title: bi("How it works", "Comment ça marche"),
    items: [
      { title: bi("You tell us", "Vous nous dites"), body: bi("What you want, in plain words.", "Ce que vous voulez, avec vos mots.") },
      { title: bi("We build it", "Nous le réalisons"), body: bi("A first version in days, not months.", "Une première version en quelques jours.") },
      { title: bi("You keep control", "Vous gardez la main"), body: bi("Everything is yours, editable, exportable.", "Tout vous appartient, modifiable, exportable.") }
    ],
    effect: "none"
  }),
  fields: [
    { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
    { k: "items", t: "list", lbl: ["Steps", "Étapes"], of: [
      { k: "title", t: "text", lbl: ["Step title", "Intitulé"], i18n: true },
      { k: "body", t: "long", lbl: ["Description", "Description"], i18n: true }
    ] },
    effectField()
  ],
  render(b, c) {
    const items = b.items || [];
    if (!items.length) return "";
    return sec(b, `
  <h2>${esc(T(b.title, c.lang))}</h2>
  <ol class="steps">${items.map((it) => `<li><h3>${esc(T(it.title, c.lang))}</h3><p>${esc(T(it.body, c.lang))}</p></li>`).join("")}</ol>`);
  }
};

BLOCKS.logos = {
  label: ["Logo strip", "Bandeau de logos"],
  hint: ["Who already trusts you. Images, or names if you have none.", "Qui vous fait déjà confiance. Images, ou noms à défaut."],
  defaults: () => ({
    title: bi("Trusted by", "Ils nous font confiance"),
    items: [
      { name: bi("Client one", "Client un"), image: { assetId: "", alt: bi("", "") } },
      { name: bi("Client two", "Client deux"), image: { assetId: "", alt: bi("", "") } },
      { name: bi("Client three", "Client trois"), image: { assetId: "", alt: bi("", "") } }
    ],
    effect: "none"
  }),
  fields: [
    { k: "title", t: "text", lbl: ["Title", "Titre"], i18n: true },
    { k: "items", t: "list", lbl: ["Logos", "Logos"], of: [
      { k: "name", t: "text", lbl: ["Name", "Nom"], i18n: true },
      { k: "image", t: "img", lbl: ["Logo image", "Image du logo"] }
    ] },
    effectField()
  ],
  render(b, c) {
    const items = b.items || [];
    if (!items.length) return "";
    return sec(b, `
  ${T(b.title, c.lang) ? `<h2>${esc(T(b.title, c.lang))}</h2>` : ""}
  <ul class="logos">${items.map((it) => {
      const img = c.img(it.image);
      const name = esc(T(it.name, c.lang));
      return `<li>${img
        ? `<img src="${esc(img)}" alt="${name}" width="160" height="34" loading="lazy">`
        : `<span>${name}</span>`}</li>`;
    }).join("")}</ul>`);
  }
};



/** Block types, in the order they are offered in the "Add a section" menu. */
export const BLOCK_ORDER = [
  "hero", "text", "features", "stats", "gallery", "posts",
  "table", "products", "threads", "faq", "links", "cta", "contact",
  "testimonial", "timeline", "skills", "steps", "logos"
];

/** A fresh block of the given type, carrying its defaults and an id. */
export function makeBlock(type, id, makeId) {
  const def = BLOCKS[type];
  if (!def) return null;
  return { id: id || (makeId || uid)("b"), type, ...def.defaults() };
}

/**
 * Human label for the outline: the block's own title, else its type name.
 * `lang` selects the language of both — a French outline shows "Bannière",
 * never "Hero".
 */
export function blockName(b, lang = "en") {
  const first = b.title ?? b.name ?? b.q ?? b.label ?? b.value;
  const v = T(first, lang);
  if (v) return v.slice(0, 40);
  return BLOCKS[b.type]?.label?.[lang === "fr" ? 1 : 0] || b.type;
}

/** Type name in the active language, for the outline's small trailing tag. */
export const blockTypeLabel = (type, lang = "en") =>
  BLOCKS[type]?.label?.[lang === "fr" ? 1 : 0] || type;

/** Heading level a block contributes, for the heading-order audit. */
export const headingLevel = (type) => (type === "hero" ? 1 : 2);