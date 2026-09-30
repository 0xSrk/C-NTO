# Système visuel — CΛNTO · révision 3.4

Révision du système, pas de la version de l’application. Les mesures viennent des planches `docs/design/3.2/` (étapes Système 01 à 13) ; marque, logotype et rail 3.2.2 : `docs/design/3.2.2/`. L’ancien texte est dans `docs/design/archive/DESIGN-v1.md`. Le lanceur AUBE garde ses propres jetons et Inter.

## 01. Matières

| Rôle | Jeton | Valeur |
| --- | --- | --- |
| Carbone · châssis, rail, barres | `--bg-void`, `--bg-0` | `#0A0B0D` |
| Sol · fond de travail | `--bg-1` | `#0F1013` |
| Plaque · panneaux | `--bg-2` | `#16171B` |
| Usiné · actif, champs, survol | `--bg-3` | `#1E2025` |
| Trait appuyé | `--bg-4` | `#24262B` |
| Trait · filets | `--line-0`, `--line-1` | `#24262B` |
| Arête | `--line-2` | `#33363D` |
| Fantôme · repères | `--line-3`, `--ghost` | `#4A4E55` |
| Encre | `--text-0` | `#EDEBE4` |
| Acier | `--text-1` | `#A3A7AF` |
| Graphite · légendes | `--text-2`, `--text-3`, `--text-4` | `#80858E` |

Contraste minimum 4,5:1 pour tout texte lisible sur la plaque. `--ghost` n’est jamais une couleur de texte lisible : annotation verticale du bord (9 px, `aria-hidden`) et repères `+`.

## 02. Signaux

| Rôle | Jeton | Valeur |
| --- | --- | --- |
| LED · vivant, à regarder | `--gold` | `#E5263D` |
| Gain | `--mint`, `--pos` | `#74C69D` |
| Perte | `--ember`, `--neg` | `#E0735F` |
| Point et languette du Lab | `--lab` | `#ED5D0B` |

`--lab` n’est pas un état et n’entre pas dans les modules. `--ice`, `--violet`, `--amber` restent catégoriels : notes (types de liens), calendrier (impact), graphiques (séries). Ailleurs ils sont retirés.

Une LED est un point de 5 px et son halo, jamais animée, jamais décorative. Seule exception : la LED de relais de la construction du Boot (§ 08), qui passe du centre du logotype à la pointe du Λ, puis s’éteint.

## 03. Textures

- Grain et balayage : un calque fixe, sous les plaques opaques, sans `mix-blend-mode` ni `feTurbulence`. Grain PNG 180×180 dans `src/design/textures/`. Balayage `repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0 1px, transparent 1px 3px)`.
- Trame T.03 : intérieur du lecteur seulement.
- Hachure `--hatch-neg` : drawdown et zone au-delà d’un seuil.
- Règle pointillée `--rule-dots` : libellé ···· valeur.
- Code-barres : trois pas 3 / 7 / 17, barre d’état et bilan, `aria-hidden`.

## 04. Caractères

- `--font-display` Archivo Variable, `font-stretch: 125%`, 700. Titre de module 44 px, `letter-spacing: -0.015em`.
- `--font-ui` Archivo Variable, stretch 100 %, 400–600. Corps 13–14 px. Valeur de tuile 28 px, 600, stretch 112 %.
- `--font-readout` Doto Variable 800, un seul lecteur par écran.
- `--font-mono` JetBrains Mono Variable. Repères 10 px minimum, capitales, `letter-spacing: 0.14em`. JetBrains est aussi la seconde famille d’Archivo : elle porte Λ et Ξ.
- Seule exception sous 10 px : l’annotation verticale du bord de travail.

Les polices sont embarquées (`@fontsource-variable`). Aucun appel à Google Fonts.

## 05. Chiffres

`montantParts` sépare le signe (moins U+2212), les groupes de trois (marge `0.22em`, pas U+202F, absent des trois polices) et les décimales à 60 % en Graphite. Zéro arrondi sans signe. Une valeur n’a pas de plus ; un négatif garde son moins. Le signe plus reste réservé aux P&L, aux variations et aux écarts. `aria-label` conserve U+202F et U+2212. Chiffres tabulaires partout.

## 06. Détails

Châssis : titre 44, rail 220, état 28, zone de travail `24px 40px 22px`, intervalle 18. Actif du rail : fond Usiné, filet intérieur haut, carré 5 px. Compte actif à même le rail, sans carte : libellé `COMPTE ACTIF ····`, voyant de 6 px devant le nom (allumé : exécutions en direct ; atténué : pont connecté, en veille ; anneau : hors ligne), source dessous. Version sous le compte : `VERSION ···· v3.2.2`, point LED après le numéro tant que la version n’est pas lue. Chanfrein `--chamfer` : une action principale par écran, fond Encre, texte Carbone. Étiquette `[ ORB ]` sur une ligne, tronquée au-delà de 14 caractères. Jauge : piste 8 px, remplissage 3 px, curseur, repère issu d’une donnée ou d’une constante nommée.

## 07. Signature

Bas du rail : plaque signature gravée à même le rail, 40 px de haut : cuvette d’un pixel (arête sombre en haut, reflet en bas), fond carbone, sans vis ni languette. Celles-ci restent réservées au lecteur principal (D.01). Gravure `SIΞRRΛSKΛ` en or au burin, `ARTEFACT` en ivoire, numéro en or, repères de calage aux coins, micro-texte sur l’arête basse. Les ors (`--or-*`) restent locaux à la plaque. Horloge `HH:MM:SS ET`. La version `v{APP_VERSION}` est dans le rail (§ 06) : « 3.4 » est la révision de ce système, pas le numéro de l’application. La barre d’état se termine par le code-barres et `[ SIΞRRΛSKΛ ]` ; `SRK—LAB / ART-002` reste dans la barre de titre.

## 08. Marque et logotype

Logotype : grille 640 × 160 au pas de 8, capitale 96 (y 32 → 128), axe y 80, centré sur x 320. Le C et le O ont un rayon optique de 49,5 (débord de 1,5 u), la pointe du Λ monte à y 30 (débord de 2 u). Source unique `src/design/Wordmark.tsx` ; `electron/launcher.html` en garde une copie, vérifiée par les tests. Trait de 1,25 px à toute taille, halo à 16 %. Barre de titre : 84 px, amorces des lignes de capitale et de pied au repos ; au survol, les trois guides et quatre ancres (pointe du Λ, barre du T, flanc du O).

Construction (Boot, 2,1 s) : guides, cote `640 × 160 · 8 PX`, tracé lettre par lettre avec une pointe lumineuse, ancres et relevés au passage, balayage, halo. La LED du lanceur attend au centre du logotype, se pose sur la pointe du Λ, s’y embrase au passage du tracé, puis s’éteint ; la ligne `SIΞRRΛSKΛ LAB ● ARTEFACT 002` reprend le point. Le Boot ne s’ouvre pas avant la fin ; une touche ou un clic l’abrège. Mouvement réduit : logotype affiché directement, sans grille ni LED.

Marque : le Λ en construction sur une grille 256 — pieds sur la ligne de pied, pointe au-dessus de la capitale, LED carrée à la pointe, guides, cote et ancres aux pieds. Tailles optiques : à 32 px et moins, le Λ et la LED restent seuls. Sources et générateur : `docs/design/3.2.2/marque/`. Livrés : `build/logo.svg` (72, encart du lanceur), `build/icon.png` (1024), `build/icon.ico` (16, 24, 32, 48, 64, 128, 256, chaque taille dessinée pour elle-même).

## Règles de cette révision

- Le balayage reste sous les plaques.
- Pas de nom de connexion (le pont ne le transmet pas).
- `LEVERAGE_WARN` (4) est un seuil d’affichage. La limite de drawdown vient du plan filtré, ou n’est pas affichée.
- Les modules non redessinés héritent des jetons. Les sous-onglets B à E de Métrique et les vues du Portefeuille autres que la synthèse ne sont pas redessinés.
