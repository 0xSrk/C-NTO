# Système visuel — CΛNTO · révision 4.0 « ΟΡΟΣ »

Révision du système, pas de la version de l’application. Le Système 4.0 fond le Système 3.4 du desk et la Ligne V2 « Poinçon » du Lab : la nuit, la grille, le chanfrein, le lecteur et le logotype restent ; le sceau, l’ivoire, l’or, les trois voix, les cartouches et les vrais codes arrivent. Le texte de la révision 3.4 est dans `docs/design/archive/DESIGN-3.4.md`, celui de la v1 dans `docs/design/archive/DESIGN-v1.md`. Le lanceur AUBE garde ses propres jetons et Inter.

## 00. Doctrine

Un desk est un instrument de bornes : perte du jour, plancher de drawdown, plafond de 1 à 1000, comptes `Sim*`, kill switch. En grec, ὅρος est la borne, et la racine d’ὁρίζων, l’horizon — « ce qui borne ». Le sceau du Lab trace déjà cette ligne ; le lanceur AUBE se lève sur elle. Le 4.0 en fait la grammaire du desk.

- **Ce qui vit est or ; seul ce qui franchit la borne est rouge.** `--gold` est la LED : la dernière séance, le direct, la mise à jour, l’autorité. `--signal` est le niveau 3 et lui seul. Le rouge marque — triangle, filet, hachure — et n’écrit jamais : le texte d’un niveau 3 reste ivoire.
- **Rien ne réagit au passage du pointeur.** L’appui, le focus et la sélection se voient ; le survol, non. Aucune règle `:hover` dans `src/` (garde de design). Restent hors de la règle la lecture d’un graphique sous le curseur et le geste de la marque du siège, décidés avant cette révision.
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

Châssis : titre 44, rail 220, état 28, zone de travail `24px 40px 22px`, intervalle 18. Actif du rail : fond Usiné, filet intérieur haut, carré 5 px. Compte actif à même le rail, sans carte : libellé `COMPTE ACTIF ····`, voyant de 6 px devant le nom (allumé : exécutions en direct ; atténué : pont connecté, en veille ; anneau : hors ligne), source dessous. Version sous le compte : `VERSION ···· v{APP_VERSION}`, point LED après le numéro tant que la version n’est pas lue. Chanfrein `--chamfer` : une action principale par écran, fond Ivoire, texte Nuit. Étiquette `[ ORB ]` sur une ligne, tronquée au-delà de 14 caractères. Jauge : piste 8 px, remplissage 3 px, curseur, repère issu d’une donnée ou d’une constante nommée.

## 07. Signature

Bas du rail : plaque signature gravée à même le rail, 40 px de haut : cuvette d’un pixel (arête sombre en haut, reflet en bas), fond nuit, sans vis ni languette. Celles-ci restent réservées au lecteur principal (D.01). Gravure `SIΞRRΛSKΛ` au burin, `ARTEFACT` en ivoire, numéro gravé, repères de calage aux coins, micro-texte sur l’arête basse. Les ors de la plaque restent locaux à la plaque. La version `v{APP_VERSION}` est dans le rail (§ 06) : « 4.0 » est la révision de ce système, pas le numéro de l’application. La barre d’état se termine par le code-barres et `[ SIΞRRΛSKΛ ]` ; `SRK—LAB / ART-002` reste dans la barre de titre.

## 08. Marque et logotype

Logotype : grille 640 × 160 au pas de 8, capitale 96 (y 32 → 128), axe y 80, centré sur x 320. Le C et le O ont un rayon optique de 49,5 (débord de 1,5 u), la pointe du Λ monte à y 30 (débord de 2 u). Source unique `src/design/Wordmark.tsx` ; `electron/launcher.html` en garde une copie, vérifiée par les tests. Trait de 1,25 px à toute taille, halo à 16 %. Barre de titre : 84 px, amorces des lignes de capitale et de pied au repos ; à l’appui, les trois guides et quatre ancres (pointe du Λ, barre du T, flanc du O).

Construction (démarrage) : guides, cote `640 × 160 · 8 PX`, tracé lettre par lettre avec une pointe lumineuse, ancres et relevés au passage, balayage, halo. La LED attend au centre du logotype, se pose sur la pointe du Λ, s’y embrase au passage du tracé ; la ligne `SIΞRRΛSKΛ LAB ● ARTEFACT 002` reprend le point. Le démarrage ne s’ouvre pas avant la fin ; une touche ou un clic l’abrège. Mouvement réduit : logotype affiché directement, sans grille ni LED.

Marque : le Λ en construction sur une grille 256 — pieds sur la ligne de pied, pointe au-dessus de la capitale, LED carrée à la pointe, guides, cote et ancres aux pieds. Tailles optiques : à 32 px et moins, le Λ et la LED restent seuls. Sources et générateur : `docs/design/3.2.2/marque/`. Livrés : `build/logo.svg` (72, encart du lanceur), `build/icon.png` (1024), `build/icon.ico` (16, 24, 32, 48, 64, 128, 256, chaque taille dessinée pour elle-même).

## Règles de cette révision

- Les noms des jetons ne bougent pas ; seules les valeurs changent. Un jeton nouveau passe par une décision de l’ADMIN (Ligne V2 · Rév. B, décisions D1 à D12).
- Le balayage reste sous les plaques.
- Pas de nom de connexion (le pont ne le transmet pas).
- `LEVERAGE_WARN` (4) est un seuil d’affichage. La limite de drawdown vient du plan filtré, ou n’est pas affichée.
- Les modules non redessinés héritent des jetons.
