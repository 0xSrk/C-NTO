**`SIΞRRΛSKΛ—LAB · FORGE · DOCTRINE ET LIGNE · RÉV. 1 · 2026-10-03`**

# La Forge — doctrine de SIΞRRΛSKΛ et ligne de CΛNTO

Révision 1 du 3 octobre 2026. Ce document fixe l'essence du Lab, la place de CΛNTO (Artefact 002) dans sa trajectoire, et les lignes que le dépôt suit désormais. Il prévaut sur la section *Roadmap* du README. Il ne remplace ni `DESIGN.md` (Système 3.4), ni `AUDIT.md` (gel 3.0.0 et correctifs), ni `PONT-NINJATRADER.md` (protocole du pont) : il leur donne une direction.

Il est écrit pour trois lecteurs : l'ADMIN, qui décide ; Claude, qui conçoit, implémente et audite ; les systèmes du Lab (typecheck, tests, CI, Release), qui tranchent. Un agent d'implémentation lit ce document avant tout ticket, après le protocole § 0 d'`AGENT-HARDENING.md`.

---

## 00. Invariants

Ce qui ne se discute pas, quelle que soit la révision.

| # | Invariant | Conséquence dans le code et dans la conduite |
|---|---|---|
| I.1 | La direction est l'ADMIN, Claude et les systèmes du Lab. Jamais de cofondateur, jamais de direction partagée. | Aucune décision d'architecture ou de périmètre n'attend un tiers. Un auditeur relit ; il ne tranche pas. |
| I.2 | Zéro capital externe. La seule entrée extérieure est l'acquisition d'un artefact possédé par le Lab. | Chaque palier se finance par ce qu'il livre. Une brique qui ne peut vivre sans levée n'est pas une brique du Lab. |
| I.3 | La Forge ne se vend pas. Seul un artefact se vend. | Le dépôt d'un artefact est autonome : il doit pouvoir être cédé sans emporter la méthode, les outils, ni les autres artefacts. |
| I.4 | Local-first, non-custodial. Le Lab ne détient ni fonds, ni clés, ni ordres pour compte de tiers, et n'opère aucun serveur obligatoire. | Pas de télémétrie, pas de compte utilisateur, pas de backend du Lab sur le chemin d'un ordre. Les garde-fous vivent sur la machine de l'utilisateur. |
| I.5 | Un artefact, un mécanisme. | Chaque artefact répond à une question. CΛNTO : « que vaut mon trading, et comment le répliquer sans me faire sortir d'une prop firm ». |
| I.6 | Preuve avant croyance. | Rien n'est « livré » sans test, vecteur ou utilisateur réel. `npm run check` est la commande de vérité ; la Release signée (`SHA256SUMS.txt`) est l'acte. |
| I.7 | Périmètre strict. | Un artefact n'absorbe pas les besoins d'un autre. Ce qui dépasse son mécanisme devient un autre artefact, ou rien. |

---

## 01. Essence — ce qu'est SIΞRRΛSKΛ

### Un opérateur, des systèmes

Le Lab tient sur une thèse : un seul opérateur, épaulé par des intelligences et des systèmes de vérification, produit plus et mieux qu'une organisation. CΛNTO en est la première preuve mesurable : 28 700 lignes de TypeScript, environ 300 tests, un protocole d'ordres gardé, trois systèmes d'exploitation, un système visuel complet — sans équipe ni capital.

La thèse a une frontière, et la Forge la connaît. Elle est vraie partout où le goulot est la production : code, moteur, design, documentation, audit. Elle est fausse partout où le goulot est la distribution, la confiance, la liquidité ou la réglementation : ces choses ne se produisent pas, elles s'accumulent. Un artefact du Lab doit donc être conçu pour que son adoption soit une propriété de l'artefact, pas un effort de l'opérateur.

### Trois étages, un seul se vend

| Étage | Ce que c'est | Ce que ça rapporte | Plafond | Cessible |
|---|---|---|---|---|
| La Forge | L'ADMIN, Claude, les systèmes, la méthode (§ 05), le Système 3.4, la marque | La capacité de produire, et sa preuve publique | — | Jamais |
| Artefacts clients | Livrables sur mesure, conçus pour l'usage d'un client | Trésorerie, portfolio, réputation | Millions | Au client, par le contrat |
| Artefacts possédés | Mécanismes que le Lab détient et fait grandir | La position : utilisateurs, flux, standard | Milliards, si la position existe | Oui — c'est la seule sortie du Lab |

Le monopole visé n'est pas un monopole de « production sur mesure » : un service se copie. Il tient en deux choses. D'abord la preuve publique, cumulative et datée, qu'un seul opérateur livre en dix jours ce qu'une équipe livre en six mois — c'est une marque, elle se construit artefact après artefact et ne se cède pas. Ensuite la position prise par un artefact possédé : le mécanisme dont d'autres dépendent. La première rend la seconde possible ; seule la seconde se vend.

### Ce qui rend un artefact possédé acquérable

Un acquéreur n'achète jamais l'écran. Il achète des utilisateurs captifs, du flux, une dépendance technique ou un standard. Le critère de conception d'un artefact possédé est donc unique : le deuxième utilisateur vient parce que le premier est là. Un desk ne compose pas. Un rail compose. CΛNTO est un desk ; sa valeur pour le Lab est ailleurs (§ 02).

---

## 02. CΛNTO — le cheval

### Origine et état

CΛNTO est né pour réduire les coûts d'outillage de traders proches du Lab, et pour éprouver la Forge sur un artefact complet. L'ADMIN est le seul trader fondateur ; le premier testeur est un trader financé chez Apex, qui trade sur NinjaTrader 8 en direct : le pont NT8 le couvre sans adaptateur supplémentaire, et le plan Apex est déjà dans le registre prop. Au 3 octobre 2026 il est en v3.2.2 : sept modules sur le rail (`01 MET` à `07 BOT`), le Copieur hors rail, un coffre local, un pont NinjaTrader 8 à deux transports avec canal d'ordres gardé (comptes `Sim*`, plafond, tag obligatoire, kill switch sous 200 ms), un agent à outils et confirmation d'écriture, le Système 3.4, trois installeurs natifs, licence MIT.

### Ce qu'il vaut, et ce qu'il ne vaut pas

Comme produit : un desk local sérieux et complet, au-dessus des journaux amateurs, au niveau des journaux SaaS sur la métrique — mais local, gratuit et sans télémétrie —, derrière NinjaTrader, Tradovate ou TradingView sur la donnée et le courtage, qu'il ne cherche pas à remplacer. Sur la copie multi-comptes, la référence du marché NT8 est Replikanto ; c'est la barre.

Comme actif : zéro. Aucun utilisateur mesuré, aucun flux, aucun effet de réseau. Ce n'est pas un défaut : ce n'est pas son rôle.

### Trois rôles, par ordre d'importance

1. **Preuve n°1 de la Forge.** Le dépôt est public, daté, audité. Il est la première ligne du portfolio et le gabarit de tout artefact suivant : structure, tests, vecteurs, Release, docs.
2. **Porte d'entrée.** Les traders prop sur CME sont la première communauté du Lab. Ils arrivent par le desk gratuit ; ils restent par le Copieur. Ce sont eux qui, plus tard, suivront le Lab vers le rail.
3. **Banc d'essai du rail.** Chaque brique de l'Artefact 003 (§ 04) se conçoit, se teste et se durcit d'abord ici, sur un marché régulé, en Sim, avec un faux AddOn et des vecteurs — avant de toucher un marché où une erreur coûte des fonds.

### Ce qui ne change pas

- Le périmètre : futures CME, prop firms. La crypto reste hors du desk (gel 3.0.0, « hors périmètre définitif » dans `AUDIT.md`). Le pont vers la crypto est un autre artefact, pas un onglet.
- Local-first, aucune télémétrie, aucun serveur du Lab. Le journal reste sur la machine.
- Le Système 3.4, la marque, la plaque signature, le numéro d'artefact.
- La licence MIT sur le code ; les noms et l'identité restent au Lab.
- Le protocole d'implémentation d'`AGENT-HARDENING.md` § 0 : lire avant d'écrire, un ticket = un commit, commandes de vérité, rien d'inventé.
- L'agent ne soumet jamais d'ordre dans CΛNTO. `copy.order` n'est pas un outil d'agent. Les ordres passent par le pont et ses gardes.

---

## 03. Lignes — ce qui est redéfini

| Ligne | Avant (3.2.2) | Désormais | Ce que ça sert |
|---|---|---|---|
| L.1 — Port d'exécution | `order.submit`, `order.cancel`, `order.flatten` et leurs gardes vivent dans `electron/nt-bridge/` ; le pont NT8 est l'architecture. | Un `ExecutionPort` dans `src/engine/execution/port.ts`, au modèle de `MarketDataPort` : `submit`, `cancel`, `flatten`, `positions`, `status`, capacités déclarées, gardes génériques (compte autorisé, plafond, tag, état du lien, kill switch) en TypeScript pur et testées par vecteurs. NT8 devient l'adaptateur n°1 ; `fake-addon` reste le double de test. | Le rail (§ 04) réutilise le port tel quel. La cession d'un futur artefact n'emporte pas le pont NT8. |
| L.2 — Copieur | Prototype hors rail : topologie, sizing, filtres, blackout, kill switch, aucune réplication. Première ligne du Roadmap. | Le Copieur est un **routeur** sur `ExecutionPort` : fill maître → ordres suiveurs dimensionnés, filtrés, soumis à la politique prop du suiveur (`evaluatePlan`), armé par défaut à `off`, coupé par le kill switch global. Il tourne dans le process principal (hôte du pont), jamais dans le renderer. Il revient sur le rail en `08 · CPY` à la 3.3.0. **Livré dans le code de la 3.3.0 (Forge 1, Sim seulement).** La Release taguée reste l'acte de l'ADMIN. | La douleur monétisable des traders prop (5 à 20 comptes financés) et le premier revenu du Lab. Aussi, mot pour mot, le cœur du rail. |
| L.3 — Agent | Prototype : outils de lecture, deux écritures confirmées, listes `ORCH_READ_METHODS` et `ORCH_WRITE_METHODS`, bornes d'arguments, préambule « données non fiables », limites par tour. | Ces règles deviennent une **spécification écrite** : `docs/PROTOCOLE-AGENT.md` — schéma d'action, permissions par niveau (lire, écrire, proposer un ordre, exécuter), limites de risque, confirmation, kill switch, journalisation. CΛNTO l'implémente jusqu'au niveau « proposer » : l'agent prépare un ordre pour le Copieur, l'ADMIN le confirme, le pont l'envoie. Jamais au-delà dans ce dépôt. | Personne ne possède encore « comment un agent trade des dérivés sans se faire liquider ». Le protocole se durcit ici, en Sim, sur CME ; il s'exporte ensuite. |
| L.4 — Métrique | Journal, rejeu prop, Monte Carlo. Export de coffre `canto-vault-v2`. | Métrique devient la couche de **certification** : export signé d'un historique (SHA-256 de la série de séances et des identifiants d'exécution persistés, déjà présents), vérifiable hors du desk sans révéler le journal. Un trader, ou un agent, peut prouver un historique. | Le track record certifié est ce qui, demain, classe les agents sur le rail, et ce que les prop firms veulent acheter (détection d'abus, risque de payout). |
| L.5 — Bot | Conception, deux gabarits, garde-fous imposés. | Gelé jusqu'à la livraison de L.2. Ses garde-fous (circuit breaker, perte journalière, plat à 16:59 ET, blackout) sont repris tels quels comme **politiques** du protocole L.3. | Le Bot ne sert pas la trajectoire ; ses règles, si. |
| L.6 — Modèle économique | Tout gratuit, MIT, aucun mécanisme de revenu. | Le desk reste gratuit et MIT, à jamais. La réplication du Copieur est la première brique payante : licence par poste, clé vérifiée hors ligne, sans serveur ni compte du Lab, sans télémétrie. Le prix suit la douleur, pas le coût. | I.2 : chaque palier se finance. Un desk gratuit qui attire, une réplication payante qui retient. |
| L.7 — Moteur extractible | `src/engine` est du TypeScript pur, indépendant de l'interface, mais lié au dépôt. | Le moteur (métrique, prop, Monte Carlo, ports, protocole) est tenu de sorte à pouvoir être extrait en paquets partagés entre artefacts, sans l'interface. Aucun import du moteur vers `src/store` ou `src/modules` ; `agent/tools.ts` reçoit ses ports, jamais les stores. | Le rail hérite du moteur sans hériter du desk. I.3 : un artefact se cède seul. |
| L.8 — Communauté | Deux utilisateurs connus. | Un canal public (GitHub Discussions ou Discord), un seul, tenu par l'ADMIN, seul trader fondateur ; le trader testeur (Apex, NT8) comme premier relais. La première preuve de passage (§ 04) est comptée là, pas dans un tableau de bord. | La distribution ne se produit pas : elle s'accumule. Elle commence au jour 1 de la 3.3.0, pas après. |

---

## 04. Direction — paliers et preuves de passage

Le Lab ne planifie pas en trimestres : il planifie en **forges de dix jours** (§ 05), et il n'avance au palier suivant que sur preuve. Une preuve absente n'est pas un échec : c'est l'ordre de capitaliser ou de vendre le palier atteint (I.2).

| Palier | Objet | Forges | Preuve de passage |
|---|---|---|---|
| P.0 — Le cheval se complète | `ExecutionPort` (L.1), réplication du Copieur en Sim (L.2), journal certifié (L.4), `PROTOCOLE-AGENT.md` (L.3). Release **3.3.0**. | Forge 1 (J1–J10) : L.1 et L.2 en Sim. Forge 2 : L.4, L.3, puis Copieur sur compte réel après confirmation. | E2E `fake-addon` : un fill maître → ordres suiveurs dimensionnés, blackout respecté, politique prop appliquée, Couper < 200 ms. Puis le trader testeur réplique via NT8 : Sim101 d'abord, puis ses comptes Apex (évaluation, puis financés) derrière le dialogue de confirmation de compte réel du pont, dans les règles de la firme sur les copieurs, à vérifier avant la vente de la brique. |
| P.1 — La porte s'ouvre | Communauté (L.8), licence Copieur (L.6), l'adaptateur n°1 (NinjaTrader 8, par lequel passent déjà les comptes Apex) couvre le premier public ; un adaptateur n°2 (ProjectX, Tradovate ou Rithmic en direct — chacun a ses conditions d'accès, aucun n'est acquis) seulement si la communauté l'exige, une forge par adaptateur. | 3 à 6 forges. | 100 desks ouverts chaque jour, comptés par la communauté et les activations. Ensuite 2 000 licences actives. Sans ces chiffres, pas d'Artefact 003 : un rail sans passagers ne transporte rien. |
| P.2 — Artefact 003, le rail | Dépôt distinct. La couche d'exécution pour agents sur perps on-chain : `ExecutionPort` + protocole L.3 + Copieur comme routeur multi-portefeuilles + journal certifié, pointés vers un venue non-custodial qui rémunère les interfaces (Hyperliquid et ses builder codes aujourd'hui). Une page, pas un desk. Géo-blocage dès le jour 1. | Forge 3 : dix jours, mainnet avec les fonds de l'ADMIN au jour 9, publication au jour 10. | Un volume routé qui couvre le Lab : quelques dizaines de millions par jour. La communauté de CΛNTO comme premiers passagers. |
| P.3 — Le standard | Le protocole L.3 publié et adopté hors du Lab ; place de marché d'agents à historique certifié ; données de comportement d'agents vendues aux prop firms et aux venues. | Continu. | Au moins deux produits externes bâtis sur le protocole ; au moins un venue qui l'intègre. |
| P.4 — La sortie | Seul l'Artefact 003 est cessible. Acheteurs naturels : les géants de la crypto-finance (Coinbase, Kraken, Stripe, Robinhood), qui achètent du flux, des utilisateurs et des standards. Les géants du logiciel n'achètent pas de crypto ; ils achètent de la capacité, et jamais celle d'un seul. | — | 2,5 Md$ à 15–25× exigent 100 à 170 M$ de revenus, ou une prime stratégique pour une position dominante. Seule la seconde est à la portée du Lab ; elle exige P.3. |

Ce qui est vrai à chaque palier : la Forge reste au Lab ; CΛNTO reste au Lab tant qu'il est la porte ; le palier atteint se finance seul.

---

## 05. La Forge — cadence et méthode

### La forge de dix jours

Unité de production du Lab. Une forge produit une brique complète — testée, documentée, publiée — ou un artefact entier.

| Jour | Acte | Système qui tranche |
|---|---|---|
| J1 | Spécification : question, mécanisme, périmètre, ce qui est refusé. Carte du code existant. | Relecture ADMIN |
| J2–J7 | Implémentation par tickets. Un ticket = un commit = un test. | `npm run typecheck && npm test` à chaque ticket |
| J8 | Audit en nuée : moteur, interface, performance, sécurité, design, chacun en lecture seule, chaque constat vérifié dans le code. | `docs/AUDIT.md` |
| J9 | Preuve : vecteurs, E2E, puis usage réel (Sim, puis compte réel, puis utilisateur). | `vectors/`, E2E |
| J10 | Release signée, journal de version en trois langues, documentation, annonce à la communauté. | CI trois OS, `SHA256SUMS.txt` |

Une forge qui dépasse dix jours a mal découpé son mécanisme : on coupe la brique, pas la cadence.

### Rôles

- **L'ADMIN** décide du périmètre, confirme chaque acte irréversible (compte réel, Release, prix, publication), tient la communauté, tranche.
- **Claude** spécifie, implémente, audite, documente — dans le protocole d'`AGENT-HARDENING.md` § 0, étendu à tout le Lab. Il propose ; il ne tranche ni le périmètre, ni le réel.
- **Les systèmes** — typecheck, Vitest, vecteurs, CI, Release, gardes du pont — sont les seuls juges du « livré ». Ce qu'ils n'ont pas vu n'existe pas.

### Règles de la Forge

1. Lire avant d'écrire. Citer les symboles existants. Un symbole absent arrête le ticket.
2. Rien d'inventé : pas de dépendance, de module, de transport, de firme, d'indicateur ni de refonte hors spécification.
3. Toute brique naît avec son test et, si elle calcule, son vecteur.
4. Les secrets ne touchent ni le dépôt, ni les journaux, ni le coffre.
5. Identifiants en anglais, interface et documents en français, Système 3.4.
6. Une question avant toute fonctionnalité : sert-elle le cheval (utilisateurs), le rail (exécution, protocole) ou la preuve (certification) ? Sinon, non.
7. La documentation est un livrable : un artefact sans README, sans audit et sans journal de version n'est pas livré.

---

## 06. Mesures

Le Lab ne mesure pas ses utilisateurs à leur insu (I.4). Il compte ce que les utilisateurs font volontairement, et ce que ses systèmes produisent.

| Ce qui est compté | Source | Sert |
|---|---|---|
| Téléchargements par Release | GitHub Releases | P.1 |
| Membres et actifs de la communauté | Canal public | P.1 (100 desks par jour) |
| Licences actives du Copieur | Activations hors ligne, comptées à l'émission | P.1 (2 000), I.2 |
| Historiques certifiés publiés | Exports signés partagés par leurs auteurs | P.3 |
| Forges livrées, tests, audits | Dépôt, CI | La preuve de la Forge |
| Volume routé (Artefact 003) | Chaîne, builder code | P.2, P.3 |

---

## 07. Ce document

- Révision 1, 3 octobre 2026. Prévaut sur README › *Roadmap*, qui devra renvoyer ici.
- Modifié par l'ADMIN seulement ; chaque révision est datée et motivée.
- `AGENT-HARDENING.md` (17 septembre, v1.1.1) garde son protocole § 0 ; sa liste d'interdits est périmée là où le README 3.2.2 la contredit : le transport WebSocket et le canal d'ordres existent, et la réplication du Copieur est désormais autorisée par L.2.
- Fichiers appelés par cette révision : `src/engine/execution/port.ts` (L.1), `docs/PROTOCOLE-AGENT.md` (L.3), module `08 · CPY` sur le rail (L.2), export certifié dans Métrique (L.4).

**`SIΞRRΛSKΛ—LAB · FORGE · RÉV. 1 · LA FORGE NE SE VEND PAS · SEUL L'ARTEFACT SE VEND`**
