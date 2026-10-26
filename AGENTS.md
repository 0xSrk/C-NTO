# AGENTS.md — CΛNTO

Toute session d'agent sur ce dépôt, quel que soit l'outil, suit les règles de **`CLAUDE.md`**. Elles priment sur les réglages par défaut de l'outil. Lis-le en entier avant la première modification.

## Travail en cours

**Couche agentique** : vagues 1 à 3 livrées en 3.5.0, décisions de l'ADMIN arrêtées (`docs/THESE-AGENTIQUE.md` § 7, bilan au § 9). La suite attend l'ADMIN : AddOn 2.3.0 (compilation et essai sur Sim), hôte du modèle du Lab. Avant toute modification, lis `docs/BRIEF-AGENTIQUE-VAGUE-2.md` : ordre de lecture, carte du code, pièges des tests.

## Ce qui ne se négocie pas (résumé de `CLAUDE.md`)

- **Confidentialité.** Aucune attribution, aucun lien de session, aucune mention de l'outil ou d'un modèle. Cela vaut pour les commits, les PR, les commentaires de code ou de revue et les documents. Désactive les trailers et pieds de page que ton outil ajoute de lui-même.
- **Un ticket = un commit = un test**, rouge sans le correctif et vert avec. Message court, impératif, en français, préfixé du ticket.
- **Vérifications.**
  - Avant le ticket suivant : `npm run typecheck && npm test`.
  - Avant de pousser : `npm run check`.
  - Si `electron/` change : `npm run electron:compile`.
- **Interdits.** Aucune dépendance npm nouvelle, aucun jeton de design nouveau, aucun invariant de `CLAUDE.md` § 5 affaibli.
- **Réservé à l'ADMIN.** L'agent ne soumet jamais d'ordre. La version, la Release, la fusion dans `main`, les clés et la compilation de l'AddOn NinjaTrader appartiennent à l'ADMIN.

## Centre de contrôle

Plusieurs agents travaillent sur CΛNTO. Avant d'agir, lis le centre de contrôle (`node scripts/centre.mjs etat`, puis ta boîte), réserve une zone partagée avant d'y toucher et consigne ce que tu as fait : `docs/CENTRE-DE-CONTROLE.md`. Le centre est privé, hors du dépôt public ; aucun secret n'y entre, et rien n'en sort.
