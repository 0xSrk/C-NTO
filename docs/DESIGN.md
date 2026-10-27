# Système visuel — CΛNTO · révision 4.1 « ΟΡΟΣ »

Révision du système, pas de la version de l’application. Le Système 4.0 fond le Système 3.4 du desk et la Ligne V2 « Poinçon » du Lab : la nuit, la grille, le chanfrein, le lecteur et le logotype restent ; le sceau, l’ivoire, l’or, les trois voix, les cartouches et les vrais codes arrivent. Le texte de la révision 3.4 est dans `docs/design/archive/DESIGN-3.4.md`, celui de la v1 dans `docs/design/archive/DESIGN-v1.md`. Le lanceur AUBE garde ses propres jetons et Inter.

## 00. Doctrine

Un desk est un instrument de bornes : perte du jour, plancher de drawdown, plafond de 1 à 1000, comptes `Sim*`, kill switch. En grec, ὅρος est la borne, et la racine d’ὁρίζων, l’horizon — « ce qui borne ». Le sceau du Lab trace déjà cette ligne ; le lanceur AUBE se lève sur elle. Le 4.0 en fait la grammaire du desk.

- **Ce qui vit est or ; seul ce qui franchit la borne est rouge.** `--gold` est la LED : la dernière séance, le direct, la mise à jour, l’autorité. `--signal` est le niveau 3 et lui seul. Le rouge marque — triangle, filet, hachure — et n’écrit jamais : le texte d’un niveau 3 reste ivoire.
- **Le passage du pointeur est une lumière.** L’appui, le focus et la sélection se voient ; le survol aussi, depuis la 4.1 (décision de l’ADMIN, 2026-10-27) : la lumière monte sur le contour, tamisée et lente, sans rien déplacer. Chaque règle `:hover` vit sous `@media (hover: hover)` et ne change que `color`, `background-color`, `border-color`, `box-shadow`, `opacity`, `text-shadow` ou `--k` (garde de design). Restent à part la lecture d’un graphique sous le curseur et le geste de la marque du siège, décidés avant la 4.0.
- **Une plaque n’est jamais décorative.** Elle affiche un état réel du système qu’elle accompagne.

Quatre axes, repris de la Ligne V2 :

- **Forme → catégorie.** Triangle : un signal. Plaque : l’artefact. Fiche : un document. Disque : le siège.
- **Code → identité.** `SK-ART-002-{version}`, en clair et en Code 128.
- **Trait → état.** Plein : publié, en service. Tireté : prévu, proposé, en conception. Pointillé : au-delà de l’horizon.
- **Couleur → autorité.** Ivoire selon le fond, or pour ce qui vit, glacier pour la technique, rouge pour le niveau 3.

## 01. Matières

| Rôle | Jeton | Valeur |
| --- | --- | --- |
| Nuit · châssis, rail, barres | `--bg-void`, `--bg-0` | `#07080C` |
| Sol · fond de travail | `--bg-1` | `#0D0E12` |
| Plaque · panneaux | `--bg-2` | `#14151A` |
| Usiné · actif, champs | `--bg-3` | `#1C1D23` |
| Trait appuyé | `--bg-4` | `#25262D` |
| Trait · filets | `--line-1` | `#25262C` |
| Arête | `--line-2` | `#36373F` |
| Fantôme · repères | `--line-3`, `--ghost` | `#4B4E57` |
| Ivoire · encre sur la nuit | `--text-0` | `#F5F2EA` |
| Acier chaud | `--text-1` | `#B9B4A9` |
| Graphite chaud · légendes | `--text-2`, `--text-3`, `--text-4` | `#8F8A80` |

Lumière blanche des contours (4.1) : `--light-line`, le filet fin d’un bouton d’action (ivoire à 18 %) ; `--light-edge`, la lumière zénithale posée sur une arête haute (bouton, fenêtre). Aucun bouton d’action n’a de contour transparent (garde de design).

Contraste minimum 4,5:1 pour tout texte lisible sur la Plaque et sur l’Usiné (garde de design). `--ghost` n’est jamais une couleur de texte lisible : repères `+` seulement (l’annotation verticale du bord est retirée en 4.1).

Le papier est l’autre matière : l’en-tête de la fiche d’accès, le bouton principal chanfreiné, la bande et l’onglet de langue du lanceur. Sur la nuit il est ivoire.

| Rôle | Jeton | Valeur |
| --- | --- | --- |
| Ivoire · papier | `--ivory` | `#F5F2EA` |
| Pierre · papier de jour | `--stone` | `#E6E2DA` |
| Encre | `--ink` | `#0B0B0B` |
| Encre douce | `--ink-soft` | `#5E5B55` |
| Or d’encre · l’or imprimé | `--gold-ink` | `#846300` |

Encre, encre douce et or d’encre se lisent à 4,5:1 au moins sur l’ivoire (garde de design).

## 02. Signaux

| Rôle | Jeton | Valeur |
| --- | --- | --- |
| LED · ce qui vit, l’autorité | `--gold` | `#CCB066` |
| Signal · niveau 3, et lui seul | `--signal` | `#E10600` |
| Gain | `--mint` | `#74C69D` |
| Perte | `--ember` | `#E0735F` |
| Glacier · la technique | `--ice` | `#9DB4FF` |

`--pos` vaut `--mint`, `--neg` vaut `--ember`. `--lab` vaut `--gold` : la languette du Lab prend l’or ; elle n’est pas un état et n’entre pas dans les modules. `--ice` dit la technique (outils, liens, indicateurs) ; `--violet` et `--amber` restent catégoriels (types de liens des notes, impact du calendrier, séries), en attendant que la forme les remplace.

Trois niveaux de signal, dits par la forme du triangle :

1. **Veille** — contour seul. Une alerte armée, une échéance.
2. **Attention** — contour et barre intérieure. Une borne approchée.
3. **Critique** — triangle plein, `--signal`. Kill switch engagé, borne franchie, compte réel armé. Le toast d’erreur porte un filet `--signal`.

Une LED est un point de 5 px et son halo, or, jamais animée, jamais décorative. Seule exception : la LED de relais de la construction du démarrage (§ 08), qui quitte le centre du logotype et se pose sur la pointe du Λ.

## 03. Textures

- Grain et balayage : un calque fixe, sous les plaques opaques, sans `mix-blend-mode` ni `feTurbulence`. Grain PNG 180×180 dans `src/design/textures/`. Balayage `repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0 1px, transparent 1px 3px)`.
- Trame T.03 : intérieur du lecteur seulement.
- Hachure `--hatch-neg` : drawdown et zone au-delà d’une borne.
- Règle pointillée `--rule-dots` : libellé ···· valeur.

## 04. Voix

- `--font-display`, `--font-ui` : Instrument Sans, largeur 75 à 100 %, graisse 400 à 700. Corps 13–14 px.
- `--font-mono` : Geist Mono. Repères 10 px minimum, capitales, `letter-spacing: 0.14em`.
- `--font-name` : IBM Plex Sans 500. Le nom (SIΞRRΛSKΛ, CΛNTO) et le grec ; seconde famille des deux autres, elle leur fournit Λ et Ξ.
- `--font-readout` : Doto Variable 800, un seul lecteur par écran, sur sa plaque.
- `--value-stretch` : 82 %, la largeur de l’afficheur (valeurs de tuile).
- Aucun texte sous 10 px (l’annotation verticale du bord, seule exception jusqu’à la 4.0, est retirée).

Les polices sont embarquées : `src/design/fonts.css` et ses fichiers woff2, chacun avec sa licence SIL OFL 1.1 (`src/design/fonts/OFL-*.txt`), et `@fontsource-variable/doto`. Aucun appel réseau, aucune police Google.

## 05. Chiffres

`montantParts` sépare le signe (moins U+2212), les groupes de trois (marge `0.22em`, pas U+202F, absent de Doto) et les décimales à 60 % en Graphite, derrière le séparateur décimal de la langue (`decimalMark` : virgule en français et en espagnol, point en anglais). Zéro arrondi sans signe. Une valeur n’a pas de plus ; un négatif garde son moins. Le signe plus reste réservé aux P&L, aux variations et aux écarts. `aria-label` conserve U+202F et U+2212. Chiffres tabulaires partout.

## 06. Détails

Châssis : titre 44, rail 220, état 28, zone de travail `24px 40px 22px`, intervalle 18. Rail sans catégorie (4.1, décision de l’ADMIN, 2026-10-27 : « bordereau » et « en conception » sont retirés) : chaque onglet est une cartouche (décision de l’ADMIN, 2026-10-27) — un filet d’un pixel à l’ivoire très bas (6 %), le coin chanfreiné `--chamfer`, un fond à peine levé (1,5 %), 48 px, 8 px entre deux —, l’emblème du module en tête (§ 09, 20 px), le nom, dessous ce que le module contient, et le numéro du raccourci en code, au coin, sous le chanfrein : il ne se colle plus au nom, et la ligne du nom lui laisse sa place (trop longue, le nom cède à l’ellipse, jamais le badge LIEN). Quand le rail n’a plus que 704 px de haut, marges ôtées (il se mesure lui-même, sous le zoom du desk comme sous celui du navigateur : fenêtre minimale, zoom relevé, bande du kill switch), les cartouches passent à 44 px, 4 px entre deux, le compte les suit et le pied se resserre ; à 1180 × 720 au zoom 100 %, les neuf et le compte tiennent sans défiler. S’il faut encore défiler, la barre, fine, passe dans la marge droite du rail : les cartouches gardent la largeur du compte. Ce que contient le module ne se coupe jamais : trop long, il passe à la ligne, deux lignes au plus, et ne se brise qu’entre ses parties (« 2 notes · » / « 472 liens ») ; la cartouche s’allonge pour la porter et ne s’écrase jamais : à l’étroit, la nav défile. L’onglet ouvert s’éclaire, plus légèrement qu’avant : le filet s’éclaircit (18 %), la lumière zénithale se pose sur son arête haute, le fond se lève à peine, éclairé d’en haut, l’emblème passe à l’or ; il garde la nuit (ni onglet poinçonné d’ivoire, ni filament d’or au bord). Au passage du pointeur, le filet et le fond montent d’un ton. Au focus clavier, le filet passe à l’or et suit le chanfrein (l’anneau du desk, tracé au-dehors, serait rogné par la nav). Compte : la même cartouche, sans intitulé (décision de l’ADMIN, 2026-10-27 : la ligne `COMPTE ACTIF ····` est retirée ; l’encart garde ce nom pour les lecteurs d’écran) ; un compartiment, séparé par un filet d’un pixel comme une étiquette du Lab, porte sa micro — le pont (1) dont la borne devient le coffre (124), le voyant de 6 px au cœur du coffre (allumé : exécutions en direct ; atténué : pont connecté, en veille ; anneau : hors ligne) —, puis le nom (12 px) et la source dessous. Le sceau suit le compte sans filet. Version (4.1) : seule en haut à droite de la barre de titre, sans micro à côté (le losange du secteur S.01 est retiré) ; elle ouvre le journal ; point LED après le numéro tant que la version n’est pas lue. La cellule de mise à jour ne paraît que quand une mise à jour est disponible. Chanfrein `--chamfer` : une action principale par écran, fond Ivoire, texte Nuit. Étiquette `[ ORB ]` sur une ligne, tronquée au-delà de 14 caractères. En-tête de module (4.1) : le numéro d’afficheur et le nom sur une ligne, rien dessous — ni code ni baseline (« journal quantitatif », « graphique avancé »…) ; la couche du Lab par son seul composant, après le nom ; un relevé du module sur la même ligne ; le bloc-titre à même la nuit, filets d’un pixel ; les actions en haut à droite. À l’étroit (fenêtre minimale, zoom relevé), le numéro et le nom ne cèdent jamais : le relevé s’abrège, les actions passent à la ligne sous le titre, alignées à droite. Un sous-onglet ouvert s’allume d’un filet d’or qui se déplie sous son nom. Une note de portée ne parle que quand l’onglet s’écarte des filtres de l’en-tête. Sous un titre, rien de décoratif : un sous-titre de panneau ou de fenêtre ne porte qu’une donnée réelle (un nombre, un compte, un plan, une date) ou le format qu’un import attend ; les accroches sont retirées (garde de design). Le desk ne dit jamais où vit son coffre : ni « reste sur ce poste », ni « ne quitte pas la machine » (garde de design). Options d’un module (4.1) : au bout de la ligne de l’en-tête, en haut à droite, le bouton d’action « Options » (`src/design/OptionsMenu.tsx`) ; chaque état qu’il contient s’y lit en point de couleur — anneau graphite au repos, la couleur de l’état quand il vit ; son menu se déroule sous lui (300 ms), chaque option entre à son tour (24 ms d’écart), composant de la planche en tête, lecture à droite, filet entre les groupes ; clavier complet (↑ ↓ Début Fin Échap). Les actions principales restent visibles ; les outils et réglages secondaires (pont, séance manuelle, exports, coffre, réglages, démo, synchro, dates estimées, mode discret…) passent dans les options.

Verrou (4.1, décision de l’ADMIN, 2026-10-27) : le sceau à gauche, la fiche d’accès à droite, plus large (540 px) ; ni plaque en haut à droite, ni phrase sous le titre, ni ligne de classe au pied. La fiche porte la phrase et « Coller » dans un même cadre — dans le desk, le process principal colle dans le champ qui a le focus : la fenêtre au premier plan seulement, juste après un geste réel de l’opérateur (souris, clavier, toucher), un collage par geste, et plus du tout une fois le verrou passé ; refusé, le bouton montre le raccourci (Ctrl+V). Le renderer ne lit pas le presse-papiers lui-même —, « Fermer CΛNTO » à gauche pour qui n’a pas la phrase, « Ouvrir » chanfreiné à droite. L’ouverture (4.1, décision de l’ADMIN, 2026-10-27 ; `src/app/unlockCircuit.ts`) : le desk se monte dessous, et deux images plus tard la phrase se défait en glyphes, au pas du code d’accolades (85 ms d’écart, 340 ms de vie, les lettres du Lab), pendant que la fiche s’efface autour d’eux ; chaque glyphe se pose en pastille et pousse sa piste sur sept voies qui ne se croisent jamais, jusqu’à la pointe de l’horizon du sceau — des montées parallèles, à 45° quand la place le permet, plus raides d’autant dans une fenêtre basse — — la voie du milieu, sur l’horizon, à l’or. La lumière rallume alors les lignes du sceau, ses tracés mêmes du master posés sur les siens : l’horizon d’une pointe à l’autre, puis les trois anneaux, du dehors au dedans. Le point d’or s’allume au centre ; le sceau glisse au centre de l’écran (0,5 s) et se plie dans son horizon (0,24 s), à l’horloge de sa lumière ; le point d’or s’y embrase, s’étire en ligne d’or sur l’axe, et « DESK UNLOCKED » s’en déplie. Le circuit du chargement s’étend jusqu’aux bords autour du mot (ivoire, l’axe à l’or), ses cadres se retirent, les lignes du châssis — barre de titre, rail, barre d’état — se tracent là où sont celles du desk, et le voile se lève sur un desk déjà formé. Environ 4 s pour une phrase de quatorze caractères ; une touche ou un clic abrège (les seules lignes du châssis, le voile se lève). Mouvement réduit : ni glyphes ni circuit ; le mot paraît, le verrou s’efface. Jauge : piste 8 px, remplissage 3 px, curseur, repère issu d’une donnée ou d’une constante nommée.

## 07. Signature

Bas du rail (4.1, décision de l’ADMIN, 2026-10-27) : la plaque se réduit à sa marque — le sceau Horizon du Lab, 76 px, gravé dans la nuit (encre d’ivoire assourdie, ombre d’un pixel au-dessus, reflet d’un pixel dessous), le même qu’au verrou —, puis les langues. La cartouche `SK-ART-002` quitte le rail. « 4.1 » est la révision de ce système, pas le numéro de l’application. La barre d’état est du noir du châssis, comme la barre de titre (décision de l’ADMIN, 2026-10-26 : la bande d’étiquette ivoire est retirée) ; elle se termine par le nom d’un siège, s’il y en a un, à l’or ; puis le code d’accolades, `{` onze barres de 1 à 3 px `}`, dont les largeurs sont tirées à chaque ouverture du desk (somme fixe : le code ne change jamais de place) ; puis le losange strié et `[ SIΞRRΛSKΛ ]`. Deux secondes sur le code l’éveillent en `<insert code>` (`docs/SIEGE-NOMINATIF.md`). Le sceau Horizon frappe au démarrage, ferme le verrou et signe, gravé, le pied du rail ; nulle part ailleurs. Son horizon (48,27 % de sa hauteur) est l’axe du logotype.

## 08. Marque et logotype

Logotype : grille 640 × 160 au pas de 8, capitale 96 (y 32 → 128), axe y 80, centré sur x 320. Le C et le O ont un rayon optique de 49,5 (débord de 1,5 u), la pointe du Λ monte à y 30 (débord de 2 u). Source unique `src/design/Wordmark.tsx` ; `electron/launcher.html` en garde une copie, vérifiée par les tests. Trait de 1,25 px à toute taille, halo à 16 %. Barre de titre : 84 px, amorces des lignes de capitale et de pied au repos ; à l’appui, les trois guides et quatre ancres (pointe du Λ, barre du T, flanc du O).

Construction (démarrage) : guides, cote `640 × 160 · 8 PX`, tracé lettre par lettre avec une pointe lumineuse, ancres et relevés au passage, balayage, halo. La LED attend au centre du logotype, se pose sur la pointe du Λ, s’y embrase au passage du tracé ; la ligne `SIΞRRΛSKΛ LAB ● ARTEFACT 002` reprend le point. Le démarrage ne s’ouvre pas avant la fin ; une touche ou un clic l’abrège. Mouvement réduit : logotype affiché directement, sans grille ni LED.

Marque : le Λ en construction sur une grille 256 — pieds sur la ligne de pied, pointe au-dessus de la capitale, LED carrée à la pointe, guides, cote et ancres aux pieds. Tailles optiques : à 32 px et moins, le Λ et la LED restent seuls. Sources et générateur : `docs/design/3.2.2/marque/`. Livrés : `build/logo.svg` (72, encart du lanceur), `build/icon.png` (1024), `build/icon.ico` (16, 24, 32, 48, 64, 128, 256, chaque taille dessinée pour elle-même).

## 09. Micrographies du Lab

Plaques HUD, cartouches et composants de la planche des 150 viennent des masters de la Ligne V2 (Rév. A, packs Fox Rockett Studio achetés ; diffusion dans ce dépôt confirmée par l’ADMIN le 2026-10-26), textes réécrits en place. Source générée : `src/design/micro/assets.ts` (ne pas éditer à la main) ; composants : `src/design/Micro.tsx` (`Glyph`, `Plate`, `Cartouche`, `Signal`). L’encre est `--k`, le papier `--p` : chaque zone les règle. Chaque micrographie nomme une fonction ou lit un état ; aucune ne décore.

- **Plaques** (emplacements liés à l’état réel ; un emplacement sans valeur se lit « — ») : une seule reste au desk, `critical` (bande du kill switch, la sécurité). Les autres sont retirées en 4.1, chacune parce que ce qu’elle lisait est dit une fois ailleurs : `seal` et `artefact` (démarrage et lanceur : la version se lit en haut à droite du desk et dans la bande du lanceur), `access` (verrou), `agentGuard` (la notice des ordres de l’agent dit le compte Sim, le dialogue et son délai, et nomme le kill switch avec le raccourci lu au pont), `equity` (la lecture au-dessus de la courbe A.02 dit le cumul et l’écart au plus haut, les cartes K les statistiques), `timeEngine` (la séance dans la barre d’état, la synchro dans la barre d’outils et le menu Options du Calendrier, les catalyseurs dans le panneau du jour), `signal` (l’état de chaque alerte sur sa ligne, le direct du prix sur la ligne de son marché), `link` (le flux du chart sur sa puce, l’état des venues à la section Source). Leurs masters restent dans `assets.ts`, généré hors du dépôt.
- **Cartouches** : `artefact` (retirée du rail en 4.1 : le sceau gravé la remplace), `signal3` (bande du kill switch, le seul rouge), `sectorS01` (retirée de la barre de titre en 4.1 : la version y est seule). Les bandes `layerL01`…`layerL05` quittent l’en-tête de module (4.1) : la couche s’y dit par son seul composant.
- **Composants** (numéro de la planche entre parenthèses) : signaux orbite (131), rayonnement (12), cercle barré (123) ; emblèmes du rail — Métrique (16), Visual (26), Calendrier (121), Note (91), Portefeuille (130), Agent (29), Bot (103), Copieur (148), Crypto (150) ; outils — pont (1), séance manuelle (69), CSV (88), coffre (124), restaurer (141), réglages (62) ; compte du rail — le pont (1) et le coffre (124) assemblés, chacun montrant la part de son dessin qui sert (le pont jusqu’au bout de sa ligne, le coffre depuis son carré), le voyant au cœur ; zoom « + — » (68, retiré de la barre de titre en 4.1 : − et + y sont deux traits nets de part et d’autre de la valeur), interrupteur (30), synchro (87), maintenant (27, or), horizon (96), borne du plancher (126), cible (85), mire du creux (142), seuils (106, 107), globe des places (44), flèches (45, 46, 108, 82), règle (31), étoile de séparation (135), losange strié (10). Graisse (4.1) : au rail (20 px) et à l’en-tête (couche, 18 px), chaque composant rend un trait d’environ un demi-pixel ; les masters fins, un trait de 0,75 sur une grande boîte (Visual 26, Note 91, Portefeuille 130, Agent 29), sont relevés par la feuille du châssis, leur dessin intact.
- **Un seul code-barres** au châssis : le code d’accolades de la barre d’état, en bas à droite. Le vrai Code 128 `SK-ART-002-{version}` reste au lanceur et au pied du bilan du Portefeuille. Aucun DataMatrix ni QR ailleurs ; une cartouche reçoit une règle ou un glyphe à la place de ses codes.

## 10. Lanceur AUBE

L’aube sur l’horizon : l’horizon se trace en lentille du sceau, le sceau frappe puis se plie dans la ligne, la LED or se lève et se pose sur la pointe du Λ, le logotype se construit sur sa grille (axe y 80 = l’horizon), la ligne du Lab se resserre dessous. Aucune plaque (4.1, décision de l’ADMIN, 2026-10-27) : la version et l’état se lisent une fois, dans la ligne d’état, le canal et la latence dans la bande ; le ciel reste vide. La langue choisie s’allume (lueur blanche, filet d’or au pied) ; l’ivoire reste à la seule action principale ; le passage du pointeur est une lumière, comme au desk. Signal par glyphe ; rouge au seul échec. Au départ, chaque trait de la graduation est une étape comptée, le sceau se rouvre en filets puis se replie avec le logotype, la LED reste seule. Une touche ou un clic abrège ; mouvement réduit : état de repos d’emblée. Un seul Code 128, en bas à droite. Icône : le Λ et sa LED carrée, passée à l’or.

## Règles de cette révision

- Les noms des jetons ne bougent pas ; seules les valeurs changent. Un jeton nouveau passe par une décision de l’ADMIN (Ligne V2 · Rév. B, décisions D1 à D12).
- Le balayage reste sous les plaques.
- Pas de nom de connexion (le pont ne le transmet pas).
- `LEVERAGE_WARN` (4) est un seuil d’affichage. La limite de drawdown vient du plan filtré, ou n’est pas affichée.
- Les modules non redessinés héritent des jetons.
