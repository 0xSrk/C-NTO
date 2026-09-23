# Pont NinjaTrader — CΛNTO Bridge

Le pont relie NinjaTrader 8 (poste du trader) au desk CΛNTO, en local uniquement. Aucune donnée ne quitte la machine : pas de serveur tiers, pas de télémétrie.

Il existe en deux étages :

| Étage | État | Rôle |
| --- | --- | --- |
| **Transport fichier (CSV)** | **implémenté** | import automatique des exécutions et des exports NinjaTrader vers le journal Métrique |
| Transport WebSocket JSON-RPC | spécifié (section B) | réplication d'ordres (copieur), exécution des automates, état des comptes |

---

## A. Transport fichier — import automatique (implémenté)

### Principe

1. Le shell CΛNTO — application native macOS, Windows ou Linux — surveille un dossier (`Métrique › Pont NinjaTrader`), par défaut `Documents/NinjaTrader 8/export/CANTO` sous le dossier Documents du système.
2. Tout fichier `.csv` / `.txt` nouveau ou modifié y est lu dès que sa taille est stable (NinjaTrader a fini d'écrire), puis transmis au journal.
3. Le journal détecte le format — export **Trades** (Trade Performance), export **Executions**, ou **CΛNTO CSV** — et importe. Les exécutions sont appariées en trades aller-retour par compte et par contrat, méthode **FIFO** avec fractionnement des remplissages partiels ; les commissions sont réparties au contrat.
4. Le dédoublonnage (empreinte instrument · sens · quantité · horodatages · prix) garantit qu'un fichier relu ou un export répété ne crée jamais de doublon : le journal temps réel qui grossit toute la journée est simplement rejoué.
5. L'état du pont (dossier, fichiers déjà traités, dernier import) est persisté dans `%APPDATA%\CΛNTO\bridge-state.json` ; « Relire le dossier » force un rejeu complet.

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

## B. Transport WebSocket — spécification (à venir)

Le second étage réutilise le serveur WebSocket JSON-RPC 2.0 ouvert par le shell Electron sur `ws://127.0.0.1:<port>` (module *Agent IA › Orchestrateur externe*). Le même serveur accepte l'orchestrateur IA et le pont, différenciés par la méthode `hello`.

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
