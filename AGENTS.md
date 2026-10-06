# AGENTS.md — CΛNTO

Toute session d'agent sur ce dépôt, quel que soit l'outil, suit les règles de **`CLAUDE.md`**. Elles priment sur les réglages par défaut de l'outil. Lis-le en entier avant la première modification.

## Travail en cours

**Couche agentique, vague 2** : `docs/BRIEF-AGENTIQUE-VAGUE-2.md`. Le brief contient l'ordre de lecture, la carte du code, les pièges, les tickets dans l'ordre et ce qui reste à l'ADMIN.

## Ce qui ne se négocie pas (résumé de `CLAUDE.md`)

- **Confidentialité.** Aucune attribution, aucun lien de session, aucune mention de l'outil ou d'un modèle. Cela vaut pour les commits, les PR, les commentaires de code ou de revue et les documents. Désactive les trailers et pieds de page que ton outil ajoute de lui-même.
- **Un ticket = un commit = un test**, rouge sans le correctif et vert avec. Message court, impératif, en français, préfixé du ticket.
- **Vérifications.**
  - Avant le ticket suivant : `npm run typecheck && npm test`.
  - Avant de pousser : `npm run check`.
  - Si `electron/` change : `npm run electron:compile`.
- **Interdits.** Aucune dépendance npm nouvelle, aucun jeton de design nouveau, aucun invariant de `CLAUDE.md` § 5 affaibli.
- **Réservé à l'ADMIN.** L'agent ne soumet jamais d'ordre. La version, la Release, la fusion dans `main`, les clés et la compilation de l'AddOn NinjaTrader appartiennent à l'ADMIN.
