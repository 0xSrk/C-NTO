**`SIΞRRΛSKΛ—LAB · CΛNTO · BRIEF AGENT · COUCHE AGENTIQUE · VAGUE 2`**

# Brief agent — couche agentique, vague 2

Date : 2026-10-06
Dépôt : `0xSrk/C-NTO`
Base : `main` à `f93fa75` (PR #100, vague 1 fusionnée)
Version `package.json` : `3.4.0`, à ne pas toucher

Tu es un agent d'implémentation. Tu reprends la couche agentique là où la vague 1 l'a laissée. Tu modifies **ce dépôt uniquement**. Tu ne réinventes pas l'architecture : elle est décrite au § 2 et elle tient.

---

## 0. À lire d'abord, dans cet ordre

1. `CLAUDE.md` : règles du dépôt. Elles s'appliquent à **toute** session d'agent, quel que soit l'outil, et priment sur tes réglages par défaut.
2. `docs/THESE-AGENTIQUE.md` : le cap. Lis surtout le § 3 (ce que CΛNTO refuse) et le § 7 (décisions de l'ADMIN).
3. `docs/AUDIT.md`, section « Couche agentique du trader — thèse et vague 1 » : constats T1 à T16, ce qui est livré et les constats non corrigés.
4. `docs/PROTOCOLE-AGENT.md` : contrat des outils, des événements, de la passerelle MCP et des ordres proposés.

---

## 1. Protocole (obligatoire)

1. **Lire avant d'écrire.** Ouvre les fichiers listés dans le ticket et cite les symboles tels qu'ils existent. Si un fichier ou un symbole n'existe pas tel quel, **STOP** : note l'écart dans ton rapport et ne l'invente pas.
2. **Un ticket = un commit = un test.**
   - Écris d'abord le test et constate qu'il **échoue** ; note le message d'échec.
   - Corrige, puis constate qu'il **passe**.
   - Message de commit court, impératif, en français, préfixé du ticket. Exemple : `A12.1 dire quand proposer le brief et le débrief`.
3. **Vert avant le ticket suivant :** `npm run typecheck && npm test`.
4. **Avant de pousser :** `npm run check` (typecheck, tests, build), plus `npm run electron:compile` si `electron/` change. Lance la suite complète **trois fois** avant d'ouvrir la PR.
5. **Confidentialité (`CLAUDE.md` § 1).** Aucun trailer, aucune signature, aucun lien de session, aucune mention de l'outil ou d'un modèle. Cela vaut dans les commits, la PR, les commentaires de code ou de revue et les documents. **Désactive** tout trailer ou pied de page que ton outil ajoute de lui-même, et relis la description de la PR après l'avoir créée.
6. **Pas de dépendance npm nouvelle, pas de jeton de design nouveau.** `tests/design-guard.test.ts` doit rester vert.
7. **Deux interprétations possibles :** garde le comportement actuel et ajoute un test qui le fige.
8. **Ne recode pas** ce qui est déjà livré et consigné. Vérifie le HEAD (`git log`, `grep`) avant chaque ticket.
9. **Consigne :**
   - une section « Couche agentique du trader — vague 2 » dans `docs/AUDIT.md`, nouveaux constats numérotés à partir de **T17** et cités `fichier:ligne` ;
   - `docs/PROTOCOLE-AGENT.md` mis à jour pour **tout** outil, événement ou comportement MCP qui change.

---

## 2. Carte de la couche agentique : ce qui EXISTE (ne pas recréer)

| Zone | Chemin | Faits à ne pas contredire |
|---|---|---|
| Catalogue | `src/engine/agent/catalog.ts` | **Aucun import** (le process principal le compile). Il contient :<br>• `DESK_TOOL_KINDS` : 22 outils, 17 lectures et 5 écritures ;<br>• `ORDER_TOOLS` ;<br>• `DESK_TOOL_HINTS` et `DESK_TOOL_TITLES`, typés `Record<DeskToolName, …>` : un outil nouveau sans entrée = typecheck rouge ;<br>• `TOOL_PREAMBLE` ;<br>• `DESK_EVENT_KINDS` : `fill`, `order`, `prop_buffer`, `catalyst`, `bridge_link`, `agent_order`, `daily_loss`, `discipline`. |
| Outils | `src/engine/agent/tools.ts` | • `createDeskTools(ports)` : description française dans l'outil, anglais et espagnol dans `toolBlurb` ;<br>• `EMPTY_PORTS` ;<br>• les lectures du journal rendent `asOf`, `sources`, `demo`. |
| Ports | `src/engine/agent/ports.ts` | Un port nouveau s'ajoute partout :<br>• `livePorts` (`src/store/agent.ts`) ;<br>• `EMPTY_PORTS` ;<br>• `tests/helpers/deskPorts.ts` ;<br>• `tests/helpers/demoDesk.ts` ;<br>• les faux ports de plusieurs tests (`grep -rn "bridge: async" tests`). |
| Boucle | `src/engine/agent/loop.ts`, `context.ts`, `runner.ts` | • `runAgentTurn` : `MAX_TOOL_ROUNDS` = 6, chaque appel reçoit un résultat ;<br>• `fitHistory` ;<br>• `executeDeskTool` : source `llm` ou `orch`, `confirmFn`, `allowWrite`. |
| Consigne | `src/store/agent.ts` | • `agentSystemPrompt(settings, memory, now)` : la mémoire n'entre que si `settings.agent.toolsEnabled` ;<br>• `deskClock` : heure de New York et journée CME. |
| Mémoire | `src/engine/agent/memory.ts` | • `traderMemory` et `memoryDigest` ;<br>• les notes `by: 'agent'` sont **exclues** (`excludedAgentNotes`). |
| Discipline | `src/engine/discipline.ts` | • `TraderRules`, `coerceTraderRules`, `tradingDayNow`, `dayLoss`, `dailyLimit`, `detectDrifts`, `detectRuleBreaches`, `majorCatalysts` ;<br>• `Settings.traderRules` ;<br>• `DisciplineFields` dans `src/modules/metrique/SettingsModal.tsx`. |
| Événements | `src/engine/agent/events.ts`, `src/store/deskEvents.ts` | • `DeskEventLog` : 500 entrées, en mémoire ;<br>• `propBufferAlert`, `dailyLossAlert`, `ThresholdWatch` (hystérésis, premier passage muet). |
| Routines | `src/engine/agent/routines.ts` | • **Aucun import** (compilé pour le process principal) ;<br>• `ROUTINES` : `pre_session_brief`, `session_debrief`, `prop_plan_review` ;<br>• `renderRoutine(name, args, { locale, allowWrites, now })` ;<br>• servies **seulement** en prompts MCP pour l'instant. |
| MCP | `electron/mcp-server.ts`, `electron/desk-relay.ts` | • Écrit à la main, **sans SDK** ;<br>• type d'outil lu dans `DESK_TOOL_KINDS`, jamais dans la réponse du renderer ;<br>• 8 appels en vol au plus ;<br>• `tools` et `prompts`, sans `resources`. |
| Orchestrateur | `electron/orchestrator.ts` | WebSocket JSON-RPC, `desk.describe` construit dans `src/store/agent.ts` (`onRequest`). |
| Ordres proposés | `src/engine/agent/orders.ts`, `electron/agent-orders.ts`, `src/store/agentOrders.ts` | • `parseProposal` (contrôle et bidi refusés), `guardProposal`, `AgentOrderHost`, `heldPosition` ;<br>• dialogue du process principal, Refuser par défaut, 45 s. |
| Séance | `src/engine/execution/orderBook.ts`, `electron/nt-bridge/order-book-host.ts`, `src/engine/marketdata/quotes.ts` | • IPC `ntbridge:orders` et `ntbridge:order-state` ;<br>• preload `desk.ntbridge.orders()` et `onOrder` ;<br>• `bridgeQuotes` dans `src/store/bridge.ts` ;<br>• `accountsAt` sur le statut du pont. |
| LLM | `electron/llm-host.ts`, `src/store/settings.ts` | • `llmFetch` refuse toute redirection ;<br>• `keyFor` et `llmKeyHost` ;<br>• champ `apiKeyHost`. |
| Harnais | `tests/helpers/scriptedLlm.ts`, `demoDesk.ts`, `agentEval.ts` | • `runScenario` pilote la **vraie** boucle et le vrai `executeDeskTool` ;<br>• attendus recalculés par les moteurs de l'écran, jamais en dur. |

---

## 3. Pièges connus : les tests qui gardent

- **`tests/mcp-catalog.test.ts`** : chaque outil a ses indications et son titre en trois langues.
- **`tests/agent-tool-schemas.test.ts`** :
  - aucun `type: 'number'` hors prix et montants ;
  - entiers bornés ;
  - dates au motif `^\d{4}-\d{2}-\d{2}$`.
- **`tests/agent-routines.test.ts`** :
  - les outils cités dans le texte égalent `reads` ∪ `writes`, les écritures seulement si `allowWrites` ;
  - tout identifiant en snake_case est un outil ou un type d'événement du catalogue ;
  - étapes numérotées de 1 à n dans **chaque** langue ;
  - jamais `propose_order`.
- **`tests/agent-events.test.ts` et `tests/agent-events-tool.test.ts`** : ils figent la liste `DESK_EVENT_KINDS`. La description de `desk_events` doit nommer `order`, `daily_loss`, `discipline` et `agent_order`.
- **Fuseau** : `TZ=UTC` est fixé par `vitest.config.mts` (`tests/suite-timezone.test.ts`).
- **Binaire Electron** : `tests/orchestrator-allowlist.test.ts` importe `electron`. Si `npm ci` n'a pas téléchargé le binaire, lance `node node_modules/electron/install.js`.
- **Typecheck** : Vitest passe même quand les types des aides de test sont faux. Lance toujours `npm run typecheck`, qui couvre `tests/helpers`.
- **Clé `db.settings`** : une clé nouvelle se déclare dans la table de restauration de `src/store/db.ts`, sur le modèle de `'agent.conversation'`.
- **Module partagé avec le process principal** : il se déclare à trois endroits, `electron/tsconfig.sources.json`, un `.d.ts` sous `electron/` et la table de `vitest.config.mts`.
- **Échecs sous forte charge** : deux échecs non identifiés ont été vus pendant la vague 1. Si un test tombe, relance-le seul et cherche la cause. On ne saute, ne désactive ni ne met en quarantaine aucun test.

---

## 4. Hors périmètre : décisions de l'ADMIN (ne pas coder)

- **Gardes de `propose_order`.**
  - Ne touche pas `guardProposal` (`src/engine/agent/orders.ts`) ni les gardes d'`electron/agent-orders.ts`, sauf pour **refuser plus**, et seulement si un ticket le demande.
  - Refuser un ordre contraire aux règles du trader est une décision ouverte.
- **Marge de la garde A5 et de `prop_buffer`.** Elles lisent `buffer` plus le latent (`src/store/deskEvents.ts`, `src/store/agentOrders.ts`, `propShare`). Garde `buffer` tel quel.
- **Abonnement aux données de marché par l'agent.** `market_quote` reste une lecture du cache.
- **`ninjatrader/CantoBridge.cs`** (AddOn 2.3.0, D3) : ne pas modifier.
- **Réservé à l'ADMIN** : version de `package.json`, tag, Release, fusion dans `main`, clés de publication et de siège.
- **Rien hors de `127.0.0.1`** : ni tunnel, ni connecteur cloud.
- **Invariants de `CLAUDE.md` § 5** : n'en affaiblir aucun.
- **Modèle du Lab** : pas d'hôte nouveau dans `electron/llm-host.ts`.

---

## 5. Vague 2 : tickets, dans cet ordre

Chaque ticket donne ce qu'il faut lire, le constat à vérifier sur le HEAD, ce qu'il faut faire et le test. Un constat absent du HEAD : « déjà là », zéro diff.

### A11 · Garde (suite)

**A11.6 refuser les redirections des sources de calendrier.**
- **Lire :**
  - `electron/calendar/index.ts` (`net.fetch`, `hostOk`) ;
  - `electron/calendar/sync.ts` (vers la ligne 104 : `hostOk` ne contrôle que la première URL) ;
  - `electron/llm-host.ts` (`llmFetch`, le modèle à suivre).
- **Constat :** les synchronisations suivent les redirections. Un 307 de BLS renverrait `registrationkey` à un autre hôte.
- **Faire :**
  - refuser toute réponse 3xx (`redirect: 'manual'` ; vérifie l'option dans la doc d'Electron pour la version du dépôt) ;
  - l'erreur reste lisible dans l'état de synchronisation.
- **Test :** un faux `fetchImpl` répond 307 vers un autre hôte ; l'appel échoue et le second hôte n'est jamais appelé.

### A6 · Vérité (suite)

**A6.10 dire « sans perte » pour le payoff.**
- **Lire :** `src/engine/agent/tools.ts` (vers la ligne 200, `payoffRatio`).
- **Faire :** comme `profitFactor` (A6.8), sans perte, `noLoss: true` au lieu de `null`.
- **Test :** différentiel sur une tranche sans perte.

**A6.11 borner les tags rendus par list_sessions et get_session.**
- **Lire :** `tools.ts` (vers les lignes 257 et 302) et les constantes `TAGS_MAX` / `TAG_LEN_MAX` de `ports.ts`.
- **Faire :** au plus 20 tags de 40 caractères, avec un indicateur de coupe.
- **Test :** séance importée avec 500 tags.

### A12 · Routines dans l'agent embarqué

**A12.1 dire quand proposer le brief et le débrief.**
- **Faire :** module pur **nouveau** `src/engine/agent/routineDue.ts`. Pas dans `routines.ts`, qui doit rester sans import. Il peut importer `src/lib/time` et `src/lib/cmeClosed.ts` (`cmeSession`, journées fermées ou écourtées). Il définit `routineDue(now, ctx)` :
  - brief proposé un jour de séance CME, entre 8 h 30 et 9 h 30 heure de New York ;
  - rien le samedi ni les jours fermés ;
  - débrief proposé après 16 h 15 ET s'il y a des trades du jour, ou dès qu'un `daily_loss` à 100 % est franchi.
- **Test :** chaque cas, plus « une seule proposition par routine et par journée CME ».

**A12.2 lancer une routine depuis le store.**
- **Lire :** `src/store/agent.ts` (`send`), `renderRoutine`.
- **Faire :** `runRoutine(name, args)` rend le texte dans la langue active, puis appelle `send(text)`.
  - `allowWrites` vaut `settings.agent.toolsEnabled` : les écritures de l'agent embarqué passent par la confirmation du trader.
  - Outils coupés : refus avec un avis en trois langues, rien n'est envoyé.
- **Test :** le texte envoyé égale `renderRoutine(...)` ; outils coupés, aucun appel au fournisseur.

**A12.3 montrer brief et débrief dans l'onglet Agent.**
- **Lire :** `src/modules/agent/Agent.tsx`.
- **Faire :**
  - deux boutons, « Brief » et « Débrief » ;
  - une pastille quand `routineDue` le dit ; la journée vue est gardée dans `db.settings` (clé déclarée dans `db.ts`).
- **Ne pas :** envoyer quoi que ce soit sans clic du trader.
- **Test :** pastille une fois par journée ; aucun envoi sans clic ; `design-guard` vert.

### A13 · Séance à l'écran (D1 du plan 3.5.0)

**A13.1 afficher la séance en cours en tête de Métrique.**
- **Lire :**
  - `src/modules/metrique/Metrique.tsx` ;
  - `src/store/bridge.ts` ;
  - `src/engine/discipline.ts` (`dayLoss`, `dailyLimit`) ;
  - `src/engine/portfolio/view.ts`.
- **Faire :**
  - une fonction pure de vue (testée) ;
  - un bloc avec les composants existants : P&L du jour réalisé et latent, solde, positions, fraîcheur (`accountsAt`), perte du jour face à la limite et sa source, trades du jour face au maximum ;
  - visible seulement pont `live`.
- **Test :** vue sur des comptes datés de 10 s puis de 10 min (fraîcheur) ; `design-guard`.

**A13.2 afficher les ordres en cours.**
- **Faire :**
  - liste lue par `desk.ntbridge.orders()` et tenue à jour par `onOrder` ;
  - `complete: false` affiché « livre incomplet (AddOn 2.2.0) » ;
  - marque des ordres de l'agent (`byAgent`).
- **Ne pas :** ajouter le moindre bouton d'action (annuler, modifier). C'est une lecture.
- **Test :** vue pure ; démontage qui se désabonne.

**A13.3 abonner Visual au flux NinjaTrader** (D2 du plan 3.5.0, le plus gros ticket, en dernier).
- **Lire :**
  - `src/modules/visual/Visual.tsx` ;
  - `src/store/bars.ts` (`createPort`, `ntFeed`) ;
  - `src/engine/marketdata/index.ts` ;
  - les IPC `marketdata:subscribe` et `marketdata:history`.
- **Faire :** Visual s'abonne à l'instrument et à l'unité affichés, à la demande du trader (historique puis direct). L'agent, lui, ne s'abonne toujours pas.
- **Test :** port simulé ; désabonnement au changement d'instrument et au démontage.

### A14 · Porte (suite)

**A14.1 titrer les outils dans desk.describe.**
- **Lire :** `src/store/agent.ts` (`onRequest`, `desk.describe`).
- **Faire :** chaque outil porte `title` (`DESK_TOOL_TITLES`, langue active).
- **Test :** dans `tests/desk-relay.test.ts` ou un fichier nouveau.

**A14.2 traduire les derniers messages du process principal.**
- **Lire :** `electron/mcp-server.ts` : refus d'écriture vers la ligne 266, erreurs HTTP 401, 403, 405, 413 et 429.
- **Faire :** trois langues, avec la langue lue comme en A8.9.
- **Test :** langue `en`.

**A14.3 exposer le desk en ressources MCP.**
- **Faire :**
  - capacité `resources`, `resources/list`, `resources/templates/list`, `resources/read` ;
  - ressources fixes : `canto://desk/overview`, `canto://plan/tracked` ;
  - modèles : `canto://session/{date}`, `canto://note/{id}` ;
  - chaque lecture appelle un **outil de lecture** par le relais, typé par `DESK_TOOL_KINDS` ;
  - une URI inconnue rend `-32002` ;
  - aucune écriture exposée.
- **Test :** dans `tests/mcp-server.test.ts`.

**A14.4 déclarer un schéma de sortie par outil de lecture.**
- **Faire :**
  - `outputSchema` minimal : objet, propriétés de tête, `additionalProperties: true` ;
  - plus de `structuredContent` sous `isError`, sinon un client qui valide rejette l'appel.
- **Test :** mini-validateur écrit à la main ; un refus n'a pas de `structuredContent`.

**A14.5 copier la configuration pour Claude Desktop et Codex.**
- **Lire :** `src/modules/agent/mcpClients.ts`, `Agent.tsx`, `docs/PROTOCOLE-AGENT.md` § 2.
- **Faire :**
  - Claude Desktop : le bloc `mcp-remote` déjà documenté ;
  - Codex : la syntaxe **vérifiée** dans sa documentation officielle, avec le jeton par variable d'environnement. Si tu ne peux pas la vérifier, ne livre que Claude Desktop et dis-le.
- **Test :** dans `tests/mcp-clients.test.ts`.

### A15 · Mémoire adoptée

**A15.1 adopter une leçon proposée par l'agent.**
- **Lire :**
  - `src/store/db.ts` (`Note`, `CHECKS`, restauration) ;
  - `src/store/notes.ts` ;
  - `src/engine/agent/ports.ts` (`DeskNote`) ;
  - `src/engine/agent/memory.ts`.
- **Faire :**
  - champ `Note.adoptedAt?: number` (via `CHECKS`, lisible par un coffre ancien) ;
  - `adopt(id)` dans le store, **geste du trader seulement** : aucun outil ne peut le poser, et `create_note` ignore tout argument de ce nom ;
  - `traderMemory` garde une note `by: 'agent'` seulement si elle est adoptée.
- **Test :**
  - coffre ancien lu ;
  - `adoptedAt` non numérique rejeté ;
  - leçon d'agent adoptée présente dans la mémoire, non adoptée absente ;
  - aucun outil du catalogue ne pose `adoptedAt`.

**A15.2 montrer et adopter dans l'onglet Notes.**
- **Lire :** `src/modules/note/Note.tsx`.
- **Faire :** sur une note `by: 'agent'`, un bouton « Adopter » (trois langues) et la date d'adoption.
- **Test :** `design-guard` ; le bouton n'existe pas sur une note du trader.

### A16 · Preuve (suite)

**A16.1 couvrir les outils de la vague 1 par le harnais.**
- **Lire :** `tests/helpers/agentEval.ts`, `tests/agent-eval.test.ts`.
- **Faire :** scénarios dorés différentiels :
  - `discipline_status` (perte du jour égale à `dayLoss`) ;
  - `trader_memory` (note d'agent absente) ;
  - `working_orders` (livre simulé) ;
  - `market_quote` (cotation périmée).
- **Test :** les scénarios eux-mêmes ; vérifie-les en cassant volontairement le moteur, puis en le remettant.

**A16.2 prouver qu'un événement injecté ne fait rien partir.**
- **Faire :** un `agent_order` dont `why` contient une consigne, et un titre de catalyseur piégé, lus par `desk_events`. Aucune écriture ni aucun ordre sans confirmation.
- **Test :** dans `tests/agent-injection.test.ts`.

---

## 6. Branches et PR

- `git fetch origin main`, puis une branche par piste depuis `origin/main`, avec un nom neutre, sans nom d'outil. Exemple : `agentique/a12-routines`.
- Une PR **brouillon** par piste, pour que chaque relecture reste courte. La fusion est l'acte de l'ADMIN.
- La description de PR dit :
  - les tickets ;
  - les tests et les échecs observés sans le correctif ;
  - que les invariants ne bougent pas ;
  - que `CantoBridge.cs` ne change pas.

---

## 7. Fini, c'est

- `npm run check` et `npm run electron:compile` verts, et trois passages complets de la suite verts.
- `docs/AUDIT.md` : section « Couche agentique du trader — vague 2 », avec le tableau piste, commits, tests, ce qui change, puis les constats nouveaux non corrigés.
- `docs/PROTOCOLE-AGENT.md` à jour.
- `docs/THESE-AGENTIQUE.md` : rien à changer, sauf le tableau du § 4 si une couche change d'état. Le § 7 reste à l'ADMIN.
- Rien du § 4 de ce brief n'a été touché.

---

## 8. Commandes

```bash
npm ci                         # Node 22.12+
npm run typecheck
npm test
npm run check                  # typecheck + tests + build
npm run electron:compile       # si electron/ change
TZ=America/New_York npm test   # contrôle : la suite fixe UTC d'elle-même
```
