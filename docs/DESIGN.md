# Système visuel — CΛNTO, artefact 002 de SIΞRRΛSKΛ Lab

Lignée : le système visuel de Crepuscule (artefact 001) — laboratoire deep-tech, noir absolu, hairlines 1 px, mono capitales espacées, une seule source de lumière, aucun arrondi, aucune ombre, aucun dégradé décoratif. CΛNTO en reprend la grammaire et la pousse pour un desk de trading : plus de densité utile, une lumière dorée, un logotype tracé au trait, des équerres sur les panneaux qui comptent.

## 1. Ce qui est hérité

- Canevas `#000`, panneaux `#050505`, survol `#0b0b0b`, hairlines `#232323` / `#363636`, encre `#fff` · `#c4c4c4` · `#8a8a8a` · `#4a4a4a`, filigrane `#0f0f0f`.
- Titres **Inter 700** (`cv11`, `ss01`, `ss03`, `tnum`), libellés **JetBrains Mono** 11 px capitales `.12em` — jamais de mono sous 11 px, jamais d'Inter sous 12 px.
- Cadre : repères `+` aux quatre angles, étiquette verticale sur le rail, **onglet inversé** (un seul par écran : `CΛNTO · ARTEFACT 002`), carré hachuré au pied du rail, filigrane du code de module derrière le titre de page.
- Pastille live : hairline + point 6 px, sans fond ; barres de progression 2 px ; sélection de table = filet 2 px ; puces actives en blanc inversé.
- Lumière : lumière de salle (radial haut-gauche, dérive 40 s), deux faisceaux diagonaux ultra-faibles (90 s / 140 s), bande rasante sous le header, vignette, grain `.035`. Rien au-dessus de `.035` d'alpha en blanc.
- Mouvement : `--ease-out cubic-bezier(.16,1,.3,1)`, 120 / 220 / 420 ms ; cascade des panneaux (320 ms, 35 ms par panneau), barres animées depuis 0, chiffres clés interpolés (380 ms), respiration de la LED 2,4 s ; `prefers-reduced-motion` respecté partout.

## 2. Ce qui distingue CΛNTO

| Trait | Crepuscule (001) | CΛNTO (002) |
| --- | --- | --- |
| Source de lumière | LED orange `#ff4a00` | **LED dorée `#d3ab53`** — `--glow-accent`, filet actif de la nav, verrou des interrupteurs, sélection |
| Wordmark | `SIΞRRΛSKΛ—LAB` mono | **CΛNTO tracé au trait** (SVG, traits 1,1 px non mis à l'échelle) + `SIΞRRΛSKΛ—LAB` mono `.22em` |
| Chargement | — | Séquence de traçage du logotype avec guides de construction, glint le long des traits, faisceaux, journal d'initialisation réel |
| Panneaux | Cellules hairline | Cellules hairline ; **équerres dorées** aux angles des panneaux en relief / sélectionnés uniquement |
| Densité | Cartes larges, 38 px de contrôle | Desk dense : boutons 32 px, puces 28 px, tables 36 px, grilles de statistiques en treillis 4 × n |
| Couleurs fonctionnelles | `#7fbf8f` / `#d9776b` | `#7fcf9a` / `#e0776c` + glace `#8fc7e8` (données), violet `#a996e0` (volatilité), ambre `#d8b45a` (avertissements) — en texte et filets uniquement |
| Graphique | VWAP blanc, bougies désaturées | Même règle ; marqueurs de trades dorés pour les sorties gagnantes, gris sinon |

Règle commune conservée : le vert et le rouge portent un sens (direction, PnL, statut) ; l'or n'apparaît qu'en point, filet fin ou mot-clé — jamais en aplat.

## 3. Jetons (`src/design/tokens.css`)

`--bg-0…4`, `--line-0…3`, `--text-0…4`, `--gold` + `--gold-soft/-line`, `--glow-accent`, `--glow-accent-soft`, `--leak-accent`, `--mint/--ember/--ice/--violet/--amber` avec variantes `-soft` (≤ 10 %) et `-line` (50 %), échelle typographique `--fs-*`, interlettrages `--track-11/12/13/wide`, espace `--s-1…8` (multiples de 4 px), courbes `--ease-out/--ease-in-out`, durées `--t-fast/med/slow`.

## 4. Composants (`src/design/primitives.tsx`)

`Panel` (cellule, arête éclairée au survol, cascade), `Stat` (libellé → valeur Inter 700 → sous-texte, valeur interpolée via `num`/`format`), `Button` (`default` hairline · `solid` inversé · `gold` LED · `ghost` · `danger`), `Tag` (hairline, point live), `InvertedTab`, `Segmented` (puces), `Toggle` (verrou doré), `Progress` (2 px), `Empty`, `Sigil` (`SIΞRRΛSKΛ—LAB`, gravé ou imprimé), `Modal`.

## 5. Interdits

Cartes arrondies, ombres portées, dégradés colorés, glassmorphism, icônes colorées, seconde couleur d'accent, aplats d'or, mono sous 11 px, texte lumineux (hors « Accès accordé » du chargement).
