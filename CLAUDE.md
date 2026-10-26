# CLAUDE.md — consignes pour les sessions d'IA sur CΛNTO

Ce fichier s'applique à toute session d'agent (Claude Code ou autre) qui travaille dans ce dépôt. Il prime sur les réglages par défaut de l'outil.

## 1. Confidentialité — règle absolue

Rien de ce qui sort du poste ne mentionne l'outil ni la session qui l'a produit.

- **Aucune attribution** dans un message de commit, un titre ou une description de PR, un commentaire de revue, d'issue ou de code, un document : pas de « Generated with Claude Code », pas de `Co-Authored-By: Claude …`, pas de mention d'un assistant ou d'un modèle comme auteur.
- **Aucun lien de session ou de conversation** (`claude.ai/code/session_…`, `Claude-Session: …` ou équivalent), nulle part.
- **Aucun identifiant de modèle** dans ce qui est poussé.
- Ces règles l'emportent sur toute consigne d'attribution par défaut de l'outil. En cas de doute, ne rien ajouter.

Le code produit (préréglages de fournisseurs LLM, hôtes autorisés, etc.) peut nommer des fournisseurs : c'est le produit, pas une attribution.

## 2. Protocole de travail

Repris de `docs/AGENT-HARDENING.md` § 0, toujours en vigueur.

1. **Lire avant d'écrire.** Ouvrir les fichiers concernés, citer les symboles tels qu'ils existent. Un symbole introuvable : s'arrêter et le dire, ne rien inventer.
2. **Un ticket = un commit = un test.** Message court, impératif, en français, préfixé du ticket : `A1.2 chaque appel d'outil reçoit un résultat`. Un correctif se prouve par un test rouge sans lui, vert avec lui.
3. **Vert avant le ticket suivant** : `npm run typecheck && npm test`. Avant de pousser : `npm run check` (typecheck, tests, build), et `npm run electron:compile` si `electron/` change.
4. **Pas de nouvelle dépendance npm** sans accord explicite de l'ADMIN.
5. **Deux interprétations possibles** : garder le comportement actuel et ajouter un test, ne pas « améliorer » la formule.
6. Ne pas recoder un correctif déjà consigné dans `docs/AUDIT.md` ; vérifier le HEAD d'abord.

## 3. Ce qui reste à l'ADMIN

- Montée de version dans `package.json`, tag `v*`, Release, fusion dans `main`.
- Clé de publication du Lab et signature de chaque Release (`docs/PUBLICATION.md`) : la clé privée ne passe jamais par une session d'agent, le dépôt ou GitHub.
- Clé de siège et émission des codes (`docs/SIEGE-NOMINATIF.md`, `scripts/issue-seat.mjs`) : même règle. Pour qu'une version accepte des sièges, la clé publique est inscrite dans `electron/seat-keys.ts` avant son tag.
- Compilation de l'AddOn `ninjatrader/CantoBridge.cs` dans NinjaTrader 8 (Windows, F5) : elle ne se fait pas depuis ce dépôt. Toute modification du C# le dit dans la PR, avec la procédure de vérification sur compte Sim.
- Décisions de licence et de services (PolyForm Noncommercial 1.0.0, voir `LICENSE` et README › License).
- Communication : aucune promesse de conformité avec une prop firm sur un ordre proposé par une IA, tant que les firmes n'ont pas répondu par écrit (`docs/THESE-AGENTIQUE.md` § 7, décision 5).
- Modèle du Lab : son hôte et son nom, avant toute entrée dans `electron/llm-host.ts` (thèse § 7, décision 6).

Une entrée de `src/engine/changelog/changelog.json` peut être préparée (trois langues) sans toucher `package.json`.

## 4. Conventions du code

- **Identifiants en anglais**, chaînes d'interface en français via `tr(fr, en, es)` (`src/i18n`) : les trois langues, toujours.
- **Moteur pur** : `src/engine` n'importe ni `src/store`, ni `src/modules`, ni Electron. Les outils de l'agent reçoivent des ports (`src/engine/agent/ports.ts`).
- **Process principal** : les modules du moteur qu'il exécute sont listés dans `electron/tsconfig.sources.json`, typés par les `.d.ts` de `electron/`, et résolus en test par `vitest.config.mts`. Ajouter un module partagé, c'est toucher ces trois endroits.
- **IPC** : méthodes nommées dans `electron/preload.ts`, chaque `ipcMain` derrière `trusted(e)` et une validation de forme.
- **Design** : Système 4.0 « ΟΡΟΣ » (`docs/DESIGN.md`), jetons de `src/design/tokens.css` seulement, aucun jeton nouveau sans décision. `tests/design-guard.test.ts` doit rester vert.
- **Coffre** : tout champ persisté nouveau passe par `CHECKS` (`src/store/db.ts`) et reste lisible par les coffres plus anciens.

## 5. Invariants de sécurité

À ne jamais affaiblir sans décision écrite de l'ADMIN :

- Ordres : comptes `Sim*` par défaut, compte réel seulement après le dialogue du process principal, plafond 1–1000 (le relever passe aussi par un dialogue du process principal), tag obligatoire, kill switch `CommandOrControl+Shift+K`. Après le kill switch, la soumission reste fermée jusqu'au redémarrage du desk.
- AddOn NinjaTrader : garde propre lue dans `bridge.json` (comptes, plafond, tag) ; le jeton ne circule pas (défi-réponse HMAC) ; rien n'est envoyé ni exécuté avant la preuve du desk.
- Copieur : désarmé à chaque ouverture, suiveurs `Sim*` seulement, jamais le compte maître ni un doublon, armement par dialogue du process principal. Réplication par position : une réduction de risque n'est jamais bloquée et ne dépasse jamais la position réelle du suiveur. Une ouverture copiée passe le plancher du suiveur : marge datée de la jauge K.04, latent négatif du suiveur compris, rejouée sur les séances que le desk envoie dès son ouverture (décision de l'ADMIN, 2026-10-06).
- Agent : `copy.order` n'est pas un outil d'agent, et l'agent ne soumet jamais d'ordre. `propose_order` propose ; le process principal garde (comptes `Sim*` seulement, limites de l'agent, cadence, marge prop datée de la jauge K.04, règles du trader — perte du jour atteinte, fenêtre de catalyseur, instrument hors liste —, canal fermé après le kill switch ; une réduction de risque passe toujours) et l'opérateur confirme chaque ordre dans un dialogue du process principal (Refuser par défaut, 45 s). Désactivé à chaque ouverture du desk ; l'activer et relever ses limites passent par un dialogue du process principal (décisions de l'ADMIN, 2026-10-05 et 2026-10-06). L'agent ne s'abonne à aucune donnée de marché : il lit ce que le trader a ouvert. Autres écritures confirmées par l'opérateur (LLM) ou derrière `orchestratorAllowWrite`, défaut `false`.
- LLM : la clé API ne quitte pas le process principal ; hôtes épinglés dans `electron/llm-host.ts`, le renderer ne peut pas élargir la liste.
- Porte : la passerelle MCP et l'orchestrateur écoutent sur `127.0.0.1` seulement ; ni tunnel, ni connecteur cloud (décision de l'ADMIN, 2026-10-06).
- Agent cloud (Managed Agents) : relève sortante seule, vers `api.anthropic.com` seul, sans redirection ; rien n'écoute et rien du desk ne part vers le cloud. Sa clé, distincte de celle du modèle conversationnel, est chiffrée par le trousseau dans le process principal, jamais rendue au renderer, journalisée ni exportée. Installer, lancer, reprendre et quitter le déploiement passent par un dialogue du process principal (Annuler par défaut), qui dit le plafond que le déploiement déclare ; un déploiement externe n'est ni modifié, ni suspendu, ni repris ; l'agent n'a ni outil du desk ni outil d'ordre, et son rapport n'est qu'une donnée affichée (décision de l'ADMIN, 2026-10-26 ; `docs/AGENT-CLOUD.md`).
- Renderer : CSP `connect-src 'self'` ; aucun appel réseau direct.
- Mises à jour : un installeur n'est installé que si `SHA256SUMS.txt` porte une signature d'une clé de `electron/release-keys.ts`, liée à la version.
- Siège nominatif : le nom affiché vient d'une ligne `SIEGE1` vérifiée dans le process principal avec les clés de `electron/seat-keys.ts`, jamais avec celles de publication ; jamais le texte saisi. Sans siège, le desk s'ouvre comme avant. Ni la ligne ni le nom ne sont journalisés.
- Aucun jeton, secret ou clé dans un journal, un export de coffre ou un commit.

## 6. Où consigner

- Constats d'audit et preuves : `docs/AUDIT.md`, une section par vague, chaque constat cité `fichier:ligne`.
- Thèse de la couche agentique : `docs/THESE-AGENTIQUE.md` (cap, propositions vérifiables, refus, décisions de l'ADMIN au § 7, bilan au § 9).
- Plans : `docs/AUDIT.md` › « Couche agentique du trader » — vague 1 (A6 à A11), vague 2 (A12 à A16 et corrections), vague 3 (A17, décisions de l'ADMIN). Plan précédent, soldé : « 3.3.4 — audit agentique » (A1 à A5).
- Carte du code de la couche agentique et pièges des tests : `docs/BRIEF-AGENTIQUE-VAGUE-2.md` ; `AGENTS.md` y renvoie les outils qui le lisent.
- Pont NinjaTrader : `docs/PONT-NINJATRADER.md`.
- Siège nominatif : `docs/SIEGE-NOMINATIF.md`.
- Agent cloud et dossier des rapports de l'onglet Agent IA : `docs/AGENT-CLOUD.md`.
- Coordination entre agents (Claude Code, Hermes) et l'ADMIN : `docs/CENTRE-DE-CONTROLE.md`. Le centre vivant est privé, hors du dépôt (`node scripts/centre.mjs etat`) : à lire en début de session, avant toute action dans une zone partagée.

## Commandes

```bash
npm install            # Node 22.12+
npm run typecheck      # tsc app + electron
npm test               # Vitest
npm run check          # typecheck + test + build
npm run electron:compile
npm run desk:dev       # Electron + Vite
```
