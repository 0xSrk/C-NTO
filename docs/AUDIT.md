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

**Écran.** B : stop initial et objectif initial sur chaque trade ; risque, R/R prévu, R réalisé et source. Mention si tout est en risque fixe. Largeurs ±1 σ jour / semaine / mois par instrument, au pas de cotation, si une volatilité implicite est saisie, sans niveau atteint (il faut la clôture de la veille). C : matrice R-R au R/R réalisé (gain moyen ÷ \|perte moyenne\|, NaN sans perte), espérance avec IC par blocs de journées, respect du risque de base, Bernoulli, série de pertes, Bayes, taux après 1 à 3 gains ou pertes, tranches de stop en σ.

**Coffre.** `stopPrice` et `targetPrice` facultatifs. `TRADE_SCHEMA_VERSION` passe à 3. Un coffre sans ces champs reste lisible. Un prix aberrant est retiré à la restauration ; le trade et son P&L sont gardés. La saisie accepte la virgule et refuse, avec un message, un prix hors de ]0 ; 1e6] ou du mauvais côté de la direction.

**Règle 6.** Aucune des fonctions figées (`monteCarlo`, `drawdownSeries`, `evaluatePlan`, `computeTradeStats`, `computeDailyStats`) n'est réécrite.

**Décisions.** n° 3 : capital de risque = perte maximale du plan si le compte filtré est le compte suivi, sinon capital de référence. n° 4 : tables non fournies, signalées provisoires.

**Corrections (2026-10-06).** M4.7 à M4.11, après la revue (T17, T18) : voir « Couche agentique du trader — vague 2 › Corrections ».

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

**Corrections (2026-10-06).** Une barre journalière est datée par sa date civile ; les copies ne fusionnent qu'entre comptes différents ; « après une perte » lit le dernier trade sorti avant l'entrée ; le seuil de 90 séances se juge par fiche ; une barre invalide ne gèle plus le régime ; le contexte du jour est traduit et jamais lu sur une série de démonstration. M5.5 à M5.10 (T19 à T21, T25) : voir « Couche agentique du trader — vague 2 › Corrections ».

## 3.5.0 — Ajustement du module Métriques, étape 5 : lecture par contexte (2026-10-06)

La trame jour × heure de l'onglet C est remplacée par une lecture à axe choisi (régime, bande, publication, rang, après une perte, risque, stop en σ, jour, heure). Le régime et la bande qui classent une journée sont ceux de sa propre fiche, arrêtée à la clôture de la veille (décision T27). Une lecture ne porte que sur une racine. Les petits groupes, un seul trade compris, sont rapprochés de la moyenne. La permutation compare un groupe à la moyenne générale. Un verdict est confirmé seulement s'il passe le rail de l'étape 2.

| # | Ajustement | Test | Attendu | Obtenu |
|---|---|---|---|---|
| 5.1 | Jour et heure sur la démo | `metrics-reading` | aucun verdict confirmé | conforme |
| 5.2 | Décomposition | `metrics-reading` | le produit retrouve le gain moyen par journée | égal à 10⁻⁸ près |
| 5.2 | Contrôle décalé d'une semaine | `metrics-reading` | l'effet planté disparaît, sur une journée tradée | significatif en place, non significatif décalé |
| 8 | Classes d'amplitude | `metrics-reading` | total = nombre de journées, cumul 100 %, vides sans effet | conforme |
| 8 | Changement de régime | `metrics-reading` | le jour du changement se classe par sa propre fiche, arrêtée à la veille | conforme |
| 5.3 | Publication | `metrics-axis` | CPI 08:30 : entrée 08:00 « loin », 08:45 « proche » ; « proche » de n'importe quelle publication | conforme |
| 5.4 | Queue | `metrics-reading` | empirique dès 250 ; Pareto dès 500, seuil au quantile 10 %, extrapolée au niveau 5 % ; ES empirique | conforme |

Réglage 5 : 5 min avant une publication (5 à 10), 30 min après (15 à 60). Un verdict demande 30 journées distinctes ; en dessous, l'axe dit « pas assez de données ». Les trois questions (décomposition, publications, comportement) sont dans le moteur ; l'écran montre l'axe et son verdict.


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

## Couche agentique du trader — vague 2 (2026-10-06)

Reprise sur `main` (`c0d7753`). Un ticket = un commit = un test. Invariants de `CLAUDE.md` § 5 inchangés. `ninjatrader/CantoBridge.cs` ne change pas. Hors périmètre du brief : gardes de `propose_order`, marge lue sur `buffer`, abonnement de marché par l'agent, hôte du Lab, version de `package.json`.

| Piste | Commits | Tests | Ce qui change |
|---|---|---|---|
| **A11 · Garde** | `A11.6` | `calendar-offline` | Les synchronisations de calendrier ne suivent plus les redirections : `redirect: 'manual'` (Electron 43.7.1, `net.fetch` transmet le mode au `ClientRequest`, qui annule au lieu de suivre). Un 3xx rendu quand même est refusé ; le 304 reste le rejeu du cache. L'état de la source porte « Redirection refusée ». |
| **A6 · Vérité** | `928d3ea` `33c43da`, puis `520f7e4` `d10c80a`, puis `48e7dcf` `1a65445` (§ 5.3) | `agent-verite`, `agent-metriques` | Payoff `noLoss` sans perte. Tags de la séance et de chaque trade de `get_session`, et de `list_sessions`, bornés à 20 de 40 caractères (`tagsTruncated`), remontés au `truncated` racine. `get_session` rend le risque et le R de chaque trade, calculés comme l'onglet C (A6.12). `day_context` rend la fiche du contexte du jour de l'onglet Analyse, sur la même série (`contextSeries`), et le brief d'avant-séance l'appelle (A6.13) |
| **A12 · Routines** | `38e0c93` `da0a1bf` `88393e6`, puis `2ad0a6a` `13e859c` `3ed64ff` `c5e1a27` `92fe34a` | `agent-routine-due`, `agent-routine-run`, `agent-routine-cue`, `agent-tab` | Brief et débrief proposés dans l'onglet Agent (`routineDue`, minutes entamées, garde du soir), datés de la journée CME. La journée n'est retenue que si la routine part. Perte du jour recalculée du journal : la pastille tient après un redémarrage. Boutons inactifs pendant un flux, un seul envoi à la fois. Rien ne part sans clic, prouvé sur le composant |
| **A13 · Séance** | `2d95844` `1d208d0` `1cb7c4c`, puis `4811b9c` `97d3e1a` `ed48ddb` `3c50654` | `live-session`, `live-orders`, `metrique-live-session`, `metrique-live-orders`, `visual-nt-follow`, `visual-nt-addon`, `visual-follow-reset`, `nt-bridge-history` | Séance en cours en tête de Métrique, sur le compte suivi, nommé ; sa fraîcheur vieillit. Ordres en cours seulement avec un pont, ordres non confirmés marqués. Visual suit le flux NinjaTrader : 5 jours d'historique en secondes, validés par le process principal, contrat complet, échec affiché, source étiquetée, barres vidées au changement de série. Lecture seule |
| **A14 · Porte** | `8e84e49` `e3eef9a` `e1fca9e` `ed238eb` `7a403fa`, puis `ba07d0a` `ad7737c` `8427cff` `c06f09d` `5250aeb` `1fa308d` `3c19062` | `desk-describe`, `desk-relay`, `mcp-clients`, `mcp-server`, `agent-tab`, `orchestrator-locale` | Titres dans `desk.describe`. Ressources MCP : `{id}` validé dans le process principal, refus du desk en `-32002`. `outputSchema` par lecture, propriétés vérifiées sur la démo. Configurations Claude Desktop et Codex, *Copier le jeton MCP*. `name` stables ; refus et erreurs dans la langue du desk, orchestrateur compris |
| **A15 · Mémoire adoptée** | `fe4367e` `1e017ff`, puis `9639f6c` `432b48c` `b59fbb6` | `agent-adopt`, `note-adopt` | Le trader adopte une note d'agent dans l'onglet Notes (`adoptedAt`). Elle entre dans `trader_memory` en gardant `by: agent`. Aucun outil ne pose ce champ ni ne réécrit une note adoptée. À la restauration, un `adoptedAt` illisible est retiré, la note gardée |
| **A16 · Preuve** | `c016ab8` `c66894f`, puis `084bfcc` `8d2c3bf` `217feea` | `agent-eval`, `agent-injection` | Outils de la vague 1 dans le harnais. `discipline_status` probant : horloge au 2026-09-30, perte non nulle, limite et source comparées. Injection par `desk_events` sur les cinq outils d'écriture, ordres activés compris (`declined`). `trader_memory` avec une leçon, `market_quote` avec un témoin frais |

Les PR #104 à #109 sont intégrées par fusion, puis corrigées sur la même branche (§ 5.1 du brief) ; leurs commits gardent leur empreinte. Deux constats de l'intégration sont corrigés en plus : l'orchestrateur répondait en français seul (`electron/orchestrator.ts:224-270`, A14.12) ; deux envois rapprochés partaient tous les deux, le verrou étant pris après le premier `await` (`src/store/agent.ts:231-236`, A12.8).

**À vérifier par l'ADMIN sur compte Sim (A13.4).** `CantoBridge.cs` ne change pas ; Visual s'appuie sur l'AddOn 2.2.0 tel qu'il est.
- `Instrument.GetInstrument("NQ")` refuse, `"NQ 12-26"` répond, sous `FullName` exact.
- `TriggerCustomEvent` et `WaitOne(15000)` sur le même fil : un historique vide au bout de 15 s signalerait un blocage.
- Barres en direct horodatées à l'ouverture, désabonnement à « Ne plus suivre », contrat pendant la semaine de bascule.
- `scripts/fake-addon.mjs` ne répond pas à `marketdata.history` : la vérification se fait sur NinjaTrader.

**Constats nouveaux, non corrigés.**
- `read_note` et `search_notes` ne rendent pas `adoptedAt` : l'adoption ne se lit que dans `trader_memory`.
- Le rail de l'étape 2 ne centre pas sa permutation ; l'option `centered` sert la lecture par contexte seulement. Le centrer changerait la démo : « durée 5–10 min » serait retenu à p = 0,003, et vendredi 9 h passerait de p = 0,080 à 0,156. Décision de l'ADMIN.
- Trois suites complètes lancées en même temps sur 4 cœurs : `launcher-transfer` et `seat-tools` dépassent le délai de 5 s ; seuls, ils prennent 0,7 s. Ce sont sans doute les « échecs non identifiés » de la vague 1. Ce n'est pas un défaut du code ; leurs délais ne changent pas.

### Revue des étapes 3 à 5 des Métriques et des PR #103 à #109 (2026-10-06)

Les relecteurs ont relu chaque étape, puis rejoué chaque PR : typecheck, tests, correctif retiré pour voir le test tomber. Chaque bloquant a été relu dans le code. Les corrections, dans l'ordre, sont au § 5 de `docs/BRIEF-AGENTIQUE-VAGUE-2.md`.

Les six PR ouvertes (#104 à #109) s'empilent sur `main` sans conflit de code ; seul `docs/AUDIT.md` frotte. Empilées : typecheck vert, 864 tests verts, `electron:compile` et build verts. Constats sur `main` (`d9b39aa`) :

| # | Constat | Preuve |
|---|---|---|
| T17 | La matrice R-R reçoit le R/R **prévu** comme R/R réalisé ; sans objectif saisi (démo, import), il vaut 1. Bloquant. | `src/modules/metrique/RiskReading.tsx:46-53` |
| T18 | Le stop et l'objectif saisis acceptent tout nombre fini, alors que `CHECKS` écarte tout le trade, P&L compris, à la restauration. La virgule donne `NaN` sans message. | `src/modules/metrique/Sessions.tsx:287-290`, `src/store/db.ts:444-445` |
| T19 | Les barres journalières sont rangées par journée CME, alors qu'un CSV journalier est lu à minuit local. Sur un poste à UTC+2 ou plus, la fiche D contient les prix de D+1. | `src/engine/metricsContext.ts:73`, `src/engine/bars.ts:127` |
| T20 | Le dédoublonnage des copies ignore le compte. Deux exécutions d'un même compte dans la même seconde comptent pour une ; un suiveur en micros n'est pas fusionné. | `src/engine/metricsContext.ts:181-183`, `:254-257` |
| T21 | « Après une perte » prend le trade précédent par ordre de sortie, même s'il était encore ouvert à l'entrée. | `src/engine/metricsContext.ts:298-305` |
| T22 | La fenêtre de publication est inversée : elle retient de 30 min avant à 5 min après, au lieu de 5 min avant à 30 min après. Bloquant. | `src/modules/metrique/ContextAxis.tsx:107` |
| T23 | La permutation teste la moyenne absolue du groupe, pas son écart à la moyenne générale. | `src/engine/inference.ts:94`, `src/engine/contextReading.ts:120`, `:250` |
| T24 | Un groupe d'un seul trade n'est pas rapproché de la moyenne : variance nulle, poids 1. | `src/engine/contextReading.ts:109` |
| T25 | Le régime vient de la série active (autre racine, ou démo) et classe les trades de toutes les racines ; leurs points sont moyennés ensemble. | `src/modules/metrique/ContextAxis.tsx:74`, `:96-118` |
| T26 | Le verdict juge sur 30 trades, pas sur 30 journées comparables. | `src/engine/contextReading.ts:144` |
| T27 | Le régime « de la veille » est lu sur `days[index-1]`, alors que la fiche du jour est déjà arrêtée à la veille : D−2. Deux lectures du cahier : décision de l'ADMIN. | `src/modules/metrique/ContextAxis.tsx:88-89`, `:126-128` |
| T28 | Les PR #97 à #99 ont été fusionnées dans des branches intermédiaires, puis rapatriées par #102. Le commit `d9b39aa` porte un trailer d'attribution d'outil. Les descriptions des PR #97 à #109 portent des liens de session. Contraire à `CLAUDE.md` § 1. | `git log -1 d9b39aa`, PR #97 à #109 |

Vérifié sans défaut : l'ATR `atrSeries` est identique bit à bit à l'ancien indicateur ; Garman-Klass est arrêté à la veille ; les formules de `riskConsole.ts` sont justes ; aucune des fonctions figées par la règle 6 n'est modifiée.

### Corrections (2026-10-06)

Les § 5.1 et 5.2 du brief sont faits : un ticket, un commit, un test, rouge sans le correctif ; le § 5.3 suit (voir « Intégration »). T17 à T27 sont corrigés ; T28 est réglé par le protocole (brief § 1, règles 10 à 14), une branche au nom neutre et des descriptions de PR sans lien de session. `e76ef6f` sort l'import des écrans du délai de chaque test (M4.7 à M4.9).

| Ticket | Constat | Ce qui change | Commit | Test |
|---|---|---|---|---|
| M4.7 | T17 | La matrice lit le R/R réalisé : gain moyen ÷ \|perte moyenne\|, NaN sans perte (`realizedRewardRisk`) | `41c1478` | `metrics-rr-realized` |
| M4.8 | T18 | Virgule acceptée ; prix hors de ]0 ; 1e6] ou du mauvais côté de la direction refusé avec un message ; à la restauration, le champ aberrant est retiré, le trade gardé | `d0e590d` | `metrics-trade-levels` |
| M4.9 | — | Largeurs ±1 σ par instrument, au pas de cotation : le 6E n'affiche plus 0,0 | `00b141d` | `metrics-sigma-widths` |
| M4.10 | — | « IC 90 % », « 95e » et bornes de classes en trois langues | `9fa636f` | `metrics-risk-labels` |
| M4.11 | — | `rateAfterStreak` exclut les trades nuls, comme le taux de base | `2db6137` | `metrics-series` |
| M5.5 | T19 | Une barre journalière (pas ≥ 1 440 min) est datée par sa date civile : +13 h, puis date UTC | `475fda9` | `metrics-context` |
| M5.6 | T20 | Les copies ne fusionnent qu'entre comptes différents, en équivalent standard | `2e26039` | `metrics-context` |
| M5.7 | T21 | « Après une perte » : le dernier trade du compte sorti avant l'entrée | `3fd403a` | `metrics-context` |
| M5.8 | — | Seuil de 90 séances jugé par fiche ; une barre invalide est écartée sans geler le régime | `6e396c6` | `metrics-context` |
| M5.9 | — | Régime et bande traduits, instrument nommé | `d0d459a` | `metrics-context-note` |
| M5.10 | T25 | Le contexte du jour n'est jamais lu sur une série de démonstration : une série réelle de la même racine, sinon un avis | `2a374e8` | `metrics-context-note` |
| M6.4 | T22 | Fenêtre de publication remise dans le bon sens (`inReleaseWindow`) | `56f209c` | `metrics-axis` |
| M6.5 | T23 | Permutation centrée sur la moyenne générale (option `centered`) | `56459ef` | `metrics-reading` |
| M6.6 | T24 | Un groupe d'un seul trade est rapproché de la moyenne | `cc2bca8` | `metrics-axis` |
| M6.7 | T25 | Une seule racine par lecture ; jamais le régime d'une série de démonstration | `722ff8b` | `metrics-axis` |
| M6.8 | T26 | « Pas assez de données » sous 30 journées distinctes | `e529080` | `metrics-reading` |
| M6.9 | — | Dénominateur « jours tradés » borné à la période ; `tailLoss` dans sa branche Pareto ; contrôle décalé sur une journée tradée ; `Segmented` et `aria-pressed` | `9f1ae53` | `metrics-reading`, `metrics-axis`, `context-axis-view` |
| M6.10 | T27 | Une journée se classe par sa propre fiche, arrêtée à la clôture de la veille | `cd46d83` | `metrics-reading` |
| M6.11 | — | Barres journalières des tests datées comme un CSV journalier (minuit UTC) | `35805f9` | `metrics-reading`, `metrics-axis` |
| M6.12 | T22 | « Proche » : l'entrée tombe dans la fenêtre de n'importe quelle publication à 3 h au plus, pas seulement de la plus proche | `f3bf601` | `metrics-axis` |
| M6.13 | — | Régime et bande de la vue par axe nommés comme le contexte du jour (es : « descenso ») | `a0ba0b9` | `metrics-context-note` |

**Décision T27.** Déléguée par l'ADMIN le 2026-10-06. Une journée D se classe par sa propre fiche, déjà arrêtée à la clôture de D−1 : pas de décalage de plus. La lecture de l'onglet et `comparableSet` lisent la même fiche ; `laggedValue` est retiré, `src/modules/metrique/axisReading.ts` porte la lecture.

**§ 5.3.** A6.12 et A6.13 suivent sur la même branche (`agent-metriques`, différentiels contre `tradeRisk` et `buildMetricsContext`). Trois ports nouveaux : `riskPerContract`, `activeSeriesId`, `regimeRules`. L'onglet Analyse et `day_context` choisissent la série par la même fonction, `contextSeries`.

**Intégration.** Une seule branche, `agentique/vague-2`, à fusionner dans `main` par un commit de fusion, sans squash : la fusion ferme #104 à #109. `npm run typecheck` vert, **958** tests verts (190 fichiers ; 864 après empilement des six PR), trois passages complets et un à `TZ=America/New_York` ; `npm run electron:compile` et `npm run build` verts.

## Couche agentique du trader — vague 3 : décisions de l'ADMIN (2026-10-06)

L'ADMIN a confirmé les sept décisions du § 7 de `docs/THESE-AGENTIQUE.md`. Deux se codent, les cinq autres se consignent ; `CLAUDE.md` § 3 et § 5 les portent. Un ticket = un commit = un test, rouge sans le correctif. `ninjatrader/CantoBridge.cs` ne change pas.

| Piste | Commits | Tests | Ce qui change |
|---|---|---|---|
| **A17 · Décisions** | `419c8d2` `b4b46da` | `agent-decisions` | A17.1 : `propose_order` refuse une ouverture qui enfreint une règle du trader (perte du jour atteinte, fenêtre d'un catalyseur majeur, instrument hors de la liste). Le renderer l'évalue comme la veille discipline (`traderRuleFor`, `detectRuleBreaches`) ; le process principal la relit (`parseTraderRule` : trois règles seulement, motif sur une ligne, borné) et refuse avant tout dialogue (`trader_rule`). Une réduction de risque passe toujours. A17.2 : la garde de l'agent et l'événement `prop_buffer` lisent la marge datée de la jauge K.04 (`planMargin`), latent négatif compris ; la marge de clôture seulement sans séance rejouée. |
| **A17 · Copieur** | `1013c75` `3660b56` | `copier-floor` | A17.4 : le plancher des suiveurs lit la même marge datée (`planMargin`), diminuée du latent négatif du suiveur vu par le pont (`AccountView.unrealizedPnl`, `RouteContext.unrealized`) ; la marge de clôture seulement sans séance rejouée. Le process principal relit la MAE et la MFE des trades des suiveurs (`coerceCopierSync`) : sans elles, sa jauge n'était pas celle du desk. Une réduction de risque passe toujours. A17.5 : le desk envoie les séances des suiveurs au process principal dès son ouverture, puis à chaque changement du journal (`startCopierSync`), onglet Copieur ouvert ou non. |

Échecs observés sans les correctifs :
- A17.1 : `expected { ok: true, resulting: 1, …(1) } to deeply equal { ok: false, …(2) }` ; le process principal soumettait l'ordre (`expected { status: 'sent', … } to match object { status: 'refused', … }`) ; `parseTraderRule` et `traderRuleFor` absents.
- A17.2 : `expected { liveBuffer: 1225, share: 0.49 } to deeply equal { liveBuffer: 175, share: 0.07 }` ; sur le cas 1.6, `expected 0.49 to be close to 0.07`.
- A17.4 : sur le cas 1.6, le suiveur recevait l'ordre (`expected [ { account: 'SimA', …(5) } ] to deeply equal []`) ; un latent de −2 000 $ sur une marge entière ne refusait rien ; la MAE du dernier trade disparaissait au passage dans le process principal (`expected { id: 't59', …(11) } to match object { mae: 1100 }`) ; le pont ne transmettait pas le latent des comptes.
- A17.5 : `startCopierSync` absent (`Cannot find package '@/store/copierSync'`).

**Décisions consignées sans code.** 3 : l'agent ne s'abonne à aucune donnée de marché. 4 : l'AddOn 2.3.0 se prépare à part et n'entre dans une Release qu'après compilation et essai sur Sim. 5 : aucune promesse de conformité avec une prop firm tant qu'elle n'a pas répondu par écrit ; le README n'en fait aucune. 6 : le modèle du Lab entre comme préréglage épinglé quand l'ADMIN donne son hôte. 7 : rien hors de `127.0.0.1`.

**Bilan.** P1 à P5 sont validées par la suite (`docs/THESE-AGENTIQUE.md` § 9) ; P5 attend l'hôte du modèle du Lab. Restent à voir dans le desk lancé : un client MCP réel, Visual sur Sim (A13.4), le refus `floor` d'un suiveur Sim en latent (A17.4).

**Constat de la vague, tranché et corrigé.** Le plancher des suiveurs du Copieur lisait la marge de clôture (`replay.buffer`, `src/engine/copier/router.ts:144`). L'ADMIN a étendu la décision 2 au Copieur (« il doit tout lire ») : A17.4 et A17.5. Deux écarts relevés en chemin sont corrigés avec : le process principal perdait la MAE et la MFE des trades des suiveurs (`src/engine/copier/sync.ts:104`), et ne recevait leurs séances que l'onglet Copieur ouvert (`src/modules/copieur/Copieur.tsx:74`).


## Publication de la 3.5.0 (2026-10-06)

L'ADMIN confie la sortie de la 3.5.0 et un README réagencé. En recapturant les plaques du README dans le desk anglais, deux libellés restés en français sont apparus ; ils sont corrigés avant le tag. Un ticket = un commit = un test.

| Piste | Commits | Tests | Ce qui change |
|---|---|---|---|
| **M5.11** | `718854b` | `fan-marks` | Les seuils de l'éventail Monte-Carlo s'écrivaient `ruine` et `objectif` dans toutes les langues (`src/design/charts/Fan.tsx:77`, `:85`, Métrique et Portefeuille). Ils suivent la langue du desk (`fanMarks`). |
| **R1** | `96214ff` | `portfolio-labels` | La source des poches (`SAISIE`, `PONT`, `PRIX`, `src/modules/portefeuille/Synthese.tsx:65`) et les motifs du moteur (`pont hors ligne`, `taux X/Y manquant`, `plan manquant`…, `Synthese.tsx:387`, `Portefeuille.tsx:523`) s'affichaient en français. L'affichage les traduit (`src/modules/portefeuille/labels.ts`) ; le moteur les garde tels quels, stables pour les outils de l'agent. |
| **R2** | — | — | README réagencé pour la 3.5.0 ; plaques recapturées en anglais sur le desk 3.5.0 avec `scripts/capture-readme.mjs` (phrase d'ouverture lue dans `CANTO_PHRASE`, jamais écrite). |

Échecs observés sans les correctifs :
- M5.11 : `TypeError: fanMarks is not a function`.
- R1 : `Cannot find package '@/modules/portefeuille/labels'`.

**Constat non corrigé.** Le jeu de démonstration étiquette ses séances en français dans toutes les langues (`plan respecté`, `sur-trading`, `src/engine/demo.ts:9`, `:96`). Ce sont des données, pas l'interface ; le README n'en montre pas.


## Onglet 09 · CRY — module crypto personnel (2026-10-09)

L'ADMIN ajoute au desk un onglet Crypto pour son usage personnel : le processus d'OpenMarket (chart, données, alertes, lecture et pilotage par un agent) dans le desk, au design de la 3.5.0. Spécification : `docs/ONGLET-CRYPTO.md`. Plan détaillé, ticket par ticket : `docs/ONGLET-CRYPTO-PLAN.md`. Décisions 8 à 10 : `docs/THESE-AGENTIQUE.md` § 7. Travail sur le poste de l'ADMIN, commits locaux sur `main`, sans PR. Un ticket = un commit = un test.

**Poste.** Node 22.23.3 installé (archive officielle, empreinte SHA-256 vérifiée), `npm ci`. Les deux liens symboliques du dépôt (`electron/calendar-bundle`, `electron/changelog`) sortaient en fichiers texte sous Windows sans mode développeur (`core.symlinks=false`) : remplacés localement par des jonctions, masquées par `skip-worktree`. Point de départ : typecheck vert, `electron:compile` vert, 975 tests sur 976. Seul rouge, préexistant : `tests/bridge-symlink.test.ts` (`EPERM` à la création d'un lien, mode développeur absent).

| Lot | Tickets | Objet |
|---|---|---|
| CRY0 | CRY0.1 à CRY0.4 | Spécification, design du desk, décisions et plan, onglet sur le rail éteint par défaut |
| CRY1 | CRY1.1 à CRY1.8 | Moteur pur : registre, REST, WebSocket, bougies des trades et CVD, indicateurs UTC, température, alertes ; historique jusqu'à 00:00 UTC de la veille (CRY1.8, ajouté en cours de lot) |
| CRY2 | CRY2.1 à CRY2.5 | Process principal : interrupteur, fetch gardé, sockets par venue, température, IPC |
| CRY3 | CRY3.1 à CRY3.4 | Renderer : réglages, port, store, flux en direct |
| CRY4 | CRY4.1 à CRY4.4 | Interface : précision des prix, cartes d'indicateurs partagées, onglet, banc de capture |
| CRY5 | CRY5.1 | Alertes signalées au desk et à l'agent |
| CRY6 | CRY6.1 à CRY6.2 | Dix outils `crypto_*`, agent embarqué et passerelle MCP |
| CRY7 | CRY7.1 | Recette et oracle OpenMarket |

**Écarts à la spécification du 9 octobre, consignés en CRY0.3.** Persistance en lignes de réglages `crypto.*` (comme `chart.indicators`) au lieu d'une version Dexie 10 ; pas de prix fixés dans le registre après relevé des métadonnées des exchanges ; évaluation par croisement (`CrossWatch`) à la sémantique de `ThresholdWatch` ; bougies live de Coinbase et Bybit construites dans le main depuis les trades.

**Écarts consignés pendant l'exécution.** Trois. Les deux premiers sont portés au § 5 de la spécification (paragraphe « Historique »), le troisième en renvoi aux § 10, point 2, et § 11, points 3 et 4 :
- Coinbase 4h garde 300 bougies (quatre pages d'une heure, regroupées par quatre : environ 50 jours), pas 500 (CRY1.2). Trois pages de plus si l'ADMIN veut 500.
- Coinbase n'envoie aucune bougie pour un seau sans trade, et le volume d'une bougie grossière peut différer un peu de la somme des bougies plus fines (CRY1.2). L'oracle BTC-USD l'a mesuré (ci-dessous).
- L'oracle de CRY7.1 lit OpenMarket par le seul outil `points`, en lecture seule, et non par `chart_read bars:50` (§ 11, point 3) ni sur un chart temporaire (§ 11, point 4). À l'ADMIN de juger (*CRY7.1*, sous « Écarts tranchés pendant l'exécution »).

### Livraison (2026-10-12)

Un ticket, un commit, un test, rouge sans le correctif. En fin de lot : `npm run typecheck`, `npm test`, `npm run build` et `npm run electron:compile`, lancés un à un (`npm run check` s'arrête au rouge toléré, avant `build`). Seul rouge à chaque fin de lot : `tests/bridge-symlink.test.ts` (`EPERM`). Aucune nouvelle dépendance ; `ninjatrader/CantoBridge.cs`, `allowedHosts()` et `tests/sources.test.ts` inchangés.

| Lot | Commits | Tests en fin de lot |
|---|---|---|
| CRY0 | `5030e4d` `03c6685` `e98d047` `ab54fc9` | 986 sur 987 |
| CRY1 | `f12c32d` `3e1d4a9` `ab70bef` `6892841` `11c9849` `84e61fd` `3bb3802` `8c7627e` `ec98885` `7b837c1` | 1 401 sur 1 402 |
| CRY2 | `7db3d71` `4badf97` `af5f8c7` `6247153` `9ec2dbb` `75146df` `b41e2fa` `aededd8` `ec4ed38` | 1 751 sur 1 752 |
| CRY3 | `baa7b29` `ea92591` `9b170d3` `b5bd09b` `86b225c` `d59a6d1` `e0fb19a` `bc68c47` `05a762c` | 1 907 sur 1 908 |
| CRY4 | `46decff` `0400483` `33483a9` `5c41b99` `4d2c7f4` `6a6b6b4` | 2 029 sur 2 030 |
| CRY5 | `8eaeae1` | 2 065 sur 2 066 |
| CRY6 | `b07995a` `81805d9` `cbad7fc` | 2 249 sur 2 250 |
| CRY7 | `0be61dc` `56f75c1` (CRY7.1 : documents et deux commentaires) | 2 249 sur 2 250 ; typecheck, `build` et `electron:compile` verts |
| Revue finale | `2b37d4a` `c54e764` `004267a` `d333031` `aa3fb7c` `585420a` `98ad268` `ff84ac1` `4ce8c52` `0637210`, puis ce relevé | 2 263 sur 2 264 ; typecheck, `build` et `electron:compile` verts |

`8c7627e` (CRY1.8) est un ticket ajouté en cours de lot, après la revue de CRY1.5. `4d2c7f4` corrige un test de CRY2.5 (dossiers temporaires laissés dans `%TEMP%`), relevé en CRY4.4.

### Échecs observés sans les correctifs

Tours de correction et correctifs d'avant revue : tests écrits d'abord, rouges sans le correctif, verts avec.
- CRY1.3 (`6892841`) : 16 rouges. Trade de quantité nulle gardé (`expected [ [+0, 'sell'], [2, 'sell'], …(4) ] to deeply equal [ [2,'sell'], [3,'buy'] ]`) ; bougie Coinbase à ouverture nulle, ou au plus bas au-dessus du plus haut, gardée ; refus de Bybit et de Binance lus comme des acquittements (`expected [ { kind: 'ignored' } ] to deeply equal [ { kind: 'error', …(1) } ]`) ; date `2026-02-30T00:00:00Z` acceptée ; détail d'erreur non borné.
- CRY1.5 (`3bb3802`) : 7 rouges. Une bougie au plus haut, plus bas ou clôture non fini effaçait les niveaux du lendemain (`expected [] to strictly equal [ { time: 1791504000, value: 120 } ]`) ; un VWAP était tracé sur une journée que la fenêtre ne couvre qu'à partir de 12:00 ; un seul segment de VWAP à minuit liquide (`expected [ 4 ] to deeply equal [ 2, 2 ]`) ; blanc des niveaux posé sur un instant fractionnaire.
- CRY2.1 (`4badf97`) : 6 rouges, dont le défaut lui-même : `crypto.json` en lecture seule, `{ "enabled": true }` restait sur le disque après `disable()` (`expected { enabled: true } to not deeply equal { enabled: true }`), et le lancement suivant rallumait le module sans dialogue.
- CRY2.3 (`9ec2dbb`) : 8 rouges. La socket d'une venue sans flux restait ouverte (`expected false to be true` sur `socket.closed`) ; une trame étrangère à l'abonnement marquait complète la bougie de 10:01 ; `onSuccess` était appelé après une page Bybit en erreur (`expected "onSuccess" to not be called at all, but actually been called 1 times`) ; le backoff repartait de 1 s à chaque ouverture (`expected 3 to be 2`) ; en 5m dès 17:35, pas de bougie de marge (`expected '500' to be '501'`).
- CRY2.4 (`75146df`, mineurs de CRY1.6) : 8 rouges. Liquidation datée du futur lointain retenue (`expected 1 to be +0`) ; montants absurdes comptés (`expected { long: 1e+308, …(2) } to deeply equal { long: 200, short: 200, …(1) }`) ; `Infinity` sorti de `totals`.
- CRY2.4 (`aededd8`) : `Expected: "wss://fstream.binance.com/market/ws/!forceOrder@arr"`, `Received: "wss://fstream.binance.com/ws/!forceOrder@arr"`. Mesuré en direct : le chemin sans route acceptait la connexion et n'envoyait rien (0 trame en 220 s ; `/market` : 3 trames en 4 s).
- CRY3.2 (`9b170d3`) : 11 rouges, et `tsc` (`has no exported member 'CryptoMarketDataPort'`, `'change24hPct' does not exist in type 'Quote'`) : le port retirait le volume acheteur, dont le CVD et `mergeLiveBar` ont besoin, et la variation sur 24 h.
- CRY3.3 (`86b225c`) : une écriture de l'agent avant la première ouverture de l'onglet aurait écrasé les quatre lignes `crypto.*` par les défauts. 13 tests, un par action ; preuve par six mutations, chacune rouge (le rapport ne relève pas de message d'échec).
- CRY3.3 (`d59a6d1`) : 7 rouges (`reloadSettings is not a function` ; `useCrypto` absent de `Metrique.tsx`) : après une restauration du coffre, la première écriture crypto aurait reposé l'état d'avant.
- CRY3.3 (`e0fb19a`) : 3 rouges. Une EMA de période 20.5 était acceptée et enregistrée, un patch 20.5 appliqué ; `readParams is not a function`.
- CRY3.4 (`05a762c`) : `expected 'import { lazy, Suspense, useCallback,…' to match /import \{ useCrypto \} from '@\/store\/crypto';/` : le flux léger, dont les alertes dépendent, ne partait qu'à l'ouverture de l'onglet.
- CRY4.3 (`33483a9`, mineur de CRY0.4) : `Error: canal fermé` en rejet non géré : `void requestEnable()` laissait échapper le rejet du process principal.
- CRY4.4 (`4d2c7f4`) : `expected true to be false` ; 25 dossiers `canto-crypto-runtime-*` laissés dans `%TEMP%` à chaque passage du fichier, 0 avec le correctif.
- CRY4.4 (`6a6b6b4`) : 5 rouges sur 6 tests nouveaux. La capture montrait la légende sous la puce `COINBASE · LIVE` (ancrage du CVD caché), les règles de température qui passaient à la ligne, et les lignes Source et Agent coupées au bord droit (« % » et « LIVE » sous la plaque verticale du châssis). Mesuré à part, avec un effet d'agent qui porte un mot de 60 signes : la colonne défilait à l'horizontale (`scrollWidth` 432 pour 299).
- CRY6.1 (`81805d9`) : 100 rouges, dont 47 × `expected "vi.fn()" to not be called at all, but actually been called 1 times` : une écriture crypto invalide ouvrait le dialogue de confirmation avant d'être refusée ; et `stale funding: expected false to be true` (Binance bloquée, température lue comme fraîche).

### Oracle OpenMarket (2026-10-12)

Fait en lecture seule, hors du desk (§ 10 de la spécification) : du côté d'OpenMarket, le seul outil `points` ; aucun chart créé, lu ni sélectionné, aucune alerte (`chart_read` demande l'onglet du chart ouvert, et `chart_workspace_select` change l'espace par défaut du compte). Du côté du desk, un script Node jetable, hors dépôt, charge `dist-electron/crypto/venues.js` (après `npm run electron:compile`), interroge par `fetch`, sans identifiant, les URLs de `historyRequests`, lit les réponses par `parseCandles` et ne garde que les bougies closes (`time + 3600 <= nowSec`). Le dépôt n'a pas changé. L'oracle refait donc le chemin du moteur, pas celui du desk lancé : voir « Limites de l'oracle », ci-dessous.

**BTC-USD Coinbase 1h (spécification § 11, point 3).**
- Fenêtre : 50 bougies, ouvertes du 2026-10-10 04:00 au 2026-10-12 05:00 UTC, la dernière close à 06:00. Desk lu à 06:27:34 UTC, OpenMarket à 06:27:38 (`last_trade_at`). La bougie de 06:00, entamée, est écartée des deux côtés.
- Méthode. Desk : `historyRequests('coinbase:BTC-USD', 60, nowSec)`, deux pages `granularity=3600`, 300 + 300 bougies, fusionnées par `aggregateBars(bars, 60, 1)` : 599 closes. OpenMarket : `points`, type `TRADE_SIDE_AGNOSTIC_AGG`, `exchanges ["COINBASE"]`, `rawSymbol BTC-USD`, `interval HOUR`, sur 56 h : 56 bougies ; transcription vérifiée sur le résumé de l'outil (56 bougies, volume total 4 882,4312, première et dernière clôtures). Comparaison sur les mêmes heures d'ouverture : O, H, L, C égaux si l'écart est sous un demi-pas (0,005 USD) ; volume à ±1 % de celui d'OpenMarket.
- Résultat : O, H, L et C égaux au pas sur 50 bougies sur 50. Volume à ±1 % sur 45 (31 identiques à 1e-6 près en relatif, 14 écarts de 0,0006 % à 0,72 %), hors tolérance sur 5 ; les cinq champs concordent sur 45 bougies. Partout où il diffère, le volume du desk est sous celui d'OpenMarket.
- Pires écarts de volume (desk / OpenMarket) : 2026-10-10 07:00 UTC −3,133 % (159,41206728 / 164,56851) ; 2026-10-11 00:00 −3,050 % (47,31950073 / 48,808048) ; 2026-10-11 12:00 −2,003 % (69,42958502 / 70,848451) ; 2026-10-11 13:00 −1,655 % (51,68108351 / 52,551046) ; 2026-10-10 09:00 −1,254 % (64,96972508 / 65,79472). Plus grands écarts dans la tolérance : 2026-10-10 18:00 −0,718 %, 2026-10-12 02:00 −0,417 %, 2026-10-11 14:00 −0,405 %. Aucun écart sur O, H, L ou C.
- Diagnostic : sur les 19 bougies qui ont un écart de volume, une relecture des bougies 1h de l'API Coinbase rend exactement le volume du desk (`parseCandles` ne change rien, et Coinbase ne les avait pas révisées). Les bougies d'une minute de Coinbase, sommées sur l'heure, diffèrent parfois de sa bougie 1h : 2026-10-11 12:00 UTC, somme des minutes 70,68509529, bougie 1h 69,42958502, OpenMarket 70,848451. L'écart vient de la source (bougie 1h de Coinbase contre agrégation des trades par OpenMarket) : c'est l'écart entre bougies grossières et fines consigné plus haut, pas le code du desk.
- Verdict, pour le chemin du moteur seulement : attendu tenu pour O, H, L et C ; pour le volume, tenu sur 45 bougies sur 50, et non sur les 50 que demande le § 11, point 3. Les bougies du desk lancé restent à comparer (recette, point 4).

**ONE Binance 1h, CVD (spécification § 11, point 4).** La spécification prévoyait un chart temporaire OpenMarket, avec l'accord de l'ADMIN. `points` lit les mêmes trades sans chart : l'oracle a été fait ainsi, en lecture seule, sans rien créer. À l'ADMIN de juger s'il tient lieu de la condition du plan.
- Fenêtre : 50 bougies, ouvertes du 2026-10-10 04:00 au 2026-10-12 05:00 UTC, la dernière close à 06:00. Desk lu à 06:27:38 UTC (`nowSec` 1791786458), OpenMarket `last_trade_at` 06:27:11. La bougie de 06:00, entamée, est écartée des deux côtés.
- Méthode. OpenMarket : deux appels `points`, type `TRADE_AGG`, `exchanges ["BINANCE"]`, `rawSymbol ONEUSDT`, `interval HOUR`, sur 56 h, `side BUY` puis `side SELL`, 56 bougies chacun (2026-10-09 23:00 à 2026-10-12 06:00) ; delta par bougie = BUY − SELL. Desk : `historyRequests('binance:ONEUSDT', 60, nowSec)`, une URL (`klines`, `interval=1h`, `limit=500`), 500 bougies, 499 closes ; delta par bougie = 2 × `buyVolume` − `volume`. 55 bougies communes ; les 50 plus récentes comparées par leur signe, zéro compris ; « presque nul » : |delta| sous 0,5 % du volume de la bougie.
- Résultat : signe égal sur 50 bougies sur 50. Les 499 bougies closes du desk portent toutes `buyVolume`. Aucune bougie à delta nul ou presque nul ; le plus petit, −0,79 % du volume, à 2026-10-12 01:00 (desk −210 933,6, OpenMarket −210 933). Unités : OpenMarket n'en donne pas, mais ses volumes sont en ONE : sur les 50 bougies, (BUY + SELL) / volume du desk = 1,0000 et BUY / `buyVolume` du desk = 1,0000. Plus grand écart absolu entre les deux deltas : 0,8 ONE (2026-10-10 14:00, −5 640 486,8 contre −5 640 486 ; 2026-10-11 04:00, −3 337 109,2 contre −3 337 110) : OpenMarket arrondit ses volumes à environ 8 chiffres significatifs.
- Verdict, pour le chemin du moteur seulement : attendu tenu, le delta par bougie de l'historique Binance a le même signe que celui d'OpenMarket sur 50 bougies. Ni la ligne CVD que le chart trace, ni les bougies poussées en direct ne sont relevées.

**Limites de l'oracle.**
- Chemin. Les deux oracles refont le chemin du moteur (`historyRequests`, `parseCandles`) sous le `fetch` de Node, dans un script hors dépôt. Ils ne passent ni par le `net.fetch` gardé du process principal, ni par la coupe par l'heure (`keepWindow`, `electron/crypto-feeds.ts:140`), ni par l'IPC, le port, la fusion du store (`mergeLiveBar`) ou les bougies que le chart trace. Le § 11, point 3, parle des « bougies closes du desk » : il n'est tenu que pour le moteur ; la recette, point 4, le refait sur le desk lancé.
- Flux. Hors des deux oracles : les bougies que le process principal construit à partir des trades (Coinbase `matches`, Bybit `publicTrade`) et le CVD qui en vient, ancré « depuis HH:MM » ; les bougies que le flux kline de Binance pousse en direct. L'oracle ONE compare le signe du delta par bougie des klines de l'historique (`2 × buyVolume − volume`, la formule de `cvdPoints`), pas la ligne cumulée que le chart trace. La recette, point 4, couvre une bougie construite à partir des trades de Coinbase, le premier point de son CVD et la ligne CVD tracée sur ONE ; rien ne couvre Bybit.
- Étendue. Une fenêtre de 50 bougies 1h (du 10 au 12 octobre), un marché par oracle : ni les autres timeframes (4h de Coinbase regroupé à partir de pages 1h, pagination en 1m et 5m), ni ONDO-USD, ni ZIGUSDT.

### Recette de l'ADMIN, desk lancé

Ce qui ne se vérifie qu'avec le desk lancé (`npm run desk:dev`) sur le poste. Journal du process principal : `logs/main.log` du dossier de données du desk. Connexions (PowerShell) : `Get-NetTCPConnection -State Established -OwningProcess (Get-Process electron).Id | Select-Object RemoteAddress, RemotePort`, à comparer aux adresses que `Resolve-DnsName` donne pour les huit hôtes de `CRYPTO_HOSTS`. Les points 3 et 4 du § 11 de la spécification sont l'oracle ci-dessus pour le chemin du moteur ; le point 4 de cette liste les refait sur le desk lancé.

1. **Interrupteur éteint** (spécification § 11, point 1). Geste : `crypto.json` absent du dossier de données, ou `{ "enabled": false }`, puis `npm run desk:dev`. Attendu : les onglets 01 à 08 comme en 3.5.0 ; Ctrl+9 ouvre 09 · CRY sur l'état vide et le bouton « Activer le module crypto » ; aucun outil `crypto_*` dans l'onglet Agent ; aucune connexion vers un hôte de `CRYPTO_HOSTS`, aucune sur le port 9443 ; aucune ligne `crypto <venue>:` au journal.
2. **Allumé** (spécification § 11, point 2). Geste : « Activer le module crypto », puis « Activer » dans le dialogue du process principal (Annuler par défaut). Attendu : les quatre lignes de « Marchés · 4 » allumées, avec un âge de mise à jour qui se renouvelle (ZIG peut rester sans trade plusieurs minutes et rester `live`) ; dans Source, Coinbase, Binance et Bybit `live` ; les six règles de « Température · Binance » remplies en 5 minutes au plus (funding en 60 s, largeur et open interest en 5 min) ; la légende du chart BTC-USD porte « CVD depuis HH:MM », en 1h à la première heure pleine : jusqu'à 60 min. La bougie entamée à l'ouverture du flux n'a pas de volume acheteur (`TradeBarBuilder`), l'ancrage paraît au premier trade de l'heure suivante, onglet ouvert ; quitter l'onglet ferme le flux et l'attente reprend au retour. Son absence avant cette heure n'est pas un échec.
3. **Un appel réel par `net.fetch`** (CRY2.2 : la correspondance « Redirect was cancelled » et le `signal` n'ont été vérifiés qu'avec le fetch de Node). Geste : module allumé, BTC-USD en 1h. Attendu : la puce passe de « Historique » à « Coinbase · direct », Source donne le nombre de bougies et la période, la légende porte date, heure et O H L C ; aucune ligne `crypto coinbase: historique … refusé` au journal. Changer vite de timeframe deux ou trois fois : le chart montre la dernière demande.
4. **Bougies du desk contre OpenMarket** (spécification § 11, points 3 et 4, refaits sur le desk lancé : voir « Limites de l'oracle »). Geste : module allumé, onglet 09 ouvert ; chaque lecture `crypto_chart_read` par l'agent du desk ou un client de la passerelle MCP, et dans la même heure `points` d'OpenMarket aux paramètres de l'oracle ci-dessus ; les lignes de `bars` vont de la plus récente à la plus ancienne, et la première, entamée, est écartée. (a) BTC-USD 1h, `{ "bars": 51 }`, lu dans l'heure même où le flux 1h s'est ouvert ; lu plus tard, `{ "bars": 52 }`, et la bougie ouverte une heure avant « CVD depuis HH:MM » est écartée aussi : entamée à l'ouverture du flux, elle garde le volume partiel de l'historique (spécification § 5, « volume inchangé »). (b) Onglet laissé sur BTC-USD 1h, sans coupure du flux, jusqu'à l'heure qui suit la première heure pleine (celle de « CVD depuis HH:MM ») : `{ "bars": 3 }`, contre `points` `TRADE_SIDE_AGNOSTIC_AGG`, puis `TRADE_AGG` `side BUY` et `side SELL`. (c) ONE 1h, `{ "bars": 52 }`, contre `points` `TRADE_AGG` `side BUY` et `side SELL`. Attendu : (a) sur les 50 bougies closes, O, H, L, C égaux au pas et volume à ±1 %. Une bougie hors tolérance ne compte comme écart de source que si son volume égale celui de la bougie 1h de Coinbase pour cette heure (`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600`, lecture publique, sans identifiant) ; sinon, c'est un défaut du desk. Relever le nombre de bougies hors tolérance, contre 5 sur 50 pour l'oracle ; (b) la bougie de la première heure pleine, construite à partir des trades, porte `buy`, ses O, H, L, C sont égaux au pas et son volume à ±1 % de ceux d'OpenMarket, le signe de `2 × buy − v` est celui de BUY − SELL (sur ONE, le `side BUY` d'OpenMarket égale le volume acheteur des klines, côté de l'agresseur), et sa colonne CVD (`i_cvd:cvd` avec les indicateurs par défaut) égale `2 × buy − v` à l'arrondi près (premier point du cumul) ; (c) sur les 50 dernières bougies closes, la colonne CVD varie depuis la bougie d'avant (la ligne suivante) du signe de BUY − SELL.
5. **WebSocket réel vers les trois venues.** Geste : module allumé, laisser tourner 15 minutes, puis couper le réseau 40 s et le rendre. Attendu : les trois voyants `live` ; à la coupure, `stale` après 30 s sans activité, puis `reconnecting` ; au retour, `live` sans geste ; au journal, des lignes `crypto <venue>:` en nombre borné.
6. **Liquidations sur la route `/market`.** Geste : module allumé, marché actif, 15 minutes. Attendu : une connexion vers l'adresse de `fstream.binance.com` ; « Liq. 1 h · long » ou « · short » au-dessus de 0 $, et « liquidations depuis HH:MM » sous la température ; par l'agent, `crypto_temperature` rend `lowerBound: true`. Un total à 0 $ avec une heure fraîche pendant plus de 10 minutes de marché agité signale une socket muette (mineur ouvert de CRY2.4).
7. **Alertes en toast et dans `desk_events`** (spécification § 11, point 5). Geste : « + Ajouter » sous Alertes : une alerte de prix sur BTC-USD à un pas du dernier prix, dans le sens du mouvement ; une alerte de funding médian à un pas de la valeur affichée. La première lecture pose le côté sans alerter ; le funding est relevé toutes les 60 s, il peut falloir plusieurs relevés. Attendu : un toast `warn` à chaque franchissement ; par l'agent du desk, `desk_events` rend deux événements `crypto_alert` (identifiant, genre, niveau, valeur arrondie à la précision affichée).
8. **Passerelle MCP** (spécification § 11, point 6). Geste : onglet Agent, passerelle démarrée sur `127.0.0.1:47118`, *Copier le jeton MCP*, un client MCP de l'ADMIN connecté ; d'abord l'interrupteur d'écriture laissé éteint (défaut), puis « écriture autorisée (notes, annotations, module crypto) » coché dans Agent IA › Options › Agents externes · MCP et le client reconnecté. Attendu : `crypto_chart_read` rend le marché, le timeframe, le dernier prix et la dernière bougie de l'écran. Écriture éteinte : `crypto_indicator_set` manque à `tools/list`, et son appel rend `isError` « Écriture désactivée dans CΛNTO : le trader doit l’autoriser (Agent IA › Options › Agents externes · MCP). » (CLD11). Écriture cochée : `crypto_indicator_set` `{ "action": "add", "indicator": "ema", "params": { "period": 200 } }` ajoute EMA 200 au chart, sans dialogue (`orchestratorAllowWrite`, `CLAUDE.md` § 5) ; le même appel par l'agent du desk ouvre le dialogue de confirmation du desk. Module éteint : les outils `crypto_*` disparaissent de `tools/list` et sont refusés à l'appel ; rallumé, ils reviennent dans `tools/list` après au plus 5 s (cache du relais), vus du client après sa reconnexion (`listChanged` faux).
9. **Fermeture de la fenêtre (`window-all-closed` → `shutdown()`).** Geste, Windows : module allumé, fermer la fenêtre du desk, puis relancer `npm run desk:dev`. Attendu : plus aucune connexion vers `CRYPTO_HOSTS` une fois la fenêtre fermée ; au lancement suivant, le module est allumé sans dialogue (l'interrupteur n'a pas bougé) et les flux repartent. Sous Windows, `window-all-closed` appelle `shutdown()` puis `app.quit()` (`electron/main.ts:519-525`) : le process sort, et les connexions tombent quoi que fasse `shutdown()`, qui n'écrit rien au journal. Ce point ne vérifie donc que la persistance de l'interrupteur ; `shutdown()` lui-même ne l'est que par le point 10 (macOS), encore ouvert.
10. **macOS, `activate`.** Geste, sur un Mac seulement : module allumé, fermer la fenêtre (le process reste), puis cliquer l'icône du Dock. Attendu : fenêtre fermée, `lsof -i -P -n | grep -i electron` ne montre plus de connexion vers les hôtes crypto ; à la réouverture, fenêtre recréée, flux et température repartis au premier abonnement du renderer. Sans Mac au poste, ce point reste ouvert.

### Écarts tranchés pendant l'exécution

Chaque choix laissé ouvert par une fiche, ou soulevé par une revue, a été tranché pendant l'exécution. Repris ici, par ticket, avec ce qu'il coûte s'il est faux.

*Plan (avant CRY0.4).*
- Les fiches de ticket sont extraites du plan par un script local sur les titres `### Tâche CRYx.y`. Coût : nul (25 fiches non vides vérifiées).
- CRY6.1 répare tout test que les dix entrées `crypto_*` du catalogue font tomber, dont l'attente de `tests/mcp-server.test.ts:569` (exclure `crypto_*` tant que la garde du process principal manque) et les têtes de `READ_OUTPUT_HEADS` ; CRY6.2 garde la garde du process principal et la liste module allumé. Coût : un léger recouvrement entre 6.1 et 6.2.
- `createCryptoTools(ports)` rend toujours les dix définitions, même sans port crypto (leur `run` refuse) : `DESK_TOOLS` égale toujours `DESK_TOOL_KINDS`. Coût : nul.
- Les assertions de bandes d'hystérésis de CRY1.7 comparent par `toBeCloseTo` (0,002 × 0,001 n'est pas exact en binaire). Coût : nul.
- Les tests jsdom de CRY4.1 et CRY4.3 simulent `@/modules/visual/chartBox` et `ResizeObserver` : un élément jsdom n'a pas de taille, le `Chart` n'y démarrerait jamais. Coût : nul.
- CRY4.4 cherche Edge (`EDGE_PATH` ou le chemin standard). Coût : un autre navigateur sans interface si Edge manque (arrivé en CRY4.4 : Chrome).
- CRY2.5 remplace les types littéraux de CRY0.4 dans `src/lib/desk.ts` par ceux du moteur. Coût : nul.
- Effort d'exécution et de relecture renforcé sur CRY2.3, CRY2.5, CRY3.4, CRY4.3, CRY6.1 (exécution), CRY2.3, CRY2.5, CRY6.1, CRY6.2 (relecture) et la revue finale. Coût : du temps de calcul de trop, ou une reprise s'il manquait.

*CRY0.4.*
- `tests/tabs.test.ts` lit `Shell.tsx` (expression du raccourci) : gardé, `TABS[8]` fige la correspondance et une vraie touche demanderait de rendre tout le Shell. Coût : une régression du raccourci passerait inaperçue.

*CRY1.1.*
- Le `protocol` de `cryptoHostAllowed` n'était tenu que par le typage : CRY2.2, qui porte la garde réseau, ajoute le contrôle à l'exécution et son test. Coût : une petite retouche croisée.

*CRY1.2.*
- Coinbase 4h : la page la plus récente finit à la fin de la 4h entamée ; la plus ancienne bougie de 4h est complète (vérifié sur l'API). Coût : une ligne à revenir si Coinbase refuse un jour un `end` futur.
- Coinbase 4h : quatre pages, 300 bougies (environ 50 jours), pas 500 ; écart à la spécification. Coût : trois pages de plus si l'ADMIN veut 500.
- CRY1.3 met à jour la liste d'exports figée de `tests/crypto-venues-rest.test.ts`. Coût : nul.

*CRY1.3.*
- Côté du trade strict : un trade dont le côté Coinbase (`side`) ou Bybit (`S`) n'est pas exactement `buy`/`sell` ou `Buy`/`Sell` est écarté. Coût : une ligne à revenir.
- Quatre mineurs portent la suite (les volumes nourrissent les bougies, `ticker.last` les alertes, un refus d'abonnement paraîtrait vivant) : tour de correction immédiat (prix et quantités positifs, 0 ≤ volume acheteur ≤ volume, cohérence OHLC aussi dans `parseCandles`, refus Bybit et Binance en `error`, heure Coinbase ISO avec `Z`, détail borné à 200 signes). Coût : un tour de plus s'il était inutile.

*CRY1.4.*
- Choix ouverts acceptés : garde du trade invalide dans `push`, plafond dans chaque branche de la fusion, une fusion partielle garde le volume acheteur de la dernière bougie, un blanc après l'ancre laisse la somme du CVD inchangée. Coût : quelques lignes chacun.

*CRY1.5.*
- Jamais un chiffre plausible et faux : un jour UTC n'est calculé que si la fenêtre couvre son début (`bars[0].time <= début du jour`), sinon des blancs, pour le VWAP comme pour les niveaux ; tour de correction immédiat. Coût : des blancs sur le jour le plus ancien seulement, une fois CRY1.8 en place.
- Ticket nouveau CRY1.8 avant CRY2 : l'historique remonte au moins à 00:00 UTC de la veille en intraday ; § 5 de la spécification amendé (« 500 bougies, ou depuis 00:00 UTC de la veille si c'est plus »). Coût : une dizaine de requêtes Coinbase en 1m à l'ouverture du chart.
- CRY2.3 garde max(500, bougies depuis 00:00 UTC de la veille), pas 500 tout rond ; CRY3.4 fusionne avec un plafond au moins égal (3 000), jamais le défaut de 1 000. Coût : des ancrages faux si c'était oublié.

*CRY1.8.*
- Coinbase 1m : 5 à 10 pages selon la formule (le « 7 à 10 » de la fiche était faux avant 06:00 UTC) ; un `nowSec` qui n'est pas une date ne donne aucune URL, quelle que soit la venue. Coût : nul.

*CRY1.6.*
- Choix d'interprétation acceptés : événements antérieurs au départ comptés, lignes de largeur illisibles hors du dénominateur, point d'open interest avec une heure finie et un `sumOpenInterest` positif, heure de l'événement `o.T` sinon `E`, flux `forceOrder` brut seulement, paramètres de l'appelant crus. Coût : une ligne chacun.

*CRY1.7.*
- Choix ouverts acceptés : un libellé trop long écarte le tracé, un niveau hors domaine rend `bad_level`, le premier identifiant gagne, prix de tracé > 0, export `CRYPTO_ALERT_KINDS` en plus, bande sur |niveau|, `sanitizeCryptoChart` tout ou rien sur marché, timeframe et liste. Coût : une ou deux lignes chacun.

*CRY2.1.*
- Écriture de `false` impossible : le fichier est supprimé (absence = éteint), une ligne distincte au journal si la suppression échoue aussi ; test du fichier en lecture seule ; cause d'un abonné en échec journalisée, réponses de dialogue mal formées figées, texte du dialogue qui dit que le choix vaut pour les lancements suivants (trois langues). Tour de correction immédiat. Coût : un tour.

*CRY2.2.*
- `Retry-After` plafonné à 3 600 s, backoff doublé une fois par épisode de pause (pas par 429 en vol) ; fait en CRY2.3, premier consommateur concurrent. Coût : une ligne chacun.
- `credentials: 'omit'` dans le fetch et `ArrayBuffer.isView` pour les morceaux du corps (CRY2.3). Coût : une ligne chacun.

*CRY2.3.*
- Tour de correction : socket refusée qui restait ouverte et « vivante », confirmation d'un abonnement par sa propre trame ou son accusé, bougie de marge dès que `needed >= HISTORY_BARS` (le plan disait `>`, contredit : la fenêtre 17:35–17:40 UTC en 5m restait sans marge), `onSuccess` après une lecture réussie seulement, backoff remis seulement après 30 s de connexion vivante (contre le plan), trois tests manquants, lignes 430 et 449 du plan alignées. Coût : un tour.
- Un abonnement de bougies ajouté sur un flux déjà actif et accusé n'est confirmé que par sa première trame : jamais une bougie complète à tort. Coût : une bougie incomplète de plus sur un marché peu liquide.

*CRY2.4.*
- Deuxième exécution depuis `9ec2dbb` : la première, interrompue, n'avait laissé ni commit ni rapport. Coût : nul.
- La porte reste 429/418 seulement ; 403 et 5xx répétés sont bornés par la cadence (60 s, 5 min) ; l'hôte de la température ne journalise une panne de source que quand son détail change. Coût : quelques lignes de journal, ou une panne durable plus discrète.
- Pas de marque de trou sur `since` après une longue coupure : le total reste un minorant (`lowerBound: true`). Coût : un total sous-estimé après une longue coupure, toujours étiqueté minorant.
- Chaque émission recalcule les liquidations par `window.totals(now())` ; les trames `forceOrder` déclenchent au plus un recalcul par seconde. Coût : nul.
- Un relevé en échec ou illisible laisse la valeur et l'heure d'avant ; open interest fusionné par symbole ; une requête en vol par source ; une réponse arrivée après `stop()` est écartée. Coût : une ligne chacun.
- `current()` nul avant `start()` et après `stop()`, lecture vide juste après `start()`, rien d'émis avant un premier relevé. Coût : un changement trivial si CRY2.5 voulait une émission immédiate.
- `FORCE_ORDER_URL` passe sur la route `/market` (`venues.ts`, `.d.ts`, test de CRY1.3, spécification, plan). Coût : une ligne à revenir si Binance rétablit le chemin sans route.
- Choix ouverts acceptés : un relevé en échec n'émet rien, un 418 REST ferme la socket des liquidations, pas de rattrapage d'un tour manqué, un échec après `stop()` informe encore la porte, une trame illisible déclenche au plus un recalcul, une émission qui lève est journalisée une fois par panne. Coût : une ligne chacun.

*CRY2.5.*
- Voyant `blocked` dès que la porte bloque la venue (un 418 survit à éteindre puis rallumer), sinon l'état des flux. Coût : nul.
- `shutdown()` ferme les flux et arrête la température sans toucher l'interrupteur ; le premier `temperature()` ou `subscribe()` suivant les relance (macOS garde le process et recrée la fenêtre). Coût : quelques lignes si c'était inutile.
- Journal de la température préfixé `température · ` ; nouveaux faux de test sous `tests/helpers/`. Coût : nul.
- `electron/crypto-socket.ts` retouché hors de la carte des fichiers (`terminate()` d'une socket morte, `FRAME_MAX` pour `maxPayload`), comme la note de CRY2.3 l'exigeait. Coût : nul.
- Mis de côté pour l'ADMIN : un 418 de la température montre Binance `blocked` aussitôt, mais la socket Binance du flux déjà ouverte tourne jusqu'à sa prochaine reconnexion. Coût : un voyant bloqué au-dessus d'un prix ONE qui bouge encore. Corrigé en `aa3fb7c` (revue finale) : le 418 coupe aussi cette socket.
- Mis de côté pour l'ADMIN : un rechargement du renderer laisse ouverts les abonnements de la page d'avant jusqu'à l'extinction ou la fermeture de la fenêtre (même chose que le flux NinjaTrader). Coût : des flux orphelins après un rechargement sur plantage.
- Une bougie `final: true` part aussitôt, hors de l'espacement de 250 ms des bougies partielles. Coût : un message IPC de plus par clôture.

*CRY3.1.*
- Les lignes `crypto.*` ne passent que par la restauration v1, comme `chart.indicators` : l'export v2 n'en porte pas. Coût : des réglages crypto perdus à un export v2 si l'ADMIN attendait autre chose.

*CRY3.2.*
- Refus d'abonnement livré en `status error` dans une microtâche après le retour de `subscribe` (comme nt8) ; cotation demandée avec un timeframe hors registre refusée. Coût : une ligne chacun.
- Le port porte ce dont le store a besoin : volume acheteur des bougies quand il est fini et dans [0, volume], historique et direct ; `change24hPct` des cotations ; `CryptoMarketDataPort` exporté ; une ligne ou un événement qui n'est pas un objet est écarté sans lever. Tour de correction. Coût : un tour.
- `dedupeBars` générique dans `src/engine/marketdata/port.ts`, hors de la carte des fichiers. Coût : nul.

*CRY3.3.*
- Journal de l'agent : le nom de l'outil de CRY6.1 qui porte l'action, et un effet court en trois langues. Coût : un renommage si CRY6.1 voulait une autre forme.
- `load()` répare une alerte de prix restaurée dont le marché manque à la watchlist en remettant ce marché en mémoire ; jamais d'alerte retirée, aucune écriture au chargement. Coût : une entrée de watchlist de plus après une restauration atypique.
- Chaque écriture valide, change l'état dans le même tour, puis enregistre la valeur assainie ; un `setSetting` rejeté n'échappe jamais en rejet non géré. Coût : nul.
- Réserves 1 à 3 acceptées : un `setSetting` rejeté rejette l'action après le changement d'état (comme `chart.indicators`), `INDICATORS_MAX` exporté, refus en plus (`not_in_watchlist`, `unknown_drawing`, `unknown_alert`, `bad_mode`, `bad_params`). Coût : de petits changements d'API.
- Perte de données : chaque écriture attend d'abord une lecture des réglages, unique et partagée ; si elle échoue, `not_ready`, et l'écriture suivante relit. Correctif d'avant revue. Coût : un tour.
- `settingsRead` champ d'état public ; `not_ready` masque le vrai refus tant que la base est illisible. Coût : nul.
- Perte de données : une restauration du coffre laissait le store sur ses réglages d'avant ; `reloadSettings()` et son appel dans la liste de `Metrique.tsx`. Second correctif d'avant revue. Coût : un tour.

*CRY3.4.*
- Le flux léger part quand le store voit `enabled` passer à vrai et s'arrête quand il repasse à faux ; un abonnement refusé module éteint n'est jamais relancé, le store réabonne à l'allumage suivant. Coût : nul.
- Données en direct vidées à tout changement de marché ou de timeframe, quelle qu'en soit l'origine, avant le réabonnement différé. Coût : nul.
- Faux de test complétés sans assertion changée ; abonnement refusé module allumé repris au prochain allumage ou changement ; bascule du CVD Binance différée de 300 ms ; fermeture du chart ou extinction vide les données du flux ; historique en échec : bougies en direct seules, code dans `chartError`. Coût : de petits changements.
- Le flux léger est permanent (spécification § 5) : `load()` du store crypto part au démarrage du desk (`App.tsx`, sans attendre, sans ligne de boot), l'onglet garde son appel idempotent. Correctif d'avant revue. Coût : un tour.
- Une écriture de l'agent confirmée par l'opérateur qui change le marché ou la watchlist laisse les flux du desk suivre : l'abonnement est celui du desk, pas de l'agent (décisions 8 à 10, `CLAUDE.md` § 5). Coût : une décision de l'ADMIN s'il le lit autrement.

*CRY4.2.*
- Les cartes d'indicateurs affichaient le paragraphe du Lab, faux pour le catalogue crypto : prop `footer` optionnelle (CRY4.3), Visual inchangé. Coût : une prop optionnelle.
- Les textes crypto remplacent aussi ceux des indicateurs partagés écrits pour le Nasdaq (EMA « scalpers Nasdaq », ATR « en points »). Coût : quelques lignes de texte.

*CRY4.3.*
- Décisions de la fiche : pied de cartes, textes EMA et ATR, catalogue en 1d et CVD Binance, copie mémorisée des bougies, codes en clair, chaque action rattrapée, activation et extinction en cours, âge de la mise à jour du ticker, aide du funding, `onHover` stable, couleur de repli `rgb(169,150,224)` hors hexadécimal, « non évaluée », règles de l'étiquette et de la puce. Coût : de petits changements d'interface chacun.
- Lectures de l'exécution acceptées : « non évaluée » sur les alertes armées seulement ; « CVD depuis HH:MM » seulement quand la ligne `cvd` est visible ; un indicateur hors du catalogue offert n'a pas de carte et n'est pas compté (gardé en réglage) ; lignes de marché sur deux rangs ; « × » pour supprimer une alerte ; chart simulé dans `tests/crypto-tab.test.ts` ; textes des codes partagés dans `AlertModal.tsx` ; `CryptoSide.tsx` long. Coût : une ligne chacun.

*CRY4.4.*
- Edge absent, Chrome présent : `capture-crypto.mjs` essaie `EDGE_PATH`, `CHROME_PATH`, puis les chemins standard d'Edge et de Chrome. Coût : nul.
- Fixtures du banc : réponses REST publiques réelles de la fenêtre du 9 octobre, sous `scripts/harness/fixtures/`, rien d'importé par l'application. Coût : quelques centaines de Ko.
- Écarts du banc acceptés (dossier de profil temporaire, `iframe` qui retient `load`, CSP de la page du banc, `scripts/harness` dans le `tsconfig`, plaque `--scroll end` en plus) ; fixtures relevées le 11 octobre pour la fenêtre close le 9 (600 bougies BTC-USD 1h). Coût : nul.
- Preuve visuelle : les défauts que la capture montre sont corrigés avant de clore CRY4.4 (légende sous la puce, règles de température qui débordent, Source et Agent coupés au bord). Coût : un tour.
- `.side { padding-right: 12px }` dans `crypto.module.css` : « % » et « LIVE » passaient sous la plaque verticale du châssis. Coût : une ligne à retirer si l'ADMIN préfère la marge de Visual.
- Libellés courts de la température (« Liq. 1 h · long/short », « OI 24 h · BTC/ETH ») : les longs ne tiennent pas dans la colonne ; § 7 aligné en CRY7.1. Coût : un changement de texte.

*CRY5.1.*
- Décisions de la fiche : une seule règle d'évaluabilité, dans `src/engine/crypto/alerts.ts`, Binance `blocked` ou `stale` bloque les alertes de température ; évaluation sur le flux léger du store ; cycle de vie des croisements ; effets du franchissement, enregistrement en échec compris ; genre ajouté au tuple de `electron/agent/catalog.d.ts` ; conversions par les aides de CRY1.7. Coût : de petits changements.
- `fresh` booléen ou fonction ; `alertEvaluability` lit aussi les tickers (« aucun prix reçu ») et rend un code ; textes d'alerte déplacés dans `src/lib/cryptoAlertText.ts` (le store n'importe pas `src/modules`) ; `docs/PROTOCOLE-AGENT.md` et `docs/BRIEF-AGENTIQUE-VAGUE-2.md` à jour. Coût : de petits changements.
- Mis de côté pour l'ADMIN : un franchissement pendant l'écran de verrouillage d'ouverture fait quand même un toast et un événement ; une base de réglages illisible fait sortir `setAlertState` sans écrire ni prévenir (une alerte `once` reste armée à l'écran). Coût : une petite garde chacun.

*CRY6.1.*
- Décisions de la fiche : validation avant le port, rejet d'enregistrement → `persist_failed`, évaluabilité partagée, aucun `NaN` vers l'agent, valeur de `crypto_alert` arrondie dans `cryptoAlerts.ts`, l'agent lit ce que le trader a ouvert, port du store et garde MCP laissés à CRY6.2. Coût : de petits changements.
- `CryptoLineView.unit` (`price` ou `other`), codes de refus en plus (`nothing_to_change`, `bad_action`, `bad_id`, `bad_params`, `read_failed`, `write_failed`). Le contrôle sémantique après la confirmation, accepté d'abord, a été repris par le tour de correction ci-dessous. Coût : de petits changements.
- L'onglet Agent listait les 33 outils module éteint : CRY6.2 fait suivre l'interrupteur à cette liste. Coût : nul.
- Tour de correction : le contrôle pur de chaque écriture crypto passe dans `executeDeskTool`, après la garde de l'interrupteur et avant `confirmFn` (et reste dans `run`) ; description de `crypto_alert_list` (`reason.code`) ; `crypto_temperature.stale` suit aussi l'état de Binance. Coût : un tour.
- Restent après la confirmation les refus qui dépendent de l'état (`market_has_alerts`, `not_in_watchlist`) ; la grille du pas, d'abord laissée là, passe avant le dialogue depuis `004267a` (revue finale) ; `write_disabled` précède le contrôle pour l'orchestrateur ; `crypto_temperature` lit `port.status().venues`. Coût : de petits changements.

*CRY6.2.*
- Mis de côté pour l'ADMIN : l'orchestrateur WebSocket ne garde les outils `crypto_*` que côté renderer (`desk.describe` suit l'interrupteur, `executeDeskTool` rend `crypto_disabled`) ; le process principal ne relit pas l'interrupteur comme le fait maintenant la passerelle MCP. Coût : une garde dans `electron/orchestrator.ts` si l'ADMIN veut le double verrou.
- Une écriture de l'agent qui change marché, watchlist ou CVD Binance laisse le desk ouvrir les flux correspondants ; par la passerelle ou l'orchestrateur, elle passe derrière `orchestratorAllowWrite`, sans dialogue, comme `CLAUDE.md` § 5 le permet. Signalé à l'ADMIN. Coût : une reformulation du § 5, ou moins d'outils d'écriture.

*CRY7.1.* L'oracle passe par `points` d'OpenMarket, en lecture seule, sans `chart_read` ni `chart_workspace_select` (ci-dessus). Coût : les deux oracles à refaire si l'ADMIN tient au plan, BTC-USD par `chart_read bars:50` et ONE sur un chart temporaire.

### Revue finale (2026-10-12)

Revue de `e98d047..56f75c1`, puis une vague de correctifs, chacun sous le ticket qui porte le code ou le texte. Chaque changement de comportement a son test, rouge sans le correctif.
- `2b37d4a` (CRY4.3) : le chart revenait aux 160 dernières bougies à chaque bougie du direct (jusqu'à toutes les 250 ms par série) et renvoyait toute la série : le trader ne pouvait ni reculer ni zoomer. `Chart` ne pousse plus que la dernière bougie (`update`) quand la série prolonge la précédente, et ne recadre qu'une série neuve (`tests/crypto-chart-live.test.ts`). Les lignes d'indicateurs restent recalculées à chaque bougie.
- `c54e764` (CRY6.1) : les lignes de `bars` de `crypto_chart_read` venaient en fin de résultat, de la plus ancienne à la plus récente ; coupé par `fitHistory`, qui en garde le début (8 000 signes pour un modèle local, 60 000 sinon), le résultat perdait les plus récentes. Elles vont désormais de la plus récente à la plus ancienne (description, `docs/PROTOCOLE-AGENT.md`, recette, point 4).
- `d333031` (CRY6.1) : les descriptions des cinq `crypto_*_set`, que `desk.describe` sert aussi aux clients externes, leur promettaient une confirmation du trader qu'ils n'ont pas. Elles disent les deux portes : dialogue pour l'agent du desk, *écriture autorisée* sans dialogue pour la passerelle et l'orchestrateur ; `docs/PROTOCOLE-AGENT.md` de même.
- `004267a` (CRY6.1) : `onStepGrid` passe dans le moteur (`src/engine/crypto/indicators.ts`) ; le contrôle de `crypto_indicator_set` lit la grille du pas avant tout dialogue (`ema` 20.5 : `bad_params`, sans dialogue).
- `aa3fb7c` (CRY2.5) : un 418 du relevé de température coupe aussi la socket de flux Binance déjà ouverte (`CryptoFeedHost.cut`, appelé par la porte).
- `585420a` (CRY4.3) : l'aide d'une alerte de prix dit le pas de cotation du marché, au lieu d'un nombre de décimales que rien ne contrôle.
- `98ad268` (CRY2.1) : `tests/crypto-switch.test.ts` efface ses dossiers temporaires (42 laissés à chaque passage, 0 avec le correctif).
- `ff84ac1` (CRY6.2) : les consignes de la passerelle parlent du module crypto (outils selon l'interrupteur, écritures sans dialogue, reconnexion). Le cache de 5 s et `listChanged` faux restent.
- `4ce8c52` (CRY6.2) : l'interrupteur d'écriture des agents externes nomme le module crypto (« écriture autorisée (notes, annotations, module crypto) »).
- `0637210` (CRY7.1) et ce relevé : spécification (§ 5, une bougie de plus quand le seau bascule pendant le chargement ; § 10 et § 11, renvoi à l'oracle par `points` ; § 11, point 6, sans dialogue par la passerelle), plan annoté, recette (points 4, 8 et 9), coût de la règle R6, vérifications de CRY7, trois échecs reformulés, mineurs remis à jour.

Restent à l'ADMIN : l'oracle par `points` à juger, et les points mis de côté (orchestrateur sans relecture de l'interrupteur crypto dans le process principal, abonnements orphelins après un rechargement du renderer, écran de verrouillage et alertes, `setAlertState` muet).

Relecture de la vague (27 points sur 27 traités, aucune casse critique ou importante), deux arbitrages :
- `2b37d4a` vit dans `Chart.tsx`, partagé avec Visual : le suivi NinjaTrader de 02 · VIS garde lui aussi sa vue pendant le direct (plus de retour aux 160 dernières bougies), et une bougie remplacée plus loin que l'avant-dernière, avec les mêmes objets, n'atteindrait le chart qu'au recadrage suivant. Écart à « Visual inchangé », laissé à l'ADMIN. Coût : une prop d'activation réservée à l'onglet crypto si Visual doit rester exactement comme avant.
- `aa3fb7c` est gardé, bien que le point eût été mis de côté : la porte ne connaissait déjà qu'une venue `binance`, et le voyant et le flux disent désormais la même chose. Coût : le prix de ONE figé jusqu'au redémarrage après un bannissement qui ne viserait que l'API futures.

Deux mineurs de tests en plus : le contrôle de nettoyage de `tests/crypto-switch.test.ts:394-407` dépend de l'ordre (rouge seul ou mélangé) ; le commentaire de `T0` dans `tests/crypto-chart-live.test.ts:63` donne une mauvaise date.

### Mineurs différés encore ouverts

Relus sur `cbad7fc`, base de CRY7.1, puis après la revue finale ; ceux qu'un ticket suivant ou la revue finale a corrigés n'y sont plus.
- **CRY0.4.** `load()` du store avale l'erreur du process principal (voulu, figé), sans toast. Le rendu paresseux de l'onglet dans `App.tsx` et l'ordre abonnement avant lecture de `load()` ne sont figés par aucun test (le lancement au démarrage l'est, par lecture du source). `tests/crypto-tab.test.ts` : « `onStatus` une fois » repose sur l'historique cumulé du faux (dit). `IconCrypto` n'est rendue nulle part (`TabDef.icon` jamais affichée). `tests/tabs.test.ts` lit `Shell.tsx` (gardé, ci-dessus).
- **CRY1.1.** `CRYPTO_HOSTS` et `CRYPTO_MARKETS` non gelés (comme `SOURCES`). `tests/crypto-markets.test.ts:153` : `api.binance.com@evil.io` dans le test des identifiants, alors que la règle d'hôte le refuse. Table des hôtes sans tabulation ni saut de ligne injectés, barre oblique inverse, `%2e`, hôte IP numérique ou hexadécimal.
- **CRY1.2.** `iso()` accepte une année hors de 1970–9999 (des millisecondes passées pour des secondes donnent une URL absurde). Détails : `Math.floor` redondant dans `coinbaseRequests`, type `{ urls; aggregate }` répété, branches `default:` qui avaleraient une venue future.
- **CRY1.3.** Heures (bougie, `E` de Binance, `ts` et `T` de Bybit) contrôlées finies, pas bornées. `price24hPcnt` de Bybit ≤ −1 (−100 % ou moins) accepté ; volume et volume acheteur admettent −0. `parseCandles` écarte des lignes sans les compter ; `aggregateBars` ne contrôle que la finitude des bougies faites à la main.
- **CRY1.4.** `mergeLiveBar` ne contrôle pas `max` (NaN ou non entier désactivent le plafond).
- **CRY1.5.** Copies locales de `toLine` et de quatre teintes (tests de parité de style). Aucun avis dynamique quand une ligne UTC manque faute de couvrir le début du jour ; seule la description de la carte le dit (`src/modules/crypto/indicatorCopy.ts`, depuis CRY4.2). Le commentaire de `reachesDayStart` (`src/engine/crypto/indicators.ts:47-51`) est un peu trop affirmatif.
- **CRY1.8.** Détails de test dans `tests/crypto-venues-rest.test.ts` : comparaison qui passerait sur une liste vide (`:541`), titres « un appel … 500 bougies », faux qui coupent par le nombre (`:783`, `:802`).
- **CRY1.6.** `stored()` du test lit un champ privé ; `num` et `isRecord` dupliqués de `venues.ts` (règle du plan : aucun import).
- **CRY1.7.** `levelFits` accepte des extrêmes de largeur qui ne se déclenchent jamais (`breadth_above 0`, `breadth_below 100`) ; égalité au premier pas non figée ; conversions ×100 non arrondies (franchissement en retard d'un ulp) ; `ID_MAX` et aides dupliqués ; tests d'import structurels fragiles.
- **CRY2.1.** `rmSync` sans `force` survit à la mutation (effet de journal seulement) ; écriture et suppression toutes deux impossibles (fichier verrouillé) laissent `true`, journalisé à part (risque accepté) ; `why()` borne les causes à 120 signes.
- **CRY2.2.** `Retry-After` en date HTTP non lu (repli sur le backoff) ; test de ligne d'import fragile ; réponse tardive d'un `fetchImpl` qui ignore le signal non annulée.
- **CRY2.3.** Refus attribués par lot : un marché refusé à la réouverture abandonne toute la venue jusqu'au prochain abonnement ; `answered()` attribue une erreur Coinbase ou Bybit à la plus ancienne demande en attente ; une longue pause 429 écrit une ligne par essai. Commentaires à reprendre (`VenueLine.refused`, `shut`, doc de `historyRequests` dans `electron/crypto/venues.d.ts`, retours à la ligne égarés).
- **CRY2.4.** Socket des liquidations muette mais qui répond aux pings : 0 $ avec une heure fraîche, sans compte de trames ni ligne au journal après une dizaine de minutes. L'heure glissante cale tant que `premiumIndex` échoue sur un marché calme. Une horloge locale en retard de plus de 60 s sur Binance écarte chaque liquidation sans bruit. La garde « une requête en vol » vaut par lancement : après `stop()` puis `start()`, une requête d'avant peut encore courir (bornée par le délai du fetch). Faux `ws` et minuteurs dupliqués dans `tests/crypto-temperature-host.test.ts` et `tests/crypto-feeds.test.ts` ; `LINE_MAX` déclaré trois fois ; `not.toThrow` vide à `tests/crypto-temperature-host.test.ts:717`. Détails : le commentaire des trames relevées (`tests/crypto-temperature-host.test.ts:163`, champs « que la documentation de Binance ne cite pas dans l'ordre ») est ambigu ; `at` masqué à `tests/crypto-temperature.test.ts:669` ; `failed` et `fail`, deux méthodes voisines aux noms proches (`electron/crypto-temperature.ts:274`, `:283`).
- **CRY2.5.** Le point mis de côté qui reste (abonnements orphelins après un rechargement du renderer) ; l'autre (418 de la température et socket Binance ouverte) est corrigé en `aa3fb7c`. `tests/crypto-runtime.test.ts:720` : l'expression des gestionnaires accepte toute méthode du runtime. `HistoryResult`, `SubscribeResult` et `TimerHandle` redéclarés dans `electron/crypto-electron.ts`. Aides inutilisées dans `tests/helpers/cryptoFakes.ts`.
- **CRY3.1.** Couverture étroite au niveau du coffre (marché inconnu, timeframe 30, plafonds, `1e999`), tenue au niveau des assainisseurs ; huitième coquille Dexie en ligne dans les tests ; une ligne gardée assainie en `[]` écrase la liste locale sans être comptée.
- **CRY3.2.** Pas de `catch` autour de `onEvent` du consommateur (comme nt8) ; `instruments` annonce les deux séries Binance du CVD (cotation acceptée par le port puis refusée par le main) ; détails du port en français seulement ; immutabilité d'une bougie finale non tenue par le port (le main la garantit) ; une réponse d'historique dont `bars` n'est pas un tableau rejette par `TypeError`.
- **CRY3.3.** Tolérance du pas `1e-12 × pas` : 20.00000000001 passe pour un pas entier et s'enregistre tel quel. `sanitizeCryptoChart` et `readIndicator` (`src/engine/crypto/persist.ts`) n'imposent pas le pas : une ligne `crypto.chart` restaurée et éditée à la main garde une période 20.5. Une écriture qui croise `restoreVault` arrive après la restauration ; `addToWatchlist` sur un marché déjà présent réécrit la ligne et journalise « ajouté » ; repli mort `sanitize…(x) ?? x` (`src/store/crypto.ts:369-384`) ; `settingsPending` et `settingsEpoch`, de module, survivent aux remises à zéro des tests.
- **CRY3.4.** Aucun test ne résout un historique ou une température après l'arrêt (gardes `!stopped` de `src/store/cryptoLive.ts`) ; le test d'historique périmé passe sur `leg.closed` seul ; une exception dans `startLight` ou `startChart` laisse `stop*` nul et relance à chaque écriture ; import circulaire `crypto.ts` ↔ `cryptoLive.ts` ; câblage d'`App` figé par lecture du source ; rejet de la première `temperature()` avalé ; assertions `onStatus` dépendantes de l'état du module.
- **CRY4.1.** `precision` et `minMove` non validés dans `Chart.tsx` (une précision hors de 0–100 lève dans `Intl` pendant le dessin ; l'onglet ne passe que les valeurs du registre) ; marqueurs de trades à 2 décimales ; deux `priceLines` de même identifiant : la dernière l'emporte, sans test ; démarrage différé non testé ; `cssToken`, troisième variante d'une même lecture.
- **CRY4.2.** `indicatorCopy.ts` écrit « (BTCUSDT, ONDOUSDT) » en dur, sans test qui le lie au registre ; balisage `IconPlus` et `Toggle` recopié dans le test d'équivalence de Visual ; assertions par lecture du source ; `indicatorCopy.ts` importe tout le composant pour deux tables de textes.
- **CRY4.3.** Titre du test de cache des lignes trop affirmatif ; non testés : « × » d'alerte, branche `catch` d'`AlertModal`, légende au survol, péremption de la largeur et des liquidations, puce bloquée, titres de colonnes en et es ; `fmtUsdCompact(999 999)` donne « 1 000,0 k$ », `fmtSigned(0.00001, 4)` « 0,0000 % » ; identifiants `cvd` et `cvd-binance` et règle `cvdProxy` dupliqués ; `v` masqué ; `CryptoSide.tsx` long (389 lignes).
- **CRY4.4.** Une trentaine de fichiers de test hors du module laissent des dossiers dans `%TEMP%` (hors de ce plan ; `tests/crypto-switch.test.ts` n'en laisse plus depuis `98ad268`, les dossiers déjà là restent à effacer par l'ADMIN). Variation 24 h des lignes de marché non alignée à droite (`CryptoSide.tsx`, `crypto.module.css`) : « -0.21 % » finit environ 14 px trop tôt sur `docs/design/crypto/09-cry.png`. Codes du faux desk du banc différents de ceux du main ; un échec de montage du banc ne se voit que dans la console du navigateur (la capture sort à 0 sur une page blanche) ; `capture-crypto.mjs` efface le PNG suivi avant la prise ; pas de test de `waitForServer`, du délai ni de l'arrêt ; le banc efface alertes et tracés crypto de l'origine `127.0.0.1:5173` (dit).
- **CRY5.1.** `setAlertState` sort sans rien dire sur `not_ready` ou un identifiant inconnu (une alerte `once` signalée reste armée, sans toast) ; une exception dans le toast ou `recordDeskEvent` saute `setAlertState` (`src/store/cryptoAlerts.ts`). Pas de test du réarmement au prix minuscule de ONE au niveau de l'évaluateur, ni de `reloadSettings` qui laisse un croisement `rearm` en place ; un franchissement pendant un trou de péremption est signalé à la première lecture fraîche ; l'évaluateur ne suit pas l'admission du desk (écran de verrouillage, mis de côté ci-dessus).
- **CRY6.1.** La valeur de `crypto_alert`, arrondie à la précision affichée, peut égaler le niveau (`breadth_below 40` franchi à 39,96 rend 40) : garder une décimale de plus pour la largeur et le funding.
- **CRY6.2.** Le point mis de côté pour l'ADMIN (ci-dessus) : l'orchestrateur WebSocket ne garde les `crypto_*` que côté renderer, sans relire l'interrupteur dans le process principal. `desk.describe` est gardé 5 s par le relais MCP (`electron/desk-relay.ts:66`) : jusqu'à 5 s après l'allumage, `tools/list` n'a pas les `crypto_*` et `tools/call` répond -32602 « Outil inconnu » ; `listChanged` faux (un client voit les outils en se reconnectant, ce que les consignes de la passerelle disent depuis `ff84ac1`). `setChart` enregistre le marché puis le timeframe : un rejet du second rend `persist_failed` alors que le marché a changé (`src/store/crypto.ts:721-730`). Le `chart()` du port recalcule les lignes d'indicateurs à chaque appel.


## Publication de la 3.6.0 (2026-10-13)

L'ADMIN confie la sortie de la 3.6.0 : l'onglet 09 · CRY, livré et revu dans la section précédente (« Onglet 09 · CRY »), entre dans la Release, éteint par défaut. Aucun code de l'application ne change : version, journal des versions, README, une ligne datée de la spécification.

| Piste | Ce qui change |
|---|---|
| **Version** | `package.json` et les deux entrées racine de `package-lock.json` à 3.6.0 ; le champ `description` reste tel quel. |
| **Journal** | Entrée 3.6.0 de `src/engine/changelog/changelog.json` : cinq points en français, anglais et espagnol, qui ouvrent aussi les notes de Release. `tests/changelog.test.ts` et `tests/release-notes.test.ts` épinglent 3.6.0. |
| **README** | « What's new in 3.6.0 » (les cinq points anglais du journal, mot pour mot sous leurs titres en gras), phrase d'ouverture et neuf modules, ligne `09 · CRY` du tableau du desk, section Crypto sans capture, tableau et puces de l'agent, puce Crypto de la passerelle MCP, outils `crypto_*` dans la liste (33 : 23 en lecture, 10 en écriture), lignes Agent, Crypto et Network de « Safety by design », avertissement, architecture, feuille de route, versions (3.3.4 passée dans « Earlier versions »), en-tête, liens d'installation et ancre 3.6.0, badge des tests. |
| **Spécification** | `docs/ONGLET-CRYPTO.md` : une ligne datée sous l'en-tête dit l'entrée dans la Release et la revue des conditions des exchanges encore ouverte. |

**Choix de l'ADMIN.** Ni le README, ni le journal, ni les notes de Release ne nomment les marchés de l'onglet : la liste grandira, un marché après l'autre, au fil des versions, et l'onglet avec elle. Seuls les exchanges (Coinbase, Binance, Bybit) sont nommés, comme infrastructure.

**Vérifications.** `npm run typecheck` vert ; `npm test` : 2 263 sur 2 264, seul rouge `tests/bridge-symlink.test.ts` (`EPERM` : ce poste n'a pas le droit de créer un lien symbolique, préexistant) ; pendant la préparation, deux passages sur quatre ont aussi vu des tests sans lien avec ce changement dépasser le délai de 5 s sous charge (dont `tests/agent-refusal-label.test.ts`, `tests/agent-routine-run.test.ts`, `tests/mcp-resume.test.ts`), verts relancés seuls ; `node scripts/release-notes.mjs --check` : 3.6.0, cinq points, fr/en/es ; `npm run build` vert. Le badge du README compte la suite (2 264) : sur la CI de `caf7b91` (`check` sous ubuntu, macOS et Windows), 2 264 sur 2 264, `bridge-symlink` compris (lien symbolique permis) ; ce commit n'ajoute aucun test. À revoir sur la CI du commit de Release avant le tag.

**Points ouverts.**
- La spécification (`docs/ONGLET-CRYPTO.md`, en-tête, § 3 et § 13) tenait le module pour personnel, hors Release, et demandait qu'une distribution passe par une revue des conditions des exchanges (décision 9) : la demande de l'ADMIN tranche le sort de l'onglet (gardé sur le rail, éteint par défaut) ; la revue des conditions n'est consignée nulle part, ce que l'en-tête de la spécification dit désormais.
- L'écart CRY6.2 (une écriture de l'agent qui change marché ou unité de temps, watchlist ou CVD Binance fait ouvrir le flux correspondant, sans dialogue par la passerelle ou l'orchestrateur) entre dans la Release ; le README le dit (lignes Agent et Crypto de « Safety by design », section Crypto). La phrase de `CLAUDE.md` § 5 (« L'agent ne s'abonne à aucune donnée de marché ») reste à reformuler par l'ADMIN.
- La Release annonce que Visual garde sa vue pendant le direct (« dans Visual aussi ») : publiée telle quelle, elle tranche l'arbitrage `2b37d4a` (écart à « Visual inchangé ») en faveur du partage. Si l'ADMIN tient à Visual inchangé, retirer « dans Visual aussi », « in Visual too » et « también en Visual » du journal et du README avant le tag. Reste la limite d'une bougie remplacée plus loin que l'avant-dernière, redessinée au recadrage suivant.
- Les autres points que la revue finale laisse à l'ADMIN (ci-dessus) restent ouverts.

**Reste à l'ADMIN.** Le tag `v3.6.0`, la Release et la signature de `SHA256SUMS.txt` par la clé du Lab, hors de toute session d'agent (`docs/PUBLICATION.md`). Le passage de la CI sur `caf7b91` est rouge par ses seuls jobs `dist` : quota de stockage des artefacts GitHub atteint au téléversement, tests verts. `.github/workflows/release.yml` passe aussi ses installeurs par `upload-artifact` : libérer le quota (anciens artefacts) ou attendre son recalcul avant de lancer la Release.

### Arbitrages de l'ADMIN et circuit de la Release (2026-10-14)

L'ADMIN répond aux points ouverts ci-dessus et confie le reste de la sortie.

- **Décision 9.** L'ADMIN renonce à la revue des conditions des exchanges : l'onglet part tel quel, données publiques, usage personnel. La règle technique de la décision reste : `CRYPTO_HOSTS` hors de `allowedHosts()`, consultée seulement interrupteur allumé. Consigné dans l'en-tête et le § 13 de `docs/ONGLET-CRYPTO.md` et au § 7 de `docs/THESE-AGENTIQUE.md`.
- **`CLAUDE.md` § 5.** L'ADMIN garde la phrase telle quelle. La décision 10 (geste du trader) couvre déjà l'onglet crypto, et le README décrit l'écart CRY6.2 (lignes Agent et Crypto de « Safety by design »). Rien ne change dans le code.
- **Visual.** Laissé à l'agent ; tranché en faveur du partage : `2b37d4a` reste, le suivi NinjaTrader de 02 · VIS garde sa vue pendant le direct, et le journal de la 3.6.0 garde « dans Visual aussi » dans les trois langues. La limite d'une bougie remplacée plus loin que l'avant-dernière, redessinée au recadrage suivant, rejoint les mineurs différés.
- **Brouillon `v3.5.0`.** Supprimé à la demande de l'ADMIN : release `405475640`, brouillon sans `SHA256SUMS.txt.sig`, même commit (`0796a9d`) que la 3.5.0 publiée (`405444988`), intacte, comme le tag `v3.5.0`.
- **Quota des artefacts.** Le workflow `release` lancé à 8 h 36 (run `38523188532`) a encore échoué à `upload-artifact` sur les trois systèmes (« Artifact storage quota has been hit »), douze heures après la suppression de tous les artefacts (aucun au compteur du dépôt) : le stockage se compte en GB-heures sur le mois, et les heures déjà consommées restent. P1 retire la Release de ce stockage (brouillon créé par `prepare`, installeurs téléversés par chaque construction, empreintes calculées par `publish` sur le contenu du brouillon) et ne garde plus les installeurs de la CI qu'à un lancement manuel, un jour. Chaîne de confiance inchangée : empreintes calculées en CI et affichées dans le journal de `publish`, signées hors ligne par l'ADMIN, vérifiées par le desk. `tests/release-tools.test.ts` épingle les deux règles.
- **Revue de P1, avant push.** Trois relectures indépendantes ont trouvé le même bloquant : publier un brouillon lancé à la main crée son tag, qui relance `release` par `on: push: tags` (précédent : run `37584571366`, 2 s après la publication de la 3.5.0, origine du brouillon `v3.5.0` en double). L'ancien circuit n'y gagnait qu'un brouillon de trop ; celui de P1 aurait téléversé avec `--clobber` sur la Release publiée, remplacé les installeurs signés et `SHA256SUMS.txt`, et les desks auraient refusé la mise à jour (`electron/native-update.ts`, `trustedChecksum`). P3 : l'étape « Release existante » lit l'état de la release pour les deux déclencheurs (publiée et tag poussé : le run ne fait rien ; publiée et lancement manuel : refus ; brouillon : refus, avec les deux voies de reprise) ; `build` et `publish` n'écrivent que dans le brouillon de leur run, épinglé par son identifiant ; un groupe `concurrency` sérialise les runs ; la construction réessaie la coupure du zip Electron comme la CI. Vérifié en local contre les vraies releases (lecture seule) : `v3.5.0` sur push → `skip=true`, sur lancement manuel → refus, `v3.6.0` → `skip=false`.
- **Seconde vérification de P3.** Le circuit ferme le bloquant tant que l'API répond ; deux durcissements (P4). L'état se lit dans la liste des releases de l'API (`gh api --paginate`, brouillons compris), qui arrête le run sur toute erreur : avec `gh release view`, une erreur passagère de l'API pouvait remonter en « release not found » (gh 2.96 et suivants) et passer pour « aucune release ». Avant chaque écriture, le tag doit désigner une seule release, le brouillon du run (« `<id>` true ») : `gh release upload` et `download` n'ont plus qu'elle à trouver. Vérifié en local contre l'API (lecture seule) : `v3.5.0` publiée → `skip=true` sur push, refus sur lancement manuel ; `v3.6.0` absente → `skip=false` ; dépôt introuvable → arrêt, rien d'écrit.
- **À ne pas relancer.** Le run `38523188532` (8 h 36) rejoue le workflow de `52ec119`, sans garde : son job `publish` créerait un second brouillon `v3.6.0` une fois le quota revenu. Relancer un run rejoue le workflow de son commit.
- **Pour l'ADMIN.** Les releases immuables de GitHub (désactivées sur le dépôt) interdiraient, une fois une Release publiée, tout changement de ses fichiers ou de son tag, quel que soit le workflow qui tourne ; les brouillons restent modifiables, `sign-release.mjs` garde son ordre. Réglage du dépôt, laissé à l'ADMIN.
- **README (R3).** Le badge de version lisait l'API GitHub (`img.shields.io/github/package-json`) : sur un dépôt privé, shields.io affichait « repo not found » en tête. Badge statique, épinglé par `tests/readme.test.ts` sur `package.json`, avec les deux cartouches et la résolution de chaque lien interne. Réagencement après cinq relectures (rangement, faits, rendu, lecteur, épingles) et une vérification contradictoire : une seule copie de chaque fait (installation de l'AddOn et dossier CSV dans « NinjaTrader 8 bridge », commandes dans « Develop », limites de sûreté dans « Safety by design », que l'avertissement désigne), dossier de données et coffre sous « Install », liste des outils en H3 (`#agent-tools`), « Safety by design » après le pont avec une ligne Bot, « Visual system » sous « Architecture », « Services » sous « License », feuille de route sans les « Shipped in », toutes les ancres anciennes gardées. Faits corrigés sur le code : dialogue du process principal partout, relever les limites de l'agent passe par un dialogue, plancher des suiveurs à 30 % par défaut, drawdown statique distinct des trailing, « View in Visual », contenu de l'export du coffre, préambule *untrusted data* absent de l'orchestrateur, exemptions d'un ordre qui réduit, portable ARM64, temps réel seulement sur la machine de NinjaTrader 8 (l'AddOn joint `127.0.0.1`). « Where it goes » reste dans la section Crypto : c'est l'objectif voulu par l'ADMIN le 13 octobre.
- **Constaté en route, hors README.** La vérification de mise à jour du desk interroge `api.github.com/…/releases/latest` sans authentification (`electron/updater.ts:155`, `electron/native-update.ts:25`) : tant que le dépôt est privé, elle ne voit aucune Release et affiche « Impossible de joindre GitHub » ; le README le dit, la visibilité du dépôt reste à l'ADMIN. `llmHostOk` refuse `http://[::1]…` alors que `::1` est épinglé (le nom d'hôte garde ses crochets) : retiré du README, correctif proposé à part. Les 14 captures de `docs/media/` montrent encore la 3.5.0 et huit modules ; les refaire demande la phrase de déverrouillage de l'ADMIN (`scripts/capture-readme.mjs`).

## Process principal après la 3.6.0 (2026-10-14)

Quatre points ouverts du relevé du 14 octobre, sur `main` après la publication de la 3.6.0 (`d03caa9`). PR #118.

| Ticket | Constat d'origine | Ce qui change | Preuve |
|---|---|---|---|
| E2 | CRY6.2 (ci-dessus, « points mis de côté ») : l'orchestrateur WebSocket ne gardait les `crypto_*` que côté renderer. | `electron/orchestrator.ts` relit l'interrupteur du runtime crypto à chaque requête : module éteint, un appel `crypto_*` (avec ou sans `tool.`) est refusé dans le process principal sans être relayé (`crypto_disabled`, trois langues), et `desk.describe` est servi sans `crypto_*`. Même garde que la passerelle MCP (`electron/mcp-server.ts`). Le refus arrive désormais en erreur JSON-RPC -32000 (`data.reason` = `crypto_disabled`), et non plus en résultat `{ ok: false }` rendu par le renderer. | `tests/orchestrator-crypto.test.ts` |
| E2.1 | Relecture : le préfixe interne `d/` d'un `desk.describe` faisait dépasser la borne de 64 d'`orch:respond` à un identifiant texte de 56 ou 57 signes, que les appels d'outil servent. | `ORCH_RESPONSE_ID_MAX` (64 plus le préfixe), lu par `orch:respond`. | même fichier |
| E3, E3.2 | CRY2.5 (ci-dessus) : un rechargement du renderer laissait ouverts les abonnements de la page précédente, crypto et NinjaTrader. | `electron/page-left.ts` : au départ de la page (navigation du cadre principal vers un autre document, rechargement compris ; `render-process-gone`), `CryptoRuntime.releaseSubscriptions()` ferme flux et envois en attente (interrupteur et température gardés) et `NtBridgeServer.releaseSubscriptions()` désabonne chez l'AddOn ce que la page avait ouvert. L'AddOn ne change pas. | `tests/page-left.test.ts`, `tests/crypto-runtime.test.ts`, `tests/nt-bridge-release.test.ts` |
| E3.3 | Relecture contradictoire, reproduit sous Electron 43.7.1 : `did-start-navigation` précède `will-navigate`. Un lien https cliqué dans une note ou une réponse de l'agent fermait les flux, puis le desk refusait la navigation : page en place, flux figés. | `deskUrlAllowed` est la seule règle de navigation de la fenêtre du desk : `will-navigate` et le départ de la page la lisent tous deux ; une navigation refusée ne ferme rien. | `tests/page-left.test.ts` (rouge par mutation sans la règle) |
| E4 | A11 : le process principal croyait l'`apiKeyHost` donné par le renderer. | `secrets:encrypt` reçoit l'URL de base ; `electron/llm-key-seals.ts` lie l'empreinte SHA-256 du blob à l'hôte dans `userData/llm-key-hosts.json` (ni clé ni blob, 64 liens au plus) ; à l'usage, l'hôte scellé fait foi. Coffre inchangé ; un secret chiffré avant E4 suit le renderer comme avant ; liens perdus (débordement, fichier corrompu) : un blob inconnu est refusé, il faut ressaisir la clé. | `tests/llm-key-seals.test.ts` |
| E4.1 | Relecture : une erreur de lecture passagère du registre (fichier verrouillé) restait en mémoire pour tout le lancement, et l'écriture suivante effaçait les liens. | Lecture en échec : refus le temps qu'elle dure, rien n'est gardé, le registre se relit au besoin suivant. Une clé saisie pendant ce temps repart d'un registre neuf (E4.3) : sans cela, un fichier illisible pour de bon (laissé par un autre compte) refusait toute clé à chaque lancement. | même fichier |

**Relecture contradictoire.** Quatre relecteurs (orchestrateur, départ de la page, clé API, invariants et preuves), deux sceptiques par constat. Un bloquant, trouvé deux fois et non réfuté : E3.3. Remarques laissées en l'état :
- `tool.desk.describe` passe l'orchestrateur sans le filtre crypto de `desk.describe`, mais le renderer le refuse (`unknown_tool`), sans liste d'outils. Couplage fragile, sans fuite.
- Un `marketdata.subscribe` en vol au départ de la page n'est fermé qu'au départ suivant. Un identifiant noté pendant un pont hors ligne continue de diffuser jusque-là ; c'était déjà le cas avant E3.2, à chaque rechargement.
- E4 ne résiste pas à un renderer compromis qui forge une variante de blob tant que le registre n'a rien perdu : c'est le comportement d'avant E4, qui ne recule pas.
- Antérieurs à E4 : `restoreVault` attend `desk.secrets.encrypt` au milieu d'une transaction Dexie ; sous le desk, une clé tapée touche par touche est chiffrée à chaque frappe et le champ se vide (seul le collage fonctionne). À instruire à part.

**Seconde relecture (E3.3, E2.1, E4.1).** Trois vérificateurs, aucun bloquant. E3.3 a été rejoué sous Electron 43.7.1 : lien https, `location.href` externe, autre fichier ou ancre ne libèrent rien ; rechargement, retour arrière et plantage du rendu libèrent, en production comme avec le serveur Vite. L'URL de `will-navigate` est toujours la même chaîne que celle de `did-start-navigation`. Elle en a tiré E4.3 (registre illisible pour de bon) et E2.2 (commentaire de la borne). Constat antérieur à la PR, à instruire à part : quand le chemin d'installation contient `[`, `]`, `~` ou `%` (nom court Windows comme `JEROME~1`, sous `%TEMP%` pour l'exécutable portable), `pathToFileURL` encode ces signes alors que Chromium les garde après `loadFile`. `will-navigate` refuse alors `location.reload()`, que `src/store/db.ts` appelle après `db.close()`, et un rechargement lancé par le process principal ne libère rien (le plantage du rendu reste couvert). Piste : comparer les chemins (`fileURLToPath`) plutôt que les URL dans `deskUrlAllowed`.

**Vérifications.** `npm run typecheck`, `npm test`, `npm run build`, `npm run electron:compile` ; nouveaux tests verts sous `TZ=America/New_York` et rouges sans leur correctif. Reste à faire desk lancé : rechargement avec un chart crypto ouvert, puis avec Visual abonné au flux NinjaTrader (flux de l'ancienne page fermés, nouvelle page réabonnée) — `Cmd+R` sous macOS ou en développement ; sous Windows et Linux, le menu est retiré (`Menu.setApplicationMenu(null)`), `Ctrl+R` ne recharge pas le desk empaqueté ; clic sur un lien https d'une note (flux intacts).

## Agent cloud — rapports quotidiens (2026-10-26)

Demande de l'ADMIN du 26 octobre 2026 : un agent qui tourne chaque jour dans son bac à sable chez Anthropic, payé sur les crédits API mensuels de l'organisation, et dont les rapports apparaissent dans l'onglet Agent IA, au design ΟΡΟΣ. Pour l'instant, le pont seul ; l'analyse et le design des rapports viendront de l'ADMIN. Branche `agent/rapports-cloud`, issue de `design/oros` (`8977ef8`). Référence : `docs/AGENT-CLOUD.md` ; décision 11 de `docs/THESE-AGENTIQUE.md` § 7 ; invariant « Agent cloud » de `CLAUDE.md` § 5.

| Ticket | Ce qui change | Preuve |
|---|---|---|
| CLD1 | Contrat `canto.rapport/1` : lecture bornée, contrôles et marques bidirectionnelles retirés, sources en https seulement, codes `AGT-RPT-AAAAMMJJ`. Module partagé, déclaré aux trois endroits. | `tests/agent-cloud-report.test.ts` |
| CLD2 | Client Managed Agents du process principal : `api.anthropic.com` seul, aucune redirection, délai de 20 s, corps borné en UTF-8 strict, chemins bâtis d'identifiants vérifiés, erreurs sans clé ni URL. | `tests/agent-cloud-api.test.ts` |
| CLD3 | Hôte : clé chiffrée par le trousseau (`userData/agent-cloud.json`, 0600), relevé (10 s, 15 min, 3 min tant qu'une session tourne), rangement dans `userData/agent-reports/`. | `tests/agent-cloud-host.test.ts` |
| CLD4 | Définition (environnement limité aux domaines officiels, agent Opus 5.5 sans outil du desk, déploiement planifié avec résultat attendu et plafond) ; installer, lancer, suspendre et reprendre par dialogue du process principal. | `tests/agent-cloud-control.test.ts` |
| CLD5 | IPC `agent-cloud:*` derrière `trusted(e)` ; statut du renderer, miroir exact de celui du process principal (test de types). | `tests/agent-cloud-wiring.test.ts` |
| CLD6 | Store du renderer, chargé au démarrage sans étape réseau. | `tests/agent-cloud-store.test.ts` |
| CLD7 | Dossier en Système 4.0 : plaque au trait d'état, fiches codées, LED des non lus, lecteur assaini. | `tests/agent-cloud-folder.test.ts` |
| CLD8 | Sous-onglets A · Rapports (ouverture), B · Conversation, C · Options ; vues montées et cachées. | `tests/agent-tab.test.ts` |
| CLD9 | Options › Agent cloud, sous une bande d'état des services. | `tests/agent-cloud-options.test.ts` |
| CLD10 | Rail : « N rapport(s) non lu(s) » sous Agent IA. | `tests/rail-bordereau.test.ts` |
| CLD11 | Refus d'écriture des agents externes : chemin « Agent IA › Options › … ». | `tests/agent-refusal-label.test.ts`, `tests/mcp-server.test.ts` |
| CLD12 | `docs/AGENT-CLOUD.md`, invariant de `CLAUDE.md` § 5, décision 11. | — |
| CLD13 | Quitter ou remplacer le déploiement du desk passe par un dialogue qui le suspend ; un déploiement du desk déjà là est repris, jamais doublé ; agent ou environnement disparus sont recréés ; un déploiement externe n'est ni suspendu ni repris ; aucune clé ni aucun déploiement ne changent pendant une action ; installation en pause dont la suspension échoue : dite. | `tests/agent-cloud-control.test.ts` |
| CLD14 | Dialogues qui dépensent : plafond relu du déploiement (« aucun plafond », « plafond inconnu »), plafond appliqué à l'installation ; langue du rapport dite au correcteur. | même fichier |
| CLD15 | Session finie avec une évaluation ouverte (plafond atteint) : attendue 30 min puis relevée ou notée ; 60 s d'attente pour l'index ; sessions archivées vues ; relevé réussi : relance automatique ; non-lus comptés sur les 400 fiches du dossier. Son rattrapage par pages perdait encore tout au-delà de la première : remplacé par CLD20. | `tests/agent-cloud-host.test.ts` |
| CLD16 | Journée d'un rapport à sept jours au plus de sa session ; hôte affiché à côté de chaque lien du corps, lien hors https sans adresse, clic du milieu sous la même règle. | `tests/agent-cloud-report.test.ts`, `tests/agent-cloud-host.test.ts`, `tests/agent-cloud-folder.test.ts` |
| CLD17 | Conversation ouverte au dernier message ; rapport plus récent et non lu ouvert en tête ; lecteur remis en haut, sans `aria-live` ; pluriels et « Agent » dans la langue du desk ; code de la fiche prévue jamais en double ; bloc-titre testé. | `tests/agent-cloud-folder.test.ts`, `tests/agent-tab.test.ts` |
| CLD18 | Fiches altérées sur le disque ignorées ; cette section ; recette 8 ci-dessus mise au chemin « Options ». | `tests/agent-cloud-host.test.ts` |
| CLD19 | L'échec d'une action reste affiché (le relevé suivant ne l'efface plus) ; un 404 sur le déploiement du desk ne le recrée jamais et ne passe pas pour une suspension (« Quitter sans suspendre » à part) ; « plafond inconnu » dès que le déploiement ne répond pas ; un relevé dont le déploiement change en route n'écrit rien. | `tests/agent-cloud-control.test.ts` (rouge par mutation sans la séparation des erreurs) |
| CLD20 | Marque basse : relevé de la plus ancienne session non réglée vers la plus récente, dix rapports par relevé ; une session qui tourne retient la marque. | `tests/agent-cloud-host.test.ts`, `tests/agent-cloud-api.test.ts` |
| CLD21 | Seul le clic du milieu ouvre un lien du rapport ; clé figée pendant une action ; documentation alignée. | `tests/agent-cloud-folder.test.ts`, `tests/agent-cloud-options.test.ts` |
| CLD22 | CI de la PR #119 rouge à l'étape « Avis de sécurité » : DOMPurify 3.4.16 et avant, cinq avis dont un critique (GHSA-p98j-92pf-mc4p et suivants), publiés après la 3.6.0, qui bloquent aussi `main` et `design/oros`. Plancher relevé à `^3.4.17` (dépendance existante, même plage majeure) ; le desk appelle `DOMPurify.sanitize` sur une chaîne, hors des modes visés (`IN_PLACE`, `SAFE_FOR_TEMPLATES`, XHTML), mais le lecteur des rapports en dépend. `npm audit --omit=dev --audit-level=high` : 0 vulnérabilité. | `tests/dompurify-floor.test.ts` |
| CLD23 | Première installation réelle (2026-10-26) : `400 invalid_request_error` à la création de l'environnement, « This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header ». La clé de l'ADMIN est une clé d'utilisateur (`sk-ant-usr-…`), valable pour toute l'organisation. Options › Agent cloud › Espace de travail : identifiant gardé dans `agent-cloud.json` (pas un secret), forme vérifiée (`wrkspc_…` ou UUID), envoyé dans `anthropic-workspace-id` à chaque appel ; figé tant que le déploiement du desk existe ; changé, il oublie l'environnement et l'agent de l'ancien espace ; nommé dans le dialogue d'installation. IPC `agent-cloud:set-workspace` derrière `trusted(e)`. Sans la ligne qui pose l'en-tête, les deux tests du client et de l'hôte échouent. | `tests/agent-cloud-api.test.ts`, `tests/agent-cloud-host.test.ts`, `tests/agent-cloud-options.test.ts`, `tests/agent-cloud-wiring.test.ts` |
| CLD24 | Le refus s'affichait en anglais brut, sans dire où le régler. Un 400 qui réclame `anthropic-workspace-id` devient, en trois langues, « Clé d'utilisateur sans espace de travail : indiquez son ID (Console › Settings › Workspaces) dans Options › Agent cloud › Espace de travail » ; un espace déjà indiqué mais refusé est dit tel, suivi de la réponse de l'API. Tout autre 400 garde le message de l'API. | `tests/agent-cloud-control.test.ts` |
| CLD25 | Relecture contradictoire de CLD23 et CLD24 (quatre relecteurs, deux sceptiques par constat : 14 constats, 6 non réfutés, ramenés à trois défauts). (1) Après une réponse de création de déploiement perdue, changer d'espace effaçait l'agent, seule piste pour retrouver un déploiement planifié et facturé dans l'ancien espace : le desk le cherche désormais par l'agent avant d'oublier quoi que ce soit, le reprend s'il existe, et refuse si la recherche échoue. (2) Une clé d'utilisateur posée sur un déploiement installé avec une clé d'espace restait bloquée (espace refusé sous le déploiement, déploiement impossible à quitter sans espace) : sous le déploiement du desk, un espace est retenu dès que le déploiement y reste visible, relu avec le nouvel en-tête (`getDeployment(id, { workspace })`). (3) La doc de `CloudApiError` avait été détachée de sa classe. `setWorkspace` devient une action (`busy: 'workspace'`, « Vérification… »). Réfutés (8) : relevé en vol pendant un changement d'espace (deux constats), espace erroné lu comme une erreur de clé, boutons actifs sous le déploiement, brouillon vidé sur refus, garde `busy` non testée (testée depuis), `authBlocked` levé sans test, erreur d'API jugée impossible dans le test de CLD24. | `tests/agent-cloud-host.test.ts`, `tests/agent-cloud-control.test.ts` |
| CLD26 | Première exécution réelle (2026-10-26, 21:43) : session au repos après 36 min, évaluation ouverte, sans `rapport.json`, notée « idle · outcome ouvert » une demi-heure plus tard. Une session au plafond passe au repos avec `stop_reason: budget_reached` (pas une fin : seul un plafond relevé la relance), et le desk ne lisait ni ce motif, ni la dépense, ni le plafond de la session. Il lit la dépense et le plafond (`SessionView.budgetCents`) : au plafond sans rapport, l'échec se dit « Plafond atteint avant le rapport · 3,00 $ / 3,00 $ » dès la minute d'index, sans attendre 30 min ; un rapport écrit avant la coupure est relevé ; tout autre « sans rapport » porte sa dépense. | `tests/agent-cloud-api.test.ts`, `tests/agent-cloud-host.test.ts` |
| CLD27 | La consigne ne demandait d'écrire `rapport.json` qu'à la fin, sans borne sur les recherches : un plafond atteint en route ne laissait rien. Section « Méthode : écrire tôt, affiner ensuite » : calendrier officiel d'abord (une page par institution), écriture aussitôt d'un rapport complet et valide même sommaire, affinage ensuite en réécrivant le fichier entier, au plus 15 pages lues (`MAX_PAGES`). Le plafond de 3,00 $ et l'effort élevé ne changent pas : relever l'un ou baisser l'autre est une décision de l'ADMIN. L'agent installé n'en profite qu'après « Mettre à jour l'agent » (nouvelle version, déploiement gardé en pause). | `tests/agent-cloud-control.test.ts` |
| CLD28 | Relecture contradictoire de CLD26 et CLD27 (deux relecteurs, deux sceptiques par constat : 13 constats, 5 non réfutés, ramenés à deux défauts). (1) `stop_reason` n'est pas un champ de l'objet session, seulement de l'événement de mise au repos : la branche `budget_reached` ne pouvait jamais servir, et le test passait par le seul coût. Le champ est retiré ; le plafond se déduit du coût, honnêtement documenté. (2) La tolérance d'un centime n'ajoutait que des faux positifs : une session en pause déclare toujours au moins son plafond (pause au coût exact, coût rendu arrondi). La règle devient `coût ≥ plafond`, et un cas négatif (2,99 $ sur 3,00 $, évaluation close) reste « sans rapport ». Les huit réfutés touchent surtout la méthode de CLD27 (quinze pages pour neuf institutions, rapport sommaire rangé comme complet) : la consigne reste celle de l'ADMIN à venir. | `tests/agent-cloud-api.test.ts`, `tests/agent-cloud-host.test.ts` |
| LAB2 | Précision de l'ADMIN (2026-10-26) : c'est le Lab qui produit les rapports avec son agent ; un desk CΛNTO ne fait que les recevoir, et seul le siège de l'ADMIN donne le pilotage. `LAB_SEATS` (`electron/seat.ts`) nomme les sièges du Lab, `SeatHost.isLab()` le vérifie, et `AgentCloudHost` refuse dans le process principal, sans appel à l'API, sans dialogue ni écriture, les huit commandes de pilotage (clé, espace de travail, déploiement, planification, installation, lancement, suspension, reprise) d'un desk sans ce siège. La lecture du dossier reste permise. Le statut porte `lab` ; un siège accepté le republie. Un nom du Lab signé par une autre clé n'est pas un siège, et la casse compte. | `tests/agent-cloud-control.test.ts`, `tests/seat-host.test.ts` |
| LAB3 | L'onglet Agent IA était trop lourd, et montrait à tous le pilotage du Lab. Le dossier (A · Rapports) devient le même pour tous : les fiches et le lecteur, sans plaque ni commande, avec des textes qui disent que le Lab produit et que le desk lit. Le pilotage et la plaque partent dans une vue « D · Lab », montée au seul siège du Lab ; Options ne garde que les réglages de l'IA du desk, sa bande d'état perd la cellule de l'agent cloud. L'en-tête d'un desk qui lit ne dit que les rapports, et *Relever maintenant* n'y paraît pas. Un siège perdu ramène la vue Lab aux rapports. | `tests/agent-tab.test.ts`, `tests/agent-cloud-folder.test.ts` |
| LAB4 | Relecture contradictoire de LAB2, LAB3 et R3.7b (deux relecteurs, deux sceptiques par constat : 9 constats, 4 non réfutés, tous mineurs). Le message d'un 400 `anthropic-workspace-id` (FR, EN, ES), un commentaire, `AGENT-CLOUD.md` et la recette de l'ADMIN renvoyaient encore à « Options › Agent cloud », que LAB3 a déplacé : ils disent désormais « Agent IA › Lab ». La plaque disait « ci-dessous » alors que le pilotage est à côté : elle nomme le panneau. Les cinq réfutés : un desk qui perd le siège garde un déploiement qu'il ne peut plus suspendre (le siège ne se perd que si la clé publique est retirée, une décision de l'ADMIN), le relevé non gardé (lire est permis), le dossier d'un testeur qui ne reçoit encore rien (la diffusion vient avec l'agent cloud), l'étiquette du modèle dans l'en-tête de la vue Lab, et la vue Lab éprouvée par sa source plutôt que par un rendu. | `tests/agent-cloud-control.test.ts`, `tests/agent-cloud-folder.test.ts` |
| CLD29 | Premier rapport réel (2026-10-27, agent v2 : écrit en trois minutes, 1,67 $ / 3,00 $), vérifié contre ses quinze sources relues en direct : une vérification par source, plus les heures, la cohérence et la consigne, deux sceptiques par constat. Heures et dates justes (48 sur 48, dont l'écart de 5 h entre New York et Paris cette semaine) ; 13 sources sur 15 confirment, deux PDF du Census n'ont pas répondu. Trois défauts de méthode maintenus : (1) *This Week in Petroleum* inscrit le mercredi d'après la page des exceptions de jours fériés de l'EIA, figée sur 2024-2025, alors que l'EIA ne le publie plus depuis octobre 2025 ; (2) le tableau des adjudications de la fenêtre omettait les bills à 6 et 52 semaines adjugés le jour même, et gardait ceux à 4 et 8 semaines, adjugés le jeudi hors fenêtre, parce qu'annoncés le jour même ; (3) six pages de contexte lues, jamais les calendriers de la CFTC ni du CME, notés « Not found ». La consigne lit d'abord le calendrier des neuf institutions (`CALENDAR_INSTITUTIONS`), une page chacune, avant tout contexte ; une section « Calendrier : complet, à jour, lu » demande chaque adjudication du jour et du lendemain, bills compris (une annonce n'est pas une adjudication, une adjudication d'un autre jour reste hors de la liste), interdit de tirer un événement d'une page sans date de l'année en cours, et sépare « non consulté » de « non trouvé », deux mentions que la grille connaît. Laissés de côté (aucun ne fausse une heure) : un intervenant et un libellé de la Fed déduits, une mention « non corrigé des variations saisonnières » mal placée, « official calendars only » inexact, des explications de deux à cinq phrases au lieu d'une, un titre et un résumé sans renvoi aux sources (critère 6 de la grille). `MAX_PAGES` et le plafond ne changent pas. L'agent installé n'en profite qu'après « Mettre à jour l'agent ». | `tests/agent-cloud-control.test.ts` |
| CLD30 | Relecture contradictoire de CLD29 (quatre relecteurs : efficacité, budget de pages, cohérence, conventions ; deux sceptiques par constat : 24 constats, 10 non réfutés — 7 par les deux sceptiques, 3 par un seul —, ramenés à trois défauts de consigne et à des compléments de doc et de test ; 14 réfutés). Les constats de doc et de test sur CLD29 (liste exacte des neuf institutions épinglée, ligne d'audit complétée) ont été pris dans son commit. (1) CLD29 écartait toute page sans date de l'année en cours ; or la page du rapport pétrolier hebdomadaire (ir.eia.gov), le vrai rendez-vous du pétrole, ne porte aucune année : l'agent l'aurait perdu. Est périmée désormais une page dont la date la plus récente a plus de trois mois avant la journée analysée, ce qui écarte toujours les exceptions de *This Week in Petroleum*, figées sur 2025. (2) cmegroup.com refuse l'accès automatisé (403 « This IP address is blocked due to suspected web scraping » depuis le poste ; la lecture web dépasse le délai), et la consigne ne disait pas d'abandonner une page refusée : une page qui ne s'ouvre pas ne se retente pas, ni par une autre page du même site, et son calendrier est « non consulté ». (3) Les pages restantes allaient à l'affinage, donc au contexte : elles comblent d'abord le calendrier de la fenêtre (page périmée remplacée par la page à jour de la même publication, page du mois suivant quand le lendemain y tombe, heure manquante). `AGENT-CLOUD.md` annonçait encore les tickets CLD1 à CLD22. **À décider par l'ADMIN** : la réponse du CME renvoie à ses conditions d'utilisation des données, qui interdisent l'accès automatisé ; garder le CME dans `CALENDAR_INSTITUTIONS` et `OFFICIAL_DOMAINS`, ou l'en retirer. Réfutés, entre autres : une adresse de calendrier à fixer par institution, l'EIA sur deux pages (ir.eia.gov porte les deux rapports hebdomadaires), la grille sans prise sur la couverture, les mentions françaises dans un rapport anglais, « la fenêtre » non définie. | `tests/agent-cloud-control.test.ts` |
| CLD31 | Relecture contradictoire de CLD30 (deux relecteurs, l'un sur les pages relues en direct, l'autre sur la doc et le test ; deux sceptiques par constat : 11 constats, 5 non réfutés — 1 par les deux sceptiques, 4 par un seul —, 6 réfutés). (1) « Ne se retente pas, ni par une autre page du même site » faisait d'un délai passager la perte d'une institution : le premier rapport avait repris la BEA par d'autres pages de bea.gov, qui répond aujourd'hui en moins d'une seconde, et le calendrier du Census a dépassé le délai deux fois sur cinq avant de répondre. Séparer le refus du délai ne suffit pas : pour la lecture web, le CME se manifeste par un délai de 60 s, pas par un 403. Une page qui ne s'ouvre pas se retente donc une fois au plus, elle-même ou une autre page de la même institution, et cette seconde tentative passe avant le contexte ; au second échec, le site est clos pour la session. Le CME coûte au plus deux pages. (2) Le rapport pétrolier hebdomadaire n'était gardé que par déduction : la consigne dit maintenant qu'une page sans aucune date n'est pas périmée. (3) `AGENT-CLOUD.md` § 4 reprend la clôture du site et « avant la journée analysée » ; la ligne CLD30 dit ce que deviennent ses constats non réfutés. Laissé : l'heure des adjudications du Trésor, qu'un sceptique trouve sur fiscaldata.treasury.gov, domaine autorisé. Réfutés, entre autres : la date de mise à jour d'une page prise pour sa date la plus récente, une page de jours fériés jugée périmée à tort, le calendrier annuel de l'année écoulée en janvier. | `tests/agent-cloud-control.test.ts` |
| CLD32 | Relecture contradictoire de CLD31 (un relecteur sur la consigne entière, pages de l'EIA relues en direct ; deux sceptiques par constat : 5 constats, 3 maintenus par les deux sceptiques, 2 par un seul). (1) « Sa règle vaut » validait sans réserve ir.eia.gov, qui ne donne que la règle habituelle et renvoie aux jours fériés : en 2026, le rapport pétrolier passe au jeudi 12:00 après chaque lundi férié et après le mercredi 11 novembre, le rapport sur le gaz au vendredi 13 novembre et au mercredi 25 novembre. Une règle dite habituelle ne vaut plus, la semaine d'un jour férié fédéral américain, qu'une fois ses exceptions lues, faute de quoi son heure est « non consulté » ; leur lecture passe avant le contexte. (2) Le DOL manquait aux calendriers, alors que dol.gov est autorisé : les inscriptions hebdomadaires au chômage (jeudi 8:30 ET), absentes du calendrier du BLS, sortaient du recensement deux jours sur cinq. `CALENDAR_INSTITUTIONS` compte dix institutions ; la première passe prend dix pages sur quinze. Défaut antérieur à CLD29. (3) Au second échec, la consigne fermait « ce site » et marquait tout son calendrier « non consulté », même déjà lu : l'agent n'ouvre plus aucune page de l'institution, garde ce qu'il en a lu, et seul ce que la page devait donner est « non consulté ». La seconde tentative vaut pour toute page qui ne s'est pas ouverte, pas seulement un délai. | `tests/agent-cloud-control.test.ts` |

**Arbitrages pris en séance, à confirmer par l'ADMIN.**
- **Produit.** Managed Agents, par un déploiement planifié. Le Claude Agent SDK s'héberge soi-même, et une routine Claude Code se paie sur l'abonnement, pas sur les crédits API. Seul Managed Agents tourne chez Anthropic, sur les crédits, à heure fixe. Les 200 $ mensuels de Max 20x se rattachent à une organisation Console (`docs/AGENT-CLOUD.md` § 1).
- **Sens unique.** Le pont relève et n'envoie rien du desk ; la décision 7 reste entière. Donner à l'agent une donnée du desk (journal, séances) serait une décision nouvelle.
- **Clé.** Distincte de celle du modèle conversationnel, gardée par le process principal hors du coffre ; le registre des sceaux (`llm-key-seals.ts`, 64 liens) n'est pas touché.
- **Installation par le desk.** Aucun `ant apply` à faire ; la définition vit dans `electron/agent-cloud-definition.ts`.
- **Réglages par défaut.** Opus 5.5 en effort élevé ; plafond de 3,00 $ par exécution ; `0 7 * * 1-5`, `Europe/Paris` ; deux itérations du correcteur ; outils en `always_allow`, faute de client branché ; treize domaines officiels, réseau `limited`.
- **Analyse provisoire.** Brief pré-séance sur sources officielles, à remplacer par la consigne de l'ADMIN.
- **Design.** Branche issue de `design/oros` pour porter le Système 4.0. Agent IA reste « en conception » au rail (trait tireté) : le sortir est une décision produit.
- **Journal des versions.** Pas d'entrée : le numéro est à l'ADMIN, et `tests/changelog.test.ts` épingle `entriesSince` jusqu'à 3.6.0.

**Relecture contradictoire.** Cinq relecteurs (sécurité, sémantique de l'API, plan de contrôle, interface et design, conventions et preuves), deux ou trois sceptiques par constat : 43 constats, 39 confirmés, 1 contesté, 3 réfutés. Les confirmés sont corrigés par CLD13 à CLD18. Les plus lourds :
- « Oublier » laissait tourner et facturer le déploiement du desk, et une réinstallation en créait un second (relevé par quatre relecteurs).
- Les dialogues annonçaient un plafond de 3,00 $ que le déploiement n'avait pas forcément.
- Une session arrêtée à son plafond pendant l'évaluation restait « en cours » des semaines, relevée toutes les 3 min.
- Un agent ou un environnement archivé bloquait toute réinstallation.
- La conversation s'ouvrait en haut de l'historique.

Laissés en l'état :
- Contesté : le test « le statut ne porte jamais de clé » du store ne vérifie que sa propre fixture. La garantie tient ailleurs, dans les tests de l'hôte (clé absente du statut, des journaux, des envois) et dans le miroir de types.
- La flèche du clavier ne passe pas d'un sous-onglet à l'autre, comme dans Métrique.

**Seconde relecture (CLD13 à CLD18).** Trois relecteurs (cycle de vie, relevé, interface), deux sceptiques par constat : 13 constats, 8 confirmés, 4 contestés, 1 réfuté. Deux correctifs ne tenaient que dans les tests, faute de `start()` dans leur harnais : l'avertissement « installé, mais la suspension a échoué » s'effaçait au relevé suivant, une seconde plus tard ; le rattrapage par pages perdait tout au-delà de la première page dès le deuxième relevé. S'y ajoutaient un 404 lu comme « disparu » (déploiement recréé, ou dit suspendu, alors qu'une autre clé le voit peut-être encore), le plafond du dernier relevé repris quand le déploiement ne répond pas, et le clic droit qui ouvrait les liens. Tous corrigés par CLD19 à CLD21, avec les contestés : relevé lié à son déploiement, boutons de la clé figés pendant une action, cadence de la documentation.

**Constats hors périmètre.** `tests/agent-refusal-label.test.ts` et `tests/mcp-resume.test.ts` importent `@/store/agent` dans le corps du test. Quand le cache de transformation est froid, cet import dépasse le délai de 5 s du test (vu dès la ligne de base, avant tout changement de la branche ; deux passages suivants verts). Piste : importer dans un `beforeAll`. `tests/bridge-symlink.test.ts` échoue sous Windows sans le droit de créer un lien symbolique (EPERM, connu).

**Vérifications.** `npm run typecheck`, `npm test`, `npm run build`, `npm run electron:compile`. Non vérifié : le desk lancé (la porte de déverrouillage est à l'ADMIN) et une exécution réelle chez Anthropic (clé et crédits de l'ADMIN).

**Recette de l'ADMIN, desk lancé.**
1. Rattacher les crédits Max à l'organisation Console (claude.ai › Réglages › Facturation), puis créer une clé API dans cette organisation.
2. Agent IA › D · Lab (au seul siège du Lab, depuis LAB3) : coller la clé, puis *Enregistrer*. Attendu : « enregistrée · chiffrée par le trousseau du système ».
3. *Installer l'agent cloud*. Attendu : un dialogue, *Annuler* par défaut ; choisir *Installer en pause*. La plaque passe « En pause », la bande d'état aussi.
4. *Lancer maintenant*. Attendu : un dialogue qui dit « plafond 3,00 $ par exécution » ; *Lancer*. Rapports : « En cours · 1 session », relevé toutes les 3 min.
5. Après la session (une dizaine de minutes), une fiche `AGT-RPT-…` arrive, avec la LED, et le rail dit « 1 rapport non lu ». L'ouvrir : sources en https, hôte à côté de chaque lien, un lien ouvert dans le navigateur du système.
6. Console Anthropic : la session, son coût, et le fichier `rapport.json`.
7. *Reprendre* (dialogue) pour planifier ; ou *Quitter*, qui suspend le déploiement avant de le laisser.

## Publication de la 3.7.0 (2026-10-26)

L'ADMIN confie la préparation de la 3.7.0 : le Système 4.0 « ΟΡΟΣ » (fusion de la Ligne V2 « Poinçon » et du Système 3.4, décrit dans `docs/DESIGN.md`), appliqué au desk et au lanceur AUBE par les tickets OROS1.1 à OROS3.12 (#120), entre dans la Release. Il valide la Release avant sa publication et la signe lui-même.

| Piste | Ce qui change |
|---|---|
| **Version** | `package.json` et les deux entrées racine de `package-lock.json` à 3.7.0. |
| **Journal** | Entrée 3.7.0 de `src/engine/changelog/changelog.json` : cinq points en français, anglais et espagnol, qui ouvrent aussi les notes de Release. `tests/changelog.test.ts` et `tests/release-notes.test.ts` épinglent 3.7.0. |
| **README** | Badge de version et les deux cartouches à 3.7.0 ; « What's new in 3.7.0 » (les cinq points anglais du journal, mot pour mot sous leurs titres en gras) ; liens de téléchargement et commandes d'installation vers les fichiers de la v3.7.0 ; ligne 3.7.0 en tête de « Versions », l'ancre `whats-new-in-360` passe sur la ligne 3.6.0. Les captures datent encore du Système 3.4. |

**Vérifications.** `npm run typecheck`, `npm run build` et `npm run electron:compile` verts ; `npx vitest run` : un seul rouge, `tests/bridge-symlink.test.ts` (`EPERM` : ce poste n'a pas le droit de créer un lien symbolique, préexistant). `tests/dompurify-floor.test.ts` lit `node_modules` et passe après `npm ci`.

**Points ouverts.**
- README : les captures et le badge (ancien rouge) datent du Système 3.4 ; à recapturer après publication.
- Entre la fusion de ce commit et la publication, les liens de téléchargement du README mènent à des fichiers que seule la Release en brouillon porte.
- Le Code 128 du lanceur et du bilan du Portefeuille n'a pas encore été lu au téléphone (la barre d'état porte désormais le code d'accolades d'OROS3.14, qui ne se lit pas).
- Crypto : la cible ⊕ au bout de chaque ligne d'alerte du chart n'est pas posée (les lignes sont tiretées et titrées ALERTE).
- #119 (agent cloud) touche aussi `src/modules/agent/Agent.tsx` : une résolution de conflit pour la branche qui arrive en second.

**Agent cloud dans la 3.7.0 (2026-10-26).** #119 est entré dans `design/oros` une minute avant que #121 ne monte `main` en 3.7.0 : la 3.7.0 de `main` portait ΟΡΟΣ sans l'agent cloud. La branche `release/3.7.0-agent-cloud` part de `main` et y fusionne `design/oros` (conflit de cette page seulement : les deux sections gardées). Le journal 3.7.0 garde cinq points, la borne du validateur que lisent aussi les desks déjà installés (`src/engine/changelog/index.ts:69`, un sixième rendrait le journal de la Release illisible pour eux) : signature du Lab et sceau ne font plus qu'un point, et l'agent cloud avec le dossier des rapports d'Agent IA prend le quatrième, repris mot pour mot dans le README. Le desk du poste de l'ADMIN est installé depuis cette branche (NSIS x64, installation silencieuse). Pourquoi l'option « Mettre à jour » n'apparaissait plus : le desk installé (3.6.0) et la dernière Release publiée (v3.6.0) sont à la même version ; le lanceur cache le bouton et le desk affiche « v3.6.0 » quand rien n'est plus récent. Elle reviendra sur les autres postes avec la Release v3.7.0 signée par l'ADMIN.

**Pied du desk (2026-10-26, demande de l'ADMIN).** Le Code 128 du pied était bien trop grand, et la bande ivoire rompait le noir du châssis. OROS3.13 rend à la barre d'état le noir de la barre de titre (jetons du desk, l'or redevient l'or). OROS3.14 remplace le Code 128 par un code d'accolades, `{` onze barres `}` : largeurs de 1 à 3 px tirées à chaque ouverture du desk, de somme fixe (le code garde sa place, le geste du siège s'y règle). Le geste est inchangé : deux secondes sur le code, il s'éveille en `<insert code>`, et le nom du siège sort à gauche des barres, à l'or. Le vrai Code 128 `SK-ART-002-{version}` reste au lanceur et au bilan du Portefeuille ; arbitrage : la bande ivoire du lanceur AUBE reste telle quelle, la demande visant le pied du desk ; l'ADMIN peut l'étendre au lanceur. Le deuxième point du journal 3.7.0 et le README le disent.

**La 3.7.0 sans l'agent cloud (R3.7b, 2026-10-26).** L'ADMIN publie la 3.7.0 sans parler de l'agent cloud, destiné à la version suivante : son point quitte le journal (FR, EN, ES) et le README, qui en gardent quatre ; les notes de la Release, tirées du journal, suivent. Le code reste, et le pilotage n'est visible qu'au siège du Lab (LAB2, LAB3) : un desk de testeur ne voit que le dossier, vide tant que rien n'est publié.
