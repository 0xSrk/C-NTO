**`SIΞRRΛSKΛ—LAB · CΛNTO · FORGE 1 · CARTE · 2026-10-03`**

# F1 — carte du code (v3.2.2)

Décisions D1–D7 : défauts retenus dans `docs/forges/FORGE-1.md`. `CLAUDE.md` n’est pas dans le dépôt ; le protocole lu est `docs/AGENT-HARDENING.md` § 0. Aucun symbole ci-dessous n’est inventé : chacun est cité tel qu’il existe sur `main` à v3.2.2, avant les tickets F1.2–F1.8.

---

## 1. Chemin d’un ordre, du renderer à l’AddOn

1. Le renderer appelle `desk.ntbridge.order` (`src/lib/desk.ts`, `NtBridgeApi.order`). Le preload expose `canto.ntbridge.order` → `ipcRenderer.invoke('ntbridge:order')` (`electron/preload.ts`).
2. `ipcMain.handle('ntbridge:order')` (`electron/main.ts`) délègue à `NtBridgeHost.order` (`electron/nt-bridge/index.ts`).
3. `NtBridgeHost.order` lit `raw.op` : `submit` → `NtBridgeServer.submit`, `cancel` → `cancel`, `flatten` → `flatten` (`electron/nt-bridge/server.ts`).
4. `submit` appelle `validateOrderSubmit` (`electron/nt-bridge/protocol.ts`) puis `guardSubmit` (`electron/nt-bridge/guards.ts`).
5. Si le verdict est `ok`, `rpc('order.submit', order)` envoie la trame JSON-RPC à l’AddOn. `cancel` et `flatten` passent par `guardAccountCommand` puis `order.cancel` / `order.flatten`.
6. L’AddOn factice `scripts/fake-addon.mjs` répond à `order.submit` (Sim101) et à `order.flatten`. Le protocole vu par le C# (`ninjatrader/CantoBridge.cs`, `protocol.ts`) ne change pas dans cette forge.

Codes déjà en place : `ERR.ACCOUNT` `-32010`, `ERR.LOST` `-32011`, `ERR.QUANTITY` `-32012`, `ERR.TAG` `-32013` (`protocol.ts`).

## 2. Chemin d’une exécution jusqu’au journal

1. L’AddOn notifie `bridge.execution`. `validateAddonCall` → `mapExecution` produit un `ExecutionPayload`.
2. `NtBridgeServer.dispatch` appelle `onExecution` (`server.ts`, case `bridge.execution`). `bridge.order` est accepté puis ignoré (case vide). `bridge.accounts` remplit `this.accounts`.
3. `NtBridgeHost.onExecution` (`index.ts`) appelle `fileBridge.noteExecution(payload.id)` et `send('ntbridge:execution', { csv, executionId })`.
4. Le preload `onExecution` livre le CSV au renderer. `useBridge` (`src/store/bridge.ts`) importe via `importExecutionCsv` → `useJournal.importCsv`.

## 3. Kill switch global

`NtBridgeServer.killSwitch` (`server.ts`) : `killSwitchAccounts` (`guards.ts`) ne garde que les comptes autorisés (`Sim*` ou `extraAccounts`), pose `ordersClosed = true`, émet `order.flatten` sans attendre, journalise, puis `emitStatus`. Ensuite `guardSubmit` renvoie `-32011` (`canal d’ordres fermé`). Le raccourci `CommandOrControl+Shift+K` (`KILL_SWITCH_SHORTCUT`, `electron/main.ts`) appelle `NtBridgeHost.killSwitch`. Objectif déjà testé : sous 200 ms (`tests/nt-bridge-guards.test.ts`, `tests/nt-bridge-e2e.test.ts`).

D1 : ce comportement reste. Le routeur est en plus désarmé.

## 4. Store du Copieur

`src/store/copier.ts` : `CopierConfig`, `DEFAULT_COPIER` (`enabled: false`, `latencyBudgetMs: 250`, `newsBlackout: true`, fenêtre `15:30`–`17:30`, `followerBufferFloor: 0.3`), `useCopier`, `replicatedQty`.

`CopierAccount` et `SymbolMap` vivent dans `src/store/db.ts` (rôle `maitre` | `suiveur`, sizing `fixe` | `ratio` | `risque`, carte `identique` | `micro` | `standard` | `explicite`). `replicatedQty` s’appuie sur `microCounterpart` / `standardCounterpart` (`src/engine/instruments.ts`). Le plancher prop est `evaluatePlan` (`src/engine/propfirm.ts`), pas encore appelé par le Copieur.

L’écran `src/modules/copieur/Copieur.tsx` persiste la topologie. Il n’envoie pas d’ordre. `App.tsx` rend `<Metrique />` quand `tab === 'copieur'`. `useUi.setTab` renvoie `copieur` vers `metrique`.

## 5. Rail

`TABS` (`src/app/tabs.ts`) : `01 MET` … `07 BOT`. `copieur` est absent du tableau et présent seulement dans `TAB_EN` / `TAB_ES`. `isConception` = `agent` | `bot`. `tests/tabs.test.ts` exige cette liste et l’absence du copieur. `tests/rail-3.2.2.test.ts` ne compte pas les onglets. Le raccourci `Digit1`–`Digit8` (`Shell.tsx`) indexe `TABS`.

## 6. Écarts assumés pour F1.2–F1.8

| Ticket | Fait constaté | Correction prévue |
|---|---|---|
| F1.2 | Pas de `src/engine/execution/port.ts`. Le modèle est `MarketDataPort` (`src/engine/marketdata/port.ts`) : `sourceId`, `capabilities`, `subscribe` → `Unsubscribe`. | Créer le port et l’adaptateur mémoire. |
| F1.3 | Les gardes sont dans `electron/nt-bridge/guards.ts`, qui importe `ERR` depuis `protocol.ts`. Le `rootDir` Electron n’avale pas `src/`. | Fonctions pures dans le moteur ; `guards.ts` délègue ; le JS du moteur est émis par `electron/tsconfig.sources.json`, comme `sources.ts`. |
| F1.4 | `bridge.order` n’a pas de rappel. L’hôte n’expose pas de port. | Rappels `onOrder` / `onAccounts` sans toucher `protocol.ts` ni `CantoBridge.cs`. |
| F1.5 | `replicatedQty` ne connaît pas le mois (`NQ 12-26`). `evaluatePlan` n’est pas branché. | `routeFill` dans le moteur ; le store importe les types du moteur. |
| F1.6 | Aucun hôte de réplication. L’idempotence d’import est `.seen.txt` côté AddOn, pas un fichier `userData` du Copieur. | `copier-host.ts`, clés `executionId` + compte suiveur dans `userData/copier-seen.txt`, désarmé à chaque démarrage. |
| F1.7 | Copieur hors rail. | Onglet `08 · CPY`, dialogue d’armement dans le process principal, Couper toujours visible. |
| F1.8 | Le README › *Roadmap* décrit la brique livrée et ce qui est hors de cette forge. | Documents seulement. `package.json` reste `3.2.2` jusqu’à l’ADMIN. |

`copy.order` n’existe pas dans le serveur. La réplication passe par `order.submit` / `order.cancel` / `order.flatten`.
