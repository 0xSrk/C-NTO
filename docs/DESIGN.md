# Système visuel — CΛNTO · révision 3.4

Révision du système, pas de la version de l’application. Les mesures viennent des planches `docs/design/3.2/` (étapes Système 01 à 13). L’ancien texte est dans `docs/design/archive/DESIGN-v1.md`. Le lanceur AUBE garde ses propres jetons et Inter.

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

Une LED est un point de 5 px et son halo, jamais animée, jamais décorative.

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

`montantParts` sépare le signe (moins U+2212), les groupes de trois (marge `0.22em`, pas U+202F, absent des trois polices) et les décimales à 60 % en Graphite. Zéro arrondi sans signe. Une valeur de stock passe `sign: false` : ni plus ni moins. Le signe reste réservé aux P&L, aux variations et aux écarts. `aria-label` conserve U+202F et U+2212. Chiffres tabulaires partout.

## 06. Détails

Châssis : titre 44, rail 220, état 28, zone de travail `24px 40px 22px`, intervalle 18. Actif du rail : fond Usiné, filet intérieur haut, carré 5 px. Chanfrein `--chamfer` : une action principale par écran, fond Encre, texte Carbone. Étiquette `[ ORB ]` sur une ligne, tronquée au-delà de 14 caractères. Jauge : piste 8 px, remplissage 3 px, curseur, repère issu d’une donnée ou d’une constante nommée.

## 07. Signature

`SIΞRRΛSKΛ`, point `--lab`, `DEEP TECH LAB`, règle `ARTEFACT ······ 002 / 001 OS`. Horloge `HH:MM:SS ET`. La barre d’état affiche `v{APP_VERSION}` : « 3.4 » est la révision de ce système, pas le numéro de l’application.

## Règles de cette révision

- Le balayage reste sous les plaques.
- Pas de nom de connexion (le pont ne le transmet pas).
- `LEVERAGE_WARN` (4) est un seuil d’affichage. La limite de drawdown vient du plan filtré, ou n’est pas affichée.
- Les modules non redessinés héritent des jetons. Les sous-onglets B à E de Métrique et les vues du Portefeuille autres que la synthèse ne sont pas redessinés.
