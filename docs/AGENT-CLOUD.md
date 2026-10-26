# Agent cloud — rapports quotidiens (Managed Agents d'Anthropic)

Demandé par l'ADMIN le 26 octobre 2026 : un agent qui tourne chaque jour dans son bac à sable, sur les serveurs d'Anthropic, payé sur les crédits API mensuels de l'organisation, et dont les rapports apparaissent dans l'onglet 06 · AGT (Agent IA). Ce document décrit le pont livré (tickets CLD1 à CLD11, `docs/AUDIT.md` › « Agent cloud »). L'analyse elle-même est provisoire : la consigne et le design des rapports viendront de l'ADMIN.

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
- **Un hôte, écrit dans le code.** `electron/agent-cloud-api.ts` n'appelle que `https://api.anthropic.com` (bêta `managed-agents-2026-04-01`, `anthropic-version: 2023-06-01`). Les redirections sont refusées, chaque appel a un délai de 20 s, un corps JSON est borné à 2 Mio et décodé en UTF-8 strict. Chaque chemin est bâti d'un identifiant vérifié (`depl_…`, `sesn_…`, `file_…`) ; le renderer ne fournit aucune URL.
- **La clé.** Saisie dans Options › Agent cloud, elle part une fois vers le process principal (`agent-cloud:set-key`, 512 signes au plus), qui la chiffre par le trousseau du système (`safeStorage`) dans `userData/agent-cloud.json` (mode 0600). Elle n'est jamais rendue au renderer, jamais journalisée, jamais exportée (le coffre ne la connaît pas). Sans trousseau, rien n'est gardé. Elle est distincte de la clé du modèle conversationnel.
- **Cadence.** Premier relevé 10 s après l'ouverture, puis toutes les 15 min, et toutes les 3 min tant qu'une session tourne. « Relever maintenant » relève à la demande. Une clé refusée (401, 403) arrête le relevé automatique jusqu'à la saisie d'une nouvelle clé ; un 429 attend son `Retry-After`.
- **Relevé, pas à pas** (`electron/agent-cloud.ts`) :
  1. `GET /v1/deployments/{id}` : état, prochaine échéance, plafond, version de l'agent ;
  2. `GET /v1/sessions?deployment_id=…&order=desc&limit=20` ;
  3. pour chaque session finie, non relevée et sans évaluation en cours : `GET /v1/files?scope_id=<session>`, puis le dernier `rapport.json` (512 Kio au plus), lu par `GET /v1/files/{id}/content` et `parseReport`, puis rangé dans `userData/agent-reports/<session>.json` ;
  4. `GET /v1/deployment_runs?has_error=true` sur sept jours, pour les déclenchements refusés.

  Une session finie sans rapport 30 min après sa dernière mise à jour est notée. Un rapport hors contrat ou non téléchargeable est noté et jamais rangé. Une panne du serveur ou du réseau fait échouer le relevé : la session sera reprise au suivant. Cinq téléchargements au plus par relevé.

## 3. Contrat `canto.rapport/1`

L'agent écrit un seul fichier, `/mnt/session/outputs/rapport.json`, en JSON UTF-8 (`src/engine/agent/cloudReport.ts`, module partagé par le process principal et le renderer) :

| Champ | Forme | Bornes |
|---|---|---|
| `format` | `"canto.rapport/1"` exactement | — |
| `date` | `AAAA-MM-JJ`, une date qui existe | la journée CME analysée |
| `title` | texte sur une ligne | 160 signes |
| `summary` | texte, sauts de ligne gardés | 1 200 signes |
| `sections` | `[{ heading, body }]`, `body` en Markdown | 1 à 24 ; titre 160, corps 24 000 |
| `sources` | `[{ title, url }]`, https seulement | 40 ; une source sans https est écartée |
| `generatedAt` | instant ISO 8601 | facultatif |

Le refus porte sur tout le rapport : forme, `format`, date, titre vide, aucune section, section sans titre ou sans corps. Les caractères de contrôle et les marques bidirectionnelles tombent ; une URL porteuse d'identifiants est écartée. Le lecteur rend le Markdown par `renderMarkdown` (DOMPurify : ni script, ni style, ni formulaire). Les images restent masquées, et la CSP du desk les bloquerait de toute façon. Un lien https s'ouvre dans le navigateur du système, par `setWindowOpenHandler` ; tout autre lien ne fait rien.

## 4. L'agent que le desk installe

Options › Agent cloud › **Installer l'agent cloud** ouvre un dialogue du process principal : *Installer et planifier*, *Installer en pause* ou *Annuler* (par défaut). Il crée, dans l'ordre (`electron/agent-cloud-definition.ts`) :

- **Environnement** `canto-analyste` : conteneur cloud, réseau `limited` aux treize domaines officiels (`OFFICIAL_DOMAINS` : Fed, New York Fed, Fed de Saint-Louis, BLS, BEA, Census, DOL, Trésor, EIA, CFTC, SEC, CME, BCE) et à leurs sous-domaines, sans gestionnaire de paquets ni serveur MCP.
- **Agent** `CΛNTO · analyste quotidien` : Claude Opus 5.5, effort élevé. Outils intégrés en `always_allow`, car aucun client n'est branché sur une exécution planifiée et une demande d'autorisation la bloquerait sans fin. Recherche et lecture web limitées aux mêmes domaines. Aucun outil du desk, aucun serveur MCP, aucun outil d'ordre. La consigne fixe le contrat de sortie et la langue du desk.
- **Déploiement** `canto-rapport-quotidien` : planification d'Options (défaut `0 7 * * 1-5`, `Europe/Paris`), plafond de 3,00 $ par exécution, et résultat attendu (`user.define_outcome`) avec une grille de neuf critères (`OUTCOME_RUBRIC`) : un correcteur relance l'agent une fois au plus si le rapport en manque un.

Chaque identifiant obtenu est écrit aussitôt : une installation coupée en route reprend où elle s'est arrêtée. Le même bouton, devenu *Mettre à jour l'agent*, crée une nouvelle version de l'agent et réépingle le déploiement sur celle-ci ; il applique aussi la planification retenue. *Lancer maintenant* et *Reprendre* passent par un dialogue (Annuler par défaut) ; *Suspendre*, qui ne coûte rien, n'en a pas. Un déploiement créé dans la Console peut être indiqué à la main : le desk le relève sans jamais le modifier.

**Analyse provisoire.** Brief pré-séance : publications et événements officiels du jour CME et du lendemain, leur heure à New York et à Paris, et ce que chacun mesure. Rien d'inventé, aucun ordre, aucune recommandation. À remplacer par la consigne de l'ADMIN dans `cloudSystemPrompt` et `OUTCOME_RUBRIC`, puis *Mettre à jour l'agent*.

## 5. L'onglet Agent IA

- **A · Rapports**, la vue d'ouverture. À gauche, la plaque de l'agent : son trait dit l'état (plein : en service ; tireté : en construction ou en pause ; pointillé : en défaut ou archivé), avec la LED or quand l'agent est en service, le déploiement, la prochaine exécution, le dernier relevé et le plafond. Les erreurs sont des signaux de niveau 2, les échecs de niveau 1, jamais de niveau 3. Viennent ensuite le bordereau `RAPPORTS ···· N FICHES`, la fiche du prochain rapport au trait tireté (prévue), puis les fiches `AGT-RPT-AAAAMMJJ`, codes en clair et sans code-barres, une LED par fiche non lue. À droite, le lecteur. Le dernier rapport s'ouvre de lui-même quand la vue est à l'écran, et une fiche ouverte est marquée lue.
- **B · Conversation** : le modèle conversationnel et les routines Brief / Débrief, inchangés.
- **C · Options** : une bande d'état (agent cloud, modèle, passerelle MCP, orchestrateur, écriture des agents, ordres de l'agent), puis Agent cloud, Fournisseur, Agents externes · MCP, Orchestrateur externe, Ordres proposés par l'agent, Outils natifs.
- **En-tête.** Le bloc-titre montre le dernier relevé, la prochaine exécution (valeur prévue) et le nombre de rapports. Sur la vue Rapports, l'action principale est *Relever maintenant* (chanfrein).
- **Rail.** Sous Agent IA, « N rapport(s) non lu(s) » passe devant l'état de l'orchestrateur.

Les trois vues restent montées (`hidden`) : un brouillon, un défilement ou un réglage en cours survit au changement de vue.

## 6. Garde-fous

- Ni écoute, ni tunnel : relève sortante seule, vers `api.anthropic.com` seul, sans redirection.
- Clé chiffrée dans le process principal, jamais rendue, journalisée ni exportée.
- Installer, lancer, reprendre : dialogue du process principal, Annuler par défaut. Une action à la fois.
- L'agent cloud ne voit rien du desk et ne propose aucun ordre ; son rapport est une donnée affichée, jamais une consigne donnée au modèle conversationnel ni aux agents externes.
- Chaque IPC passe par `trusted(e)` et une validation de forme (`tests/agent-cloud-wiring.test.ts`).

## 7. Ce qui reste à l'ADMIN

- Créer la clé API dans l'organisation Console et y rattacher les crédits Max ; la coller dans Options › Agent cloud.
- Donner la consigne d'analyse et le design des rapports. Le contrat `canto.rapport/1` peut évoluer en `canto.rapport/2` sans casser les fiches déjà rangées.
- Élargir les domaines autorisés, ou ouvrir le réseau, est une décision.
- Envoyer une donnée du desk à l'agent (journal, séances) serait une nouvelle décision : le pont ne le fait pas.
- Sortir Agent IA de la liste « en conception » du rail (trait tireté) est une décision produit.
- Une vraie exécution (*Lancer maintenant*) vérifiera le pont de bout en bout, sur les crédits.

## 8. Fichiers

| Fichier | Rôle |
|---|---|
| `src/engine/agent/cloudReport.ts` (+ `electron/agent/cloudReport.d.ts`) | contrat, lecture, codes de fiche |
| `electron/agent-cloud-api.ts` | client HTTP de Managed Agents |
| `electron/agent-cloud.ts` | hôte : clé, relevé, rangement, commandes, dialogues |
| `electron/agent-cloud-definition.ts` | environnement, agent, déploiement, consigne, grille |
| `electron/main.ts`, `electron/preload.ts`, `src/lib/desk.ts` | IPC `agent-cloud:*` |
| `src/store/agentCloud.ts` | statut et dossier côté renderer |
| `src/modules/agent/CloudReports.tsx`, `reports.module.css` | dossier, plaque, lecteur |
| `src/modules/agent/CloudOptions.tsx` | Options › Agent cloud |
| `src/modules/agent/Agent.tsx`, `agent.module.css` | sous-onglets, bande d'état |
| `src/app/railQuantity.ts` | rapports non lus dans le rail |
