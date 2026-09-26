# Pont NinjaTrader — CΛNTO Bridge

Le pont relie NinjaTrader 8 (poste du trader) au desk CΛNTO, en local uniquement. Aucune donnée ne quitte la machine : pas de serveur tiers, pas de télémétrie.

Il existe en deux étages :

| Étage | État | Rôle |
| --- | --- | --- |
| **Transport fichier (CSV)** | **implémenté** | import automatique des exécutions et des exports NinjaTrader vers le journal Métrique |
| **Transport WebSocket JSON-RPC** | **implémenté** (section B) | exécutions, comptes, barres / ticks / quotes, ordres vers NinjaTrader (Sim par défaut) |

---

## A. Transport fichier — import automatique (implémenté)

### Principe

1. Le shell CΛNTO — application native macOS, Windows ou Linux — surveille un dossier (`Métrique › Pont NinjaTrader`), par défaut `Documents/NinjaTrader 8/export/CANTO` sous le dossier Documents du système.
2. Tout fichier `.csv` / `.txt` nouveau ou modifié y est lu dès que sa taille est stable (NinjaTrader a fini d'écrire), puis transmis au journal.
3. Le journal détecte le format — export **Trades** (Trade Performance), export **Executions**, ou **CΛNTO CSV** — et importe. Les exécutions sont appariées en trades aller-retour par compte et par contrat, méthode **FIFO** avec fractionnement des remplissages partiels ; les commissions sont réparties au contrat.
4. Le dédoublonnage (empreinte instrument · sens · quantité · horodatages · prix) garantit qu'un fichier relu ou un export répété ne crée jamais de doublon : le journal temps réel qui grossit toute la journée est simplement rejoué.
5. L'état du pont (dossier, fichiers déjà traités, dernier import) est persisté dans le dossier de données du desk — `%APPDATA%\CΛNTO\bridge-state.json` (Windows), `~/Library/Application Support/CΛNTO/` (macOS), `~/.config/CANTO/` (Linux, nom ASCII : Chromium vidait « CΛNTO » et écrivait à la racine de `~/.config` — migré automatiquement) ; « Relire le dossier » force un rejeu complet.
6. Le dossier surveillé ne peut être choisi que par le dialogue système (ou le dossier par défaut) : le process principal refuse tout autre chemin envoyé par l'interface, même après redémarrage (`folder-grants.json`).

### Côté NinjaTrader : l'AddOn `ninjatrader/CantoBridge.cs`

- Copier le fichier dans `Documents\NinjaTrader 8\bin\Custom\AddOns\`, ouvrir le NinjaScript Editor et compiler (F5). L'AddOn démarre avec la plateforme, sans interface.
- **Validation** : le parseur CΛNTO est couvert par une fixture au format exact de l'AddOn (culture invariante). La compilation sur une session sim NT8 réelle reste à confirmer sur le poste trader.
- Il s'abonne à `Account.ExecutionUpdate` pour tous les comptes (y compris ceux connectés plus tard) et rattrape les exécutions déjà présentes dans `Account.Executions` au démarrage.
- Chaque exécution est ajoutée à `export\CANTO\executions-AAAA-MM-JJ.csv` avec **exactement les colonnes de l'export « Executions »** de NinjaTrader, en culture invariante :

```
Instrument,Action,Quantity,Price,Time,ID,E/X,Position,Order ID,Name,Commission,Rate,Account,Connection
MNQ 12-26,Buy,3,21000.25,2026-09-16 15:31:02,3f2a…,Entry,-,7c1…,Entry,2.22,1,APEX-50K,Rithmic
```

- Le fichier est ouvert en `FileShare.Read` : CΛNTO peut le lire pendant que NinjaTrader écrit.

### Sans AddOn : export manuel

Control Center › **Trade Performance › Trades** (ou onglet **Executions**) › clic droit › *Export* vers le dossier surveillé. Le fichier est importé à l'écriture. Les cultures en-US (`9/16/2026 3:31:02 PM`, `$1,250.50`) et fr-FR (`16/09/2026 15:31:02`, `1 250,50 $`) sont reconnues ; le séparateur décimal est déduit des colonnes de prix.

### Limites connues

- Le pairing FIFO reconstitue les trades tels que NinjaTrader les affiche en mode FIFO ; un compte configuré en LIFO donnera les mêmes PnL agrégés par séance mais des découpages de trades différents.
- Les positions encore ouvertes en fin de fichier ne sont pas importées (signalées dans le journal du pont) ; elles le seront à la clôture.
- MAE/MFE ne sont pas disponibles à partir des exécutions (uniquement dans l'export « Trades »).

### Idempotence (2026-09-17)

- Écriture atomique : `executions-YYYY-MM-DD.csv.tmp` puis `File.Delete` + `File.Move` à deux arguments (NinjaScript = .NET Framework 4.8, pas l’overload `overwrite`).
- IDs déjà écrits dans `executions-YYYY-MM-DD.seen.txt` (un ID par ligne). Au rattrapage, un ID présent dans `.seen` n'est pas réécrit.
- `MarketPosition.Flat` et position inconnue : pas d'écriture, `Log(Warning)`. Plus de mapping « not Long → Sell ».
- Filtre compte : `AccountFilter` (constante en tête, vide = tous).
- Le watcher desk n'importe que `.csv` / `.txt` ; `.tmp` est hors filtre. `.seen.txt` est exclu explicitement côté pont (P1.2).

---

## B. Transport WebSocket — serveur dédié (implémenté)

Le pont a **son propre** serveur WebSocket, dans `electron/nt-bridge/`. Il ne réutilise pas l'orchestrateur IA (`electron/orchestrator.ts` reste un prototype, autre cycle de vie, autre niveau de confiance).

Le renderer ne voit jamais le socket. Les barres, ticks et quotes arrivent par les canaux IPC `marketdata:*` et alimentent `MarketDataPort` (`sourceId: 'nt8-bridge'`). Les ordres passent par `ntbridge:order`, après `guards.ts`. La réplication du copieur (sizing, filtres, politique prop firm) n'est pas dans ce transport.

### Installation de l'AddOn

1. Copier `ninjatrader/CantoBridge.cs` dans `Documents\NinjaTrader 8\bin\Custom\AddOns\`, compiler dans le NinjaScript Editor (F5).
2. Dans le desk, Métrique › Pont NinjaTrader : **Régénérer le jeton** si besoin, puis **Écrire la configuration pour NinjaTrader**. Le desk écrit `Documents\NinjaTrader 8\export\CANTO\bridge.json` (ou le dossier surveillé) :

```json
{ "port": 48231, "token": "…" }
```

Le fichier est en mode `0600`. Le jeton n'est plus affiché après génération. L'AddOn le relit, se connecte à `ws://127.0.0.1:<port>/?token=<jeton>`, et se reconnecte avec un repli de 1 s à 30 s.

La compilation de l'AddOn exige Windows et NinjaTrader 8. Elle n'est pas faite sur le poste de développement Linux du dépôt.

## 1. Serveur

- Hôte **uniquement** `127.0.0.1`. Port par défaut **48231**, configurable dans `userData/nt-bridge.json` (hors coffre).
- Jeton de session : 18 octets `base64url`, comparé avec `tokensMatch`. Sans jeton valide : fermeture **4401**.
- Une seule connexion AddOn. Une seconde connexion valide ferme la première en **4409**.
- Premier message obligatoirement `bridge.hello` (`kind: "ninjatrader"`, `protocol: 1`), sinon fermeture **4400**.
- Trame plafonnée à **256 Ko**, sinon fermeture **1009**.
- Battement toutes les **2 s**. À 4 s le lien passe `stale` (flux marché périmés). À **6 s** le lien passe `lost`, notification `bridge.lost`, abonnements `stale`, canal d'ordres fermé jusqu'au retour d'un battement. Un ordre en vol n'est pas réémis.

## 2. Enveloppe

JSON-RPC 2.0, UTF-8, une trame par message. L'`id` (nombre ou chaîne) est conservé. Une notification n'a pas d'`id`.

```json
{ "jsonrpc": "2.0", "id": 12, "method": "order.submit", "params": { } }
{ "jsonrpc": "2.0", "id": 12, "result": { } }
{ "jsonrpc": "2.0", "id": 12, "error": { "code": -32010, "message": "…" } }
{ "jsonrpc": "2.0", "method": "bridge.lost", "params": { "at": 1789000000000 } }
```

Les barres sont en epoch **secondes** UTC. Les ticks, quotes et exécutions sont en epoch **millisecondes**. Les instruments circulent sous le nom NinjaTrader complet (`MNQ 12-26`) ; le desk résout le symbole via `resolveSymbol`.

## 3. NinjaTrader → desk (notifications)

| Méthode | Charge |
| --- | --- |
| `bridge.hello` | `{ kind: "ninjatrader", ntVersion, addonVersion, accounts: string[], protocol: 1 }` |
| `bridge.heartbeat` | `{ at }` |
| `bridge.accounts` | `{ accounts: [{ name, cashValue, realizedPnl, unrealizedPnl, positions: [{ instrument, quantity, avgPrice }] }] }` toutes les 5 s et sur changement |
| `bridge.execution` | mêmes champs que l'export CSV « Executions » (`Instrument`, `Action`, `Quantity`, `Price`, `Time`, `ID`, `E/X`, `Position`, `Order ID`, `Name`, `Commission`, `Rate`, `Account`, `Connection`), culture invariante. `Time` en epoch ms |
| `bridge.order` | `{ account, orderId, instrument, action, type, quantity, limitPrice?, stopPrice?, state, tag? }` |
| `marketdata.bar` | `{ instrument, timeframe, bar: { time, open, high, low, close, volume }, final }` |
| `marketdata.tick` | `{ instrument, time, price, size, side? }` |
| `marketdata.quote` | `{ instrument, time, bid, ask, last? }` |

## 4. Desk → NinjaTrader (requêtes)

| Méthode | Paramètres | Réponse |
| --- | --- | --- |
| `bridge.snapshot` | `{}` | charge de `bridge.accounts` |
| `marketdata.subscribe` | `{ instrument, kind: "bars" \| "tick" \| "quote", timeframe? }` | `{ subscriptionId }` |
| `marketdata.unsubscribe` | `{ subscriptionId }` | `{ ok }` |
| `marketdata.history` | `{ instrument, timeframe, from, to }` | `{ bars }` (plafond 50 000) |
| `order.submit` | `{ account, instrument, action, quantity, type, limitPrice?, stopPrice?, oco?, tag }` | `{ orderId, latencyMs }` |
| `order.cancel` | `{ account, orderId }` | `{ ok }` |
| `order.flatten` | `{ account }` | `{ closed }` |

`action` ∈ `Buy` | `Sell` | `BuyToCover` | `SellShort`. `type` ∈ `Market` | `Limit` | `StopMarket` | `StopLimit`. `Order.Name = tag`. `order.flatten` appelle `account.Flatten`. Compte non connecté : erreur explicite.

Le CSV continue d'être écrit en parallèle, avec le même `ID`. Le journal dédoublonne par l'empreinte existante (`account + ID`).

## 5. Garde-fous (défauts)

Réglables dans le panneau. Persistés dans `userData/nt-bridge.json`, pas dans le coffre.

| Garde-fou | Défaut | Refus |
| --- | --- | --- |
| Comptes autorisés | nom commençant par `Sim`, plus une liste explicite vide | `-32010` |
| Coupe-circuit | lien autre que `live` (dont `lost` après 6 s) | `-32011`, ordre non réémis |
| Kill switch | `Ctrl+Shift+K` / `Cmd+Shift+K` (`CommandOrControl+Shift+K`) : `order.flatten` sur chaque compte autorisé connu, puis canal fermé jusqu'au redémarrage du desk | `-32011` ensuite |
| Plafond | `maxContractsPerOrder` = **20** | `-32012` si `quantity` est supérieure |
| Tag | obligatoire sur `order.submit` | `-32013` |

Un compte réel s'ajoute depuis le panneau, après un dialogue CΛNTO (pas `confirm()`). Chaque ordre émis est écrit dans `main.log` avec tag, compte, instrument, quantité, latence et résultat.

## 6. Matrice de secours CSV ↔ WebSocket

| État du socket | Rôle du dossier surveillé |
| --- | --- |
| `live` ou `stale` | la surveillance continue ; un export Executions ne transmet que les `ID` pas encore vus par le WebSocket |
| `lost` ou `absent` | le CSV redevient la voie principale, sans action de l'utilisateur ; le journal dédoublonne quand même |

`scripts/fake-addon.mjs` simule l'AddOn (barres, exécution, `order.submit` sur Sim101) sans NinjaTrader.

## 7. Hors de ce transport

La logique de copie (sizing, filtres, fenêtre horaire, blackout, marge prop firm) est la tâche 5. Elle consommera `ntbridge:order`. Les méthodes `copy.order` / `copy.cancel` / `copy.flatten` de l'ancienne spécification ne sont pas le protocole du serveur.

## 1. Enveloppe

Toutes les trames sont des objets JSON-RPC 2.0 encodés en UTF-8, une trame par message WebSocket.

```json
{ "jsonrpc": "2.0", "id": 12, "method": "…", "params": { … } }
{ "jsonrpc": "2.0", "id": 12, "result": { … } }
{ "jsonrpc": "2.0", "id": 12, "error": { "code": -32000, "message": "…" } }
{ "jsonrpc": "2.0", "method": "desk.event", "params": { "event": "…", "payload": { … }, "at": 1789000000000 } }
```

Les identifiants numériques ou chaînes sont conservés tels quels dans la réponse.

## 2. Poignée de main

À la connexion, CΛNTO envoie une notification :

```json
{ "jsonrpc": "2.0", "method": "desk.hello", "params": { "artefact": "CΛNTO", "version": "0.1.0", "clientId": "c3" } }
```

Le pont répond par une requête `bridge.hello` :

```json
{ "jsonrpc": "2.0", "id": 1, "method": "bridge.hello",
  "params": { "kind": "ninjatrader", "ntVersion": "8.1.4.1", "addonVersion": "0.1.0",
              "accounts": ["Sim101", "APEX-1234-01", "APEX-1234-02"] } }
```

## 3. Flux NinjaTrader → CΛNTO (notifications)

| Méthode | Charge utile | Rôle |
| --- | --- | --- |
| `bridge.accounts` | `{ accounts: [{ name, cashValue, realizedPnl, unrealizedPnl, positions: [{ instrument, quantity, avgPrice }] }] }` | instantané périodique (toutes les 5 s) et sur changement |
| `bridge.execution` | `{ account, instrument, marketPosition: "Long"\|"Short", quantity, price, time, orderId, executionId, name }` | chaque exécution ; sert au copieur (compte maître) et à l'import temps réel du journal |
| `bridge.order` | `{ account, orderId, instrument, action, type, quantity, limitPrice, stopPrice, state }` | mises à jour d'état d'ordre |
| `bridge.heartbeat` | `{ at }` | toutes les 2 s ; CΛNTO déclenche le coupe-circuit après 6 s de silence |

Les instruments sont transmis sous leur nom complet NinjaTrader (`NQ 12-26`, `MNQ 12-26`) ; CΛNTO en déduit le symbole racine.

## 4. Flux CΛNTO → NinjaTrader (requêtes)

| Méthode | Paramètres | Réponse |
| --- | --- | --- |
| `copy.order` | `{ account, instrument, action: "Buy"\|"Sell"\|"BuyToCover"\|"SellShort", quantity, type: "Market"\|"Limit"\|"StopMarket"\|"StopLimit", limitPrice?, stopPrice?, oco?, tag }` | `{ orderId, latencyMs }` |
| `copy.cancel` | `{ account, orderId }` | `{ ok }` |
| `copy.flatten` | `{ account }` | `{ closed: n }` |
| `bridge.snapshot` | `{}` | même charge que `bridge.accounts` |

Le champ `tag` porte l'identifiant CΛNTO de la réplication (`cpy_…`) afin de rapprocher exécutions maître et suiveurs.

## 5. Coupe-circuits

Le copieur refuse d'émettre `copy.order` si l'une des conditions suivantes est vraie :

1. pont absent ou battement manquant depuis plus de 6 s ;
2. heure locale hors fenêtre de réplication ;
3. blackout catalyseur majeur actif (±15 min, module Calendrier) ;
4. marge au plancher du suiveur (rejeu prop firm) inférieure au seuil configuré ;
5. latence mesurée sur les trois dernières copies supérieure au budget.

Chaque refus est journalisé dans le module Copieur et remonté à l'orchestrateur par un événement `desk.event` (`copier.rejected`).

## 6. Événements émis par CΛNTO

`desk.event` avec `event` ∈ `session.updated`, `copier.rejected`, `copier.sent`, `guard.triggered`, `bridge.lost`.

## 7. Implémentation de référence côté NinjaTrader (feuille de route)

- AddOn NinjaScript (C#) utilisant `System.Net.WebSockets.ClientWebSocket`, démarré avec la plateforme (onglet *CΛNTO* dans le Control Center).
- Abonnement aux événements `Account.ExecutionUpdate`, `Account.OrderUpdate`, `Account.PositionUpdate`.
- Passage d'ordres via `Account.CreateOrder` + `Account.Submit`, avec `Order.Name = tag`.
- Repli fichier (ATI) non retenu : latence et fiabilité insuffisantes pour la réplication.
