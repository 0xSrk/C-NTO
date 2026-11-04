import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * OROS5.46b — la relecture adverse du lot 9, de la décision 15 et de la vague entière se consigne dans la clôture de la
 * section « Système 5 » de `docs/AUDIT.md` : chaque correctif y est nommé et a sa ligne au tableau, la recette en
 * conditions réelles se lance par `--reel`, et ce qui reste à décider à l'ADMIN y est dit.
 */
const audit = readFileSync('docs/AUDIT.md', 'utf8').replace(/\r\n/g, '\n');
const start = audit.indexOf('\n## Système 5 « Fiche et Frise » (2026-11-01)\n');
const s5 = audit.slice(start, audit.indexOf('\n## ', start + 1) < 0 ? undefined : audit.indexOf('\n## ', start + 1));
const closing = s5.slice(s5.indexOf('**Clôture de la vague.**'));
const FIXES = ['OROS5.30a', 'OROS5.44a', 'OROS5.45h', 'OROS5.45j', 'OROS5.45k', 'OROS5.45l', 'OROS5.45m', 'OROS5.46a', 'OROS5.47h', 'OROS5.47i', 'OROS5.47j', 'OROS5.47k', 'OROS5.47l', 'OROS5.48e', 'OROS5.48f', 'OROS5.48g', 'OROS5.48h', 'OROS5.48i', 'OROS5.48j'];

describe('OROS5.46b · la relecture de la vague se consigne', () => {
  it('chaque correctif de la relecture a sa ligne au tableau, et la clôture les nomme', () => {
    expect(start).toBeGreaterThan(0);
    for (const id of FIXES) {
      expect(s5.split('\n').filter((line) => line.startsWith(`| ${id} |`)), id).toHaveLength(1);
    }
    expect(closing).toContain('la vague entière relus en adverse');
    expect(closing).toContain('21 constats confirmés');
    expect(closing).toContain('OROS5.30a, OROS5.44a, OROS5.45h à OROS5.45m, OROS5.46a, OROS5.47h à OROS5.47l, OROS5.48e à OROS5.48j');
  });

  it('la recette réelle se lance par --reel ; la date d’une fermeture née d’une limite abaissée reste à décider', () => {
    expect(closing).toContain('`scripts/capture-oros5.mjs --reel`');
    expect(closing).not.toContain('sans `--data`, qui s\'y lance sans modification');
    expect(closing).toMatch(/limite abaissée en cours de journée/);
    expect(closing).toMatch(/décision 15 ne dit pas/);
  });
});
