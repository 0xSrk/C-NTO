# Pont NinjaTrader — spécification du protocole CΛNTO Bridge

Le pont relie NinjaTrader 8 (poste du trader) au shell CΛNTO, en local uniquement. Il est composé de deux moitiés :

- **Côté CΛNTO** : un serveur WebSocket JSON-RPC 2.0 ouvert par le shell Electron sur `ws://127.0.0.1:<port>` (module *Agent IA › Orchestrateur externe* — le même serveur accepte l'orchestrateur IA et le pont, différenciés par la méthode `hello`).
- **Côté NinjaTrader** : un AddOn NinjaScript (« CΛNTO Bridge », livraison ultérieure) qui se connecte au serveur, publie l'état des comptes et exécute les ordres de réplication.

Aucune donnée ne quitte la machine : pas de serveur tiers, pas de télémétrie.

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
