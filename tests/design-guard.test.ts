import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATES } from '@/design/micro/assets';
import { MEANING, RESERVED_GLYPHS } from '@/design/micro/meaning';
import { GLYPH_ID } from '@/design/Micro';
import { cssRules, HOVER_LIGHT, hoverOffenses } from './helpers/cssRules';

const TEXT = new Set(['.ts', '.tsx', '.css', '.html', '.js', '.mjs', '.cjs', '.svg']);

/** `path.relative` rend des `\` sous Windows ; les gardes comparent des chemins POSIX. */
function posix(from: string, to: string): string {
  return relative(from, to).split(/[/\\]/).join('/');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-electron') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (TEXT.has(path.slice(path.lastIndexOf('.')))) out.push(path);
  }
  return out;
}

function lin(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const r = lin(parseInt(n.slice(0, 2), 16));
  const g = lin(parseInt(n.slice(2, 4), 16));
  const b = lin(parseInt(n.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function hue(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function token(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`jeton ${name} introuvable`);
  return match[1];
}

/**
 * OROS5.44 — l'or dit ce que tient l'opérateur (Système 5, décision 1 de l'ADMIN, 2026-11-01) : maintenant, l'objet
 * ouvert, la décision qui l'attend avec sa barre de 45 s, et la LED ; le focus clavier garde l'anneau d'or que lui donne
 * `tokens.css`, gelé (décision 4). Le cliquet nomme chaque usage de l'or hors de `tokens.css` : une règle CSS par son
 * sélecteur (« fichier › sélecteur »), un fichier de code par son compte (« fichier ×n » : `var(--gold…)`, `'--gold'`, et
 * les tons, variantes et classes `'gold'`). Chacun dit son sens ; « reste · » nomme ce qui ne le dit pas encore. La liste
 * ne fait que décroître : un usage rendu à l'ivoire en sort, son plafond baisse avec lui, aucun ne s'y ajoute.
 */
const OR_SENS = ['maintenant', 'objet ouvert', 'décision', 'LED', 'focus', 'reste'] as const;
const OR: Readonly<Record<string, string>> = {
  'src/app/ErrorBoundary.tsx ×1': 'reste · Réessayer, au bouton d’or',
  'src/app/Shell.tsx ×1': 'décision · Confirmer, dans le dialogue qui attend l’opérateur',
  'src/app/boot.module.css › .seam i::after': 'LED · la LED de relais de la construction du démarrage',
  'src/app/boot.module.css › .led': 'LED · la LED du démarrage',
  'src/app/boot.module.css › .sous i': 'LED · le point du démarrage',
  'src/app/boot.module.css › .barDone span::after': 'LED · la barre du démarrage achevée',
  'src/app/frise.module.css › .dayHeld': 'maintenant · la journée que tient le curseur',
  'src/app/frise.module.css › .now, .cursor': 'maintenant · la ligne de maintenant et le curseur de la frise',
  'src/app/frise.module.css › .headHeld': 'maintenant · l’heure que tient le curseur',
  'src/app/gate.module.css › .slash': 'reste · la barre oblique du titre du verrou',
  'src/app/gate.module.css › .led': 'LED · la LED du verrou',
  'src/app/gate.module.css › .inputRow:focus-within': 'focus · le champ de la phrase',
  'src/app/objects/fiche.module.css › .headGlyph': 'objet ouvert · le glyphe de la fiche',
  'src/app/objects/fiche.module.css › .studyChosen': 'objet ouvert · la journée du catalyseur ouvert',
  'src/app/objects/fiche.module.css › .studyKey .studyKeyChosen': 'objet ouvert · sa légende',
  'src/app/objects/proposal.module.css › .bar i': 'décision · la barre de 45 s',
  'src/app/seatMark.module.css › .name': 'reste · le nom du siège, au halo de la LED de version',
  'src/app/seatMark.module.css › .prompt, .input, .rest': 'reste · le geste de la marque du siège',
  'src/app/seatMark.module.css › .input': 'focus · le curseur de saisie du siège',
  'src/app/shell.module.css › .updateAvail .updateDot': 'LED · une mise à jour disponible',
  'src/app/shell.module.css › .navItem.on:hover .navEmblem': 'objet ouvert · l’emblème de l’onglet ouvert, au passage du pointeur',
  'src/app/shell.module.css › .navItem:focus-visible::before, .navItem.on:focus-visible::before': 'focus · le filet d’une cartouche',
  'src/app/shell.module.css › .navItem.on .navEmblem': 'objet ouvert · l’emblème de l’onglet ouvert',
  'src/app/shell.module.css › .lienBadge': 'reste · le badge LIEN d’une cartouche',
  "src/app/shell.module.css › .gate[data-state='pending']": 'décision · la porte dont la décision attend l’opérateur',
  'src/app/shell.module.css › .voyantOn': 'LED · le voyant du pont, exécutions en direct',
  'src/app/shell.module.css › .voyantVeille': 'LED · le voyant du pont, en veille',
  'src/app/shell.module.css › .answerAt': 'maintenant · l’instant que tient le curseur',
  'src/app/shell.module.css › .versionDot': 'LED · une version pas encore lue',
  'src/app/unlockCircuit.ts ×1': 'LED · la voie et le point d’or de l’ouverture (unlockCircuit.ts ne change pas, décision 7)',
  'src/design/OptionsMenu.tsx ×1': 'reste · le ton or d’une option (type)',
  'src/design/Wordmark.tsx ×6': 'LED · la LED du logotype',
  'src/design/charts/Fan.tsx ×2': 'reste · la cible de la projection',
  'src/design/instruments/instruments.module.css › .hour[data-cursor]': 'maintenant · l’heure du curseur dans M.003',
  'src/design/instruments/instruments.module.css › .hour[data-cursor]:hover': 'maintenant · la même, au passage du pointeur',
  'src/design/modal.module.css › .corner': 'reste · les coins d’une fenêtre',
  'src/design/optionsMenu.module.css › .mark.gold': 'LED · l’état d’une option qui vit',
  'src/design/optionsMenu.module.css › .item::before': 'focus · l’option active du menu',
  'src/design/optionsMenu.module.css › .item.gold .glyph': 'LED · l’option dont l’état vit',
  'src/design/optionsMenu.module.css › .item.gold .state': 'LED · sa lecture',
  'src/design/primitives.module.css › .btn.gold': 'reste · le bouton d’or : Confirmer, et les actions qui le gardent encore',
  'src/design/primitives.module.css › .btn.gold:hover:not(:disabled)': 'reste · le même, au passage du pointeur',
  'src/design/primitives.module.css › .tag.gold': 'reste · l’étiquette d’or',
  'src/design/primitives.module.css › .segmented button.on': 'objet ouvert · la puce choisie, au filet du pied',
  'src/design/primitives.module.css › .progress.gold > span': 'reste · la progression d’or',
  'src/design/primitives.module.css › .table tbody tr:global(.selected)': 'objet ouvert · la ligne choisie',
  'src/design/primitives.module.css › .table tbody tr:global(.clickable):focus-visible': 'focus · une ligne du tableau',
  'src/design/primitives.module.css › .led i': 'LED · la primitive Led',
  'src/design/primitives.tsx ×4': 'reste · les tons et la variante or des primitives (types)',
  'src/modules/agent/Agent.tsx ×3': 'reste · Envoyer et Ouvrir la passerelle (MCP, orchestrateur), au bouton d’or',
  'src/modules/agent/CloudOptions.tsx ×2': 'LED · l’agent cloud en service',
  'src/modules/agent/agent.module.css › .subtab::after': 'objet ouvert · le sous-onglet ouvert',
  'src/modules/agent/agent.module.css › .subtabCount': 'LED · des rapports pas encore lus',
  'src/modules/agent/agent.module.css › .msg.assistant .msgHead': 'reste · l’en-tête d’une réponse de l’agent',
  'src/modules/agent/agent.module.css › .msg.assistant .bubble': 'reste · le filet d’une réponse de l’agent',
  'src/modules/agent/agent.module.css › .cue': 'décision · un brief ou un débrief qui attend l’opérateur',
  'src/modules/agent/agent.module.css › .deskTools:focus-visible': 'focus · l’interrupteur des outils du desk',
  'src/modules/agent/reports.module.css › .fiche.on': 'objet ouvert · le rapport ouvert',
  'src/modules/bot/bot.module.css › .botItem.on': 'objet ouvert · l’automate ouvert',
  'src/modules/bot/bot.module.css › .stage.current': 'maintenant · l’étape en cours',
  'src/modules/bot/bot.module.css › .stage.current b': 'maintenant · son numéro',
  'src/modules/bot/bot.module.css › .phase i': 'reste · le numéro d’une phase',
  'src/modules/calendrier/Calendrier.tsx ×1': 'maintenant · la synchronisation en cours',
  'src/modules/calendrier/calendrier.module.css › .day.selected': 'objet ouvert · le jour ouvert',
  'src/modules/calendrier/calendrier.module.css › .day.today .dayNum': 'maintenant · aujourd’hui',
  'src/modules/calendrier/calendrier.module.css › .noteDot': 'reste · une note du jour',
  'src/modules/calendrier/calendrier.module.css › .fluxDay.selected': 'objet ouvert · le jour ouvert, au flux',
  'src/modules/calendrier/calendrier.module.css › .fluxDayHead.today b': 'maintenant · aujourd’hui, au flux',
  'src/modules/calendrier/calendrier.module.css › .persoItem time': 'reste · l’heure d’un rappel',
  'src/modules/calendrier/calendrier.module.css › .helpList li::marker': 'reste · la puce d’une aide',
  'src/modules/calendrier/calendrier.module.css › .nowMark': 'maintenant · la marque de maintenant',
  'src/modules/calendrier/calendrier.module.css › .nowGlyph': 'maintenant · son glyphe',
  'src/modules/copieur/Copieur.tsx ×2': 'reste · les fills routés et l’étiquette du compte maître',
  'src/modules/copieur/copieur.module.css › .acc.master': 'reste · le compte maître',
  'src/modules/crypto/Crypto.tsx ×1': 'maintenant · le flux en direct',
  'src/modules/metrique/Analyse.tsx ×1': 'reste · la diagonale de référence',
  'src/modules/metrique/BridgeModal.tsx ×5': 'reste · les actions du pont et un avertissement',
  'src/modules/metrique/EquityChart.tsx ×1': 'LED · le dernier pas de A.02',
  'src/modules/metrique/ImportModal.tsx ×2': 'reste · Importer et sa progression',
  'src/modules/metrique/MonteCarloView.tsx ×1': 'maintenant · le tirage en cours',
  'src/modules/metrique/PropFirmView.tsx ×3': 'reste · l’objectif du plan',
  'src/modules/metrique/Sessions.tsx ×1': 'reste · les étiquettes de la séance',
  'src/modules/metrique/SettingsModal.tsx ×1': 'reste · Fermer, au bouton d’or',
  'src/modules/metrique/dashboard.module.css › .eqPinned': 'maintenant · la séance que tient le curseur sur A.02',
  'src/modules/metrique/dashboard.module.css › .eqKeyPixel': 'LED · le dernier pas, à la légende de A.02',
  'src/modules/metrique/dashboard.module.css › .objOn td:first-child': 'objet ouvert · la ligne de l’objet ouvert',
  'src/modules/metrique/dashboard.module.css › .objOn .objGlyph': 'objet ouvert · son glyphe',
  'src/modules/metrique/dashboard.module.css › .subtab::after': 'objet ouvert · le sous-onglet ouvert',
  "src/modules/metrique/metrique.module.css › .openFiche[aria-current='true']": 'objet ouvert · la séance dont la fiche est ouverte',
  "src/modules/metrique/metrique.module.css › .openFiche[aria-current='true']:hover": 'objet ouvert · la même, au passage du pointeur',
  'src/modules/metrique/metrique.module.css › .planItem.on': 'objet ouvert · le plan choisi',
  'src/modules/metrique/metrique.module.css › .dropzone.over': 'reste · un fichier tenu au-dessus de la zone',
  'src/modules/metrique/metrique.module.css › .checkCol input': 'reste · la case d’une ligne',
  'src/modules/metrique/metrique.module.css › .insightRail': 'reste · le filet des constats',
  'src/modules/metrique/metrique.module.css › .cascadeLabel em': 'reste · le mot appuyé de la cascade',
  'src/modules/metrique/metrique.module.css › .cascadeNested': 'reste · le filet d’une règle imbriquée',
  'src/modules/note/Graph.tsx ×1': 'reste · la note active et la stratégie du graphe',
  'src/modules/note/Note.tsx ×1': 'reste · les étiquettes de la note',
  'src/modules/note/note.module.css › .item.on': 'objet ouvert · la note ouverte',
  'src/modules/note/note.module.css › .tagBtn.on': 'reste · l’étiquette choisie',
  'src/modules/note/note.module.css › .titleInput:focus': 'focus · le titre de la note',
  'src/modules/note/note.module.css › .preview h3': 'reste · un intertitre de l’aperçu',
  'src/modules/note/note.module.css › .preview blockquote': 'reste · une citation de l’aperçu',
  'src/modules/note/note.module.css › .preview :global(.ntag)': 'reste · une étiquette de l’aperçu',
  "src/modules/note/note.module.css › .preview input[type='checkbox']": 'reste · une case de l’aperçu',
  'src/modules/note/note.module.css › .graphEntities.on': 'reste · les entités du graphe allumées',
  'src/modules/portefeuille/Portefeuille.tsx ×2': 'reste · une couleur de poche',
  'src/modules/portefeuille/Projection.tsx ×1': 'maintenant · la projection en cours',
  'src/modules/portefeuille/Synthese.tsx ×3': 'reste · une couleur de poche, le repère et le seuil de levier',
  'src/modules/portefeuille/synthese.module.css › .alert i': 'LED · une alerte du portefeuille',
  'src/modules/visual/Chart.tsx ×1': 'maintenant · le dernier prix vivant (celui d’une démo reste à l’acier)',
  'src/modules/visual/Visual.tsx ×2': 'reste · Choisir un fichier et sa progression',
  'src/modules/visual/visual.module.css › .catalogItem small': 'reste · le code d’un indicateur du catalogue',
};

/** Le plafond de chaque liste : il baisse avec elle et ne se relève jamais. */
const OR_PLAFOND = { total: 113, reste: 45 };

/** Les usages de l'or hors de tokens.css, tels que le cliquet les nomme. */
function goldCarriers(): string[] {
  const css = /var\(--gold\b/;
  const code = /var\(--gold\b|['"`]--gold\b|(?<![\w-])['"]gold['"]/g;
  const found: string[] = [];
  for (const path of walk('src').filter((p) => /\.(css|tsx?|mjs)$/.test(p))) {
    const rel = posix('.', path);
    if (rel === 'src/design/tokens.css') continue;
    const text = readFileSync(path, 'utf8');
    if (rel.endsWith('.css')) {
      for (const rule of cssRules(text)) if (css.test(rule.body)) found.push(`${rel} › ${rule.selector.replace(/\s+/g, ' ')}`);
    } else {
      // Les commentaires ne portent pas d'or.
      const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
      const n = bare.match(code)?.length ?? 0;
      if (n > 0) found.push(`${rel} ×${n}`);
    }
  }
  return found;
}

/**
 * OROS5.45 — la taille d'usage dans les feuilles et les pièces de la vague (Système 5) : Geist Mono à 10 px au moins, une
 * micro de la planche à 12 px au moins sur son grand côté, la distance à la publication jamais mise en ellipse.
 */
const WAVE_SHEETS = [
  'src/app/criteria.module.css',
  'src/app/frise.module.css',
  'src/app/objects/fiche.module.css',
  'src/app/objects/omnibar.module.css',
  'src/app/objects/proposal.module.css',
  'src/app/registre.module.css',
  'src/app/shortcutHelp.module.css',
  'src/design/etat.module.css',
  'src/design/instruments/instruments.module.css',
] as const;
/** Les pièces de la vague qui posent une micro : chacune la règle dans sa feuille, par `className`. */
const WAVE_PIECES = [
  'src/app/Criteria.tsx',
  'src/app/Frise.tsx',
  'src/app/FriseAnswer.tsx',
  'src/app/RailGates.tsx',
  'src/app/RegistreDrawer.tsx',
  'src/app/ShortcutHelp.tsx',
  'src/app/StatusBornes.tsx',
  'src/app/objects/AccountFiche.tsx',
  'src/app/objects/AroundOf.tsx',
  'src/app/objects/CatalystFiche.tsx',
  'src/app/objects/EventStudy.tsx',
  'src/app/objects/Fiche.tsx',
  'src/app/objects/InstrumentFiche.tsx',
  'src/app/objects/Instruments.tsx',
  'src/app/objects/NoteFiche.tsx',
  'src/app/objects/Omnibar.tsx',
  'src/app/objects/ProposalFiche.tsx',
  'src/app/objects/Selection.tsx',
  'src/app/objects/SessionFiche.tsx',
  'src/app/objects/StrategyFiche.tsx',
  'src/app/objects/TradeFiche.tsx',
  'src/design/instruments/Butterfly.tsx',
  'src/modules/agent/Propositions.tsx',
  'src/modules/agent/ToolTrace.tsx',
] as const;

/**
 * Chaque micro posée par une pièce : la classe que `<Glyph className=…>` lui donne, résolue dans la feuille importée ; et
 * chaque composant de la planche posé dans une figure, `<FigureGlyph size={n}>`, à sa taille (OROS5.45l).
 */
function waveMicros(): { where: string; width: number; height: number }[] {
  const out: { where: string; width: number; height: number }[] = [];
  for (const piece of WAVE_PIECES) {
    const source = readFileSync(piece, 'utf8');
    const sheets = new Map<string, string>();
    for (const [, alias, from] of source.matchAll(/import (\w+) from '([^']+\.module\.css)'/g)) {
      sheets.set(alias!, from!.startsWith('@/') ? `src/${from!.slice(2)}` : posix('.', join(piece, '..', from!)));
    }
    for (const [tag] of source.matchAll(/<Glyph\b[^>]*?\/>/gs)) {
      for (const [, alias, name] of (tag.match(/className=\{([^}]*)\}/)?.[1] ?? '').matchAll(/\b(\w+)\.(\w+)\b/g)) {
        const sheet = sheets.get(alias!);
        if (!sheet) continue;
        const rules = cssRules(readFileSync(sheet, 'utf8')).filter((rule) => rule.selector.split(',').map((part) => part.trim()).includes(`.${name}`));
        expect(rules.length, `${piece} › ${sheet} .${name}`).toBeGreaterThan(0);
        for (const rule of rules) {
          const px = (prop: string) => Number(new RegExp(`(?:^|;)\\s*${prop}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(rule.body)?.[1] ?? NaN);
          out.push({ where: `${piece} › ${sheet} ${rule.at.join(' ')} .${name}`.replace(/\s+/g, ' '), width: px('width'), height: px('height') });
        }
      }
    }
    for (const [tag] of source.matchAll(/<FigureGlyph\b[^>]*?\/>/gs)) {
      const size = Number(/\bsize=\{(\d+(?:\.\d+)?)\}/.exec(tag)?.[1] ?? NaN);
      out.push({ where: `${piece} › ${tag.replace(/\s+/g, ' ').slice(0, 80)}`, width: size, height: size });
    }
  }
  return out;
}

describe('garde du système visuel', () => {
  it('n’appelle aucune police Google', () => {
    const roots = ['src', 'electron', 'index.html'].flatMap((entry) => (entry.endsWith('.html') ? [entry] : walk(entry)));
    const hits = roots.filter((path) => /fonts\.(googleapis|gstatic)/.test(readFileSync(path, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('retire Inter des jetons', () => {
    expect(readFileSync('src/design/tokens.css', 'utf8')).not.toMatch(/Inter/);
  });

  it('garde un contraste d’au moins 4,5:1 pour le texte sur la plaque', () => {
    const css = readFileSync('src/design/tokens.css', 'utf8');
    const bg = token(css, '--bg-2');
    for (const name of ['--text-1', '--text-2', '--text-3', '--text-4']) {
      expect(contrast(token(css, name), bg), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('réserve --ghost et --line-3 au châssis, et --lab hors des modules', () => {
    const color = /color\s*:\s*var\(\s*--(?:ghost|line-3)\s*\)/g;
    const offenders: string[] = [];
    for (const path of walk('src')) {
      const rel = posix('src', path);
      if (rel === 'app/shell.module.css') continue;
      const text = readFileSync(path, 'utf8');
      if (color.test(text)) offenders.push(rel);
      color.lastIndex = 0;
    }
    expect(offenders).toEqual([]);
    const lab = walk('src/modules').filter((path) => readFileSync(path, 'utf8').includes('--lab'));
    expect(lab).toEqual([]);
  });

  it('garde un contraste d’au moins 4,5:1 pour le texte sur l’usiné', () => {
    const css = readFileSync('src/design/tokens.css', 'utf8');
    const bg = token(css, '--bg-3');
    for (const name of ['--text-1', '--text-2', '--text-3', '--text-4']) {
      expect(contrast(token(css, name), bg), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('allume la LED en or et garde le rouge au signal de niveau 3', () => {
    const css = readFileSync('src/design/tokens.css', 'utf8');
    const gold = hue(token(css, '--gold'));
    expect(gold, `teinte de --gold : ${gold}`).toBeGreaterThanOrEqual(30);
    expect(gold, `teinte de --gold : ${gold}`).toBeLessThanOrEqual(60);
    const signal = hue(token(css, '--signal'));
    expect(signal <= 10 || signal >= 350, `teinte de --signal : ${signal}`).toBe(true);
  });

  it('pose le papier de la Ligne V2 : encre, encre douce et or d’encre se lisent sur l’ivoire', () => {
    const css = readFileSync('src/design/tokens.css', 'utf8');
    const ivory = token(css, '--ivory');
    token(css, '--stone');
    for (const name of ['--ink', '--ink-soft', '--gold-ink']) {
      expect(contrast(token(css, name), ivory), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('embarque les trois voix du Système 4.0 avec leur licence OFL, sans paquet nouveau', () => {
    const css = readFileSync('src/design/fonts.css', 'utf8');
    const families = new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]));
    expect(families).toEqual(new Set(['Instrument Sans', 'Geist Mono', 'IBM Plex Sans']));
    const files = [...css.matchAll(/url\('\.\/fonts\/([^']+\.woff2)'\)/g)].map((m) => m[1]!);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) expect(statSync(join('src/design/fonts', file)).size, file).toBeGreaterThan(1000);
    for (const licence of ['OFL-InstrumentSans.txt', 'OFL-GeistMono.txt', 'OFL-IBMPlexSans.txt']) {
      expect(readFileSync(join('src/design/fonts', licence), 'utf8'), licence).toMatch(/SIL Open Font License/);
    }
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main).toContain("import '@/design/fonts.css';");
    expect(main).not.toMatch(/@fontsource-variable\/(archivo|jetbrains-mono|inter)/);
    const tokens = readFileSync('src/design/tokens.css', 'utf8');
    expect(tokens).toMatch(/--font-ui:\s*'Instrument Sans'/);
    expect(tokens).toMatch(/--font-mono:\s*'Geist Mono'/);
    expect(tokens).toMatch(/--font-name:\s*'IBM Plex Sans'/);
    const stale = walk('src').filter((path) => /(?:JetBrains Mono|Archivo) Variable/.test(readFileSync(path, 'utf8')));
    expect(stale.map((path) => posix('src', path))).toEqual([]);
  });

  it('OROS4.1 le passage du pointeur est une lumière : chaque :hover vit sous @media (hover: hover) et ne change que la lumière', () => {
    const offenders: string[] = [];
    let hovers = 0;
    for (const path of walk('src').filter((p) => p.endsWith('.css'))) {
      const found = hoverOffenses(readFileSync(path, 'utf8'), posix('src', path));
      offenders.push(...found.offenders);
      hovers += found.hovers;
    }
    expect(offenders).toEqual([]);
    // Les boutons d'action portent la règle : sans elle, la garde ne garderait rien.
    expect(hovers).toBeGreaterThan(0);
  });

  it('OROS5.26 la lecture liée passe par un seul crochet : aucun écouteur du pointeur hors de useHoverLight dans src/app/objects, et [data-lit] ne change que la lumière, sous @media (hover: hover)', () => {
    const listeners = /\bon(?:Mouse|Pointer)(?:Enter|Leave|Over|Out|Move)\b/;
    const offenders = walk('src/app/objects')
      .filter((path) => posix('.', path) !== 'src/app/objects/useHoverLight.ts')
      .filter((path) => listeners.test(readFileSync(path, 'utf8')))
      .map((path) => posix('.', path));
    expect(offenders).toEqual([]);
    // Le crochet existe et pose les deux écouteurs ; il ne pose que `data-lit`.
    const hook = readFileSync('src/app/objects/useHoverLight.ts', 'utf8');
    expect(hook).toMatch(/onMouseEnter/);
    expect(hook).toMatch(/'data-lit'/);
    expect(hook.match(/'data-[a-z-]+'/g)?.filter((attr) => attr !== "'data-lit'") ?? []).toEqual([]);
    // Partout où une feuille règle `[data-lit]`, c'est sous `@media (hover: hover)`, et de la lumière seulement.
    const lit: string[] = [];
    const wrong: string[] = [];
    for (const path of walk('src').filter((p) => p.endsWith('.css'))) {
      for (const rule of cssRules(readFileSync(path, 'utf8'))) {
        if (!/\[data-lit\]/.test(rule.selector)) continue;
        const at = `${posix('src', path)} ${rule.selector}`;
        lit.push(at);
        if (!rule.at.some((head) => /^@media\s*\(hover:\s*hover\)/.test(head))) wrong.push(`${at} : hors de @media (hover: hover)`);
        for (const prop of rule.props) if (!HOVER_LIGHT.has(prop)) wrong.push(`${at} : ${prop}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(lit.length).toBeGreaterThan(0);
  });

  it('OROS4.1 chaque bouton d’action a son contour : un filet fin et sa lumière blanche, jamais transparent', () => {
    const css = readFileSync('src/design/primitives.module.css', 'utf8');
    const tokens = readFileSync('src/design/tokens.css', 'utf8');
    expect(tokens).toMatch(/--light-line:\s*color-mix\(in srgb, var\(--ivory\) \d+%, transparent\);/);
    expect(tokens).toMatch(/--light-edge:\s*linear-gradient\(/);
    const btn = cssRules(css).find((rule) => rule.selector === '.btn');
    expect(btn?.body).toMatch(/border: 1px solid var\(--light-line\)/);
    expect(btn?.body).toMatch(/background-image: var\(--light-edge\)/);
    for (const variant of ['.btn.ghost', '.btn.gold', '.btn.danger']) {
      const body = cssRules(css).find((rule) => rule.selector === variant)?.body ?? '';
      expect(body, variant).toMatch(/border-color:/);
      expect(body, variant).not.toMatch(/border-color:\s*transparent/);
    }
  });

  it('OROS4.7 le desk ne dit jamais où vit son coffre : aucune phrase « reste sur ce poste », « ne quitte pas la machine »', () => {
    const said = /reste sur ce poste|lus sur ce poste|ne quitte (?:pas|jamais) (?:le poste|la machine)|uniquement sur votre machine|se queda en este equipo|no sale del equipo|nunca sale de la máquina|solo en su máquina|stays on this machine|never leaves the machine|only on your machine|read on this desk/i;
    const offenders = ['src/app', 'src/modules', 'src/design', 'electron/launcher.html', 'electron/launcher-ui.js']
      .flatMap((entry) => (entry.includes('.') ? [entry] : walk(entry)))
      .filter((path) => said.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('OROS4.7 rien de décoratif sous un titre : les accroches retirées ne reviennent pas', () => {
    // Les accroches telles qu'elles s'écrivaient : un appel tr('…') ou une baseline d'onglet.
    const gone = [
      'Journal quantitatif', 'Ultimate journal', 'Graphique avancé', 'Advanced chart', 'Passerelle native', 'Native gateway',
      "tr('création, édition, archivage'", "tr('points de départ'", "tr('séquence du protocole'", "tr('compte maître → comptes suiveurs'",
      "tr('appliqués avant tout envoi'", "tr('conditions · actions · garde-fous'", "tr('atelier bot'", "tr('choix en cascade'",
      "tr('ce que le moteur vérifie'", "tr('saisie rapide sans détail par trade'", "tr('import automatique · dossier surveillé'",
      "tr('bootstrap avec remise", "tr('distribution des résultats'", "tr('Repère débutant'", "tr('toutes les versions'",
      "tr('confirmation requise'", "tr('taux saisi, inverse déduit'", "tr('consolidée et par poche", "tr('opérateur · capital · plan suivi",
      "tr('notes et rappels'", "tr('fil macro'", 'forgé par le Lab', "tr('Période et compte appliqués'",
    ];
    const sources = ['src/app', 'src/modules', 'src/design'].flatMap((dir) => walk(dir)).map((path) => [path, readFileSync(path, 'utf8')] as const);
    const found = gone.flatMap((text) => sources.filter(([, body]) => body.includes(text)).map(([path]) => `${posix('.', path)} : ${text}`));
    expect(found).toEqual([]);
  });

  it('réserve le rouge au niveau 3 : le toast d’erreur le porte, et le rouge marque sans jamais écrire', () => {
    expect(readFileSync('src/app/shell.module.css', 'utf8')).toMatch(/\.toast\.error\s*\{\s*border-left:\s*2px solid var\(--signal\);/);
    // Le signal vit dans le châssis (toast, bande du kill switch) et dans la primitive Signal, nulle part ailleurs.
    const allowed = new Set(['app/shell.module.css', 'design/primitives.module.css']);
    const users = walk('src').filter((path) => /var\(--signal/.test(readFileSync(path, 'utf8'))).map((path) => posix('src', path));
    expect(users.filter((rel) => !allowed.has(rel))).toEqual([]);
    const writes = walk('src').filter((path) => /(?:^|[\s;{])color:\s*var\(--signal\)/m.test(readFileSync(path, 'utf8')));
    expect(writes.map((path) => posix('src', path))).toEqual([]);
  });

  it('OROS5.44 l’or dit ce que tient l’opérateur : chaque usage figure au cliquet, qui ne fait que décroître ; il quitte les étoiles d’Éval., les boutons de création, le modèle non testé, la démo, le curseur et les interrupteurs', () => {
    const found = goldCarriers();
    const listed = Object.keys(OR);
    // Aucun usage hors du cliquet : un or nouveau dit l'un des sens, et le cliquet le nomme.
    expect(found.filter((where) => !listed.includes(where))).toEqual([]);
    // Le cliquet ne garde que des usages réels : un usage rendu à l'ivoire en sort.
    expect(listed.filter((where) => !found.includes(where))).toEqual([]);
    expect(listed).toHaveLength(OR_PLAFOND.total);
    for (const [where, dit] of Object.entries(OR)) expect(OR_SENS.some((sens) => dit.startsWith(`${sens} · `)), `${where} : ${dit}`).toBe(true);
    expect(Object.values(OR).filter((dit) => dit.startsWith('reste · '))).toHaveLength(OR_PLAFOND.reste);

    // Les étoiles d'Éval. de B · Séances : ni la classe d'or dans la table, ni l'or sur l'étoile cochée.
    expect(listed.some((where) => /Éval|\.stars/.test(where))).toBe(false);
    const sessions = readFileSync('src/modules/metrique/Sessions.tsx', 'utf8');
    expect(sessions).not.toMatch(/className="gold">\{x\.rating/);
    const star = cssRules(readFileSync('src/modules/metrique/metrique.module.css', 'utf8')).find((rule) => rule.selector === '.stars button.on');
    expect(star?.body).toMatch(/color: var\(--text-0\)/);
    // Les boutons de création : Nouvel automate, Nouvelle note, Brancher, Ajouter (Copieur), Créer l'alerte, la séance
    // manuelle et Générer la démo passent au bouton d'action ordinaire.
    const creation: readonly (readonly [string, string])[] = [
      ['src/modules/bot/Bot.tsx', 'Nouvel automate'],
      ['src/modules/note/Note.tsx', 'Nouvelle note'],
      ['src/modules/note/Note.tsx', 'Brancher'],
      ['src/modules/copieur/Copieur.tsx', "tr('Ajouter'"],
      ['src/modules/crypto/AlertModal.tsx', 'Créer l’alerte'],
      ['src/modules/metrique/ManualSessionModal.tsx', "tr('Enregistrer'"],
      ['src/modules/visual/Visual.tsx', 'Générer la démo'],
    ];
    for (const [path, label] of creation) {
      const source = readFileSync(path, 'utf8');
      let at = source.indexOf(label);
      expect(at, `${path} : ${label}`).toBeGreaterThan(-1);
      for (; at > -1; at = source.indexOf(label, at + 1)) {
        const button = source.slice(source.lastIndexOf('<Button', at), at);
        expect(button, `${path} : ${label}`).not.toMatch(/variant="gold"/);
      }
    }
    // Le modèle non testé n'a pas de ton ; testé, la menthe ; en échec, la braise.
    expect(readFileSync('src/modules/agent/Agent.tsx', 'utf8')).toMatch(/<Tag tone=\{probeState \? \(probeState\.ok \? 'mint' : 'ember'\) : undefined\} dot/);
    // Le curseur de température : la règle locale l'emporte sur celle de tokens.css (spécificité 0,2,0 contre 0,1,1).
    const agentCss = cssRules(readFileSync('src/modules/agent/agent.module.css', 'utf8'));
    expect(agentCss.find((rule) => rule.selector === ".temperature[type='range']")?.body).toMatch(/accent-color: var\(--text-1\)/);
    expect(readFileSync('src/modules/agent/Agent.tsx', 'utf8')).toMatch(/<input type="range" className=\{s\.temperature\}/);
    expect(readFileSync('src/design/tokens.css', 'utf8')).toMatch(/input\[type='range'\] \{\s*accent-color: var\(--gold\);/);
    // Les interrupteurs : allumés, à l'ivoire — celui des outils du desk, la primitive Toggle, la case du menu Options.
    expect(agentCss.find((rule) => rule.selector === ".deskTools[aria-checked='true'] .toggleGlyph")?.body).toMatch(/--k: var\(--text-0\)/);
    const primitives = cssRules(readFileSync('src/design/primitives.module.css', 'utf8'));
    expect(primitives.find((rule) => rule.selector === '.toggle.on .toggleTrack::after')?.body).toMatch(/background: var\(--text-0\)/);
    expect(cssRules(readFileSync('src/design/optionsMenu.module.css', 'utf8')).find((rule) => rule.selector === '.check.checked')?.body).toMatch(/background-color: var\(--text-0\)/);
    expect(readFileSync('src/modules/portefeuille/Portefeuille.tsx', 'utf8')).not.toMatch(/tone: discrete \? 'gold'/);

    // DESIGN.md écrit le sens retenu, au § 00 et au § 02.
    const doc = readFileSync('docs/DESIGN.md', 'utf8').replace(/\r\n/g, '\n');
    const doctrine = doc.slice(doc.indexOf('## 00.'), doc.indexOf('## 01.'));
    expect(doctrine).toMatch(/\*\*L’or dit ce que tient l’opérateur ; seul ce qui franchit la borne est rouge\.\*\*/);
    for (const sens of ['maintenant', 'l’objet ouvert', 'la décision qui l’attend avec sa barre de 45 s', 'la LED']) expect(doctrine, sens).toContain(sens);
    expect(doctrine).not.toMatch(/Ce qui vit est or|or pour ce qui vit/);
    const signals = doc.slice(doc.indexOf('## 02.'), doc.indexOf('## 03.'));
    expect(signals).toMatch(/^\| LED · ce que tient l’opérateur \| `--gold` \|/m);
  });

  it('OROS5.45 la taille d’usage : Geist Mono à 10 px au moins et une micro à 12 px au moins dans les pièces de la vague ; la distance à la publication jamais en ellipse', () => {
    // Aucune police sous 10 px dans les feuilles nouvelles, et toujours en px : la garde lit ce qui est écrit.
    const small: string[] = [];
    for (const sheet of WAVE_SHEETS) {
      for (const rule of cssRules(readFileSync(sheet, 'utf8'))) {
        for (const [, value] of rule.body.matchAll(/(?:^|;)\s*font-size:\s*([^;]+)/g)) {
          const px = /^(\d+(?:\.\d+)?)px$/.exec(value!.trim());
          if (!px || Number(px[1]) < 10) small.push(`${sheet} › ${rule.selector} : ${value!.trim()}`);
        }
      }
    }
    expect(small).toEqual([]);
    // Aucune micro sous 12 px sur son grand côté ; chacune a sa mesure.
    const micros = waveMicros();
    expect(micros.length).toBeGreaterThan(30);
    // les composants posés dans une figure comptent aussi (OROS5.45l) : M.022, M.011, le graphe de la fiche
    expect(micros.filter((m) => m.where.includes('<FigureGlyph')).length).toBeGreaterThanOrEqual(4);
    expect(micros.filter((m) => !(Number.isFinite(m.width) || Number.isFinite(m.height)))).toEqual([]);
    expect(micros.filter((m) => Math.max(Number.isFinite(m.width) ? m.width : 0, Number.isFinite(m.height) ? m.height : 0) < 12).map((m) => `${m.where} ${m.width}×${m.height}`)).toEqual([]);
    // La distance à la publication (« CPI +108 min ») : la ligne de trade de la séance et l'échelle du trade la posent
    // dans `.release`, d'un seul tenant ; ni elle ni ce qui la porte n'est coupé ni mis en ellipse.
    const fiche = cssRules(readFileSync('src/app/objects/fiche.module.css', 'utf8'));
    const release = fiche.filter((rule) => rule.selector.split(',').map((part) => part.trim()).includes('.release'));
    expect(release.length).toBeGreaterThan(0);
    expect(release.map((rule) => rule.body).join(';')).toMatch(/white-space: nowrap/);
    const carriers = fiche.filter((rule) => /\.(?:release|tradeTime|tradeRow)\b/.test(rule.selector));
    for (const rule of carriers) expect(rule.body, rule.selector).not.toMatch(/text-overflow|overflow:\s*hidden|-webkit-line-clamp/);
    // Dans la fiche, l'ellipse ne sert qu'au fil d'Ariane de la barre de titre.
    expect(fiche.filter((rule) => /text-overflow:\s*ellipsis/.test(rule.body)).map((rule) => rule.selector.replace(/\s+/g, ' '))).toEqual(['.crumbLink, .crumbObject']);
    expect(readFileSync('src/app/objects/SessionFiche.tsx', 'utf8')).toMatch(/<span className=\{s\.release\} data-release="">/);
    expect(readFileSync('src/app/objects/TradeFiche.tsx', 'utf8')).toMatch(/<span className=\{s\.release\}>\{release\}<\/span>/);
  });

  it('OROS5.47c aucune police relative ne descend sous 10 px : les décimales d’un montant, à 60 %, ont 10 px pour plancher', () => {
    // Sous Electron, la fiche posait des montants de 12 px : leurs décimales, à 0,6 em, tombaient à 7,2 px.
    const floorless: string[] = [];
    for (const path of walk('src').filter((p) => p.endsWith('.css'))) {
      for (const rule of cssRules(readFileSync(path, 'utf8'))) {
        for (const [, raw] of rule.body.matchAll(/(?:^|;)\s*font-size:\s*([^;]+)/g)) {
          const value = raw!.trim();
          if (!/(?:\d(?:r?em|%|vw|vh|vmin|vmax)\b|\d%)/.test(value)) continue;
          const floor = /^(?:max|clamp)\((\d+(?:\.\d+)?)px,/.exec(value);
          if (!floor || Number(floor[1]) < 10) floorless.push(`${posix('src', path)} › ${rule.selector} : ${value}`);
        }
      }
    }
    expect(floorless).toEqual([]);
    const decimals = cssRules(readFileSync('src/design/primitives.module.css', 'utf8')).find((rule) => rule.selector === '.decimals');
    expect(decimals?.body).toMatch(/font-size: max\(10px, 0\.6em\);/);
    const doc = readFileSync('docs/DESIGN.md', 'utf8').replace(/\r\n/g, '\n');
    expect(doc.slice(doc.indexOf('## 05.'), doc.indexOf('## 06.'))).toMatch(/décimales à 60 %, jamais sous 10 px/);
  });

  it('OROS5.45a une animation d’une feuille de module nomme un @keyframes de cette feuille : les modules CSS renomment le nom en local, celui de tokens.css n’y répond jamais', () => {
    const keywords = new Set(['none', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'both', 'forwards', 'backwards', 'infinite', 'alternate', 'alternate-reverse', 'reverse', 'normal', 'running', 'paused', 'initial', 'inherit', 'unset']);
    const dangling: string[] = [];
    let named = 0;
    for (const path of walk('src').filter((p) => p.endsWith('.module.css'))) {
      const text = readFileSync(path, 'utf8');
      const declared = new Set([...text.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!));
      for (const rule of cssRules(text)) {
        for (const [, prop, value] of rule.body.matchAll(/(?:^|;)\s*(animation(?:-name)?)\s*:\s*([^;]+)/g)) {
          // Les fonctions (var, calc, cubic-bezier, steps), imbriquées comprises, ne nomment rien.
          let bare = value!;
          for (let prev = ''; prev !== bare; ) [prev, bare] = [bare, bare.replace(/[\w-]*\([^()]*\)/g, ' ')];
          for (const layer of bare.split(',')) {
            const names = layer.trim().split(/\s+/).filter((word) => word && !keywords.has(word) && !/^-?[\d.]+(?:m?s)?$/.test(word));
            if (prop === 'animation-name' || names.length > 0) named++;
            for (const name of names) if (!declared.has(name)) dangling.push(`${posix('src', path)} › ${rule.selector.replace(/\s+/g, ' ')} : ${name}`);
          }
        }
      }
    }
    expect(dangling).toEqual([]);
    // La garde lit des animations réelles : la frise, le registre, le verrou, la marque du siège en ont.
    expect(named).toBeGreaterThan(10);
  });

  it('OROS5.21 la plaque vissée quitte A.01 et B.01 : ni vis, ni languette, ni dégradé, ni rayon, ni ombre ; le filet d’un pixel reste', () => {
    // aucune PlaqueVissee dans les modules ; sans emploi, la primitive sort, avec ses règles
    const reads = (dir: string) => walk(dir).filter((path) => /PlaqueVissee/.test(readFileSync(path, 'utf8'))).map((path) => posix('.', path));
    expect(reads('src/modules')).toEqual([]);
    expect(reads('src')).toEqual([]);
    const primitives = cssRules(readFileSync('src/design/primitives.module.css', 'utf8')).flatMap((rule) => rule.selector.split(/\s*,\s*/));
    for (const gone of ['.plaque', '.trame', '.vis', '.visTl', '.visTr', '.visBl', '.visBr', '.languette', '.plaqueBody']) expect(primitives, gone).not.toContain(gone);
    // A.01 et B.01 gardent leur plaque : une section au filet d'un pixel, à plat, sans or
    const plates = [
      ['src/modules/metrique/Dashboard.tsx', 'src/modules/metrique/dashboard.module.css', 'A.01'],
      ['src/modules/portefeuille/Synthese.tsx', 'src/modules/portefeuille/synthese.module.css', 'B.01'],
    ] as const;
    for (const [source, sheet, code] of plates) {
      const tsx = readFileSync(source, 'utf8');
      const open = tsx.indexOf('<section className={`${s.plaque} ${s.span7}`}>');
      expect(open, source).toBeGreaterThan(-1);
      expect(tsx.indexOf(`${code} /`, open), source).toBeGreaterThan(open);
      const body = cssRules(readFileSync(sheet, 'utf8')).find((rule) => rule.selector === '.plaque' && rule.at.length === 0)?.body ?? '';
      expect(body, sheet).toMatch(/border: 1px solid var\(--line-1\);/);
      expect(body, sheet).not.toMatch(/radius|shadow|gradient|--lab|--gold|#[0-9a-f]{3,6}/i);
    }
  });

  it('DESIGN.md décrit le Système 4.1 avec les valeurs exactes de tokens.css', () => {
    const doc = readFileSync('docs/DESIGN.md', 'utf8');
    const css = readFileSync('src/design/tokens.css', 'utf8');
    expect(doc).toMatch(/^# Système visuel — CΛNTO · révision 4\.1/m);
    const rows = [...doc.matchAll(/^\|[^|\n]*\|\s*((?:`--[a-z0-9-]+`,?\s*)+)\|\s*`(#[0-9A-Fa-f]{6})`/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const [, names, value] of rows) {
      for (const [, name] of names!.matchAll(/`(--[a-z0-9-]+)`/g)) {
        expect(token(css, name!).toLowerCase(), name).toBe(value!.toLowerCase());
      }
    }
  });

  it('OROS5.46 DESIGN.md inscrit au § 09 chaque pièce de la vague (numéro, donnée liée, fichier), chaque numéro de la table sens → numéro, le grec et les mesures locales ; les mesures du châssis sont celles de tokens.css ; aucun triangle ne dit plus un signal', () => {
    const doc = readFileSync('docs/DESIGN.md', 'utf8').replace(/\r\n/g, '\n');
    const css = readFileSync('src/design/tokens.css', 'utf8').replace(/\r\n/g, '\n');
    const lab = doc.slice(doc.indexOf('## 09.'), doc.indexOf('## 10.'));
    const pad = (n: number) => String(n).padStart(3, '0');

    // La table des pièces : une ligne par pièce, son numéro, la donnée qu'elle lit, le fichier qui la pose.
    const head = '| Pièce | Numéro | Donnée liée | Fichier |';
    expect(lab).toContain(head);
    const table: string[] = [];
    for (const line of lab.slice(lab.indexOf(head)).split('\n')) {
      if (!line.startsWith('|')) break;
      table.push(line);
    }
    const rows = table.slice(2).map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
    expect(rows.length).toBeGreaterThanOrEqual(20);
    const glyphIds = new Set<number>(Object.values(GLYPH_ID));
    const inscribed = new Set<string>();
    for (const row of rows) {
      expect(row, row.join(' | ')).toHaveLength(4);
      const [piece, numero, donnee, fichier] = row as [string, string, string, string];
      expect(piece.length * donnee.length, piece).toBeGreaterThan(0);
      const files = [...fichier.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
      expect(files.length, piece).toBeGreaterThan(0);
      for (const file of files) expect(existsSync(file), `${piece} : ${file}`).toBe(true);
      // Un numéro M. se lit dans l'un des fichiers de sa ligne ; un numéro C. est un composant de la bibliothèque unique.
      for (const [id] of numero.matchAll(/M\.\d{3}/g)) {
        inscribed.add(id);
        expect(files.some((file) => readFileSync(file, 'utf8').includes(id)), `${piece} : ${id}`).toBe(true);
      }
      for (const [, n] of numero.matchAll(/C\.(\d{3})/g)) expect(glyphIds.has(Number(n)), `${piece} : C.${n}`).toBe(true);
    }
    // Chaque pièce M. que le desk pose a sa ligne.
    const posed = new Set<string>();
    for (const path of walk('src')) {
      if (posix('src', path) === 'design/micro/assets.ts') continue;
      for (const [id] of readFileSync(path, 'utf8').matchAll(/\bM\.\d{3}\b/g)) posed.add(id);
    }
    expect(posed.size).toBeGreaterThanOrEqual(9);
    expect([...posed].filter((id) => !inscribed.has(id)).sort()).toEqual([]);

    // Chaque numéro de la table sens → numéro, et chaque signe réservé du châssis, est cité au § 09.
    const numbers = new Set<number>([...Object.values(MEANING), ...Object.keys(RESERVED_GLYPHS).map(Number)]);
    expect(numbers.size).toBeGreaterThanOrEqual(26);
    for (const n of numbers) expect(lab.includes(`(${n})`) || lab.includes(`C.${pad(n)}`), `C.${pad(n)}`).toBe(true);

    // Le grec : ΟΡΟΣ une seule fois, en IBM Plex Sans, en titre de la section Bornes de la fiche Compte (décision 6).
    expect(lab).toMatch(/ΟΡΟΣ[^.]*une seule fois[^.]*IBM Plex Sans[^.]*section Bornes de la fiche Compte/);
    expect(cssRules(readFileSync('src/app/objects/fiche.module.css', 'utf8')).find((rule) => rule.selector === '.oros')?.body).toMatch(/font-family: var\(--font-name\)/);

    // Les mesures locales (décision 4) : écrites au § 09 avec leur feuille, lues dans cette feuille, jamais en jeton.
    const mesures = [
      ['fiche', 400, 'src/app/shell.module.css', '.shell.withDrawer', 'grid-template-columns'],
      ['omnibar', 500, 'src/app/objects/omnibar.module.css', '.panel', 'width'],
      ['tiroir de la frise', 64, 'src/app/frise.module.css', '.drawer', 'height'],
      ['registre', 240, 'src/app/registre.module.css', '.drawer', 'height'],
    ] as const;
    for (const [name, px, sheet, selector, prop] of mesures) {
      expect(lab, name).toContain(`${name} ${px} px (\`${sheet}\`)`);
      const body = cssRules(readFileSync(sheet, 'utf8')).find((rule) => rule.selector === selector && rule.at.length === 0)?.body ?? '';
      expect(body, `${sheet} › ${selector}`).toMatch(new RegExp(`(?:^|;)\\s*${prop}:[^;]*\\b${px}px`));
    }
    expect(css).not.toMatch(/--(?:drawer|omnibar|fiche|registre|frise|state)-[a-z]*\s*:/);

    // Les mesures du châssis et la largeur de l'afficheur sont celles de tokens.css.
    const chassis = /Châssis : titre (\d+), rail (\d+), état (\d+)/.exec(doc);
    expect(chassis).not.toBeNull();
    for (const [i, name] of (['--titlebar-h', '--rail-w', '--statusbar-h'] as const).entries()) expect(css, name).toMatch(new RegExp(`${name}: ${chassis![i + 1]}px;`));
    const stretch = /`--value-stretch` : (\d+) %/.exec(doc);
    expect(stretch).not.toBeNull();
    expect(css).toMatch(new RegExp(`--value-stretch: ${stretch![1]}%;`));

    // Plus aucun triangle ne dit un signal : le glyphe dit le niveau (orbite, rayonnement, cercle barré).
    expect(doc).not.toMatch(/forme du triangle|Triangle : un signal|triangle plein|marque — triangle/);
    const signals = doc.slice(doc.indexOf('## 02.'), doc.indexOf('## 03.'));
    for (const n of [131, 12, 123]) expect(signals, String(n)).toContain(`(${n})`);
  });

  it('OROS5.4 le design et le châssis ne lisent aucun module : les tables du trait, de l’impact et des titres vivent dans src/lib', () => {
    // La fiche (src/app/objects) et la frise (src/app/Frise*) naîtront ici ; src/lib reçoit les tables qu'elles liront.
    const scoped = [
      ...walk('src/design'),
      ...walk('src/lib'),
      ...(existsSync('src/app/objects') ? walk('src/app/objects') : []),
      ...walk('src/app').filter((path) => /^app\/frise/i.test(posix('src', path))),
    ];
    const readsModule = /(?:from\s+|import\(\s*)['"](?:@\/modules\/|(?:\.\.\/)+modules\/)/;
    expect(scoped.filter((path) => readsModule.test(readFileSync(path, 'utf8'))).map((path) => posix('.', path))).toEqual([]);
    // Le Calendrier les lit dans src/lib ; il ne les définit plus.
    const calendar = readFileSync('src/modules/calendrier/Calendrier.tsx', 'utf8');
    expect(calendar).toMatch(/from '@\/lib\/calendarMarks'/);
    expect(calendar).toMatch(/from '@\/lib\/eventTitles'/);
    expect(calendar).not.toMatch(/function trEventDesc|const EVENT_DESC/);
    expect(readFileSync('src/modules/calendrier/calState.ts', 'utf8')).not.toMatch(/export function (?:strokeOf|impactBars|horizonEnd)/);
    expect(existsSync('src/modules/calendrier/eventTitles.ts')).toBe(false);
  });

  it('OROS5.4 chaque titre embarqué a ses trois langues', async () => {
    const { calendarBundle } = await import('@/engine/calendar-bundle');
    const { generateNasdaqEvents } = await import('@/engine/calendar');
    const { eventTitleLanguages, trEventTitle } = await import('@/lib/eventTitles');
    const { useI18n } = await import('@/i18n');
    // Les titres que le desk écrit lui-même, en français : le calendrier moteur et les sources de l'instantané. Ceux de la
    // BEA sont les noms de la source, en anglais : ils ne sont pas restés en français.
    const titles = new Set<string>();
    for (const e of calendarBundle.events) if (e.origin !== 'bea') titles.add(e.title);
    for (const year of [2026, 2027]) for (const e of generateNasdaqEvents(year)) titles.add(e.title);
    expect(titles.size).toBeGreaterThan(20);
    const missing = [...titles].filter((title) => {
      const row = eventTitleLanguages(title);
      return !row || row[0] !== title || !row[1] || !row[2];
    });
    expect(missing).toEqual([]);
    const said = (title: string) =>
      (['fr', 'en', 'es'] as const).map((locale) => {
        useI18n.setState({ locale });
        return trEventTitle(title);
      });
    try {
      expect(said('Stocks pétrole EIA')).toEqual(['Stocks pétrole EIA', 'EIA crude oil inventories', 'Inventarios de petróleo EIA']);
      expect(said('Décision de politique monétaire BCE')).toEqual(['Décision de politique monétaire BCE', 'ECB monetary policy decision', 'Decisión de política monetaria del BCE']);
      expect(said('Adjudication 52-Week Bill')).toEqual(['Adjudication 52-Week Bill', '52-Week Bill auction', 'Subasta 52-Week Bill']);
      // Un rappel saisi reste tel quel.
      expect(said('Appeler le courtier')).toEqual(['Appeler le courtier', 'Appeler le courtier', 'Appeler le courtier']);
    } finally {
      useI18n.setState({ locale: 'fr' });
    }
  });

  it('DESIGN.md décrit les micrographies du Lab et le lanceur AUBE ; le bord du desk n’annote plus rien (4.1)', () => {
    const doc = readFileSync('docs/DESIGN.md', 'utf8');
    for (const id of Object.keys(PLATES)) expect(doc, id).toContain(`\`${id}\``);
    expect(doc).toMatch(/Un seul code-barres/);
    expect(doc).toMatch(/## 10\. Lanceur AUBE/);
    expect(readFileSync('src/app/Shell.tsx', 'utf8')).not.toMatch(/DEEP TECH|RÉV\. 4/);
    expect(readFileSync('CLAUDE.md', 'utf8')).toMatch(/Système 4\.1/);
  });
});
