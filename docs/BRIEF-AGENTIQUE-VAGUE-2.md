**`SIΞRRΛSKΛ—LAB · CΛNTO · BRIEF AGENT · COUCHE AGENTIQUE · VAGUE 2`**

# Brief agent — couche agentique, vague 2

Date : 2026-10-06
Dépôt : `0xSrk/C-NTO`
Base : `main` à `d9b39aa` (vague 1, étapes 3 à 5 des Métriques, A11.6)
Mis à jour : 2026-10-06, après la revue des PR #97 à #109 (§ 5)
État : § 5.1, § 5.2 et § 5.3 faits, sur la branche `agentique/vague-2` (`docs/AUDIT.md` › « vague 2 › Corrections ») ; décisions de la vague 3 arrêtées le 2026-10-06 (`docs/THESE-AGENTIQUE.md` § 7), règles du trader et marge datée en garde livrées (A17), plancher des suiveurs du Copieur compris
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
10. **Chaque PR vise `main`**, jamais la branche d'une étape précédente. Les PR #97 à #99 ont été fusionnées dans des branches intermédiaires : `main` ne les a reçues qu'avec #102. Avant d'ouvrir ou de mettre à jour une PR : `git fetch origin main`, puis rebase.
11. **Une seule section par vague dans `docs/AUDIT.md`.** A11.6 a ouvert « Couche agentique du trader — vague 2 » : ajoute une ligne à son tableau, n'ouvre jamais une seconde section. Les six PR #104 à #109 sont en conflit pour cette seule raison.
12. **Un test prouve un comportement.** Ne compte pas un test qui :
    - compare 0 à 0 ;
    - vise une branche morte ;
    - appelle une fonction d'aide au lieu du chemin réel ;
    - ne tombe que sur « module introuvable ».

    Pour chaque test, casse le moteur ou retire le correctif : il doit virer au rouge sur le résultat.
13. **Description de PR propre.** Ni marqueurs `CURSOR_AGENT_PR_BODY_*`, ni liens « Open in Web / Open in Cursor » vers la session de l'agent : retire-les après chaque création ou mise à jour. Nom de branche neutre (`agentique/…`), jamais `cursor/…`.
14. **Numéros de ligne.** Ceux du § 5 sont ceux de `main` à `d9b39aa`, ou du HEAD de la PR citée. Vérifie-les avant d'agir.

---

## 2. Carte de la couche agentique : ce qui EXISTE (ne pas recréer)

| Zone | Chemin | Faits à ne pas contredire |
|---|---|---|
| Catalogue | `src/engine/agent/catalog.ts` | **Aucun import** (le process principal le compile). Il contient :<br>• `DESK_TOOL_KINDS` : 33 outils, 23 lectures et 10 écritures, dont les dix `crypto_*` (`cryptoTools.ts`, donnés au modèle par `toolSchemas({ crypto: true })` seulement) ;<br>• `ORDER_TOOLS` ;<br>• `DESK_TOOL_HINTS` et `DESK_TOOL_TITLES`, typés `Record<DeskToolName, …>` : un outil nouveau sans entrée = typecheck rouge ;<br>• `TOOL_PREAMBLE` ;<br>• `DESK_EVENT_KINDS` : `fill`, `order`, `prop_buffer`, `catalyst`, `bridge_link`, `agent_order`, `daily_loss`, `discipline`, `crypto_alert`. |
| Outils | `src/engine/agent/tools.ts` | • `createDeskTools(ports)` : description française dans l'outil, anglais et espagnol dans `toolBlurb` ;<br>• `EMPTY_PORTS` ;<br>• les lectures du journal rendent `asOf`, `sources`, `demo`. |
| Ports | `src/engine/agent/ports.ts` | Un port nouveau s'ajoute partout :<br>• `livePorts` (`src/store/agent.ts`) ;<br>• `EMPTY_PORTS` ;<br>• `tests/helpers/deskPorts.ts` ;<br>• `tests/helpers/demoDesk.ts` ;<br>• les faux ports de plusieurs tests (`grep -rn "bridge: async" tests`). |
| Boucle | `src/engine/agent/loop.ts`, `context.ts`, `runner.ts` | • `runAgentTurn` : `MAX_TOOL_ROUNDS` = 6, chaque appel reçoit un résultat ;<br>• `fitHistory` ;<br>• `executeDeskTool` : source `llm` ou `orch`, `confirmFn`, `allowWrite`. |
| Consigne | `src/store/agent.ts` | • `agentSystemPrompt(settings, memory, now)` : la mémoire n'entre que si `settings.agent.toolsEnabled` ;<br>• `deskClock` : heure de New York et journée CME. |
| Mémoire | `src/engine/agent/memory.ts` | • `traderMemory` et `memoryDigest` ;<br>• les notes `by: 'agent'` sont **exclues** (`excludedAgentNotes`), sauf celles que le trader a adoptées (`adoptedAt`) : elles entrent en gardant `by: 'agent'`. |
| Discipline | `src/engine/discipline.ts` | • `TraderRules`, `coerceTraderRules`, `tradingDayNow`, `dayLoss`, `dailyLimit`, `detectDrifts`, `detectRuleBreaches`, `majorCatalysts` ;<br>• `Settings.traderRules` ;<br>• `DisciplineFields` dans `src/modules/metrique/SettingsModal.tsx`. |
| Événements | `src/engine/agent/events.ts`, `src/store/deskEvents.ts` | • `DeskEventLog` : 500 entrées, en mémoire ;<br>• `propBufferAlert`, `dailyLossAlert`, `ThresholdWatch` (hystérésis, premier passage muet). |
| Routines | `src/engine/agent/routines.ts` | • **Aucun import** (compilé pour le process principal) ;<br>• `ROUTINES` : `pre_session_brief`, `session_debrief`, `prop_plan_review` ;<br>• `renderRoutine(name, args, { locale, allowWrites, now })` ;<br>• servies en prompts MCP, et proposées dans l'onglet Agent (`routineDue`, `runRoutine`) : rien ne part sans le clic du trader. |
| MCP | `electron/mcp-server.ts`, `electron/desk-relay.ts` | • Écrit à la main, **sans SDK** ;<br>• type d'outil lu dans `DESK_TOOL_KINDS`, jamais dans la réponse du renderer ;<br>• 8 appels en vol au plus ;<br>• `tools`, `prompts` et `resources` (lecture seule ; `{id}` validé dans le process principal) ;<br>• refus et erreurs dans la langue du desk, `name` stables. |
| Orchestrateur | `electron/orchestrator.ts` | WebSocket JSON-RPC, `desk.describe` construit dans `src/store/agent.ts` (`onRequest`), avec `kind` et `title`. Refus dans la langue du desk. |
| Ordres proposés | `src/engine/agent/orders.ts`, `electron/agent-orders.ts`, `src/store/agentOrders.ts` | • `parseProposal` (contrôle et bidi refusés), `guardProposal`, `AgentOrderHost`, `heldPosition` ;<br>• dialogue du process principal, Refuser par défaut, 45 s. |
| Séance | `src/engine/execution/orderBook.ts`, `electron/nt-bridge/order-book-host.ts`, `src/engine/marketdata/quotes.ts` | • IPC `ntbridge:orders` et `ntbridge:order-state` ;<br>• preload `desk.ntbridge.orders()` et `onOrder` ;<br>• `bridgeQuotes` dans `src/store/bridge.ts` ;<br>• `accountsAt` sur le statut du pont ;<br>• Visual suit le flux sur geste du trader (`src/modules/visual/ntFollow.ts`, `ntContract.ts`) ; `validateHistory` (`electron/nt-bridge/protocol.ts`) borne `marketdata.history`. |
| LLM | `electron/llm-host.ts`, `src/store/settings.ts` | • `llmFetch` refuse toute redirection ;<br>• `keyFor` et `llmKeyHost` ;<br>• champ `apiKeyHost`. |
| Harnais | `tests/helpers/scriptedLlm.ts`, `demoDesk.ts`, `agentEval.ts` | • `runScenario` pilote la **vraie** boucle et le vrai `executeDeskTool` ;<br>• attendus recalculés par les moteurs de l'écran, jamais en dur. |
| Métriques, étape 3 (R et risque) | `src/engine/riskConsole.ts`, `src/modules/metrique/RiskReading.tsx`, `Sessions.tsx` | • `tradeRisk`, `rrMatrix` (au R/R réalisé de `realizedRewardRisk`), `expectancyR`, `adjustedRiskPoints`, `horizonSigma`, `sigmaBand`, `bernoulliRun`, `longestLossStreak`, `betaPosterior`, `rateAfterStreak`, `dayBlockedMeanCi` ;<br>• `Trade.stopPrice` et `targetPrice` facultatifs (`TRADE_SCHEMA_VERSION` = 3) ;<br>• tables F20 à F22 absentes : Vol-LT et Cross-Vol stockés, non appliqués. |
| Métriques, étape 4 (contexte du jour) | `src/engine/atr.ts`, `src/engine/metricsContext.ts` | • `atrSeries` (l'indicateur `atr` l'appelle) ;<br>• `toDailyBars`, `garmanKlassAnnualized` (arrêté à la veille), `stabilizeVolCycles`, `buildMetricsContext` ;<br>• `contextSeries` : la série du contexte du jour, la même pour l'onglet Analyse et l'outil `day_context` ;<br>• `DayContext` : régime, bande, volatilités. |
| Métriques, étape 5 (lecture par contexte) | `src/engine/contextReading.ts`, `src/modules/metrique/ContextAxis.tsx` | • `readAxis`, `decomposeExact`, `inReleaseWindow`, `labelRelease`, `releaseContrast`, `comparableSet` ;<br>• `src/modules/metrique/axisReading.ts` porte la lecture de l'onglet : une racine, la fiche du jour arrêtée à la veille (décision T27) ;<br>• `contextLabels.ts` nomme régimes et bandes ;<br>• la trame jour × heure de l'onglet C est remplacée. |

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
- **`tests/agent-events.test.ts` et `tests/agent-events-tool.test.ts`** : ils figent la liste `DESK_EVENT_KINDS`. La description de `desk_events` doit nommer `order`, `daily_loss`, `discipline`, `agent_order` et `crypto_alert`.
- **Fuseau** : `TZ=UTC` est fixé par `vitest.config.mts` (`tests/suite-timezone.test.ts`).
- **Binaire Electron** : `tests/orchestrator-allowlist.test.ts` importe `electron`. Si `npm ci` n'a pas téléchargé le binaire, lance `node node_modules/electron/install.js`.
- **Typecheck** : Vitest passe même quand les types des aides de test sont faux. Lance toujours `npm run typecheck`, qui couvre `tests/helpers`.
- **Clé `db.settings`** : une clé nouvelle se déclare dans la table de restauration de `src/store/db.ts`, sur le modèle de `'agent.conversation'`.
- **Module partagé avec le process principal** : il se déclare à trois endroits, `electron/tsconfig.sources.json`, un `.d.ts` sous `electron/` et la table de `vitest.config.mts`.
- **Échecs sous forte charge** : deux échecs non identifiés ont été vus pendant la vague 1. Si un test tombe, relance-le seul et cherche la cause. On ne saute, ne désactive ni ne met en quarantaine aucun test.

---

## 4. Hors périmètre : décisions de l'ADMIN (ne pas coder)

Arrêtées le 2026-10-06 (`docs/THESE-AGENTIQUE.md` § 7) : les règles du trader et la marge datée de la jauge gardent désormais `propose_order` (A17.1, A17.2) ; l'abonnement de marché par l'agent et toute ouverture hors de `127.0.0.1` sont refusés ; l'AddOn 2.3.0 et le modèle du Lab attendent l'ADMIN. Les points ci-dessous restent la règle pour tout ticket qui n'en reçoit pas d'autre.

- **Gardes de `propose_order`.**
  - Ne touche pas `guardProposal` (`src/engine/agent/orders.ts`) ni les gardes d'`electron/agent-orders.ts`, sauf pour **refuser plus**, et seulement si un ticket le demande.
  - Refuser un ordre contraire aux règles du trader est une décision ouverte.
- **Marge de la garde A5, de `prop_buffer` et du plancher des suiveurs.** Elles lisent la marge datée de la jauge K.04, latent négatif compris (A17.2, `src/store/deskEvents.ts`, `propShare` ; A17.4, `src/engine/copier/router.ts`, `RouteContext.unrealized`). Les séances des suiveurs partent au process principal dès l'ouverture du desk (A17.5, `src/store/copierSync.ts`). Ne pas revenir à `buffer`.
- **Abonnement aux données de marché par l'agent.** `market_quote` reste une lecture du cache.
- **`ninjatrader/CantoBridge.cs`** (AddOn 2.3.0, D3) : ne pas modifier.
- **Réservé à l'ADMIN** : version de `package.json`, tag, Release, fusion dans `main`, clés de publication et de siège.
- **Rien hors de `127.0.0.1`** : ni tunnel, ni connecteur cloud.
- **Invariants de `CLAUDE.md` § 5** : n'en affaiblir aucun.
- **Modèle du Lab** : pas d'hôte nouveau dans `electron/llm-host.ts`.

---

## 5. Maintenant : corrections, puis suite, dans cet ordre

Revue du 2026-10-06 : chaque PR a été rejouée (typecheck, tests, correctif retiré pour voir le test tomber) et chaque bloquant a été relu dans le code.

**État.** 5.1, 5.2 et 5.3 sont faits : tickets, commits et tests dans `docs/AUDIT.md`, « vague 2 › Corrections ».

**Ordre suivi.** D'abord 5.1, pour libérer la file. Ensuite les deux bloquants de 5.2 (M4.7, M6.4) : ils faussent des chiffres affichés aujourd'hui. Puis le reste de 5.2, et enfin 5.3. Les constats de `main` sont aussi consignés dans `docs/AUDIT.md` (T17 à T28).

**Bilan.** Ensemble, les six PR ouvertes s'empilent sur `main` sans conflit de code. Après empilement : typecheck vert, 864 tests verts, `electron:compile` et build verts. Le protocole est suivi, et aucun invariant ni point du § 4 n'est touché.

### 5.1 Les six PR ouvertes : corriger sur leur branche, puis rebaser sur `main` (fait)

Fait autrement : les six PR sont intégrées par fusion sur `agentique/vague-2`, puis corrigées sur cette branche ; leurs commits gardent leur empreinte, et la fusion de la branche ferme #104 à #109.

**Pour toutes**
- Rebaser sur `origin/main`.
- Ajouter la ligne de la piste au tableau « vague 2 » de `docs/AUDIT.md` (§ 1.11).
- Nettoyer la description (§ 1.13).
- Retirer tout trailer `Co-authored-by` des messages de commit.

**#104 · A6.10, A6.11**
- Borner aussi les tags de **chaque trade** de `get_session` (`src/engine/agent/tools.ts:318`, `tags: t.tags`) avec `boundTags`. Test : un trade de 500 tags.
- Tester la coupe en longueur : 20 tags au plus, dont un de plus de 40 caractères (`tools.ts:76`).
- Le `truncated` racine de `list_sessions` doit suivre aussi `tagsTruncated` (`tools.ts:270`, `:274`).

**#105 · A12**
- `runRoutine(name, { date: due.day })` (`Agent.tsx:159`) : le texte doit porter la journée CME, pas la date civile. Test : débrief à 20 h ET.
- Ne marquer la journée vue que si l'envoi part. `runRoutine` rend un booléen, et les boutons sont désactivés pendant un flux (`Agent.tsx:157-163`).
- Écrire un test du composant (jsdom, sur le modèle de `tests/changelog-journal.test.ts`) : avec `due.brief` vrai et les minuteries avancées, aucun `send` sans clic. Le test actuel vise une branche morte (`routineDue.ts:80-81`).
- `Math.floor` au lieu de `Math.round` (`routineDue.ts:38`).
- Tests manquants : la garde du soir ; le texte en anglais et en espagnol.
- Calculer `dailyLossFull` par `dayLoss` / `dailyLimit`, au lieu de le lire dans l'anneau d'événements, perdu au redémarrage (`Agent.tsx:155`).
- Retirer la colonne ajoutée au § 4 de `docs/THESE-AGENTIQUE.md`.

**#106 · A13**

*A13.3 à reprendre :*
- **Borner l'historique.** Par exemple 5 jours jusqu'à maintenant, jamais `to: Number.MAX_SAFE_INTEGER` (`ntFollow.ts:36`), qui fait déborder `FromUnixSeconds` de l'AddOn (`CantoBridge.cs:993-995`).
- **Demander le contrat complet** (`NQ 12-26`), ou filtrer par `resolveSymbol`. L'AddOn répond en nom complet et le port jette les barres demandées par racine (`src/engine/marketdata/adapters/nt8.ts:61`).
- **Afficher l'échec.** Il est avalé aujourd'hui (`ntFollow.ts:37-38`).
- **Vider les barres au changement d'instrument** (`Visual.tsx:241-244`).
- **Libellés.** Étiqueter la source NinjaTrader, au lieu de « démo » ou « Import CSV » (`Visual.tsx:370`). Écrire « Ne plus suivre », au lieu de « Arrêter le pont » (`Visual.tsx:344`).
- **Test** contre `createNt8Port`, avec un transport simulé qui répond en nom complet.

*A13.1 :*
- Lire la perte et la limite sur le même compte que `discipline_status`, ou n'appliquer le plan que si `metricAccount === planAccount` (`Metrique.tsx:72`, `:76`).
- Faire avancer l'horloge par un tick de 30 s, comme dans `Portefeuille.tsx:184`.

*A13.2 :*
- N'afficher le panneau que si le lien n'est pas `absent` (`Metrique.tsx:264`).
- Marquer les ordres `unconfirmed` (`liveOrders.ts:28`).

**#107 · A14**
- **Valider `{id}` dans le process principal, sans `decodeURIComponent`.** Motif `^canto:\/\/note\/([A-Za-z0-9_-]{1,64})$`, sinon `-32002`. Aujourd'hui, `canto://note/%E0%A4%A` rend une erreur 500 (`electron/mcp-server.ts:99-100`). Test.
- Un refus du desk lu par `resources/read` rend `-32002` avec son motif, pas une ressource réussie (`mcp-server.ts:357-358`).
- Tester `desk.describe` lui-même : `onRequest` avec un faux `desk`, pas la seule fonction d'aide.
- Ajouter un bouton « Copier le jeton MCP » pour Codex. Celui de `Agent.tsx:526` copie le jeton de l'orchestrateur.
- `name` reste stable, seul `title` est traduit (`mcp-server.ts:336-346`).
- Traduire les derniers messages en trois langues : `desk-relay.ts:32`, `:38` ; `mcp-server.ts:304`, `:367`, `:380`, `:391-395`, `:452-455`.
- `outputSchema` : la propriété `loss` n'existe pas, la vraie clé est `dailyLoss` (`mcp-server.ts:211`). Valider les propriétés de tête sur `demoDesk`.
- `docs/PROTOCOLE-AGENT.md` : `title` dans `desk.describe`, langue des refus et des ressources, source de la syntaxe Codex.

**#108 · A15**
- `MemoryNote` garde `by: 'agent'` et `adoptedAt` pour une note d'agent adoptée. Aujourd'hui, `memory.ts:91` met `by: 'trader'` pour toutes les notes : provenance fausse.
- Réécrire les descriptions qui disent qu'aucune note d'agent n'entre dans la mémoire (`tools.ts:886`, `:1104-1105`). Test.
- À la restauration, un `adoptedAt` invalide retire le champ, pas la note (`db.ts:469`). Adapter `agent-adopt.test.ts:34-35`.
- Test de garde : chaque outil d'écriture appliqué à une note adoptée laisse son corps, ses tags et `adoptedAt` inchangés.
- Tester `adopt` dans le store et l'affichage du bouton.
- Retirer le code mort (`tools.ts:381-383`).

**#109 · A16**
- `discipline_status` : simuler l'horloge au 2026-09-30T19:00Z, exiger `loss > 0`, et comparer aussi `limit` et `source` à `dailyLimit`. Aujourd'hui, `agent-eval.test.ts:104` compare 0 à 0.
- Injection (`agent-injection.test.ts:141`) :
  - `it.each` sur les cinq outils d'écriture ;
  - vérifier `confirms` et `writes` ;
  - ajouter une variante avec les ordres activés, qui attend `declined`.
- `trader_memory` : ajouter une leçon du trader, sinon `[]` égale `[]`.
- `market_quote` : un `time` différent de `receivedAt`, et un témoin frais.

### 5.2 Métriques : corriger les étapes 3 à 5 (lignes de `main` à `d9b39aa`) (fait)

**Étape 3 (R et risque)**
- **M4.7 placer le R/R réalisé dans la matrice. Bloquant.**
  - **Constat :** `RiskReading.tsx:46-53` appelle `rrMatrix(winRate, meanPlanned ?? 1, …)`, donc le R/R **prévu**. Il vaut 1 sans objectif saisi, soit pour la démo et pour tout journal importé.
  - **Faire :** une fonction pure `realizedRewardRisk(trades)` = gain moyen ÷ |perte moyenne|, NaN sans perte.
  - **Test :** 50 %, gain moyen +100, perte moyenne −200 → 0,5, et espérance −0,25 R.
- **M4.8 contrôler le stop et l'objectif saisis.**
  - **Constat :** `Sessions.tsx:287-290` accepte tout nombre fini, alors que `CHECKS` (`db.ts:444-445`) écarte **tout le trade et son P&L** à la restauration.
  - **Faire :**
    - accepter la virgule ;
    - refuser visiblement une valeur hors de ]0 ; 1e6] ou du mauvais côté de la direction ;
    - à la restauration, retirer le champ aberrant et garder le trade.
- **M4.9 largeurs ±1 σ par instrument**, au pas de cotation (`Sessions.tsx:356`, `:516`). Aujourd'hui le 6E affiche « 0,0 ».
- **M4.10 traduire** « IC 90 % », « 95e » et les bornes de classes (`RiskReading.tsx:26-29`, `:120`, `:155`).
- **M4.11 exclure les trades nuls de `rateAfterStreak`**, comme le taux de base les exclut (`riskConsole.ts:280-282`).

**Étape 4 (contexte du jour)**
- **M5.5 dater les barres journalières par leur date civile.**
  - **Constat :** `metricsContext.ts:73` les range par `sessionKeyOf`, alors qu'un CSV journalier est lu à minuit **local** (`bars.ts:127`). Sur un poste à UTC+2 ou plus, la fiche D contient les prix de D+1 : fuite du futur. Paris et New York tombent juste.
  - **Test :** barres journalières horodatées à 21 h UTC la veille, soit minuit à UTC+3.
- **M5.6 dédoublonner les copies entre comptes différents seulement**, en équivalent standard (`metricsContext.ts:181-183`, `:254-257`). Aujourd'hui :
  - deux exécutions d'un même compte dans la même seconde comptent pour une ;
  - un suiveur en micros n'est pas fusionné.
- **M5.7 « après une perte » : le dernier trade du compte sorti avant l'entrée**, pas le précédent par ordre de sortie (`metricsContext.ts:298-305`).
- **M5.8 seuils.**
  - Le seuil de 90 séances s'applique par fiche, pas à toute la série (`metricsContext.ts:224`).
  - Une barre invalide ne gèle pas le régime (`metricsContext.ts:131-136`).
- **M5.9 libellés des régimes et des bandes en trois langues**, avec l'instrument nommé (`Analyse.tsx:138`).

**Étape 5 (lecture par contexte)**
- **M6.4 remettre la fenêtre de publication dans le bon sens. Bloquant.**
  - **Constat :** `ContextAxis.tsx:107` calcule `m = publication − entrée` et retient de 30 min avant à 5 min après.
  - **Faire :** `m >= -releaseAfter && m <= releaseBefore`, ou appeler `inReleaseWindow`.
  - **Test :** CPI à 08:30 ; une entrée à 08:00 est « loin », une entrée à 08:45 « proche ».
- **M6.5 centrer la permutation sur la moyenne générale** (`inference.ts:94`, repris par `contextReading.ts:120` et `:250`). Un groupe à 0 point, quand le reste fait +12, doit pouvoir être confirmé.
- **M6.6 rapprocher aussi les groupes d'un seul trade de la moyenne** : `contextReading.ts:109` met leur variance à 0, donc leur poids à 1.
- **M6.7 une seule racine par lecture.** Le régime vient de la série de cette racine, jamais de la démo, et les points ne se moyennent jamais entre racines (`ContextAxis.tsx:74`, `:96-118`).
- **M6.8 verdict « insuffisant » sous 30 journées distinctes**, et non 30 trades (`contextReading.ts:144`).
- **M6.9 points faibles :**
  - borner à la période le dénominateur « jours tradés » (`ContextAxis.tsx:126-128`) ;
  - `tailLoss` dans sa branche GPD (`contextReading.ts:345`, `:359-360`) ;
  - le test du contrôle décalé vise une date sans trade (`metrics-reading.test.ts:69-70`) ;
  - clés traduites, primitive `Segmented` et `aria-pressed` (`ContextAxis.tsx:61`, `:146`, `:161`).
- **Régime « de la veille » (T27) : décidé.** La fiche du jour D est déjà arrêtée à la clôture de D−1 ; l'onglet relisait `days[index-1]`, donc D−2. Décision déléguée par l'ADMIN : la journée se classe par sa propre fiche, comme `comparableSet` (M6.10).

### 5.3 L'agent lit les nouvelles Métriques (après 5.2) (fait)

Fait : `48e7dcf` (A6.12) et `1a65445` (A6.13), test `tests/agent-metriques.test.ts`. Ports ajoutés : `riskPerContract`, `activeSeriesId`, `regimeRules`.

**A6.12 rendre le risque et le R de chaque trade dans `get_session`.**
- **Faire :**
  - `stopPrice`, `targetPrice` et `tradeRisk(...)` : montant, source, R/R prévu, R réalisé ;
  - le capital se choisit comme dans `RiskReading.tsx:37-38` ;
  - port `riskPerContract()`, ajouté partout (§ 2, ligne « Ports »).
- **Test :** différentiel contre `tradeRisk`.

**A6.13 outil de lecture `day_context(date?, instrument?)`.**
- **Faire :**
  - l'outil rend la fiche de `buildMetricsContext` pour une journée : régime, bande, volatilités arrêtées à la veille, ATR, `traded` ;
  - sous 90 séances, il dit « historique insuffisant » ;
  - catalogue (type, indications, titres), trois langues, `docs/PROTOCOLE-AGENT.md` ;
  - ajouter `day_context` aux lectures de `pre_session_brief` (`tests/agent-routines.test.ts`).
- **Test :** différentiel contre `buildMetricsContext`.

---

## 6. Vague 2 : tickets d'origine (livrés en PR #103 à #109, pour référence)

A11.6 est fusionné (#103). Les autres tickets sont intégrés et corrigés sur `agentique/vague-2` (§ 5.1).

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

## 7. Branches et PR

- `git fetch origin main`, puis une branche par piste depuis `origin/main`, avec un nom neutre, sans nom d'outil. Exemple : `agentique/a12-routines`.
- Une PR **brouillon** par piste, **vers `main`**, pour que chaque relecture reste courte. La fusion est l'acte de l'ADMIN.
- Une PR déjà ouverte se corrige sur sa branche (nouveaux commits), puis se rebase sur `main`. Ne pas en ouvrir une nouvelle pour la même piste.
- La description de PR dit :
  - les tickets ;
  - les tests et les échecs observés sans le correctif ;
  - que les invariants ne bougent pas ;
  - que `CantoBridge.cs` ne change pas.

---

## 8. Fini, c'est

- `npm run check` et `npm run electron:compile` verts, et trois passages complets de la suite verts.
- `docs/AUDIT.md` : **une seule** section « Couche agentique du trader — vague 2 » (ouverte par A11.6), avec le tableau piste, commits, tests, ce qui change, puis les constats nouveaux non corrigés.
- `docs/PROTOCOLE-AGENT.md` à jour.
- `docs/THESE-AGENTIQUE.md` : rien à changer, sauf le tableau du § 4 si une couche change d'état. Le § 7 reste à l'ADMIN.
- Rien du § 4 de ce brief n'a été touché.

---

## 9. Commandes

```bash
npm ci                         # Node 22.12+
npm run typecheck
npm test
npm run check                  # typecheck + tests + build
npm run electron:compile       # si electron/ change
TZ=America/New_York npm test   # contrôle : la suite fixe UTC d'elle-même
```
