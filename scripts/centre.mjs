#!/usr/bin/env node
/**
 * Centre de contrôle du Lab (docs/CENTRE-DE-CONTROLE.md) : un dossier privé, hors du dépôt, que Claude Code, Hermes et
 * l'ADMIN lisent et tiennent à jour sans se marcher dessus. Le dépôt est public : ce script n'y écrit rien, refuse un
 * dossier placé dedans, refuse tout texte qui ressemble à un secret et pose les verrous de façon atomique.
 *
 *   node scripts/centre.mjs init
 *   node scripts/centre.mjs etat
 *   node scripts/centre.mjs verrou <zone> --agent <agent> [--motif "…"] [--heures 4] [--reprendre]
 *   node scripts/centre.mjs libere <zone> --agent <agent>
 *   node scripts/centre.mjs message --de <agent> --pour <agent> --sujet "…" [--priorite P0|P1|P2|P3] [--corps "…"]
 *   node scripts/centre.mjs boite <agent> [--traite <fichier>]
 *   node scripts/centre.mjs journal --agent <agent> --zone <zone> --action "…" [--resultat "…"] [--lien "…"]
 *
 * Dossier : $CANTO_CENTRE, sinon ~/.canto-centre. Agents : claude, hermes, admin.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0];

const AGENTS = ['claude', 'hermes', 'admin'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const ZONE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const TEXT_MAX = 4000;
const DEFAULT_HOURS = 4;

/**
 * Ce qui ressemble à un secret n'entre jamais dans le centre : clés d'API, jetons, lignes de siège, clés privées, mots
 * de passe écrits en clair. Une empreinte de commit (hexadécimal, 7 à 40) reste permise.
 */
const SECRETS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/,
  /\bSIEGE1\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abpors]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  // « mdp : x7!… », « token=ab12… » : une valeur collée qui porte un chiffre ou un signe ; « jeton : renouvelé » passe.
  /\b(?:mdp|mot de passe|password|passphrase|code de d[ée]verrouillage|token|jeton)\s*[:=]\s*(?=\S{6,})\S*[\d_!@#$%^&*-]\S*/i,
  /\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/,
];

function secretIn(text) {
  return SECRETS.some((re) => re.test(text));
}

/** Les options connues ; toute autre chaîne, même `-----BEGIN…`, est une valeur, et passe donc par la garde des secrets. */
const OPTIONS = new Set(['--agent', '--motif', '--heures', '--reprendre', '--de', '--pour', '--sujet', '--priorite', '--corps', '--traite', '--zone', '--action', '--resultat', '--lien']);

function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  return value === undefined || OPTIONS.has(value) ? undefined : value;
}

function fail(message) {
  console.error(`centre : ${message}`);
  process.exit(1);
}

const now = () => new Date();
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const stamp = (d) => iso(d).replace(/[-:]/g, '').replace('T', '-').replace('Z', '');
const day = (d) => iso(d).slice(0, 10);
const clean = (text) => String(text ?? '').replace(/\r\n?/g, '\n').trim();

function centreDir() {
  const dir = path.resolve(process.env.CANTO_CENTRE || path.join(homedir(), '.canto-centre'));
  if (dir === root || dir.startsWith(`${root}${path.sep}`)) fail('le centre ne vit jamais dans le dépôt, qui est public');
  return dir;
}

function agentArg(name = '--agent') {
  const agent = flag(name);
  if (!agent || !AGENTS.includes(agent)) fail(`${name} : ${AGENTS.join(', ')}`);
  return agent;
}

function text(name, { required = false } = {}) {
  const value = flag(name);
  if (value === undefined) {
    if (required) fail(`${name} « … » requis`);
    return '';
  }
  const t = clean(value);
  if (t.length > TEXT_MAX) fail(`${name} : ${TEXT_MAX} caractères au plus`);
  if (secretIn(t)) fail(`${name} : ce texte ressemble à un secret (clé, jeton, ligne de siège, mot de passe) ; il n'entre pas dans le centre. Écris où il se trouve, jamais sa valeur.`);
  return t;
}

const TEMPLATES = {
  'LISEZMOI.md': `# Centre de contrôle du Lab · CΛNTO

Dossier privé, hors du dépôt public. Protocole : \`docs/CENTRE-DE-CONTROLE.md\` dans le dépôt.

- Avant d'agir : \`node scripts/centre.mjs etat\`, puis ta boîte (\`boite <agent>\`).
- Avant de toucher une zone partagée : \`verrou <zone> --agent <agent>\` ; après : \`libere\`, et une ligne au \`journal\`.
- Jamais de secret ici : ni clé, ni jeton, ni ligne de siège, ni mot de passe. On écrit où il se trouve, jamais sa valeur.
`,
  'etat.md': `# État de CΛNTO

Tenu par qui change l'état. Une ligne par sujet ; la date de la dernière vérification entre parenthèses.

## Versions
## Branches et PR ouvertes
## Desk du poste de l'ADMIN
## Agent cloud
## Sièges
`,
  'priorites.md': `# Priorités

\`- [ ] P0 · titre · propriétaire (claude | hermes | admin) · échéance\` ; cochée quand c'est fait, avec le lien.

## Ouvertes
## Faites
`,
  'critique.md': `# Points critiques

Ce qui peut casser, coûter ou exposer. Une entrée reste tant que le risque reste.
`,
};

function init() {
  const dir = centreDir();
  for (const sub of ['verrous', 'boites/claude', 'boites/hermes', 'boites/admin', 'journal', 'archives']) mkdirSync(path.join(dir, sub), { recursive: true });
  let created = 0;
  for (const [name, body] of Object.entries(TEMPLATES)) {
    const file = path.join(dir, name);
    if (existsSync(file)) continue;
    writeFileSync(file, body, { encoding: 'utf8', flag: 'wx' });
    created += 1;
  }
  console.log(`Centre prêt : ${dir} (${created} fichier(s) créé(s), aucun écrasé).`);
}

function readLock(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function lock() {
  const zone = args[1];
  if (!zone || !ZONE.test(zone)) fail('verrou <zone> : minuscules, chiffres et tirets (ex. depot-main, agent-cloud)');
  const agent = agentArg();
  const motif = text('--motif');
  const hours = Number(flag('--heures') ?? DEFAULT_HOURS);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 72) fail('--heures : de 0 à 72');
  const dir = path.join(centreDir(), 'verrous');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${zone}.verrou`);
  const t = now();
  const body = JSON.stringify({ zone, agent, depuis: iso(t), expire: iso(new Date(t.getTime() + hours * 3_600_000)), motif }, null, 2);
  try {
    writeFileSync(file, body, { encoding: 'utf8', flag: 'wx' });
    console.log(`Verrou posé : ${zone} · ${agent} · jusqu'à ${iso(new Date(t.getTime() + hours * 3_600_000))}`);
    return;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const held = readLock(file);
  const expired = !held || Date.parse(held.expire) < t.getTime();
  if (held?.agent === agent || (expired && args.includes('--reprendre'))) {
    writeFileSync(file, body, 'utf8');
    console.log(held?.agent === agent ? `Verrou prolongé : ${zone} · ${agent}` : `Verrou périmé repris : ${zone} · ${agent} (tenu par ${held?.agent ?? 'inconnu'})`);
    return;
  }
  fail(expired ? `${zone} : verrou périmé de ${held?.agent ?? 'inconnu'} ; --reprendre après lui avoir écrit` : `${zone} : tenu par ${held.agent} depuis ${held.depuis}${held.motif ? ` (${held.motif})` : ''} ; écris-lui plutôt (message --pour ${held.agent})`);
}

function unlock() {
  const zone = args[1];
  if (!zone || !ZONE.test(zone)) fail('libere <zone>');
  const agent = agentArg();
  const file = path.join(centreDir(), 'verrous', `${zone}.verrou`);
  if (!existsSync(file)) fail(`${zone} : aucun verrou`);
  const held = readLock(file);
  if (held && held.agent !== agent && agent !== 'admin') fail(`${zone} : tenu par ${held.agent}, seul lui ou l'admin le libère`);
  unlinkSync(file);
  console.log(`Verrou libéré : ${zone} · ${agent}`);
}

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'message';

function message() {
  const from = agentArg('--de');
  const to = agentArg('--pour');
  const subject = text('--sujet', { required: true });
  const body = text('--corps');
  const priority = flag('--priorite') ?? 'P2';
  if (!PRIORITIES.includes(priority)) fail(`--priorite : ${PRIORITIES.join(', ')}`);
  const t = now();
  const dir = path.join(centreDir(), 'boites', to);
  mkdirSync(dir, { recursive: true });
  const name = `${stamp(t)}-${from}-${slug(subject)}.md`;
  writeFileSync(path.join(dir, name), `---\nde: ${from}\npour: ${to}\ndate: ${iso(t)}\npriorite: ${priority}\nsujet: ${subject.replace(/\n/g, ' ')}\netat: ouvert\n---\n\n${body}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(`Message déposé : boites/${to}/${name}`);
}

function inbox() {
  const agent = args[1];
  if (!agent || !AGENTS.includes(agent)) fail(`boite <${AGENTS.join('|')}>`);
  const dir = path.join(centreDir(), 'boites', agent);
  const done = flag('--traite');
  if (done) {
    if (path.basename(done) !== done || !done.endsWith('.md')) fail('--traite <fichier.md> de la boîte');
    const from = path.join(dir, done);
    if (!existsSync(from)) fail(`${done} : introuvable dans boites/${agent}`);
    const archive = path.join(centreDir(), 'archives', agent);
    mkdirSync(archive, { recursive: true });
    renameSync(from, path.join(archive, done));
    console.log(`Traité : ${done} → archives/${agent}/`);
    return;
  }
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
  if (!files.length) {
    console.log(`Boîte de ${agent} : vide.`);
    return;
  }
  for (const f of files) {
    const head = readFileSync(path.join(dir, f), 'utf8');
    const field = (k) => new RegExp(`^${k}: (.*)$`, 'm').exec(head)?.[1] ?? '';
    console.log(`${field('priorite')} · ${field('de')} · ${field('sujet')} · ${f}`);
  }
}

function journal() {
  const agent = agentArg();
  const zone = flag('--zone');
  if (!zone || !ZONE.test(zone)) fail('--zone <zone>');
  const action = text('--action', { required: true });
  const result = text('--resultat');
  const link = text('--lien');
  const t = now();
  const dir = path.join(centreDir(), 'journal');
  mkdirSync(dir, { recursive: true });
  const line = `- ${iso(t).slice(11)} · ${agent} · ${zone} · ${action.replace(/\n/g, ' ')}${result ? ` → ${result.replace(/\n/g, ' ')}` : ''}${link ? ` (${link})` : ''}\n`;
  appendFileSync(path.join(dir, `${day(t)}.md`), line, 'utf8');
  console.log(`Journal : ${line.trim()}`);
}

function state() {
  const dir = centreDir();
  if (!existsSync(dir)) fail(`${dir} n'existe pas : node scripts/centre.mjs init`);
  const t = now().getTime();
  const locks = existsSync(path.join(dir, 'verrous')) ? readdirSync(path.join(dir, 'verrous')).filter((f) => f.endsWith('.verrou')) : [];
  console.log(`Centre : ${dir}`);
  console.log(`Verrous (${locks.length}) :`);
  for (const f of locks.sort()) {
    const held = readLock(path.join(dir, 'verrous', f));
    const expired = !held || Date.parse(held.expire) < t;
    console.log(`  ${f.replace(/\.verrou$/, '')} · ${held?.agent ?? '?'} · ${expired ? 'PÉRIMÉ' : `jusqu'à ${held.expire}`}${held?.motif ? ` · ${held.motif}` : ''}`);
  }
  for (const agent of AGENTS) {
    const box = path.join(dir, 'boites', agent);
    const n = existsSync(box) ? readdirSync(box).filter((f) => f.endsWith('.md')).length : 0;
    console.log(`Boîte ${agent} : ${n} message(s) ouvert(s)`);
  }
  const prio = existsSync(path.join(dir, 'priorites.md')) ? readFileSync(path.join(dir, 'priorites.md'), 'utf8') : '';
  const open = prio.split('\n').filter((l) => /^- \[ \] P[0-3]\b/.test(l)).sort();
  console.log(`Priorités ouvertes (${open.length}) :`);
  for (const l of open.slice(0, 12)) console.log(`  ${l.slice(6)}`);
}

switch (command) {
  case 'init':
    init();
    break;
  case 'etat':
    state();
    break;
  case 'verrou':
    lock();
    break;
  case 'libere':
    unlock();
    break;
  case 'message':
    message();
    break;
  case 'boite':
    inbox();
    break;
  case 'journal':
    journal();
    break;
  default:
    fail('commande : init | etat | verrou | libere | message | boite | journal (voir docs/CENTRE-DE-CONTROLE.md)');
}
