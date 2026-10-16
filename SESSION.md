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

## Si quelqu'un reprend

Par où je commencerais, dans cet ordre :

1. Ouvrir les neuf templates et les **regarder**, sans mesurer. C'est comme ça
   que sont sortis les défauts 5, 10, 11, 12, 13, 14 et 15.
2. Comparer ce qui entre dans `normalizeDoc` à ce qui en sort. C'est comme ça
   que sont sortis 7 et 8, et c'est le terrain le plus rentable du dépôt.
3. Ne jamais faire confiance à une mesure avant de l'avoir vue mentir.
4. Chercher les `catch` qui attrapent tout et accusent le navigateur ou la
   machine. C'est là que sont sortis 21, 22 et leurs frères.