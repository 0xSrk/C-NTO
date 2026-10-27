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

Contraste minimum 4,5:1 pour tout texte lisible sur la Plaque et sur l’Usiné (garde de design). `--ghost` n’est jamais une couleur de texte lisible : annotation verticale du bord (9 px, `aria-hidden`) et repères `+`.

Le papier est l’autre matière : la bande d’étiquette et l’onglet poinçonné. Sur la nuit il est ivoire.

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
- Seule exception sous 10 px : l’annotation verticale du bord de travail.

Les polices sont embarquées : `src/design/fonts.css` et ses fichiers woff2, chacun avec sa licence SIL OFL 1.1 (`src/design/fonts/OFL-*.txt`), et `@fontsource-variable/doto`. Aucun appel réseau, aucune police Google.

## 05. Chiffres

`montantParts` sépare le signe (moins U+2212), les groupes de trois (marge `0.22em`, pas U+202F, absent de Doto) et les décimales à 60 % en Graphite. Zéro arrondi sans signe. Une valeur n’a pas de plus ; un négatif garde son moins. Le signe plus reste réservé aux P&L, aux variations et aux écarts. `aria-label` conserve U+202F et U+2212. Chiffres tabulaires partout.

## 06. Détails

Châssis : titre 44, rail 220, état 28, zone de travail `24px 40px 22px`, intervalle 18. Actif du rail : onglet poinçonné — fond Ivoire, texte Encre, carré 5 px ; sous chaque numéro, l’emblème du module (§ 09). Compte actif à même le rail, sans carte : libellé `COMPTE ACTIF ····`, voyant de 6 px devant le nom (allumé : exécutions en direct ; atténué : pont connecté, en veille ; anneau : hors ligne), source dessous. Version sous le compte : `VERSION ···· v{APP_VERSION}`, point LED après le numéro tant que la version n’est pas lue. Chanfrein `--chamfer` : une action principale par écran, fond Ivoire, texte Nuit. Étiquette `[ ORB ]` sur une ligne, tronquée au-delà de 14 caractères. Jauge : piste 8 px, remplissage 3 px, curseur, repère issu d’une donnée ou d’une constante nommée.

## 07. Signature

Bas du rail : la cartouche `SK-ART-002` de la Ligne V2 (§ 09) — nom, secteur, couches, `BUILD: v{APP_VERSION} · DESK`, plateformes ; ses emplacements de code portent le glyphe S.01 et une règle. Sous elle, la version (ouvre le journal) et les langues. « 4.0 » est la révision de ce système, pas le numéro de l’application. La barre d’état est du noir du châssis, comme la barre de titre (décision de l’ADMIN, 2026-10-26 : la bande d’étiquette ivoire est retirée) ; elle se termine par le nom d’un siège, s’il y en a un, à l’or ; puis le code d’accolades, `{` onze barres de 1 à 3 px `}`, dont les largeurs sont tirées à chaque ouverture du desk (somme fixe : le code ne change jamais de place) ; puis le losange strié et `[ SIΞRRΛSKΛ ]`. Deux secondes sur le code l’éveillent en `<insert code>` (`docs/SIEGE-NOMINATIF.md`). Le sceau Horizon frappe au démarrage et ferme le verrou, nulle part ailleurs ; son horizon (48,27 % de sa hauteur) est l’axe du logotype.

## 08. Marque et logotype

Logotype : grille 640 × 160 au pas de 8, capitale 96 (y 32 → 128), axe y 80, centré sur x 320. Le C et le O ont un rayon optique de 49,5 (débord de 1,5 u), la pointe du Λ monte à y 30 (débord de 2 u). Source unique `src/design/Wordmark.tsx` ; `electron/launcher.html` en garde une copie, vérifiée par les tests. Trait de 1,25 px à toute taille, halo à 16 %. Barre de titre : 84 px, amorces des lignes de capitale et de pied au repos ; à l’appui, les trois guides et quatre ancres (pointe du Λ, barre du T, flanc du O).

Construction (démarrage) : guides, cote `640 × 160 · 8 PX`, tracé lettre par lettre avec une pointe lumineuse, ancres et relevés au passage, balayage, halo. La LED attend au centre du logotype, se pose sur la pointe du Λ, s’y embrase au passage du tracé ; la ligne `SIΞRRΛSKΛ LAB ● ARTEFACT 002` reprend le point. Le démarrage ne s’ouvre pas avant la fin ; une touche ou un clic l’abrège. Mouvement réduit : logotype affiché directement, sans grille ni LED.

Marque : le Λ en construction sur une grille 256 — pieds sur la ligne de pied, pointe au-dessus de la capitale, LED carrée à la pointe, guides, cote et ancres aux pieds. Tailles optiques : à 32 px et moins, le Λ et la LED restent seuls. Sources et générateur : `docs/design/3.2.2/marque/`. Livrés : `build/logo.svg` (72, encart du lanceur), `build/icon.png` (1024), `build/icon.ico` (16, 24, 32, 48, 64, 128, 256, chaque taille dessinée pour elle-même).

## 09. Micrographies du Lab

Plaques HUD, cartouches et composants de la planche des 150 viennent des masters de la Ligne V2 (Rév. A, packs Fox Rockett Studio achetés ; diffusion dans ce dépôt confirmée par l’ADMIN le 2026-10-26), textes réécrits en place. Source générée : `src/design/micro/assets.ts` (ne pas éditer à la main) ; composants : `src/design/Micro.tsx` (`Glyph`, `Plate`, `Cartouche`, `Signal`). L’encre est `--k`, le papier `--p` : chaque zone les règle. Chaque micrographie nomme une fonction ou lit un état ; aucune ne décore.

- **Plaques** (emplacements liés à l’état réel ; un emplacement sans valeur se lit « — ») : `seal` (démarrage, sur l’horizon : version), `artefact` (démarrage, bas de l’écran), `access` (verrou), `critical` (bande du kill switch), `agentGuard` (garde de l’agent : comptes, dialogue, raccourci), `equity` (courbe A.02, en filigrane), `timeEngine` (calendrier : séance, catalyseurs, synchro), `signal` (alertes crypto : cible, état), `link` (flux de marché : place, websocket, latence).
- **Cartouches** : `artefact` (rail), `signal3` (bande du kill switch, le seul rouge), `layerL01`…`layerL05` (couche du module dans son en-tête), `sectorS01` (barre de titre).
- **Composants** (numéro de la planche entre parenthèses) : signaux orbite (131), rayonnement (12), cercle barré (123) ; emblèmes du rail — Métrique (16), Visual (26), Calendrier (121), Note (91), Portefeuille (130), Agent (29), Bot (103), Copieur (148), Crypto (150) ; outils — pont (1), séance manuelle (69), CSV (88), coffre (124), restaurer (141), réglages (62) ; zoom « + — » (68), interrupteur (30), synchro (87), maintenant (27, or), horizon (96), borne du plancher (126), cible (85), mire du creux (142), seuils (106, 107), globe des places (44), flèches (45, 46, 108, 82), règle (31), étoile de séparation (135), losange strié (10).
- **Un seul code-barres** au châssis : le code d’accolades de la barre d’état, en bas à droite. Le vrai Code 128 `SK-ART-002-{version}` reste au lanceur et au pied du bilan du Portefeuille. Aucun DataMatrix ni QR ailleurs ; une cartouche reçoit une règle ou un glyphe à la place de ses codes.

## 10. Lanceur AUBE

L’aube sur l’horizon : l’horizon se trace en lentille du sceau, le sceau frappe puis se plie dans la ligne, la LED or se lève et se pose sur la pointe du Λ, le logotype se construit sur sa grille (axe y 80 = l’horizon), les plaques s’impriment comme des relevés liés à l’état réel (version, canal de publication, version disponible). Signal par glyphe ; rouge au seul échec. Au départ, chaque trait de la graduation est une étape comptée, le sceau se rouvre en filets puis se replie avec le logotype, la LED reste seule. Une touche ou un clic abrège ; mouvement réduit : état de repos d’emblée. Un seul Code 128, en bas à droite. Icône : le Λ et sa LED carrée, passée à l’or.

## Règles de cette révision

- Les noms des jetons ne bougent pas ; seules les valeurs changent. Un jeton nouveau passe par une décision de l’ADMIN (Ligne V2 · Rév. B, décisions D1 à D12).
- Le balayage reste sous les plaques.
- Pas de nom de connexion (le pont ne le transmet pas).
- `LEVERAGE_WARN` (4) est un seuil d’affichage. La limite de drawdown vient du plan filtré, ou n’est pas affichée.
- Les modules non redessinés héritent des jetons.
