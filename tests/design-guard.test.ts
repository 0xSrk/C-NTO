import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATES } from '@/design/micro/assets';

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

/** Ce qu'un passage du pointeur a le droit de changer : la lumière, jamais la place ni la forme. */
const HOVER_LIGHT = new Set(['color', 'background-color', 'border-color', 'box-shadow', 'opacity', 'text-shadow', '--k']);

interface CssRule {
  selector: string;
  /** En-têtes des blocs @ qui l'entourent, du plus large au plus proche. */
  at: string[];
  props: string[];
  body: string;
}

/** Lecture des règles d'une feuille (commentaires ôtés) : sélecteur, blocs @ englobants, propriétés déclarées. */
function cssRules(source: string): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: CssRule[] = [];
  const stack: { head: string; body: string }[] = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push({ head: buf.trim(), body: '' });
      buf = '';
    } else if (ch === '}') {
      const top = stack.pop();
      if (top && !top.head.startsWith('@')) {
        const body = `${top.body}${buf}`;
        const props = body
          .split(';')
          .map((decl) => decl.split(':')[0]?.trim() ?? '')
          .filter(Boolean);
        out.push({ selector: top.head, at: stack.filter((s) => s.head.startsWith('@')).map((s) => s.head), props, body });
      }
      buf = '';
    } else if (ch === ';') {
      // Hors de tout bloc (@import…), la déclaration n'appartient à aucune règle.
      if (stack.length > 0) stack[stack.length - 1]!.body += `${buf};`;
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

function token(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`jeton ${name} introuvable`);
  return match[1];
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
      for (const rule of cssRules(readFileSync(path, 'utf8'))) {
        if (!/:hover\b/.test(rule.selector)) continue;
        hovers++;
        const where = `${posix('src', path)} ${rule.selector}`;
        if (!rule.at.some((at) => /^@media\s*\(hover:\s*hover\)/.test(at))) offenders.push(`${where} : hors de @media (hover: hover)`);
        for (const prop of rule.props) if (!HOVER_LIGHT.has(prop)) offenders.push(`${where} : ${prop}`);
      }
    }
    expect(offenders).toEqual([]);
    // Les boutons d'action portent la règle : sans elle, la garde ne garderait rien.
    expect(hovers).toBeGreaterThan(0);
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

  it('DESIGN.md décrit les micrographies du Lab et le lanceur AUBE ; le bord du desk n’annote plus rien (4.1)', () => {
    const doc = readFileSync('docs/DESIGN.md', 'utf8');
    for (const id of Object.keys(PLATES)) expect(doc, id).toContain(`\`${id}\``);
    expect(doc).toMatch(/Un seul code-barres/);
    expect(doc).toMatch(/## 10\. Lanceur AUBE/);
    expect(readFileSync('src/app/Shell.tsx', 'utf8')).not.toMatch(/DEEP TECH|RÉV\. 4/);
    expect(readFileSync('CLAUDE.md', 'utf8')).toMatch(/Système 4\.1/);
  });
});
