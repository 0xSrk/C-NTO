# Système visuel — CΛNTO v1.0 · artefact 002 · SIΞRRΛSKΛ Lab

Précision lithographique. Chaque mesure est un multiple de **4 px** (filets 1–2 px exclus). Une seule LED d’accent. Aucun arrondi, aucune ombre hors halo LED, aucun dégradé décoratif. Le blanc n’émet pas : il est imprimé.

## 1. Canevas & encre

| Rôle | Jeton | Valeur |
| --- | --- | --- |
| Vide / fond | `--bg-0` | `#000000` |
| Panneau | `--bg-2` | `#050505` |
| Survol | `--bg-3` | `#0b0b0b` |
| Hairlines | `--line-0` / `--line-1` / `--line-2` | `#141414` / `#1e1e1e` / `#2e2e2e` |
| Encre | `--text-0…4` | `#fff` · `#c4c4c4` · `#8a8a8a` · `#6c6c6c` · `#4a4a4a` |
| Filigrane | `--watermark` | `#0f0f0f` |
| LED Lab | `--gold` | `#c41e3a` — point, filet, mot-clé ; jamais en aplat |

Couleurs fonctionnelles (`--mint` / `--ember` / `--ice` / `--violet` / `--amber`) : sens uniquement (PnL, données, volatilité, alerte).

## 2. Grille & chrome

- Espace : `--s-1…8` = 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40
- Chrome : titlebar **56**, statusbar **28**, rail **232**, contrôles **32**, puces **28**, lignes de table **36**
- Cadre : repères `+` inset **8** aux quatre angles (symétrie stricte), croisillons **9 × 9** tracés au pixel (plus de glyphe)
- Zone principale : noir absolu — **pas** de grille décorative ni vignette
- Filet actif / sélection : **2 px** ; chrome / panneaux : **1 px** (`--line-0` / `--line-1`)
- Équerres de panneau : **10 × 10**, inset −1 px, filet LED
- Encoches : amorce gravée `--line-3` de **12 px** sous l'en-tête de panneau et sur l'arête haute des `Stat` ; encoche d'axe (32 px + point LED) sous la barre de titre ; 48 px sous le titre de module, amorcés par 4 px de LED
- Chanfreins : **8 px** (bouton de lancement, cadres du circuit), **6 px** (`Button solid`), **4 px** (`InvertedTab`) — toujours le coin haut-droit
- Filigrane de module : contour 1 px, jamais d'aplat
- Rail : filet actif 2 px replié en crochet LED de 8 px en haut et en bas

## 3. Typographie

- Titres / valeurs : **Inter 700** (`cv11`, `ss01`, `ss03`, `tnum`) — jamais sous 12 px
- Libellés / indices : **JetBrains Mono** 11 px, tracking `.12em`, capitales — jamais sous 11 px
- Échelle : display 44 · h1 28 · h2 20 · value 24 · body 13 · small 12 · label 11

## 4. Signature CΛNTO

- Wordmark SVG viewBox **640 × 160**, grille 8 px, baselines y=32 / 128, axe y=80
- Traits **1 px**, `strokeLinecap: square`, `strokeLinejoin: miter`, `non-scaling-stroke`
- Marque labo : `SIΞRRΛSKΛ—LAB` mono tracking `.22em`
- Un seul onglet inversé par écran : `CΛNTO · ARTEFACT 002`
- Pastille live : hairline + point 6 px LED, leak 1 px sous la pastille

## 5. Lumière

- Une seule source, zénithale : la lumière ne colore rien, elle frôle les arêtes.
- `--light-line` : hairline plus claire au centre (titre, barre d'état) ; `--light-edge` : arête haute des panneaux au survol et des modales.
- Halo LED réservé à la LED. Le logotype animé a un cœur net de 1 px et un halo flou séparé (opacité 0,14 au repos).

## 6. Lancement

Chaîne continue lanceur → desk, rendue en canvas au **pixel physique** (`1 / devicePixelRatio`), sans filtre ni flou sur les traits :

1. **Lanceur (420 × 620)** — réticule à chanfreins, règles 8 / 40 px, croisillons ; le logotype se trace glyphe par glyphe, les commandes montent en cascade. Entrée ou clic : tout se retire sauf le logotype.
2. **Liaison du circuit (~1,5 s)** — bus haut / bas de 11 voies et voies latérales à 45° convergent vers un anneau chanfreiné autour du logotype. Chaque voie est tracée par un photon (tête + traîne 40 px) ; les nano-pixels 1×1 s'allument à son passage ; vias 3 px à l'arrivée ; équerres LED. Le logotype s'effondre sur son axe en un trait qui se resserre en **une LED**, puis trois impulsions carrées. Télémétrie mono : horloge `T+`, voies liées, jauge à tête lumineuse.
3. **Boot du desk** — la LED se déplie en trait d'axe, l'énergie repart vers les bords (15 voies verticales, 7 latérales par côté, l'axe en LED), cadres et règles se dessinent depuis l'axe, le logotype se construit (guides, cote, ancres, tracés, reflet, halo). Des impulsions de veille circulent tant que l'écran reste.
4. **Ouverture** — une couture blanche (point LED au centre) se trace sur l'axe du logotype, puis l'écran s'écarte verticalement et révèle le desk. La lumière parcourt les hairlines du châssis ; le rail et les modules se posent en cascade.

Le lanceur reste à l'écran jusqu'à l'affichage effectif du desk : aucun instant sans fenêtre. `prefers-reduced-motion` : fondus courts, circuit posé sans animation.

## 7. Composants

`Panel` · `Stat` (count-up 380 ms) · `Button` (default / solid / gold / ghost / danger) · `Tag` · `InvertedTab` · `Segmented` · `Toggle` · `Progress` (2 px) · `Empty` · `Sigil` · `Modal`

Cascade panneaux : 320 ms, décalage 35 ms · LED breathe 2,4 s · `prefers-reduced-motion` respecté.

## 8. Interdits

Cartes arrondies · ombres portées · dégradés colorés · glass · seconde LED · aplats d’accent · mono &lt; 11 px · Inter &lt; 12 px · mesures hors grille 4 px · caps arrondis sur le logotype · flou sur un trait (le halo est une couche à part).

Le lanceur charge les mêmes polices que le desk (Inter + JetBrains Mono, latin + grec pour Λ / Ξ), copiées dans `dist-electron/fonts` par `scripts/copy-electron-assets.mjs`.
