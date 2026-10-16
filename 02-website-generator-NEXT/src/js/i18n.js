/**
 * Generator interface dictionary — French / English.
 *
 * One TUPLE per key: [English, French]. Tuples rather than two objects so the
 * key is written once and a missing translation is visible at a glance
 * (`["", ""]` or `null` shows up immediately in review and in the self-check).
 *
 * THIS is the generator's own language. It is completely independent from the
 * language of the site being built: switching the interface never rewrites a
 * single word of user content. See `meta.lang` / `meta.bilingual` for that.
 *
 * Device preferences (language, text scale) are persisted in localStorage.
 * They are device settings, not project content, so they never enter the
 * exported project and "Reset project" leaves them alone.
 */

export const T = {
  docTitle: ["MURTHER FABRIQUE — visual site builder", "MURTHER FABRIQUE — générateur visuel de sites"],
  appName: ["MURTHER FABRIQUE", "MURTHER FABRIQUE"],
  taglineApp: ["Build, preview and export a real static website. No account, no server, no tracking.", "Construisez, prévisualisez et exportez un vrai site statique. Sans compte, sans serveur, sans pistage."],
  skipEditor: ["Skip to the editor", "Aller à l'éditeur"],
  close: ["Close", "Fermer"],
  refresh: ["Refresh", "Actualiser"],
  langLabelSite: ["Site language shown in the preview", "Langue du site affichée dans l'aperçu"],
  host: ["Host (for the legal pages)", "Hébergeur (pour les pages légales)"],

  /* --- language + scale (device prefs) --- */
  lblUiLang: ["Interface language", "Langue de l'interface"],
  lblUiScale: ["Interface text size", "Taille du texte de l'interface"],
  // Short forms for the visible micro-labels above the two toolbar selects.
  // The long ones are the accessible description and the tooltip; as visible
  // labels they wrapped the toolbar onto a second row in French, which is
  // exactly the wrapping the grid row was supposed to survive gracefully.
  lblLangShort: ["Language", "Langue"],
  lblSizeShort: ["Text size", "Taille"],
  scale100: ["Text 100%", "Texte 100 %"],
  scale115: ["Text 115%", "Texte 115 %"],
  scale130: ["Text 130%", "Texte 130 %"],

  /* --- panels --- */
  panelOutline: ["Structure", "Structure"],
  panelInspector: ["Content", "Contenu"],
  panelPreview: ["Preview", "Aperçu"],
  panelAudit: ["Quality report", "Rapport qualité"],
  panelExport: ["Export", "Export"],
  panelDesign: ["Design", "Design"],
  panelSeo: ["SEO & settings", "Référencement et réglages"],
  panelTemplates: ["Templates", "Modèles"],

  /* --- undo / project --- */
  undo: ["Undo", "Annuler"],
  redo: ["Redo", "Rétablir"],
  newProject: ["New", "Nouveau"],
  resetConfirm: ["Start a new project? Unsaved changes are lost.", "Commencer un nouveau projet ? Les modifications non enregistrées seront perdues."],
  undoUnavailable: ["Nothing left to undo", "Plus rien à annuler"],
  redoUnavailable: ["Nothing left to redo", "Plus rien à rétablir"],
  autoSaved: ["Project saved on this device", "Projet enregistré sur cet appareil"],
  storageBlocked: ["Local storage unavailable — changes will not survive a reload", "Stockage local indisponible — les modifications ne survivront pas au rechargement"],

  /* --- templates --- */
  tplPick: ["Start from a template", "Partir d'un modèle"],
  tplBlank: ["Blank page", "Page vierge"],
  tplBlankDesc: ["One empty page, nothing else.", "Une page vide, rien d'autre."],
  tplPortfolio: ["Portfolio", "Portfolio"],
  tplPortfolioDesc: ["Showcase work, a bio, a contact form.", "Montre des projets, une bio, un formulaire."],
  tplCv: ["CV / Résumé", "CV"],
  tplCvDesc: ["Experience, skills, education, timeline.", "Expérience, compétences, formation, parcours."],
  tplBusiness: ["Business site", "Site d'entreprise"],
  tplBusinessDesc: ["Services, team, legal pages, SEO.", "Services, équipe, pages légales, référencement."],
  tplBlog: ["Blog", "Blog"],
  tplBlogDesc: ["Post list, article pages, archive.", "Liste d'articles, pages d'article, archives."],
  tplForum: ["Forum / Community", "Forum / Communauté"],
  tplForumDesc: ["Boards, thread list, pinned posts.", "Catégories, liste de sujets, épingles."],
  tplGame: ["Video game site", "Site de jeu vidéo"],
  tplGameDesc: ["Hero art, news, features, wishlist.", "Illustration, actualités, fonctionnalités, wishlist."],
  tplStore: ["Online store", "Boutique en ligne"],
  tplStoreDesc: ["Product grid, prices, cart notice.", "Grille de produits, prix, mention du panier."],
  tplSaas: ["SaaS landing", "Page SaaS"],
  tplSaasDesc: ["Pricing table, features, signup call.", "Grille tarifaire, fonctionnalités, appel à l'inscription."],
  tplUse: ["Use this template", "Utiliser ce modèle"],
  tplUsed: ["Template applied", "Modèle appliqué"],
  tplCleared: ["Project reset to a blank page", "Projet réinitialisé sur une page vierge"],

  /* --- structure panel --- */
  pagesTitle: ["Pages", "Pages"],
  lblPage: ["Page settings", "Réglages de la page"],
  titleLabel: ["Page title", "Titre de la page"],
  inMenuLabel: ["Show this page in the menu", "Afficher cette page dans le menu"],
  homePageHint: ["The first page is always the home page and always appears first in the menu.", "La première page est toujours la page d'accueil et apparaît toujours en premier dans le menu."],
  homeSlugHint: ["Its file name is fixed at index.html.", "Son nom de fichier est fixé à index.html."],
  slugHint: ["Letters, digits and dashes. It becomes the .html file name on export.", "Lettres, chiffres et tirets. Il devient le nom du fichier .html à l'export."],
  addPage: ["Add a page", "Ajouter une page"],
  delPage: ["Delete this page", "Supprimer cette page"],
  delPageConfirm: ["Delete the page %s?", "Supprimer la page %s ?"],
  moveUp: ["Move up", "Monter"],
  moveDown: ["Move down", "Descendre"],
  slugLabel: ["File name", "Nom du fichier"],
  menuLabel: ["Label in the menu", "Libellé dans le menu"],
  homeBadge: ["Home", "Accueil"],
  blocksTitle: ["Sections on this page", "Sections de cette page"],
  addBlock: ["Add a section", "Ajouter une section"],
  delBlock: ["Delete this section", "Supprimer cette section"],
  dupBlock: ["Duplicate this section", "Dupliquer cette section"],
  blockNone: ["This page is empty. Add a section to see something.", "Cette page est vide. Ajoutez une section pour voir quelque chose."],
  pageNone: ["No pages yet.", "Aucune page pour l'instant."],
  selectPage: ["Select a page", "Sélectionnez une page"],

  /* --- inspector --- */
  pickSection: ["Select a section on the left, or start from a template.", "Sélectionnez une section à gauche, ou partez d'un modèle."],
  contentLang: ["Content language", "Langue du contenu"],
  contentLangEn: ["English", "Anglais"],
  contentLangFr: ["French", "Français"],
  copyToOther: ["Copy to the other language", "Copier vers l'autre langue"],
  copiedToOther: ["Copied", "Copié"],
  addItem: ["Add a line", "Ajouter une ligne"],
  delItem: ["Delete this line", "Supprimer cette ligne"],
  itemsEmpty: ["Nothing here yet.", "Rien ici pour l'instant."],
  fieldMissingOther: ["No %s version — this site falls back to the main language", "Pas de version %s — ce site retombe sur la langue principale"],
  urlHint: ["http://, https://, mailto:, tel:, or /path", "http://, https://, mailto:, tel:, ou /chemin"],
  imagePick: ["Choose an image", "Choisir une image"],
  imageReplace: ["Replace", "Remplacer"],
  imageRemove: ["Remove", "Retirer"],
  imageNone: ["No image", "Aucune image"],
  imageAltLabel: ["Alternative text (required)", "Texte alternatif (obligatoire)"],
  imageTooBig: ["Image rejected: %s. Limit is %s per image.", "Image refusée : %s. La limite est de %s par image."],
  imageWrongType: ["That file is not a PNG, JPEG, GIF, WebP, AVIF or SVG image.", "Ce fichier n'est pas une image PNG, JPEG, GIF, WebP, AVIF ou SVG."],
  imageUnreadable: ["That image could not be read. Try re-saving it.", "Cette image n'a pas pu être lue. Essayez de l'enregistrer à nouveau."],
  // A count limit is not a size limit. Saying "file too large" when there is
  // simply no room left answers a question nobody asked.
  tooManyImages: ["This project already holds %s images, which is the limit. Remove one before adding another.", "Ce projet contient déjà %s images, ce qui est la limite. Supprimez-en une avant d'en ajouter une autre."],
  tooManyPages: ["This project already has %s pages, which is the limit.", "Ce projet contient déjà %s pages, ce qui est la limite."],
  tooManyBlocks: ["This page already has %s sections, which is the limit. Remove one before adding another.", "Cette page contient déjà %s sections, ce qui est la limite. Supprimez-en une avant d'en ajouter une autre."],

  /* --- design --- */
  paletteLabel: ["Colour set", "Jeu de couleurs"],
  colorsLabel: ["Colours", "Couleurs"],
  palInk: ["Professional blue", "Bleu professionnel"],
  palForest: ["Natural green", "Vert naturel"],
  palPlum: ["Creative violet", "Violet créatif"],
  palClay: ["Warm terracotta", "Terracotta chaleureux"],
  palSlate: ["Dark slate", "Ardoise sombre"],
  palCustom: ["Custom", "Personnalisé"],
  colBg: ["Page background", "Fond de page"],
  colSurface: ["Cards and surfaces", "Cartes et surfaces"],
  colInk: ["Body text", "Texte du corps"],
  colAccent: ["Links and buttons", "Liens et boutons"],
  colAlt: ["Decorative accent", "Accent décoratif"],
  hintAccent: ["The decorative accent is never used for small text — pale colours are unreadable on a light background.", "L'accent décoratif n'est jamais utilisé pour du petit texte : les teintes claires sont illisibles sur fond clair."],
  radiusLabel: ["Corner rounding", "Arrondi des angles"],

  /* --- live contrast readout, sitting under the colour pickers --- */
  contrastTitle: ["Contrast check (WCAG AA)", "Vérification du contraste (WCAG AA)"],
  contrastGood: ["All 15 pairs are readable.", "Les 15 paires sont lisibles."],
  contrastBad: ["%s pair(s) below 4.5:1 — fix the red rows before exporting.", "%s paire(s) sous 4,5:1 — corrigez les lignes rouges avant d'exporter."],
  scaleLabel: ["Base text size", "Taille du texte de base"],
  scaleCompact: ["Compact", "Compacte"],
  scaleDefault: ["Default", "Par défaut"],
  scaleLarge: ["Large", "Grande"],
  scaleHuge: ["Very large", "Très grande"],
  hintScale: ["Scales the whole type scale of the generated site, headings included. Line length stays optimal.", "Met à l'échelle toute la hiérarchie typographique du site généré, titres compris. La longueur de ligne reste optimale."],
  toneLabel: ["Typography", "Typographie"],
  toneSans: ["Modern — sans-serif", "Moderne — sans-serif"],
  toneSerif: ["Classic — serif", "Classique — serif"],
  toneMono: ["Technical — monospace", "Technique — monospace"],
  schemeLabel: ["Theme", "Thème"],
  schemeAuto: ["Auto (follows the system)", "Auto (suit le système)"],
  schemeLight: ["Light", "Clair"],
  schemeDark: ["Dark", "Sombre"],
  customCss: ["Custom CSS", "CSS personnalisé"],
  motionLabel: ["Animation", "Animations"],
  motionNone: ["None", "Aucune"],
  motionSubtle: ["Subtle", "Discrète"],
  motionExpressive: ["Expressive", "Marquante"],
  hintMotion: ["CSS-only entrance animations, so the exported site still ships one small script and no third-party requests. Your reduced-motion system setting always wins.", "Animations d'entrée en CSS pur : le site exporté garde son petit script et n'appelle aucun tiers. Votre réglage système « animations réduites » l'emporte toujours."],
  hintCss: ["Appended to the end of the generated stylesheet. Remote @import and url() rules are removed: the exported site calls no third party. Use !important to override generated rules.", "Ajouté à la fin de la feuille de style générée. Les règles @import et url() distantes sont retirées : le site exporté n'appelle aucun tiers. Utilisez !important pour passer devant les règles générées."],

  /* --- SEO & settings --- */
  siteNameLabel: ["Site name", "Nom du site"],
  taglineLabel: ["Tagline (one line)", "Accroche (une ligne)"],
  descLabel: ["Meta description (search results)", "Meta description (accents de recherche)"],
  baseUrlLabel: ["Canonical URL", "URL canonique"],
  siteLangLabel: ["Main language of the site", "Langue principale du site"],
  bilingualLabel: ["Make the site bilingual (FR + EN)", "Rendre le site bilingue (FR + EN)"],
  hintBilingual: ["Adds a language switch on every generated page. Each text section gets an editable FR and EN version, independent from the interface language.", "Ajoute un sélecteur de langue sur chaque page générée. Chaque bloc de texte obtient une version FR et EN éditable, indépendante de la langue de l'interface."],
  noindexLabel: ["Ask search engines not to index this site", "Demander aux moteurs de recherche de ne pas indexer ce site"],
  noteNoindex: ["For a site still under construction: robots.txt with Disallow: / and a noindex tag.", "Pour un site en construction : robots.txt avec Disallow: / et une balise noindex."],
  legalNote: ["Privacy and legal pages are generated from the fields above, in the site's language.", "Les pages de confidentialité et mentions légales sont générées à partir des champs ci-dessus, dans la langue du site."],
  companyLabel: ["Company / legal name", "Raison sociale"],
  addressLabel: ["Address", "Adresse"],
  // Was referenced by renderSeo() but never defined here. t() returns an
  // unknown key unchanged, so the field showed the literal text "formEmail"
  // as its label in both languages.
  formEmail: ["Email address", "Adresse e-mail"],

  /* --- preview --- */
  previewTitle: ["The real generated page", "La vraie page générée"],
  addSectionHere: ["Add a section to this page", "Ajouter une section à cette page"],
  deviceDesktop: ["Desktop", "Ordinateur"],
  deviceTablet: ["Tablet", "Tablette"],
  devicePhone: ["Phone", "Téléphone"],
  openInTab: ["Open in a new tab", "Ouvrir dans un nouvel onglet"],
  zoomFit: ["Fit", "Ajuster"],
  zoomActual: ["Actual size", "Taille réelle"],

  /* --- audit --- */
  auditTitle: ["Quality report", "Rapport qualité"],
  auditPass: ["All checks passed.", "Tous les contrôles sont passés."],
  auditFail: ["%s point(s) to review", "%s point(s) à revoir"],
  auditGo: ["Go to it", "Y aller"],
  auContrastOk: ["Colour contrast reaches WCAG AA (4.5:1)", "Le contraste atteint WCAG AA (4,5:1)"],
  auContrastKo: ["Contrast %s:1 is below 4.5:1 for body text", "Contraste %s:1 insuffisant pour du texte (4,5:1 requis)"],
  auAltOk: ["Every image has alternative text", "Chaque image a un texte alternatif"],
  auAltKo: ["%s image(s) without alternative text", "%s image(s) sans texte alternatif"],
  auDescOk: ["Every page has a meta description", "Chaque page a une meta description"],
  auDescKo: ["Missing meta description: %s", "Meta description manquante : %s"],
  auTitleOk: ["Every page has a unique title", "Chaque page a un titre unique"],
  auTitleKo: ["Missing or duplicate title: %s", "Titre manquant ou dupliqué : %s"],
  auSlugOk: ["File names are unique and valid", "Les noms de fichiers sont uniques et valides"],
  auSlugKo: ["Duplicate file name: %s", "Nom de fichier dupliqué : %s"],
  auTransOk: ["Bilingual switch is complete", "Le sélecteur bilingue est complet"],
  auTransKo: ["%s text section(s) have no %s version", "%s bloc(s) de texte sans version %s"],
  auEmptyOk: ["No empty page", "Aucune page vide"],
  auEmptyKo: ["Empty page: %s", "Page vide : %s"],
  auSeoOk: ["robots.txt and sitemap.xml generated", "robots.txt et sitemap.xml générés"],
  auFilesOk: ["404 page, favicon and Open Graph image generated", "Page 404, favicon et image Open Graph générés"],
  auRemoteOk: ["The site makes no request to a third party", "Le site ne fait aucune requête vers un tiers"],
  auRemoteKo: ["Unexpected external URL: %s", "URL externe inattendue : %s"],
  auCssOk: ["No custom CSS, or only local rules", "Aucun CSS personnalisé, ou uniquement des règles locales"],
  auCssKo: ["%s remote rule(s) removed from your custom CSS", "%s règle(s) distante(s) retirée(s) de votre CSS personnalisé"],
  auHeadOk: ["Heading levels are in order", "Les niveaux de titre sont dans l'ordre"],
  auHeadKo: ["Heading jump: %s", "Saut de niveau de titre : %s"],
  auFormOk: ["Contact form points somewhere real", "Le formulaire de contact pointe vers une vraie cible"],
  auFormKo: ["Contact form has no working destination — pick mailto: or an endpoint", "Le formulaire de contact n'a pas de destination fonctionnelle — choisissez mailto: ou un point d'entrée"],

  /* --- export --- */
  exportIntro: ["The export is the same file tree as the preview: one HTML page per page, one stylesheet, no framework, no build step. Upload it to any static host.", "L'export est exactement l'arborescence montrée dans l'aperçu : une page HTML par page, une feuille de style, aucun framework, aucune étape de build. Envoyez-la sur n'importe quel hébergeur statique."],
  dlSite: ["Download the site (.zip)", "Télécharger le site (.zip)"],
  dlProject: ["Save project (.json)", "Enregistrer le projet (.json)"],
  loadProject: ["Open a project (.json)", "Ouvrir un projet (.json)"],
  saveFolder: ["Save into a folder", "Enregistrer dans un dossier"],
  noFolderApi: ["This browser has no folder access — use the .zip", "Ce navigateur n'accède pas aux dossiers — utilisez le .zip"],
  // Its own message on purpose: window.open() is refused by a popup blocker in
  // a normal tab and always returns null inside the Windows shell, so the
  // button has to say which of the two happened. Reusing the folder message
  // here sent people looking for a permission dialog that had nothing to do
  // with folders.
  openTabBlocked: ["No new tab — the browser blocked it. Allow pop-ups for this page, or export the site and open index.html.", "Pas de nouvel onglet — le navigateur l'a bloqué. Autorisez les fenêtres contextuelles, ou exportez le site et ouvrez index.html."],
  exported: ["Site exported (%s, %s files)", "Site exporté (%s, %s fichiers)"],
  // Was the literal French word "dossier" passed in from ui.js, so an English
  // interface announced "Site exported (dossier, 13 files)".
  exportedFolder: ["folder", "dossier"],
  projectSaved: ["Project file saved", "Fichier projet enregistré"],
  projectLoaded: ["Project loaded", "Projet chargé"],
  needsServer: ["Requires a server or a form service — see the README", "Nécessite un serveur ou un service de formulaire — voir le README"],

  /* --- errors --- */
  errSlugDup: ["Two pages cannot share the file name %s.", "Deux pages ne peuvent pas partager le nom de fichier %s."],
  errSlugEmpty: ["A page needs a file name.", "Une page a besoin d'un nom de fichier."],
  errSlugReserved: ["%s is a reserved name — pick another one.", "%s est un nom réservé — choisissez-en un autre."],
  errTextLong: ["A text field is longer than %s characters; it will be cut on export.", "Un champ de texte dépasse %s caractères ; il sera tronqué à l'export."],
  errBadJson: ["This file is not valid JSON.", "Ce fichier n'est pas du JSON valide."],
  errBadFormat: ["This is not a MURTHER FABRIQUE project file.", "Ce fichier n'est pas un projet MURTHER FABRIQUE."],
  errTooBig: ["File too large (%s). Limit is %s.", "Fichier trop volumineux (%s). La limite est de %s."],
  errNoBlock: ["Pick a section type first.", "Choisissez d'abord un type de section."],
  errLinkTarget: ["That link is not allowed — use http, https, mailto, tel, or an internal path.", "Ce lien n'est pas autorisé — utilisez http, https, mailto, tel, ou un chemin interne."],

  /* --- footer note --- */
  privacyNote: ["Nothing leaves this browser: no cookie, no CDN, no remote font, no analytics. Only your language, text size and the open project are stored on this device.", "Rien ne quitte ce navigateur : ni cookie, ni CDN, ni police distante, ni analytics. Seuls votre langue, votre taille de texte et le projet ouvert sont stockés sur cet appareil."]
};


export const PREF_KEY = "wgn.device";
const SCALES = ["1", "1.15", "1.3"];
const inBrowser = typeof document !== "undefined";

/** Active language. Restored from device prefs, else the browser's, else English. */
export const ui = {
  lang: "en",
  scale: "1"
};

/**
 * One half of a bilingual ["English", "Français"] row, as the current language
 * reads it, falling back to the first half when that one is empty.
 *
 * This expression used to be written out by hand in eleven places across the
 * editor, each one a place to forget. It is the same rule that decides a
 * dictionary entry, a block label, a field label, an option and a template
 * description, and a language bug only ever shows up in one of them.
 */
export const tr = (row) => (row ? row[ui.lang === "fr" ? 1 : 0] || row[0] || "" : "");

export const t = (k) => {
  const row = T[k];
  if (!row) return k; // an unknown key shows itself: louder than an empty label
  return tr(row);
};

/** Same, filling %s placeholders left to right. */
export const tf = (k, ...a) => {
  let i = 0;
  return t(k).replace(/%s/g, () => String(a[i++]));
};

/** Read a device preference. Private browsing can throw — never let it break boot. */
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

/**
 * Pick the initial language. The stored choice wins, then the browser's own
 * language if it is one we speak, then English. Nothing here ever looks at the
 * project: the site language is separate.
 */
function initialLang() {
  const saved = loadPrefs().lang;
  if (saved === "fr" || saved === "en") return saved;
  const nav = (navigator.language || "").toLowerCase();
  return nav.startsWith("fr") ? "fr" : "en";
}

function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ lang: ui.lang, scale: ui.scale }));
  } catch {
    /* storage blocked: the app still works, prefs just do not persist */
  }
}

/**
 * Repaint the interface. Only static copy is touched: text nodes, placeholders,
 * title/aria-label. Input VALUES are never written here — switching language
 * must not overwrite what the user typed.
 */
export function applyLang(root) {
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  document.documentElement.lang = ui.lang;
  document.title = t("docTitle");
  for (const el of scope.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of scope.querySelectorAll("[data-i18n-ph]")) el.placeholder = t(el.dataset.i18nPh);
  for (const el of scope.querySelectorAll("[data-i18n-title]")) el.setAttribute("aria-label", t(el.dataset.i18nTitle));
  if (inBrowser) document.dispatchEvent(new CustomEvent("wgn:lang"));
}

export function applyScale(scale, root) {
  ui.scale = SCALES.includes(scale) ? scale : "1";
  document.documentElement.style.fontSize = `${16 * parseFloat(ui.scale)}px`;
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  for (const o of scope.querySelectorAll("[data-i18n-scale]")) {
    o.textContent = t(`scale${Math.round(parseFloat(o.dataset.i18nScale) * 100)}`);
  }
  if (inBrowser) document.dispatchEvent(new CustomEvent("wgn:lang"));
  return ui.scale;
}

/** Called by the UI on boot and on every switch. */
export function setLang(code, root) {
  ui.lang = code === "fr" ? "fr" : "en";
  applyLang(root);
  savePrefs();
  return ui.lang;
}

/** Called by the UI on boot. Returns the restored prefs. */
export function initLang(root) {
  ui.lang = initialLang();
  applyScale(loadPrefs().scale || "1", root);
  applyLang(root);
  return ui;
}
