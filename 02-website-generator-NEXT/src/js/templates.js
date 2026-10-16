/**
 * Templates: nine starting points, one per family the generator targets.
 *
 * A template is just a document. There is no template engine, no inheritance
 * and no partials — adding a tenth is writing one `doc` and one line in
 * `TEMPLATES`, which is the whole point of keeping blocks in a registry.
 *
 * Each one is a different KIND of page, not a different colour: a CV you scan
 * in twenty seconds, a blog you read in twenty minutes, a game that opens
 * cinematic, a store that shows the product first. The visual half of that —
 * background, ink, accent, chip colour, corner radius — lives in `presets.js`;
 * this file is the content that fills the shell.
 *
 * Text is bilingual from the start (see `bi`), but `meta.bilingual` is off, so
 * a single-language user never sees a duplicated field. Turning it on in the
 * settings panel is what reveals the second language everywhere at once.
 */
import { blankDoc, newPage } from "./store.js";
import { bi, makeBlock } from "./blocks.js";
import { uid } from "./safe.js";
import { themeOf } from "./presets.js";

const page = (slug, title, menu, blocks, extra = {}) => ({
  id: uid("p"),
  slug,
  title: bi(title.en, title.fr),
  menu: bi(menu.en, menu.fr),
  desc: bi(extra.desc?.en || "", extra.desc?.fr || ""),
  inMenu: extra.inMenu !== false,
  blocks: blocks.map(([type, fields]) => ({ ...makeBlock(type), ...fields }))
});

/** Clone the shared skeleton, then let a template replace only what it cares about. */
const doc = (over) => ({ ...blankDoc(), ...over });

export const TEMPLATES = {
  /* 1 — Basic page. Stays genuinely empty: the point of it is a blank sheet
     with the right paper and the right green already chosen. */
  blank: {
    key: "blank",
    label: ["Basic page", "Page simple"],
    desc: ["One empty page, with the design already set.", "Une page vide, le design déjà réglé."],
    build: () => doc({ theme: themeOf("basic") })
  },

  /* 2 — Portfolio. The work is the centre of gravity: a large hero, then a
     gallery of projects, then who made them and how to reach them. */
  portfolio: {
    key: "portfolio",
    label: ["Portfolio", "Portfolio"],
    desc: ["The work first, then the person, then how to reach them.", "Les projets d'abord, puis la personne, puis le contact."],
    build: () =>
      doc({
        name: bi("Iris Faye — Illustration", "Iris Faye — Illustration"),
        description: bi("Editorial illustration and character design, for publishers and studios.", "Illustration éditoriale et design de personnages, pour éditeurs et studios."),
        theme: themeOf("portfolio", { tone: "serif" }),
        jsonLdType: "Person",
        pages: [
          page("index", { en: "Home", fr: "Accueil" }, { en: "Work", fr: "Réalisations" }, [
            ["hero", {
              eyebrow: bi("Portfolio", "Portfolio"),
              title: bi("Illustration that carries a story", "Une illustration qui porte un récit"),
              lead: bi("Editorial work for publishers, magazines and studios. Drawn by hand, finished digitally.", "Travail éditorial pour éditeurs, magazines et studios. Dessiné à la main, fini en numérique."),
              ctaLabel: bi("See the work", "Voir les réalisations"),
              ctaHref: "index.html#gallery",
              image: { assetId: "", alt: bi("", "") }
            }],
            ["gallery", {
              title: bi("Selected work", "Travaux sélectionnés"),
              items: [
                { image: { assetId: "", alt: bi("", "") }, caption: bi("Cover — quarterly magazine", "Couverture — magazine trimestriel") },
                { image: { assetId: "", alt: bi("", "") }, caption: bi("Chapter opening — literary novel", "Ouverture de chapitre — roman littéraire") },
                { image: { assetId: "", alt: bi("", "") }, caption: bi("Character sheet — animation pitch", "Character sheet — pitch d'animation") },
                { image: { assetId: "", alt: bi("", "") }, caption: bi("Poster series — theatre season", "Série d'affiches — saison théâtrale") },
                { image: { assetId: "", alt: bi("", "") }, caption: bi("Spot illustration — essay collection", "Illustration — recueil d'essais") },
                { image: { assetId: "", alt: bi("", "") }, caption: bi("Cover — children's non-fiction", "Couverture — non-fiction jeunesse") }
              ]
            }],
            ["features", {
              title: bi("What I can do", "Ce que je fais"),
              lead: bi("Three ways an editorial team usually needs me.", "Trois façons dont une équipe éditoriale a besoin de moi."),
              items: [
                { title: bi("Cover and interior art", "Couvertures et illustrations intérieures"), body: bi("A long series drawn to one reference sheet, so a book looks like itself on page one and page two hundred.", "Une longue série dessinée sur une planche de référence, pour qu'un livre se ressemble de la première à la deux centième page.") },
                { title: bi("Character work", "Travail de personnages"), body: bi("Turnaround sheets, expressions and poses, delivered in a format your animator can work from directly.", "Planches de recherche, expressions et poses, livrées dans un format exploitable directement par votre animateur.") },
                { title: bi("Spot and editorial illustration", "Illustration d Stewardship"), body: bi("One image for one idea, sized and cropped for the grid it will live in.", "Une image pour une idée, dimensionnée et cadrée pour la grille qui l'accueillera.") }
              ]
            }]
          ]),
          page("about", { en: "About", fr: "À propos" }, { en: "About", fr: "À propos" }, [
            ["text", {
              title: bi("About", "À propos"),
              body: bi("## Ten years of drawing\nI studied graphic design, spent six years in publishing, and now work mostly with small editorial teams who need art that carries meaning rather than decoration.\n\n## How I work\n1. A conversation about the text\n2. Two or three rough directions\n3. One finished piece, revised twice", "## Dix ans de dessin\nJ'ai étudié le design graphique, passé six ans dans l'édition, et je travaille aujourd'hui surtout avec de petites équipes éditoriales qui ont besoin d'une image qui porte du sens plutôt que de la décoration.\n\n## Ma méthode\n1. Une conversation sur le texte\n2. Deux ou trois directions\n3. Une pièce finie, deux révisions")
            }],
            ["stats", {
              title: bi("", ""),
              items: [
                { value: "10", label: bi("years drawing", "ans de dessin") },
                { value: "40+", label: bi("published covers", "couvertures publiées") },
                { value: "2", label: bi("revisions included", "révisions incluses") }
              ]
            }]
          ]),
          page("contact", { en: "Contact", fr: "Contact" }, { en: "Contact", fr: "Contact" }, [
            ["contact", {
              title: bi("Get in touch", "Nous contacter"),
              intro: bi("Describe the project in a few lines. I reply within two working days.", "Décrivez le projet en quelques lignes. Je réponds sous deux jours ouvrés."),
              action: "mailto:hello@example.com"
            }]
          ])
        ]
      })
  },

  cv: {
    key: "cv",
    label: ["CV / Résumé", "CV"],
    desc: ["Experience, skills, education, timeline.", "Expérience, compétences, formation, parcours."],
    build: () =>
      doc({
        name: bi("Jordan Blake", "Jordan Blake"),
        description: bi("Curriculum vitae — experience, skills and education.", "Curriculum vitae — expérience, compétences et formation."),
        theme: themeOf("cv", { scheme: "light" }),
        jsonLdType: "Person",
        pages: [
          page("index", { en: "CV", fr: "CV" }, { en: "CV", fr: "CV" }, [
            ["hero", {
              eyebrow: bi("Curriculum vitae", "Curriculum vitae"),
              title: bi("Jordan Blake", "Jordan Blake"),
              lead: bi("Product designer, 8 years. Based in Lyon, available for contract work.", "Designer produit, 8 ans. Basé à Lyon, disponible en mission."),
              image: { assetId: "", alt: bi("", "") }
            }],
            ["table", {
              title: bi("Experience", "Expérience"),
              items: [
                { label: bi("2022 — today, Senior Product Designer", "2022 — aujourd'hui, Senior Product Designer"), value: bi("Led the design of a B2B analytics tool used by 40 teams. Introduced a component library that cut interface build time by half.", "Direction du design d'un outil d'analyse B2B utilisé par 40 équipes. Mise en place d'une bibliothèque de composants qui a réduit de moitié le temps de développement d'interface.") },
                { label: bi("2020 — 2022, Product Designer", "2020 — 2022, Product Designer"), value: bi("Designed and shipped the mobile onboarding flow. Accessibility audit and remediation of the whole app.", "Conception et livraison du parcours d'inscription mobile. Audit d'accessibilité et mise en conformité de l'application.") },
                { label: bi("2018 — 2020, UI Designer", "2018 — 2020, UI Designer"), value: bi("Marketing sites and brand materials for clients in retail and finance.", "Sites marketing et supports de marque pour des clients retail et finance.") }
              ]
            }],
            ["table", {
              title: bi("Skills", "Compétences"),
              items: [
                { label: bi("Design", "Design"), value: bi("Interface design, design systems, accessibility, prototyping.", "Design d'interface, design systems, accessibilité, prototypage.") },
                { label: bi("Development", "Développement"), value: bi("HTML, CSS, modern JavaScript, Git.", "HTML, CSS, JavaScript moderne, Git.") },
                { label: bi("Research", "Recherche"), value: bi("User interviews, usability testing, synthesis.", "Entretiens utilisateurs, tests d'utilisabilité, synthèse.") },
                { label: bi("Languages", "Langues"), value: bi("French (native), English (professional), Spanish (conversational).", "Français (langue maternelle), anglais (professionnel), espagnol (courant).") }
              ]
            }],
            ["table", {
              title: bi("Education", "Formation"),
              items: [
                { label: bi("2016 — 2018, Master, Interaction Design", "2016 — 2018, Master, Design d'interaction"), value: bi("Graduated with honours.", "Diplômé avec mention.") },
                { label: bi("2013 — 2016, Bachelor, Graphic Design", "2013 — 2016, Licence, Design graphique"), value: bi("", "") }
              ]
            }],
            ["features", {
              title: bi("Selected work", "Projets notables"),
              lead: bi("Three things I would show you first.", "Trois projets que je montrerais en premier."),
              items: [
                { title: bi("Component library adoption", "Adoption d'une bibliothèque de composants"), body: bi("Took interface build time from six days to three across a team of nine.", "Temps de construction d'une interface réduit de six jours à trois, pour une équipe de neuf personnes.") },
                { title: bi("Accessibility remediation", "Mise en conformité d'accessibilité"), body: bi("Took a mobile app from 41 audit findings to zero, without a redesign.", "Une application mobile passée de 41 points d'audit à zéro, sans refonte.") },
                { title: bi("Onboarding redesign", "Refonte du parcours d'inscription"), body: bi("Cut drop-off at the verification step by a third.", "Réduction d'un tiers de l'abandon à l'étape de vérification.") }
              ]
            }],
            ["links", {
              title: bi("Elsewhere", "Ailleurs"),
              items: [
                { label: bi("Email", "Email"), url: "mailto:hello@example.com", note: bi("Best for anything specific", "Idéal pour toute demande précise") },
                { label: bi("Portfolio", "Portfolio"), url: "#", note: bi("Case studies with process", "Études de cas avec processus") },
                { label: bi("LinkedIn", "LinkedIn"), url: "#", note: bi("Full history", "Parcours complet") },
                { label: bi("GitHub", "GitHub"), url: "#", note: bi("Small tools and experiments", "Petits outils et expérimentations") }
              ],
              effect: "soft"
            }],
            ["cta", {
              title: bi("Available for contract work", "Disponible en mission"),
              body: bi("Back from March. Happy to talk about scope before anything is signed.", "Disponible à partir de mars. Discutons du périmètre avant toute signature."),
              label: bi("Get in touch", "Me contacter"),
              href: "mailto:hello@example.com"
            }],
            ["timeline", {
              title: bi("Where I have been", "O\u00f9 j'ai \u00e9t\u00e9"),
              items: [
                { when: bi("2022 \u2014 now", "2022 \u2014 aujourd'hui"), title: bi("Independent, interface work", "Ind\u00e9pendante, design d'interface"), org: bi("For studios and product teams", "Pour des studios et des \u00e9quipes produit"), body: bi("Design systems, redesigns, and the accessibility work that comes after the launch.", "Design systems, refontes, et le travail d'accessibilit\u00e9 qui suit le lancement.") },
                { when: bi("2019 \u2014 2022", "2019 \u2014 2022"), title: bi("Senior designer", "Designer principale"), org: bi("Verdan Systems", "Verdan Systems"), body: bi("Owned the component library used by six product teams.", "Responsable de la biblioth\u00e8que de composants utilis\u00e9e par six \u00e9quipes produit.") },
                { when: bi("2017 \u2014 2019", "2017 \u2014 2019"), title: bi("Designer", "Designer"), org: bi("Northlight", "Northlight"), body: bi("Editorial sites, then the first taste of design systems.", "Sites \u00e9ditoriaux, puis le premier go\u00fbt d'un design system.") }
              ]
            }],
            ["skills", {
              title: bi("What I am good at", "Ce que je sais faire"),
              showBar: true,
              items: [
                { name: bi("Interface design", "Design d'interface"), level: "expert" },
                { name: bi("Design systems", "Design systems"), level: "advanced" },
                { name: bi("Accessibility (WCAG)", "Accessibilit\u00e9 (WCAG)"), level: "advanced" },
                { name: bi("French / English", "Fran\u00e7ais / Anglais"), level: "expert" }
              ]
            }],
            /* Before this block, a CV was a table. Now it is a quote with a name. */
            ["testimonial", {
              title: bi("", ""),
              quote: bi("Miyabo took a mess of requirements and handed back something we shipped without a single rework ticket.",
                "Miyabo a transformé un cahier des charges flou en un produit que nous avons livré sans une seule demande de retouche."),
              author: bi("Alex N.", "Alex N."),
              role: bi("Product lead, Verdan Systems", "Responsable produit, Verdan Systems"),
              avatar: { assetId: "", alt: bi("", "") },
              effect: "shadow"
            }]
          ])
        ]
      })
  },

  business: {
    key: "business",
    label: ["Business site", "Site d'entreprise"],
    desc: ["Services, team, legal pages, SEO.", "Services, équipe, pages légales, référencement."],
    build: () =>
      doc({
        name: bi("Atelier Lumen", "Atelier Lumen"),
        description: bi("Independent studio for design, build and maintenance of digital products.", "Studio indépendant de design, de réalisation et de maintenance de produits numériques."),
        baseUrl: "https://example.com",
        theme: themeOf("business"),
        company: "Atelier Lumen Ltd.",
        email: "hello@example.com",
        pages: [
          page("index", { en: "Home", fr: "Accueil" }, { en: "Services", fr: "Services" }, [
            ["hero", {
              eyebrow: bi("Independent studio", "Studio indépendant"),
              title: bi("Products built to last, not to impress", "Des produits faits pour durer, pas pour impressionner"),
              lead: bi("Six people. No middleman. Small digital products, designed and maintained by the same team.", "Six personnes. Aucun intermédiaire. De petits produits numériques, conçus et maintenus par la même équipe."),
              ctaLabel: bi("Write to the studio", "Écrire au studio"),
              ctaHref: "contact.html",
              image: { assetId: "", alt: bi("", "") }
            }],
            ["features", {
              title: bi("What we do", "Ce que nous faisons"),
              lead: bi("Three things, done properly.", "Trois choses, bien faites."),
              items: [
                { title: bi("Product design", "Design produit"), body: bi("From a rough idea to a screen you can put in front of users.", "D'une idée floue à un écran présentable devant des utilisateurs.") },
                { title: bi("Build", "Réalisation"), body: bi("HTML, CSS and modern JavaScript. No framework you have to maintain.", "HTML, CSS et JavaScript moderne. Aucun framework à maintenir.") },
                { title: bi("Maintenance", "Maintenance"), body: bi("Fixes, accessibility work, content updates. Nothing else.", "Corrections, accessibilité, mise à jour de contenu. Rien d'autre.") }
              ]
            }],
            ["stats", {
              title: bi("", ""),
              items: [
                { value: "6", label: bi("people", "personnes") },
                { value: "40+", label: bi("projects shipped", "projets livrés") },
                { value: "9", label: bi("years", "ans") }
              ]
            }],
            ["faq", {
              title: bi("Frequently asked questions", "Questions fréquentes"),
              items: [
                { q: bi("How much does a project cost?", "Combien coûte un projet ?"), a: bi("Most projects land between €8k and €40k. You get a fixed quote after the first call.", "La plupart des projets se situent entre 8 000 € et 40 000 €. Vous recevez un devis ferme après le premier échange.") },
                { q: bi("Do you work with existing codebases?", "Travaillez-vous avec du code existant ?"), a: bi("Yes. An audit comes first, then a plan. No rewrite without an explicit reason.", "Oui. Un audit d'abord, puis un plan. Aucune réécriture sans raison explicite.") },
                { q: bi("How long does a project take?", "Combien de temps dure un projet ?"), a: bi("Six to twelve weeks for most builds. We tell you the realistic range on the first call, not the optimistic one.", "Six à douze semaines pour la plupart. Nous annonçons la fourchette réaliste dès le premier échange, pas la version optimiste.") },
                { q: bi("Who owns the result?", "Qui détient le résultat ?"), a: bi("You do, in full, including the source files. We keep nothing back as leverage.", "Vous, intégralement, fichiers sources compris. Nous ne retenons rien en otage.") }
              ]
            }],
            ["gallery", {
              title: bi("Case studies", "Études de cas"),
              items: [
                { image: { assetId: "", alt: bi("Booking flow rebuilt around availability rather than inventory", "Parcours de réservation reconstruit autour des disponibilités plutôt que du stock") }, caption: bi("Rebuilt a booking flow around availability", "Parcours de réservation reconstruit autour des disponibilités") },
                { image: { assetId: "", alt: bi("Design system rollout across nine product teams", "Déploiement d'un design system auprès de neuf équipes produit") }, caption: bi("Rolled out a design system to nine teams", "Déploiement d'un design system auprès de neuf équipes") },
                { image: { assetId: "", alt: bi("Accessibility remediation of a checkout process", "Mise en conformité d'accessibilité d'un parcours de paiement") }, caption: bi("Took a checkout process to WCAG AA", "Parcours de paiement rendu conforme WCAG AA") }
              ]
            }]
          ]),
          page("about", { en: "About", fr: "À propos" }, { en: "About", fr: "À propos" }, [
            ["text", {
              title: bi("The studio", "Le studio"),
              body: bi("## Method\n1. Listen\n2. Write\n3. Draw\n4. Ship\n\nWe work in small teams and finish what we start. If a project needs six months, we say so on the first call.", "## Méthode\n1. Écouter\n2. Écrire\n3. Dessiner\n4. Livrer\n\nNous travaillons en petites équipes et terminons ce que nous commençons. Si un projet demande six mois, nous le disons dès le premier échange.")
            }],
            ["stats", {
              title: bi("The studio in numbers", "Le studio en chiffres"),
              items: [
                { value: bi("9", "9"), label: bi("people, no subcontractors", "personnes, sans sous-traitance") },
                { value: bi("120+", "120+"), label: bi("projects delivered", "projets livrés") },
                { value: bi("6 weeks", "6 semaines"), label: bi("median project length", "durée médiane d'un projet") },
                { value: bi("81%", "81 %"), label: bi("of work from referrals", "du travail par recommandation") }
              ]
            }],
            ["steps", {
              title: bi("How a project runs", "Comment se déroule un projet"),
              items: [
                { title: bi("A call, not a pitch", "Un échange, pas un discours"), body: bi("Thirty minutes. You describe the problem, I ask what already failed.", "Trente minutes. Vous décrivez le problème, je demande ce qui a déjà échoué.") },
                { title: bi("A written scope", "Un périmètre écrit"), body: bi("What is in, what is out, what it costs. Fixed before any code.", "Ce qui est inclus, exclu, et son coût. Fixé avant toute ligne de code.") },
                { title: bi("Fortnightly builds", "Des versions tous les quinze jours"), body: bi("You see the real thing every two weeks, not a slide about it.", "Vous voyez le produit réel tous les quinze jours, pas une diapositive.") }
              ]
            }],
            ["logos", {
              title: bi("Recent clients", "Clients récents"),
              items: [
                { name: bi("Verdan Systems", "Verdan Systems"), image: { assetId: "", alt: bi("", "") } },
                { name: bi("Halcyon Press", "Halcyon Press"), image: { assetId: "", alt: bi("", "") } },
                { name: bi("Northlight", "Northlight"), image: { assetId: "", alt: bi("", "") } },
                { name: bi("Corvid Labs", "Corvid Labs"), image: { assetId: "", alt: bi("", "") } }
              ],
              effect: "soft"
            }]
          ]),
          page("contact", { en: "Contact", fr: "Contact" }, { en: "Contact", fr: "Contact" }, [
            ["contact", {
              title: bi("Describe your project", "Décrivez votre projet"),
              intro: bi("A few lines are enough to start.", "Quelques lignes suffisent pour commencer."),
              action: "mailto:hello@example.com"
            }]
          ])
        ]
      })
  },

  blog: {
    key: "blog",
    label: ["Blog", "Blog"],
    desc: ["Post list, article pages, archive.", "Liste d'articles, pages d'article, archives."],
    build: () =>
      doc({
        name: bi("Field Notes", "Carnet de terrain"),
        description: bi("Long-form writing on craft, tools and process.", "Écrits longs sur le métier, les outils et le processus."),
        baseUrl: "https://example.com",
        theme: themeOf("blog", { tone: "serif" }),
        pages: [
          page("index", { en: "Articles", fr: "Articles" }, { en: "Articles", fr: "Articles" }, [
            ["hero", {
              eyebrow: bi("Field Notes", "Carnet de terrain"),
              title: bi("Writing about craft", "Écrire sur le métier"),
              lead: bi("Long pieces on tools, process, and the parts of the job nobody teaches you.", "De longs textes sur les outils, le processus, et ce qu'on ne vous apprend pas."),
              ctaLabel: bi("", ""),
              ctaHref: ""
            }],
            ["posts", {
              title: bi("Latest", "Derniers articles"),
              lead: bi("Six pieces this year. Each one stands on its own.", "Six textes cette année. Chacun se suffit à lui-même."),
              items: [
                { title: bi("The cost of a design system nobody uses", "Le coût d'un design system que personne n'utilise"), date: "2026-03-18", excerpt: bi("A system is not an asset until people adopt it. Here is how we measure that.", "Un système n'est un actif que si on l'adopte. Voici comment le mesurer."), href: "" },
                { title: bi("Writing CSS that survives its author", "Écrire du CSS qui survit à son auteur"), date: "2026-02-04", excerpt: bi("Naming, layers and the two rules that stop most cascade fights.", "Nommage, cascade, et les deux règles qui règlent la plupart des conflits."), href: "" },
                { title: bi("Accessibility is a maintenance cost, not a feature", "L'accessibilité est un coût de maintenance, pas une fonctionnalité"), date: "2026-01-11", excerpt: bi("Fixing it once is cheap. Fixing it every year is a design decision.", "Le corriger une fois coûte peu. Le corriger chaque année est une décision de design."), href: "" },
                { title: bi("What a design review is actually for", "À quoi sert vraiment une revue de design"), date: "2025-11-27", excerpt: bi("Less presentation, more diagnosis. The questions that change the work.", "Moins de présentation, plus de diagnostic. Les questions qui changent le travail."), href: "" },
                { title: bi("The two-week prototype", "Le prototype en deux semaines"), date: "2025-10-09", excerpt: bi("A schedule you can actually keep, and the three questions it forces you to answer.", "Un calendrier tenable, et les trois questions qu'il vous oblige à trancher."), href: "" },
                { title: bi("Notes on naming things", "Notes sur le nommage"), date: "2025-08-22", excerpt: bi("Why the boring names are the ones that hold up in year three.", "Pourquoi les noms ennuyeux sont ceux qui tiennent au bout de trois ans."), href: "" }
              ]
            }],
            ["text", {
              title: bi("Featured: the cost of a design system nobody uses", "À la une : le coût d'un design system inemployé"),
              body: bi("A design system is an asset the moment people adopt it, and a liability the moment after. The difference is almost never the documentation.\n\n## Adoption is the only metric\nWe spent a quarter measuring things that felt like progress — coverage, component count, lint rules passing — and none of them moved the number that mattered. The number that mattered was how many screens shipped with a component from the library instead of a fresh div.\n\n## Start where it hurts\nThe first version should not be a design system. It should be the four patterns your team rewrites most often, extracted once, agreed on, and used. Everything else can wait for evidence.", "Un design system est un actif dès que l'on l'adopte, et un passif juste après. La différence vient rarement de la documentation.\n\n## L'adoption est la seule métrique\nNous avons passé un trimestre à mesurer ce qui semblait être du progrès — couverture, nombre de composants, règles de lint — sans qu'aucune ne bouge le seul chiffre qui comptait : le nombre d'écrans livrés avec un composant de la bibliothèque plutôt qu'une div neuve.\n\n## Commencez là où ça fait mal\nLa première version ne doit pas être un design system. Ce sont les quatre motifs que votre équipe réécrit le plus souvent, extraits une fois, validés, utilisés. Tout le reste attendra des preuves.")
            }],
            ["links", {
              title: bi("Browse by topic", "Parcourir par thème"),
              items: [
                { label: bi("Design systems", "Design systems"), url: "#", note: bi("9 pieces", "9 textes") },
                { label: bi("Front-end", "Front-end"), url: "#", note: bi("14 pieces", "14 textes") },
                { label: bi("Accessibility", "Accessibilité"), url: "#", note: bi("7 pieces", "7 textes") },
                { label: bi("Process", "Processus"), url: "#", note: bi("11 pieces", "11 textes") }
              ]
            }],
            ["cta", {
              title: bi("One long letter, every few weeks", "Une longue lettre, toutes les quelques semaines"),
              body: bi("No tracking, no feed to check. Unsubscribe in one click.", "Pas de suivi, pas de flux à surveiller. Désabonnement en un clic."),
              label: bi("Subscribe", "S'abonner"),
              href: "mailto:hello@example.com"
            }]
          ]),
          page("archive", { en: "Archive", fr: "Archives" }, { en: "Archive", fr: "Archives" }, [
            ["table", {
              title: bi("Everything so far", "Tout jusqu'ici"),
              items: [
                { label: bi("2026-03-18", "2026-03-18"), value: bi("The cost of a design system nobody uses", "Le coût d'un design system que personne n'utilise") },
                { label: bi("2026-02-04", "2026-02-04"), value: bi("Writing CSS that survives its author", "Écrire du CSS qui survit à son auteur") },
                { label: bi("2026-01-11", "2026-01-11"), value: bi("Accessibility is a maintenance cost", "L'accessibilité est un coût de maintenance") }
              ]
            }]
          ])
        ]
      })
  },

  forum: {
    key: "forum",
    label: ["Forum / Community", "Forum / Communauté"],
    desc: ["Boards, thread list, pinned posts.", "Catégories, liste de sujets, épingles."],
    build: () =>
      doc({
        name: bi("The Workshop", "L'Atelier"),
        description: bi("A community for people who build things by hand.", "Une communauté pour celles et ceux qui construisent à la main."),
        baseUrl: "https://example.com",
        theme: themeOf("community"),
        pages: [
          page("index", { en: "Boards", fr: "Catégories" }, { en: "Boards", fr: "Catégories" }, [
            ["hero", {
              eyebrow: bi("Community", "Communauté"),
              title: bi("Ask, answer, share what you built", "Demandez, répondez, partagez ce que vous avez construit"),
              lead: bi("This page is static. Real accounts, posting and moderation need a server — see the README.", "Cette page est statique. Comptes, publications et modération nécessitent un serveur — voir le README."),
              ctaLabel: bi("Browse the topics", "Parcourir les sujets"),
              ctaHref: "index.html#topics"
            }],
            ["threads", {
              title: bi("Latest topics", "Derniers sujets"),
              items: [
                { title: bi("How do you version your design tokens?", "Comment versionnez-vous vos tokens de design ?"), author: "mara", replies: 24, date: "2026-04-02", tags: bi("design, workflow", "design, processus"), pinned: true },
                { title: bi("Small tool, big difference: what is yours?", "Petit outil, grande différence : le vôtre ?"), author: "tobias", replies: 41, date: "2026-03-29", tags: bi("tools", "outils"), pinned: false },
                { title: bi("Reading list for interface engineering", "Liste de lecture pour l'ingénierie d'interface"), author: "ines", replies: 9, date: "2026-03-21", tags: bi("resources", "ressources"), pinned: false },
                { title: bi("Accessibility check before launch", "Vérification d'accessibilité avant mise en ligne"), author: "karl", replies: 15, date: "2026-03-15", tags: bi("accessibility", "accessibilité"), pinned: false },
                { title: bi("Show us your local-first setup", "Montrez-nous votre montage local-first"), author: "june", replies: 33, date: "2026-03-08", tags: bi("tools, workflow", "outils, processus"), pinned: false },
                { title: bi("What broke when you added a second language?", "Qu'est-ce qui a cassé à la deuxième langue ?"), author: "omar", replies: 18, date: "2026-02-27", tags: bi("i18n", "i18n"), pinned: false }
              ]
            }],
            ["table", {
              title: bi("Boards", "Catégories"),
              items: [
                { label: bi("Announcements", "Annonces"), value: bi("142 topics", "142 sujets") },
                { label: bi("Help & troubleshooting", "Aide & dépannage"), value: bi("1,208 topics", "1 208 sujets") },
                { label: bi("Show & tell", "Vos réalisations"), value: bi("486 topics", "486 sujets") },
                { label: bi("Critique", "Critique"), value: bi("233 topics", "233 sujets") },
                { label: bi("Jobs & collaborations", "Offres & collaborations"), value: bi("97 topics", "97 sujets") },
                { label: bi("Off-topic", "Hors sujet"), value: bi("311 topics", "311 sujets") }
              ]
            }],
            ["faq", {
              title: bi("Before you post", "Avant de publier"),
              items: [
                { q: bi("Can I post a link?", "Puis-je publier un lien ?"), a: bi("Yes, if you say what it is and why it belongs here. A bare link is usually a new topic with a title missing.", "Oui, si vous dites ce que c'est et pourquoi ça appartient ici. Un lien seul est presque toujours un nouveau sujet dont il manque le titre.") },
                { q: bi("Why was my topic moved?", "Pourquoi mon sujet a-t-il été déplacé ?"), a: bi("It matched an existing board better. A moderator will usually leave a note saying where it went and why.", "Il correspondait mieux à une catégorie existante. Un modérateur laisse généralement une note indiquant où et pourquoi.") },
                { q: bi("How do I report something?", "Comment signaler quelque chose ?"), a: bi("Use the report link under any post. Reports are private and go to the moderation team only.", "Utilisez le lien de signalement sous chaque message. Les signalements sont privés et vont uniquement à l'équipe de modération.") },
                { q: bi("Do I need an account?", "Ai-je besoin d'un compte ?"), a: bi("On this demo page, no — it is a static sample. A real forum needs accounts, which need a server. See the README.", "Sur cette page de démonstration, non — c'est un exemple statique. Un vrai forum exige des comptes, donc un serveur. Voir le README.") }
              ]
            }],
            ["cta", {
              title: bi("Start a discussion", "Lancer une discussion"),
              body: bi("A good title is a question someone else would type into the search box.", "Un bon titre est une question que quelqu'un d'autre taperait dans la recherche."),
              label: bi("New discussion", "Nouveau sujet"),
              href: "mailto:hello@example.com?subject=New%20discussion"
            }]
          ]),
          page("rules", { en: "Rules", fr: "Règles" }, { en: "Rules", fr: "Règles" }, [
            ["text", {
              title: bi("House rules", "Règles de la maison"),
              body: bi("1. Be useful or be quiet.\n2. Show the work, not just the advice.\n3. No promotion without a reason.\n4. Disagree with the idea, never with the person.", "1. Soyez utile ou taisez-vous.\n2. Montrez le travail, pas seulement le conseil.\n3. Pas de promotion sans raison.\n4. Désaccordez-vous de l'idée, jamais de la personne.")
            }]
          ])
        ]
      })
  },

  game: {
    key: "game",
    label: ["Video game site", "Site de jeu vidéo"],
    desc: ["Hero art, news, features, wishlist.", "Illustration, actualités, fonctionnalités, wishlist."],
    build: () =>
      doc({
        name: bi("Hollow Signal", "Hollow Signal"),
        description: bi("Hollow Signal — a narrative exploration game. Coming 2027.", "Hollow Signal — un jeu d'exploration narrative. Sortie 2027."),
        baseUrl: "https://example.com",
        theme: themeOf("game", { scheme: "dark" }),
        pages: [
          page("index", { en: "Home", fr: "Accueil" }, { en: "Home", fr: "Accueil" }, [
            ["hero", {
              eyebrow: bi("Narrative exploration", "Exploration narrative"),
              title: bi("Hollow Signal", "Hollow Signal"),
              lead: bi("A derelict relay station, one transmission still repeating, and the decision to answer it. No combat, no timer, no wrong ending.", "Une station relais désaffectée, une transmission qui se répète encore, et la décision d'y répondre. Pas de combat, pas de chronomètre, pas de mauvaise fin."),
              ctaLabel: bi("Add to wishlist", "Ajouter à la liste"),
              ctaHref: "links.html",
              image: { assetId: "", alt: bi("Screenshot of the relay station interior", "Capture d'écran de l'intérieur de la station relais") }
            }],
            ["links", {
              title: bi("Get it here", "Disponible ici"),
              items: [
                { label: bi("Steam", "Steam"), url: "#", note: bi("Coming 2027", "Sortie 2027") },
                { label: bi("itch.io", "itch.io"), url: "#", note: bi("Demo playable", "Démo jouable") },
                { label: bi("Newsletter", "Infolettre"), url: "#", note: bi("Occasional updates", "Actualités occasionnelles") }
              ]
            }],
            ["features", {
              title: bi("The game", "Le jeu"),
              lead: bi("Three promises, kept exactly.", "Trois promesses, tenues exactement."),
              items: [
                { title: bi("No combat", "Pas de combat"), body: bi("You move, you listen, you decide. Conflict is in the wording, never in your hands.", "Vous avancez, vous écoutez, vous décidez. Le conflit est dans les mots, jamais dans vos mains.") },
                { title: bi("No timer", "Pas de chronomètre"), body: bi("Take as long as the story needs. The station has been repeating for thirty years.", "Prenez le temps qu'il faut. La station répète depuis trente ans.") },
                { title: bi("Every ending is valid", "Toutes les fins sont valides"), body: bi("Nothing is lost by choosing wrong, and the game never tells you which choice was wrong.", "Rien n'est perdu par un mauvais choix, et le jeu ne vous dit jamais lequel l'était.") },
                { title: bi("One sitting", "Une seule session"), body: bi("Around six hours. There is a chapter select if you want to come back to one moment.", "Environ six heures. Un sélecteur de chapitre si vous voulez revenir à un moment.") },
                { title: bi("Fully voiced", "Entièrement doblé"), body: bi("Recorded in English and French, with optional subtitles in both.", "Enregistré en anglais et en français, sous-titres optionnels dans les deux langues.") },
                { title: bi("No microtransactions", "Aucune microtransaction"), body: bi("One price, one edition, everything included at launch.", "Un prix, une édition, tout inclus au lancement.") }
              ]
            }],
            ["gallery", {
              title: bi("Screenshots", "Captures d'écran"),
              items: [
                { image: { assetId: "", alt: bi("The transmitter hall, lights failing in sequence", "La salle de l'émetteur, les lumières qui tombent en séquence") }, caption: bi("The transmitter hall", "La salle de l'émetteur") },
                { image: { assetId: "", alt: bi("A corridor of frozen consoles behind sealed doors", "Un couloir de consoles gelées derrière des portes scellées") }, caption: bi("Crew corridor", "Couloir d'équipage") },
                { image: { assetId: "", alt: bi("The observation window looking out at nothing", "La baie d'observation, ouverte sur le vide") }, caption: bi("Observation", "Baie d'observation") },
                { image: { assetId: "", alt: bi("A single tape deck still turning", "Un magnétophone unique, encore en marche") }, caption: bi("Archive room", "Salle d'archives") },
                { image: { assetId: "", alt: bi("Water rising slowly across the lower deck", "L'eau qui monte lentement sur le pont inférieur") }, caption: bi("Lower deck", "Pont inférieur") },
                { image: { assetId: "", alt: bi("The signal source, finally located", "La source du signal, enfin localisée") }, caption: bi("Source", "La source") }
              ]
            }],
            ["text", {
              title: bi("The story, without spoilers", "L'histoire, sans spoiler"),
              body: bi("A relay station was built to pass messages through. It is still doing that. You are the first person it has reached in thirty years, and it is patient enough to wait while you decide whether to answer.\n\n## No combat, no clock\nNothing in the game is trying to kill you and nothing is counting down. The pressure is entirely conversational: someone is transmitting, and every reply you give becomes part of the record.\n\n## Your choices are kept\nThe station remembers. Not as a punishment — as a log. Reading it back is part of the ending.", "Une station relais a été construite pour faire passer des messages. Elle le fait toujours. Vous êtes la première personne qu'elle atteint depuis trente ans, et elle est assez patiente pour attendre que vous décidiez de répondre.\n\n## Pas de combat, pas d'horloge\nRien dans le jeu ne cherche à vous tuer et rien ne s'écoule. La pression est entièrement conversationnelle : quelqu'un émet, et chaque réponse que vous donnez entre dans le registre.\n\n## Vos choix sont conservés\nLa station se souvient. Non comme une sanction — comme un journal. Le relire fait partie de la fin.")
            }],
            ["posts", {
              title: bi("News", "Actualités"),
              lead: bi("Development, releases and the occasional soundtrack note.", "Développement, sorties, et quelques notes sur la bande-son."),
              items: [
                { title: bi("Demo out now", "La démo est sortie"), date: "2026-04-10", excerpt: bi("Two hours of the first chapter, free.", "Deux heures du premier chapitre, gratuites."), href: "" },
                { title: bi("Soundtrack recorded", "Bande-son enregistrée"), date: "2026-02-20", excerpt: bi("Live orchestra, recorded in one week.", "Orchestre live, enregistré en une semaine."), href: "" },
                { title: bi("French and English voices locked", "Doublage FR et EN bouclé"), date: "2026-01-30", excerpt: bi("Eighteen hours of dialogue, two casts, one very cold studio.", "Dix-huit heures de dialogue, deux distributions, un studio très froid."), href: "" },
                { title: bi("Release date announced", "Date de sortie annoncée"), date: "2025-12-12", excerpt: bi("Spring 2027, on every platform we can reasonably support.", "Printemps 2027, sur toutes les plateformes que nous pouvons soutenir."), href: "" }
              ]
            }]
          ])
        ]
      })
  },

  store: {
    key: "store",
    label: ["Online store", "Boutique en ligne"],
    desc: ["Product grid, prices, cart notice.", "Grille de produits, prix, mention du panier."],
    build: () =>
      doc({
        name: bi("Fer & Argile", "Fer & Argile"),
        description: bi("Small-batch ceramics, made by hand and fired to order.", "Céramiques en petite série, façonnées à la main et cuites à la commande."),
        baseUrl: "https://example.com",
        theme: themeOf("store", { tone: "serif" }),
        pages: [
          page("index", { en: "Shop", fr: "Boutique" }, { en: "Shop", fr: "Boutique" }, [
            ["hero", {
              eyebrow: bi("Made by hand", "Fait main"),
              title: bi("Ceramics fired to order", "Céramiques cuites à la commande"),
              lead: bi("Small batches, two weeks to ship. Prices shown here are for information; payment needs a payment provider — see the README.", "Petites séries, deux semaines de livraison. Les prix sont affichés à titre indicatif ; le paiement nécessite un prestataire — voir le README."),
              ctaLabel: bi("See the catalogue", "Voir le catalogue"),
              ctaHref: "index.html#catalogue",
              image: { assetId: "", alt: bi("", "") }
            }],
            ["products", {
              title: bi("The catalogue", "Le catalogue"),
              lead: bi("Prices in euro, including tax.", "Prix en euros, TTC."),
              items: [
                { name: bi("Stoneware mug", "Tasse en grès"), price: "24", blurb: bi("280 ml, holds heat, dishwasher safe.", "280 ml, garde la chaleur, compatible lave-vaisselle."), image: { assetId: "", alt: bi("", "") }, href: "" },
                { name: bi("Serving plate", "Plat de service"), price: "58", blurb: bi("Oven to table, 32 cm diameter.", "Four à table, 32 cm de diamètre."), image: { assetId: "", alt: bi("", "") }, href: "" },
                { name: bi("Tea set, four pieces", "Service à thé, quatre pièces"), price: "120", blurb: bi("Stoneware, glazed by hand.", "Grès, émaillé à la main."), image: { assetId: "", alt: bi("", "") }, href: "" }
              ]
            }],
            ["faq", {
              title: bi("Shipping and returns", "Livraison et retours"),
              items: [
                { q: bi("How long does shipping take?", "Quels sont les délais de livraison ?"), a: bi("Two weeks for pieces fired to order, then 3 to 5 days for delivery.", "Deux semaines pour les pièces cuites à la commande, puis 3 à 5 jours de livraison.") },
                { q: bi("Can I return a piece?", "Puis-je retourner une pièce ?"), a: bi("Yes, within 30 days, unused and in its original packaging.", "Oui, sous 30 jours, non utilisée et dans son emballage d'origine.") },
                { q: bi("Do you ship outside Europe?", "Livrez-vous hors d'Europe ?"), a: bi("Not yet. We ship within the EU and will say so plainly rather than quote a rate we cannot honour.", "Pas encore. Nous livrons dans l'UE et le dirons franchement plutôt que d'annoncer un tarif que nous ne pouvons pas tenir.") },
                { q: bi("Will two pieces ever look identical?", "Deux pièces seront-elles identiques ?"), a: bi("No. That is the point of making them by hand — expect variation, and treat it as the point rather than a flaw.", "Non. C'est tout l'intérêt du fait main — attendez des variations, et considérez-les comme une caractéristique, pas un défaut.") }
              ]
            }],
            ["features", {
              title: bi("What you get", "Ce que vous recevez"),
              lead: bi("Four things, plainly stated, on every order.", "Quatre choses, clairement, à chaque commande."),
              items: [
                { title: bi("Fired to order", "Cuite à la commande"), body: bi("Thrown when you buy it, not made in a batch and warehoused. Expect two weeks.", "Façonnée à votre commande, pas produite en série. Comptez deux semaines.") },
                { title: bi("Signed and dated", "Signée et datée"), body: bi("The maker's mark goes on the base, with the year it was fired.", "La marque de l'atelier figure sous la pièce, avec l'année de cuisson.") },
                { title: bi("Free shipping in the EU", "Livraison gratuite dans l'UE"), body: bi("Insured and tracked, on every order over €40.", "Assurée et suivie, sur toute commande de plus de 40 €.") },
                { title: bi("30-day returns", "Retours sous 30 jours"), body: bi("Unused, in its packaging, no justification needed.", "Non utilisée, dans son emballage, sans justification à fournir.") }
              ]
            }],
            ["stats", {
              title: bi("The workshop in numbers", "L'atelier en chiffres"),
              items: [
                { value: bi("1", "1"), label: bi("maker — no middleman", "artisan — aucun intermédiaire") },
                { value: bi("1 240 °C", "1 240 °C"), label: bi("peak kiln temperature", "température de pointe du four") },
                { value: bi("30 days", "30 jours"), label: bi("to return anything", "pour retourner une pièce") },
                { value: bi("2019", "2019"), label: bi("the wheel arrived", "arrivée du tour") }
              ]
            }]
          ]),
          page("about", { en: "About", fr: "À propos" }, { en: "About", fr: "À propos" }, [
            ["text", {
              title: bi("The workshop", "L'atelier"),
              body: bi("One person, one wheel, one kiln. Everything here was thrown, trimmed and glazed in the same room.\n\n## Care\nDishwasher safe, but hand washing keeps the glaze brighter for longer.", "Une personne, un tour, un four. Tout ici a été tourné, tourné et émaillé dans la même pièce.\n\n## Entretien\nCompatible lave-vaisselle, mais le lavage à la main garde l'émail plus brillant plus longtemps.")
            }]
          ])
        ]
      })
  },

  saas: {
    key: "saas",
    label: ["SaaS landing", "Page SaaS"],
    desc: ["Pricing table, features, signup call.", "Grille tarifaire, fonctionnalités, appel à l'inscription."],
    build: () =>
      doc({
        name: bi("Ledgerline", "Ledgerline"),
        description: bi("Reconciliation for small accounting teams. Connect your bank, close the month in a day.", "Rapprochement pour les petites équipes comptables. Connectez votre banque, clôturez le mois en un jour."),
        baseUrl: "https://example.com",
        theme: themeOf("saas"),
        pages: [
          page("index", { en: "Home", fr: "Accueil" }, { en: "Home", fr: "Accueil" }, [
            ["hero", {
              eyebrow: bi("Accounting automation", "Automatisation comptable"),
              title: bi("Close the month in a day, not a week", "Clôturez le mois en un jour, pas une semaine"),
              lead: bi("Ledgerline matches every bank line against your invoices and flags only what needs a human. No spreadsheet, no copy-paste.", "Ledgerline rapproche chaque ligne bancaire avec vos factures et ne signale que ce qui demande un humain. Aucun tableur, aucun copier-coller."),
              ctaLabel: bi("Start free trial", "Essai gratuit"),
              ctaHref: "#pricing",
              image: { assetId: "", alt: bi("", "") }
            }],
            ["features", {
              title: bi("Why it works", "Pourquoi ça marche"),
              lead: bi("Three things, done properly, instead of forty done adequately.", "Trois choses, faites correctement, plutôt que quarante faites moyennement."),
              items: [
                { title: bi("Bank connection", "Connexion bancaire"), body: bi("Read-only access, revoked whenever you like. We cannot move money, and that is a feature.", "Accès en lecture seule, révocable à tout moment. Nous ne pouvons pas déplacer d'argent, et c'est une fonctionnalité.") },
                { title: bi("Automatic matching", "Rapprochement automatique"), body: bi("Rules you set once, applied to every line. When a rule is wrong you fix the rule, not the month.", "Des règles définies une fois, appliquées à chaque ligne. Quand une règle est fausse, on corrige la règle, pas le mois.") },
                { title: bi("Export to your accountant", "Export vers votre comptable"), body: bi("CSV and a clean PDF, whatever format they ask for.", "CSV et un PDF propre, quel que soit le format demandé.") },
                { title: bi("Nothing is written back", "Rien n'est réécrit"), body: bi("Ledgerline never edits a bank line or books an entry. It proposes; a human decides.", "Ledgerline ne modifie jamais une ligne bancaire ni ne comptabilise. Il propose ; un humain décide.") },
                { title: bi("Audit trail on everything", "Journal d'audit complet"), body: bi("Every match records why it matched, so a disputed line can be explained in one sentence.", "Chaque rapprochement enregistre pourquoi il a fonctionné, pour qu'une ligne contestée s'explique en une phrase.") },
                { title: bi("Your data, exportable", "Vos données, exportables"), body: bi("Everything in one file, in a documented format, at any time.", "Tout dans un fichier, dans un format documenté, à tout moment.") }
              ]
            }],
            ["stats", {
              title: bi("In numbers", "En chiffres"),
              items: [
                { value: bi("94%", "94 %"), label: bi("of lines matched without a human", "des lignes rapprochées sans intervention") },
                { value: bi("2.3 h", "2,3 h"), label: bi("average month-end, down from 9", "de clôture mensuelle moyenne, contre 9 avant") },
                { value: bi("11", "11"), label: bi("countries using it", "pays qui l'utilisent") },
                { value: bi("0", "0"), label: bi("entries written back to your bank", "écritures renvoyées à votre banque") }
              ]
            }],
            ["gallery", {
              title: bi("The interface", "L'interface"),
              items: [
                { image: { assetId: "", alt: bi("List of unmatched bank lines with suggested matches", "Liste des lignes non rapprochées avec les rapprochements suggérés") }, caption: bi("Unmatched lines", "Lignes non rapprochées") },
                { image: { assetId: "", alt: bi("Rules screen showing the matching conditions in plain language", "Écran des règles montrant les conditions en langage clair") }, caption: bi("Rules, in plain language", "Les règles, en langage clair") },
                { image: { assetId: "", alt: bi("Month-end summary ready to export as a PDF", "Synthèse de clôture prête à exporter en PDF") }, caption: bi("Month-end summary", "Synthèse de clôture") },
                { image: { assetId: "", alt: bi("Explanations for why a line was matched a certain way", "Explications de la raison d'un rapprochement") }, caption: bi("Why it matched", "Pourquoi cela a été rapproché") },
                { image: { assetId: "", alt: bi("Connected bank accounts with their permissions", "Comptes bancaires connectés et leurs permissions") }, caption: bi("Connections", "Connexions") },
                { image: { assetId: "", alt: bi("Export history with each file that was sent", "Historique des exports avec chaque fichier envoyé") }, caption: bi("Export history", "Historique des exports") }
              ]
            }],
            ["table", {
              title: bi("Pricing", "Tarifs"),
              items: [
                { label: bi("Solo — €19 / month", "Solo — 19 € / mois"), value: bi("One company, up to 3 users, email support.", "Une société, jusqu'à 3 utilisateurs, support par email.") },
                { label: bi("Team — €49 / month", "Équipe — 49 € / mois"), value: bi("Up to 3 companies, 15 users, priority support.", "Jusqu'à 3 sociétés, 15 utilisateurs, support prioritaire.") },
                { label: bi("Firm — talk to us", "Cabinet — parlons-en"), value: bi("Unlimited, API access, onboarding help.", "Illimité, accès API, aide à l'intégration.") }
              ]
            }],
            ["faq", {
              title: bi("Questions", "Questions"),
              items: [
                { q: bi("Is there a free trial?", "Y a-t-il un essai gratuit ?"), a: bi("30 days, no card required.", "30 jours, sans carte bancaire.") },
                { q: bi("Where is my data stored?", "Où sont stockées mes données ?"), a: bi("In the European Union. This static page stores nothing at all — a real deployment needs an account system and a database.", "Dans l'Union européenne. Cette page statique ne stocke rien — un vrai déploiement nécessite comptes et base de données.") },
                { q: bi("Can it book entries for me?", "Peut-il comptabiliser à ma place ?"), a: bi("No. It proposes matches, a human accepts them. That boundary is deliberate and will not move.", "Non. Il propose des rapprochements, un humain les accepte. Cette limite est délibérée et ne bougera pas.") },
                { q: bi("What if my bank changes its format?", "Et si ma banque change de format ?"), a: bi("Import a statement instead. File import is the fallback for every connection problem, and it always works.", "Importez un relevé. L'import de fichier est le solution de repli pour tout problème de connexion, et fonctionne toujours.") },
                { q: bi("Can my accountant get their own login?", "Mon comptable peut-il avoir son propre accès ?"), a: bi("On Team and above, yes — with read-only access to the exports they need.", "À partir de l'offre Équipe, oui — en lecture seule sur les exports dont il a besoin.") }
              ]
            }],
            ["cta", {
              title: bi("Try it on one month", "Essayez sur un mois"),
              body: bi("Import a statement, see how much of it matches itself.", "Importez un relevé, voyez la part qui se rapproche seule."),
              label: bi("Create an account", "Créer un compte"),
              href: "mailto:hello@example.com"
            }]
          ])
        ]
      })
  }
};

/** Order shown in the template picker. */
export const TEMPLATE_ORDER = ["blank", "portfolio", "cv", "business", "blog", "forum", "game", "store", "saas"];

/** A fresh, unsaved document from a template. Ids are regenerated per instance. */
export function fromTemplate(key) {
  const tpl = TEMPLATES[key] || TEMPLATES.blank;
  const doc = tpl.build();
  doc.template = tpl.key;
  // Regenerate ids so two instances of the same template never share block ids,
  // which would make undo/redo and the outline ambiguous.
  for (const p of doc.pages) {
    p.id = uid("p");
    for (const b of p.blocks) b.id = uid("b");
  }
  return doc;
}
