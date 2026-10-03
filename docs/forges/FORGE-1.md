**`SIΞRRΛSKΛ—LAB · CΛNTO · FORGE 1 · LE PORT ET LE ROUTEUR · 2026-10-03 → 2026-10-12`**

# Forge 1 — le port et le routeur

Objet : livrer l'`ExecutionPort` et la réplication du Copieur, Sim seulement. Sortie : Release **3.3.0**, taguée par l'ADMIN. Branche de travail : `cursor/forge-1-port-routeur-5da4` (le nom `forge/1-execution-port` du plan d'origine est réservé au dépôt ; cette branche porte le même objet). Base : `main` à v3.2.2. La montée `package.json` et le tag `v3.3.0` restent l'acte de l'ADMIN.

Ce qui est hors de cette forge, sans discussion : compte réel pour les suiveurs (Forge 2), journal certifié (L.4, Forge 2), `PROTOCOLE-AGENT.md` (L.3, Forge 2), licence (L.6, Palier 1), tout adaptateur autre que NT8, toute refonte design, tout changement du protocole du pont vu par l'AddOn C#.

Lecture obligatoire avant J1 : `CLAUDE.md`, `docs/AGENT-HARDENING.md` § 0, `docs/PONT-NINJATRADER.md`, README › *Copier* et › *NinjaTrader 8 bridge*.

---

## 0. Décisions de l'ADMIN (à trancher en J1, avant tout code)

| # | Question | Défaut proposé | Décision |
|---|---|---|---|
| D1 | Que fait **Couper** sur le Copieur ? | Désarme le routeur et annule les ordres suiveurs en attente. Aplatir les suiveurs est une option explicite, défaut `off`. Le kill switch global du pont garde son comportement actuel et désarme aussi le routeur. | ☑ Défaut retenu |
| D2 | Qui peut être maître ? | Un seul compte maître par topologie, `Sim*` ou réel (le réel passe par le dialogue de compte réel existant). Les suiveurs sont `Sim*` dans cette forge, sans exception. | ☑ Défaut retenu |
| D3 | Dimensionnement par défaut | Ratio 1:1 sur la même racine ; carte NQ ↔ MNQ du prototype ; plafond du pont respecté par suiveur. | ☑ Défaut retenu |
| D4 | Idempotence | Clé = identifiant d'exécution du maître (déjà persisté par l'import). Un fill maître est routé au plus une fois par suiveur, y compris après redémarrage. | ☑ Défaut retenu |
| D5 | Budget de latence | Un fill maître plus vieux que le budget du prototype est refusé, consigné, jamais rattrapé. | ☑ Défaut retenu |
| D6 | Blackout et marge plancher | Repris tels quels du prototype : blackout catalyseurs via le calendrier, marge plancher via `evaluatePlan` sur le plan du suiveur. Un refus est consigné, jamais silencieux. | ☑ Défaut retenu |
| D7 | Règles Apex | Le testeur obtient une confirmation écrite d'Apex sur la copie entre comptes propres et sur l'automatisation. Condition de la Forge 2, pas de celle-ci. | ☑ Reporté à la Forge 2 |

---

## 1. J1 — carte et plan (mode plan, aucun code)

Prompt d'ouverture de session, à coller tel quel :

> Lis `CLAUDE.md`, `docs/AGENT-HARDENING.md` § 0 et `docs/forges/FORGE-1.md`. Reste en mode plan. Produis `docs/forges/F1-CARTE.md` : (1) le chemin exact d'un ordre aujourd'hui, du renderer à l'AddOn (fichiers, fonctions, canaux IPC, méthodes JSON-RPC), avec les symboles cités tels qu'ils existent ; (2) le chemin exact d'une exécution entrante jusqu'au journal ; (3) la sémantique actuelle du kill switch global ; (4) la forme exacte du store du Copieur (`src/store/copier.ts`) et des règles du prototype ; (5) la forme de `tabs.ts` et des tests qui énumèrent le rail. Puis confirme ou corrige, fichier par fichier, le plan de tickets F1.2 à F1.8 ci-dessous. Si un symbole n'existe pas tel quel, dis-le ; n'invente rien. Aucune modification de fichier de code tant que l'ADMIN n'a pas validé la carte.

Livrable J1 : `docs/forges/F1-CARTE.md`, décisions D1–D7 cochées (défauts retenus). Commit `F1.1 carte et plan`.

---

## 2. J2–J7 — tickets

Règle : un ticket = un commit = un test ; `npm run typecheck && npm test` vert avant le suivant ; la carte F1 est la source des noms de symboles. Chaque case est cochée dans ce fichier au commit.

### F1.2 — `ExecutionPort`

- Fichiers : **créer** `src/engine/execution/port.ts`, `src/engine/execution/adapters/memory.ts`, `tests/execution-port.test.ts`.
- Modèle : `src/engine/marketdata/port.ts` (identifiant de source, `capabilities` déclarées, événements typés, `Unsubscribe`).
- Contenu : types `OrderRequest` (instrument, side, qty, type, limite / stop optionnels, OCO optionnel, `tag` obligatoire, `account`), `OrderAck`, `ExecutionEvent` (`fill` · `order` · `accounts` · `status`), interface `ExecutionPort` : `submit`, `cancel`, `flatten`, `subscribe`, `status`, `capabilities`. TypeScript pur : aucun import de `src/store`, `src/modules`, Electron.
- `memory.ts` : adaptateur en mémoire qui accuse réception, émet un `fill` sur demande, et sert à tous les tests du routeur.
- Preuve : test d'interface sur l'adaptateur mémoire — soumission, annulation, aplatissement, événements dans l'ordre.
- ☑ fait · commit `F1.2 ExecutionPort`

### F1.3 — gardes pures

- Fichiers : **créer** `src/engine/execution/guards.ts`, `vectors/execution.guards.json`, `tests/execution-guards.test.ts` ; **modifier** `electron/nt-bridge/guards.ts` pour déléguer.
- Contenu : les décisions pures du pont — compte autorisé (`Sim*` ou liste), plafond 1–1000, `tag` obligatoire, état du lien `live`, kill switch — extraites en fonctions sans effet, qui rendent les **mêmes codes** qu'aujourd'hui (`-32010` compte, `-32011` lien, `-32012` plafond, `-32013` tag). Le fichier Electron garde ses signatures et appelle le moteur.
- Preuve : `tests/nt-bridge-guards.test.ts` reste vert **sans modification** ; le vecteur couvre chaque code et le cas accepté.
- ☑ fait · commit `F1.3 gardes pures`

### F1.4 — adaptateur NT8

- Fichiers : **créer** `electron/nt-bridge/execution-port.ts` ; **modifier** `electron/nt-bridge/index.ts` pour l'exposer à l'hôte ; **étendre** `tests/nt-bridge-e2e.test.ts`.
- Contenu : une classe qui implémente `ExecutionPort` par-dessus l'hôte existant — `submit` → `order.submit`, `cancel` → `order.cancel`, `flatten` → `order.flatten` ; `bridge.execution` → événement `fill`, `bridge.order` → `order`, `bridge.accounts` → `accounts`, état du lien → `status`. **Aucun changement** de `protocol.ts` ni de `CantoBridge.cs`.
- Preuve : E2E avec `scripts/fake-addon.mjs` — un ordre soumis par le port arrive à l'AddOn factice avec les mêmes gardes qu'un ordre du panneau ; un fill factice ressort en événement `fill`.
- ☑ fait · commit `F1.4 adaptateur NT8`

### F1.5 — routeur pur

- Fichiers : **créer** `src/engine/copier/types.ts`, `src/engine/copier/router.ts`, `vectors/copier.route.basic.json`, `vectors/copier.route.blackout.json`, `vectors/copier.route.prop-floor.json`, `tests/copier-router.test.ts`.
- Contenu : `routeFill(fill, topology, context) → { orders: OrderRequest[]; refused: Refusal[] }`. Entrées : le fill maître, la topologie (maître, suiveurs, règles de sizing fixe / ratio / risque, carte NQ ↔ MNQ, fenêtre locale, budget de latence, blackout, marge plancher), le contexte (heure, catalyseurs du calendrier, plan prop et état du suiveur, positions). Chaque refus porte un motif (`latency`, `window`, `blackout`, `floor`, `cap`, `instrument`). Les types du prototype (`src/store/copier.ts`) sont **déplacés** dans `types.ts` ; le store les importe désormais du moteur.
- Preuve : trois vecteurs — basique (1 NQ maître → 2 suiveurs ratio et fixe), blackout (fill dans la fenêtre → refusé), plancher (suiveur à la marge → refusé, l'autre passe). `evaluatePlan` de `src/engine/propfirm.ts` est appelé, pas réécrit.
- ☑ fait · commit `F1.5 routeur pur`

### F1.6 — hôte de réplication

- Fichiers : **créer** `electron/nt-bridge/copier-host.ts` ; **modifier** `electron/main.ts` et `electron/preload.ts` (méthodes nommées uniquement, comme le reste de `canto.*`) ; **étendre** `tests/nt-bridge-e2e.test.ts` ; **créer** `tests/copier-host.test.ts`.
- Contenu : l'hôte s'abonne aux `fill` du compte maître sur l'adaptateur F1.4, appelle `routeFill`, soumet les ordres suiveurs par le port **seulement si** `armed === true` et lien `live`. Désarmé par défaut au démarrage, toujours. Idempotence D4 persistée dans `userData` (même esprit que `.seen.txt`), jamais dans le coffre. Couper selon D1. Journal : fill maître, ordres routés, refus avec motif, compte, instrument, quantité — jamais de jeton.
- Preuve : E2E `fake-addon` — fill maître `Sim101` → ordres `Sim102` et `Sim103` dimensionnés ; même fill rejoué → zéro ordre ; fill en blackout → refus consigné ; Couper → désarmé et annulations, sous 200 ms ; redémarrage → toujours désarmé.
- ☑ fait · commit `F1.6 hôte de réplication`

### F1.7 — le Copieur revient sur le rail

- Fichiers : **modifier** `src/app/tabs.ts`, `src/modules/copieur/Copieur.tsx`, `src/store/copier.ts` ; **mettre à jour** `tests/tabs.test.ts` et `tests/rail-3.2.2.test.ts` (ou le test qui énumère le rail, selon la carte F1).
- Contenu : onglet `08 · CPY`. Armer passe par un dialogue explicite (même ton que le dialogue de compte réel), Couper visible en permanence, état : lien, armé / désarmé, fills routés, dernier refus et son motif. Jetons du Système 3.4 uniquement, aucun nouveau jeton, aucun redessin des autres modules.
- Preuve : tests du rail et des onglets verts ; `tests/design-guard.test.ts` vert.
- ☑ fait · commit `F1.7 rail CPY`

### F1.8 — documents

- Fichiers : README (tableau *In short*, section *Copier*, *Roadmap* : port d'exécution, réplication Sim, Copieur sur le rail en `08 · CPY`, désarmé à l'ouverture ; hors de cette forge : journal certifié, protocole d'agent, licence), `docs/PONT-NINJATRADER.md` (section « Réplication »), `src/engine/changelog/changelog.json` (entrée **3.3.0**, trois langues ; la montée de version dans `package.json` reste à l'ADMIN).
- Preuve : `npm run check` vert ; le test du journal de version accepte l'entrée.
- ☑ fait · commit `F1.8 documents 3.3.0`

---

## 3. J8 — audit en nuée

Session séparée, lecture seule, cinq sous-agents, un axe chacun. Chaque constat est vérifié dans le code et consigné dans `docs/AUDIT.md`, section « 3.3.0 », avec sa preuve ; rien n'est corrigé pendant l'audit.

| Auditeur | Mandat |
|---|---|
| Moteur | `routeFill` et les gardes : cas limites de sizing, arrondis de quantité, carte NQ ↔ MNQ, fuseau des fenêtres, vecteurs incomplets |
| Interface | `08 · CPY` : états incohérents, armement sans dialogue, Couper masqué, textes hors Système 3.4 |
| Performance | Latence fill → ordre suiveur sur `fake-addon`, pression mémoire de l'idempotence, redémarrage |
| Sécurité | Chemin d'un ordre suiveur : gardes contournables, compte réel atteignable, jeton dans un journal, IPC exposé au-delà des méthodes nommées |
| Design | Conformité `DESIGN.md` : jetons, LED, chanfrein, lecteur unique, annotations |

Les correctifs deviennent les tickets `F1.9+`, mêmes règles.

---

## 4. J9 — preuve

1. Pousser la branche ; CI verte sur les trois OS.
2. E2E `fake-addon` complet (F1.4, F1.6) sur la machine de l'ADMIN.
3. Le testeur, sur son NinjaTrader 8 avec son flux Apex : maître `Sim101` → suiveur `Sim102`, une séance ; rejeu d'une exécution ; Couper. Aucun compte Apex dans cette forge.
4. L'ADMIN relit `docs/AUDIT.md` « 3.3.0 ». Rien d'ouvert en P0 ou P1.

## 5. J10 — Release

Par l'ADMIN seulement : fusion dans `main`, version `3.3.0` dans `package.json`, tag `v3.3.0`, Release, annonce sur le canal (L.8). La Forge 2 ne s'ouvre pas avant.

---

## 6. Règle de coupe

Si F1.6 n'est pas vert au soir du J7, F1.7 et F1.8 glissent en **Forge 1b** (trois jours, même branche, mêmes règles) et la Release devient `3.3.0` à la fin de 1b. On coupe la brique, pas la cadence, et jamais les tests.

**`SIΞRRΛSKΛ—LAB · CΛNTO · FORGE 1 · UN TICKET, UN COMMIT, UN TEST`**
