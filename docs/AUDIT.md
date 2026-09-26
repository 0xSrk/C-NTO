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

## Calendrier — sources officielles (v3, tâche 3)

Vérification des endpoints le **2026-09-26**. User-Agent du desk : `CANTO-Desk/2.0 (calendar)`. Investing.com (scraping, User-Agent de navigateur usurpé) est retiré. Forex Factory n'est pas branché.

| sourceId | Endpoint vérifié | Format | Résultat | Conditions |
| --- | --- | --- | --- | --- |
| bls | `https://www.bls.gov/schedule/news_release/empsit.htm` et `cpi.htm` | HTML (tableau) | Page rendue ce jour-là (NFP 2026 dont le 11 février et le 3 avril, 08:30 AM ; CPI 13 février 2026, 08:30 AM). `curl` avec le User-Agent du desk : **HTTP 403**. `https://www.bls.gov/schedule/news_release/bls.ics` : Access Denied. | [BLS API ToS](https://www.bls.gov/developers/termsOfService.htm) — œuvre fédérale. `POST https://api.bls.gov/publicAPI/v2/timeseries/data/` HTTP 200 sans clé (séries `CES0000000001`, `CUUR0000SA0`, `LNS14000000`). Quota anonyme bas ; clé `byok` optionnelle (500/jour). |
| bea | `https://www.bea.gov/news/schedule` | HTML | HTTP 200. Tableau 2026, heures « 8:30 AM » (PIB advance, 29 octobre 2026). | [API BEA](https://apps.bea.gov/API/docs/index.htm) — domaine public. Les valeurs exigent un UserID ; sans clé, seules les dates sont lues. |
| fed | `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm` | HTML | HTTP 200 (165 ko). Décisions 2024–2026 inchangées (jour 2). 2027 listé, marqué estimé. Minutes « (Released …) » quand elles sont publiées. Pas d'heure dans le HTML : 14:00 ET est l'heure de communiqué déjà tenue par le desk. | [Disclaimer du Board](https://www.federalreserve.gov/disclaimer.htm) — œuvre fédérale. |
| ecb | `https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html` | HTML (`dt`/`dd`) | HTTP 200. Jour 2 monétaire, ex. 29/10/2026. `index.en.ics` : **404**. Aucune heure sur la page : `timeET` vide. | [Politique d'usage SEBC](https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html) — réutilisation gratuite avec attribution, chiffres non modifiés. |
| cme | `https://www.cmegroup.com/tools-information/holiday-calendar.html` | — | **HTTP 403**. Aucune fixture HTML. | [Licence données](https://www.cmegroup.com/market-data/license-data.html). `redistributable: false`. Pas de fetch. Expirations locales, 3e vendredi, **une ligne par future du registre**, `estimated: true`. La règle est celle des indices déjà auditée ; elle n'a pas été reconfirmée pour CL/GC. |
| eia | `https://www.eia.gov/petroleum/supply/weekly/schedule.php` | HTML | HTTP 200. Règle : après 10:30 a.m. Eastern le mercredi. Exceptions 2026 (ex. 22 janvier, 12:00 p.m.). Lié à CL et MCL. Mercredis déduits : `estimated: true`. Dates du tableau : `estimated: false`. | Page EIA, domaine public. Pas de clé pour le calendrier. |
| treasury | `https://www.treasurydirect.gov/TA_WS/securities/announced?format=json` | JSON | HTTP 200. `auctionDate` 2026-09-29, `closingTimeCompetitive` « 11:30 AM ». | JSON public TreasuryDirect, domaine public, sans clé. |
| fred | `https://api.stlouisfed.org/fred/series/observations` | JSON | **HTTP 400** sans `api_key`. Ne crée pas d'événement. Sans clé : état `error`, détail « clé FRED absente ». | [Terms of use](https://fred.stlouisfed.org/docs/api/terms_of_use.html) — clé personnelle, attribution, 120 requêtes/minute. |
| investing | — | — | Plus appelé. | [Conditions](https://www.investing.com/about-us/terms-and-conditions). `redistributable: false`, ligne documentaire dans `sources.ts`. |
| forexfactory | `https://nfs.faireconomy.media/ff_calendar_thisweek.json` (non appelé) | — | Source retirée. | Voir le verdict ci-dessous. |

**Verdict Forex Factory.** Les notices Fair Economy ([forexfactory.com/notices](https://www.forexfactory.com/notices), lues pour la tâche 2 et reprises ici) interdisent de copier, republier ou redistribuer les calendriers et la base FEED sans accord écrit préalable. Le JSON hebdomadaire existe, il n'autorise pas un logiciel distribué. La source n'est pas activable, même en opt-in. `forecast` reste vide. La fusion sait encore coller un `forecast` sur une ligne officielle si une telle ligne était fournie en mémoire (test), elle n'en crée pas depuis le réseau.

Dexie `version(5)` supprime la table `macroReleases` (lignes `investing` et `forexfactory`). Le coffre v2 ajoute `calendarEvents`. Un coffre v1/v2 qui porte encore `macroReleases` est accepté ; ces lignes ne sont pas réimportées. Cache disque : `userData/calendar-cache`, ETag / Last-Modified. Hors ligne, la dernière synchro reste affichée (`stale`). Rafraîchissement : au lancement si la synchro a plus de 12 h, puis toutes les 6 h. Un échec de source n'efface pas les autres.

**Instantané embarqué.** Le cache disque ne sert qu'après une synchro réussie, et les pages BLS (`empsit.htm`, `cpi.htm`) ainsi que le calendrier CME répondent HTTP 403 au desk. Sans filet, une installation neuve n'afficherait ni NFP ni CPI. `src/engine/calendar-bundle/2026.json` est importé statiquement (`import bundle from './2026.json'`) : il fait partie du binaire, le renderer ne le lit pas sur le disque. `sourceId` vaut `bundle` à l'insertion ; `origin` garde l'institution (`bls`, `bea`, `fed`, `ecb`, `eia`, `treasury`). Provenance affichée : « Calendrier embarqué · BLS ». Rien de CME, d'Investing ou de Forex Factory n'y entre. La fusion classe `bundle` sous toute source officielle vivante : un BLS direct remplace sa copie. À chaque synchro le socle est rechargé sur toute sa couverture, puis une source réseau qui réussit n'écrase que ses événements dans la fenêtre demandée. Si elle échoue, les lignes embarquées restent et l'état de la source passe à `stale`.

Régénération, à faire à chaque Release : `npm run calendar:snapshot` (réseau, mêmes parseurs que `electron/calendar/`). `npm run calendar:snapshot --from-fixtures` lit `tests/fixtures/calendar/` à la place. Une source en échec n'écrit pas un fichier partiel, sauf `--allow-partial`, qui reprend cette institution depuis le fichier précédent et le dit dans le résumé. L'instantané de la 2.1.0 a été produit avec `--from-fixtures` (fixtures capturées le 2026-09-26) parce que le fetch BLS répond 403 depuis le desk. Le process principal compile le même module via le lien `electron/calendar-bundle`. La page BLS capturée s'arrête à la publication du 4 décembre 2026 : le premier trimestre 2027 n'a pas de NFP embarqué. BEA, BCE et Trésor reflètent ce que ces pages montraient ce jour-là, pas une année reconstruite. Les mercredis EIA déduits restent `estimated: true`. Attribution BCE, dans le fichier : « Source : Banque centrale européenne, réutilisation avec attribution ».

## Pont WebSocket (v3, tâche 4)

Surface d'attaque du serveur `electron/nt-bridge/` :

- Écoute **uniquement** `127.0.0.1` (port par défaut 48231). Toute autre interface est refusée au démarrage. Pas de fetch, pas d'hôte ajouté à `allowedHosts`.
- Jeton de session (18 octets, `base64url`) exigé en query `?token=`, comparé par `tokensMatch` (SHA-256 puis `timingSafeEqual`). Échec : fermeture 4401. Le jeton est dans `userData/nt-bridge.json` (mode 0600) et recopié dans `bridge.json` du dossier d'export à la demande. Il n'est pas renvoyé au renderer après génération, ni inclus dans le coffre exporté.
- Une seule connexion AddOn. La suivante, si le jeton est bon, ferme la précédente (4409).
- Premier message : `bridge.hello` ou fermeture 4400. Trame > 256 Ko : fermeture 1009.
- Chemin d'ordres après `guards.ts` : comptes `Sim*` par défaut (`-32010`), coupe-circuit si le lien n'est pas `live` (`-32011`, pas de réémission), kill switch global `CommandOrControl+Shift+K` qui aplatit les comptes autorisés puis ferme le canal jusqu'au redémarrage, plafond 20 contrats (`-32012`), `tag` obligatoire (`-32013`). Chaque ordre est journalisé dans `main.log`.
- Le CSV reste le secours : socket `live` → seules les exécutions d'ID inconnu sont importées ; socket `lost` → le fichier redevient la voie principale. Le dédoublonnage du journal (compte + ID) couvre les deux voies.
- CSP, `contextIsolation`, `sandbox`, liste blanche IPC : les canaux ajoutés sont `ntbridge:*` et `marketdata:history`. Le renderer ne parle pas au socket.

L'AddOn C# n'a pas été compilé sur ce dépôt (Windows + NinjaTrader 8 requis). `scripts/fake-addon.mjs` couvre le protocole côté tests.

## Ontologie (v3, tâche 6)

Couche de liens typés dans le moteur (`src/engine/ontology/`), stockée dans Dexie `version(6)`, table `links`. Pas de triple store. L'Agent ne consomme pas ce graphe.

**Schéma.** `EntityRef` : `note`, `session`, `trade`, `instrument`, `strategie`, `evenement`, `compte`. L'identifiant est la clé de la table source (symbole pour un instrument, nom pour un compte, `note.id` pour une stratégie). Prédicats : `mentionne`, `pendant`, `de-la-seance`, `applique`, `soutient`, `contredit`, `raffine`, `partie-de`, `cause`, `relie`. Genre : `structurel` (moteur), `affirme` (utilisateur), `hypothese` (similarité), `rejete` (tombe, ne revient pas). Identifiant : `type:id|prédicat|type:id`.

**Stratégie.** Une note portant le tag `#strategie`. Alias optionnel d'en-tête `tag: orb` ; à défaut, titre slugifié. `#orb` sur une séance, un trade ou une note la désigne. Le statut épistémique (`statut: fait | modele | chiffre-non-verifie | opinion`, défaut `opinion`) est lu dans l'en-tête Markdown et stocké sur `Note.statut`, sans index.

**Règles structurelles** (`by: moteur`, `kind: structurel`), pures et idempotentes via `reconcileStructural` — un `affirme`, une `hypothese` ou un `rejete` n'est jamais modifié ni supprimé par le moteur :

- Note titrée `YYYY-MM-DD…` ou en-tête `date:` → `de-la-seance` vers chaque séance de cette journée, et `pendant` chaque événement d'impact ≥ 2 du jour (instruments vides, ou intersection avec les symboles cités ; sans symbole cité, tous les événements du jour).
- Symbole du registre hors blocs de code, via `resolveSymbol` (`NQ`, `MNQ 12-26`, `NQZ6`) → `mentionne` instrument.
- Tag qui désigne une stratégie → `mentionne` ; séance ou trade portant ce tag → `applique`.
- Trade → `de-la-seance` sa séance (`sessionId`) ; trade et séance → `pendant` chaque événement d'impact ≥ 2 de la journée dont les instruments sont vides ou contiennent l'instrument du trade.
- Corps (hors code) contenant un nom de compte connu des séances, en limite de mot → `mentionne` compte. Sous 3 caractères, la casse est respectée.

Recalcul après écriture de note, séance, trade ou synchro calendrier, debounce 500 ms. Au-delà de 2 000 notes ou 20 000 trades, le calcul passe par `ontology.worker.ts`.

**Similarité.** Hypothèses seulement, prédicat `relie`, une paire non ordonnée. `S = 0,7·cosinus TF-IDF + 0,3·Jaccard des tags`. Le titre pèse ×3 (`TITLE_TF_WEIGHT`). Mots vides FR/EN/ES courts, tokenisation Unicode, blocs de code ignorés, en-tête YAML écarté du TF. Plancher 0,35, 5 voisins par note (`SUGGEST_MIN`, `SUGGEST_TOP_K`). Les liens structurels portent la vérité ; le lexical ne fait que suggérer — l'inverse d'un wiki de prose. Une paire déjà `affirme` ou `rejete` n'est jamais resuggérée. Deux passages sur le même coffre donnent les mêmes scores.

**Confiance.** `claimConfidence` sur une note qui `soutient`, `contredit` ou `applique`. Périmètre : séances et trades atteints, plus les séances `applique` de la stratégie visée. Si la note est `pendant` un type d'événement (FOMC, CPI, NFP…), seuls les trades `pendant` ce type comptent. Sortie : N, expectancy en R (`mean`), taux de gain et facteur de profit (`computeTradeStats`), échantillon. Seuils : &lt; 10 insuffisant, &lt; 30 faible, &lt; 100 moyen, sinon solide. `R = PnL / risque` si le trade porte un risque, sinon `PnL / (pointValue × tickSize × 4)` et `rMode: approx`. Aucun texte généré. `contredit` ne change pas le signe.

**Coffre.** Format `canto-vault-v2` inchangé (`schemaVersion: 2`), champ optionnel `links`. Un coffre 2.1.0 sans `links` est accepté et ne remplace pas la table. À la restauration, les liens `structurel` sont ignorés (pas comptés comme lignes invalides) puis recalculés ; `affirme`, `hypothese` et `rejete` sont repris. Validateur : `EntityRef` bien formé, prédicat et genre dans l'énumération, `score` dans [0, 1] s'il est présent. Les secrets restent exclus.

**Interface.** Panneau Meta : section Relations (groupée par prédicat ; une hypothèse se confirme avec un prédicat ou se rejette) et section Confiance. Le graphe : trait plein = wiki ou `affirme`, pointillé = `hypothese`, filet gris (`--text-4`) = `structurel`. Le bouton Entités, éteint par défaut, ajoute instruments, stratégies et événements comme petits nœuds. Jetons existants, pas de nouveau composant dans `src/design/`.


