**`SIΞRRΛSKΛ—LAB · CΛNTO · SIÈGE · CARTE · 2026-10-03`**

# Siège — carte

Mode plan. Aucun code dans cette carte. Branche `cursor/siege-carte-5da4`, prise sur `main` à `fc3c55d` (fusion de la PR #61). La branche de la Forge 1 n’est pas touchée. Pas de tag. Pas de Release.

Objet : une clé de siège. Pas un mot de passe, pas un compte, pas une connexion. Le Lab signe hors dépôt un siège `{ client, artefact, date }`. L’application embarque uniquement la clé publique. La clé privée n’entre ni dans le dépôt, ni dans les tests, ni dans les journaux. Elle n’est pas générée ici.

Ce qui suit cite les symboles tels qu’ils sont sur ce `main`. Un symbole absent est dit absent. Rien n’est ajouté au pont ni au Copieur. `PlaqueSignature`, le Système 3.4 et `src/design/tokens.css` ne bougent pas.

---

## 0. Ce qui existe

| Fait | Symbole |
|---|---|
| Lanceur packagé | `LAUNCHER_MODE` dans `electron/main.ts` : vrai si l’argument n’est pas `--desk` et que l’argument est `--launcher` ou `app.isPackaged`. `createLauncherWindow` charge `electron/launcher.html` (`loadFile`, `__dirname`). |
| Dev sans lanceur | `package.json` n’a pas de script `start`. `npm run dev` est Vite, navigateur seul. `npm run desk:dev` lance `electron .` avec `CANTO_DEV_URL`, sans `--launcher` : `LAUNCHER_MODE` est faux, `createWindow` ouvre le desk. `npm run launch` (`scripts/launch.mjs`) passe `--launcher`. |
| Quitter le lanceur | `electron/launcher-ui.js`, fonction `launch`, appelle `window.canto.update.startDesk`. Le bouton est `#btn-launch`. Le preload expose `update.startDesk` → `ipcRenderer.invoke('update:start-desk')`. Le handler `ipcMain.handle('update:start-desk')` appelle `createWindow({ fromLauncher: true })` sans lire de clé. |
| Fenêtre lanceur | `BrowserWindow` 420×620, `preload.js`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. `trusted` accepte `launcherWin` ou `win`. |
| Texte du lanceur | `#meta` / `#meta-text` (classe `.meta`, états `.ok` `.warn` `.err` `.busy`). Bandeau `.lab` : `SIΞRRΛSKΛ—LAB · Artefact 002`. Pas de champ de saisie dans `launcher.html`. |
| Assets copiés | `scripts/copy-electron-assets.mjs` copie `launcher.html`, `launcher-ui.js`, `aube.js`, `logo.svg`, le journal, les polices. Pas de clé. |
| Desk | `src/app/Shell.tsx`, `railFoot` : compte (`COMPTE ACTIF`, `.account`, `.railLabel`, `.accountLine`), puis `ChangelogJournal` dans `.versionRow`, puis `<PlaqueSignature>`. `tests/rail-3.2.2.test.ts` exige `COMPTE ACTIF` avant `<ChangelogJournal` dans ce bloc, et la plaque hors du `<footer>`. |
| Plaque | `src/design/PlaqueSignature.tsx`, prop `artefact` défaut `'002'`, constante `LAB = 'SIΞRRΛSKΛ'`. Pas de nom de client. |
| Jetons | `src/design/tokens.css` : `--font-mono`, `--text-0`, `--text-2`, `--rule-dots`. Le lanceur a son propre `:root` dans `launcher.html` (`--mono`, `--text-0`, `--line-1`, `--bg`). |
| Fichiers `userData` | `planUserData` (`electron/user-data.ts`) : Windows et macOS `appData/CΛNTO` (`LEGACY_DIR_NAME`), Linux `appData/CANTO` (`USER_DATA_DIR_NAME`). `locale.json` est lu par `readLocaleFile`. Le coffre Dexie n’est pas ce dossier. |
| Crypto déjà importée | `node:crypto` dans le process principal (`createHash`, `randomBytes`, `timingSafeEqual`). Aucun `verify`, aucune signature, aucun module `siege`. |
| Build public | `dist`, `dist:mac`, `dist:win`, `dist:linux` dans `package.json`. Aucun drapeau de siège. `electronFuses.onlyLoadAppFromAsar` est vrai. |

## 1. Ce qui n’existe pas

- Champ, nom de siège, ou vérification dans `launcher.html` / `launcher-ui.js`.
- Méthode `canto.seat`, canal IPC `seat:*`, type dans `src/lib/desk.ts`.
- Fonction de vérification, clé publique embarquée, fichier `userData` de siège.
- `SEAT_REQUIRED` ou tout drapeau équivalent.
- `tests/fixtures/siege.public.pem` et `tests/fixtures/siege.line.txt`.
- Clé privée, où que ce soit dans le dépôt.

---

## 2. Clé privée — machine de l’ADMIN

L’application ne lit pas ce chemin. Il n’est pas `userData` du desk (`CΛNTO` / `CANTO`).

| OS | Fichier |
|---|---|
| macOS | `~/Library/Application Support/CΛNTO-lab/siege-ed25519.pem` |
| Windows | `%APPDATA%\CΛNTO-lab\siege-ed25519.pem` |
| Linux | `~/.config/CANTO-lab/siege-ed25519.pem` |

Mode `0600`. L’ADMIN la crée hors dépôt (OpenSSL, algorithme Ed25519). Ce dépôt ne la génère pas, ne la copie pas, ne la journalise pas.

La clé publique seule, au format PEM SPKI, sera déposée par l’ADMIN dans `electron/siege/public.pem` (fichier absent). `scripts/copy-electron-assets.mjs` ne la copie pas encore : c’est le geste d’implémentation, après validation de cette carte. Le build public embarque ce fichier et rien d’autre de la paire.

## 3. Format de la ligne

Aucune ligne de siège n’existe dans le dépôt. Format proposé, à valider avant le code. ASCII, une seule ligne, sans espace :

```
CANTO1.<payload>.<signature>
```

- `payload` : base64url, sans `=`, du JSON UTF-8 canonique, clés dans l’ordre alphabétique, sans espace :

```
{"artefact":"002","client":"<nom>","date":"YYYY-MM-DD"}
```

- `signature` : base64url de la signature Ed25519 de ces octets exacts.
- `client` : le nom affiché. 1 à 48 caractères Unicode, aucun caractère de contrôle, aucun saut de ligne.
- `date` : jour de signature `YYYY-MM-DD`. Ce n’est pas une expiration. Une date passée reste valide.
- `artefact` : la chaîne `002`, la même que le défaut de `PlaqueSignature`.

Algorithme proposé : Ed25519 via `node:crypto` (`verify`) dans le process principal. Aucune dépendance npm nouvelle. Aucun hash de mot de passe. Le nom affiché est `client` après vérification, jamais le texte du champ.

## 4. Chemin de vérification

1. Le champ (absent) vit dans `.panel` de `launcher.html`, entre `#lang-row` et `.actions`. Identifiants proposés : `#seat-line` pour la saisie, `#seat-name` pour le nom. `#seat-name` réutilise la classe existante `.meta`. Le style du champ ne déclare pas de jeton nouveau : seulement `--mono`, `--line-1`, `--text-0`, `--bg`, déjà dans le `:root` du lanceur. `src/design/tokens.css` n’est pas modifié.
2. `launcher-ui.js` envoie la ligne par une méthode nommée qui n’existe pas : `window.canto.seat.submit(line)`. Le preload suit le motif de `update.startDesk` : `ipcRenderer.invoke`, pas d’`ipcRenderer` nu.
3. Le handler, derrière `trusted`, vérifie dans le process principal avec la clé publique embarquée. Il ne fait aucun appel réseau.
4. Succès : la ligne brute est écrite dans `userData/siege.line` (convention absente), relue et revérifiée au démarrage suivant. Le nom n’est pas stocké à part. Le coffre Dexie et `exportVault` ne voient pas ce fichier.
5. La réponse au lanceur est `{ client }` ou un refus. `#seat-name` reçoit `client`. Le contenu de `#seat-line` n’est pas recopié dans le nom.
6. `launch()` continue d’appeler `update.startDesk`. Une ligne absente ou refusée ne change pas cet appel tant que le drapeau du § 6 est faux.
7. Le desk interroge `window.canto.seat.status()` (absent), sur le modèle de `desk.version()` dans `Shell`. Pas de store Zustand. Pas de table Dexie.

`mainLog` peut écrire `siege accepté` ou `siege refusé` et le motif. Il n’écrit ni la ligne, ni la signature, ni la clé.

## 5. Où le nom s’affiche

| Surface | Endroit | Absent aujourd’hui |
|---|---|---|
| Lanceur | `#seat-name`, sous `.lab`, classe `.meta` | oui |
| Desk | une ligne dans `railFoot`, après `.versionRow`, avant `<PlaqueSignature>`, classes existantes `.railLabel` et `.accountName` | oui |

Libellé de la ligne desk : `SIÈGE` / `SEAT` / `ASIENTO`, via `tr`, comme `COMPTE ACTIF`. La valeur est `client`. Sans siège vérifié, la ligne n’est pas rendue : le desk s’ouvre sans nom.

`PlaqueSignature` reste `SIΞRRΛSKΛ` / `ARTEFACT 002`. Le `<footer>` (pont, CME) ne reçoit pas le nom. `tests/rail-3.2.2.test.ts` reste vrai : `COMPTE ACTIF` précède encore `<ChangelogJournal`, la plaque reste hors du footer.

## 6. Drapeau de build

Proposé : une constante `SEAT_REQUIRED` exportée depuis `electron/siege/required.ts`. Le fichier n’existe pas. Valeur dans le dépôt : `false`.

Les scripts publics `dist`, `dist:mac`, `dist:win`, `dist:linux` ne la passent pas à vrai. Elle n’est pas lue dans `process.env` au lancement : un poste qui possède l’installeur public ne peut pas l’allumer.

Quand elle est fausse : `#btn-launch` et `update:start-desk` gardent leur comportement. `npm run dev`, `npm run launch`, `npm run desk:dev` ne demandent pas de clé.

Quand elle est vraie (build qui n’est pas le build public) : `launch()` ne appelle pas `startDesk` sans siège vérifié, et `update:start-desk` renvoie `false`. `--desk` et `desk:dev` ne passent pas par le lanceur (`LAUNCHER_MODE` faux) : ce drapeau ne les ferme pas. Ce n’est pas une porte sur `npm start` (script absent) ni sur le build public.

## 7. Ce qui est refusé

| Cas | Effet si `SEAT_REQUIRED` est faux | Effet s’il est vrai |
|---|---|---|
| Champ vide, fichier absent | Desk ouvert, pas de nom | Le lanceur ne quitte pas |
| Ligne qui n’est pas `CANTO1.<payload>.<signature>` | `#meta` en `.err`, pas de nom, desk ouvert | Le lanceur ne quitte pas |
| Signature fausse, clé publique absente du binaire | idem | idem |
| `artefact` différent de `002` | idem | idem |
| `client` vide, trop long, ou avec un contrôle | idem | idem |
| `date` qui n’est pas `YYYY-MM-DD` | idem | idem |
| Clé JSON autre que `artefact`, `client`, `date` | idem | idem |
| Date passée | acceptée | acceptée |

Le texte saisi n’est jamais affiché comme nom, y compris quand la ligne est refusée.

## 8. Fixture de test

Fichiers absents, à déposer par l’ADMIN, sans la clé privée :

- `tests/fixtures/siege.public.pem` — clé publique de test, pas celle de production si l’ADMIN les distingue.
- `tests/fixtures/siege.line.txt` — une ligne `CANTO1.…` signée par la privée de test, avec un `client` connu du test.

La privée qui signe cette fixture reste dans `CΛNTO-lab` / `CANTO-lab`, hors dépôt. Le test lit la fixture, vérifie le `client`, et vérifie qu’aucun fichier du dépôt ne contient `PRIVATE KEY`. Il ne génère pas de clé.

## 9. Interdit

Serveur, télémétrie, compte utilisateur, secret en dur, hash de mot de passe, porte sur `npm run dev` / `npm run launch` / `npm run desk:dev`, porte sur `dist`, `dist:mac`, `dist:win`, `dist:linux`, compte réel, tout changement de `electron/nt-bridge/`, du Copieur, de `PlaqueSignature`, de `src/design/tokens.css`.

## 10. Validation ADMIN

Cocher avant tout code.

| # | Point | Décision |
|---|---|---|
| V1 | Ed25519, `node:crypto`, aucune dépendance nouvelle | ☐ |
| V2 | Ligne `CANTO1.<payload>.<signature>` et JSON canonique du § 3 | ☐ |
| V3 | `date` ne fait pas expirer le siège | ☐ |
| V4 | `client` : 1 à 48 caractères, pas de contrôle | ☐ |
| V5 | Nom sur `#seat-name` puis ligne `SIÈGE` dans `railFoot`, plaque intacte | ☐ |
| V6 | `SEAT_REQUIRED` faux dans le dépôt et dans les scripts `dist*` | ☐ |
| V7 | Privée uniquement sous `CΛNTO-lab` / `CANTO-lab` (§ 2) | ☐ |

**`SIΞRRΛSKΛ—LAB · CΛNTO · SIÈGE · CARTE · AUCUN CODE AVANT VALIDATION`**
