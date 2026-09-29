import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEXT = new Set(['.ts', '.tsx', '.css', '.html', '.js', '.mjs', '.cjs', '.svg']);

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
      const rel = relative('src', path);
      if (rel === 'app/shell.module.css') continue;
      const text = readFileSync(path, 'utf8');
      if (color.test(text)) offenders.push(rel);
      color.lastIndex = 0;
    }
    expect(offenders).toEqual([]);
    const lab = walk('src/modules').filter((path) => readFileSync(path, 'utf8').includes('--lab'));
    expect(lab).toEqual([]);
  });
});
