/**
 * FR / EN dictionary for the GENERATED SITE.
 *
 * Deliberately separate from `i18n.js`, which is the generator's own language.
 * This is what gets written into the exported HTML, in the language the site is
 * being built in. Switching the generator interface never touches it, and
 * switching the site language never touches the interface.
 *
 * Same tuple rule: [English, French], so a gap is structurally visible.
 */
export const S = {
  skip: ["Skip to content", "Aller au contenu"],
  nav: ["Main navigation", "Navigation principale"],
  home: ["Home", "Accueil"],
  readMore: ["Read the article", "Lire l'article"],
  publishedOn: ["Published", "Publié le"],
  replies: ["replies", "réponses"],
  by: ["by", "par"],
  pinned: ["Pinned", "Épinglé"],
  lastPost: ["Last post", "Dernier message"],
  topic: ["topics", "sujets"],
  buy: ["See this offer", "Voir cette offre"],
  contactTitle: ["Contact", "Contact"],
  formName: ["Your name", "Votre nom"],
  formEmail: ["Your email", "Votre email"],
  formSubject: ["Subject", "Objet"],
  formMessage: ["Message", "Message"],
  formSend: ["Send", "Envoyer"],
  formRequired: ["Required field", "Champ obligatoire"],
  formNote: [
    "This form is a static page: it has no server behind it. It opens your email client. To receive messages on a server, point the destination at a form service.",
    "Ce formulaire est une page statique : aucun serveur ne le traite. Il ouvre votre logiciel de messagerie. Pour recevoir les messages sur un serveur, pointez la destination vers un service de formulaire."
  ],
  formBadEmail: ["Please enter a valid email address.", "Veuillez saisir une adresse email valide."],
  formSent: ["Message ready — your email client should have opened.", "Message prêt — votre logiciel de messagerie devrait s'être ouvert."],
  notFoundTitle: ["Page not found", "Page introuvable"],
  notFoundBody: [
    "This address does not exist. Use the menu above to continue.",
    "Cette adresse n'existe pas. Utilisez le menu ci-dessus pour continuer."
  ],
  backHome: ["Back to the home page", "Retour à l'accueil"],
  themeToggle: ["Switch light / dark", "Basculer clair / sombre"],
  langLabel: ["Language", "Langue"],
  langSwitchToEn: ["Read in English", "Lire en anglais"],
  langSwitchToFr: ["Lire en français", "Read in French"],
  privacyTitle: ["Privacy", "Confidentialité"],
  privacyBody: [
    "This site is a static page. It sets no cookie and sends no data to any server or third party.\n\n## What is collected\nNothing. No analytics, no tag, no tracking pixel.\n\n## Hosting\nYour host keeps standard server logs (IP address, page requested, timestamp). That is outside the control of this page.\n\n## Images\nImages are stored with the site and are not sent to any third-party service.",
    "Ce site est une page statique. Il ne dépose aucun cookie et n'envoie aucune donnée à un serveur ou à un tiers.\n\n## Données collectées\nAucune. Pas d'analytics, pas de balise, pas de pixel de suivi.\n\n## Hébergement\nVotre hébergeur conserve les journaux serveur habituels (adresse IP, page demandée, horodatage). Cela échappe au contrôle de cette page.\n\n## Images\nLes images sont stockées avec le site et ne sont envoyées à aucun service tiers."
  ],
  legalTitle: ["Legal information", "Mentions légales"],
  legalBody: [
    "## Publisher\nCompany name: COMPANY\nAddress: ADDRESS\nEmail: EMAIL\n\n## Hosting\nHOST, HOSTING_ADDRESS\n\n## Credits\nSite built with MURTHER FABRIQUE.",
    "## Éditeur\nRaison sociale : COMPANY\nAdresse : ADDRESS\nEmail : EMAIL\n\n## Hébergement\nHOST, HOSTING_ADDRESS\n\n## Crédits\nSite réalisé avec MURTHER FABRIQUE."
  ],
  copyright: ["All rights reserved", "Tous droits réservés"]
};

/** Look up a site string in the target language, falling back to English. */
export const st = (key, lang) => (S[key] ? S[key][lang === "fr" ? 1 : 0] || S[key][0] : key);

/** Substitute COMPANY / ADDRESS / … in a legal body. */
/**
 * Substitute the document's own values into a dictionary body.
 *
 * This function does not escape: the caller wraps the result in esc() exactly
 * once, and escaping here as well turned "Tom & Jerry Ltd" into
 * "Tom &amp;amp; Jerry Ltd" on the exported legal page — the user reading their
 * own site saw the entities spelled out.
 */
export function fillLegal(body, doc, lang = doc?.meta?.lang) {
  // Company, address and email are documented as plain strings, but eight of
  // the nine templates leave company unset and fall through to doc.name, which
  // is {en, fr}. String() on that object printed the literal "[object Object]"
  // in the Publisher section of every legal page.
  const text = (v) =>
    v == null ? "" : typeof v === "string" ? v : v[lang] || v.en || v.fr || "";
  const map = {
    COMPANY: text(doc.company) || text(doc.name) || "-",
    ADDRESS: text(doc.address) || "-",
    EMAIL: text(doc.email) || "-",
    HOST: text(doc.host) || (lang === "fr" ? "votre hébergeur" : "your host"),
    HOSTING_ADDRESS: text(doc.hostingAddress) || "-"
  };
  return body.replace(/\b(COMPANY|ADDRESS|EMAIL|HOST|HOSTING_ADDRESS)\b/g, (m) => map[m] ?? m);
}