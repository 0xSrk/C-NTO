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
- Cadre : repères `+` inset **8** aux quatre angles (symétrie stricte), mono 10 px
- Zone principale : noir absolu — **pas** de grille décorative ni vignette
- Filet actif / sélection : **2 px** ; chrome / panneaux : **1 px** (`--line-0` / `--line-1`)
- Équerres de panneau : **10 × 10**, inset −1 px, filet LED
- Transition lanceur → boot : traits symétriques, cadres incrustés, nano-pixels 1×1

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

## 5. Composants

`Panel` · `Stat` (count-up 380 ms) · `Button` (default / solid / gold / ghost / danger) · `Tag` · `InvertedTab` · `Segmented` · `Toggle` · `Progress` (2 px) · `Empty` · `Sigil` · `Modal`

Cascade panneaux : 320 ms, décalage 35 ms · LED breathe 2,4 s · `prefers-reduced-motion` respecté.

## 6. Interdits

Cartes arrondies · ombres portées · dégradés colorés · glass · seconde LED · aplats d’accent · mono &lt; 11 px · Inter &lt; 12 px · mesures hors grille 4 px · caps arrondis sur le logotype.
