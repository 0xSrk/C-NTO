**`SIΞRRΛSKΛ—LAB · CΛNTO · THÈSE · COUCHE AGENTIQUE DU TRADER`**

# Thèse — la couche agentique du trader

Rédigée le 6 octobre 2026, sur `main` à 3.4.0 (plan 3.3.4 soldé, Métriques 3.5.0 étapes 1 et 2 fusionnées). Elle fixe le cap de la couche agentique et la façon de prouver qu'on l'atteint. Le plan, les constats et leurs preuves sont dans `docs/AUDIT.md` › « Couche agentique du trader ». Le contrat technique est dans `docs/PROTOCOLE-AGENT.md`.

## 0. En une phrase

CΛNTO ne construit pas un agent de trading. Il construit **la porte** par laquelle n'importe quel agent travaille avec le trader : sur ses vrais chiffres, dans le temps de sa séance, sous ses règles, sans jamais toucher seul à l'argent.

Le modèle passe, la porte reste.

## 1. Constat

**Les modèles se valent et changent vite.** Claude, Codex, les modèles locaux savent appeler des outils et parlent le même protocole (MCP). Celui qui gagne ce trimestre ne gagnera pas le suivant. Ce qui dure, c'est l'environnement qu'ils lisent et les garde-fous sous lesquels ils agissent.

**Le marché fait de la revue après coup, dans le cloud, ou de l'exécution sans le plan prop.** État relevé le 6 octobre 2026 (sources en § 8) :

- Les journaux ajoutent un coach IA qui relit la séance une fois finie, sur leurs serveurs (TradeZella, TraderSync, Edgewonk). Aucune alerte comportementale pendant la séance n'est documentée.
- Les courtiers ouvrent des serveurs MCP qui passent des ordres (Alpaca, Tradier, NinjaTrader MCP en bêta). La confirmation y dépend du client MCP ou du prompt. Le MCP de NinjaTrader passe par l'API Tradovate dans le cloud et, d'après sa documentation, ne prend pas en charge les comptes prop.
- Interactive Brokers fait rédiger des instructions que le client relit puis soumet ; FundedNext ouvre un MCP en lecture seule sur ses propres comptes.

**Les prop firms bornent ce qu'un agent peut faire.** Apex interdit l'automatisation sur les comptes PA et Live, « including any form of AI », et exige que chaque ordre parte d'une action délibérée et distincte. Topstep exige que les ordres partent de l'appareil personnel du trader, sans VPS. Un agent qui trade seul fait perdre le compte.

**Personne ne réunit, en local, pour le trader prop sur futures** : le plan prop rejoué sur son compte, son journal, le calendrier officiel, le pont NinjaTrader et une porte standard pour ses agents. C'est le créneau de CΛNTO. Il ne restera pas ouvert longtemps (NinjaTrader Innovation Lab, septembre 2026).

## 2. Thèse

La valeur n'est pas dans le modèle. Elle est dans quatre choses que le desk est seul à tenir :

1. **La vérité terrain.** Journal, plan prop, comptes, calendrier : le desk calcule ce que l'écran montre.
2. **Le temps de la séance.** Le desk voit les fills, la marge, les catalyseurs et les ordres au moment où ils arrivent.
3. **Les règles du trader.** Le desk peut les tenir, les vérifier et les rappeler.
4. **Le process principal.** C'est le seul endroit où un ordre peut être gardé et confirmé par un humain.

La couche agentique de CΛNTO, c'est donc **vérité, vigilance, discipline et porte**, avec l'exécution réduite à une proposition que le trader confirme.

### Cinq propositions, chacune vérifiable

| # | Proposition | Ce qui la prouve |
|---|---|---|
| **P1 · Vérité** | Chaque chiffre lu par un agent est celui de l'écran : même compte, même périmètre, même définition, daté et sourcé, de taille bornée. | Harnais d'évaluation différentiel : les attendus sont recalculés par les moteurs de l'écran, sur les mêmes données, à chaque commit. |
| **P2 · Séance** | L'agent sert la séance entière : avant (brief), pendant (perte du jour, ordres en cours, dérives, catalyseurs), après (débrief, leçons). | Événements `daily_loss`, `discipline`, `order` ; outils `discipline_status`, `working_orders`, `market_quote` ; prompts de brief et de débrief. |
| **P3 · Mémoire** | Les règles et les leçons **du trader** suivent l'agent d'une conversation à l'autre. Une note écrite par un agent n'y entre pas sans adoption par le trader. | `trader_memory`, consigne enrichie ; test : une note signée `agent` est absente de la consigne. |
| **P4 · Garde** | L'agent propose, le desk garde, le trader décide. Un ordre égale un dialogue du process principal. Aucune approbation groupée, aucun ordre autonome, comptes `Sim*` seulement. | Tests d'injection sur chaque outil d'écriture ; dialogue non falsifiable ; redirections LLM refusées ; clé liée à son hôte. |
| **P5 · Porte** | Un standard ouvert (MCP) plutôt qu'un agent maison. Le modèle du Lab (Artefact 003) se branchera comme les autres. Tout reste sur la machine. | Type d'outil lu par le process principal, indications et titres, consignes dans la langue du trader, prompts empaquetés, appels en vol bornés. |

## 3. Ce que CΛNTO refuse

- **Exécuter seul.** Pas de file d'ordres, pas d'approbation groupée, pas d'ordre de l'agent sur un compte réel. `copy.order` n'est pas un outil d'agent.
- **Faire dépendre la sécurité du client.** Les indications MCP (`readOnlyHint`, `destructiveHint`) aident le client mais ne gardent rien : la garde est dans le process principal.
- **Sortir de la machine.** La porte écoute sur `127.0.0.1`. Pas de tunnel, pas de connecteur cloud (ChatGPT) sans décision de l'ADMIN.
- **Réunir la « trifecta létale »** : données privées, contenu non fiable et canal sortant. Aucun outil ne charge une URL arbitraire, le desk ne charge aucun serveur MCP tiers, tout contenu externe est une donnée et jamais une consigne.
- **Parler au fournisseur LLM sans geste du trader.** Une routine propose, elle n'envoie rien seule.
- **Conseiller.** L'agent analyse, structure et rappelle les règles. Il ne donne pas de conseil d'investissement personnalisé. CΛNTO n'annonce jamais « l'IA trade pour vous ».

## 4. Architecture

| Couche | Rôle | En place (3.4.0) | Vague 1 (cette branche) |
|---|---|---|---|
| **L0 · Vérité** | Moteurs de l'écran, purs | `metrics`, `propfirm`, `inference`, `montecarlo` | Les outils rejoignent l'écran : journée CME, marge datée, compte exigé, période |
| **L1 · Perception** | Outils de lecture | 13 outils, une liste (`catalog.ts`) | `asOf`, `sources`, sorties bornées, schémas typés ; ordres en cours, cotation, comptes datés |
| **L2 · Mémoire** | Ce que le trader a décidé | Notes, ontologie, signature `agent` | Règles chiffrées, leçons, playbook ; `trader_memory` ; consigne enrichie, datée à New York |
| **L3 · Vigilance** | Ce qui arrive pendant la séance | `fill`, `prop_buffer`, `catalyst`, `bridge_link`, `agent_order` | `daily_loss`, `discipline`, `order` |
| **L4 · Discipline** | Les règles appliquées au journal | — | Perte du jour sur la journée CME, dérives après une perte, écarts aux règles ; `discipline_status` |
| **L5 · Action gardée** | Un ordre proposé, confirmé | `propose_order`, gardes du main, dialogue 45 s | Dialogue non falsifiable, cadence qui compte tout, instrument normalisé |
| **L6 · Porte** | Les agents du marché | MCP local, orchestrateur, `desk_events` | Type lu par le main, indications, titres, consignes, prompts, appels en vol bornés, résultats étiquetés |
| **Preuve** | Ce qui le démontre | Tests unitaires par outil | Fournisseur scripté, desk de démonstration, scénarios dorés, injection, `TZ=UTC` |
| **Garde** | Ce qui ne doit jamais céder | Hôtes épinglés, clé au main, CSP | Redirections refusées, clé liée à son hôte, chaînes externes bornées |

Règle de construction : le moteur reste pur (`src/engine`), les outils reçoivent des ports, le process principal garde, l'interface confirme. Chaque couche se teste sans la suivante.

## 5. Critères de réussite

La couche agentique est au niveau quand, sur `main` :

1. **Zéro écart** entre un outil et l'écran sur les scénarios dorés, à chaque commit, quel que soit le fuseau du poste.
2. **Tout ce que le trader voit en séance est lisible** par un agent : P&L et perte du jour, marge datée du plan, ordres en cours, dernière cotation, fraîcheur des comptes.
3. **Chaque règle du trader a sa veille** : perte du jour à 50, 75 et 100 %, et un écart signalé dès le fill d'entrée.
4. **Aucune écriture sans geste humain** : test d'injection vert pour chaque outil d'écriture du catalogue.
5. **Un client MCP standard** voit des outils titrés et typés par le desk, des consignes dans la langue du trader, et trois routines prêtes.
6. **Un ordre égale un dialogue**, toujours. C'est la condition de conformité avec Apex et Topstep.

## 6. Feuille de route

| Vague | Contenu | Qui |
|---|---|---|
| **1 · Fondations** (cette branche) | A6 Vérité, A7 Preuve, A8 Porte, A9 Séance, A10 Discipline et mémoire, A11 Garde | Sous-agents, un ticket = un commit = un test |
| **2 · Routines** | Brief et débrief dans l'agent embarqué (mêmes textes que les prompts MCP), adoption d'une leçon proposée par l'agent, ressources MCP et schémas de sortie, configuration Codex et Claude Desktop, abonnement de Visual au flux NinjaTrader (D2) | Sous-agents |
| **3 · Décisions** | Voir § 7 | ADMIN |

## 7. Décisions ouvertes pour l'ADMIN

1. **Règles du trader comme gardes.** Refuser un `propose_order` qui enfreint une règle du trader : perte du jour atteinte, fenêtre de catalyseur, instrument non autorisé. C'est un renforcement, mais il touche l'invariant « Agent » de `CLAUDE.md`.
2. **Marge datée dans la garde A5 et dans `prop_buffer`.** Les outils rendent désormais la marge de la jauge K.04 (plus-bas de la dernière séance), mais la garde et l'alerte lisent encore la marge de clôture.
3. **Abonnement aux données de marché par l'agent.** `market_quote` lit la dernière cotation reçue sans s'abonner.
4. **AddOn 2.3.0 (D3).** Remplissage et prix moyen des ordres, instantané complet du pont. À compiler dans NinjaTrader 8 et à essayer sur Sim.
5. **Position écrite des prop firms** sur un ordre proposé par une IA puis confirmé par le trader, avant tout argument commercial.
6. **Modèle du Lab (Artefact 003)** : hôte, modèle, entrée dans `electron/llm-host.ts`.
7. **Ouverture hors de la machine** (connecteur cloud, ChatGPT) : non, sauf décision contraire.

## 8. Sources de la veille

Relevées le 6 octobre 2026. Plusieurs pages n'ont été lues qu'en extrait. À revérifier avant toute communication.

- TradeZella, agents Zella AI (page de l'éditeur) — https://www.tradezella.com/blog/the-only-ai-trading-tool-you-will-ever-need-in-2026
- Tradier, service MCP — https://tradier.com/company/press/Tradier-Launches-MCP-Service-LLM-Powered-Trading
- NinjaTrader Innovation Lab, 9 septembre 2026 — https://www.prnewswire.com/news-releases/ninjatrader-launches-ninjatrader-innovation-lab-to-power-dedicated-futures-focused-ai-tools-for-retail-traders-302872722.html
- NinjaTrader MCP, outils et sûreté — https://docs.ninjatrader.com/mcp/tools · https://docs.ninjatrader.com/mcp/safety
- Interactive Brokers, trading agentique — https://www.interactivebrokers.ca/en/general/about/mediaRelations/7-28-26.php
- Alpaca MCP server — https://github.com/alpacahq/alpaca-mcp-server
- FundedNext, MCP en lecture seule — https://www.financemagnates.com/forex/ai-wave-reaches-prop-firms-as-fundednext-launches-mcp-server/
- Apex, activités interdites — https://support.apextraderfunding.com/hc/en-us/articles/40463668243099-Prohibited-Activities
- Topstep, accès API et conduite interdite — https://help.topstep.com/en/articles/11187768-topstepx-api-access · https://help.topstep.com/en/articles/10296582-prohibited-conduct
- Spécification MCP, outils (humain dans la boucle) — https://modelcontextprotocol.io/specification/2024-11-05/server/tools
- OWASP, MCP Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html
- OWASP, Top 10 des applications agentiques 2026 — https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026
- La « trifecta létale » — https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
