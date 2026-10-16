# Journal de session — audit du générateur

Ce fichier consigne tout ce qui a été fait depuis la demande de départ :
« améliorer le générateur, pas ajouter des fonctionnalités sans rapport ni
blinder le `.exe` pour rien ».

Il est écrit après coup, donc il reflète ce que je sais **maintenant**, pas ce que
je croyais savoir en cours de route. La section « Ce que mes instruments ont dit
faux » existe parce qu'elle fait partie du travail.

État au moment de l'écriture : `main` à `dce3c25`, **401 contrôles / 8 suites,
exit 0**, exe de 721 408 octets, `--selftest` exit 0.

---

## La demande, et comment je m'en suis écarté

La demande portait sur le **générateur** : le fichier que le logiciel produit.
Je m'en suis écarté pendant huit rondes en auditant l'**interface de l'éditeur** —
six défauts d'interface pour trois de production. La correction a été formulée
par la personne qui me l'avait faite, et elle était juste.

Deux autres dérives, plus courtes :

- **Safari.** Je l'ai listé comme priorité restante alors que je ne le veux pas
  vraiment. C'était un tic : nommer « ce que je ne peux pas tester » pour finir
  une phrase. L'éditeur est un exe Windows → WebView2 (Chromium) ; le moteur
  n'a jamais été le doute.
- **Du travail sans demande.** Un tour entier à comparer des objets JSON internes
  alors que seule la production compte.

---

## Les défauts trouvés

Quatorze. Tous invisibles autrement : aucun n'aurait été trouvé en relisant le
code, et la plupart ne se voyaient pas sur une capture d'écran.

### Sur ce que le logiciel produit

| # | Défaut | Où |
|---|---|---|
| 1 | `Company name: [object Object]` sur la page légale de 8 templates sur 9 | `site-strings.js` — `fillLegal` tombait sur `doc.name`, qui est `{en, fr}` |
| 2 | `[object Object]` à la place des chiffres dans les statistiques | `blocks.js` — `esc()` au lieu de `esc(T(v, lang))` sur un champ `i18n` |
| 3 | Une section vidée expédie son titre et rien dessous | 6 blocs sur 18 ; `gallery`, `skills` et `steps` refusaient déjà, les autres non |
| 4 | Un FAQ imprimé ne montre que les questions, sans réponse | `.faq` fermé sur papier, où il n'y a pas de clic |
| 5 | Une puce de liste devant chaque carte d'une grille | `.grid` avait oublié le reset que `.time`, `.steps`, `.logos` avaient |
| 6 | Ligne de 102 caractères dans le CV | cellule de tableau hors de `.prose`, donc hors des 68 ch |
| 7 | **Les compteurs de réponses disparaissent à la sauvegarde** | `store.js` — un champ `t: "text"` neamadmit que les chaînes, les templates stockent `24` |

### Sur les données

| # | Défaut | Où |
|---|---|---|
| 8 | **Un arrondi de 0 revient en 8** | `Number(raw.theme?.radius) || 8` — et le curseur va de 0 à 24 |

Les 7 et 8 sont la même faute : `x || défaut` appliqué à une valeur où zéro est
légitime. Invisibles à la lecture et au premier build — ils n'apparaissent qu'en
comparant ce qui **entre** à ce qui **sort**.

### Sur l'outil

| # | Défaut | Où |
|---|---|---|
| 9 | Le bouton de thème est un bouton natif de 33×31 | `.theme-toggle` est un **frère** de `.langpick`, il n'en hérite pas |
| 10 | Le bouton d'envoi occupe 605 px | `form.stack` est une grille, ses enfants s'étirent |
| 11 | Le FAQ n'a aucun signe d'être cliquable | `display:flex` sur `<summary>` supprime le triangle natif, et `::marker` ne s'applique qu'aux `list-item` |
| 12 | Un toast vide reste affiché et avale les clics | `.live` sans `:empty`, toujours 34×15 px avec bordure |
| 13 | Un libellé à 1239 px de son contrôle à 1280 px | `flex-wrap` coupait **entre** un `<label>` et son `<select>` |
| 14 | Le panneau Content déborde de 56 px | `<fieldset>` avec `min-inline-size: min-content` par défaut, plus un flex sans `flex-wrap` |
| 15 | **L'aperçu en direct est une bande de 150 px** | aucun ancêtre n'avait de hauteur définie, `height:100%` retombe sur 150 px |
| 16 | 19 arrêts de tabulation sur 45 piégés dans l'iframe d'aperçu | le cadre n'est pas une région `aria-live` |

Le 15 est le plus coûteux de la session : **la fonctionnalité centrale du
produit**, réduite à un quart de sa hauteur, dans un panneau laissé vide en
dessous. Chaque capture montrait bien *une* page — il fallait mesurer.

---

## Ce que mes instruments ont dit faux

Sept fois. C'est la partie du travail que je ne reutilise pas sans écrire.

| L'instrument | Ce qu'il a dit | La vérité |
|---|---|---|
| Audit « mobile » | clean à 375 px | il mesurait **469 px**, et pas la même valeur d'une page à l'autre |
| Sonde Firefox | clean sur un store cassé | elle déballait le résultat BiDi **deux fois** ; `val.value` sur un tableau de paires vaut `undefined` |
| Test de lisibilité | « une ligne trop longue » | il retirait tous les `<script>` — y compris l'injecté ; il passait avec l'échappement désactivé |
| Test deFleuve | « l'aperçu n'est pas un piège » | la suite n'entre jamais dans l'iframe ; il passait dans les deux cas |
| Mesure d'opacité | `opacity=0` même avec du texte | style calculé périmé dans la même tâche |
| Sonde d'accessibilité | « dialogue sans nom » | `aria-label: null` alors qu'il y a `aria-labelledby` vers un vrai `<h2>` |
| Un `sed` maison | — | a mangé des balises fermantes, un `<section>` et un `<p>` : 20/32 |

Et **trois tests que j'ai écrits passaient sans tester quoi que ce soit** :
le compteur d'arrêts, le nettoyage de `<script>`, le contrôle de lisibilité posé
dans une boucle qui rend un seul document.

La méthode, la seule qui ait fonctionné : **faire mentir la mesure d'abord,
vérifier qu'elle ment, puis croire ce qu'elle dit.**

Ce que j'ai appris de travers : à chaque fois j'avais placé le contrôle là où
c'était pratique, pas là où le défaut existait.

---

## Les contrôles ajoutés

Sept tests, chacun falsifié avant d'être cru — c'est-à-dire : casser le défaut,
voir le test rougir, le rétablir.

- le fichier exporté résiste à ce que l'utilisateur tape (compté, pas filtré)
- un projet sauvegardé et rouvert exporte le même site, à l'octet
- un bloc ajouté aujourd'hui exporte identique après sauvegarde
- un rayon de 0 survit à la sauvegarde
- la FAQ garde son affordance, et elle disparaît sur papier
- aucun libellé ne peut être séparé de son contrôle par un retour à la ligne
- le toast est invisible quand il n'a rien à dire, et visible quand il en a

Plus deux vérifications qui n'étaient pas des tests mais des outils :
`desktop/verify-embed.mjs` (`npm run dist:check`) relit l'exe produit et échoue
si les octets embarqués ne sont pas ceux du `dist` courant.

---

## Ce qui a été vérifié et n'a rien donné

Utile à écrire, parce que l'absence de résultat est un résultat :

- Contenu hostile dans l'export : aucun script, aucun `on*=`, aucun balisage
  brut, les 200 images cassées ne rendent rien, un titre de 10 000 caractères
  passe.
- Zéro mojibake sur 9 templates × 2 langues, contre 1 338 sur injection.
- Les neuf templates propres sur débordement, contraste, cibles tactiles — en
  1280 et en 375, sur Chrome et sur Gecko.
- Hiérarchie des titres tenue partout : `h1=50 h2=33 h3=23`, aucune inversion.
- Interlignes corrects : 1.65 le corps, 1.18 les titres.
- Le petit texte à 13.7 px est du vrai texte de rôle — sur-titre, légende,
  date — pas du corps de texte.

---

## Ce qui reste ouvert

Ce sont des décisions, pas des défauts.

- **`slate` a un `alt` vert** (`#34d399`) sur un site bleu. C'est un second accent
  volontaire — `ink` a de l'ambre, `clay` du jaune. Je ne modifie pas une
  couleur livrée sans demande.
- **Safari.** Non installé, non automulable ici.
- **La qualité visuelle des neuf templates.** Je les ai jugés corrects,
  accessibles et lisibles. Jamais beaux. Aucun test ne le dira.

---

## Après la rédaction de ce fichier

Poursuite demandée : la **qualité visuelle**, le seul terrain qui reste et qu'aucun
test ne peut couvrir. Première mesure : l'alignement du bord gauche, symptôme le
plus courant d'une page « valide mais amateur ».

**Résultat : propre.** Aucune des 27 divergences signalées ne concerne une
section — les décalages venaient tous d'éléments *à l'intérieur* : les colonnes
d'une grille (`+411px`, `+802px`) et la marge interne des cartes (`+21px`,
constant sur les trois largeurs). Le bord que l'œil aligne est identique sur les
neuf templates à 1280, 768 et 375 px.

Un cas est resté sans explication et **n'est donc pas rapporté comme défaut** : un
`h2` du CV décalé de 20 à 32 px, décalage qui varie avec la largeur — donc ni une
marge fixe ni un arrondi. Je soupçonne l'animation d'entrée des blocs, mesurée en
cours de lecture, mais je ne l'ai pas confirmé et je ne l'affirme pas.

La sonde elle-même s'est révélée non fiable sur ce point : elle comparait un titre
à son conteneur immédiat sans tenir compte de l'imbrication. Une mesure qui
compte des cartouches dans une grille comme des désalignements n'est pas une
mesure.

---

## Les limites, et le silence autour d'elles

`store.js` borne le document : 40 pages, 60 blocs par page, 60 entrées par
liste, 16 images. Ces bornes sont justes — elles empêchent l'éditeur de
s'enliser sur un document absurde.

Ce qui ne l'était pas : elles s'appliquaient avec `slice()` et **sans rien
dire**. Un projet de 45 pages s'ouvrait avec 40 pages, aucune alerte. Le canal
d'avertissement existait déjà et servait déjà pour les images trop grosses.

Trois troncures silencieuses, une par limite, plus un cas où la racine de la
liste ne transmettait même pas le tableau d'avertissements jusqu'au champ
répété — ce qui explique pourquoi la troisième a résisté à la première
tentative.

La limite reste. Ce qui change : le produit dit maintenant combien il a laissé
derrière lui. Un fichier qui perd des pages à chaque ouverture, sans un mot,
est pire qu'un fichier refusé.

Le test vérifie aussi qu'un projet ordinaire **ne crie pas au loup**.

---

## La limite qu'on ne sent jamais venir

Les trois troncures ci-dessus sont théoriquement atteignables mais rares. Il en
restait une dans `str()`, le helper qui coupe **tous** les champs texte :

```js
const str = (v, max = LIMITS.text) => (typeof v === "string" ? v.slice(0, max) : "");
```

40 000 caractères. L'éditeur **ne limite pas la saisie** — aucun `maxlength`,
aucune troncature pendant la frappe. Le coup part donc à la réouverture : on
tape un long article, on le relit à l'écran, on sauvegarde, on rouvre — et cinq
mille caractères ont disparu, sans un mot.

C'est la pire variante de la famille, parce que la perte est **différée** : elle
arrive plusieurs manipulations après l'écriture, et l'utilisateur a vu le texte
au complet.

La correction demande de faire passer le tableau d'avertissements à travers
`asBi`, `coerceField` et tous les appels de `str`, puis de nommer le champ coupé
— sinon « a translated field was 45000 characters » n'est pas actionnable. Le
message dit maintenant :

> Body was 45000 characters; the last 5000 were not loaded (limit 40000)

Un garde empêche le bruit : les champs à petite limite — nom de société,
courriel — sont tronqués **par conception** et ne doivent pas crier, sinon on
apprend aux gens à ignorer les avertissements qui comptent.

---

## Un produit qui dit une chose fausse

Poursuite du balayage des limites, côté éditeur cette fois : que voit
l'utilisateur quand il choisit une image que le produit refuse ?

`readAsset` a **trois** motifs de rejet, et un seul était traité :

```js
if (m.startsWith("img-too-big")) { … }
else say(t("errBadJson"), "ko");
```

Choisir un `.txt` comme image — ou une image corrompue — répondait
**« Ce fichier n'est pas du JSON valide »**. L'utilisateur vient de choisir une
image ; on lui parle de JSON.

C'est une famille voisine de la précédente, mais plus vicieuse : rien ne
disparaît, le produit n'est pas faux sur les faits — il répond à une autre
question. Et ça ne se voit pas en lisant le code : il faut suivre le rejet
jusqu'à la phrase.

Trois messages, en deux langues, un branchement par motif.

Le test qui vérifie est un **test de câblage**, et le journal dit pourquoi : le
comportement réel exigerait un navigateur et un vrai `FileReader`. En
couplant les deux — un test de contrat sur les codes, un test de câblage sur les
branches — la falsification mord dans les deux sens. J'ai d'abord écrit un
seul test qui passait après avoir supprimé la branche : il ne regardait que
`readAsset`, et le branchement dans l'interface ne l'intéressait pas.

---

---
---

## Le dossier écrit était un site sans CSS (défaut 22)

Je cherchais des messages de **succès** mensongers, retournement exact de la
famille précédente. Deux pistes mortes d'abord, qu'il faut signaler parce
qu'elles hingnaient à devenir des constats :

- `Project saved` est dit sans condition, et `download()` ne renvoie rien. Un
  téléchargement bloqué est indétectable de façon fiable ; je n'ai rien construit
  pour une condition qu'on ne sait pas voir.
- Les noms de fichiers : `uniqueSlug` retombe déjà sur `"page"`, donc le
  `|| "site"` de la ligne 1154 est du code mort, et Windows accepte `.wgn`.

Puis le bouton **Save folder**. Il faisait :

```js
const handle = await dir.getFileHandle(path, { create: true });
```

Or `getFileHandle` refuse un nom qui contient un séparateur — l'API ne sait pas
créer de répertoire. Et **les neuf templates émettent tous `css/style.css` et
`js/site.js`**. 18 chemins imbriqués sur 97.

L'ordre des clés fait le reste : les HTML sont écrits, **puis** ça lève. Le
dossier livré est donc un site sans feuille de style et sans script, et le
`catch` affiche `noFolderApi` — « This browser has no folder access » — **depuis
la branche qui ne s'exécute que là où `showDirectoryPicker` existe**. Le message
ne pouvait pas être vrai.

Le chemin était déjà dans le dépôt : `decodeDataUri` se trouvait déjà dans
`zip.js`. J'y ai mis `writeFilesTo(dir, files)`, qui crée les sous-répertoires
au passage, et `ui.js` appelle désormais cette fonction. Le `catch` n'accuse plus
le navigateur : `folderWriteFailed` dit que le dossier n'a pas pu être écrit et
renvoie vers le `.zip`.

Le test conduit les neuf templates à travers un faux `FileSystemDirectoryHandle`
qui **rejette les séparateurs comme le vrai**. Il a d'abord échoué sur ma propre
assertion (`bytes` est un tableau d'un élément, pas le contenu) — pas sur le
code. Falsification : remettre le chemin entier d'un seul coup et le test mord
immédiatement.

Piste ouverte, non corrigée : `Object.keys(files).length` est une truthiness sur
un nombre. Un fichier ne peut pas faire `0`, donc le test est juste, mais c'est
le genre de piège qui devient faux au premier `files` nullable. Je l'ai laissé
tel quel : le corriger serait du bruit pour un cas qui n'existe pas.

## Note d'honnêteté sur les comptes

`npm run verify` sort huit lignes de résumé, `test.mjs` sort un compte `pass`,
et je les ai additionnés de travers deux fois : « 407 » quand la somme faisait
406, puis « 409 » quand elle en faisait 408. Les compteurs des README étaient
faux à chaque palier et je ne les avais pas vérifiés. Un total affiché n'est
une preuve que si on l'additionne.

---

---
---

## La note de déploiement promettait un en-tête qui n'existait pas (défaut 23)

Les `catch` sont propres : aucun n'accuse la machine à tort. Je suis passé aux
promesses qui **livrent avec le site**.

`DEPLOY.txt` voyage dans chaque export et dit, en anglais comme en français :

> `"_headers" is read by both and applies the CSP and HSTS headers.`

Le `_headers` réellement produit portait `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy` et le CSP. **Pas de
`Strict-Transport-Security`.** Aucun `grep` n'en trouvait dans tout le dépôt.

C'est le pire endroit possible pour une promesse fausse : elle ne rassure pas
l'utilisateur dans l'éditeur, elle est écrite dans le dossier qu'il va pousser en
ligne, et il ne peut la voir qu'après coup — s'il la lit.

J'ai livré l'en-tête plutôt que d'affaiblir la phrase : un site statique chez
Netlify ou Cloudflare Pages est servi en HTTPS, HSTS n'a rien à y casser. Sans
`includeSubDomains` volontairement : un sous-domaine voisin sans TLS deviendrait
injoignable, et le produit ne doit pas casser ça chez quelqu'un d'autre.

Le test compare les en-têtes **nommés dans la note** à ceux **présents dans le
fichier posé à côté**, sur les neuf templates. Il échoue aussi dans l'autre sens :
si la note cesse de nommer quoi que ce soit, le test se plaint, parce que sinon il
ne vérifierait plus rien.

Trois erreurs à moi dans ce tour, toutes du même genre — le test qui ment :

1. Je l'ai d'abord écrit dans `test.mjs` contre `build(doc).files`, alors que
   `DEPLOY.txt` est produit par `exportFiles` dans `ui.js`. Il ne le voyait
   jamais et échouait sur « DEPLOY.txt is missing ». Test déplacé dans la suite
   navigateur, qui a accès au vrai `window.wgn.files()`.
2. Mon regex exigeait l'en-tête en début de ligne ; ils sont indentés dans le
   template. `\s*` manquant.
3. Le pire : dans un template literal, `\s` **n'est pas un échappement reconnu** et
   devient le caractère `s`. Il fallait `\\s`. Le test « passait » avec une
   regex qui ne pouvait rien voir.

Leçon, qui vaut pour tout le dépôt : **un `\s` ou un `\\s` faux dans une chaîne
de test ne fait pas échouer le test, il le rend aveugle.**

## Dérive des compteurs, encore

Mes remplacements enchaînés avaient transformé la ligne

```
npm test          # 133 core checks, no browser needed
```

en `npm test # 127 128 130 131 133 core checks` : chaque palier avait empilé son
ancien nombre. Et le tableau des suites annonçait encore 100 contrôles navigateur
après les deux nouveaux. Les deux sont remis à plat. La suite des nombres
répétés dans les README est un marqueur de génération automatique à ne pas
imiter.

---

---
---

## Le rapport disait « prêt » pendant que le site pointait sur example.com (défaut 24)

Même famille, terrain suivant : les promesses que fait **le rapport qualité** à
l'utilisateur qui s'apprête à publier.

Quatre hypothèses avant d'en trouver une, toutes fausses, et il faut le dire —
c'est le meilleur indicateur de santé du dépôt que ces quatre-là tombent :

- Un `@import` de police distante dans le CSS personnalisé passerait sous le
  radar. Non : `sanitizeCss` retire `@import` et toute `url()` porteuse d'un
  schéma, et compte ce qu'il retire, donc `auCssKo` prévient l'utilisateur.
- Un bloc laisserait passer du HTML brut. Non : `esc` échappe `"` en `&quot;`,
  et les huit sondes (balise `<style>`, `<img>`, `srcset`, `onclick`,
  `<meta refresh>`, URL protocol-relative) ressortent toutes inertes.
- Le rapport crierait au loup sur de la prose contenant `src="https://…"`.
  Non, pour la même raison : le texte échappé ne matche plus le motif.
- Le nom de fichier du projet produirait un nom que Windows refuse. Non.

Puis la vraie. `auSeoOk` — « robots.txt and sitemap.xml generated » — ne
demandait que si les deux fichiers **existaient**. Or :

| template | `baseUrl` livrée |
|---|---|
| blank, portfolio, cv | `""` |
| business, blog, forum, game, store, saas | `https://example.com` |

Six des neuf. Le rapport affichait donc un **vert** pendant que le
`<link rel="canonical">`, les `og:url`, le sitemap et le robots.txt nommaient un
domaine qui n'est pas celui de l'utilisateur. Publier tel quel, et les moteurs
indexent la mauvaise adresse — silencieusement, définitivement.

Pire que le champ vide : un champ vide invite à le remplir, une adresse
`https://example.com` a l'air faite.

`auSeoOk` devient donc conditionnel à une URL qui est réellement celle de
l'utilisateur, et `auCanonKo` dit ce qu'il en est. Le texte de `DEPLOY.txt` est
corrigé dans les deux langues : il disait « left empty on purpose », ce qui est
faux pour ces six templates.

Le test vérifie les quatre cas — URL livrée, URL vide, `example.org`, URL réelle
— et « un template propre n'a rien à corriger » a dû être réécrit : il pose
maintenant une vraie URL avant d'affirmer que le reste est propre, sinon il ne
teste plus ce qu'il prétend tester.

Falsification : remettre l'ancienne ligne d'une seule expression et les trois
tests mordent.

---

﻿---
---

## « Meta description manquante » pour une description de douze caractères (défaut 25)

Toujours le rapport, toujours la même forme de mensonge : un contrôle juste
prononcant une phrase fausse.

Le contrôle veut **vingt caractères** de description depuis toujours :

```js
if (!/<meta name="description" content="[^"]{20,}"/.test(f)) noDesc.push(p.slug);
```

et la phrase disait `Missing meta description: %s`. Un utilisateur qui écrivait
`My shop.` se faisait dire que le champ était **vide** — il allait chercher une
boîte qu'il venait de remplir, et ne trouvait rien à corriger. Le contrôle avait
raison, la phrase mentait. Elle nomme maintenant la règle des vingt caractères,
dans les deux langues.

Dans la même boucle, deux couches de code mort :

```js
let imgTotal = 0;                       // écrit, jamais lu
...
imgTotal++;
if (!/\balt="[^"]+"/.test(tag)) imgNoAlt++;   // toujours vrai
```

`imgsWithoutAlt` filtre **déjà** sur cette expression exacte, donc le `if` ne
pouvait pas être faux et `imgTotal` ne servait à rien. Supprimé : le contrôle
fait maintenant trois lignes et se lit comme il fait.

## Trois erreurs à moi, dont deux instructive

1. J'ai écrit le test avec `page.metaDesc`, un champ qui n'existe pas : la sonde
   ne modifiait rien et le contrôle répondait vert. Le vrai champ est `desc`.
   Un test qui passe parce qu'il ne touche à rien est pire qu'un test absent.
2. J'ai attendu qu'une description **vide** soit signalée. Elle ne l'est pas, et
   c'est correct : `build.js` fait `T(page.desc) || T(doc.description)`, donc une
   page sans description hérite de celle du site. **Mon attente était fausse, pas
   le code** — et j'ai réécrit le test pour qu'il vérifie le contrat réel.
3. `audit()` recalcule sans repeindre `#auditList`. Je lisais le texte rendu dans
   un nœud périmé et j'ai conclu à un échec qui n'existait pas. Ces deux
   assertions portaient sur un dictionnaire, pas sur un comportement navigateur :
   elles sont allées dans `test.mjs`, où `T` est déjà importé.

Un test qui échoue pour une bonne raison et un test qui échoue parce que le
système fait correctement ce qu'il doit produisent la même ligne sur l'écran.
Seul le contrat énoncé au départ permet de les distinguer.

---

---
---

## Les compteurs des README ont dérivé cinq fois, maintenant c'est impossible

En corrigeant `test.mjs 128` dans le tableau, j'ai réalisé que **rien** ne pouvait
remettre la main dessus. Cinq fois dans cette session, un contrôle a été ajouté
et les deux nombres qui le décrivent ont été retouchés à la main, par remplacement
de chaîne, et ont divergé :

| ce qui dérivait | ce qui était vrai |
|---|---|
| « 407 checks » | 406 |
| « 409 checks » | 408 |
| `test.mjs 128` | 134 |
| `browser.mjs 100` | 102, puis 109 |
| `npm test # 127 128 130 131 133` | 134 |

Chacune de ces lignes était **incohérente avec elle-même** — le tableau n'additionnait
pas au total affiché — et aucun contrôle ne le voyait.

Deux tests règlent la question pour toujours :

1. **Le tableau des suites s'additionne au total affiché.** Un README sans
   tableau est simplement ignoré, pas signalé à tort — c'est le cas du README
   racine, qui n'en a pas.
2. **Toute suite que `verify.mjs` exécute est nommée dans le tableau.** Sans ça,
   une neuvième suite documentée nulle part continuerait de tourner en silence.

Falsifié deux fois : remettre `128`, puis gonfler le total à `500` — le test mord
avec le détail du calcul.

## Quatre chemins faux dans le même test

Je les note parce que ce sont exactement les pièges du langage, pas du produit :

- `ROOT + "../README.md"` sur un objet `URL` **concatène** au lieu de résoudre :
  il faut `new URL(rel, ROOT)`.
- Mes documents partaient de `../`, alors que `test.mjs` vit dans `test/` — le
  READMEracine n'était jamais ouvert, et le test échouait sur un chemin
  inexistant.
- `System.Text.UTF8Encoding` écrit dans un fichier `.mjs` : PowerShell dans un
  module Node, pas une faute de frappe.
- `void write;` après avoir retiré l'import : un reste de copié-collé.

Chacun de ces quatre a coûté un aller-retour pour un problème qui tient en une
ligne. Le suivant, c'est d'écrire le chemin en premier et le tester seul.

---

﻿---
---

## « Le formulaire pointe vers une vraie cible » vers un schéma vide (défaut 26)

Reste du rapport. La ligne dit `Contact form points somewhere real`, et le
décideur était `safeHref(b.action)`.

Or `safeHref` répond à une **autre** question : « ce schéma peut-il être livré
sans danger ». C'est vrai et nécessaire, mais ce n'est pas ce que la ligne
demande. Trois saisies passaient en vert :

| ce que l'utilisateur tape | ce que dit le rapport | ce que voit le visiteur |
|---|---|---|
| `mailto:` | vraie cible | client mail, `To:` vide |
| `mailto:?subject=Hello` | vraie cible | client mail, `To:` vide, objet rempli |
| `tel:` | vraie cible | rien du tout |

`javascript:` et l'absence de cible étaient déjà signalés — le filtre de schéma
fonctionnait. Ce qui manquait, c'était la moitié non-sécurité de la phrase.

`hasTarget` répond maintenant à la question posée : un `tel:` a besoin d'un
numéro, un `mailto:` a besoin d'une adresse **avant** le `?`. Le reste est de la
décoration. Cinq lignes, dans `ui.js`, à côté de la seule ligne qui s'en sert.

Le site exporté n'est **pas** réécrit : un `mailto:` reste un `mailto:` dans la
page. Le contenu de l'utilisateur lui appartient ; c'est au rapport de le
signaler, pas au générateur de le corriger à son dos.

## Ma première version était trop faible

J'avais écrit « le reste après le schéma est-il non vide ? ». Ça laissait passer
`mailto:?subject=Hello`, parce que `?subject=Hello` n'est pas vide. Le test l'a
vu immédiatement : `{"key":"auFormOk","ok":true}`. C'est exactement le travail du
test — il n'a pas fallacié le code pour que le correctif passe, il a refusé un
correctif qui ne corrigeait pas.

Falsification : revenir à `safeHref` seul et trois tests mordent.

## Une observation laissée ouverte

`auHeadOk` ne capte que les sauts **vers l'avant**, et son motif s'arrête à `h4`.
Un `h2` suivi d'un `h5` passerait. J'ai vérifié avant d'écrire quoi que ce soit :
le générateur n'émet que `h1`, `h2` et `h3` — `h5` et `h6` n'apparaissent nulle
part dans les sources. La faille est donc inatteignable aujourd'hui, et la
corriger serait du bruit pour un cas que le produit ne peut pas produire. Si un
bloc se met un jour à émettre `h5`, c'est le générateur qu'il faudra interroger,
pas cette ligne.

---

---
---

## Une page nommée « privacy » disparaissait de l'export (défaut 27)

Le plus grave de la série, et il n'est pas dans le rapport : il est dans le
**fichier lui-même**.

`build.js` écrit toujours `privacy.html`, `legal.html`, `404.html`, `robots.txt`,
`sitemap.xml`, `favicon.svg`, `assets/`, `css/` et `js/`, quoi que dise le
document. `RESERVED` liste ces onze noms — et le champ de renommage, à la
ligne 646, faisait :

```js
d.pages.find((x) => x.id === p.id).slug = slugify(v);
```

**Aucun passage par le garde.** Taper `privacy` dans le champ de nom de fichier —
trois secondes — et à l'export la page générée passait par-dessus. Le contenu de
la page de l'utilisateur n'était pas écrasé : il était **absent de l'export**,
purement et simplement. Le test le vérifie en cherchant un marqueur unique dans
tous les fichiers produits, et avec le bug il n'est nulle part.

Et le rapport, pendant ce temps, disait `errSlugDup` — « deux pages ne peuvent
pas partager le nom » — parce que la ligne codait cette clé en dur alors que
`docWarnings` rend **trois** problèmes distincts : `errSlugEmpty`,
`errSlugReserved`, `errSlugDup`. Les trois messages existaient déjà dans le
dictionnaire, traduits, justes. Ils n'étaient jamais appelés.

Deux corrections, deux lignes :

- `uniqueSlug` consulte maintenant `RESERVED`, donc **tous** les chemins qui
  passent par elle en bénéficient — dont l'ajout de page.
- le champ de renommage passe par `uniqueSlug(slugify(v), p.id)` au lieu d'y
  écrire le résultat à la main. Une seule garde, tous les appelants.
- la ligne du rapport dit `warn[0].key` au lieu de `errSlugDup`.

Le premier `index` reste autorisé, parce que c'est lui qui détient `index.html`.

## Quatre tests que j'ai dû refaire parce qu'ils ne mesurent rien

C'est la partie honnête de ce tour, et elle est longue.

1. **La sonde mesurait la réparation au lieu du défaut.** J'appelais
   `normalizeDoc` dans la sonde ; `commit()` et `edit()` ne normalisent pas. Le
   défaut était inatteignable par cette sonde et parfaitement réel dans
   l'éditeur. Il fallait passer par le champ, pas écrire la propriété.
2. **Le sélecteur visait le titre.** `/^[a-z0-9-]*$/` matche « Home » aussi bien
   que « about », donc la saisie partait dans le champ du titre et le slug ne
   bougeait pas. Le test passait sans rien vérifier — `privacy` devenait `about`
   dans les huit cas, ce qui est précisément la forme d'un test vide.
3. **`sameFile` par égalité de chaîne** est trop fragile : le contenu généré
   varie un peu d'un cas à l'autre.
4. **`/legal/i` puis `/About/i`** : les deux matchent la **navigation**, présente
   sur toutes les pages. Une page générée contient toujours un lien vers la page
   légale et toujours un lien vers « About ». Il a fallu un marqueur qu'aucune
   page générée ne peut porter.

Le quatrième test est passé **avec le bug présent** pendant deux de ces
révisions. C'est exactement le piège : un test qui ne mord pas est pire
qu'un test absent, parce qu'il achète une confiance fausse. Je ne l'ai su que
parce que la falsification tournait à chaque fois — sans elle, ces quatre
révisions seraient parties en commit avec un cadenas qui n'accrochait rien.

Puis, une fois le marqueur en place, la surprise : le marqueur n'apparaissait
**nulle part**. Ce n'est pas la page de confidentialité qui était corrompue, c'est
la page de l'utilisateur qui était **supprimée du livrable**. C'est ce que le
test vérifie désormais, et il échoue bien sans le correctif.

---

## Si quelqu'un reprend

Par où je commencerais, dans cet ordre :

1. Ouvrir les neuf templates et les **regarder**, sans mesurer. C'est comme ça
   que sont sortis les défauts 5, 10, 11, 12, 13, 14 et 15.
2. Comparer ce qui entre dans `normalizeDoc` à ce qui en sort. C'est comme ça
   que sont sortis 7 et 8, et c'est le terrain le plus rentable du dépôt.
3. Ne jamais faire confiance à une mesure avant de l'avoir vue mentir.
4. Chercher les `catch` qui attrapent tout et accusent le navigateur ou la
   machine. C'est là que sont sortis 21, 22 et leurs frères.