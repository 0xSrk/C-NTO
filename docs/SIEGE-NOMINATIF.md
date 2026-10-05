**`SIΞRRΛSKΛ—LAB · CΛNTO · SIÈGE NOMINATIF · DESK`**

# Siège nominatif

Un code, un nom. Le Lab attribue un nom à un testeur et le signe hors du dépôt. Le testeur colle le code dans le desk ; le desk vérifie la signature avec la clé publique qu'il embarque et affiche le nom **contenu dans le code**, jamais le texte saisi.

Ce n'est ni un compte, ni un mot de passe, ni une porte : sans code, le desk s'ouvre et fonctionne comme aujourd'hui.

La carte de la PR #62 (`docs/forges/SIEGE-CARTE.md`, fermée sans fusion) n'est pas l'autorité. Elle a fixé le principe, repris ici : preuve Ed25519, nom tiré du contenu signé, desk public ouvert sans siège. Sa surface n'est pas reprise : pas de champ dans le lanceur, pas de ligne `SIÈGE` dans le rail (`railFoot`), pas de préfixe `CANTO1`.

---

## 1. Point de départ sur `main`

Le bas à droite du desk est le pied de la barre d'état, pas la plaque.

`src/app/Shell.tsx`, footer `.status`, bloc `.statusRight` :

```tsx
<span className={s.sigEnd}>
  <Barcode />
  <span>[ SIΞRRΛSKΛ ]</span>
</span>
```

- Le pied : 28 px de haut, police mono 10 px, approche 0.08 em, en capitales (`text-transform: uppercase` sur `.status`). `.sigEnd` : écart de 10 px.
- `Barcode` (`src/design/primitives.tsx`) : `span` décoratif `aria-hidden`, 64 × 10 px, trois `repeating-linear-gradient` (`.barcode`, `primitives.module.css`). Ni lettre, ni survol.
- `[ SIΞRRΛSKΛ ]` est du texte fixe.
- Le rouge du desk est le jeton `--gold` (`#e5263d`), avec `--gold-line` pour un filet léger. Le point de version porte le halo `0 0 6px var(--gold)` (`.versionDot`).
- Les ors (`--or-*`) vivent dans `plaqueSignature.module.css` et nulle part ailleurs. `tests/plaque-signature.test.ts` l'exige, comme l'absence de `<PlaqueSignature` dans `Shell.tsx`. `tests/rail-3.2.2.test.ts` exige `Barcode` avant `SIΞRRΛSKΛ` dans `.statusRight`.
- Les toasts passent par `useUi().toast`, rendus dans une zone `role="status"`.
- `window.canto` vient de `electron/preload.ts` (`contextBridge`), sur le modèle `version: () => ipcRenderer.invoke('app:version')`. Le process principal garde chaque canal avec `trusted(e)`.
- Rien n'existe encore pour le siège : ni `canto.seat`, ni canal `seat:*`, ni `electron/seat-keys.ts`.
- La clé de publication (`electron/release-keys.ts`) signe `SHA256SUMS.txt`. Elle ne signe pas un nom ; une clé de siège ne signe pas une Release.

`PlaqueSignature`, `tokens.css` et `Wordmark` ne bougent pas. `Wordmark` ne sert pas à épeler un nom : il ne contient que les lettres de `SIΞRRΛSKΛ`. L'effet de lettres s'en inspire sans le détourner.

---

## 2. Décisions

1. Le siège vit dans le desk. Le lanceur (`electron/launcher.html`, `electron/launcher-ui.js`) ne bouge pas.
2. Le testeur ne choisit pas son nom : il colle un code, et le nom est celui que le Lab y a signé.
3. Un code débloque un seul affichage : ce nom, à cette place, sur ce desk. Ni thème, ni registre des autres testeurs.
4. Sans code, le pied est celui d'aujourd'hui. Le desk public ne se ferme pas.
5. Le texte saisi n'est jamais affiché comme nom, même en cas de refus.
6. Deux clés distinctes. La clé de siège ne vérifie pas une Release ; la clé de publication ne vérifie pas un siège.

---

## 3. La place du nom

Après un code accepté, `.sigEnd` se lit :

`nom  [barres]  [ SIΞRRΛSKΛ ]`

- Le nom est juste avant les barres, dans le même rang, écart de 10 px. Les barres et `[ SIΞRRΛSKΛ ]` ne bougent pas et ne rétrécissent pas.
- Le pied reste sur une ligne de 28 px. Un nom trop large pour la place est coupé par une ellipse ; le nom entier est dans `title`.
- Couleur `var(--gold)`, halo `0 0 6px var(--gold)` (celui de `.versionDot`). Police et approche du pied. `text-transform: none` : le nom garde la casse signée (`0xSrk` ne devient pas `0XSRK`).
- Pas de second `Wordmark`, pas de SVG, pas de couleur ni de jeton nouveaux.
- Sans siège vérifié, le nœud n'existe pas : pas de libellé, pas de tiret, pas d'emplacement vide.
- `forced-colors: active` : nom en `CanvasText`, sans halo.

---

## 4. Le geste

Le seul accès est dans les barres. Au repos, rien ne change : pas de curseur texte, pas de `title`, pas de pastille.

Dans le desk, les barres sont enveloppées dans un `button`. Son nom accessible est `tr('Inscrire un siège', 'Register a seat', 'Inscribir un asiento')` ; les barres restent `aria-hidden`.

**Révéler.** Au survol ou au focus clavier du bouton, les barres se défont en lettres. Les lettres tournent pendant six temps de 70 ms (420 ms) puis se posent sur le littéral `<insert code>`, chevrons compris. Ce littéral n'est pas traduit : c'est la marque du geste.

À chaque temps `t` (0 à 5), la position `i` prend la lettre `S I Ξ R Λ K` d'index `(3i + 7t) mod 6`. Pas de `Math.random` : le geste est le même à chaque fois.

Couleur `var(--gold)`, halo léger `0 0 3px var(--gold-line)`. Quitter le bouton (souris ou focus) sans l'ouvrir rend les barres.

**Ouvrir.** Le survol ne fait que révéler : il ne prend jamais le focus, pour ne pas voler la frappe d'un autre champ quand la souris passe sur le pied. Un clic, ou Entrée / Espace au clavier, remplace le bouton par le champ et y met le focus.

**Saisir.** Le champ est `<insert code>` lui-même : ni bordure, ni fond, ni placeholder. Ce qui est tapé ou collé prend la place du littéral, caractère par caractère, dans le même rouge léger. Le champ a le même nom accessible que le bouton. Les codes étant longs, on les colle ; le champ défile sur sa largeur.

- Entrée soumet.
- Échap, ou la perte du focus sans soumission, rend les barres. Le texte saisi est oublié.

**Mouvement réduit.** Sous `prefers-reduced-motion: reduce`, les lettres ne tournent pas : le littéral, puis le nom, apparaissent directement. La règle CSS du bas de `tokens.css` ne touche pas les minuteries JavaScript, donc le composant lit lui-même la préférence.

La largeur du littéral (13 caractères) dépasse celle des barres (64 px) : pendant le geste, le bloc s'élargit vers la gauche. Hors geste, il retrouve exactement les barres.

---

## 5. Après la soumission

Un seul geste :

1. Le champ se verrouille pendant la vérification.
2. Code accepté : le champ se referme et les barres se reforment dans leur rectangle de 64 × 10 px. Dans les mêmes 420 ms, le nœud du nom apparaît avant les barres : ses lettres tournent dans l'ordre inverse (`t` de 5 à 0) et se posent sur le nom signé.
3. Code refusé : le champ se referme, les barres reviennent, le nom déjà affiché reste. Un toast dit `tr('Siège refusé', 'Seat refused', 'Asiento rechazado')`, sans motif ni copie de la ligne.

Le geste reste disponible : un nouveau survol révèle `<insert code>` sur les barres seulement. Le nom affiché ne s'efface pas pendant la saisie. Un code valide le remplace.

---

## 6. La ligne

ASCII, une ligne, sans espace, 1 024 caractères au plus :

```
SIEGE1.<payload>.<signature>
```

- `payload` : base64url sans `=` du JSON UTF-8 canonique. Trois clés, dans cet ordre, sans espace :

  ```
  {"artefact":"002","client":"<nom>","date":"YYYY-MM-DD"}
  ```

- `signature` : base64url sans `=` de la signature Ed25519 (64 octets) des octets ASCII de `SIEGE1.<payload>`. Le préfixe est signé avec le contenu : une ligne de siège ne peut pas passer pour une signature de Release (`canto-release\n…`), ni l'inverse.

Champs :

- `artefact` : la chaîne `002`, comme le défaut de `PlaqueSignature` et le filet `SIΞRRΛSKΛ LAB · DEEP TECH · ARTEFACT 002`.
- `client` : le nom affiché. De 1 à 24 caractères Unicode, sans espace en tête ni en fin. Aucun caractère de contrôle, de format (dont les inversions bidirectionnelles) ou de séparation de ligne. La casse est celle du Lab.
- `date` : jour de signature, `YYYY-MM-DD`, date réelle du calendrier. Ce n'est pas une expiration : une date passée reste valide.

Refusés : une autre clé JSON, une clé manquante, un JSON non canonique (espaces, autre ordre), un base64url non canonique.

Ed25519 par `node:crypto`, dans le process principal. Aucune dépendance npm, aucun hachage de mot de passe, aucun appel réseau.

---

## 7. Les deux clés

`electron/seat-keys.ts` : même forme que `electron/release-keys.ts`, un tableau `readonly string[]` de `x` de JWK OKP/Ed25519, avec le repère `// clés` pour l'inscription par script. **Vide au départ.** Tant qu'il est vide, aucun code n'est accepté : le geste fonctionne, la soumission est refusée, le pied reste sans nom.

- Le renderer ne voit jamais de clé. Il reçoit `{ ok: true, client }` ou `{ ok: false }`.
- La clé privée de siège n'est pas la clé de publication. Elle ne passe jamais par une session d'agent, le dépôt, un secret GitHub ou un journal. Le desk ne connaît aucun chemin vers elle.
- La générer et inscrire sa clé publique est un geste de l'ADMIN, sur son poste (§ 9). Ce chantier ne le fait pas.

---

## 8. Chemin dans le desk

1. **Process principal** (`electron/seat.ts`) : vérification de la ligne contre `SEAT_PUBLIC_KEYS`.
2. **Canaux** `seat:status` et `seat:submit`, derrière `trusted(e)`, avec validation de forme (chaîne de 1 024 caractères au plus). Aucun appel réseau.
3. **Persistance** : un code accepté écrit la ligne brute dans `userData/siege.line` (mode 0600). Le nom n'est pas stocké à part. Au lancement suivant, la ligne est relue et revérifiée. Fichier absent ou illisible : pas de nom. Signature qui ne vérifie plus (clé retirée, ligne altérée) : pas de nom, fichier supprimé. Un code refusé ne touche pas au fichier.
4. Le coffre Dexie et son export ne voient pas ce fichier.
5. **Journal** (`mainLog`) : `siège accepté`, ou `siège refusé` avec un motif court (`forme`, `clé absente`, `signature`, `artefact`, `client`, `date`). Jamais la ligne, la signature, la clé ni le nom.
6. **Preload** : `canto.seat.status()` et `canto.seat.submit(line)`, par `ipcRenderer.invoke`.
7. **Renderer** : le pied lit `canto.seat.status()` au montage, comme il lit `canto.version()`. Pas de store Zustand, pas de table Dexie.
8. **Hors desk** (`npm run dev`, navigateur) : pas de `canto.seat`, donc ni bouton ni geste. Le pied est inchangé, sans erreur.

---

## 9. Émettre un code (ADMIN)

`scripts/issue-seat.mjs`, sur le poste de l'ADMIN uniquement :

```
node scripts/issue-seat.mjs --new-key [--out <fichier.pem>] [--write]
node scripts/issue-seat.mjs --key <fichier.pem> --client "<nom>" [--date YYYY-MM-DD]
```

**`--new-key`** génère la paire de siège :

- clé privée par défaut dans `~/.canto/seat-signing-key.pem`, mode 0600 ;
- jamais d'écrasement, jamais dans le dépôt ;
- affiche la clé publique ; `--write` l'inscrit dans `electron/seat-keys.ts`.

**Émission :**

- `--key` est obligatoire, sans chemin par défaut ; un chemin dans le dépôt est refusé.
- `--client` est obligatoire, avec la même règle que le desk.
- `--date` vaut par défaut le jour UTC.
- Le script refuse une clé dont le `x` public n'est pas dans `electron/seat-keys.ts` : il n'imprime jamais un code que les desks refuseraient.
- Il imprime la ligne `SIEGE1.…` sur la sortie standard, et rien d'autre. Il n'écrit aucun fichier du dépôt et ne publie rien.

Pour qu'une version accepte des sièges, la clé publique doit être inscrite et fusionnée **avant** son tag.

---

## 10. Refus

| Cas | Pied |
|---|---|
| Liste de clés vide | Inchangé. Le geste s'ouvre ; la soumission est refusée (toast). |
| Ligne qui n'a pas la forme `SIEGE1.<payload>.<signature>` | Barres revenues, pas de nouveau nom, toast. |
| Signature fausse, ou clé absente de `seat-keys.ts` | idem |
| `artefact` autre que `002` | idem |
| `client` vide, de plus de 24 caractères, avec espace en bord, contrôle ou caractère de format | idem |
| `date` hors `YYYY-MM-DD` ou impossible (`2026-02-30`) | idem |
| Clé JSON en trop ou manquante, JSON non canonique | idem |
| Date passée | Acceptée |
| Second code valide | Le nom devient le nouveau `client` |
| Second code refusé | Le nom déjà affiché reste |

Le texte du champ n'est recopié nulle part.

---

## 11. Tests

Les tests génèrent une paire éphémère. Aucune clé de production, aucune clé privée lue dans le dépôt.

- **Vérification** : une ligne signée par la clé éphémère rend son `client` ; date passée acceptée ; chaque cas du § 10 refusé avec son motif.
- **Séparation des clés** : `SEAT_PUBLIC_KEYS` et `RELEASE_PUBLIC_KEYS` sont disjointes. Une signature de siège ne vérifie pas un message `canto-release`, et l'inverse.
- **Persistance** : écriture 0600, relecture au lancement, fichier mort supprimé, code refusé sans effet sur le fichier, journal sans ligne ni nom.
- **Pied** (jsdom) :
  - sans `canto.seat`, les barres seules ;
  - au repos, ni `<insert code>` ni nom dans le DOM ;
  - au survol, le littéral apparaît sans prendre le focus ;
  - au clic, le champ porte la phrase traduite comme nom accessible ;
  - un code accepté affiche son `client` avant les barres, et jamais la ligne ;
  - un refus garde le nom et passe par un toast.
- **Garde visuelle** : les règles de couleur du nom n'utilisent que `var(--gold)`, `var(--gold-line)` et `CanvasText`. `tokens.css` sans `--or`. `Shell.tsx` sans `<PlaqueSignature`. `tests/plaque-signature.test.ts` et `tests/rail-3.2.2.test.ts` restent verts. `electron/launcher.html` sans champ.
- **Dépôt** : aucun fichier suivi ne contient un bloc PEM de clé privée (`-----BEGIN PRIVATE KEY-----`).
- **Script** : paire éphémère hors dépôt, ligne émise vérifiée par le desk, refus d'une clé non inscrite, d'un chemin dans le dépôt, d'un `client` invalide.

---

## 12. Hors champ

- Pas de serveur, de télémétrie, de compte ni de secret en dur.
- Aucune dépendance npm nouvelle.
- Aucune porte sur `npm run dev`, `launch`, `desk:dev`, ni sur les builds `dist*`.
- Ni champ dans le lanceur, ni ligne `SIÈGE` dans `railFoot`.
- Ne pas toucher `PlaqueSignature`, `tokens.css`, le pont ni le Copieur.
- Ne pas mêler la clé de siège avec `electron/release-keys.ts` ou la clé de publication.
- Ne pas journaliser la ligne, ni afficher un nom pris dans le champ.
- Ne pas générer ni inscrire la clé de production dans ce chantier.

Les commits ne nomment ni outil, ni assistant, ni modèle, ni session.

---

## 13. Ordre

| Ticket | Contenu |
|---|---|
| N0 | Cette carte |
| N1 | `electron/seat-keys.ts` vide et `electron/seat.ts` (vérification) |
| N2 | `siege.line`, canaux `seat:*`, preload |
| N3 | Le geste du pied : nom avant les barres, barres au repos |
| N4 | `scripts/issue-seat.mjs`, non exécuté ici ; `CLAUDE.md` |

Ni tag, ni Release, ni inscription de clé de production dans ce chantier.

**`SIΞRRΛSKΛ—LAB · CΛNTO · SIÈGE NOMINATIF · LE NOM VIENT DU CODE`**
