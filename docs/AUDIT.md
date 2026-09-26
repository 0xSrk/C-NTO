# Audit général — nuée d'agents (16 septembre 2026)

Cinq auditeurs indépendants ont relu le dépôt en lecture seule, chacun sur un axe : **moteur quantitatif**, **robustesse de l'interface**, **performance & lancement**, **sécurité**, **design & UX**. Chaque constat a été vérifié dans le code (et, pour le moteur, par calcul), puis corrigé ou consigné ci-dessous. Tests : 30 → **49** (Vitest).

## 1. Moteur quantitatif (`src/engine`, `src/lib`)

| Sévérité | Constat | Correctif |
| --- | --- | --- |
| P0 | Fichiers `;` → séparateur décimal `,` imposé : un export de barres `24180.25` devenait 2 418 025 | Séparateur déduit des colonnes de prix (`detectDecimalSeparator`), délimiteur en repli |
| P0 | Export de barres sans en-tête : volume perdu, format journalier rejeté | Colonne volume lue, `yyyyMMdd` accepté |
| P0 | Heures 12 h ignorées sur dates ISO et `a.m./p.m.` (en-CA) ; fuseau `Z`/`+02:00` ignoré | `parseFlexibleDateTime` réécrit, dates invalides → `NaN` |
| P1 | Monte Carlo : `horizon × runs` doubles (jusqu'à 800 Mo, 28 s bloquants) ; `Math.min(...)` explosait au-delà de ~125 k valeurs | Enveloppe estimée sur 500 trajectoires × 240 pas, tris typés, budget `runs × horizon ≤ 5 M`, saisie différée (`useDeferredValue`) |
| P1 | Profit net + petite commission (MNQ) déduite deux fois à l'import | Ordre de réconciliation corrigé ; export → import idempotent |
| P1 | MAE/MFE en ticks ou % pris pour des points | Unité déduite de la colonne Profit (points / ticks / % ignoré) |
| P1 | Bascule « 18:00 Globex » appliquée en heure locale du poste | `tradingDayKey(ms, 18, America/New_York)` |
| P1 | Deux comptes le même jour = deux « journées » (Sharpe, consistance, rejeu faussés) | Agrégation par date dans `computeDailyStats` et `evaluatePlan` ; filtre par compte dans le rejeu prop firm |
| P1 | Deux définitions de la consistance | Part du meilleur jour dans le **profit net** partout |
| P1 | Objectif prop firm évalué seulement en fin de rejeu (compte réussi puis rechuté = « échec ») | Validation le jour où les conditions sont réunies (`passedOn`), arrêt du rejeu |
| P1 | `histogram`/`min`/`max` : `NaN` → plantage, 200 k valeurs → `RangeError` | Filtrage des non finis, boucles sans `spread` |
| P1 | `Intl.DateTimeFormat` construit par barre dans Opening Range (15 s sur 345 k barres) | Formateur hoisté, clés de séance mises en cache par tableau |
| P1 | Durée de drawdown mesurée jusqu'au dernier point sous l'eau ; jours plats comptés | Durée jusqu'à la récupération, `>=` sur le pic |
| P2 | `$-125.00` / `125.00-` positifs ; guillemet isolé avalant le fichier ; `NQZ6` ignoré ; Nouvel An du samedi observé le 31/12 ; `nthWeekdayOfMonth` hors mois ; Kelly avec breakevens ; température Anthropic > 1 | Tous corrigés |

Vérifié conforme : z-score des séries (Van Tharp), profit factor, espérance, SQN, Sharpe/Sortino/Calmar, VWAP, ATR, EMA, DST 2026, FOMC 2024-2026, expirations et rollovers, `computeTradeStats` sur 50 k trades = 71 ms.

## 2. Robustesse de l'interface (`src/app`, `src/store`, `src/modules`)

| Sévérité | Constat | Correctif |
| --- | --- | --- |
| P0 | Aucune frontière d'erreur : une exception de rendu vidait la fenêtre | `ErrorBoundary` par module (réinitialisée au changement d'onglet), `unhandledrejection` remonté en toast |
| P0 | `restoreVault` écrivait du JSON non validé (séance sans `tags` → plantage à chaque lancement), fusionnait au lieu de remplacer, ne rechargeait pas tous les coffres, exportait la clé API | Validation par table, remplacement transactionnel, rechargement de tous les coffres, réglages de l'agent jamais restaurés, clé API exclue de l'export |
| P1 | `useBars.load` non idempotent (séries démo dupliquées) ; boucle de régénération pour une séance datée d'un week-end | Chargement mémorisé + transaction ; comparaison sur clés de date + garde |
| P1 | Identifiants SVG dupliqués (`clip-pos`) corrompant les aires signées | `useId` |
| P1 | Classes `num`/`selected`/`clickable` jamais appliquées (portée CSS module) | `:global` |
| P1 | Ctrl+1…7 inopérants en AZERTY | `e.code` (`Digit1`…) |
| P1 | Dernières frappes perdues au changement de note (debounce non vidé) | Vidage au démontage |
| P1 | Dépôt de fichier hors zone → navigation de la fenêtre | `dragover`/`drop` neutralisés |
| P1 | `confirm()` natif bloquant | Dialogue CΛNTO (`useUi.confirm`) |
| P1 | Nouvelle conversation pendant un flux → message rattaché à la mauvaise conversation ; séances manuelles en doublon | Arrêt du flux + garde ; refus d'un doublon date/compte |
| P2 | État dérivé recalculé à la main | Composants re-clés (`key`) |

## 3. Performance & lancement

Mesures (build de production dans Electron, journal vide, VM Linux) :

| Indicateur | Avant | Après |
| --- | --- | --- |
| Desk affiché après navigation | 4,1 s | **2,0 s** |
| Temps mur lancement → desk | 4,65 s | **~2,5 s** |
| Coffres prêts (`bootReady`) | ~125 ms | ~160 ms (chargements parallèles, pont inclus) |
| Chunk d'entrée applicatif | 417 kB (tout compris) | 105 kB (+ `react` 222 kB, `dexie` 96 kB, `charts` 180 kB à la demande) |
| RSS total (5 processus) | 622 Mo | 576 Mo |
| Analyse › carte horaire (50 k trades) | 369 ms | ~4 ms (une passe) |
| Import › fusion (50 k trades) | 765 ms | ~35 ms (tables de hachage) |
| Opening Range (345 k barres) | 15 s | ~10 ms |
| Monte Carlo (20 000 × 5 000) | 28 s / 827 Mo | borné à 5 M de tirages, ~2 Mo |

Changements : boot parallélisé, desk monté sous l'écran de chargement (fondu sans écran noir), splash 1,5 s écourtable au clic/touche, module d'accueil préchargé, chunks fournisseurs séparés, cache V8, police d'affichage inutilisée retirée, horloge isolée, graphe de notes endormi au repos, formateurs `Intl` mis en cache, `ws` chargé à l'ouverture de la passerelle, menu applicatif supprimé, superposition « grain » sans `mix-blend-mode`, `prefers-reduced-motion` respecté.

Différé (changement de conception) : simulation Monte Carlo et import CSV dans un *Worker*, série unique pour les segments d'indicateurs, remplacement de Dexie, écritures IndexedDB par frappe.

## 4. Sécurité

| Sévérité | Constat | Correctif |
| --- | --- | --- |
| P0 | Passerelle WebSocket sans authentification ni contrôle d'origine : toute page web visitée pouvait lire le journal et écrire des notes | Jeton de session (comparaison à temps constant), refus des origines navigateur, 8 clients max, 1 Mo par trame, 40 requêtes/s, 8 requêtes en attente par client |
| P0 | `JSON.parse('null')` → exception dans le processus principal (boîte d'erreur Electron), socket bloquée | Validation du type de trame, envois protégés |
| P1 | Clé API en clair dans IndexedDB et dans les exports | Chiffrée par `safeStorage` (DPAPI / trousseau) sous le shell, exclue des exports |
| P1 | Injection d'instructions via notes/séances → outils d'écriture exécutés sans contrôle | Confirmation de l'opérateur pour `create_note` / `annotate_session`, préambule « données non fiables », 8 appels par tour ; orchestrateur en lecture seule sauf autorisation explicite |
| P1 | HTML rendu pouvant maquiller l'interface (`style`, `form`, `target`) | DOMPurify : `style`/`target`/formulaires/SVG interdits, URL limitées à `https?`/`mailto`/`#` ; CSP : `object-src`, `base-uri`, `form-action`, `frame-src` |
| P2 | Fuses Electron absents, permissions navigateur accordées par défaut | `electronFuses` (runAsNode, inspect, ASAR integrity), `setPermissionRequestHandler` → refus |

Vérifié conforme : `contextIsolation`, `sandbox`, `nodeIntegration: false`, préchargement sans accès disque direct, dialogues système obligatoires, `setWindowOpenHandler`, `will-navigate`, échappement des liens wiki.

## 5. Design & UX

Corrigés : symbole `$` étroit et suppression des « -0 », en-têtes de panneau qui ne s'écrasent plus, tableau des trades compacté, « Indicatif » dans le rail, grille du calendrier (week-ends réduits, titres lisibles), état vide du module Visual, formats fr-FR unifiés (échelle de prix, marqueurs, R, dates), accords automatiques (`plural`), `:focus-visible`, `Toggle` focalisable, champs désactivés et curseur stylés, contraste des textes atténués relevé, jetons `-line`/`-soft` centralisés, logotype de barre de titre net (`non-scaling-stroke`), équerres réservées aux panneaux en relief, grilles alignées en haut, année glissante bornée, valeur terminale sur la courbe d'équité, graphe de notes sans chevauchement de libellés, nuage MAE/MFE sans distorsion, libellés et infobulles harmonisés, barre d'état sans débordement.

Différé : piège de focus dans les modales, échelle typographique réduite à des jetons, styles inline restants.

## 6. Ce que le raffinage « crépuscule » attend

L'exécution référencée pour crépuscule appartient à un autre dépôt et n'est pas accessible depuis ce projet ; les refinements ci-dessus proviennent de l'auditeur design indépendant. Pour aligner CΛNTO sur crépuscule, fournir ses jetons (palette, typographies, rythme d'animation) ou l'accès à son dépôt.

## Suite 2026-09-17

Tickets : [`docs/AGENT-HARDENING.md`](AGENT-HARDENING.md).

- [x] P2.1 `.gitignore` env/csv/vault/seen — `.gitignore`
- [x] P2.5 versions unifiées 1.1.1 — `README.md`, `package.json`
- [x] P0.1 import idempotent par executionId — `src/engine/import/identity.ts`, `src/store/journal.ts`
- [x] P0.2 AddOn C# atomique + `.seen` — `ninjatrader/CantoBridge.cs`
- [x] P0.6 coffre `canto-vault-v2` — `src/engine/vault.ts`
- [x] P0.3 updater deux canaux — `src/engine/updatePolicy.ts`, `electron/updater.ts`
- [x] P0.4 gate écriture agent / ports — `src/engine/agent/ports.ts`, `src/engine/agent/tools.ts`
- [x] P0.5 LLM via process main, CSP sans `connect-src *` — `electron/main.ts`, `index.html`
- [x] P1.1 vecteurs métriques partagés — `vectors/`
- [x] P1.2 watcher mémorise acceptedIds — `electron/bridge.ts`, `src/store/bridge.ts`
- [x] P1.3 champs optionnels + toast capacité 1000 — `src/engine/types.ts`, `src/store/journal.ts`
- [x] P1.4 plans prop `version`/`source`, rejeu `planId`+`planVersion` — `src/engine/propfirm.ts`, `src/store/settings.ts`
- [x] P1.6 Bot/Copieur CONCEPTION, pas de `copy.order` runtime — `src/modules/bot/`, `src/modules/copieur/`
- [x] P1.7 merge macro additif, cache 24 h, timeout 8 s — `src/engine/macroMerge.ts`, `electron/macro-calendar.ts`
- [x] P2.2 licence UNLICENSED — `README.md`
- [x] P2.3 jeton orch masqué, `orch:copy-token` — `electron/orchestrator.ts`
- [x] P2.4 modale tab trap + Esc + restore focus — `src/design/Modal.tsx`
- [x] P2.6 CI windows-latest Node 22 — `.github/workflows/ci.yml`
- [x] P2.7 journal technique anneau 200 — `src/lib/log.ts`
- [x] P2.8 `openExternal` https / `http://127.0.0.1` — `electron/main.ts`
- [x] P3.1 `noUncheckedIndexedAccess` — `tsconfig.json`, `electron/tsconfig.json`
- [x] P3.6 script `npm run check` — `package.json`
- [x] P1.5 Worker MC/CSV — `montecarlo.worker.ts` + `csv.worker.ts` (> 5000 lignes), barre + Annuler, tests restent sur les fonctions synchrones
- [x] P0.5 pont : SHA-256 après stabilité, skip si contenu identique — `electron/bridge.ts`
- [x] P2.4 disclaimers Sharpe / MC i.i.d. / Executions sans MAE — `Analyse.tsx`, `MonteCarloView.tsx`, `ImportModal.tsx`
- [x] P2.5 `engines.node >= 22.12.0` — `package.json`
- [x] `scripts/hash-release.mjs` SHA-256 des artefacts `release/`
- [x] patch 1.1.2 après P0

Reliquats `docs/AGENT-HARDENING.md` (numérotation de ce brief) :

- [x] P0.4 coffre `macroReleases` + `includeHeavy` — `src/engine/vault.ts`, `src/store/db.ts`
- [x] P1.1 `executeDeskTool` — `src/engine/agent/runner.ts`, `src/store/agent.ts`, `tests/agent-runner.test.ts`
- [x] P2.2 `Trade.orderIds` FIFO + `SESSION_CAPACITY` commenté — `src/engine/types.ts`, `src/engine/import/executions.ts`
- [x] P2.3 `PropPlan.effectiveFrom` — `src/engine/propfirm.ts`
- [x] P3.2 Worker CSV barres > 5000 — `src/engine/bars.worker.ts`, `src/store/bars.ts`
- [x] P2.6 `executions-*.seen.txt` — `.gitignore`
- [x] P1.2 hôte `api.moonshot.ai` — `src/engine/agent/llm.ts`, `electron/main.ts`
- [x] P2.5 badge README 100 tests — `README.md`
- [x] P1.6 copy conception sans « réel » — `README.md`, `src/modules/bot/Bot.tsx`
- [x] P1.2 plus d’IPC `secrets:decrypt` — `electron/main.ts`
- [x] P1.1 `createDeskTools` non exporté — `src/engine/agent/tools.ts`
- [x] P0.4 `backupDaily` + export `includeHeavy` câblé — `src/store/settings.ts`, `SettingsModal.tsx`
- [x] P1.1 `runTool` non exporté — `src/engine/agent/tools.ts`
- [x] P1.2 plus de fetch LLM renderer — `src/engine/agent/llm.ts`
- [x] P2.7 licence UNLICENSED en tête README — `README.md`
- [x] P3.2 Annuler + barre CSV journal/barres — `ImportModal.tsx`, `Visual.tsx`

## Audit 25 septembre 2026 — sécurité, qualité, réactivité

Relecture complète du desk v2.0.1 : process principal Electron (lu intégralement), puis deux auditeurs indépendants en lecture seule sur le renderer (couche données / réactivité UI). Chaque constat a été vérifié dans le code, corrigé, et couvert par un test quand c'était possible sans navigateur. Tests : 126 → **181** (Vitest, 32 fichiers). `npm run check` vert, desk lancé sous Xvfb sans erreur de rendu.

### 1. Sécurité — process principal (`electron/`)

| Sévérité | Constat | Correctif |
| --- | --- | --- |
| P1 | `files:write-in-folder` acceptait n'importe quel chemin absolu envoyé par le renderer : un renderer compromis pouvait écrire un fichier arbitraire (profil shell, dossier de démarrage) | Dossiers **accordés** uniquement (dialogue `files:pick-folder`, persistés dans `folder-grants.json`), nom borné à `canto-vault-*.json`, écriture atomique `.tmp` → `rename` ; le renderer est invité à rechoisir le dossier si l'octroi manque — `electron/folder-grants.ts`, `tests/folder-grants.test.ts` |
| P1 | `bridge:configure` acceptait un dossier arbitraire : le lecteur de CSV (50 Mo par fichier) pouvait être pointé sur n'importe quel répertoire | Même mécanisme d'octroi (dialogue ou dossier par défaut) ; un chemin non accordé est ignoré |
| P1 | Sous Linux, Chromium vide le nom « CΛNTO » (Λ non ASCII) : `userData` = `~/.config` lui-même — coffre IndexedDB, état du pont, caches à la racine du dossier de configuration | Dossier ASCII `~/.config/CANTO`, migration des entrées du profil au premier lancement ; Windows / macOS inchangés — `electron/user-data.ts`, `tests/user-data.test.ts` |
| P2 | Fenêtre du lanceur sans `setWindowOpenHandler` ni garde `will-navigate` ; `<webview>` non interdit | `app.on('web-contents-created')` : refus des fenêtres enfants (liens `https` vers le navigateur), des `<webview>` et de toute navigation hors document, pour toutes les vues |
| P2 | `setPermissionCheckHandler` absent (seul le *request handler* refusait) | Permissions refusées aux deux niveaux, sauf `clipboard-sanitized-write` (Copier le jeton / le journal) |
| P2 | Voie installeur : la version comparée était `package.json` de `main` (2.0.1) alors que la seule Release publiée est 2.0.0 → « mise à jour disponible » vers un binaire inexistant | Contrôle par `releases/latest` (brouillons et préversions ignorés), ouverture de la page de cette release — `electron/release-check.ts`, `tests/release-check.test.ts` |
| P2 | CSP renderer `connect-src` ouvert sur `http://127.0.0.1:*` / `http://localhost:*` sans usage (LLM et macro passent par le main) ; repli `fetch` Forex Factory dans le renderer, de toute façon bloqué par la CSP | `connect-src 'self'` (+ socket HMR Vite en dev) ; synchro macro via le shell uniquement — `index.html`, `src/store/macro.ts` |
| P3 | `mailto:` admis par DOMPurify : sous le shell, un clic part au gestionnaire de protocole de l'OS sans passer par `will-navigate` (note créée par l'agent / l'orchestrateur) | Retiré des schémas d'URL — `src/modules/note/markdown.ts` |
| P3 | Réservation de slot orchestrateur non rendue si la poignée de main échoue après `verifyClient` | Libération à la fermeture du socket — `electron/orchestrator.ts` |
| P3 | `npm audit` absent de la CI | `npm audit --omit=dev --audit-level=high` avant typecheck — `.github/workflows/ci.yml` (0 vulnérabilité au 25/09) |

Vérifié conforme : `contextIsolation`, `sandbox`, `nodeIntegration: false`, fuses Electron, préchargement sans accès disque, `trusted(e)` sur chaque IPC, jeton orchestrateur comparé en temps constant, refus des origines navigateur, hôtes LLM épinglés côté main, clé API jamais transmise au renderer, aucune dépendance vulnérable (`npm audit` : 0), extraction zip d'Electron protégée contre le *path traversal*.

### 2. Sécurité — couche données renderer (`src/store`, `src/engine`)

Aucune XSS : la chaîne marked → DOMPurify (`FORBID_TAGS`, `FORBID_ATTR`, `ALLOWED_URI_REGEXP`) → `will-navigate` est correcte, les wiki-liens et tags sont échappés, les CSV n'atteignent jamais `innerHTML`.

| Sévérité | Constat | Correctif |
| --- | --- | --- |
| P1 | `restoreVault` fusionnait `settings` sans allowlist ni typage : un coffre pouvait activer `orchestratorAllowWrite`, changer `backupFolder`, `updateChannel`, et injecter une consigne via `callsign` (interpolé dans le prompt système) | `coerceSettings` (chaque clé typée et bornée) utilisé au chargement et à la restauration ; allowlist `RESTORABLE_SETTING_KEYS` — jamais orchestrateur, sauvegarde, hôtes LLM, secrets — `src/store/settings.ts`, `tests/settings-coerce.test.ts`, `tests/vault-restore.test.ts` |
| P1 | `importedExecutions` jamais purgée à la restauration : les exécutions de trades disparus restaient « connues » et ne revenaient jamais par ré-import | Table incluse dans la transaction et vidée quand les séances sont remplacées |
| P1 | Imports concurrents (pont + manuel, deux fichiers du pont) lisaient le même état de départ → séances en double pour la même date\|compte ou `ConstraintError` | Verrou coopératif `withJournalLock` (fusion + écriture sérialisées ; restauration sous le même verrou) — `src/store/lock.ts`, `src/store/journal.ts` |
| P2 | Clé API : `apiKey: ''` conservait le blob chiffré (clé impossible à effacer) ; sans trousseau, le clair était persisté dans IndexedDB alors que l'UI annonçait un stockage chiffré ; course `update()`/`updateAgent()` pouvant restaurer l'ancien blob | Effacement explicite retire le blob ; sous le shell le clair n'est **jamais** écrit (toast unique) ; ligne clair + blob réécrite au boot ; tranche `agent` réinjectée seulement si le patch touchait la clé |
| P2 | `CHECKS` de restauration incomplets : `bots.status`, `rules`, `agentMessages.toolCalls`, `trades` (qty, prix, PnL), tailles de champs → crash de module ou gel persistant | Validation par table avec bornes (qty entier 1..10 000, prix ≤ 1e6, \|PnL\| ≤ 1e7, `title` ≤ 200, `body` ≤ 1 Mo, `bars` ≤ 200 000…), lignes invalides comptées et signalées, `prepareVaultRestore` pure et testée |
| P2 | Import CSV : `qty` ou prix `Infinity`/1e300 acceptés, PnL `NaN` stocké puis perdu à l'export ; notation scientifique mutilée ; guillemet non refermé silencieux | Bornes à l'analyse et à l'appariement, avertissements relayés — `src/engine/import/*.ts`, `src/lib/csv.ts`, `tests/import-bounds.test.ts` |
| P2 | Outils agent : `title`/`query`/`id`/dates non bornés, arguments non déclarés acceptés ; aperçu de confirmation d'écriture tronqué à 400 caractères ; `calendar_events` acceptait des dates invalides | `clampToolArgs` (title ≤ 200, chaînes ≤ 64, clés déclarées seulement), aperçu lisible (titre, séance, tags, corps ≤ 2000), dates `YYYY-MM-DD` — `src/engine/agent/ports.ts`, `tools.ts` |
| P3 | `send()` non réentrant ; `orchestratorAllowWrite` basculé pendant que la passerelle tourne restait sans effet côté main | Garde `streaming` ; abonnement aux réglages qui re-pousse `orchestrator.start(port, allowWrite)` — `src/store/agent.ts` |
| P3 | Export CSV : `\t` et `\r` en tête non neutralisés (injection de formule), `\r` non cité | Corrigé — `src/engine/import/ninjatrader.ts` |

### 3. Réactivité & correction de l'interface (`src/modules`, `src/design`, `src/lib`)

| Sévérité | Constat | Correctif |
| --- | --- | --- |
| Élevé | `fmtPct` / `fmtRatio` / `fmtPrice` / `formatDateFr` construisaient un `Intl.*Format` par appel — en boucle sur 1 000 séances, 4 séries d'équité, 260 cellules de heatmap | Formateurs mis en cache par langue et options ; `fr-FR` codé en dur remplacé par la langue du desk — `src/lib/format.ts`, `time.ts`, `tests/format-cache.test.ts` |
| Élevé | Agent : tout le module re-rendu à chaque token (`useAgent()` sans sélecteur), Markdown re-parsé pour chaque message, bulle en cours re-parsée en O(n²), scroll forcé en bas | Sélecteurs par champ, `Message` mémorisé, bulle en texte brut différé (`useDeferredValue`), Markdown sur le message final, auto-scroll seulement près du bas — `src/modules/agent/Agent.tsx` |
| Élevé | `useStats` recalculait métriques, journées et rejeu prop firm à chaque bascule de vue ; `Analyse` faisait 6 passes `computeTradeStats` avec `Intl` par trade | Caches module (`WeakMap` sur les tableaux du store, clé objet plan) partagés par toutes les vues ; agrégat O(n) pour les regroupements ; bascule de vue en `startTransition` — `useStats.ts`, `Analyse.tsx`, `Metrique.tsx` |
| Élevé | Séances : 1 000 lignes re-rendues à chaque frappe du filtre, 2 constructions `Intl` par ligne | `useDeferredValue(query)`, `SessionRow` mémorisé, taux de gain pré-calculé — `Sessions.tsx` |
| Élevé | Tableau de bord : capital de départ et libellés de dates faux dès qu'une date porte deux séances (agrégation par date vs index par séance) | `startingBalance` de `useStats`, libellé dérivé du point d'équité — `Dashboard.tsx` |
| Moyen | Visual : chaque frappe dans un paramètre d'indicateur recalculait tous les indicateurs, écrivait IndexedDB et repoussait toutes les séries au graphique | Saisie validée au blur/Entrée, mémo par instance, `setData` sauté si le segment est inchangé — `Visual.tsx`, `Chart.tsx` |
| Moyen | Graphe de notes : répulsion O(n²) pendant 600 images quoi qu'il arrive | Arrêt anticipé à l'équilibre, grille spatiale au-delà de 300 nœuds — `Graph.tsx` |
| Moyen | Modale : l'effet de focus dépendait de `onClose` (fonction inline) → vol de focus à chaque rendu du parent, restauration cassée ; Échap fermait une modale d'import en cours sans annuler le worker | Effets scindés (focus une fois, clavier par ref), `dismissable={!busy}`, abort du worker au démontage, `aria-labelledby`, libellé traduit — `Modal.tsx`, `ImportModal.tsx`, `Visual.tsx` |
| Moyen | Courses store ↔ saisie : `notes.update` capturait l'état avant `await` (épingle perdue), `bots`/`copier` mettaient l'état à jour après IndexedDB (caractères sautés), note du jour créée en double (timer + blur) | Mise à jour fusionnée après écriture, `set` optimiste, id déterministe `note_<date>` + sérialisation — `notes.ts`, `bots.ts`, `copier.ts`, `calendar.ts`, `tests/notes-update.test.ts` |
| Moyen | Restauration du coffre : barres, publications macro et conversation agent non rechargés | Rechargement des trois stores — `Metrique.tsx` |
| Faible | Légende Visual en UTC, jour de semaine d'Analyse en heure locale (trame en ET), `UpdateButton` sans `catch` (toast toutes les 30 min hors ligne), suppression d'une série sans confirmation | Corrigés |
| Faible | Accessibilité : grille du calendrier inaccessible au clavier, filtres et étoiles sans nom accessible, bouton Fermer non traduit | `role="button"` + clavier + `aria-pressed`, `aria-label`, `type="button"` |

Qualité : `isBridgeLive` centralisé (4 copies), doubles imports retirés, icônes mortes supprimées, langue du desk appliquée aux axes des graphiques.

### 4. Différé (hors périmètre de cette vague)

- Pinning des actions GitHub par SHA (supply chain CI) ; signature des binaires (pas de certificat).
- Fuse `grantFileProtocolExtraPrivileges` : à tester avec le chargement `file://` des modules ES avant désactivation.
- Virtualisation de la table des séances au-delà de ~300 lignes ; simulation du graphe de notes dans un Worker.
- Dialogue de confirmation d'écriture dédié (corps complet défilant) pour `create_note` / `annotate_session`.
- Réglage `llmAllowedHosts` : mort (la liste est épinglée côté main) — à retirer du type ou à brancher.

## Registre d'instruments (v3, tâche 1)

Les futures CME Group (CME, CBOT, NYMEX, COMEX) et leurs micros ne sont plus des constantes NQ/MNQ. Une spec se lit via `getInstrument` / `resolveSymbol` / `tradingDayOf` dans `src/engine/instruments.ts`. La valeur de point, le tick et la session Globex (18:00 America/New_York) viennent de la fiche contrat citée dans `specRef`.

Fichiers migrés : `src/engine/types.ts`, `src/engine/instruments.ts`, `src/engine/demo.ts`, `src/engine/bars.ts`, `src/engine/import/executions.ts`, `src/engine/import/ninjatrader.ts`, `src/engine/vault.ts`, `src/store/db.ts`, `src/store/copier.ts`, `src/store/journal.ts`, `src/store/bars.ts`, `src/modules/metrique/ImportModal.tsx`, `src/modules/visual/Visual.tsx`, `src/modules/copieur/Copieur.tsx`.

Instrument inconnu :

- À l'import CSV, la ligne est ignorée, comptée, et le rapport porte `instrument non reconnu : XYZ (n lignes)`. Le reste du fichier est conservé.
- À la restauration du coffre (v1 et v2), un `trades.instrument` absent du registre n'est pas rejeté : la chaîne est conservée (c'est la marque). `parseVaultJson` ne filtre pas. Les métriques n'inventent pas de `pointValue` : elles utilisent le `pnl` déjà porté par le trade.
- `symbolMap` du copieur est un objet (`identique` / `micro` / `standard` / `explicite`). Les chaînes `'identique'`, `'NQ→MNQ'` et `'MNQ→NQ'` restent acceptées et sont converties à la lecture (`'NQ→MNQ'` → `{ mode: 'micro' }`). Dexie `version(4)` migre les lignes `copierAccounts` déjà stockées. Le format du coffre exporté reste v2.


