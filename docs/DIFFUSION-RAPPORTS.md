**`SIΞRRΛSKΛ—LAB · CΛNTO · DIFFUSION DES RAPPORTS · NOTE DE CONCEPTION`**

# Diffusion des rapports du Lab aux desks des testeurs

Note de conception du 27 octobre 2026, à trancher par l'ADMIN. Rien n'est codé : aucun hôte réseau nouveau, aucune clé créée ni manipulée tant que l'ADMIN n'a pas décidé par écrit (§ 9).

L'ADMIN veut que le Lab produise les rapports avec son agent et que chaque desk ne fasse que les lire dans Agent IA › A · Rapports (décision de l'ADMIN du 26 octobre 2026, ticket LAB2 ; `docs/AGENT-CLOUD.md` § 5 et § 6). Le pont livré amène les rapports jusqu'au desk du Lab, pas plus loin. Cette note compare trois voies pour le dernier tronçon et recommande la première.

## 1. Point de départ (`main`, `fd9b886`)

- **Seul le desk du Lab relève.** `AgentCloudHost.pullOnce` (`electron/agent-cloud.ts:990`) ne part qu'avec une clé API et un déploiement enregistrés (`:992`). Les poser passe par `setKey` (`:396`), `setWorkspace` (`:438`), `setDeployment` (`:525`) et `provision` (`:741`), que la garde `lab()` (`:667`) refuse à tout desk sans siège du Lab (`LAB_SEATS`, `electron/seat.ts:18`, vérifié par `SeatHost.isLab`, `:155`). La relève elle-même suit la configuration, pas le siège (`configured()`, `electron/agent-cloud.ts:917`). La lecture du dossier n'est pas gardée (`list`, `read`, `markRead`, `:354`) : un desk de testeur saurait afficher des fiches, il n'en reçoit aucune.
- **Ce que voit le testeur.** Un dossier vide, « Dossier en construction » (`src/modules/agent/CloudReports.tsx:277`). Le README le dit tel (`README.md:638`) et sa feuille de route le note (`:772`).
- **Deux formes d'un rapport.** Le fichier de l'agent, au contrat `canto.rapport/1`, est lu par `parseReport` (`src/engine/agent/cloudReport.ts:144`) : champ `format`, `generatedAt` en ISO 8601, 512 Kio au plus (`REPORT_MAX_BYTES`, `:13`), journée à sept jours au plus de la session (`isDateNear`, `:117`). La fiche rangée (`agent-reports/<sesn>.json`, `electron/agent-cloud.ts:1139`) a une autre forme, que seul `coerceStoredReport` relit (`cloudReport.ts:183`) : sans `format`, `generatedAt` en millisecondes, plus `receivedAt` et la session, coût compris (`costCents`, `:52`).
- **Ce que le desk sait déjà vérifier.** Une Release : le Lab signe en Ed25519 `canto-release\n<version>\n<contenu exact de SHA256SUMS.txt>` (`electron/release-signature.ts:13`), et le process principal refuse un installeur dont l'empreinte n'est pas celle qui a été signée (`trustedChecksum`, `:44`). La clé privée vit sur le poste de l'ADMIN, hors du dépôt et de GitHub (`docs/PUBLICATION.md`). Le siège suit le même modèle, avec une autre clé (`electron/seat-keys.ts`) ; les deux listes sont disjointes.
- **Ce que le desk contacte déjà.** À chaque ouverture du lanceur (`electron/launcher-ui.js:768`, puis `:387`), le process principal d'un desk installé interroge `api.github.com` pour la dernière Release (`electron/updater.ts:155`) ; s'il y a mieux, il en lit le journal sur les hôtes de GitHub, chaque redirection vérifiée avant d'être suivie (`fetchReleaseChangelog`, `electron/changelog-fetch.ts`, garde `isGithubHttpsUrl`, `src/engine/changelog/index.ts:122`). Le renderer reste sous `connect-src 'self'` et la boucle locale (`index.html:8`).
- **Le siège n'ouvre qu'un affichage.** « Un code débloque un seul affichage : ce nom, à cette place, sur ce desk » (`docs/SIEGE-NOMINATIF.md` § 2, décision 3), plus le pilotage pour le seul siège du Lab (décision 8). Le siège est caché : ni le README ni les nouveautés ne le nomment (décision 7, `tests/seat.test.ts`).

## 2. Ce que le canal doit tenir

| # | Exigence | D'où elle vient |
|---|---|---|
| E1 | Un desk n'affiche qu'un rapport dont l'origine Lab est prouvée par une signature qu'il vérifie lui-même. | modèle des Releases |
| E2 | Ni rejouage, ni retour à un état plus ancien, ni deux états signés concurrents, ni état figé sans que le desk le dise. | idem (`version` liée au message signé) |
| E3 | Un rapport signé reste un contenu non fiable : texte d'un modèle qui a lu le web, borné, rendu assaini, jamais donné au modèle conversationnel ni aux agents externes. | `docs/AGENT-CLOUD.md` § 3 et § 6 |
| E4 | Rien du desk ne part : ni siège, ni nom, ni jeton, ni identifiant de poste, ni cookie. | `CLAUDE.md` § 5, décision 11 |
| E5 | La clé API d'Anthropic ne quitte pas le desk du Lab ; une clé privée de signature ne passe ni par une session d'agent, ni par le dépôt, ni par GitHub. | `CLAUDE.md` § 3 et § 5 |
| E6 | Le renderer ne gagne aucun accès réseau ; tout passe par le process principal, derrière `trusted(e)`. | `CLAUDE.md` § 4 et § 5 |
| E7 | Coût nul par testeur : une exécution de l'agent sert tous les desks. | plafond de 3,00 $ par exécution |
| E8 | Le Lab retire ou corrige un rapport déjà diffusé, et chaque desk le voit, même resté fermé. Une heure fausse coûte plus cher qu'un rapport absent. | — |
| E9 | Le rapport de 7:00 (Paris) arrive avant la séance du testeur. | `DEFAULT_SCHEDULE` |
| E10 | Diffuser hors du Lab redistribue ce que les rapports tirent de leurs sources : leurs conditions se revoient comme celles des sources du desk. | `src/engine/sources.ts` › `redistributable`, CLD35 |

**Menaces retenues.** Compte GitHub ou jeton du Lab compromis ; hébergeur compromis ; réseau hostile, dont un proxy d'entreprise qui inspecte TLS et peut servir n'importe quel fichier public ancien ; page web lue par l'agent qui glisse un texte dans le rapport ; clé de signature des rapports volée ; testeur qui fait suivre un rapport.

## 3. Voie A — fichiers signés publiés sur GitHub (modèle `SHA256SUMS.txt`)

### 3.1 Principe

```
desk du Lab ─► agent-reports/<sesn>.json ─► poste de l'ADMIN : relire, signer ─► dépôt public des rapports
                                                                                     │  GET, sans identifiant
desk du testeur — process principal : signature, fraîcheur, empreinte, parseReport ◄─┘ ─► agent-reports/ ─► A · Rapports
```

Le desk du Lab relève Anthropic comme aujourd'hui. L'ADMIN choisit les rapports à diffuser, les signe sur son poste et les pousse dans un dépôt public dédié (nom à décider, par exemple `0xSrk/C-NTO-rapports`). Chaque desk lit ce dépôt, vérifie, et range les fiches dans le dossier qu'il affiche déjà.

### 3.2 Format

Trois sortes de fichiers, avec un `.gitattributes` en `* -text` : git ne touche à aucun octet, et le script signe les octets qu'il pousse.

- `rapports/<sesn>.json` : le rapport sous la forme que lit `parseReport` (`format`, `generatedAt` en ISO 8601), refait par le script depuis la fiche du desk du Lab, plus la session qui l'a produit : identifiant, création (obligatoire, sans quoi `isDateNear` n'a rien à quoi se mesurer), version de l'agent. Ni coût, ni `receivedAt`.
- `RAPPORTS.txt` : l'index, une ligne par fiche, comme `SHA256SUMS.txt`.

  ```
  canto-rapports/1
  seq 37
  emis 2026-10-27T07:42:10Z
  expire 2026-11-03T07:42:10Z
  <sha256>  sesn_….json
  retire sesn_… 2026-10-27
  ```

  `seq` croît à chaque publication. Au-delà de `expire`, l'index ne vaut plus rien. Une fiche dont l'empreinte change à `seq` supérieur est une révision. `retire` sort une fiche de tous les desks ; ces lignes restent dans l'index pour toujours, quand les fiches, elles, n'y restent que pour les 400 dernières (`LIST_MAX`). 256 Kio au plus.
- `RAPPORTS.txt.sig` : Ed25519 de `canto-rapports\n<dépôt>\n<contenu exact de RAPPORTS.txt>`, par une clé des rapports. Le nom du dépôt est écrit dans le code du desk : un index signé pour un dépôt d'essai ne se rejoue pas vers les desks.

Une seule signature par publication couvre tout, par les empreintes : c'est le chemin de confiance des Releases. Le préfixe sépare les domaines : une signature de Release (`canto-release`) ou de siège (`SIEGE1.`) ne vérifie jamais un index, ni l'inverse.

### 3.3 Qui signe

| Variante | Où vit la clé privée | Verdict |
|---|---|---|
| **A1 · l'ADMIN, à la main** | Sur son poste, comme la clé de publication. Un script, sur le modèle de `scripts/sign-release.mjs`, montre la fiche, fait taper sa date, signe, écrit dans un clone du dépôt des rapports, puis pousse. | **Recommandée,** avec une clé chiffrée par phrase de passe, demandée à chaque signature. La signature vaut relecture : un rapport diffusé est un rapport que l'ADMIN a lu. Aucune clé ni jeton GitHub dans un desk. Deux à cinq minutes par jour ouvré. |
| A2 · le desk du Lab, seul | Dans le trousseau du desk du Lab, avec un jeton GitHub en écriture. | Différée. Un jeton d'écriture vivrait dans un desk ouvert toute la journée, et un rapport partirait sans relecture. |
| Écartées | Secret GitHub (Actions) ; bac à sable de l'agent cloud. | La première contredit E5 ; la seconde met la clé à côté d'un modèle qui lit le web : une page piégée suffirait. |

A1 et A2 vivent sur le même poste, où travaillent aussi des sessions d'agent. Seules deux choses les séparent : A1 n'a pas de jeton dans un desk, et elle impose la relecture. La phrase de passe garde la clé d'un programme qui lit le disque. C'est pourquoi elle est une condition de A1, pas une option.

### 3.4 Relève sur le desk de chaque lecteur

1. **Requête.** Le process principal lit `RAPPORTS.txt` et `RAPPORTS.txt.sig` (1 Kio au plus), puis les fiches, dans une session Electron dédiée, en mémoire, sans cache ni cookie. Chaque appel part avec `credentials: 'omit'` (comme `electron/agent-cloud-api.ts:353`), sans `Authorization`, avec l'agent `CANTO-Desk`, en https, sans redirection, avec un délai de 20 s, et se lit en UTF-8 strict. Toute adresse est bâtie de constantes et d'un `sesn_…` vérifié (`isApiId`), jamais d'une URL lue dans l'index.
2. **Signature.** Le desk la vérifie contre une liste nouvelle, `electron/report-keys.ts`, disjointe des clés de publication et de siège. **Liste vide : la relève ne part pas du tout.** C'est la règle du siège, plus stricte que celle des Releases.
3. **Fraîcheur et ordre.** Le desk refuse un `emis` à plus d'un jour dans le futur de son horloge. Passé `expire`, l'index est refusé, et A · Rapports dit « index du Lab périmé depuis le … ». Le dernier `seq` vu se garde par clé : un `seq` inférieur est refusé (retour arrière) ; un `seq` égal à contenu différent aussi (équivoque). Le `seq` d'une clé sortie de `report-keys.ts` s'oublie.
4. **Fiches.** Dix au plus par relève (comme `DOWNLOADS_PER_PULL`, `electron/agent-cloud.ts:30`), des plus récentes aux plus anciennes. Un desk neuf ne rattrape que les trente dernières (nombre à décider). Chacune passe par son SHA-256, comparé à la ligne signée, puis par `parseReport`, puis par `isDateNear` contre la création de sa session. L'identifiant du fichier doit être celui de la ligne. Une empreinte qui ne correspond pas est un échec passager (un `push` entre deux lectures) : la fiche est reprise à la relève suivante, jamais notée définitive.
5. **Rangement.** Dans `agent-reports/`, dédoublonné par l'identifiant de session. La version publiée prime partout, desk du Lab compris. Une révision repasse la fiche en non lue et la marque « révisée le … ». Un retrait garde la fiche au dossier, remplace son corps par « retiré par le Lab le … », et s'inscrit sur le desk.

**Hôte.** L'API des contenus de GitHub, `api.github.com`, que chaque desk installé appelle déjà à l'ouverture du lanceur, en média brut, sans redirection. Sans authentification, GitHub accorde 60 requêtes par heure et par adresse IP ([doc GitHub](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). Ce quota est partagé avec la mise à jour (`electron/updater.ts:155`, `electron/native-update.ts:45`) et entre les postes d'un même réseau. Une relève coûte deux requêtes, plus une par fiche. Elle lit `x-ratelimit-remaining` et `x-ratelimit-reset`, attend la remise à zéro, et s'arrête sous une réserve, par exemple vingt requêtes, gardée pour le lanceur : épuisé, le quota priverait le desk de sa mise à jour signée. `raw.githubusercontent.com`, déjà nommé dans le code (`electron/updater.ts:136`, voie dépôt cloné), a une limite que GitHub ne chiffre pas : il ne fonde aucun choix ici.

**Cadence.** À l'ouverture, puis toutes les heures tant que le desk est ouvert. La vue A n'a « ni plaque, ni réglage, ni commande » (LAB3, `docs/AGENT-CLOUD.md:67`). Un desk qui lit n'y gagne donc pas *Relever maintenant*, sauf décision. Si l'ADMIN l'y met, le process principal le borne, par exemple à une fois par cinq minutes.

**Variante écartée : une Release dédiée dans `0xSrk/C-NTO`.** `releases/latest`, que lisent les mises à jour, et le workflow `release` vivent dans ce dépôt : une erreur de publication toucherait la mise à jour de tous les desks. De plus, GitHub borne une Release à 1 000 fichiers ([doc GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)), un fichier ne s'y remplace pas en place, et son téléchargement passe par une redirection qu'il faudrait suivre.

### 3.5 Sécurité

- **Signature.** Un compte GitHub compromis peut effacer ou altérer le dépôt, pas signer : les desks refusent. TLS ne garde rien ici ; la signature, si.
- **Rejouage, retour arrière, équivoque.** L'empreinte signée ferme la substitution d'une fiche ; le `seq` par clé ferme le retour arrière et l'équivoque. Un rapport ancien jamais vu, mais signé, est de l'historique légitime.
- **Gel et premier index.** Tout l'historique signé est public : un proxy qui inspecte TLS peut servir à un desk, même neuf, un index ancien puis le figer, et retenir ainsi une ligne `retire`. `expire` borne cette fenêtre : passé l'échéance, l'index est refusé et le desk le dit. L'ADMIN signe donc au moins une fois avant chaque échéance, ce que sa signature des jours ouvrés fait déjà.
- **Clé volée.** Le voleur peut diffuser de faux rapports et retirer les vrais. Il peut aussi signer un `seq` démesuré, qui ferait refuser tout index légitime. Le `seq` gardé par clé, oublié quand la clé sort de la liste, rend la rotation complète : une Release signée par la clé de publication retire la clé volée, et les desks repartent. La clé de publication reste la racine ; une clé des rapports volée ne pousse aucun installeur.
- **Contenu non fiable.** Signé ne veut pas dire vrai. Le texte reste borné, assaini (DOMPurify), sans image ; chaque lien porte son hôte et s'ouvre dans le navigateur du système. Hors de son propre module, `cloudReport` n'est importé que par le pont (`electron/agent-cloud*.ts`), le store et le dossier (`src/store/agentCloud.ts`, `src/lib/desk.ts`, `CloudReports.tsx`). Ni un autre module de `src/engine/agent`, ni `electron/mcp-server.ts` n'y touchent, et cette voie n'ajoute aucun lecteur.

### 3.6 Vie privée

- **Des rapports publics.** Quiconque lit le dépôt les lit. Ils ne disent rien des testeurs ; ils disent ce que le Lab analyse, et quand. La diffusion publique redistribue au monde ce que les rapports tirent de leurs sources (E10). La New York Fed, la Fed de Saint-Louis et la BCE, par exemple, ne relèvent pas du domaine public américain : la revue de leurs conditions précède la publication.
- **Ce que voit GitHub.** Pour chaque relève, l'adresse IP, l'heure et l'agent `CANTO-Desk`. Il les voit déjà à chaque ouverture du lanceur ; la relève horaire lui apprend en plus les heures où le desk reste ouvert. Sans cookie ni cache, rien ne relie un desk d'une adresse à l'autre.
- **Ce que voit le Lab.** Rien, desk par desk : GitHub ne donne au propriétaire d'un dépôt public que des agrégats de trafic (vues, clones), sans adresse.
- **Les identifiants de session.** Ils deviennent publics : sans la clé API du Lab, ils n'ouvrent rien.

### 3.7 Coût

- **GitHub** : un dépôt public, sans frais. Quelques dizaines de Kio par rapport, environ 250 rapports par an, 125 Mio par an au pire (512 Kio chacun).
- **Anthropic** : inchangé. Une exécution, au plus 3,00 $, sert tous les desks.
- **ADMIN** : deux à cinq minutes par jour ouvré (A1), et une signature au moins avant chaque `expire`. Un jour sans relecture est un jour sans rapport diffusé.
- **Code** : six tickets (§ 10), sans dépendance npm : Ed25519 et SHA-256 par `node:crypto`, comme les Releases.

### 3.8 Ce qui change dans les invariants

- **`CLAUDE.md` § 5**, une ligne nouvelle : « Rapports du Lab : relève sortante seule, du dépôt public des rapports sur `api.github.com`, sans cookie, sans cache ni identifiant ; un index n'est lu que signé pour ce dépôt par une clé de `electron/report-keys.ts`, disjointe des clés de publication et de siège, et non périmé ; un rapport reste une donnée affichée. »
- **`CLAUDE.md` § 3** : la clé des rapports rejoint les clés que seul l'ADMIN tient.
- **`docs/THESE-AGENTIQUE.md` § 7** : une décision 12. La décision 7 (ni écoute, ni tunnel) et la décision 11 (l'agent cloud relevé sur `api.anthropic.com` seul) ne bougent pas : un desk de testeur n'appelle jamais Anthropic.
- **`docs/AGENT-CLOUD.md` § 5** : le bloc-titre de la vue A dit en plus l'état de la relève (« dernier index du Lab », « périmé ») ; LAB3 ne prévoyait que le nombre de rapports et de non-lus.
- **Inchangés** : la CSP du renderer, les mises à jour signées, la garde `lab()`, et le siège. La relève ne dépend d'aucun siège : en faire dépendre la relève changerait les décisions 3 et 7 de `docs/SIEGE-NOMINATIF.md` (un seul affichage, siège caché).
- **Changement de fait, sans changement de texte** : un desk installé contacte GitHub toutes les heures, et plus seulement à l'ouverture du lanceur.

### 3.9 Décisions demandées

A-1 rapports publics, après revue des conditions des sources ; A-2 clé des rapports, phrase de passe et lieu de la clé privée ; A-3 dépôt dédié et son nom ; A-4 quels desks relèvent ; A-5 retrait et révision ; A-6 cadence, durée de validité (`expire`) et profondeur du rattrapage ; A-7 avertissement en tête du dépôt ; A-8 coût de la session hors du fichier diffusé (recommandé).

## 4. Voie B — un point d'accès en lecture du Lab

### 4.1 Principe

Un service du Lab sur Internet (fonction et stockage chez un hébergeur, sous un domaine du Lab) sert l'index et les fiches. Le desk le lit par le process principal, avec ou sans jeton par testeur.

### 4.2 Sécurité

- **La signature reste nécessaire.** Sans elle, l'hébergeur et le compte du Lab chez lui deviennent la seule confiance. Avec elle, B est la voie A servie par un autre hôte, avec les mêmes `seq`, `expire` et retraits.
- **Alimentation.** Soit le desk du Lab pousse, avec un jeton d'écriture dans son process principal (la réserve de A2), soit l'ADMIN téléverse. Que le service relève lui-même Anthropic est exclu : la clé API quitterait le desk du Lab (E5).
- **Jeton par testeur.** Il ouvre la confidentialité et la révocation. En échange, chaque desk garde un secret (trousseau) et l'envoie à chaque relève, et le Lab maintient un service exposé (authentification, abus, journaux).

### 4.3 Vie privée

Le Lab et son hébergeur voient l'adresse et l'heure de chaque relève. Avec un jeton, ils savent quel testeur lit quoi, et quand : c'est une télémétrie, que E4 et la décision 11 (« aucune donnée du desk ne part ») excluent. Le Lab deviendrait aussi responsable d'un traitement de données personnelles (adresses IP rattachées à des testeurs) : durée de conservation, registre, information des testeurs. Sans jeton, les rapports sont publics, comme dans la voie A.

### 4.4 Coût

- **Hébergement** : un domaine, de l'ordre de 10 à 20 € par an ; un hébergement que ce volume laisse sans doute dans un palier gratuit (à vérifier chez l'hébergeur retenu).
- **Exploitation** : du temps, pour un service qui vit hors du dépôt du desk.
- **Code** : la voie A, plus le service, l'authentification et la révocation, soit à peu près le double.

### 4.5 Ce qui change dans les invariants

- **Un hôte nouveau**, épinglé dans une liste du process principal (sur le modèle de `electron/llm-host.ts`).
- **Une décision 12** qui ouvre un serveur du Lab, au-delà d'`api.anthropic.com`.
- **Avec un jeton**, « rien du desk ne part » ne tient plus.
- **Inchangée** : la porte (`127.0.0.1`). Le desk n'écoute toujours rien.

### 4.6 Décisions demandées

Domaine et hébergeur ; jeton ou pas ; durée de conservation des journaux ; qui exploite le service ; et tout ce que demande la voie A pour la signature.

## 5. Voie C — une diffusion par le siège nominatif

Le siège désigne déjà les testeurs, et l'on peut vouloir qu'il ouvre aussi les rapports. Mais il ne débloque, par décision, qu'un affichage (décision 3), et il est caché (décision 7). Toute diffusion « par le siège » change donc d'abord ces deux décisions. Voici trois façons de lier le siège aux rapports, de la plus lourde à la plus légère.

### 5.1 C1 · le siège comme laissez-passer

Le desk présente sa ligne `SIEGE1` à un service, qui ne sert les rapports qu'aux sièges. **À écarter**, pour quatre raisons :

- **La ligne n'est pas un secret.** C'est un nom signé, sans lien au poste, collé depuis un message, valable sans date de fin (`docs/SIEGE-NOMINATIF.md` § 6). Qui l'a, l'a.
- **Pas de révocation propre.** Le service ne peut révoquer un siège qu'avec une liste de révocation, ou en retirant la clé de siège, ce qui ôterait leur nom à tous les testeurs.
- **Le nom quitterait le desk** à chaque relève, contre E4 et la décision 11.
- **Il faut un service** : celui de la voie B.

### 5.2 C2 · des rapports chiffrés pour les testeurs

Chaque desk crée une paire X25519 dans son trousseau et montre une « clé de réception » publique. Le testeur l'envoie à l'ADMIN à la remise de son siège ; elle n'est pas dans le siège. Pour chaque rapport signé, le script de l'ADMIN tire une clé de contenu et chiffre une seule fois (AES-256-GCM). Il enveloppe cette clé pour chaque destinataire (X25519 puis HKDF, par `node:crypto`, sans dépendance) et publie ce fichier unique dans le dépôt de la voie A. Le desk le télécharge et essaie ses enveloppes : son URL ne dit rien de lui.

- **Sécurité.** La signature et l'index de la voie A, plus la confidentialité. Révoquer un testeur, c'est cesser de l'envelopper : les rapports suivants lui échappent, ceux qu'il a déjà restent lisibles. Un testeur peut toujours faire suivre un rapport en clair.
- **Vie privée.** Celle de la voie A, sans contenu public. Le dépôt trahit le nombre de destinataires.
- **Coût.** La voie A, plus une clé par desk, un échange de clé à chaque nouveau testeur, et une centaine d'octets par destinataire et par rapport.
- **Invariants.** Ceux de la voie A, plus un secret nouveau dans le trousseau de chaque desk. La décision 3 du siège ne change pas si la clé de réception reste à côté de lui. Mais le desk montre une commande de plus, et sa mention dans le README touche la décision 7.

### 5.3 C3 · la remise en main propre

L'ADMIN envoie à chaque testeur, par sa propre messagerie, le fichier signé du jour (index et fiche). Le testeur l'ouvre dans le desk par un dialogue du process principal (*Importer…*) ; le renderer ne fournit aucun chemin (modèle de `electron/folder-grants.ts`). Le vérificateur est celui de la voie A.

- **Sécurité.** Celle de la voie A ; aucun réseau.
- **Vie privée.** Le desk ne contacte personne ; la messagerie connaît les envois.
- **Coût.** Peu de code, mais un geste par jour et par testeur, chez l'ADMIN comme chez chaque testeur. Tient pour un ou deux testeurs, pas au-delà.
- **Invariants.** Aucun hôte ; une commande IPC derrière `trusted(e)`, et une commande dans l'onglet, contre LAB3.

### 5.4 Décisions demandées

- **C1** : changer la nature du siège, ce que la note déconseille.
- **C2** : la confidentialité vaut-elle une clé de plus par desk et un échange à chaque testeur ?
- **C3** : sert-elle de secours, pour un desk sans réseau ?

## 6. Voies écartées d'emblée

- **Donner la clé Anthropic du Lab aux testeurs.** Une clé API ne se borne pas à la lecture : elle installe, lance et dépense. Contraire à E5.
- **Un agent par testeur**, avec sa clé et ses crédits. Ce n'est plus une diffusion, et cela contredit la décision du 26 octobre (le Lab produit, les desks lisent) : jusqu'à 3,00 $ par exécution et par desk.
- **Les rapports dans les Releases du desk.** Une Release n'est pas quotidienne, et sa signature n'atteste pas un rapport.
- **Le renderer qui relève lui-même.** La CSP l'interdit, et doit continuer de l'interdire.
- **Un desk qui écoute, ou un partage de pair à pair.** Décision 7 de la thèse.

## 7. Comparaison

| | A · GitHub signé | B · point d'accès du Lab | C2 · chiffré pour les testeurs | C3 · main propre |
|---|---|---|---|---|
| Origine prouvée | signature Ed25519 | signature (à garder) | signature | signature |
| Retour arrière, équivoque, gel | `seq` par clé, `expire` | idem | idem | idem |
| Rapports publics | oui | sans jeton : oui ; avec : non | non (contenu) | non |
| Ce qui part du desk | rien (IP vue de GitHub) | IP, et le jeton s'il y en a un | rien (IP vue de GitHub) | rien |
| Hôte nouveau | aucun (`api.github.com`) | oui | aucun | aucun |
| Secret sur le desk du testeur | aucun | jeton (option) | clé de réception | aucun |
| Révocation d'un testeur | sans objet | oui (jeton) | pour la suite | cesser d'envoyer |
| Retrait d'un rapport | ligne `retire`, à la relève | ligne `retire`, à la relève | ligne `retire`, à la relève | nouvel envoi |
| Service à exploiter | aucun | oui | aucun | aucun |
| Geste quotidien de l'ADMIN | signer | signer | signer, envelopper (script) | signer, envoyer à chacun |
| Code (ordre de grandeur) | six tickets | une douzaine, plus le service | une dizaine | trois |

## 8. Recommandation

**La voie A, en variante A1 :** l'ADMIN relit, signe sur son poste avec une clé chiffrée par phrase de passe, et publie dans un dépôt public dédié ; chaque desk vérifie dans le process principal. Cette voie :

- reprend le chemin de confiance que le desk applique déjà aux Releases ;
- n'ouvre aucun hôte nouveau ;
- ne met aucun secret sur le desk d'un testeur, et n'en fait rien partir qui l'identifie ;
- ne coûte rien de plus par testeur.

Sa signature atteste aussi que l'ADMIN a lu le rapport, ce que ni la Console ni l'agent n'attestent. La relève vaut pour tout desk qui la reçoit, sans siège : la lier au siège changerait les décisions 3 et 7 de `docs/SIEGE-NOMINATIF.md`, pour un filtre que des fichiers publics ne protègent pas.

Deux questions la conditionnent :

1. **Les rapports peuvent-ils être publics ?** Il faut pour cela la revue des conditions des sources (E10). Si la réponse est non, C2 sur le transport de la voie A vaut mieux que B : elle garde E4 et l'absence de serveur, au prix d'une clé de réception par desk. B ne se justifie que si l'ADMIN veut savoir qui lit.
2. **Où vit la clé des rapports ?** Sur le poste de l'ADMIN, à côté de la clé de publication. La garde qu'il retiendra pour ses clés privées vaut pour elle, phrase de passe comprise.

C3 peut venir plus tard, pour un desk sans réseau : elle partage le vérificateur de la voie A.

## 9. Questions pour l'ADMIN

1. Diffuser les rapports en public (voie A), ou les réserver aux testeurs (C2, ou B) ? Pour la voie A, la revue des conditions des sources de l'agent (douze domaines, `OFFICIAL_DOMAINS`) est-elle à faire avant la première publication ?
2. Créer une clé Ed25519 des rapports, distincte des clés de publication et de siège, chiffrée par phrase de passe, et dire où elle vit. La générer et inscrire sa clé publique dans `electron/report-keys.ts` est un geste de l'ADMIN, avant le tag de la version qui relève.
3. Créer le dépôt public des rapports, et le nommer : son nom est écrit dans le code et signé.
4. Quels desks relèvent ? Tout desk installé (recommandé), ou derrière un interrupteur dans C · Options ? Le siège n'en décide pas, sauf à changer ses décisions 3 et 7.
5. Retrait et révision d'un rapport diffusé : les deux, ou le retrait seul ?
6. Cadence (toutes les heures, ou à heures fixes, par exemple 7:45, 9:00 et 13:00 à Paris, pour en dire moins à GitHub) ; validité de l'index (`expire`, par exemple sept jours) ; profondeur du rattrapage d'un desk neuf (par exemple trente fiches).
7. *Relever maintenant* sur le desk d'un testeur, contre LAB3, ou la relève automatique seule ?
8. Avertissement public : le README le dit déjà (« its reports are information, not advice », `README.md:821`) ; le dépôt des rapports le reprend-il mot pour mot ?
9. Le coût de chaque exécution reste-t-il hors du fichier diffusé ?
10. Le bêta-testeur qui porte déjà un siège sert-il de premier lecteur, sur la version qui portera la relève ?

## 10. Si l'ADMIN retient la voie A

Un ticket, un commit, un test, dans l'ordre :

| Ticket | Contenu | Preuve |
|---|---|---|
| DIF1 | Contrat de l'index `canto-rapports/1` et vérification dans le process principal, sur le modèle de `electron/release-signature.ts` : message lié au dépôt ; `seq` par clé ; `emis` et `expire` ; équivoque ; empreintes ; lignes `retire` permanentes. | Séparation des domaines (une signature de Release ou de siège ne vérifie pas un index, ni l'inverse) ; trois listes de clés disjointes ; index d'un autre dépôt refusé ; rotation après un `seq` démesuré. |
| DIF2 | `electron/report-keys.ts`, vide : la relève ne part pas. | Aucun appel réseau sans clé. |
| DIF3 | Hôte de relève : session en mémoire sans cache ni cookie ; bornes (256 Kio, 1 Kio, 512 Kio) ; ni redirection ni identifiant ; adresses bâties de constantes et d'un `sesn_…` vérifié ; dix fiches par relève, rattrapage borné ; quota lu, avec une réserve pour le lanceur ; empreinte fausse traitée en échec passager ; rangement dédoublonné ; `seq` et retraits persistants. | Rouge sans chaque garde. |
| DIF4 | Statut et vue A : « dernier index du Lab », « périmé », état de la relève à la place de « Dossier en construction » ; fiche révisée repassée en non lue ; fiche retirée affichée comme telle ; FR, EN, ES. | `tests/agent-cloud-folder.test.ts` |
| DIF5 | Script de l'ADMIN : montre la fiche, fait taper sa date, demande la phrase de passe, refait la forme `canto.rapport/1`, signe les octets écrits, écrit dans le clone du dépôt des rapports (`.gitattributes` en `-text`). Il refuse une clé dans un dépôt, une clé non chiffrée, et une clé absente de `report-keys.ts`. | Paire éphémère, hors dépôt. |
| DIF6 | `docs/AGENT-CLOUD.md`, `CLAUDE.md` § 3 et § 5, décision 12, README (« Lab reports », feuille de route), section de `docs/AUDIT.md`. | — |

L'ADMIN garde la création de la clé et du dépôt, chaque signature, et la version qui embarque la clé publique.

## 11. Relevé en route, hors de cette note

- La mise à jour et son journal appelaient `net.fetch` sans `credentials`. Or, sous Electron 43.7.1, `net.fetch` garde les cookies d'une réponse, redirection comprise, dans la session par défaut, qui est persistante, et les renvoie. Corrigé par UPD1 (`docs/AUDIT.md`) pour la mise à jour, puis par UPD3 pour le calendrier officiel ; les marchés crypto partaient déjà sans cookie. La garde d'hôte final du journal, inopérante parce que `net.fetch` rend une `url` vide, est refaite par UPD2 : chaque saut est vérifié avant d'être suivi.
- `agent-cloud:pull` n'a ni garde `lab()` ni cadence (`electron/main.ts:917`). Un desk qui perd le siège du Lab en gardant clé et déploiement relève encore ; LAB4 l'a laissé, puisque seul le retrait de la clé publique, une décision de l'ADMIN, fait perdre le siège.
