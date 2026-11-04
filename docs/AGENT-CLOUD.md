# Agent cloud — rapports quotidiens (Managed Agents d'Anthropic)

Demandé par l'ADMIN le 26 octobre 2026 : un agent qui tourne chaque jour dans son bac à sable, sur les serveurs d'Anthropic, payé sur les crédits API mensuels de l'organisation, et dont les rapports apparaissent dans l'onglet 06 · AGT (Agent IA). Ce document décrit le pont livré (tickets CLD1 à CLD49 et LAB2 à LAB4, `docs/AUDIT.md` › « Agent cloud — rapports quotidiens » et « Agent cloud — formation quant »), et la formation quant de l'agent sur quantmemo.com (§ 9, demandée le 3 novembre 2026). L'analyse elle-même est provisoire : la consigne et le design des rapports viendront de l'ADMIN.

## 1. Le produit Anthropic retenu

« Agent SDK » recouvre deux produits. Le **Claude Agent SDK** est le harnais de Claude Code en bibliothèque : on l'héberge soi-même. **Managed Agents** fournit le harnais *et* l'hébergement : la boucle de l'agent tourne chez Anthropic et ses outils (bash, fichiers, web) s'exécutent dans un conteneur par session. Seul le second « tourne dans son sandbox sur les serveurs Anthropic ». Ses **déploiements planifiés** (cron POSIX à cinq champs, fuseau IANA) créent une session à chaque échéance, sans client branché.

- **Facturation.** Jetons au tarif public du modèle, plus 0,08 $ par heure de session active (`running` ; `idle` ne coûte rien). Recherche web : 10 $ les 1 000. Le tout est imputé aux crédits API de l'organisation Console de la clé.
- **Crédits Max.** Un abonnement Max 20x comprend 200 $ de crédits API par mois (Max 5x : 100 $), qu'on rattache à une organisation Console depuis claude.ai › Réglages › Facturation › « Link organization ». Managed Agents en fait partie. Les crédits non utilisés expirent en fin de cycle ; une fois épuisés, l'API refuse jusqu'au cycle suivant, sauf crédits achetés (article d'aide Anthropic 17154008, relu le 26 octobre 2026).
- **Plafond par exécution.** 3,00 $ aux tarifs publics (`BUDGET_CENTS_PER_RUN`). La plateforme suspend la session qui l'atteint (`budget_reached`). Du lundi au vendredi, cela fait au plus 66 $ environ par mois.

## 2. Le pont : relève seule

```
Anthropic                                         Desk — process principal                         Desk — renderer
déploiement (cron) ─► session ─► rapport.json  ◄── GET, clé chiffrée ── agent-cloud.ts ─► agent-reports/ ─► IPC ─► Agent IA › A · Rapports
```

- **Rien n'écoute, rien du desk ne part.** Le process principal interroge l'API ; aucun port n'est ouvert, aucun fichier ni donnée du journal n'est envoyé. La décision 7 (`docs/THESE-AGENTIQUE.md` § 7 : ni tunnel, ni connecteur cloud) reste entière ; la décision 11 ouvre ce seul sens.
- **Un hôte, écrit dans le code.** `electron/agent-cloud-api.ts` n'appelle que `https://api.anthropic.com` (bêta `managed-agents-2026-04-01`, `anthropic-version: 2023-06-01`). Les redirections sont refusées, chaque appel a un délai de 20 s, un corps JSON est borné à 2 Mio et décodé en UTF-8 strict. Chaque chemin est bâti d'un identifiant vérifié (`depl_…`, `sesn_…`, `file_…`, `memstore_…`, `mem_…`) ; le renderer ne fournit aucune URL. Les appels aux magasins de mémoire (`/v1/memory_stores/**`) portent leur propre bêta, `agent-memory-2026-07-22`, qui remplace l'autre : les deux ensemble donnent un 400. Monter un magasin sur une session ou un déploiement reste un appel de session.
- **La clé.** Saisie dans Agent IA › D · Lab, au seul siège du Lab, elle part une fois vers le process principal (`agent-cloud:set-key`, 512 signes au plus), qui la chiffre par le trousseau du système (`safeStorage`) dans `userData/agent-cloud.json` (mode 0600). Elle n'est jamais rendue au renderer, jamais journalisée, jamais exportée (le coffre ne la connaît pas). Sans trousseau, rien n'est gardé. Elle est distincte de la clé du modèle conversationnel.
- **Espace de travail.** Une clé d'espace de travail (`sk-ant-api03-…`) désigne le sien. Une clé d'utilisateur (`sk-ant-usr-…`) vaut pour toute l'organisation : l'API refuse alors chaque appel (400) tant qu'il ne nomme pas l'espace visé. Agent IA › D · Lab › Espace de travail garde cet identifiant (`wrkspc_…`, ou un UUID ; l'API dit s'il existe) dans `agent-cloud.json`, hors du trousseau puisqu'il n'est pas secret, et le client l'envoie dans l'en-tête `anthropic-workspace-id` de chaque appel (`agent-cloud:set-workspace`, 140 signes au plus, forme vérifiée avant tout envoi). Changer d'espace ne perd jamais de vue un déploiement qui facture. Sous le déploiement du desk, le nouvel espace n'est retenu que si ce déploiement y reste visible (`GET /v1/deployments/{id}` relu avec le nouvel en-tête) : nommer l'espace d'abord implicite d'une clé d'espace passe, déplacer le desk vers un espace qui ne voit pas son déploiement est refusé ; l'installation est gardée. Sans déploiement connu mais avec une installation commencée (réponse de création perdue en route), le desk cherche d'abord, par l'agent, un déploiement du desk dans l'espace actuel : trouvé, il devient celui du desk et le changement est refusé ; recherche impossible, rien n'est oublié. Sinon l'espace change, et l'environnement et l'agent de l'ancien espace sont oubliés : la prochaine installation les recrée dans le nouveau.
- **Cadence.** Premier relevé 10 s après l'ouverture, puis toutes les 15 min, et toutes les 3 min tant qu'une session tourne. « Relever maintenant » relève à la demande. Une clé refusée (401, 403) arrête le relevé automatique, jusqu'à une nouvelle clé, un autre déploiement ou un relevé à la demande qui réussit ; un 429 attend son `Retry-After`.
- **Relevé, pas à pas** (`electron/agent-cloud.ts`) :
  1. `GET /v1/deployments/{id}` : état, prochaine échéance, plafond, version de l'agent ;
  2. `GET /v1/sessions?deployment_id=…&order=asc&created_at[gte]=<marque basse>&include_archived=true&limit=20`, et les pages suivantes (cinq au plus). La marque basse (`floor` dans `agent-cloud.json`) est l'instant de création de la plus ancienne session pas encore réglée : le relevé lit à partir d'elle, de la plus ancienne vers la plus récente, puis l'avance sur les sessions réglées. Un desk resté fermé rattrape tout, dix rapports par relevé, toutes les 3 min tant qu'il en reste ;
  3. pour chaque session finie et non relevée : `GET /v1/files?scope_id=<session>`, puis le dernier `rapport.json` (512 Kio au plus), lu par `GET /v1/files/{id}/content` et `parseReport`, puis rangé dans `userData/agent-reports/<session>.json` ;
  4. `GET /v1/deployment_runs?has_error=true` sur sept jours, pour les déclenchements refusés.

  La session de formation (§ 9), hors déploiement, se relève à part dans le même relevé : `GET /v1/sessions/{id}` à chaque passage (coût, plafond), puis, au repos, son `rapport.json` par le même chemin, rangé avec la marque `kind: formation`. Elle garde le relevé vivant sans déploiement, toutes les 3 min tant qu'elle tourne, et n'entre jamais dans les échecs du rapport quotidien.

  Une session finie n'est lue que 60 s après sa dernière mise à jour : le dernier fichier écrit met quelques secondes à être indexé. Une session au repos à son plafond ne repartira pas d'elle-même. Le motif `budget_reached` n'est porté que par l'événement de mise au repos, pas par l'objet session : le desk le déduit du coût relevé, au moins égal au plafond (la pause ne tombe qu'au coût exact du plafond, et le coût rendu en est l'arrondi au centime). Une telle session est lue comme une session finie, relevée si elle a déposé un rapport, sinon notée « plafond atteint avant le rapport », avec la dépense et le plafond. Une session finie dont l'évaluation est restée ouverte pour une autre raison est attendue 30 min, puis relevée si elle a déposé un rapport, sinon notée. Une session finie sans rapport est notée, avec sa dépense ; une session archivée aussi. Un rapport hors contrat, daté à plus de sept jours de sa session, ou non téléchargeable, est noté et jamais rangé. Une panne du serveur ou du réseau fait échouer le relevé : la session sera reprise au suivant. Dix téléchargements au plus par relevé. Un relevé dont le déploiement a changé en route (quitté, remplacé) n'écrit rien.

## 3. Contrat `canto.rapport/1`

L'agent écrit un seul fichier, `/mnt/session/outputs/rapport.json`, en JSON UTF-8 (`src/engine/agent/cloudReport.ts`, module partagé par le process principal et le renderer) :

| Champ | Forme | Bornes |
|---|---|---|
| `format` | `"canto.rapport/1"` exactement | — |
| `date` | `AAAA-MM-JJ`, une date qui existe | la journée CME analysée |
| `title` | texte sur une ligne | 160 signes |
| `summary` | texte, sauts de ligne gardés | 1 200 signes |
| `sections` | `[{ heading, body }]`, `body` en Markdown | 1 à 24 ; titre 160, corps 24 000 |
| `sources` | `[{ title, url }]`, https seulement | 40 ; une source sans https est écartée, et une source hors des domaines que l'agent peut lire aussi (domaines officiels et quantmemo.com pour le rapport quotidien, quantmemo.com seul pour la formation), ce qu'une section « Sources écartées par le desk » dit (CLD55) |
| `generatedAt` | instant ISO 8601 | facultatif |

Le refus porte sur tout le rapport : forme, `format`, date, titre vide, aucune section, section sans titre ou sans corps. Les caractères de contrôle et les marques bidirectionnelles tombent ; une URL porteuse d'identifiants est écartée. Le process principal refuse aussi une journée à plus de sept jours de la création de la session (`isDateNear`) : le dossier se trie sur cette date. Le lecteur rend le Markdown par `renderMarkdown` (DOMPurify : ni script, ni style, ni formulaire). Les images restent masquées, et la CSP du desk les bloquerait de toute façon. Chaque lien du corps affiche à côté l'hôte où il mène : son texte vient du modèle. Un lien https s'ouvre dans le navigateur du système, au clic comme au clic du milieu, par `setWindowOpenHandler` ; un lien hors https perd son adresse.

## 4. L'agent que le desk installe

Agent IA › D · Lab › **Installer l'agent cloud** ouvre un dialogue du process principal : *Installer et planifier*, *Installer en pause* ou *Annuler* (par défaut). Il crée, dans l'ordre (`electron/agent-cloud-definition.ts`) :

- **Environnement** `canto-analyste` : conteneur cloud, réseau `limited` aux douze domaines officiels (`OFFICIAL_DOMAINS` : Fed, New York Fed, Fed de Saint-Louis, BLS, BEA, Census, DOL, Trésor, EIA, CFTC, SEC, BCE) et à leurs sous-domaines, sans gestionnaire de paquets ni serveur MCP. Le CME n'y est plus : ses conditions interdisent l'accès automatisé (décision de l'ADMIN, CLD35).
- **Agent** `CΛNTO · analyste quotidien` : Claude Opus 5.5, effort élevé. Outils intégrés en `always_allow`, car aucun client n'est branché sur une exécution planifiée et une demande d'autorisation la bloquerait sans fin. Recherche et lecture web limitées aux mêmes domaines. Aucun outil du desk, aucun serveur MCP, aucun outil d'ordre. La consigne fixe le contrat de sortie et la langue du desk, et une méthode faite pour le plafond : le calendrier officiel de chacune des neuf institutions d'abord (`CALENDAR_INSTITUTIONS` : Fed, BLS, DOL, BEA, Census, Trésor, EIA, CFTC, BCE), une page chacune, avant toute page de contexte ; écriture aussitôt d'un `rapport.json` complet et valide même sommaire ; affinage ensuite en réécrivant le fichier entier, les pages qui restent comblant d'abord le calendrier (seconde tentative d'une page qui ne s'est pas ouverte, page périmée remplacée, mois suivant quand le lendemain y tombe, exceptions d'une règle habituelle la semaine d'un jour férié, heure manquante) avant le contexte ; quinze pages lues au plus (`MAX_PAGES`). Une session coupée par le plafond laisse ainsi un rapport. Le calendrier de la fenêtre est complet (chaque adjudication du Trésor du jour et du lendemain, bills compris ; une annonce n'est pas une adjudication) et tiré de pages à jour : une page sans aucune date reste valable, une page dont la date la plus récente a plus de trois mois avant la journée analysée ne donne aucun événement, et une règle dite habituelle ne vaut, la semaine d'un jour férié fédéral américain, qu'une fois ses exceptions lues : sinon, la publication est citée sans jour ni heure dans la fenêtre. Le DOL ne publie pas de calendrier des inscriptions au chômage (leur horaire est sur oui.doleta.gov, hors des domaines autorisés) : la consigne donne sa règle (jeudi 8:30 ET, mercredi quand le jeudi est férié), et le dernier communiqué, `dol.gov/ui/data.pdf`, en tient lieu de calendrier et de source si sa date d'embargo remonte à huit jours au plus avant la journée analysée ; plus ancien, les inscriptions sont citées « non trouvé » pour leur jour et leur heure. Le CME n'est pas lu : l'agent n'en annonce ni horaire ni jour férié, et le dit en une ligne, « non consulté ». Une page qui ne s'ouvre pas se retente une fois au plus, elle-même ou une autre page de la même institution ; au second échec, l'agent n'ouvre plus aucune page de cette institution, garde ce qu'il en a déjà lu, et écrit « non consulté » pour ce que la page devait donner. Le calendrier distingue « non consulté » (calendrier non lu) de « non trouvé » (lu, absent), deux mentions que la grille du correcteur connaît aussi.
- **Magasin de savoir** `canto-savoir-quant` (`MEMORY_STORE_NAME`), créé à l'étape « Mémoire », après l'environnement : la formation y écrit (§ 9), le déploiement le monte en **lecture seule** (au niveau du système de fichiers), sous `/mnt/memory/canto-savoir-quant/`. Le desk le crée avec un corps constant, le cherche d'abord par sa métadonnée (`canto: agent-cloud-formation`) et son nom après une réponse perdue, le recrée s'il est archivé ; introuvable (404 : supprimé dans la Console, ou invisible avec la clé), il le cherche comme un magasin inconnu, puis le crée (CLD51) : un magasin ne facture rien, le déploiement ne peut plus monter l'ancien, et celui-ci, s'il existe sous une autre clé, n'est pas touché. Il est propre à l'espace de travail. Le desk n'y écrit rien d'autre.
- **Déploiement** `canto-rapport-quotidien` : planification d'Options (défaut `0 7 * * 1-5`, `Europe/Paris`), plafond de 3,00 $ par exécution, et résultat attendu (`user.define_outcome`) avec une grille de dix critères (`outcomeRubric`, qui dit au correcteur la langue attendue, et qui exige qu'un repère tiré du savoir quant cite sa fiche sans en tirer de chiffre) : un correcteur relance l'agent une fois au plus si le rapport en manque un.

Chaque identifiant obtenu est écrit aussitôt : une installation coupée en route reprend où elle s'est arrêtée. Un agent ou un environnement disparus (404) ou archivés sont recréés. Avant de créer un déploiement, le desk cherche celui qu'il a déjà posé (métadonnée `canto: agent-cloud`, même nom) et le reprend : une réponse perdue en route, ou un déploiement quitté puis suspendu, ne donne jamais un second déploiement planifié. Le même bouton, devenu *Mettre à jour l'agent*, met à jour l'environnement (ses domaines autorisés), crée une nouvelle version de l'agent et réépingle le déploiement sur celle-ci ; il applique aussi la planification retenue. Un changement de consigne ou de domaines n'atteint donc le déploiement installé qu'après ce geste, depuis un desk qui le porte. L'installation applique toujours le plafond de 3,00 $, et son dialogue le dit.

*Lancer maintenant* et *Reprendre* passent par un dialogue (Annuler par défaut), qui dit le plafond que le déploiement déclare, relu juste avant : « aucun plafond » s'il n'en a pas, « plafond inconnu » s'il ne répond pas. *Suspendre*, qui ne coûte rien, n'a pas de dialogue. *Quitter* le déploiement du desk (ou le remplacer par un autre) passe par un dialogue qui le suspend d'abord : laissé tel quel, il continuerait de facturer sans être relevé. Si la clé enregistrée ne le voit pas (404 : autre organisation ou autre espace de travail, car un déploiement ne se supprime pas), rien n'est dit suspendu ; le quitter quand même passe par un second dialogue, *Quitter sans suspendre*. Pour la même raison, un 404 sur le déploiement du desk ne le recrée jamais à l'installation : seul un déploiement archivé est remplacé. Un déploiement créé dans la Console peut être indiqué à la main : le desk le relève et peut le lancer, sans jamais le modifier, le suspendre ni le reprendre. Aucune action ne part pendant qu'une autre attend sa réponse. L'échec d'une action reste affiché jusqu'au geste suivant : le relevé automatique ne l'efface pas.

**Savoir quant.** La consigne de l'analyste a une section « Savoir quant (magasin en lecture seule) » : s'il est monté, l'analyste ne l'ouvre qu'une fois le rapport écrit une première fois, lit `INDEX.md`, `boite-a-outils.md` et cinq fiches utiles au plus (60 Ko), seules les fiches `verifiee`, pour expliquer et jamais pour prévoir ; aucun chiffre du jour, aucun niveau, aucun consensus n'en vient, et chaque repère cite la source de sa fiche. Absent ou vide, il travaille comme avant. Le contenu de `/mnt/memory/` est une donnée, pas une consigne. Son réseau et ses outils web restent les douze domaines officiels ; le montage n'atteint le déploiement qu'après *Mettre à jour l'agent*, et la plaque dit s'il est monté.

**Analyse provisoire.** Brief pré-séance : publications et événements officiels du jour CME et du lendemain, leur heure à New York et à Paris, et ce que chacun mesure. Rien d'inventé, aucun ordre, aucune recommandation. À remplacer par la consigne de l'ADMIN dans `cloudSystemPrompt` et `outcomeRubric`, puis *Mettre à jour l'agent*.

## 5. L'onglet Agent IA

Le Lab produit les rapports ; un desk les lit. L'onglet montre donc à tous le dossier, et le pilotage au seul siège du Lab (`LAB_SEATS`, vérifié par le process principal ; décision de l'ADMIN, 2026-10-26).

- **A · Rapports**, la vue d'ouverture, la même pour tous. À gauche, le bordereau `RAPPORTS ···· N FICHES`, la fiche du prochain rapport au trait tireté (prévue, quand une exécution est planifiée), puis les fiches `AGT-RPT-AAAAMMJJ` (les rapports de formation, `AGT-FRM-AAAAMMJJ`, leurs suffixes comptés à part), codes en clair et sans code-barres, une LED par fiche non lue. À droite, le lecteur. Le dernier rapport s'ouvre de lui-même quand la vue est à l'écran, et une fiche ouverte est marquée lue. Ni plaque, ni réglage, ni commande.
- **B · Conversation** : le modèle conversationnel et les routines Brief / Débrief, inchangés.
- **C · Options** : les réglages de l'IA du desk. Une bande d'état (modèle, passerelle MCP, orchestrateur, écriture des agents, ordres de l'agent), puis Fournisseur, Agents externes · MCP, Orchestrateur externe, Ordres proposés par l'agent, Outils natifs.
- **D · Lab**, au seul siège du Lab : la plaque de l'agent cloud (son trait dit l'état : plein en service, tireté en construction ou en pause, pointillé en défaut ou archivé ; LED or en service ; déploiement, prochaine exécution, dernier relevé, plafond ; puis la formation : son état, le savoir acquis, sa dépense, et si le déploiement monte le savoir ; erreurs en signaux de niveau 2, échecs de niveau 1, jamais de niveau 3 ; un accès refusé à la formation en signal de niveau 2), puis le pilotage : clé API, espace de travail, planification, installation, lancement, suspension, reprise, *Former l'agent* ou *Reprendre la formation*, *Arrêter la formation*, déploiement de la Console.
- **En-tête.** Pour tous, le bloc-titre dit le nombre de rapports et de non-lus, et la vue Rapports offre *Ouvrir le dossier*. Au siège du Lab, il dit aussi le dernier relevé et la prochaine exécution (valeur prévue), et la vue Rapports ajoute *Relever maintenant* (chanfrein).
- **Rail.** Sous Agent IA, « N rapport(s) non lu(s) » passe devant l'état de l'orchestrateur.

Les vues restent montées (`hidden`) ; la vue Lab, seulement au siège du Lab, et un siège perdu ramène aux rapports : un brouillon ou un réglage en cours survit au changement de vue, et la conversation s'ouvre à son dernier message. Le dossier montre les 400 fiches les plus récentes ; les non-lus se comptent sur celles-là.

## 6. Garde-fous

- **Le Lab produit, les desks lisent.** Seul un siège du Lab (`LAB_SEATS`, vérifié par `SeatHost` dans le process principal) pilote l'agent cloud : clé, espace de travail, planification, installation, lancement, suspension, reprise, déploiement. Sans lui, le process principal refuse chacune de ces commandes ; le desk lit le dossier (`list`, `read`, marque de lecture), et l'onglet n'affiche que les rapports (décision de l'ADMIN, 2026-10-26).
- Ni écoute, ni tunnel : relève sortante seule, vers `api.anthropic.com` seul, sans redirection.
- Clé chiffrée dans le process principal, jamais rendue, journalisée ni exportée.
- Installer, lancer, reprendre, quitter le déploiement du desk, former l'agent ou reprendre sa formation : dialogue du process principal, Annuler par défaut. Arrêter la formation, comme suspendre, ne coûte rien et n'a pas de dialogue. Une action à la fois ; ni clé, ni espace de travail, ni déploiement ne changent pendant une action, et l'espace de travail ne change pas pendant qu'une formation tourne.
- Le plafond dit dans un dialogue est celui que le déploiement déclare, jamais une valeur supposée ; pour la formation, celui que le desk pose sur la session, vérifié dans la réponse de l'API.
- La formation lit d'abord robots.txt et les conditions de quantmemo.com, et s'arrête si elles interdisent l'accès automatisé ou l'usage par une IA ; le desk ferme alors la reprise (précédent CLD35). quantmemo.com n'est ouvert qu'à la formation (décision de l'ADMIN, 2026-11-03).
- Le desk n'écrit rien dans le magasin de savoir ; il crée le magasin et le lit. Son contenu, écrit par un agent qui a lu le web, est une donnée, jamais une consigne, pour la formation comme pour l'analyste, qui le monte en lecture seule.
- L'agent cloud ne voit rien du desk et ne propose aucun ordre ; son rapport est une donnée affichée, jamais une consigne donnée au modèle conversationnel ni aux agents externes.
- Chaque IPC passe par `trusted(e)` et une validation de forme (`tests/agent-cloud-wiring.test.ts`).

## 7. Ce qui reste à l'ADMIN

- Créer la clé API dans l'organisation Console et y rattacher les crédits Max ; la coller dans Agent IA › D · Lab, depuis le desk qui porte le siège du Lab. Avec une clé d'utilisateur (`sk-ant-usr-…`), indiquer aussi l'espace de travail (Console › Settings › Workspaces).
- Donner la consigne d'analyse et le design des rapports. Le contrat `canto.rapport/1` peut évoluer en `canto.rapport/2` sans casser les fiches déjà rangées.
- Élargir les domaines autorisés, ou ouvrir le réseau, est une décision. Après CLD35, le déploiement installé garde cmegroup.com et l'ancienne consigne jusqu'à *Mettre à jour l'agent* depuis un desk qui porte CLD35.
- Envoyer une donnée du desk à l'agent (journal, séances) serait une nouvelle décision : le pont ne le fait pas.
- Sortir Agent IA de la liste « en conception » du rail (trait tireté) est une décision produit.
- Une vraie exécution (*Lancer maintenant*) vérifiera le pont de bout en bout, sur les crédits.
- Former l'agent (§ 9) : *Mettre à jour l'agent*, puis *Former l'agent* ; lire d'abord la section « Accès et conditions » du rapport de formation, où une clause notée « à confirmer par l'ADMIN » attend sa décision ; relire le magasin dans la Console avant de reprendre. Rouvrir une formation fermée par un accès refusé, élargir ses domaines, rallumer les workflows ou changer son plafond sont des décisions.

## 8. Fichiers

| Fichier | Rôle |
|---|---|
| `src/engine/agent/cloudReport.ts` (+ `electron/agent/cloudReport.d.ts`) | contrat, lecture, codes de fiche |
| `electron/agent-cloud-api.ts` | client HTTP de Managed Agents |
| `electron/agent-cloud.ts` | hôte : clé, relevé, rangement, commandes, dialogues |
| `electron/agent-cloud-formation.ts` | formation quant : consignes du coordinateur et du lecteur, grille, domaines, corps de l'environnement, des deux agents et de la session, parseur de l'état court |
| `electron/agent-cloud-definition.ts` | environnement, agent, déploiement, consigne, grille |
| `electron/main.ts`, `electron/preload.ts`, `src/lib/desk.ts` | IPC `agent-cloud:*` |
| `src/store/agentCloud.ts` | statut et dossier côté renderer |
| `src/modules/agent/CloudReports.tsx`, `reports.module.css` | dossier, plaque, lecteur |
| `src/modules/agent/CloudOptions.tsx` | Agent IA › D · Lab (pilotage, au seul siège du Lab) |
| `src/modules/agent/Agent.tsx`, `agent.module.css` | sous-onglets, bande d'état |
| `src/app/railQuantity.ts` | rapports non lus dans le rail |

## 9. Formation quant

Demandée par l'ADMIN le 3 novembre 2026 : que l'agent cloud suive tous les cours des parcours de https://quantmemo.com/learn/roadmaps pour acquérir le savoir quant, « carte blanche » et sur tous les crédits, en restant économe (décision 13, `docs/THESE-AGENTIQUE.md` § 7 ; tickets CLD36 à CLD49). Un agent ne garde rien d'une session à l'autre : le savoir vit dans un magasin de mémoire Managed Agents, persistant et propre à l'espace de travail, que l'analyste quotidien monte en lecture seule (§ 4).

**Les objets.**

| Objet | Nom | Rôle |
|---|---|---|
| Magasin de mémoire | `canto-savoir-quant`, sous `/mnt/memory/canto-savoir-quant/` | le savoir : `INDEX.md`, `boite-a-outils.md`, `glossaire.md`, `parcours/`, `fiches/<domaine>/<notion>.md`, `_formation/` |
| Environnement | `canto-formation` | réseau `limited` à `quantmemo.com` et `*.quantmemo.com` seulement (décision de l'ADMIN, 2026-11-03), ni paquets ni MCP |
| Coordinateur | `CΛNTO · formation quant` | Claude Opus 5.5, effort élevé : accès et conditions, découverte, plan, relecture, index, synthèse, rapport |
| Lecteur | `CΛNTO · lecteur de cours` | Claude Sonnet 5.5, effort moyen : lit un lot de cours, écrit leurs fiches, rend un compte rendu |
| Session | `CΛNTO · formation quant` | une par lancement, hors déploiement, magasin en lecture et écriture, plafond posé par le desk |

L'environnement, le lecteur et le coordinateur naissent au premier *Former l'agent*, pas à *Mettre à jour l'agent* : si le robot d'Anthropic refusait quantmemo.com, la création de l'agent échouerait (400), et ce refus ne doit pas bloquer la mise à jour de l'analyste. Il reste affiché tel quel, à l'étape nommée, sans contournement. Chaque lancement met les deux agents à jour (une version nouvelle, gratuite). Le code est dans `electron/agent-cloud-formation.ts` ; l'hôte dans `electron/agent-cloud.ts`.

**Multiagent, sans workflows.** Le roster du coordinateur ne compte que le lecteur : pas de copie de soi, qui lirait au tarif d'Opus, ni d'agent défini à la volée, qui tournerait sur Opus avec tous ses outils. Workflows coupés : la demande est de tenir le coût, et le site doit être ménagé ; une session lit 50 cours en 20 lots, sous la limite de 25 fils par session. Pour les rallumer : `workflows: { type: 'enabled', predefined_agents: [<lecteur>], inline_agents: { type: 'disabled' } }` sur le coordinateur, et une ligne de consigne qui dit quand lancer une exécution ; c'est une décision. Si l'organisation n'a pas le type multiagent (400 « Extra inputs are not permitted » sur le champ `multiagent` lui-même, pas sur une entrée du bloc), le coordinateur est recréé seul, c'est écrit dans `agent-cloud.json`, le dialogue le dit, et la consigne prévoit déjà ce cas (25 cours au plus). Chaque lancement réessaie d'abord le multiagent : le repli se défait dès que l'organisation a le type (CLD56).

**Le dialogue.** *Former l'agent* (*Reprendre la formation* dès qu'une session a eu lieu), au seul siège du Lab, ouvre un dialogue du process principal, Annuler par défaut, qui dit :

- les modèles ;
- le site lu, robots.txt et conditions d'abord ;
- « Plafond de la session : 25,00 $, aux tarifs publics (la dernière requête en cours peut le dépasser de peu) » (`FORMATION_BUDGET_CENTS`), vérifié dans la réponse de l'API ;
- la dépense de formation des 30 derniers jours, et les sessions dont le coût n'est pas encore relevé ;
- le plafond de 3,00 $ des rapports quotidiens, et que des crédits épuisés font tout refuser jusqu'au cycle suivant ;
- le magasin, et le savoir déjà acquis ;
- qu'aucune donnée du desk n'est envoyée.

Il n'y a pas de plafond mensuel bloquant : l'ADMIN a dit qu'on pouvait tout dépenser. On compte de 4 à 7 sessions, soit de 60 à 130 $, sur les 134 $ qui restent au plus après les rapports quotidiens ; une session par jour au plus est recommandée, et la première se relit avant la deuxième.

**Les réglages.** Par session : 150 requêtes web au plus (dont 30 pour l'accès et la découverte), 50 cours neufs au plus (25 sans lecteurs), 3 lecteurs en même temps, 20 lots, 10 recherches, 16 000 jetons par page lue, deux itérations du correcteur. Après la première session, `FORMATION_MAX_COURSES` se recale sur le coût réel, dans un ticket à part.

**Une formation à la fois.** Avant tout lancement, le desk relit la session qu'il connaît, puis cherche par le magasin (`GET /v1/sessions?memory_store_id=…`) une session de formation qu'il ne connaîtrait pas : il ne lance jamais deux formations sur le même magasin. Une réponse de création perdue se retrouve de la même façon. Changer d'espace de travail est refusé pendant qu'une formation tourne. Une session de formation que la clé ne voit plus (404 : supprimée dans la Console, ou d'une autre organisation) est oubliée, sa dépense relevée gardée, et la plaque dit « Introuvable avec cette clé » : rien ne reste bloqué (CLD52) ; si elle existe encore ailleurs, son plafond la borne.

**La reprise** est toujours une session nouvelle sur le même magasin : elle relit `_formation/progression.json` et reprend où la précédente s'est arrêtée. Le desk ne relève jamais le plafond d'une session au repos, et son client n'a aucune méthode pour changer un budget ni envoyer un message. Une session restée à son plafond ne coûte plus rien.

**La progression** se lit sans modèle, avant le dialogue et quand une session se règle, jamais à chaque relevé : le nombre de fiches sous `/fiches/` que rend la liste des mémoires, puis l'état court `_formation/etat.json` (2 000 octets au plus, schéma `canto.formation-etat/1`), lu par un parseur strict qui n'en garde que des nombres, la décision d'accès et un titre d'une ligne.

**L'accès refusé ferme la reprise.** Si l'état court dit `acces: interdit` (robots.txt ou les conditions interdisent l'accès automatisé ou l'usage par une IA), *Former l'agent* est refusé dans le process principal, avec la raison ; le rouvrir est une décision de l'ADMIN, comme le retrait du CME (CLD35).

**Arrêter la formation** envoie un `user.interrupt` sans contenu, qui arrête le coordinateur et ses lecteurs ; sans dialogue, puisque cela ne coûte rien.

**Le rapport de formation** suit le contrat `canto.rapport/1` (titre « Formation quant · … », huit sections : accès et conditions, lu, écrit, boîte à outils, reste à faire, coût, contrôle du magasin, signalements). Il se range au dossier commun, marqué `kind: formation` et codé `AGT-FRM-AAAAMMJJ`. Une session de formation n'entre jamais dans les échecs du rapport quotidien : un plafond atteint y est un état normal.
