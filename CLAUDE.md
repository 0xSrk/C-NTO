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
- Compilation de l'AddOn `ninjatrader/CantoBridge.cs` dans NinjaTrader 8 (Windows, F5) : elle ne se fait pas depuis ce dépôt. Toute modification du C# le dit dans la PR, avec la procédure de vérification sur compte Sim.
- Décisions de licence et de services (PolyForm Noncommercial 1.0.0, voir `LICENSE` et README › License).

Une entrée de `src/engine/changelog/changelog.json` peut être préparée (trois langues) sans toucher `package.json`.

## 4. Conventions du code

- **Identifiants en anglais**, chaînes d'interface en français via `tr(fr, en, es)` (`src/i18n`) : les trois langues, toujours.
- **Moteur pur** : `src/engine` n'importe ni `src/store`, ni `src/modules`, ni Electron. Les outils de l'agent reçoivent des ports (`src/engine/agent/ports.ts`).
- **Process principal** : les modules du moteur qu'il exécute sont listés dans `electron/tsconfig.sources.json`, typés par les `.d.ts` de `electron/`, et résolus en test par `vitest.config.mts`. Ajouter un module partagé, c'est toucher ces trois endroits.
- **IPC** : méthodes nommées dans `electron/preload.ts`, chaque `ipcMain` derrière `trusted(e)` et une validation de forme.
- **Design** : Système 3.4 (`docs/DESIGN.md`), jetons de `src/design/tokens.css` seulement, aucun jeton nouveau sans décision. `tests/design-guard.test.ts` doit rester vert.
- **Coffre** : tout champ persisté nouveau passe par `CHECKS` (`src/store/db.ts`) et reste lisible par les coffres plus anciens.

## 5. Invariants de sécurité

À ne jamais affaiblir sans décision écrite de l'ADMIN :

- Ordres : comptes `Sim*` par défaut, compte réel seulement après le dialogue du process principal, plafond 1–1000 (le relever passe aussi par un dialogue du process principal), tag obligatoire, kill switch `CommandOrControl+Shift+K`. Après le kill switch, la soumission reste fermée jusqu'au redémarrage du desk.
- AddOn NinjaTrader : garde propre lue dans `bridge.json` (comptes, plafond, tag) ; le jeton ne circule pas (défi-réponse HMAC) ; rien n'est envoyé ni exécuté avant la preuve du desk.
- Copieur : désarmé à chaque ouverture, suiveurs `Sim*` seulement, armement par dialogue du process principal.
- Agent : `copy.order` et la soumission d'ordres ne sont pas des outils d'agent. Écritures confirmées par l'opérateur (LLM) ou derrière `orchestratorAllowWrite`, défaut `false`.
- LLM : la clé API ne quitte pas le process principal ; hôtes épinglés dans `electron/llm-host.ts`, le renderer ne peut pas élargir la liste.
- Renderer : CSP `connect-src 'self'` ; aucun appel réseau direct.
- Aucun jeton, secret ou clé dans un journal, un export de coffre ou un commit.

## 6. Où consigner

- Constats d'audit et preuves : `docs/AUDIT.md`, une section par vague, chaque constat cité `fichier:ligne`.
- Plan en cours : `docs/AUDIT.md` › « 3.3.4 — audit agentique » (A1 fiabilité de la boucle, A2 données justes, A3 tout le desk en lecture, A4 la porte MCP et les événements, A5 exécution gardée après les prérequis S1–S5).
- Pont NinjaTrader : `docs/PONT-NINJATRADER.md`.

## Commandes

```bash
npm install            # Node 22.12+
npm run typecheck      # tsc app + electron
npm test               # Vitest
npm run check          # typecheck + test + build
npm run electron:compile
npm run desk:dev       # Electron + Vite
```
