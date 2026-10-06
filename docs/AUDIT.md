# Audit général — nuée d'agents (16 septembre 2026)

Cinq auditeurs indépendants ont relu le dépôt en lecture seule, chacun sur un axe : **moteur quantitatif**, **robustesse de l'interface**, **performance & lancement**, **sécurité**, **design & UX**. Chaque constat a été vérifié dans le code (et, pour le moteur, par calcul), puis corrigé ou consigné ci-dessous. Tests : 30 → **49** (Vitest).

## Gel 3.0.0

Gel du desk prop firm. Paquet **3.0.0** après le commit de release. Aucune fonctionnalité nouvelle. La crypto n'est pas une classe de CΛNTO. `npm run check` sur cette branche : typecheck, **292** tests, build.

**Périmètre livré.** Registre d'instruments (futures CME), port de données de marché, calendrier officiel et instantané embarqué, pont WebSocket NinjaTrader 8, ontologie des notes, portefeuille, lanceur AUBE II.

**Conception ou prototype.** Agent : prototype (outils du desk, confirmation d'écriture, LLM par le process principal). Bot : conception, aucun ordre. Copieur : conception, la réplication n'est pas branchée. Le canal d'ordres du pont, lui, est livré.

**Hors périmètre définitif.** Crypto (ni classe d'actif, ni poche créable ; le littéral `'crypto'` ne sert qu'à refuser création et restauration). Explorateur. Tweets. Investing.com et Forex Factory (sources documentées, `redistributable: false` pour Investing, aucun adaptateur actif).

### Vérifications 2.1

- **Pont, écoute.** `grep -n "host" electron/nt-bridge/server.ts` : `WebSocketServer` est construit avec `host: '127.0.0.1'` ; tout autre hôte lève. Test `tests/nt-bridge-server.test.ts` « refuse un autre hôte que 127.0.0.1 ».
- **Jeton.** `tokensMatch` (`electron/secure-token.ts`) hash SHA-256 puis `timingSafeEqual`. Test `tests/orchestrator-token.test.ts`.
- **Trame.** `MAX_FRAME_BYTES = 256 * 1024`, fermeture `CLOSE.TOO_BIG` = 1009. Test `tests/nt-bridge-protocol.test.ts` « refuse une trame au-delà de 256 Ko ». Le serveur ferme aussi au-delà de ce plafond (`server.ts`, `onMessage`).
- **`bridge.hello`.** `validateAddonCall` refuse toute méthode avant hello (fermeture 4400). Test « refuse toute méthode avant bridge.hello ».
- **`order.submit`.** Sans tag : `-32013`. Compte hors `Sim*` et hors liste : `-32010`. Au-delà du plafond : `-32012`. Lien non `live` (dont `lost`) : `-32011`. Test `tests/nt-bridge-guards.test.ts` « refuse compte, plafond, tag et lien perdu ».
- **Kill switch.** `tests/nt-bridge-e2e.test.ts` « bars, ordre Sim101, exécution, trade, kill switch < 200 ms » : `performance.now()` autour de `killSwitch()` est sous 200 ms.
- **`bridge.json`.** `writeAddonConfig` écrit en `mode: 0o600` puis `chmod 0o600`. Test `tests/nt-bridge-config.test.ts` : le mode POSIX est `0600`. Sur Windows, ce mode est ignoré par Node ; le fichier est le dossier d'export sous Documents (`defaultNinjaExportFolder`). Les ACL Windows n'ont pas été mesurées sur ce poste Linux.
- **Journal.** `NtBridgeHost.writeConfig` journalise le nom de fichier, pas le jeton. `logOrder` écrit tag, compte, instrument, quantité, résultat. Le test de config connecte un jeton faux et vérifie que les lignes du `log` ne contiennent ni le jeton ni le mot de passe d'essai.
- **Calendrier.** `allowedHosts()` (`src/engine/sources.ts`) est la liste passée à `syncOfficialCalendar` via `dataFetchAllowed` (`electron/main.ts`, canal `calendar:macro`). `runCalendarSync` enveloppe chaque URL réseau dans `guardedFetch`, qui appelle `hostOk` avant `fetchImpl`. Le bundle est un fichier local. CME (`redistributable: false`) est court-circuité avant tout `fetch` (expirations locales). Investing.com n'a pas d'adaptateur. User-Agent calendrier : `CANTO-Desk/2.0 (calendar)` dans `guardedFetch`. Les `net.fetch` de mise à jour (`electron/updater.ts`, `electron/native-update.ts`) visent l'API GitHub avec `User-Agent: CANTO-Desk`, pas `allowedHosts()`. Les `fetch` LLM (`electron/main.ts`) passent par `llmHostOk`, qui ignore la liste envoyée par le renderer.
- **Cache.** Le cache disque est le corps HTTP des pages officielles (`url`, `body`, `etag`, `lastModified`, `fetchedAt`) sous `userData/calendar-cache`. `cacheIdentity` retire `api_key` avant le nom de fichier et avant l'écriture : une clé FRED ne reste pas sur le disque. Test « la clé FRED n’entre pas dans le cache disque ».
- **IPC.** `electron/preload.ts` n'expose pas `ipcRenderer`. `contextBridge.exposeInMainWorld('canto', …)` ne publie que des méthodes nommées. Comparaison des 47 canaux `ipcRenderer.(invoke|send|on)` et `ipcMain.(handle|on)` : ensembles égaux. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` sur le lanceur et le desk (`electron/main.ts`).
- **Coffre.** Fixtures reconstituées selon `buildVaultV2` de chaque tag : `tests/fixtures/vault-2.0.1.json` (sans `links`, `calendarEvents`, `pockets`), `vault-2.1.0.json` (`calendarEvents`, sans `links`), `vault-2.2.1.json` (`links: []`, sans `pockets`). Test « fixtures 2.0.1, 2.1.0 et 2.2.1 se restaurent ». Un JSON illisible ou une liste qui n'est pas une liste lève avant toute écriture (`cleared` inchangé). Les lignes individuellement invalides sont comptées et écartées (`rows` dans `src/store/db.ts`) : le reste du coffre est importé. Ce n'est pas un import partiel d'un fichier structurellement cassé.
- **Secrets d'export.** `tests/vault.test.ts` « export v2 ne contient aucune des clés apiKey|apiKeyBlob|orchToken|token » : `stripSecrets` avant l'écriture des réglages. Clé API du desk : `safeStorage.encryptString` (`secrets:encrypt`, `src/store/settings.ts`). Le jeton du pont vit dans `userData/nt-bridge.json` (mode `0600`), pas dans `safeStorage` et pas dans le coffre. Le jeton d'orchestrateur est en mémoire seulement.
- **`localStorage`.** `grep -rn localStorage src` : uniquement `canto.locale` (`src/i18n/index.ts`). Le mode discret du portefeuille est en `sessionStorage` (`canto.ptf.discrete`). Pas d'onglet ni de thème dans `localStorage`.
- **CSP.** `git diff 9cf59d3 -- index.html launcher.html` est vide. Inchangée depuis ce commit (2.2.0).

### Vérifications 2.2

- `npm audit --omit=dev --audit-level=high` : 0 vulnérabilité haute ou critique.
- `git diff 1129c93 -- package.json` : vide. Aucune dépendance ajoutée depuis la 2.2.1.
- Versions installées (`npm ls --depth=0`), sans montée majeure dans cette tâche : Electron **43.7.1**, Vite **7.3.6**, Vitest **4.1.11**, Dexie **4.4.6**.

### Reporté après 3.0.0

`grep -rn -E 'TODO|FIXME|XXX' src electron ninjatrader` : aucune occurrence. Rien d'orphelin dans le code.

Reporté comme travail, pas comme commentaire oublié :

- Réplication du copieur (sizing, filtres, politique prop) sur le canal d'ordres déjà là.
- Backtest des automates sur des barres importées.
- Mémoire longue de l'agent.
- Calendrier BLS : l'instantané embarqué s'arrête à la publication du 4 décembre 2026. Tentative du 2026-09-27 (`npm run calendar:snapshot`) : voir la section 3.0.1, C7.

## 3.0.1

Correctifs du gel. Aucune fonctionnalité. `npm run check` sur cette branche : typecheck, **303** tests, build. La montée de version, le tag `v3.0.1` et la Release suivent la fusion par l'ADMIN.

### C1 — Appariement des exécutions

Une exécution seule (WebSocket ou fichier) reprend les lots ouverts du même compte (`account|instrument|contractMonth`) et ignore une empreinte déjà dans `importedExecutions`. Table Dexie `openLots` (`key, account, instrument`), `this.version(8)`, sans migration de données. Le coffre exporte `openLots` s'il y en a ; un coffre 3.0.0 sans ce champ est accepté. Le panneau d'import affiche le nombre de lots encore ouverts par compte.

Preuve : `tests/import.test.ts` « entrée dans un message WS, sortie dans le suivant → un trade », « entrée dans fichier1.csv, sortie dans fichier2.csv → un trade aux chiffres du vecteur », « rejouer fichier2.csv → zéro trade supplémentaire ». Vecteur `vectors/trades.split-lots.json` (NQ, 20 $/point, PnL 196, commission 4, reste long 1 @ 20000). `tests/vault-restore.test.ts` « coffre 3.0.0 sans openLots accepté ».

### C2 — Compte réel

`ntbridge:allow-account` affiche `dialog.showMessageBox` (warning, défaut Annuler, `noLink`) avant `allowAccount`. Le dialogue du renderer reste l'explication. Le journal `main-log` porte le compte et l'horodatage, pas le jeton.

Preuve : `tests/nt-bridge-guards.test.ts` « dialogue Annuler : le compte réel n’est pas ajouté », « dialogue Autoriser : le compte est ajouté, le journal n’a pas de jeton », « un appel sans fenêtre attachée est refusé ».

### C3 — ACL Windows de `bridge.json`

Après l'écriture, sur `win32`, `execFile('icacls', …)` sans shell : `/inheritance:r /grant:r %USERNAME%:F`. Échec : le panneau Pont affiche « permissions du fichier de configuration non restreintes ». L'ADMIN vérifie sur son poste que le fichier n'est lisible que par son compte.

Preuve : `tests/nt-bridge-config.test.ts` « sur win32, icacls retire l’héritage et n’accorde que le compte », « si icacls échoue, le fichier reste écrit et les ACL sont signalées non restreintes ».

### C4 — `SHA256SUMS.txt`

Non modifié. La Release `v3.0.0` porte déjà l'asset (12 installeurs, sommes conformes aux fichiers). Le workflow écrit `SHA256SUMS.txt` dans `publish/` avant `gh release create "$TAG" publish/*`. Rien à recalculer ni à rattacher.

### C5 — Plafond

Champ contrôlé. Une saisie hors 1–1000 revient à la valeur persistée ; un refus de l'hôte est affiché dans le panneau.

Preuve : `tests/bridge-modal.test.ts` « saisir 5000 ramène l’affichage à la valeur persistée ».

### C6 — Minutes de `session.boundary`

`tradingDayKey` prend `minute = 0`. `tradingDayOf` parse `HH:mm`.

Preuve : `tests/instruments.test.ts` « une bascule 17:30 sépare 17:29 et 17:31 ET ».

### C7 — Calendrier BLS 2027

Non corrigé. Tentative du 2026-09-27, `npm run calendar:snapshot` : BLS a répondu (24 événements, pas un 403) mais aucune date 2027. Dernière publication embarquée : NFP 2026-12-04, CPI 2026-12-10. `src/engine/calendar-bundle/2026.json` est laissé tel quel.

### C8 — Parcours manuel (ADMIN)

L'agent ne lance pas le desk et ne coche rien. L'ADMIN exécute :

1. Coffre neuf. Couvert par `tests/vault.test.ts` « restore d'un objet v1 minimal sans tags ne lève pas » et `tests/vault-restore.test.ts` « coffre 3.0.0 sans openLots accepté ».
2. Import NT multi-instruments. Couvert par `tests/import.test.ts` « calcule le PnL ES / MNQ / MCL depuis le registre et signale une racine inconnue » et `tests/executions.test.ts` « apparie en FIFO avec fractionnement, commissions réparties et position ouverte restante ».
3. Séance. Couvert par `tests/executions.test.ts` « produit des identifiants stables et des séances par journée ».
4. Note datée liée. Couvert par `tests/ontology-structural.test.ts` « relie la note datée, le symbole, le compte, la stratégie, la séance et les événements ».
5. Poche prop et Cœur. Couvert par `tests/portfolio-valuation.test.ts` « prop : journal puis pont vivant, le pont remplace le réalisé » et « taux manquant : poche exclue, le total ne la convertit pas à 1 », et par `tests/portfolio-bilan.test.ts` « les contributions somment au total, la variation de valeur nette aussi ».
6. Calendrier hors ligne. Couvert par `tests/calendar-offline.test.ts` « premier lancement sans cache : le socle embarqué, sources réseau périmées, jamais vide ».
7. Faux AddOn, barre, ordre Sim, kill switch. Couvert par `tests/nt-bridge-e2e.test.ts` « bars, ordre Sim101, exécution, trade, kill switch < 200 ms ».
8. Mise à jour depuis le lanceur. Couvert par `tests/launcher-transfer.test.ts` « résout le lancement sans aucune image, au filet CFG.pre + 400 ms », `tests/release-check.test.ts` « lit le tag de la dernière release publiée », `tests/updater-policy.test.ts` « sans dépôt git, refuse le pull (installeur → page GitHub) ».


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

## AUBE II — lanceur

Le transfert vers le desk ne dépend jamais d'une image rendue : filet à `CFG.pre + 400 ms`, `stop()` résout l'attente, `finally` dans `playTransfer`.

## Portefeuille (v3, tâche 7)

Module 08 · PTF. Synthèse locale : ce que le desk vaut, ce qu'il risque, ce que ça projette. Pas de montée de version (la 3.0.0 est la tâche 8). Aucune source réseau nouvelle.

**Modèle.** Dexie `version(7)`, tables additives seulement : `pockets` (`id, kind, account`), `positions` (`id, pocketId, symbol, closedAt`), `cashBalances` (`id, pocketId`), `fxRates` (`pair`), `equityPoints` (`[pocketId+date], date`). `PocketKind` inclut `'crypto'`, réservé : le formulaire ne le propose pas, la création lève, et la restauration d'un coffre qui porte `kind: 'crypto'` lève « Poche crypto refusée : la crypto est hors périmètre de CΛNTO. » Les poches possibles : prop firm, futures, actions, indices, forex, commodités, CFD, liquidités. Réglage `portfolio.baseCurrency`, défaut `USD`, devise ISO sur 3 lettres.

**Valorisation** (`valuePocket`, pur). La journée est celle de Globex : `tradingDayKey` à 18:00 America/New_York. La date d'une séance n'est pas re-découpée.

- Prop firm : `plan.accountSize + Σ pnl` des séances du compte. Si un instantané du pont pour ce compte a moins de 60 s, l'équité devient `cashValue + unrealizedPnl` et **remplace** le journal (le réalisé n'est pas compté deux fois). Marque « pont » ou « journal ». Distances via `evaluatePlan` : drawdown restant, objectif restant, perte journalière, jours. Alerte si le drawdown restant est à 25 % ou moins du drawdown maximal du plan.
- Futures sans plan : cash saisi + Σ pnl des séances, même remplacement par le pont vivant.
- Traditionnel : `Σ quantity × (dernier prix ?? prix de revient) × multiplicateur` + cash de la poche. Le dernier prix est saisi, ou lu d'un `MarketDataPort` déjà ouvert. Le module n'en crée pas, et aucun n'est branché aujourd'hui : la marque reste le prix saisi, ou le prix de revient. `unrealized` est `null` dès qu'une position ouverte n'a pas de dernier prix — affiché « au prix de revient », jamais 0.
- Liquidités : somme des cash.
- Change : taux saisis (`EURUSD` = 1 EUR pour `rate` USD). L'inverse est déduit. Pas de triangulation. Taux manquant : la poche est exclue du total, raison `taux EUR/USD manquant`, jamais convertie à 1.

**Exposition.** Notionnel `|quantity| × prix × multiplicateur`, converti en base. Les séances futures et prop sont clôturées : l'exposition intrajournalière vient de `bridgeSnapshot.positions` quand le pont est vivant, sinon 0 et la mention « pont hors ligne ». Concentration = plus grosse ligne / notionnel total. Levier brut = notionnel total / valeur nette, null si la valeur nette n'est pas strictement positive.

**Courbe et risque.** `buildEquityPoints` est idempotent : un point par poche et par journée qui porte une séance (prop / futures) ou un mouvement (ouverture, clôture, dernier prix, cash). La courbe consolidée somme par date en devise de base et reporte la dernière équité d'une poche sans point ce jour-là. `drawdownSeries` de `metrics.ts` est appliqué aux variations d'équité (solde de départ = première valeur nette) : drawdown courant, max, durée. Les points sont persistés pour ne pas les recalculer à chaque rendu.

**Projection et bilan.** Série d'entrée : PnL quotidien consolidé, dernières N journées (défaut 120, état local). Ruine = somme des drawdowns restants des poches prop convertis en base ; s'il n'y en a pas, le drawdown max historique consolidé, indiqué comme tel. Objectif optionnel. Exécution par `montecarlo.worker.ts` existant. Le bilan (7 j, 30 j, trimestre, année, personnalisée) donne le PnL par poche en base, les commissions des séances prop / futures, les jours gagnants et perdants, le meilleur et le pire jour, la part de chaque poche (les parts portent sur des contributions qui somment au total) et la variation de valeur nette. Export CSV et JSON local.

**Saisi.** Poches, positions (quantité signée, prix de revient, dernier prix), liquidités, taux, devise de base, fenêtre de journées, objectif optionnel de la projection, ruine si l'utilisateur l'écrase.

**Calculé.** Valeur nette, exposition, concentration, levier, courbe, drawdown, distances prop, alerte à 25 %, bilan, Monte Carlo.

**Non couvert.** Cotations live (pas de flux, pas de port créé), courtiers, crypto (valeur d'énumération seulement).

**Hypothèses.** Deux poches sur le même compte additionnent deux fois les mêmes séances. Le PnL réalisé d'une position clôturée n'est pas versé en cash : l'utilisateur saisit le cash. Il n'y a pas d'historique de change : le taux saisi courant convertit toute la courbe. Un cash est un niveau à partir de sa journée, pas un grand livre des soldes passés. Le pont est « vivant » dans l'interface quand `link === 'live'` ; l'horodatage de l'instantané est celui de la lecture, pour que le seuil de 60 s reste vrai tant que le lien l'est.

Licence : MIT depuis 3.1.0.

**Coffre.** Format `canto-vault-v2` inchangé (`schemaVersion: 2`). Champs optionnels `pockets`, `positions`, `cashBalances`, `fxRates`. Un coffre 2.2.x sans eux est accepté et ne remplace pas les tables. `equityPoints` n'est pas exporté : il est reconstruit à la restauration. Validateurs `CHECKS` : devises ISO, quantités finies, `kind` dans les types créables (`'crypto'` ne passe pas), taux strictement positif, `by: 'utilisateur'`.

## 3.3.0 — Forge 1, port et routeur

Relecture du code de la Forge 1 (L.1, L.2, Sim seulement). Pas de Release : `package.json` reste `3.2.2`, le tag est l'acte de l'ADMIN. `protocol.ts` et `ninjatrader/CantoBridge.cs` ne changent pas.

**Moteur.** `routeFill` (`src/engine/copier/router.ts`) refuse `latency` si l'âge dépasse le budget (l'égalité passe), `window` hors `HH:mm` locale, `blackout` à ±15 min, `floor` quand `evaluatePlan(...).buffer` est sous `maxDrawdown * followerBufferFloor` ou que le plan est en échec, `cap` si la taille n'est pas un entier ≥ 1, dépasse le plafond du suiveur ou celui du pont, `instrument` si la carte micro/standard ne connaît pas la racine. Vecteurs `vectors/copier.route.basic.json`, `copier.route.blackout.json`, `copier.route.prop-floor.json`. Les gardes pures rendent `-32010` `-32011` `-32012` `-32013` (`vectors/execution.guards.json`) ; `tests/nt-bridge-guards.test.ts` n'a pas été modifié.

**Interface.** `08 · CPY` est sur le rail (`tests/tabs.test.ts`). Armer appelle `copier:arm`, qui n'arme qu'après `confirmCopierArm` (Annuler par défaut, fenêtre absente refusée). Couper reste dans l'en-tête. Le badge lit `armed` de l'hôte, pas `config.enabled`.

**Performance.** `tests/copier-host.test.ts` mesure `cut()` sous 200 ms. L'idempotence est un `Set` plus `userData/copier-seen.txt`. Le fichier grandit d'une ligne par ordre routé : observation, pas un blocage. Pas de rattrapage d'un fill déjà vu.

**Sécurité.** Un suiveur qui ne commence pas par `Sim` est écarté dans `coerceCopierSync` et n'est pas soumis. Le `submit` repasse par `guardSubmit`. Le journal du routeur ne contient pas le jeton (`tests/copier-host.test.ts`). IPC ajoutée : `copier:status`, `copier:configure`, `copier:arm`, `copier:cut`, toutes derrière `trusted`. Couper pendant un `submit` encore en vol annule l'accusé qui revient. Le kill switch désarme le routeur puis garde `order.flatten`.

**Design.** Aucun jeton nouveau. `tests/design-guard.test.ts` vert. Le Copieur réutilise `Button`, `Tag`, `Stat`, `Toggle`, `Panel`.

**Reste hors de cette relecture.** CI sur les trois OS après poussée. Séance du testeur sur NinjaTrader 8 (Sim101 → Sim102). Règles Apex (D7, Forge 2). Journal certifié, protocole d'agent, licence. Rien d'ouvert en correctif de code sur les preuves ci-dessus.



## 3.3.4 — audit agentique (2026-10-05)

Relecture en lecture seule de `main` à v3.3.4, au regard d'un objectif : CΛNTO est la porte de la couche agentique IA du trader. Trois lecteurs : l'onglet `06 · AGT` et la licence ; les onglets `01` à `05` ; l'exécution (`07 · BOT`, `08 · CPY`, pont NT8, shell). `npm run typecheck` vert, **397** tests verts. Chaque constat ci-dessous cite le code ; les plus graves ont été relus deux fois. Rien n'est corrigé dans cette section : les correctifs deviennent les tickets A1 et suivants.

**Verdict.** L'onglet critique est `06 · AGT`. Il est la porte et reste un prototype : la boucle peut casser une conversation, deux outils rendent des chiffres faux, il ne lit qu'un tiers du desk, et sa passerelle parle un JSON-RPC propre que les agents du marché ne connaissent pas.

### Agent (`06 · AGT`)

| # | Constat | Preuve |
|---|---|---|
| G1 | Le message assistant garde tous les appels d'outils ; `takeToolCalls` n'en exécute que 8, dont 2 écritures. Un appel écarté reste sans résultat : le tour suivant reçoit un 400 (OpenAI comme Anthropic), et chaque envoi rejoue cet historique. | `src/store/agent.ts:180`, `:187` |
| G2 | `calendar_events` ne lit que `generateNasdaqEvents`, qui ne contient plus FOMC ni NFP ; les événements officiels de `useMacro` ne sont pas lus. Seules l'année de début et celle de fin sont générées. | `src/engine/agent/tools.ts:243-244`, `src/engine/calendar.ts:229` |
| G3 | `propfirm_status` et `desk_overview` appellent `evaluatePlan` sans compte ; l'écran filtre sur le compte choisi. | `tools.ts:44`, `:262`, `src/modules/metrique/useStats.ts:61` |
| G4 | L'identifiant d'appel de repli (`call_${index}`, `toolu_${index}`) devient la clé Dexie du message outil : collision possible d'un tour à l'autre. | `electron/main.ts:914`, `:986`, `src/store/agent.ts:193` |
| G5 | Tout l'historique repart à chaque tour, résultats d'outils compris. Six tours épuisés : aucune réponse finale, aucun avis. | `src/store/agent.ts:158-200` |
| G6 | Consigne et descriptions « Nasdaq NQ/MNQ » ; branche `bridge.*` morte au message faux ; liste des méthodes de l'orchestrateur en double ; préréglages de modèles anciens ; les liens écrits par l'agent sont signés `utilisateur`. | `src/store/settings.ts:11`, `src/store/agent.ts:122`, `src/engine/agent/ports.ts:42`, `electron/orchestrator.ts:32`, `src/modules/agent/Agent.tsx:48-52` |
| G7 | Ni la boucle (`send`) ni les flux SSE du main ne sont testés. | `tests/agent-*.test.ts` |
| G8 | Lecture absente : positions et comptes NT8, barres et niveaux, portefeuille, ventilations, Monte Carlo, Copieur. Aucun événement poussé (`broadcast` jamais appelé). Pas de MCP. | `src/engine/agent/ports.ts:23-34`, `src/lib/desk.ts:214` |

### Prérequis avant toute exécution par l'agent

| # | Constat | Preuve |
|---|---|---|
| S1 | L'AddOn exécute `order.submit` sans garde propre et n'authentifie pas le serveur auquel il envoie son jeton. | `ninjatrader/CantoBridge.cs:312`, `:495` |
| S2 | Le kill switch n'aplatit que les instruments en position : un ordre en attente sur un instrument à plat survit. Après la coupure, `cancel` est refusé. Le message « N compte(s) aplati(s) » ne lit pas les réponses. | `CantoBridge.cs:630-639`, `src/engine/execution/guards.ts:60`, `src/store/bridge.ts:251` |
| S3 | Le plafond monte à 1000 par IPC sans dialogue du main. | `electron/main.ts:642` |
| S4 | Copieur : rien n'interdit au maître d'être aussi suiveur ; réplication fill par fill sans distinguer entrée et sortie ; Couper protège peu sans `flattenOnCut`. | `src/engine/copier/sync.ts:197-199`, `src/engine/copier/sizing.ts:54-56`, `electron/nt-bridge/copier-host.ts:216` |
| S5 | Mises à jour sans signature de code ; `SHA256SUMS.txt` vient de la même Release. | `package.json` (`mac.identity: null`), `electron/native-update.ts:84-100` |

### Autres onglets

| Onglet | Constat principal | Preuve |
|---|---|---|
| `01 · MET` | Heure classée en ET, jour de semaine en heure locale. EOD jamais contrôlé en séance. | `src/engine/metrics.ts:373`, `:376`, `src/engine/propfirm.ts:257` |
| `02 · VIS` | Barres NT8 datées à la clôture, lues comme ouvertures (Opening Range faussé). Une barre live remplace la série choisie. Marqueurs non filtrés par instrument. | `CantoBridge.cs:574`, `src/store/bars.ts:109`, `src/modules/visual/Visual.tsx:197` |
| `03 · CAL` | CPI officiel et estimé affichés à un jour d'écart. « 3ᵉ vendredi » appliqué à CL, GC, 6E. Historique d'une source effacé à chaque synchro. | `src/engine/macroMerge.ts:146`, `src/engine/calendar.ts:271-299`, `src/store/macro.ts:73` |
| `04 · NTE` | Les tags posés à la création sont perdus à la première modification du corps. | `src/store/notes.ts:203`, `:254` |
| `05 · PTF` | `instrumentMultiplier('NQ 12-26')` vaut 1 : exposition sous-estimée d'un facteur 20. | `src/engine/portfolio/price.ts:11`, `src/engine/portfolio/exposure.ts:79` |

### Licence

À valider par un conseil. La fenêtre MIT (3.1.0 à 3.3.1) couvre l'agent, l'orchestrateur, le canal d'ordres et la réplication : l'avance doit venir de ce qui suit. Le cas du trader financé qui touche des paiements n'est pas tranché par le texte « usage personnel ». Pas de CLA : une contribution externe ne pourra pas être relicenciée commercialement. `CantoBridge.cs` est copié seul dans NinjaTrader sans la ligne `Required Notice`.

### Plan

- **A1 · Fiabilité de la boucle** — G1, G4, G5, G7 : chaque appel reçoit un résultat, identifiants uniques, réponse finale au dernier tour, budget de contexte, boucle extraite et testée.
- **A2 · Données justes** — G2, G3, G6 : calendrier officiel fusionné, compte dans `propfirm_status`, consigne multi-CME, préréglages à jour, emplacement pour le modèle du Lab.
- **A3 · Tout le desk en lecture** — G8 : pont, portefeuille (après le facteur 20), barres et niveaux, ventilations, Monte Carlo, Copieur ; une seule liste d'outils.
- **A4 · La porte** — serveur MCP local à jeton, événements poussés, `PROTOCOLE-AGENT.md`, auteur `agent` dans l'ontologie.
- **A5 · Exécution gardée** — après S1 à S4 : `propose_order` confirmé dans le main, Sim par défaut, limites de cadence et de position.

Le correctif du kill switch (S2) suit en parallèle, sur sa propre branche.

**Suivi (2026-10-05).** A1 fusionné (#76). S2 fusionné (#77) ; l'AddOn 2.1.1 reste à compiler et à essayer sur Sim par l'ADMIN. `CLAUDE.md` fusionné (#78). A2 en revue (#79). A4 livré avant A3, à la demande de l'ADMIN : passerelle MCP locale (`electron/mcp-server.ts`, `docs/PROTOCOLE-AGENT.md`), vérifiée avec le client MCP officiel contre le desk réel. Événements poussés (A4) et auteur `agent` dans l'ontologie : à venir.

**A3 (2026-10-05).** L'agent lit tout le desk : `journal_breakdown`, `monte_carlo`, `bridge_status`, `portfolio_snapshot`, `market_levels`. Au passage, quatre constats des autres onglets sont corrigés, chacun avec un test rouge sans le correctif : jour de semaine au fuseau du poste (`01 · MET`), multiplicateur des contrats datés du pont, × 20 (`05 · PTF`), barres NinjaTrader datées à la clôture et série active remplacée par le direct (`02 · VIS`). La liste des outils n'existe plus qu'à un endroit (`src/engine/agent/catalog.ts`).

**A4, fin (2026-10-05).** A2, A4 (passerelle) et A3 fusionnés (#79, #80, #81). Les écritures des agents sont signées `agent` : liens de l'ontologie et notes (G6 soldé). Le desk range et pousse ses événements (G8 soldé) : fills, marge du plan suivi aux seuils de 50, 25, 10 % et au franchissement (latent compris, hystérésis), catalyseurs majeurs à 15 minutes, lien du pont. L'orchestrateur les pousse (`desk.event`), les agents MCP les lisent avec `desk_events` et un curseur. Reste hors A4 : la marge journalière, à suivre une fois la journée de trading du plan tranchée ; A5 après S1, S3, S4, S5.

**S1 et S3 (2026-10-05).** S3 : relever le plafond de contrats passe par un dialogue du process principal (Annuler par défaut) ; le baisser reste immédiat. S1 : l'AddOn applique sa propre garde, lue dans `bridge.json` (comptes `Sim*` ou autorisés, plafond, tag), avant chaque `order.submit` ; il n'envoie plus le jeton : défi-réponse HMAC-SHA256 dans les deux sens, rien n'est envoyé ni exécuté avant la preuve du desk. Vérifié en faisant tourner le vrai `CantoBridge.cs` sous Mono, avec des stubs NinjaTrader, contre le serveur compilé du desk et contre un faux serveur. Reste à l'ADMIN : compiler l'AddOn 2.2.0 dans NinjaTrader 8. Restent S4 (Copieur) et S5 (signature des mises à jour) avant A5.

**S4 (2026-10-05).** Le compte maître n'est jamais suiveur et un suiveur en double est écarté (la boucle d'ordres n'est plus possible). La réplication suit la position du maître, plus chaque fill : une taille fixe ne se multiplie plus sur une entrée en plusieurs fills, une sortie ramène le suiveur à zéro. Ce qui réduit le risque part toujours (hors fenêtre, en blackout, au-delà du budget de latence ou de la marge prop), borné par la position réelle du suiveur. Couper garde la décision D1 (pas d'aplatissement par défaut) et nomme les positions copiées encore ouvertes. Reste S5 (signature des mises à jour) avant A5.

**S5 (2026-10-05).** Les desks n'installent une mise à jour que si `SHA256SUMS.txt` porte la signature Ed25519 d'une clé du Lab embarquée (`electron/release-keys.ts`), liée à la version. La CI publie la Release en brouillon ; l'ADMIN la signe sur son poste (`scripts/sign-release.mjs`) et la publie. La clé privée ne passe ni par le dépôt ni par GitHub (`docs/PUBLICATION.md`). Reste à l'ADMIN : générer la clé et committer la clé publique ; la signature de code des installeurs reste une décision séparée. Les prérequis S1 à S5 sont levés : A5 peut commencer.

**A5 (2026-10-05).** L'agent propose, il ne soumet pas. `propose_order` (embarqué, MCP, orchestrateur) passe par le process principal, qui garde avant toute question : comptes `Sim*` seulement, même si un compte réel est autorisé à la main ; une proposition à la fois ; pont en ligne ; canal d'ordres ouvert (fermé après le kill switch) ; limites propres à l'agent, contrats par ordre (1), position atteinte (2), propositions par minute (3) ; marge du plan prop suivi au-dessus de 25 %. Une réduction de risque n'est bornée que par la quantité. Le trader confirme chaque ordre dans une fenêtre du process principal (Refuser par défaut, 45 s) ; l'ordre part avec le tag `canto-agent`, puis passe les gardes du pont et de l'AddOn. Désactivé à chaque ouverture du desk ; l'activer et relever une limite passent par une fenêtre du process principal. Chaque proposition est tracée (`agent_order`, signée `agent`) et poussée aux orchestrateurs. Code : `src/engine/agent/orders.ts`, `electron/agent-orders.ts`, `src/store/agentOrders.ts` ; tests `agent-orders`, `agent-orders-host`, `agent-propose-order`, `agent-orders-labels`. L'invariant « Agent » de `CLAUDE.md` est mis à jour en conséquence (décision de l'ADMIN). Le plan 3.3.4 est soldé ; restent la marge journalière et l'essai sur Sim par l'ADMIN (AddOn 2.2.0).

## 3.5.0 — Métrique et données NinjaTrader (2026-10-06)

Demande de l'ADMIN : un meilleur graphique dans l'onglet Métrique, et les données de NinjaTrader branchées dans le desk, pour le trader comme pour l'agent.

### Constats

**`01 · MET` — courbe d'équité.** A.02 était un SVG figé (`src/modules/metrique/Dashboard.tsx`, `EquityCurve`, supprimé par M1.2) : un point par séance, ni survol ni zoom, deux graduations. `lightweight-charts` est déjà une dépendance (`src/modules/visual/Chart.tsx`) : aucune dépendance nouvelle.

**Pont NinjaTrader.** Les exécutions entrent seules dans le journal quand le socket est en ligne (`src/store/bridge.ts:152-156`, puis `importCsv`). Le reste arrive au process principal mais ne sert pas :

- **États d'ordre.** `bridge.order` devient un événement `order` (`electron/nt-bridge/execution-port.ts:64-79`) que son seul abonné ignore (`electron/nt-bridge/copier-host.ts:103-107`). Aucun canal vers le renderer, aucun outil d'agent : ni l'écran ni l'agent ne savent si un ordre, même proposé par l'agent, est en attente, rempli ou annulé.
- **Comptes.** Solde, P&L réalisé et latent, positions arrivent toutes les 5 s dans le statut du pont. Le P&L réalisé n'est affiché nulle part ; `BridgeAccountsView` l'omet (`src/engine/portfolio/view.ts:8-11`). L'instantané n'a pas d'horodatage : `bridgeSnapshots` le date de l'instant du rendu (`view.ts:14-17`), d'où « PONT · 0 S » permanent (`src/modules/portefeuille/Synthese.tsx:58-63`).
- **Données de marché.** Le circuit existe de bout en bout (`marketdata:subscribe` / `history`, `createNt8Port`), mais aucun code du desk ne s'abonne : `createPort('nt8-bridge')` n'est appelé nulle part hors tests (`src/engine/marketdata/index.ts:28-36`). Ticks et cotations sont reçus puis ignorés (`src/store/bridge.ts:157-165`).
- **AddOn 2.2.0.** Trois valeurs de compte seulement (`ninjatrader/CantoBridge.cs:501-534`) ; `bridge.snapshot` répond un objet vide (`CantoBridge.cs:634`) ; les mises à jour d'ordre n'ont ni quantité remplie ni prix moyen ; pas de rattrapage des exécutions par le socket.

### Plan

- **M1 · Courbe d'équité** — `src/engine/equityCurve.ts` (pur) : un pas par séance ou par trade, plus haut, drawdown, plus grand recul. A.02 (`src/modules/metrique/EquityChart.tsx`) : équité au-dessus et sous zéro, plus haut en pointillé, P&L par pas, drawdown sous l'eau, lecture au survol, Ctrl + molette pour zoomer (la molette seule fait défiler la page), double-clic pour tout revoir. Couleurs lues dans les jetons.
- **D1 · Comptes et ordres en direct** — bloc « Séance en cours » en tête de Métrique quand le pont est en ligne (P&L du jour réalisé et latent, solde, positions, fraîcheur) ; horodatage des instantanés ; livre des ordres en cours tenu par le process principal, affiché, poussé à l'agent (événement d'état d'ordre, outil `working_orders`).
- **D2 · Données de marché** — Visual s'abonne à un instrument et une unité NinjaTrader (historique puis direct, dernier prix) ; `market_levels` sur les barres NinjaTrader ; outil de cotation pour l'agent.
- **D3 · AddOn 2.3.0** — valeurs de compte étendues, `bridge.snapshot` complet, ordres avec remplissage, rattrapage des exécutions. Compilation par l'ADMIN dans NinjaTrader 8, vérification sur compte Sim. Le desk reste compatible avec 2.2.0.

Tout ce qui est ajouté est en lecture : aucun invariant de la section 5 de `CLAUDE.md` ne bouge.

**M1.4, trait du Lab (2026-10-06).** À la demande de l'ADMIN, A.02 reprend le style du Lab : fils d'un pixel légèrement lumineux, trame de points fixe à l'écran (plus dense contre la crête, dissoute vers zéro), repères au trait fin (« PLUS HAUT », « CREUX ») au lieu d'une flèche, pixel rouge signature (matrice 5 × 5, cœur blanc) au dernier pas. Trois séries personnalisées de `lightweight-charts` (`src/modules/metrique/equitySeries.ts`) peignent une géométrie pure (`equityPaint.ts`). Deux pièges, chacun couvert par un test rouge sans le correctif : `applyOptions` ignore un `null` posé sur un nombre (le carré de survol restait affiché), d'où la sentinelle `NONE` ; la bibliothèque ne recalcule pas l'abscisse des barres hors cadre (trait parasite au bord après un zoom), d'où des voisins replacés d'après l'espacement.

**M1 (2026-10-06).** Livré : `equity-curve.test.ts` (grains séance et trade, même drawdown max que la tuile K.04, séance manuelle sans trade gardée en grain trade, sorties dans la même seconde) et `equity-chart.test.ts` (séries, couleurs lues dans les jetons, lecture au survol, bascule, molette, démontage). Vérifié dans le desk Electron réel sur le jeu de démonstration (30 jours et tout le journal, grains séance et trade, zoom).

## 3.5.0 — Ajustement du module Métriques, étape 1 : corrections (2026-10-06)

Cahier des charges de l'ADMIN : « Prompt d'ajustement du module Métriques · v4 », six étapes, validation de l'ADMIN entre chaque. Le document visait la v3.2.2 : chaque constat a été relu sur le HEAD avant correction. Une correction = un commit = un test rouge sans elle.

| # | Constat (HEAD) | Correction | Test | Attendu | Obtenu |
|---|---|---|---|---|---|
| 1.1 | Jour d'entrée à New York (`metrics.ts`, `byWeekday` ; `Analyse.tsx`, trame et anneau) au lieu de la séance CME | `tradeDay`, `sessionDates`, `dayHourGrid` : jour = date de la séance, sinon `tradingDayOf` à la sortie ; heure = entrée ET | `metrics-day` | 28/09 +600, 29/09 −300 | idem, Séances = Analyse |
| 1.2 | √252 sur les seuls jours tradés (`computeDailyStats`) | `calendarSeries` : journées de cotation de la période (lundi–vendredi hors fermetures `cmeSession`), jours sans séance à 0 ; Calmar sur ces journées ; champ `tradingDays` | `metrics-annualization` | 3,58 / 3,15 / 2,77 / 2,21 | 3,585 / 3,145 / 2,771 / 2,212 |
| 1.3 | « BRUT » affiché sur un PF après frais ; deux `grossProfit` | `profitFactorBeforeFees`, `grossProfitBeforeFees`, `grossLossBeforeFees` ; K.03 affiche les deux | `metrics-profit-factor` | 0,907 / 1,222 | 0,907 / 1,222 |
| 1.4 | Seul le Tableau de bord recevait le journal filtré | `scopeFor` : Analyse période + compte ; Firme prop compte seul ; Monte-Carlo compte obligatoire ; l'en-tête dit ce que l'onglet ignore | `metrics-scope` | — | conforme |
| 1.5 | Une entrée par séance et par compte, horizon = taille de l'échantillon | `monteCarloSample` : un compte, une valeur par journée ; `monteCarlo()` inchangé | `metrics-montecarlo-account` | ≈ 0,661, 3 comptes = 1 | 0,6609 (avant : 0,946, horizon 180) |
| 1.6 | Jauge K.04 : repli sur clôtures de la période | `planMargin` (plus-bas de la dernière séance − plancher), `drawdownGauge` sur tout l'historique du compte ; sans plan, calcul de la période signalé ; bouton « Suivre ce plan » ; marge datée | `metrics-gauge`, `drawdown-limit` | marge 175 | 53 000 / 50 100 / 50 275 / 175 (avant : 575) |
| 1.7 | MAE de positions simultanées non additionnées (`evaluatePlan`) | Excursions des trades qui se chevauchent additionnées, depuis le P&L réalisé à l'entrée | `propfirm-overlap` | −1 200 | −1 200 (avant : −600) |

**Règle 6 (consommateurs).** Comparaison avant / après sur la démo (`generateDemoJournal({ sessions: 140, seed: 2052, endDate: 2026-10-01 })`, `TZ=UTC`) : `monteCarlo()`, `drawdownSeries()` et `evaluatePlan()` identiques (la démo n'a aucun trade simultané) ; `computeTradeStats()` identique aux trois champs nouveaux près ; `computeDailyStats()` identique sauf Sharpe 2,696 → 2,576, Sortino 4,594 → 4,395, Calmar 9,944 → 9,099 (correction 1.2) et le champ `tradingDays`.

**Signalé, non corrigé (hors périmètre).**
- Agent : la description de `journal_breakdown` (`src/engine/agent/tools.ts:350`) dit « jour de semaine (heure de New York) » ; depuis 1.1 c'est la journée CME de la séance.
- Copieur et Portefeuille : `evaluatePlan` est plus prudent quand des trades se chevauchent (1.7) ; la garde « marge prop » du Copieur refusera donc plus tôt dans ce cas.
- Firme prop : `evaluatePlan` arrête le rejeu à l'objectif atteint ; la jauge 1.6 le dit et date la marge.
- Labor Day, Thanksgiving, 3 juillet : `cmeSession` les marque écourtés (13 h), pas fermés ; ils comptent comme journées de cotation.

**Décisions ouvertes appliquées par défaut.** n° 1 : Sharpe, Sortino et Calmar dans une section repliée A.05 du Tableau de bord, corrigés ; l'IC viendra avec l'étape 2. n° 4 : tables F20 à F22 non codées (étape 3), à fournir par l'ADMIN.

## 3.5.0 — Ajustement du module Métriques, étape 2 : fiabilité des chiffres (2026-10-06)

Onglets A, B et C. Moteur dans `src/engine/inference.ts` (bootstrap par blocs, permutation, Benjamini-Hochberg, écart détectable, rapprochement) et `src/engine/tradeUnits.ts` (points, motif de sortie, étiquettes). `computeDailyStats`, `drawdownSeries`, `monteCarlo` et `evaluatePlan` ne changent pas de résultat. Le test `metrics-rule6` fige ces sorties sur un cas construit.

| # | Ajustement | Test | Attendu | Obtenu |
|---|---|---|---|---|
| 2.1 | IC 90 % par blocs circulaires, longueur arrondie de n^(1/3), 5 000 tirages, centre = moyenne observée | `metrics-inference`, `metrics-step2` | [12 ; 135] $, centre ≈ 73 $ (± 10 $) | [12,14 ; 122,23] $, centre 66,66 $. Le centre et la borne basse sont dans la tolérance. La borne haute est à 13 $ sous 135 ± 10. Longueur de bloc 5, non ajustée pour coller au chiffre. |
| 2.2 rail | Repère retenu seulement avec ≥ 30 trades, p de permutation corrigée < 5 %, même signe et au moins la moitié de l'ampleur sur la seconde moitié | `metrics-markers`, `metrics-step2` | « Vendredi 9 h » (+2 800 $, 33 trades) hors du rail, p ≈ 0,5 | 33 trades, +2 799,52 $, hors du rail. p = 0,080 (pas 0,5). La seconde moitié est à −14 $ : le signe se renverse. Aucun repère de la démo n'est retenu. |
| 2.2 SQN | √min(n, 100) | `metrics-sqn`, `metrics-step2` | ≈ 0,95 (2,07 avant le plafond) | 0,954 |
| 2.2 Kelly | Taux hors trades de PnL nul | `metrics-sqn` | inchangé sans nul | conforme ; le cas à un nul change le Kelly |
| 2.2 autocorr. | Pearson, décalages 1 à 5, bande ± 1,96/√n | `metrics-autocorr`, `metrics-step2` | ordre 1 ≈ 0,23, hors bande | 0,235, bande 0,166 |
| 2.2 écart | 2,8 × σ × √(1/n₁ + 1/n₂) × √deff | `metrics-inference`, `metrics-step2` | ≈ 0,31 R et 0,51 R | σ des R = 1,270, n = 470, ICC négatif donc deff = 1 : 0,328 R et 0,547 R. C'est la formule, pas un calage. |
| 2.2 A+ | Étiquette sans date = inconnue | `metrics-tags`, `metrics-step2` | 90 gagnants sur 95, catégorie inconnue | 90 / 95, toutes inconnues |

**Écran.** A.05 : IC 90 % de Sharpe, Sortino et Calmar, SQN plafonné, Kelly. Si le compte filtré est le compte du plan suivi : repli, Calmar et Ulcer rapportés à `plan.maxDrawdown`. Bloc « Suivi de stabilité » : dernière fenêtre (réglage, départ 20), bande ± 1,96 σ/√n, alerte CUSUM (k = 0,5 σ, h = 5 σ), autocorrélations. B : saisie d'étiquette sur le trade, date posée à l'instant de la pose. C : rail filtré ou « Aucun repère solide sur cette période » ; dollars et points par contrat ; tags classés intention / jugement / inconnue ; durée moyenne par motif de sortie.

**Réglages livrés.** 3, 4 et 6 seulement (minimum de trades 20/30/50, fausses découvertes 2,5 %/5 %/10 %, fenêtre 10/20/40), dans `Settings`, `coerceSettings`, `RESTORABLE_SETTING_KEYS`, trois langues. Les neuf autres attendent l'étape qui les lit.

**Règle 6.** `metrics-rule6` reste vert : `monteCarlo`, `drawdownSeries`, `evaluatePlan`, et `computeTradeStats` / `computeDailyStats` sur un cas de moins de 100 trades sans PnL nul. Effet assumé : `desk_overview.sqn` baisse dès que n > 100 (démo : 2,07 → 0,954). Le Kelly de l'agent ne change que s'il y a des trades nuls. `journal_breakdown` dit encore « heure de New York » pour le jour : déjà signalé à l'étape 1, non repris.

**Décisions ouvertes.** n° 1 : IC ajouté dans A.05 replié. n° 2 : l'heure de l'étiquette est celle de la pose, pas une saisie. n° 3 : perte maximale du plan quand le compte filtré est le compte suivi, sinon le capital de référence (Sharpe et Sortino restent sur ce capital). n° 4 : tables F20 à F22 toujours non codées. Le rapprochement vers la moyenne est livré (`shrinkTowardMean`) et testé ; l'affichage des petits groupes attend l'étape 5.

**Hors de cette étape.** Étapes 3 à 6, NinjaTrader, version `package.json`, changelog 3.5.0, extraction de l'ATR.

## 3.5.0 — Ajustement du module Métriques, étape 3 : R et risque (2026-10-06)

Moteur `src/engine/riskConsole.ts`. Les tables F20, F21 et F22 ne sont pas inventées. Tant qu'elles manquent, et tant que la fiche contexte n'existe pas, l'écran applique le risque de base seul (réglage 8, départ 1,5 %). Les ajustements Vol-LT et Cross-Vol sont stockés (réglages 9 et 10) et marqués provisoires ; ils ne s'appliquent pas encore. La mesure en σ n'utilise que la volatilité implicite saisie (réglage 11). `volCT` et l'élasticité attendent les étapes 4 et 5.

| # | Ajustement | Test | Attendu | Obtenu |
|---|---|---|---|---|
| 3.1 | Risque = \|entrée − stop\| × valeur du point × quantité ; sinon risque saisi ; sinon fixe | `metrics-risk` | 2 MNQ, stop 19 990, +60 $ → 40 $, +1,5 R, source `stop` | conforme |
| 3.1 | R/R, espérance, seuil | `metrics-risk` | 2 ; 875 ; 33,3 % | conforme |
| 3.2 | Matrice en R | `metrics-risk` | 40 % et 1,5 → 0,00 R ; 50 % et 2 → +0,50 R | conforme |
| 3.3 | Risque ajusté, notionnel, contrats | `metrics-risk` | 0,95 % ; 1 520 ; 0,475 NQ → 4 MNQ | conforme, avec les deux ajustements passés à la fonction. L'écran, lui, reste au risque de base. |
| 3.4 | σ = cours × vol ÷ √périodes | `metrics-risk` | classes [0 ; 0,25) [0,25 ; 0,5) [0,5 ; 1) [1 ; ∞) | conforme, vol implicite seulement |
| 3.5 | Bernoulli, série, Bayes | `metrics-series` | 0,0778 / 0,0102 ; moyenne ≈ 6,0 et 95e rang 9 ; 0,549 [0,468 ; 0,629] | conforme |

**Écran.** B : stop initial et objectif initial sur chaque trade ; risque, R/R prévu, R réalisé et source. Mention si tout est en risque fixe. Largeurs ±1 σ jour / semaine / mois si une volatilité implicite est saisie, sans niveau atteint (il faut la clôture de la veille). C : matrice R-R, espérance avec IC par blocs de journées, respect du risque de base, Bernoulli, série de pertes, Bayes, taux après 1 à 3 gains ou pertes, tranches de stop en σ.

**Coffre.** `stopPrice` et `targetPrice` facultatifs. `TRADE_SCHEMA_VERSION` passe à 3. Un coffre sans ces champs reste lisible ; un prix aberrant est écarté.

**Règle 6.** Aucune des fonctions figées (`monteCarlo`, `drawdownSeries`, `evaluatePlan`, `computeTradeStats`, `computeDailyStats`) n'est réécrite.

**Décisions.** n° 3 : capital de risque = perte maximale du plan si le compte filtré est le compte suivi, sinon capital de référence. n° 4 : tables non fournies, signalées provisoires.

## 3.5.0 — Ajustement du module Métriques, étape 4 : contexte du jour (2026-10-06)

`atrSeries` (`src/engine/atr.ts`) est la fonction pure de l'ATR de Wilder. L'indicateur `atr` l'appelle ; `tests/atr-series.test.ts` vérifie l'égalité des valeurs. `buildMetricsContext` (`src/engine/metricsContext.ts`) produit une fiche par séance CME et par racine, jours sans trade compris. Les volatilités de Garman-Klass (annualisées, moyenne des fenêtres 5/10, 15/30 et 60/90) s'arrêtent à la clôture de la veille. Moins de 90 séances : champs de volatilité vides, l'onglet C affiche « Historique de barres insuffisant ».

| # | Ajustement | Test | Attendu | Obtenu |
|---|---|---|---|---|
| 4 | Régimes sur une volatilité 12 % puis choc, hausse, redescente | `metrics-context` | choc, puis expansion, puis décrue, puis compression, délais 2 et 5 | conforme |
| 4 | Historique tronqué | `metrics-context` | fiches antérieures identiques | conforme, trois dates |
| 4 | Jours sans trade, comptes copiés | `metrics-context` | `traded: false` ; trois copies = 1 contrat | conforme |
| 4 | ATR | `metrics-context`, `atr-series` | identique à l'indicateur sur les barres journalières | conforme |

**Réglages 1 et 2.** Confirmation d'un régime 1/2/3, durée minimale 3/5/10. Les ajustements Vol-LT et Cross-Vol restent à zéro à l'écran : les tables F21 et F22 ne sont pas fournies, le déclencheur n'est pas inventé. Les volatilités sont dans la fiche pour quand les tables arriveront.

**Règle 6.** Inchangée. `indicators.ts` ne change que l'appel à `atrSeries`.

## 3.5.0 — Ajustement du module Métriques, étape 5 : lecture par contexte (2026-10-06)

La trame jour × heure de l'onglet C est remplacée par une lecture à axe choisi (régime, bande, publication, rang, après une perte, risque, stop en σ, jour, heure). Le régime et la bande qui classent une journée sont ceux de la veille. Les petits groupes sont rapprochés de la moyenne. Un verdict est confirmé seulement s'il passe le rail de l'étape 2.

| # | Ajustement | Test | Attendu | Obtenu |
|---|---|---|---|---|
| 5.1 | Jour et heure sur la démo | `metrics-reading` | aucun verdict confirmé | conforme |
| 5.2 | Décomposition | `metrics-reading` | le produit retrouve le gain moyen par journée | égal à 10⁻⁸ près |
| 5.2 | Contrôle décalé d'une semaine | `metrics-reading` | l'effet planté disparaît | significatif en place, non significatif décalé |
| 8 | Classes d'amplitude | `metrics-reading` | total = nombre de journées, cumul 100 %, vides sans effet | conforme |
| 8 | Changement de régime | `metrics-reading` | le jour du changement garde la valeur de la veille | conforme |
| 5.4 | Queue | `metrics-reading` | empirique dès 250, Pareto dès 500 | conforme |

Réglage 5 : 5 min avant une publication (5 à 10), 30 min après (15 à 60). Moins de 30 journées comparables : le texte « pas assez de journées comparables » est le verdict « pas assez de données » de l'axe. Les trois questions (décomposition, publications, comportement) sont dans le moteur ; l'écran montre l'axe et son verdict.


## Couche agentique du trader — thèse et vague 1 (2026-10-06)

Demande de l'ADMIN : une thèse solide pour amener CΛNTO à son objectif, être la porte de la couche agentique IA du trader, et des sous-agents pour la bâtir. La thèse est dans `docs/THESE-AGENTIQUE.md`. Cinq lecteurs en lecture seule sur `8602cbb` : perception et vérité des outils, porte MCP, vigilance et mémoire, sûreté et évaluation, veille du marché. `npm run typecheck` vert, 140 fichiers de tests verts. Chaque constat ci-dessous a été relu sur le HEAD ; les plus graves l'ont été deux fois.

### Constats

| # | Constat | Preuve |
|---|---|---|
| T1 | `journal_breakdown` dit « jour de semaine (heure de New York) » et appelle `computeTradeStats` sans `sessionDates`, alors que l'onglet Analyse ventile par journée CME depuis 1.1. | `src/engine/agent/tools.ts:350`, `:354`, `src/modules/metrique/Analyse.tsx:251` |
| T2 | `desk_overview` et `propfirm_status` rendent `buffer` (clôture − plancher) ; la jauge K.04 lit `planMargin` (plus-bas de la dernière séance). Sur le cas 1.6, l'agent dit 1 225, l'écran 175. | `tools.ts:123`, `src/engine/propfirm.ts:353` |
| T3 | `monte_carlo` additionne les comptes copiés quand aucun compte n'est donné ; l'onglet E exige un compte (1.5). | `tools.ts:386-387` |
| T4 | Aucune lecture du journal ne porte `asOf` ni sa source ; le jeu de démonstration se mêle au vrai journal sans le dire. `get_session` par date prend la première séance, tous comptes confondus. | `src/store/journal.ts:75-86`, `tools.ts:167` |
| T5 | Sorties non bornées : notes de 200 séances, trades et `executionIds` d'une séance, entrées personnelles du calendrier. | `tools.ts:149`, `:172-174`, `:324` |
| T6 | Ordres en cours, dernière cotation, perte du jour : rien n'est lisible par l'agent. L'événement `order` du port est ignoré, les cotations sont jetées. | `electron/nt-bridge/copier-host.ts:103-107`, `src/store/bridge.ts:157-165` |
| T7 | Les comptes du pont ne sont pas datés : `bridgeSnapshots` les date de l'instant de l'appel, `bridgeIsFresh` est toujours vrai. | `src/engine/portfolio/view.ts:14-17`, `src/engine/portfolio/valuation.ts:106` |
| T8 | Mémoire : aucune règle chiffrée du trader, la consigne ne contient que le texte du réglage et un horodatage UTC présenté comme « Date locale ». La perte du jour n'est jugée qu'au rejeu des journées closes. | `src/store/agent.ts:195-202`, `src/store/settings.ts:46-86`, `src/engine/propfirm.ts:277` |
| T9 | Porte : le process principal lit le type (`read` / `write`) d'un outil MCP dans la réponse du renderer, alors que l'orchestrateur le lit dans `DESK_TOOL_KINDS`. | `electron/mcp-server.ts:136`, `:146`, `electron/desk-relay.ts:54-58`, `electron/orchestrator.ts:261` |
| T10 | Porte : pas de plafond d'appels en vol ; débit compté avant le jeton ; desk muet rendu comme une liste vide ; ordre refusé par le trader marqué `isError` ; JSON-RPC mal formé accepté ; consignes figées en français ; résultats MCP non étiquetés ; ni titres ni prompts. | `electron/mcp-server.ts:29-30`, `:93-115`, `:135`, `:195-198`, `:319` |
| T11 | Les `fetch` vers le fournisseur LLM suivent les redirections : un 307 vers un autre hôte emporte la clé et les données du desk hors de la liste épinglée. | `electron/main.ts:883`, `:890`, `:963`, `:986` |
| T12 | La clé API n'est pas liée à son hôte : changer de préréglage garde la clé, que le main joint à tout hôte épinglé. | `src/modules/agent/Agent.tsx:250`, `electron/main.ts:926`, `:962`, `:988` |
| T13 | `account`, `instrument` et `reason` d'un ordre proposé acceptent sauts de ligne et caractères bidi : une raison peut forger une fausse ligne « Position » dans le dialogue. La position est lue par égalité stricte du nom. | `src/engine/agent/orders.ts:46-50`, `electron/agent-orders.ts:95-110`, `:231` |
| T14 | Les refus `disabled` et `busy` échappent à la cadence, que `PROTOCOLE-AGENT.md` § 5 dit pourtant « refusées comprises » ; un client peut vider l'anneau de 500 événements. | `electron/agent-orders.ts:242`, `src/store/agentOrders.ts:49` |
| T15 | Titres et champs des calendriers externes non bornés jusqu'au modèle. | `electron/calendar/bea.ts:38`, `treasury.ts:98-104`, `fred.ts:39-41` |
| T16 | Aucun harnais d'évaluation de l'agent ; `npm test` ne fixe pas le fuseau alors que `metrics-step2` exige UTC. | `tests/metrics-step2.test.ts:13`, `package.json:19` |

Rien n'a été trouvé qui fasse partir un ordre sans le dialogue du process principal.

### Plan

- **A6 · Vérité** — T1 à T5 : journée CME, marge datée à côté de `buffer` (inchangé), compte exigé, période et compte pour `desk_overview`, `asOf` et `sources`, sorties bornées, schémas typés, profit factor d'une tranche.
- **A7 · Preuve** — T16 : `TZ=UTC`, fournisseur scripté, desk de démonstration, scénarios dorés différentiels, injection.
- **A8 · Porte** — T9, T10 : type lu par le main, appels en vol bornés, erreurs lisibles, indications et titres au catalogue, consignes selon l'état et la langue, résultats étiquetés, trois prompts.
- **A9 · Séance** — T6, T7 : livre des ordres en cours, `working_orders`, événement `order`, `market_quote` sans abonnement, âge du flux dans `market_levels`, comptes datés. Aucun changement de l'AddOn.
- **A10 · Discipline et mémoire** — T8 : règles chiffrées du trader, perte du jour sur la journée CME (18 h – 17 h ET, comme `tradeDay` et le rejeu du plan), dérives après une perte, écarts aux règles, `trader_memory`, `discipline_status`, consigne enrichie et datée à New York, événements `daily_loss` et `discipline`, réglages.
- **A11 · Garde** — T11 à T15 : redirections refusées, clé liée à son hôte, dialogue non falsifiable, cadence qui compte tout, chaînes externes bornées.

Tout ce qui est ajouté est en lecture, ou renforce une garde. Aucun invariant de la section 5 de `CLAUDE.md` n'est affaibli. Les gardes de `propose_order` ne changent que pour refuser plus (T13, T14).

### Vague 1 livrée (2026-10-06)

Cinq sous-agents, un par piste, chacun dans son worktree ; fusion et intégration sur `claude/couche-agentique`. Un ticket = un commit = un test, rouge sans le correctif (message d'échec relevé dans chaque rapport), vert avec. Fin de vague : `npm run typecheck` vert, **812** tests verts (161 fichiers ; 678 au départ), `npm run electron:compile` et `npm run build` verts. `ninjatrader/CantoBridge.cs` ne change pas : le desk reste compatible avec l'AddOn 2.2.0.

| Piste | Commits | Tests | Ce qui change |
|---|---|---|---|
| **A6 · Vérité** | `844889b` `d8546be` `893cdba` `328b697` `a6ea00a` `522239c` `e3e68a1` `0060215` | `agent-verite`, `agent-tool-schemas` | Journée CME dans `journal_breakdown` ; `margin` datée et `passedOn` à côté de `buffer` (cas 1.6 : `margin` 175, `buffer` 1 225 inchangé) ; `account_required` dans `monte_carlo` ; période et compte dans `desk_overview` ; `asOf`, `sources`, `demo` ; `get_session` `ambiguous` ; sorties bornées ; entiers, motifs de date, prédicats énumérés ; profit factor d'une tranche et `noLoss` |
| **A7 · Preuve** | `996c404` `fdcafcc` `55017a7` | `suite-timezone`, `agent-eval`, `agent-injection` | `TZ=UTC` fixé par `vitest.config.mts` ; fournisseur scripté (`tests/helpers/scriptedLlm.ts`), desk de démonstration (`demoDesk.ts`), `runScenario` sur la vraie boucle et le vrai `executeDeskTool` ; attendus recalculés par les moteurs de l'écran ; une note injectée ne fait partir aucune écriture sans confirmation, sur chaque outil d'écriture du catalogue |
| **A8 · Porte** | `a77be78` `9267ec3` `dd82280` `c676465` `d7e0a49` `5af16c8` `b4096ef` `efceb74` `5117c83` `fa031ec` `c0eb424` `39ca58a` | `mcp-server`, `mcp-catalog`, `agent-refusal-label`, `agent-routines` | Type d'outil lu dans `DESK_TOOL_KINDS` ; 8 appels en vol, débit après le jeton, `Retry-After` ; `-32002` quand le desk se tait ; `declined` hors `isError` ; motif du desk gardé ; `-32600` ; `DESK_TOOL_HINTS`, `DESK_TOOL_TITLES` ; consignes selon la langue et l'état ; `TOOL_PREAMBLE` sur le texte MCP ; prompts `pre_session_brief`, `session_debrief`, `prop_plan_review` (`src/engine/agent/routines.ts`), reliés à la mémoire et à la discipline |
| **A9 · Séance** | `9af875e` `9e635c5` `105683d` `2fef2d1` `358e490` | `order-book`, `agent-working-orders`, `agent-quote`, `agent-levels`, `bridge-accounts-at` | Livre des ordres dans le process principal (`ntbridge:orders`, `ntbridge:order-state`) ; `working_orders` et événement `order` ; `market_quote` sans abonnement ; `feed`, `ageSec`, `stale` dans `market_levels` ; `accountsAt` et fraîcheur réelle des comptes |
| **A10 · Discipline et mémoire** | `63aecd7` `a05afbc` `e5302a6` `61aacde` `3ef8a94` `57a1775` `6bacf2c` `ed1d29d` `d5ffba1` `9ef5919` `33d9ba3` `dc326ee` | `discipline-rules`, `discipline-day`, `discipline-events`, `discipline-drifts`, `discipline-breaches`, `agent-memory`, `agent-discipline-tools`, `agent-system-prompt`, `desk-events-push`, `discipline-settings`, `agent-events-tool` | Règles chiffrées du trader (Réglages › Discipline, 0 = inactive) ; perte du jour sur la journée CME, limite = min(règle, plan) avec sa source ; `daily_loss` à 50, 75, 100 % ; dérives et écarts, événement `discipline` au fill d'entrée ; `trader_memory`, `discipline_status` ; consigne enrichie de la mémoire (sans les notes d'agent), datée à New York ; rien ne part dans la consigne quand les outils du desk sont coupés |
| **A11 · Garde** | `5a5f23b` `194890e` `a2a0148` `4e2948d` `e48739f` | `llm-host`, `settings-coerce`, `vault-restore`, `agent-orders`, `agent-orders-host`, `agent-propose-order`, `calendar-adapters` | `llmFetch` refuse toute redirection ; clé liée à `apiKeyHost` ; contrôle et bidi refusés dans `account` / `instrument`, raison sur une ligne, position lue sans casse ; toute proposition compte dans la cadence, `agent_order` borné (10 / min, 60 / h, `suppressed`) ; chaînes des calendriers bornées à la fusion |

**Intégration.** Les tables du catalogue sont complétées pour les outils ajoutés en parallèle (`working_orders`, `market_quote`, `trader_memory`, `discipline_status`), ainsi que les ports du desk de démonstration. A10.11 corrige une fuite introduite par A10.8 : sans elle, la mémoire du trader serait partie au fournisseur même outils coupés. A8.12 et A10.12 relient les routines et la description de `desk_events` aux nouveaux événements.

**Décision appliquée par défaut.** La perte du jour se compte sur la journée CME, de 18 h à 17 h heure de New York, comme `tradeDay` (1.1) et le rejeu du plan. Les dérives `revenge_entry` (fenêtre de 5 min) et `size_up_after_loss` sont signalées même sans règle chiffrée : ce sont des lectures, qui ne bloquent rien.

**Constats nouveaux, non corrigés.**
- Garde A5 et `prop_buffer` lisent `buffer` plus le latent : sur le cas 1.6, environ 49 % de marge là où la jauge affiche 7 % (`src/store/deskEvents.ts:52`, `:61`). Décision de l'ADMIN.
- `desk_overview` sans `to` arrête la série à la dernière séance, le Tableau de bord va jusqu'à aujourd'hui (`Dashboard.tsx:65`) : Sharpe et Sortino diffèrent ; comportement gardé.
- Les synchronisations de calendrier suivent les redirections (`net.fetch`) et `hostOk` ne contrôle que la première URL : un 307 de BLS renverrait `registrationkey` à un autre hôte.
- `apiKeyHost` est fourni par le renderer ; le lier dans le blob chiffré changerait le format du blob.
- Pendant une rafale de propositions, le journal du process principal écrit encore une ligne par refus.
- `payoffRatio` sans perte vaut `null` ; les tags importés ne sont pas bornés dans `list_sessions`.
- Deux passages complets de la suite, sous une charge machine élevée pendant la vague, ont montré chacun un échec non identifié ; quatre passages complets ensuite, puis trois sur la branche intégrée, sont verts.

**Reste.** Vague 2 : brief et débrief dans l'agent embarqué, adoption d'une leçon proposée par l'agent, ressources MCP et schémas de sortie, configuration Codex et Claude Desktop, affichage du livre des ordres et de la séance en cours, abonnement de Visual au flux (D2). Vague 3, à l'ADMIN : `docs/THESE-AGENTIQUE.md` § 7.
