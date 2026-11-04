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

  it('la recette réelle se lance par --reel ; la date d’une fermeture née d’une limite abaissée est une lecture gardée (OROS5.46c)', () => {
    expect(closing).toContain('`scripts/capture-oros5.mjs --reel`');
    expect(closing).not.toContain('sans `--data`, qui s\'y lance sans modification');
    expect(closing).toMatch(/limite abaissée en cours de journée/);
    expect(closing).toMatch(/décision 15 ne dit pas/);
  });

  it('OROS5.46c les deux derniers tours, les lectures gardées et le contrôle croisé de la 3.9.0 se consignent', () => {
    for (const id of ['OROS5.30b', 'OROS5.45n', 'OROS5.45o', 'OROS5.47m', 'OROS5.47q', 'OROS5.48k', 'OROS5.48t', 'OROS5.48u', 'OROS5.46c']) {
      expect(s5.split('\n').filter((line) => line.startsWith(`| ${id} |`)), id).toHaveLength(1);
    }
    expect(closing).toContain('un second tour sur ces correctifs (18 constats confirmés');
    expect(closing).toContain('sans constat confirmé');
    // les deux questions de l'ADMIN ne restent plus « à décider » : gardées, chacune tenue par un test (CLAUDE.md § 2.5)
    const kept = closing.slice(closing.indexOf('Gardés tels que le code les lit'), closing.indexOf('Relevés en cours de vague'));
    expect(kept).toContain('CLAUDE.md § 2.5');
    expect(kept).toContain('`tests/journee-fermee-limite.test.ts` (OROS5.48u)');
    expect(kept).toContain('`tests/a02-cursor.test.ts` (OROS5.36a');
    expect(closing.slice(0, closing.indexOf('Gardés tels que le code les lit'))).not.toMatch(/limite abaissée en cours de journée/);
    expect(closing).toContain('antérieur à la vague (A5)');
    const pub = audit.slice(audit.indexOf('\n## Publication de la 3.9.0 (2026-11-04)\n'), start);
    expect(pub).toContain('**Publication et contrôle croisé (2026-11-04).**');
    expect(pub).toContain('`verifyReleaseSignature`');
    expect(pub).toContain('Aucun écart.');
  });
});
