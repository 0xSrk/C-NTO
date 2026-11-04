import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Les citations du tableau « Système 5 » de `docs/AUDIT.md`, lues selon sa convention (OROS5.36c) : un `fichier:ligne`
 * nomme un fichier, un `:N` nu continue le dernier fichier nommé de la ligne. Chaque correctif de citation éprouve que la
 * ligne qu'il corrige mène désormais au fichier qu'elle décrit.
 */
const audit = readFileSync('docs/AUDIT.md', 'utf8').replace(/\r\n/g, '\n');

/** Les citations d'une ligne du tableau, dans l'ordre, chacune résolue en `fichier:ligne`. */
function cited(id: string): string[] {
  const row = audit.split('\n').find((line) => line.startsWith(`| ${id} |`));
  expect(row, id).toBeDefined();
  const out: string[] = [];
  let file = '';
  for (const [, code] of row!.matchAll(/`([^`]+)`/g)) {
    const named = /^([\w./-]+\.[a-z]+):(\d+)$/.exec(code!);
    if (named) {
      file = named[1]!;
      out.push(`${file}:${named[2]}`);
      continue;
    }
    const bare = /^:(\d+)$/.exec(code!);
    if (bare) out.push(`${file}:${bare[1]}`);
  }
  return out;
}

describe('OROS5.47p · la ligne d’OROS5.47l cite la feuille de A.04', () => {
  it('les cellules qui passent à la ligne sous 700 px sont citées dans dashboard.module.css, et non dans Dashboard.tsx', () => {
    const lines = cited('OROS5.47l');
    expect(lines).toEqual(expect.arrayContaining(['src/modules/metrique/dashboard.module.css:508', 'src/modules/metrique/Dashboard.tsx:523', 'src/modules/metrique/dashboard.module.css:827', 'src/modules/metrique/dashboard.module.css:830']));
    expect(lines.filter((line) => /Dashboard\.tsx:8\d\d$/.test(line))).toEqual([]);
  });
});

describe('OROS5.47q · la ligne d’OROS5.47k cite la feuille de la légende de Visual', () => {
  it('.legendMain et .stamp sont cités dans visual.module.css, et non dans Visual.tsx', () => {
    const lines = cited('OROS5.47k');
    expect(lines).toEqual(expect.arrayContaining(['src/modules/visual/visual.module.css:29', 'src/modules/visual/Visual.tsx:225', 'src/modules/visual/visual.module.css:52', 'src/modules/visual/visual.module.css:217']));
    expect(lines.filter((line) => /Visual\.tsx:(52|217)$/.test(line))).toEqual([]);
  });
});
