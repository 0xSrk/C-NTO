# Brief agent — durcissement CΛNTO

Date : 2026-09-17  
Repo : `0xSrk/C-NTO`  
Branche : `main`  
Version package.json : `1.1.1`

Tu es un agent d’implémentation. Tu modifies **ce dépôt uniquement**.  
Tu ne réinventes pas l’architecture. Tu ne touches pas le repo Python Cr-puscule.

---

## 0. Protocole anti-hallucination (obligatoire)

1. **Lire avant d’écrire.** Pour chaque ticket : ouvrir les fichiers listés, citer dans le commit le nom exact des fonctions existantes. Si un fichier ou un symbole n’existe pas tel quel → **STOP**, note l’écart, passe au ticket suivant ou demande.
2. **Ne pas recoder un correctif déjà dans `docs/AUDIT.md`** (16 sept. 2026). Vérifier le HEAD. Si c’est fait, cocher « déjà là » dans le commit, zéro diff cosmétique.
3. **Interdit d’inventer :** nouvelles dépendances npm, nouveau module UI, transport WebSocket NinjaTrader, `copy.order` / passage d’ordres, nouvelles firmes prop, nouveaux indicateurs, refonte design, secrets, CSV réels de trading.
4. **Un ticket = un commit.** Message : `P0.1 import idempotent` (style impératif court).
5. Après chaque ticket : `npm run typecheck && npm test`. Rouge → corriger avant le ticket suivant.
6. Identifiants de code en anglais (comme le repo). Chaînes UI en français.
7. Si deux interprétations : garder le comportement actuel + ajouter un test, ne pas « améliorer » la formule.

Commandes de vérité :

```bash
npm run typecheck
npm test
```

---

## 1. Carte du code — ce qui EXISTE (ne pas recréer)

| Zone | Chemin | Faits à ne pas contredire |
|---|---|---|
| Moteur | `src/engine/` | TS pur sauf `agent/tools.ts` qui importe les stores |
| Types | `src/engine/types.ts` | `Instrument = 'NQ' \| 'MNQ'`, `SESSION_CAPACITY = 1000` |
| Import FIFO | `src/engine/import/executions.ts` | `stableId` FNV-1a, `openLots`, commissions au prorata |
| Import NT | `src/engine/import/ninjatrader.ts` | cultures en-US / fr-FR |
| Métriques | `src/engine/metrics.ts` | Sharpe rf=0, `ANNUALIZATION = Math.sqrt(252)` |
| MC | `src/engine/montecarlo.ts` | i.i.d., `MAX_WORK = 5_000_000`, seed mulberry32 |
| Prop | `src/engine/propfirm.ts` | plans hardcodés, `passedOn`, `evaluatePlan` |
| LLM | `src/engine/agent/llm.ts` | OpenAI-compatible + Anthropic, stream SSE |
| Outils | `src/engine/agent/tools.ts` | `DESK_TOOLS`, `run` mute le store **directement** |
| Runner agent | `src/store/agent.ts` | **Confirmation UI déjà là** : `WRITE_TOOLS = {create_note, annotate_session}`, `MAX_TOOL_ROUNDS = 6`, `MAX_CALLS_PER_ROUND = 8`, orch gate `orchestratorAllowWrite` (défaut **false**) |
| Coffre | `src/store/db.ts` | Dexie v2. **`exportVault` / `restoreVault` sont ICI**, pas dans `journal.ts` |
| Journal | `src/store/journal.ts` | merge date+compte, fingerprint trade sans executionId |
| Settings | `src/store/settings.ts` | clé API → `apiKeyEncrypted` via `desk.secrets` |
| Pont main | `electron/bridge.ts` | watch + poll, `processed` = size+mtime, max 50 Mo, ext `.csv`/`.txt` |
| Orch | `electron/orchestrator.ts` | `127.0.0.1`, token, refuse `Origin`, 8 clients, 1 Mo, 40 r/s |
| Token | `electron/secure-token.ts` | SHA-256 + `timingSafeEqual` |
| Updater | `electron/updater.ts` | `git fetch/pull --ff-only` puis `stash -u` puis `npm install --legacy-peer-deps` |
| Preload | `electron/preload.ts` | surface `canto.*` y compris `secrets.encrypt/decrypt` |
| CSP | `index.html` | `connect-src *` |
| AddOn | `ninjatrader/CantoBridge.cs` | append CSV, HashSet `written` **mémoire seulement**, Long→Buy sinon Sell |
| Tests | `tests/*.test.ts` | 10 fichiers, pas d’IPC Electron, pas de runner agent |
| Audit | `docs/AUDIT.md` | correctifs 16 sept. déjà appliqués |
| Pont spec | `docs/PONT-NINJATRADER.md` | kill switch specifié, WS AddOn **non écrit** |

Bot / Copieur = UI + store seulement (`src/modules/bot`, `src/modules/copieur`, `src/store/bots.ts`, `src/store/copier.ts`). Aucun transport d’ordres.

---

## 2. Hors périmètre (cette vague)

- WebSocket NinjaTrader, `copy.order`, `copy.cancel`, flatten, robot live
- Remplacer Dexie
- Refonte visuelle / tokens SIΞRRΛSKΛ
- Modifier Cr-puscule
- Nouvelles libs (Zod autorisée seulement si tu ne peux pas valider avec les `CHECKS` déjà dans `db.ts`)

---

## 3. Ordre imposé

Exécuter **dans cet ordre**. Ne pas commencer P1 tant que P0 n’est pas vert.

---

## P0 — Intégrité journal et poste

### P0.1 — Idempotence import par ID d’exécution

**Lire :** `src/engine/import/executions.ts`, `src/engine/import/ninjatrader.ts`, `src/store/journal.ts`, `tests/executions.test.ts`, `tests/import.test.ts`, `src/engine/types.ts`

**Constat :** le fingerprint journal est `instrument|direction|qty|entryTime|exitTime|entryPrice|exitPrice`. L’AddOn réécrit le CSV du jour au restart NT → risque de doublons / commissions rejouées.

**Faire :**
- Ajouter `executionIds?: string[]` (et optionnel `orderIds?: string[]`) sur `Trade` dans `types.ts`.
- Parser la colonne `ID` du CSV NT et la propager jusqu’au trade FIFO (`executions.ts` possède déjà de quoi construire un `stableId` — étendre, ne pas remplacer FIFO).
- Dans `journal.ts` `importCsv` : dédupliquer d’abord par ID d’exécution connu, **puis** fallback fingerprint actuel.
- Ne pas recréer une séance si `date|account` existe : merger les trades nouveaux seulement.

**Ne pas :** changer la formule PnL / commission (déjà corrigée dans l’audit).

**Test :** deux imports du même fixture → même `trades.length` et même somme `pnl`. Un 3e import avec +1 ligne ID nouvelle → +1 trade.

### P0.2 — AddOn C# : écriture atomique + IDs persistés

**Lire :** `ninjatrader/CantoBridge.cs`, `docs/PONT-NINJATRADER.md`

**Faire :**
- Écrire `*.csv.tmp` puis `File.Replace` / move overwrite vers `executions-yyyy-MM-dd.csv`.
- Persister les `executionId` déjà écrits (fichier sidecar `executions-yyyy-MM-dd.seen.txt` à côté) pour survivre au restart NT.
- Ne plus traiter « pas Long ⇒ Sell ». Si ce n’est ni Buy ni Sell clair → skip + `Log(..., Warning)`.
- Colonne Position : valeur NT si dispo, sinon chaîne vide (plus de `"-"` mensonger) — **et** adapter le parseur TS si tu changes le CSV (lire `ninjatrader.ts` avant).

**Ne pas :** ajouter un client WebSocket, ni `CreateOrder`.

**Vérif :** documenter 8 lignes dans `docs/PONT-NINJATRADER.md` § idempotence. Watcher TS ignore toujours `.tmp` (déjà : `ACCEPTED` = `.csv`/`.txt`).

### P0.3 — Updater : couper git+npm en voie desk

**Lire :** `electron/updater.ts`, `scripts/launch.mjs`, `src/app/UpdateButton.tsx`, `electron/launcher.html`, `electron/launcher-ui.js`, `README.md` (section Mettre à jour)

**Faire :** extraire une fonction pure `canApplyGitUpdate(opts)` testable sans Electron.
- `channel === 'release'` (défaut packagé / si pas de `.git`) → `applyUpdate` **refuse** pull et `npm install`. Ouvre la page releases GitHub. Message clair.
- `channel === 'dev'` (checkout git + setting ou env `CANTO_UPDATE_CHANNEL=dev`) → pull `--ff-only` autorisé. **Interdit** `stash -u` silencieux. Si working tree dirty → erreur « modifications locales, commit ou stash manuel ».
- `checkForUpdate` reste en lecture seule dans les deux voies.

**Ne pas :** signer un binaire (pas de cert). Un script `scripts/hash-release.mjs` qui SHA256 les artefacts `release/` suffit.

**Test :** `tests/updater-policy.test.ts` — release + dirty + no-git → refuse.

**README :** supprimer la phrase qui promet `git pull + npm install` d’un clic pour tout le monde.

### P0.4 — Coffre : snapshot + tables manquantes

**Lire :** `src/store/db.ts` (`exportVault`, `restoreVault`, `CHECKS`), `src/modules/metrique/Metrique.tsx` (appelle déjà ces deux fonctions)

**Constat export actuel :** sessions, trades, notes, calendar, settings (clé vidée), copierAccounts, bots.  
**Omis :** `barSeries`, `agentMessages`, `macroReleases`.

**Faire :**
- Passer `version: 2` dans le JSON. Garder lecture v1.
- Inclure `macroReleases`. `barSeries` et `agentMessages` derrière flag `includeHeavy: boolean` (défaut false) pour ne pas exploser la taille.
- Continuer à strip `agent.apiKey` et `agent.apiKeyEncrypted`.
- Setting `backupFolder` + `backupDaily` : si Electron et date ≠ aujourd’hui, écrire `canto-vault-YYYY-MM-DD.json` via IPC fichiers existant (`files:save-text` / nouveau `files:write-path` **borné au dossier choisi**, pas d’écriture arbitraire).
- Test `tests/vault.test.ts` : export ne match jamais `/apiKey/` ; restore JSON `{artefact:'CΛNTO', version:1, sessions:[{id, date sans tags}]}` ne throw pas (les `CHECKS` doivent fournir `tags: []`).

**Ne pas :** chiffrer avec une lib nouvelle. Option chiffrement = `safeStorage` déjà dans `electron/main.ts` (`secrets:encrypt`).

### P0.5 — Watcher : hash contenu

**Lire :** `electron/bridge.ts`

**Faire :** `processed[path] = { size, mtimeMs, sha256 }`. Recalculer le hash après stabilité. Même taille + hash identique → skip. Hash différent → renvoyer au renderer.

**Ne pas :** lire des `.tmp`.

---

## P1 — Agent / clé / orchestrateur

### P1.1 — Un seul runner (ne pas dupliquer la confirm)

**Lire d’abord `src/store/agent.ts` en entier.** La confirm UI et le flag orch **existent**. Ne pas raconter qu’ils n’existent pas. Ne pas ajouter une deuxième modal.

**Trou réel :** `tools.ts` reste appelable sans passer par le runner (`run` public). L’orch, si `orchestratorAllowWrite === true`, écrit **sans** modal.

**Faire :**
- Extraire `executeDeskTool(name, args, ctx)` dans `src/engine/agent/runner.ts` (nouveau fichier autorisé ici).
  - `ctx.source === 'llm'` → writes passent par `confirmFn` (branche existante).
  - `ctx.source === 'orch'` → writes seulement si `allowWrite` ; **pas** de 3e sémantique.
  - Allowlist noms = `DESK_TOOLS.map(t => t.name)` ; autre nom → erreur.
  - Cap `body`/`note` à 20_000 chars dans le runner, pas dans chaque tool.
- `tools.ts` : fonctions pures + ports `{ journal, notes, calendar, settings }` injectés. Plus de `useJournal.getState()` dans le fichier outil.
- Brancher `store/agent.ts` sur `executeDeskTool`. Ne pas changer `MAX_TOOL_ROUNDS` / `MAX_CALLS_PER_ROUND` sauf test qui prouve le contraire.

**Test `tests/agent-runner.test.ts` :**
- write llm + confirm false → store fake non muté
- write orch + allowWrite false → refus
- 9e call du même tour → refus (la limite actuelle est 8/tour)
- tool inconnu → refus

### P1.2 — Proxy LLM dans le process main

**Lire :** `src/engine/agent/llm.ts`, `electron/main.ts`, `electron/preload.ts`, `index.html`, `src/store/settings.ts`

**Faire :**
- IPC `llm:stream` : le renderer envoie messages / tools / provider / model / temperature / baseUrl. **Pas la clé.**
- Main lit la clé depuis settings chiffrées (`safeStorage`) ou, pour localhost, aucune clé.
- Allowlist URL : `http://127.0.0.1`, `http://localhost`, plus hosts settings (liste courte : api.openai.com, api.anthropic.com, openrouter.ai, api.moonshot.ai). Refus sinon.
- Retirer `anthropic-dangerous-direct-browser-access` (plus de fetch renderer).
- Retirer `secrets.decrypt` du preload une fois la migration one-shot écrite (boot settings : si `apiKey` clair → encrypt + wipe).
- CSP `index.html` : remplacer `connect-src *` par `connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:* http://localhost:*`. Si un host cloud reste nécessaire **avant** la fin du proxy, le lister explicitement — jamais `*`.

**Grep final :** `secrets.decrypt` hors `electron/main.ts` et tests = 0. `connect-src *` = 0.

### P1.3 — Token orch

**Lire :** `electron/orchestrator.ts` `status()`, module Agent UI

**Faire :** le status périodique n’embarque plus le token. Bouton « Copier le jeton » → IPC ponctuel `orch:token`. Rotate inchangé.

---

## P2 — Contrat chiffres + types + CI

### P2.1 — Vecteurs JSON partagés

**Nouveau dossier autorisé :** `vectors/`

Fichiers :
- `vectors/README.md` — format + comment les relire en pytest (sans modifier Cr-puscule)
- `vectors/trades.basic.json` + `vectors/trades.basic.expected.json`
- `vectors/daily.two-accounts.json` + expected (2 comptes même jour → 1 journée stats)
- `vectors/propfirm.pass-then-giveback.json` + expected (`passedOn` défini)

Loader : `tests/helpers/loadVector.ts`. Brancher `tests/metrics.test.ts` et `tests/propfirm.test.ts` sur ces JSON.

**Hypothèses à écrire dans le README vecteurs, pas à « corriger » :** Sharpe rf=0, √252, MC i.i.d., consistance = meilleur jour / profit net, jour Globex 18:00 `America/New_York`.

### P2.2 — Types

`src/engine/types.ts` seulement + usages qui cassent le typecheck :
- champs optionnels P0.1
- `Session.account?: string` rester optionnel si c’est déjà le cas
- commenter `SESSION_CAPACITY` : soft limit UI (warning + proposition export) plutôt que drop silencieux à l’import — ajuster `journal.ts` message, pas la constante tant que l’UI archive n’existe pas

### P2.3 — Prop plans versionnés

`src/engine/propfirm.ts` : ajouter `version: 1`, `effectiveFrom?: string` sur `PropPlan`. UI : garder le libellé « Indicatif ». Ne pas inventer de nouveaux chiffres de firmes.

### P2.4 — Disclaimer MC / Sharpe / MAE

Une ligne UI Analyse + une dans MonteCarloView + une dans import pont :
- Sharpe : rf=0, 252, agrégation par date
- MC : bootstrap i.i.d., ignore l’autocorr
- Import exécutions : pas de MAE/MFE (déjà vrai — l’afficher)

Pas de nouvelle math dans cette vague.

### P2.5 — CI + scripts

- `.github/workflows/ci.yml` : Node 22, `npm ci`, `typecheck`, `test`, `build`. OS `ubuntu-latest` suffit (pas besoin de Windows pour le moteur).
- `package.json` : `"engines": { "node": ">=22.12.0" }`, script `"check": "npm run typecheck && npm test && npm run build"`.
- Badge / chiffres README : remplacer 58 / 49 / v1.1.0 par la sortie réelle de `npm test` et `1.1.1`.

### P2.6 — `.gitignore`

Remplacer le fichier actuel par :

```
node_modules/
dist/
dist-electron/
release/
coverage/
.vite/
*.log
.DS_Store
.env
.env.*
!.env.example
userData/
*.csv
*.tmp
canto-vault*.json
executions-*.seen.txt
Thumbs.db
```

Puis `git ls-files` : si un csv/vault/env est tracké → `git rm --cached` uniquement.

### P2.7 — Licence

Ne pas inventer une licence MIT si le user n’a pas tranché. Ajouter 5 lignes en tête README :

> Licence : `UNLICENSED`. Source visible. Pas de concession de droits. Pas de réutilisation sans accord SIΞRRΛSKΛ.

---

## P3 — Qualité (après P0–P2 verts)

### P3.1 — `noUncheckedIndexedAccess: true`

`tsconfig.json` (l’electron tsconfig aussi si tu indexes des tableaux). Corriger les erreurs réelles. Pas de `!` de confort.

### P3.2 — Workers

MC + parse CSV > 5000 lignes dans un Worker. CSP a déjà `worker-src 'self' blob:`. UI : barre + Annuler via `AbortSignal`.

### P3.3 — Modal focus trap

`src/design/Modal.tsx` seulement : Tab cycle, Esc, restore focus. Listé « différé » dans AUDIT §5.

### P3.4 — Bot / Copieur badge

Texte visible `CONCEPTION` sur les deux modules. Kill switch UI : `copier.config.enabled = false`. **Aucun** appel réseau NT.

### P3.5 — Preload token

Déjà P1.3. Vérifier que `orch:status` périodique ne logue pas le token.

### P3.6 — Journal technique local

`src/lib/log.ts` : buffer 200 lignes. ErrorBoundary + `unhandledrejection` y écrivent. Bouton « Copier le journal ». Pas d’envoi réseau.

---

## 4. Grep de fin de vague

Tous doivent être vrais :

```text
connect-src *                                          → 0 dans index.html
npm install --legacy-peer-deps dans applyUpdate release → 0
git stash dans updater sans voie dev                    → 0
useJournal.getState dans src/engine/agent/tools.ts      → 0
canto.secrets.decrypt dans src/ et preload              → 0
apiKey dans une sortie exportVault                      → 0
CreateOrder / Submit dans ninjatrader/*.cs              → 0
```

---

## 5. Definition of done

- `npm run check` vert
- Import NT idempotent (test rouge puis vert sur double fixture)
- Agent write llm toujours passé par confirm existante
- Orch write off par défaut (ne pas changer le default `false`)
- Clé API absente du renderer après P1.2
- Voie release sans `git pull` / `npm install`
- Bot/Copieur non armables
- `docs/AUDIT.md` : section « Suite 17 sept. 2026 » qui pointe vers ce fichier et coche les tickets faits

---

## 6. Si tu bloques

Écris un fichier `docs/AGENT-NOTES.md` : ticket, fichier ouvert, symbole manquant, hypothèse refusée. Ne pas « deviner » une API Electron ou NT.
