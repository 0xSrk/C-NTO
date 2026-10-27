**`SIΞRRΛSKΛ—LAB · CΛNTO · DIFFUSION DES RAPPORTS · NOTE DE CONCEPTION`**

# Diffusion des rapports du Lab aux desks des testeurs

Note de conception du 27 octobre 2026. L'ADMIN a tranché la première question le jour même : les rapports restent réservés aux testeurs, par la voie C2 (§ 5.5). Rien n'est codé : aucun hôte réseau nouveau, aucune clé créée ni manipulée tant que l'ADMIN n'a pas validé la suite par écrit (§ 9).

L'ADMIN veut que le Lab produise les rapports avec son agent et que chaque desk ne fasse que les lire dans Agent IA › A · Rapports (décision de l'ADMIN du 26 octobre 2026, ticket LAB2 ; `docs/AGENT-CLOUD.md` § 5 et § 6). Le pont livré amène les rapports jusqu'au desk du Lab, pas plus loin. Cette note compare trois voies pour le dernier tronçon. Elle recommandait la première, des rapports publics ; l'ADMIN les réserve aux testeurs. La voie C2 est donc retenue : des rapports chiffrés pour chaque desk inscrit, sur le transport de la voie A.

## 1. Point de départ (`main`, `fd9b886`)

- **Seul le desk du Lab relève.** `AgentCloudHost.pullOnce` (`electron/agent-cloud.ts:990`) ne part qu'avec une clé API et un déploiement enregistrés (`:992`). Les poser passe par `setKey` (`:396`), `setWorkspace` (`:438`), `setDeployment` (`:525`) et `provision` (`:741`), que la garde `lab()` (`:667`) refuse à tout desk sans siège du Lab (`LAB_SEATS`, `electron/seat.ts:18`, vérifié par `SeatHost.isLab`, `:155`). La relève elle-même suit la configuration, pas le siège (`configured()`, `electron/agent-cloud.ts:917`). La lecture du dossier n'est pas gardée (`list`, `read`, `markRead`, `:354`) : un desk de testeur saurait afficher des fiches, il n'en reçoit aucune.
- **Ce que voit le testeur.** Un dossier vide, « Dossier en construction » (`src/modules/agent/CloudReports.tsx:277`). Le README le dit tel (`README.md:638`) et sa feuille de route le note (`:772`).
- **Deux formes d'un rapport.** Le fichier de l'agent, au contrat `canto.rapport/1`, est lu par `parseReport` (`src/engine/agent/cloudReport.ts:144`) : champ `format`, `generatedAt` en ISO 8601, 512 Kio au plus (`REPORT_MAX_BYTES`, `:13`), journée à sept jours au plus de la session (`isDateNear`, `:117`). La fiche rangée (`agent-reports/<sesn>.json`, `electron/agent-cloud.ts:1139`) a une autre forme, que seul `coerceStoredReport` relit (`src/engine/agent/cloudReport.ts:183`) : sans `format`, `generatedAt` en millisecondes, plus `receivedAt` et la session, coût compris (`costCents`, `:52`).
- **Ce que le desk sait déjà vérifier.** Une Release : le Lab signe en Ed25519 `canto-release\n<version>\n<contenu exact de SHA256SUMS.txt>` (`electron/release-signature.ts:13`), et le process principal refuse un installeur dont l'empreinte n'est pas celle qui a été signée (`trustedChecksum`, `:44`). La clé privée vit sur le poste de l'ADMIN, hors du dépôt et de GitHub (`docs/PUBLICATION.md`). Le siège suit le même modèle, avec une autre clé (`electron/seat-keys.ts`) ; les deux listes sont disjointes.
- **Ce que le desk contacte déjà.** À chaque ouverture du lanceur (`electron/launcher-ui.js:721`, puis `:342`), le process principal d'un desk installé interroge `api.github.com` pour la dernière Release (`electron/updater.ts:155`) ; s'il y a mieux, il en lit le journal sur les hôtes de GitHub, chaque redirection vérifiée avant d'être suivie (`fetchReleaseChangelog`, `electron/changelog-fetch.ts`, garde `isGithubHttpsUrl`, `src/engine/changelog/index.ts:122`). Le renderer reste sous `connect-src 'self'` et la boucle locale (`index.html:8`).
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

Depuis la décision du 27 octobre, la voie A ne publie plus de rapport en clair. Son transport (§ 3.2 à § 3.5) porte la voie C2 (§ 5.5).

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
- **Code** : six tickets, que le § 10 reprend pour C2, sans dépendance npm : Ed25519 et SHA-256 par `node:crypto`, comme les Releases.

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

**Retenue par l'ADMIN le 27 octobre 2026 ; détaillée au § 5.5.**

Chaque desk crée une paire X25519 dans son trousseau et montre une « clé de réception » publique. Le testeur l'envoie à l'ADMIN à la remise de son siège ; elle n'est pas dans le siège. Pour chaque rapport signé, le script de l'ADMIN tire une clé de contenu et chiffre une seule fois (AES-256-GCM). Il enveloppe cette clé pour chaque destinataire (X25519 puis HKDF, par `node:crypto`, sans dépendance) et publie ce fichier unique dans le dépôt de la voie A. Le desk le télécharge et essaie ses enveloppes : son URL ne dit rien de lui.

- **Sécurité.** La signature et l'index de la voie A, plus la confidentialité. Révoquer un testeur, c'est cesser de l'envelopper : les rapports suivants lui échappent, ceux qu'il a déjà restent lisibles. Un testeur peut toujours faire suivre un rapport en clair.
- **Vie privée.** Celle de la voie A, sans contenu public. Sans enveloppes factices, le dépôt trahirait le nombre de destinataires (§ 5.5.2).
- **Coût.** La voie A, plus une clé par desk, un échange de clé à chaque nouveau testeur, et environ 130 octets par enveloppe et par rapport.
- **Invariants.** Ceux de la voie A, plus un secret nouveau dans le trousseau de chaque desk. La décision 3 du siège ne change pas si la clé de réception reste à côté de lui. Mais le desk montre une commande de plus ; le README peut la taire, comme il tait le siège (décision 7).

### 5.3 C3 · la remise en main propre

L'ADMIN envoie à chaque testeur, par sa propre messagerie, le fichier signé du jour (index et fiche). Le testeur l'ouvre dans le desk par un dialogue du process principal (*Importer…*) ; le renderer ne fournit aucun chemin (modèle de `electron/folder-grants.ts`). Le vérificateur est celui de la voie A.

- **Sécurité.** Celle de la voie A ; aucun réseau.
- **Vie privée.** Le desk ne contacte personne ; la messagerie connaît les envois.
- **Coût.** Peu de code, mais un geste par jour et par testeur, chez l'ADMIN comme chez chaque testeur. Tient pour un ou deux testeurs, pas au-delà.
- **Invariants.** Aucun hôte ; une commande IPC derrière `trusted(e)`, et une commande dans l'onglet, contre LAB3.

### 5.4 Décisions demandées

- **C1** : changer la nature du siège, ce que la note déconseille.
- **C2** : retenue par l'ADMIN le 27 octobre 2026 (§ 5.5).
- **C3** : sert-elle de secours, pour un desk sans réseau ?

### 5.5 La voie C2 en détail

Décision de l'ADMIN du 27 octobre 2026 : les rapports restent réservés aux testeurs. C2 garde le transport de la voie A : le dépôt public dédié, l'index signé (§ 3.2, avec les lignes du § 5.5.2), la relève sans identifiant (§ 3.4) et ses gardes (§ 3.5). Elle y ajoute le chiffrement : le dépôt ne porte plus que des chiffrés, et seuls les desks inscrits les ouvrent.

La construction a été prototypée hors du dépôt le 27 octobre, sans dépendance. Le scellement tourne sous Node 22 (OpenSSL 3.5), comme le ferait le script de l'ADMIN ; l'ouverture a été essayée sous Node 22 et sous Electron 43.7.1 (BoringSSL), comme le ferait le desk. Un relecteur indépendant l'a ensuite éprouvée : 14 constats, tous pris en compte ici. Deux portaient sur la construction elle-même : des enveloppes factices reconnaissables sans aucune clé, et l'absence d'engagement sur la clé de contenu.

#### 5.5.1 Les clés

| Clé | Algorithme | Qui la tient | Rôle |
|---|---|---|---|
| Clé des rapports | Ed25519 | l'ADMIN, sur son poste, chiffrée par phrase de passe | signe l'index (§ 3.2) et la liste des destinataires |
| Clé de réception | X25519 | chaque desk de testeur, chiffrée par le trousseau dans le process principal | ouvre les enveloppes adressées à ce desk |
| Clé de contenu | AES-256 | personne : tirée au hasard pour chaque version d'un rapport, oubliée aussitôt | chiffre le rapport, une fois |
| Clé éphémère | X25519 | personne : une par enveloppe, oubliée aussitôt | donne la clé d'enveloppe d'un destinataire |

Chaque clé a son rôle. La clé des rapports en a deux, signer l'index et signer la liste des destinataires, et leurs préfixes signés les séparent. Les clés de publication et de siège ne changent pas.

#### 5.5.2 Le fichier scellé

Le fichier s'appelle `rapports/<nom>.canto`. `<nom>` compte 32 signes hexadécimaux, tirés au hasard à la première publication et gardés par les révisions. Le dépôt ne montre ni titre, ni journée analysée, ni identifiant de session d'Anthropic. Il montre, comme tout dépôt git, quand chaque fichier est publié, révisé ou retiré.

```json
{
  "format": "canto.rapport-scelle/1",
  "recipients": [{ "epk": "<32 octets>", "wrap": "<48 octets>" }],
  "commit": "<32 octets>",
  "iv": "<12 octets>",
  "body": "<chiffré, étiquette comprise>"
}
```

Les champs binaires sont en base64url sans remplissage, sous leur seule forme canonique. Le fichier porte de 1 à 32 enveloppes, factices comprises : C2 sert donc 32 desks au plus. Il pèse 768 Kio au plus ; au-delà, le desk le refuse pour de bon, sans le retenter.

- **Le clair.** Le JSON `{ "report": <canto.rapport/1>, "session": { "id", "createdAt", "agentVersion" } }`, en UTF-8, complété d'espaces jusqu'au multiple de 16 Kio suivant : la taille du fichier ne trahit qu'une tranche. Le script refuse un clair de plus de 512 Kio, remplissage compris. La borne du fichier de l'agent ne suffit pas : `parseReport` réécrit chaque source par `new URL(url).href` (`src/engine/agent/cloudReport.ts:127`), ce qui peut tripler un chemin non ASCII. Le relecteur a ainsi tiré un clair de 972 699 octets d'un fichier d'agent de 485 878.
- **Le corps.** AES-256-GCM sous la clé de contenu, vecteur de 12 octets tiré au hasard, données associées `canto.rapport-scelle/1\n<dépôt>\n<nom>`. Un corps ne s'ouvre donc ni sous un autre nom, ni depuis un autre dépôt.
- **Une enveloppe par destinataire.**
  - Le script tire une clé éphémère neuve et calcule le secret partagé X25519 avec la clé de réception du destinataire.
  - Il en dérive la clé d'enveloppe : HKDF-SHA-256, avec la clé éphémère suivie de la clé de réception pour sel, et `canto.rapport-scelle/1 enveloppe\n<dépôt>\n<nom>` pour information.
  - Il y chiffre la clé de contenu en AES-256-GCM, vecteur nul : chaque clé d'enveloppe ne sert qu'une fois.

  Chaque enveloppe pèse environ 130 octets.
- **L'engagement.** `commit` est le HMAC-SHA-256, sous la clé de contenu, de `canto.rapport-scelle/1 engagement\n<dépôt>\n<nom>`. Le desk le recalcule dès qu'une enveloppe s'ouvre, et refuse le fichier s'il diffère. Tous les destinataires d'un fichier ont ainsi la même clé de contenu, donc le même texte. AES-GCM seul ne le garantit pas, car il n'engage pas sa clé : sans engagement, qui tient la clé des rapports pourrait montrer, dans un seul fichier signé, un texte au desk du Lab et un autre aux testeurs.
- **Des enveloppes anonymes.**
  - Aucune ne nomme son destinataire : le desk les essaie toutes.
  - Le script complète la liste d'enveloppes factices jusqu'à un nombre fixe (par exemple 8), puis la mélange.
  - Une enveloppe factice est faite de la clé publique d'une paire X25519 tirée puis jetée, et de 48 octets tirés au hasard. Trente-deux octets au hasard ne feraient pas l'affaire : une clé publique X25519 a son bit de poids fort nul et désigne un point de la courbe, dans le sous-groupe d'ordre premier, et 32 octets au hasard ne passent ces tests qu'une fois sur 32.

  Avec de vraies clés jetées, le dépôt ne dit ni combien de testeurs lisent, jusqu'au nombre choisi, ni dans quel ordre ils sont venus.
- **Comme age, en partie.** L'enveloppe est celle des destinataires X25519 du format age (même sel, vecteur nul), transposée en AES-256-GCM. Le fichier, lui, s'en écarte : age authentifie tout son en-tête par un HMAC sous la clé de fichier, quand C2 s'en remet à l'empreinte signée de l'index, qui couvre le fichier entier, et à l'engagement. La validation de la construction (§ 9, question 1) porte sur cet écart.
- **L'index.** Le chiffrement ne remplace pas l'index signé du § 3.2, mais ses lignes changent. Elles suivent l'ordre de publication :
  - `<sha256>  <nom>.canto  <instant de cette version>` pour chaque fichier ;
  - `retire <nom> <instant>` pour un retrait, ligne gardée pour toujours.

  Une date par ligne ne trahit rien de plus que l'historique du dépôt. Elle donne à chaque desk, même resté fermé, la vraie date d'une révision ou d'un retrait.

Ce que le prototype a montré, après correction :

- un rapport de 30 Ko, complété à 32 Kio et scellé pour trois desks et cinq enveloppes factices, fait un fichier de 44,9 Ko ;
- chacun des trois desks l'ouvre ;
- un desk non inscrit essaie les huit enveloppes, n'en ouvre aucune, et ne lève aucune erreur ;
- un corps altéré d'un seul octet est refusé, et une enveloppe lue sous un autre nom de fichier ne s'ouvre pas ;
- une enveloppe qui porte une autre clé de contenu est refusée par l'engagement ;
- une clé éphémère d'ordre faible (u = 0, u = 1) est refusée, par OpenSSL comme par BoringSSL ;
- le discriminateur du relecteur, qui reconnaissait les enveloppes factices de 32 octets au hasard, juge vraies les huit enveloppes du fichier corrigé, alors que trois desks seulement y sont inscrits.

#### 5.5.3 L'ouverture sur le desk

Dans le process principal, après les étapes 1 à 3 du § 3.4 (signature, fraîcheur, ordre), puis la lecture du fichier et la vérification de son empreinte (étape 4), pour chaque fichier nouveau ou révisé :

1. **Forme.** JSON strict, clés exactes, longueur de chaque champ, bornes. Un fichier de plus de 768 Kio est refusé pour de bon.
2. **Enveloppes.** Pour chacune : le secret partagé avec la clé de réception (un refus de dérivation fait passer à la suivante), la clé d'enveloppe, puis l'ouverture. La première qui s'ouvre donne la clé de contenu, que l'engagement doit confirmer.
3. **Aucune.** Le fichier n'est pas adressé à ce desk. Le desk note son nom, son empreinte, l'empreinte de sa propre clé de réception et la version de son ouvreur. Il ne le retélécharge que si l'un d'eux change, et n'affiche rien. Deux cas ne sont jamais « non adressés » :
   - une clé de réception que le trousseau ne rend pas (le sceau rend alors un texte vide, sans erreur, `electron/agent-cloud.ts:109`) : la relève ne part pas, et les Options disent « clé de réception illisible » ;
   - une enveloppe qui s'ouvre sur un engagement ou un corps faux : c'est un échec, affiché.
4. **Corps.** Ouvert avec ses données associées et lu en UTF-8 strict, puis passé par `parseReport`, `isApiId(session.id, 'sesn')` et `isDateNear` contre `createdAt`, comme au § 3.4. Une révision doit porter la session de la version qu'elle remplace ; sinon, elle est refusée.
5. **Rangement.** Dans `agent-reports/<sesn>.json`, en clair, comme aujourd'hui : c'est le dossier du testeur. La fiche garde son nom, ou ses noms si des copies existent, pour que révisions et retraits la retrouvent tant qu'elle existe.
6. **Révision non adressée.** Si ce desk tient la version précédente d'un nom et n'ouvre pas la nouvelle, il marque sa fiche « révisée par le Lab ; la nouvelle version n'est pas adressée à ce desk ». Un retrait, lui, s'applique par le nom, adressé ou non (E8).

L'état de la relève vit dans `userData/lab-reports.json` (0600), hors du coffre : le dernier `seq` par clé, les fichiers essayés et non adressés, et l'instantané de l'index pris à la création de la clé de réception. Rien de ce que contient cet instantané ne peut être adressé à la clé neuve : le desk ne le télécharge pas, et n'essaie que ce qui est publié ou révisé ensuite. Cette règle remplace, pour C2, le rattrapage des « trente dernières » (§ 3.4, étape 4).

La relève ne part que d'un desk qui a une clé de réception lisible, et un siège si le bloc lui est réservé (§ 5.5.7). Un desk public ne contacte jamais le dépôt des rapports, et GitHub n'apprend rien de lui. En échange, GitHub apprend quelles adresses relèvent, donc lesquelles sont celles de testeurs ; en voie A, tout desk relevait.

Le desk du Lab est inscrit : c'est une condition de C2. Sans cela, il ne verrait ni les révisions ni les retraits que l'ADMIN publie, ni ce que reçoivent les testeurs. Quand la version publiée remplace l'une de ses fiches, il garde le coût de la session, que lui seul connaît.

#### 5.5.4 La clé de réception

- **Création.** À la demande du testeur, dans C · Options › Rapports du Lab (§ 5.5.7). Le process principal tire la paire X25519, chiffre la clé privée par le trousseau du système (`safeStorage`) et la range dans `userData/report-reception.json` (0600). Sans trousseau, rien n'est créé ni gardé, comme pour la clé de l'agent cloud.
- **Ce que voit le renderer.** Le code de réception et son empreinte, jamais la clé privée. Ni l'un ni l'autre n'est journalisé ; le coffre ne les connaît pas, son export non plus.
- **Le code.** `RECEPTION1.<clé publique en base64url>`, environ 55 signes, à copier. Il n'est pas secret, et le desk ne le produit que sous forme canonique.
- **L'empreinte.** Les 80 premiers bits du SHA-256 de `canto-reception\n` suivi de la clé publique, en base32, quatre groupes de quatre signes. Le desk et le script de l'ADMIN l'affichent de la même façon.
- **Remplacement.** *Nouvelle clé de réception* passe par un dialogue du process principal (Annuler par défaut). Le dialogue demande au testeur de faire inscrire le nouveau code et retirer l'ancien, en nommant leurs empreintes. Le desk garde l'ancienne clé, essayée avec la nouvelle, jusqu'au premier rapport que la nouvelle ouvre, puis l'efface : aucun rapport ne se perd entre-temps. La garder ne coûte rien, puisque qui l'aurait volée la tient déjà.
- **Suppression.** *Supprimer ma clé de réception* passe par un dialogue du même genre. La relève s'arrête, les rapports déjà reçus restent, et le Lab doit retirer le code.
- **Plusieurs desks.** Un testeur qui a deux postes a deux clés, inscrites chacune.

#### 5.5.5 L'inscription d'un testeur

1. Le testeur crée son code et l'envoie à l'ADMIN, par n'importe quel canal.
2. L'ADMIN l'inscrit sur son poste (`node scripts/report-recipients.mjs --add <nom> <code>`). Le script vérifie la forme canonique (bit de poids fort nul, u < p) et fait une dérivation d'essai avec une clé éphémère. Un code d'ordre faible s'importe en effet sans erreur, sous OpenSSL comme sous BoringSSL, et ferait échouer chaque scellement. Le script affiche ensuite l'empreinte.
3. L'ADMIN compare cette empreinte **directement** avec le testeur : de vive voix, ou par un canal où aucun relais ne réécrit le message. Le code voyage en clair ; substitué en route, il enverrait les rapports à qui l'a substitué. L'empreinte comparée de bout en bout ferme cette porte. Un code de siège n'a pas ce risque : il est signé, et une substitution ne le forge pas.
4. L'ADMIN confirme et donne sa phrase de passe : la liste des destinataires est re-signée.
5. Le desk reçoit à partir de la publication suivante. Le rattrapage reste à décider : aucun en V1 (recommandé), ou des copies des derniers rapports publiées pour le nouveau venu seul, sous des noms neufs, que les autres desks notent « non adressées » sans les ouvrir.

La liste des destinataires relie des testeurs à des clés.

- **Ses lignes.** Une par desk, `<empreinte>  <nom>  <code>  <date>`, adressée par l'empreinte, puisqu'un testeur peut avoir plusieurs desks.
- **Son lieu.** Le poste de l'ADMIN, à côté de la clé des rapports, hors du dépôt, de GitHub et du centre de contrôle.
- **Sa garde.** Elle porte un numéro et elle est signée par la clé des rapports (`canto-destinataires\n<contenu>`) ; le script refuse de sceller si cette signature ne vérifie pas. À chaque scellement, il affiche les noms et empreintes qu'il enveloppe, et l'ADMIN confirme. Un destinataire glissé dans le fichier, ou une liste plus ancienne remise à sa place, se voit.

#### 5.5.6 Le retrait d'un testeur

- **Le geste.** `--remove <empreinte>` re-signe la liste ; les publications suivantes n'enveloppent plus ce desk. Remplacer une clé, c'est inscrire la nouvelle et retirer l'ancienne.
- **Ce qui reste chez lui.** Ce qu'il a reçu reste lisible, et les anciens chiffrés restent ouvrables par sa clé.
- **Rien ne protège le passé.** Une clé de réception volée ouvre tout ce qui lui a été adressé. Une purge des anciens chiffrés n'y changerait rien : un dépôt public se clone, se forke et s'archive, et ses objets restent joignables. Une rotation des clés non plus : qui tient le desk lit aussi `agent-reports/`, en clair. Seul le retrait protège, et seulement pour les rapports à venir.

#### 5.5.7 L'interface

- **C · Options › Rapports du Lab**, un bloc nouveau, en FR, EN et ES :
  - *Créer mon code de réception* ;
  - le code, avec *Copier*, et son empreinte ;
  - l'état : « en attente du premier rapport adressé à ce desk », « dernier rapport reçu le … », « index du Lab périmé depuis le … », « clé de réception illisible » ;
  - *Nouvelle clé de réception* et *Supprimer ma clé de réception*.
- **A · Rapports** reste sans commande (LAB3) : « Dossier en construction » laisse place à l'état de la relève.
- **Qui voit le bloc.** Tout desk, ou le seul desk qui porte un siège.
  - La seconde option garde le desk public tel qu'il est, et colle à « réservés aux testeurs ». Mais elle donne au siège un second affichage : les décisions 3 et 8 de `docs/SIEGE-NOMINATIF.md` changent.
  - Recommandé : la seconde, gardée dans le process principal par `SeatHost`, comme le pilotage du Lab. Perdre le siège arrête alors la relève ; le bloc reste visible tant qu'une clé de réception existe, pour qu'on puisse la supprimer.
  - Le README peut taire le bloc comme il tait le siège (décision 7) : il dit seulement que les rapports du Lab parviennent à ses testeurs.

#### 5.5.8 Sécurité

| Menace | Ce qu'elle obtient | Garde |
|---|---|---|
| GitHub, le réseau, un proxy qui inspecte TLS | ni le contenu, ni une altération acceptée ; un gel, mais visible | chiffrement ; signature ; `expire` |
| Le public | des métadonnées : quand chaque fichier est publié, révisé ou retiré, et une tranche de taille | noms opaques, remplissage, enveloppes factices tirées de vraies clés |
| Un testeur retiré | ce qu'il a déjà, pas la suite | il n'est plus enveloppé |
| Un testeur qui fait suivre | le clair | hors de portée technique : une règle de l'ADMIN |
| Une clé de réception volée | tout ce qui lui a été adressé, jusqu'au retrait | trousseau ; retrait |
| Un code substitué à l'inscription | les rapports à venir | l'empreinte comparée de bout en bout |
| Un code invalide ou d'ordre faible | un scellement qui échoue, ou un desk qui n'ouvre jamais rien | forme canonique et dérivation d'essai à l'inscription |
| La liste des destinataires altérée, ou remise en arrière | un destinataire caché, ou un testeur retiré de nouveau enveloppé | liste signée et numérotée ; noms et empreintes affichés à chaque scellement |
| La clé des rapports volée | de faux rapports, pour tous les testeurs : un destinataire complice connaît la clé de contenu et les enveloppes de ce qu'il reçoit, et il ne lui manque que la signature | rotation par une Release signée (§ 3.5) ; le desk du Lab, inscrit, montre à l'ADMIN ce que voient les testeurs |
| Un texte différent pour chaque destinataire | une tromperie ciblée, invisible du desk du Lab | l'engagement sur la clé de contenu |
| Le poste de l'ADMIN compromis | tout | la garde de ses clés privées, phrase de passe comprise |
| Une page piégée lue par l'agent | un texte trompeur | E3, et la relecture de l'ADMIN |

Un testeur, même inscrit, ne peut pas forger un rapport : il peut sceller un autre texte pour les mêmes destinataires, mais il ne signe pas l'index.

#### 5.5.9 Vie privée

- **Le dépôt public.** Il ne porte que des chiffrés sous des noms opaques, et l'index signé. Il trahit quand chaque fichier est publié, révisé ou retiré, et une tranche de taille. Avec des enveloppes factices tirées de vraies clés, il ne trahit pas le nombre de testeurs, jusqu'au nombre choisi.
- **Ce que voit GitHub.** L'adresse et l'heure de chaque relève, comme au § 3.6, mais des seuls desks qui ont une clé de réception : il apprend donc quelles adresses sont celles de testeurs.
- **Ce que voit le Lab.** Rien de la lecture : l'ouverture se fait sur le desk.
- **La liste des destinataires.** Une donnée personnelle, qui reste sur le poste de l'ADMIN.
- **La redistribution.** Diffuser à quelques testeurs reste une redistribution (E10) : la revue des conditions des sources demeure, à la mesure de cette diffusion.

#### 5.5.10 Coût

- **Transport** : celui de la voie A, d'abord alourdi par le base64url, qui ajoute un tiers. Dans l'exemple du prototype, 30 Ko deviennent 44,9 Ko : environ 10 Ko de base64, 3,4 Ko de remplissage et 1 Ko d'enveloppes. Au pire, un clair borné à 512 Kio donne un fichier d'environ 690 Kio, soit environ 170 Mio par an, révisions en plus.
- **ADMIN** : le geste quotidien de la voie A, puisque le script scelle seul ; une inscription par nouveau desk, environ cinq minutes, empreinte comprise.
- **Code** : huit tickets (§ 10), sans dépendance npm.

#### 5.5.11 Ce qui change dans les invariants

- **`CLAUDE.md` § 5**, une ligne nouvelle : « Rapports du Lab : réservés aux testeurs. Relève sortante seule, d'un desk qui a une clé de réception, depuis le dépôt public des rapports sur `api.github.com`, sans redirection, sans cookie, sans cache ni identifiant ; un index n'est lu que signé pour ce dépôt par une clé de `electron/report-keys.ts`, disjointe des clés de publication et de siège, et non périmé ; chaque rapport est scellé pour les clés de réception que l'ADMIN inscrit ; la clé privée de réception, chiffrée par le trousseau dans le process principal, n'est jamais rendue au renderer, journalisée ni exportée ; un rapport reste une donnée affichée. »
- **`CLAUDE.md` § 3** : la clé des rapports et la liste des destinataires restent à l'ADMIN.
- **`docs/THESE-AGENTIQUE.md` § 7** : la décision 12, « rapports réservés aux testeurs », avec la construction validée.
- **`docs/SIEGE-NOMINATIF.md`** : les décisions 3 et 8, si le bloc ne paraît qu'avec un siège.
- **`docs/AGENT-CLOUD.md`** :
  - le § 5, pour le bloc des Options et l'état de la relève dans la vue A ;
  - la ligne « relève sortante seule, vers `api.anthropic.com` seul » du § 6 (`docs/AGENT-CLOUD.md:79`), qui ne vaudra plus que pour le pont de l'agent cloud.
- **IPC** : chaque canal nouveau passe derrière `trusted(e)` et une validation de forme, et entre dans `tests/agent-cloud-wiring.test.ts`.
- **Inchangés** : la CSP du renderer, les mises à jour signées, la garde `lab()`, la porte sur `127.0.0.1`, la décision 11, et le coffre : la clé de réception n'y entre pas, comme celle de l'agent cloud.

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
| Code (ordre de grandeur) | six tickets | une douzaine, plus le service | huit tickets (§ 10) | trois |

**Retenue par l'ADMIN le 27 octobre 2026 : C2**, sur le transport de la voie A (§ 5.5).

## 8. Recommandation

**Décision de l'ADMIN (27 octobre 2026) : les rapports restent réservés aux testeurs.** La voie A n'est pas retenue pour le contenu. Son transport (dépôt public, index signé, relève sans identifiant) porte la voie C2, détaillée au § 5.5. Ce qui suit est la recommandation d'origine, gardée pour mémoire ; sa première question a reçu sa réponse, et la seconde vaut pour C2.

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

Tranchée le 27 octobre 2026 : **les rapports restent réservés aux testeurs**, par la voie C2. Restent :

1. Valider la construction du § 5.5.2 : X25519, HKDF-SHA-256, AES-256-GCM et un engagement HMAC-SHA-256 ; une clé de contenu par version de rapport ; des enveloppes anonymes. Et son écart avec age : l'en-tête n'est authentifié que par l'empreinte signée de l'index.
2. Créer la clé Ed25519 des rapports, distincte des clés de publication et de siège et chiffrée par phrase de passe, et dire où elle vit, avec la liste des destinataires. La générer et inscrire sa clé publique dans `electron/report-keys.ts` est un geste de l'ADMIN, avant le tag de la version qui relève.
3. Créer le dépôt public des rapports, et le nommer : son nom est écrit dans le code et signé.
4. Le bloc « Rapports du Lab » des Options : pour tout desk, ou pour le seul desk qui porte un siège (recommandé, ce qui change les décisions 3 et 8 du siège) ? Dans ce cas, perdre le siège arrête la relève.
5. L'empreinte comparée de vive voix à chaque inscription, hors de tout relais : obligatoire (recommandé) ?
6. Les enveloppes factices : combien (recommandé : 8) ? La tranche de remplissage (recommandé : 16 Kio) ? Et le plafond de 32 desks, enveloppes factices comprises : suffit-il ?
7. Le rattrapage d'un nouveau testeur : aucun (recommandé), ou des copies des N derniers rapports ?
8. Accepter que rien ne protège le passé d'une clé de réception volée, seul le retrait protégeant la suite (§ 5.5.6) ?
9. Le retrait et la révision d'un rapport diffusé : les deux (recommandé), ou le retrait seul ?
10. La cadence de la relève (toutes les heures, ou à heures fixes, par exemple 7:45, 9:00 et 13:00 à Paris) et la validité de l'index (`expire`, par exemple sept jours) ?
11. *Relever maintenant* sur le desk d'un testeur, contre LAB3, ou la relève automatique seule ?
12. La revue des conditions des sources (E10), à la mesure d'une diffusion à quelques testeurs ? Une règle de non-diffusion pour les testeurs ?
13. Le coût de chaque exécution reste-t-il hors du fichier diffusé ?
14. Le bêta-testeur qui porte déjà un siège sert-il de premier lecteur, après le desk du Lab, inscrit d'office (§ 5.5.3) ?

## 10. Si l'ADMIN valide la voie C2

Un ticket, un commit, un test, dans l'ordre :

| Ticket | Contenu | Preuve |
|---|---|---|
| DIF1 | L'index de C2 et sa vérification, dans le process principal, sur le modèle de `electron/release-signature.ts` : l'en-tête du § 3.2 (`seq`, `emis`, `expire`) ; les lignes du § 5.5.2, dans l'ordre de publication et datées chacune ; les lignes `retire`, permanentes ; un message lié au dépôt ; `seq` par clé ; l'équivoque. | Séparation des domaines (une signature de Release ou de siège ne vérifie pas un index, ni l'inverse) ; trois listes de clés disjointes ; index d'un autre dépôt refusé ; rotation après un `seq` démesuré. |
| DIF2 | `electron/report-keys.ts`, vide : la relève ne part pas. | Aucun appel réseau sans clé. |
| DIF3 | Le format `canto.rapport-scelle/1` (§ 5.5.2) et son ouverture, dans un module du process principal, hors de `src/engine` que le renderer lit aussi. Forme stricte et canonique, enveloppes essayées l'une après l'autre, engagement, données associées, refus de dérivation passé, bornes, fichier trop lourd refusé pour de bon. | Paires éphémères : chaque destinataire ouvre, un desk non inscrit non. Refusés : une enveloppe d'un autre fichier ou d'un autre dépôt, un corps altéré, une clé de contenu propre à un destinataire, une clé d'ordre faible, sans se fier aux codes d'erreur de la bibliothèque. Sous Electron, à la recette. |
| DIF4 | La clé de réception (§ 5.5.4) : création, trousseau, `report-reception.json` en 0600, code canonique et empreinte, ancienne clé gardée jusqu'au premier rapport de la nouvelle, suppression ; dialogues du process principal ; IPC derrière `trusted(e)` et une validation de forme. | Jamais rendue au renderer, journalisée ni exportée ; sans trousseau, rien ; `tests/agent-cloud-wiring.test.ts`. |
| DIF5 | L'hôte de relève (§ 3.4 et § 5.5.3), qui ne part qu'avec une clé lisible, et un siège si l'ADMIN le décide. Session en mémoire sans cache ni cookie ; bornes (256 Kio, 1 Kio, 768 Kio) ; adresses bâties de constantes et d'un nom vérifié ; dix fichiers par relève ; quota lu, avec une réserve pour le lanceur ; empreinte fausse traitée en échec passager. État persistant dans `userData/lab-reports.json`, hors du coffre : `seq` par clé, fichiers non adressés notés avec l'empreinte de la clé et la version de l'ouvreur, instantané pris à la création de la clé. Rangement dédoublonné, nom gardé dans la fiche, révision de même session, révision non adressée marquée, retrait, coût gardé au desk du Lab. | Rouge sans chaque garde ; `seq` gardé d'un redémarrage à l'autre. |
| DIF6 | L'interface (§ 5.5.7) : bloc des Options, état de la relève dans la vue A, fiche révisée repassée en non lue, fiche retirée affichée comme telle ; garde du siège si décidée ; FR, EN, ES. | `tests/agent-tab.test.ts` (C · Options), `tests/agent-cloud-folder.test.ts` |
| DIF7 | Les scripts de l'ADMIN. `scripts/report-recipients.mjs` tient la liste par empreinte, numérotée et signée : `--add` après forme canonique, dérivation d'essai et empreinte confirmée ; `--remove <empreinte>` ; la liste. `scripts/publish-report.mjs` montre la fiche, fait taper sa date, demande la phrase de passe et affiche les destinataires enveloppés. Il scelle, complète d'enveloppes factices tirées de vraies clés, signe l'index et écrit dans le clone (`.gitattributes` en `-text`). Refus : clé dans un dépôt, clé non chiffrée, clé absente de `report-keys.ts`, liste dont la signature ne vérifie pas, clair de plus de 512 Kio. | Paires éphémères, hors dépôt. Un fichier scellé par le script s'ouvre par le module de DIF3, comme `tests/release-tools.test.ts:57` le prouve pour la signature des Releases. |
| DIF8 | `docs/AGENT-CLOUD.md` (le § 5, et la ligne du § 6), `CLAUDE.md` § 3 et § 5, décision 12, `docs/SIEGE-NOMINATIF.md` (décisions 3 et 8) si le bloc est réservé au siège, README (« Lab reports » et feuille de route, sans nommer le siège), section de `docs/AUDIT.md`. | — |

L'ADMIN garde la création de la clé des rapports et du dépôt, chaque inscription, chaque signature, et la version qui embarque la clé publique.

## 11. Relevé en route, hors de cette note

- La mise à jour et son journal appelaient `net.fetch` sans `credentials`. Or, sous Electron 43.7.1, `net.fetch` garde les cookies d'une réponse, redirection comprise, dans la session par défaut, qui est persistante, et les renvoie. Corrigé par UPD1 (`docs/AUDIT.md`) pour la mise à jour, puis par UPD3 pour le calendrier officiel ; les marchés crypto partaient déjà sans cookie. La garde d'hôte final du journal, inopérante parce que `net.fetch` rend une `url` vide, est refaite par UPD2 : chaque saut est vérifié avant d'être suivi.
- `agent-cloud:pull` n'a ni garde `lab()` ni cadence (`electron/main.ts:925`). Un desk qui perd le siège du Lab en gardant clé et déploiement relève encore ; LAB4 l'a laissé, puisque seul le retrait de la clé publique, une décision de l'ADMIN, fait perdre le siège.
