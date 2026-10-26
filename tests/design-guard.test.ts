import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

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
});
