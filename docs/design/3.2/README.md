# CΛNTO — source de design · Planches v2 (Système 3.4)

Code source figé des trois planches Claude Design du projet « CANTO Planches v2 ». Il remplace les captures : c'est le fichier de référence à partir duquel on reconstitue l'interface, étape par étape.

## Ce que contient ce dossier

| Fichier | Rôle |
| --- | --- |
| `index.html` | Les trois planches côte à côte, comme dans Claude Design |
| `systeme-3.4.html` · `metrique-v2.html` · `portefeuille-v2.html` | Une planche par fichier, autonome |
| `etapes/<planche>/NN-….html` | Chaque étape isolée, en fragment HTML |
| `tokens.css` | Matières, signaux, caractères, textures, détails et mesures du châssis |
| `ref/*.png` | Rendu de contrôle de chaque planche (1440 px de large) |

## Fidélité, vérifiée

- Rendu par le runtime de Claude Design, puis figé : tous les gabarits (`{{ … }}`, boucles, conditions) sont résolus, le runtime n'est plus nécessaire.
- Polices embarquées dans chaque fichier (Archivo avec l'axe de largeur, Doto, JetBrains Mono ; SIL OFL 1.1). **Aucune requête réseau** : s'ouvre hors ligne, par double-clic.
- Comparaison pixel à pixel avec le rendu du runtime à 1440 px : **0 pixel différent** sur les trois planches.
- Couleurs réécrites en hexadécimal (`rgb()` → `#RRGGBB`) pour être lisibles ; `rgba()` inchangé.
- Réglages figés sur les valeurs par défaut des planches : lecteur « Phosphore » (`#EDEBE4`), LED `#E5263D`, signature du Lab affichée. Le réglage « Direction » du lecteur est noté dans `tokens.css`.

## Comment reconstituer

Dans chaque planche, chaque bloc est précédé d'un commentaire `═══ ÉTAPE NN · … ═══` et porte `data-etape="NN"`. Dans `etapes/`, un bloc qui en contient d'autres les remplace par `<!-- → ÉTAPE NN (fichier séparé) -->` : chaque fichier ne contient que sa propre part.

Ordre conseillé : `tokens.css`, puis le châssis (textures, barre de titre, rail, barre d'état), puis la zone de travail, bloc par bloc. À chaque étape, on compare le résultat à la planche ouverte à côté, à 1440 px.

Les styles sont en ligne, tels que Claude Design les a produits : c'est la source exacte, pas encore le code de l'application. On les transpose en jetons et en composants au moment de la reconstitution.


## Système 3.4 — spécification — `systeme-3.4.html`

| Étape | Bloc | Fragment |
| --- | --- | --- |
| 01 | Texture T.01 · grain (calque) | `etapes/systeme-3.4/01-texture-t-01-grain-calque.html` |
| 02 | Texture T.02 · balayage (calque) | `etapes/systeme-3.4/02-texture-t-02-balayage-calque.html` |
| 03 | En-tête de la spécification | `etapes/systeme-3.4/03-en-tete-de-la-specification.html` |
| 04 | 00 · Couverture | `etapes/systeme-3.4/04-00-couverture.html` |
| 05 | Fig. 00 · Numéro d'artefact | `etapes/systeme-3.4/05-fig-00-numero-d-artefact.html` |
| 06 | 01 · Matières | `etapes/systeme-3.4/06-01-matieres.html` |
| 07 | 02 · Signaux | `etapes/systeme-3.4/07-02-signaux.html` |
| 08 | 03 · Textures | `etapes/systeme-3.4/08-03-textures.html` |
| 09 | 04 · Caractères | `etapes/systeme-3.4/09-04-caracteres.html` |
| 10 | 05 · Chiffres | `etapes/systeme-3.4/10-05-chiffres.html` |
| 11 | 06 · Détails | `etapes/systeme-3.4/11-06-details.html` |
| 12 | 07 · Signature du Lab | `etapes/systeme-3.4/12-07-signature-du-lab.html` |
| 13 | Pied de la spécification | `etapes/systeme-3.4/13-pied-de-la-specification.html` |

## Métrique › Tableau de bord — `metrique-v2.html`

| Étape | Bloc | Fragment |
| --- | --- | --- |
| 01 | Texture T.01 · grain (calque) | `etapes/metrique-v2/01-texture-t-01-grain-calque.html` |
| 02 | Texture T.02 · balayage (calque) | `etapes/metrique-v2/02-texture-t-02-balayage-calque.html` |
| 03 | Barre de titre (wordmark, fil, horloge, fenêtre) | `etapes/metrique-v2/03-barre-de-titre-wordmark-fil-horloge-fenetre.html` |
| 04 | Rail | `etapes/metrique-v2/04-rail.html` |
| 05 | Rail · liste des modules | `etapes/metrique-v2/05-rail-liste-des-modules.html` |
| 06 | Rail · carte « Compte actif » | `etapes/metrique-v2/06-rail-carte-compte-actif.html` |
| 07 | Rail · signature du Lab | `etapes/metrique-v2/07-rail-signature-du-lab.html` |
| 08 | Zone de travail | `etapes/metrique-v2/08-zone-de-travail.html` |
| 09 | Bord de travail · annotation verticale | `etapes/metrique-v2/09-bord-de-travail-annotation-verticale.html` |
| 10 | En-tête du module (titre, période, filtres, action chanfreinée) | `etapes/metrique-v2/10-en-tete-du-module-titre-periode-filtres-action-c.html` |
| 11 | Sous-onglets A à E | `etapes/metrique-v2/11-sous-onglets-a-a-e.html` |
| 12 | Grille de la zone de travail + repères + | `etapes/metrique-v2/12-grille-de-la-zone-de-travail-reperes.html` |
| 13 | A.01 · Net P&L (plaque vissée + lecteur Doto) | `etapes/metrique-v2/13-a-01-net-p-l-plaque-vissee-lecteur-doto.html` |
| 14 | K.01 à K.04 · tuiles indicateurs et jauges | `etapes/metrique-v2/14-k-01-a-k-04-tuiles-indicateurs-et-jauges.html` |
| 15 | A.02 · Courbe d'équité | `etapes/metrique-v2/15-a-02-courbe-d-equite.html` |
| 16 | A.03 · Par instrument | `etapes/metrique-v2/16-a-03-par-instrument.html` |
| 17 | A.04 · Dernières séances | `etapes/metrique-v2/17-a-04-dernieres-seances.html` |
| 18 | Barre d'état | `etapes/metrique-v2/18-barre-d-etat.html` |

## Portefeuille › Synthèse — `portefeuille-v2.html`

| Étape | Bloc | Fragment |
| --- | --- | --- |
| 01 | Texture T.01 · grain (calque) | `etapes/portefeuille-v2/01-texture-t-01-grain-calque.html` |
| 02 | Texture T.02 · balayage (calque) | `etapes/portefeuille-v2/02-texture-t-02-balayage-calque.html` |
| 03 | Barre de titre (wordmark, fil, horloge, fenêtre) | `etapes/portefeuille-v2/03-barre-de-titre-wordmark-fil-horloge-fenetre.html` |
| 04 | Rail | `etapes/portefeuille-v2/04-rail.html` |
| 05 | Rail · liste des modules | `etapes/portefeuille-v2/05-rail-liste-des-modules.html` |
| 06 | Rail · carte « Compte actif » | `etapes/portefeuille-v2/06-rail-carte-compte-actif.html` |
| 07 | Rail · signature du Lab | `etapes/portefeuille-v2/07-rail-signature-du-lab.html` |
| 08 | Zone de travail | `etapes/portefeuille-v2/08-zone-de-travail.html` |
| 09 | Bord de travail · annotation verticale | `etapes/portefeuille-v2/09-bord-de-travail-annotation-verticale.html` |
| 10 | En-tête du module · titre et sous-titre | `etapes/portefeuille-v2/10-en-tete-du-module-titre-et-sous-titre.html` |
| 11 | En-tête du module · mode discret, période, action chanfreinée | `etapes/portefeuille-v2/11-en-tete-du-module-mode-discret-periode-action-ch.html` |
| 12 | Grille de la zone de travail + repères + | `etapes/portefeuille-v2/12-grille-de-la-zone-de-travail-reperes.html` |
| 13 | B.01 · Valeur nette consolidée (plaque vissée + lecteur Doto) | `etapes/portefeuille-v2/13-b-01-valeur-nette-consolidee-plaque-vissee-lecte.html` |
| 14 | K.01 à K.04 · tuiles indicateurs et jauges | `etapes/portefeuille-v2/14-k-01-a-k-04-tuiles-indicateurs-et-jauges.html` |
| 15 | B.02 · Poches | `etapes/portefeuille-v2/15-b-02-poches.html` |
| 16 | B.03 · Exposition | `etapes/portefeuille-v2/16-b-03-exposition.html` |
| 17 | B.04 · Projection Monte-Carlo | `etapes/portefeuille-v2/17-b-04-projection-monte-carlo.html` |
| 18 | B.05 · Bilan 30 jours | `etapes/portefeuille-v2/18-b-05-bilan-30-jours.html` |
| 19 | Barre d'état | `etapes/portefeuille-v2/19-barre-d-etat.html` |

## Points à connaître avant de reconstituer

- **U+202F (espace fine insécable) n'existe dans aucune des trois polices.** Les milliers des planches s'affichent donc avec une police de secours. Pour garder l'alignement, séparer les groupes de chiffres par une marge CSS plutôt que par le caractère.
- **Λ et Ξ n'existent pas dans Archivo.** « CΛNTO » et « SIΞRRΛSKΛ » écrits en Archivo s'affichent avec la police de secours du système, qui change d'une machine à l'autre. JetBrains Mono les contient.
- Les montants, comptes et dates des planches sont fictifs.
