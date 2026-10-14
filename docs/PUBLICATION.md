**`SIΞRRΛSKΛ—LAB · CΛNTO · PUBLICATION · RELEASE SIGNÉE`**

# Publier une version signée

Une mise à jour n'est installée par un desk que si le Lab a signé ses empreintes (`SHA256SUMS.txt`) avec sa clé Ed25519. La clé privée vit sur le poste de l'ADMIN, hors du dépôt et hors de GitHub : un compte GitHub ou un jeton compromis ne suffit pas à pousser un installeur aux desks.

## Une fois : la clé du Lab

```bash
node scripts/release-key.mjs --write
```

- La clé privée est écrite dans `~/.canto/release-signing-key.pem` (mode `0600`, jamais écrasée ; `--out <fichier>` pour un autre chemin, refusé dans le dépôt).
- La clé publique est ajoutée à `electron/release-keys.ts`. **Committer ce fichier** : les desks construits ensuite exigent la signature.
- **Sauvegarder la clé privée hors ligne** (coffre, clé USB chiffrée). Perdue : il faut publier une nouvelle clé publique dans une version encore signée par l'ancienne, sinon les desks déjà installés refusent toute mise à jour et se mettent à jour à la main.

Rotation : générer une nouvelle clé avec `--write` (les deux clés sont acceptées), publier une version signée par l'ancienne, puis retirer l'ancienne de `electron/release-keys.ts` dans une version suivante.

## À chaque version

1. Monter la version dans `package.json`, préparer l'entrée de `src/engine/changelog/changelog.json`, pousser le tag `vX.Y.Z` (ou lancer le workflow `release`).
2. La CI crée la Release **en brouillon**, invisible des desks : le job `prepare` y dépose les notes et `changelog.json`, chaque construction (Linux, Windows, macOS) y téléverse ses installeurs, puis le job `publish` les reprend, calcule `SHA256SUMS.txt`, l'affiche dans son journal (étape SHA-256) et l'ajoute. Rien ne passe par le stockage des artefacts d'Actions : un quota plein ne bloque pas la Release. Le brouillon n'est complet, et signable, qu'une fois `publish` vert.
   - Une construction a échoué : `gh run rerun <id> --failed` relance ses jobs, qui remplacent leurs propres fichiers ; `publish` suit.
   - Repartir de zéro : supprimer le brouillon, puis relancer le workflow. Tant qu'il existe, le job `prepare` refuse un nouveau déclenchement manuel pour la même version.
3. Sur le poste de l'ADMIN (`gh` connecté au dépôt) :

```bash
node scripts/sign-release.mjs --tag vX.Y.Z --key ~/.canto/release-signing-key.pem --publish
```

Le script télécharge `SHA256SUMS.txt`, l'affiche, demande de taper la version après comparaison avec le journal de la CI, signe, vérifie que la clé est bien dans `electron/release-keys.ts`, téléverse `SHA256SUMS.txt.sig`, puis publie la Release.

Sans `gh` : `node scripts/sign-release.mjs --sums SHA256SUMS.txt --version X.Y.Z --key <clé>` écrit la signature ; la téléverser à la main sur la Release, puis la publier.

## Ce que vérifie le desk

Message signé : `canto-release\n<version>\n<contenu exact de SHA256SUMS.txt>`. Le desk refuse d'installer si la signature manque (« Release non signée par le Lab »), si elle ne vient d'aucune clé embarquée, si les empreintes ou la version ne sont pas celles qui ont été signées (une ancienne signature ne se rejoue pas sous un nouveau tag), puis si l'installeur téléchargé n'a pas l'empreinte signée. Tant que `electron/release-keys.ts` est vide, seule l'empreinte est contrôlée, et le journal le dit.

La voie « dépôt cloné » (`git pull`) n'est pas couverte : elle suit `main` sur GitHub.

## Plus tard

La signature de code des installeurs (Authenticode sous Windows, Developer ID et notarisation sous macOS) retire les avertissements du système à l'installation. Elle complète cette signature, elle ne la remplace pas : elle demande des certificats au nom du Lab (décision de l'ADMIN).
