/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/modules/note/markdown';

/** DOMPurify 3.4.16 et avant : avis critiques GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2, GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f. */
const FLOOR = [3, 4, 17] as const;

const parts = (v: string) => v.replace(/^[^\d]*/, '').split('.').map((n) => Number.parseInt(n, 10));
const atLeast = (v: string) => {
  const [a = 0, b = 0, c = 0] = parts(v);
  return a !== FLOOR[0] ? a > FLOOR[0] : b !== FLOOR[1] ? b > FLOOR[1] : c >= FLOOR[2];
};

describe('CLD22 DOMPurify assainit les rapports de l’agent cloud et les notes : plancher 3.4.17', () => {
  it('déclaré, verrouillé et installé au-dessus des versions visées par les avis', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { version: string }> };
    const installed = JSON.parse(readFileSync('node_modules/dompurify/package.json', 'utf8')) as { version: string };
    expect(pkg.dependencies.dompurify, 'package.json').toSatisfy(atLeast);
    expect(lock.packages['node_modules/dompurify']?.version, 'package-lock.json').toSatisfy(atLeast);
    expect(installed.version, 'node_modules').toSatisfy(atLeast);
  });

  it('l’assainissement des rapports tient avec la nouvelle version', () => {
    const html = renderMarkdown('**gras** <script>alert(1)</script> <img src=x onerror=alert(1)> [lien](javascript:alert(1)) [ok](https://www.bls.gov/)');
    expect(html).toContain('<strong>gras</strong>');
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
    expect(html).toContain('href="https://www.bls.gov/"');
  });
});
