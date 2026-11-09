import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * SEC2.6 — les workflows ne font confiance qu'à ce qu'ils nomment. Trois défauts de l'audit du 9 novembre :
 * - les actions étaient épinglées par tag (`@v4`) : un tag se déplace, et le code d'un tiers tournait alors dans la CI
 *   et dans la construction des installeurs sans qu'aucun commit du dépôt ne change ;
 * - le run de publication portait `contents: write` pour tous ses jobs, et la CI aucune borne ;
 * - `actions/checkout` laissait le jeton du run dans le dépôt cloné pendant `npm ci`, qui exécute les scripts
 *   d'installation de chaque dépendance : dans le job qui construit les installeurs, ce jeton peut écrire.
 */

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const workflows = { ci: read('.github/workflows/ci.yml'), release: read('.github/workflows/release.yml') };

/** Les jobs d'un workflow : nom → texte, de son en-tête au job suivant. */
function jobs(workflow: string): Map<string, string> {
  const body = workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const out = new Map<string, string>();
  const heads = [...body.matchAll(/^ {2}([A-Za-z_][\w-]*):\n/gm)];
  heads.forEach((head, i) => out.set(head[1] ?? '', body.slice(head.index, heads[i + 1]?.index ?? body.length)));
  return out;
}

/** Les étapes d'un job, chacune de son tiret à la suivante. */
function steps(job: string): string[] {
  const at = job.indexOf('\n    steps:\n');
  return at < 0 ? [] : job.slice(at + '\n    steps:\n'.length).split(/\n(?= {6}- )/);
}

/** Le bloc `permissions` d'un job : ses lignes, sans l'indentation. */
function jobPermissions(job: string): string[] | null {
  const block = /\n {4}permissions:\n((?: {6}[^\n]+\n)+)/.exec(job)?.[1];
  return block ? block.trimEnd().split('\n').map((line) => line.trim()) : null;
}

describe('SEC2.6 workflows : actions épinglées, permissions réduites, jeton hors du dépôt cloné', () => {
  it('les deux workflows se découpent comme attendu', () => {
    expect([...jobs(workflows.ci).keys()]).toEqual(['check', 'dist']);
    expect([...jobs(workflows.release).keys()]).toEqual(['prepare', 'build', 'publish']);
    expect(steps(jobs(workflows.ci).get('check') ?? '').length).toBeGreaterThanOrEqual(7);
  });

  it('chaque action est épinglée par une empreinte complète, sa version en commentaire', () => {
    for (const [name, workflow] of Object.entries(workflows)) {
      const uses = [...workflow.matchAll(/^\s*(?:- )?uses: (.+)$/gm)].map((m) => m[1]);
      expect(uses.length, name).toBeGreaterThanOrEqual(name === 'ci' ? 5 : 3);
      for (const ref of uses) expect(ref, `${name} : ${ref}`).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      expect(workflow, name).not.toMatch(/uses: [^\n]*@(?:v\d|main|master)/);
    }
    // Une action, une empreinte : la CI et la publication construisent avec le même code.
    const pins = new Map<string, Set<string>>();
    for (const workflow of Object.values(workflows)) {
      for (const [, action = '', sha = ''] of workflow.matchAll(/uses: (actions\/[a-z-]+)@([0-9a-f]{40})/g)) pins.set(action, (pins.get(action) ?? new Set()).add(sha));
    }
    expect([...pins.keys()].sort()).toEqual(['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']);
    for (const [action, shas] of pins) expect(shas.size, action).toBe(1);
  });

  it('lecture seule par défaut ; seuls les jobs qui écrivent dans le brouillon de la Release peuvent écrire', () => {
    for (const [name, workflow] of Object.entries(workflows)) {
      expect(workflow, name).toMatch(/^permissions:\n {2}contents: read\n(?! )/m);
      expect([...workflow.matchAll(/^permissions:/gm)], name).toHaveLength(1);
    }
    for (const [name, job] of jobs(workflows.ci)) expect(jobPermissions(job), name).toBeNull();
    for (const [name, job] of jobs(workflows.release)) {
      const writes = /gh release (?:create|upload)\b/.test(job);
      // Un job n'a le droit d'écrire que s'il écrit, et ce droit ne porte que sur le contenu du dépôt.
      expect(jobPermissions(job), name).toEqual(writes ? ['contents: write'] : null);
    }
    // Les trois jobs de la publication écrivent tous dans le brouillon : la construction y téléverse ses installeurs.
    expect([...jobs(workflows.release)].filter(([, job]) => jobPermissions(job)).map(([name]) => name)).toEqual(['prepare', 'build', 'publish']);
    expect(Object.values(workflows).join('\n')).not.toMatch(/write-all|permissions: write/);
  });

  it('là où `npm ci` tourne, le jeton du run ne reste pas dans le dépôt cloné', () => {
    let installs = 0;
    for (const [name, workflow] of Object.entries(workflows)) {
      for (const [jobName, job] of jobs(workflow)) {
        const list = steps(job);
        const install = list.findIndex((step) => /^ {6}- run: npm ci$/m.test(step));
        const checkout = list.findIndex((step) => /uses: actions\/checkout@/.test(step));
        if (install < 0) continue;
        installs += 1;
        expect(checkout, `${name}.${jobName}`).toBeGreaterThan(-1);
        expect(checkout, `${name}.${jobName}`).toBeLessThan(install);
        expect(list[checkout], `${name}.${jobName}`).toMatch(/\n {8}with:\n(?: {10}#[^\n]*\n)* {10}persist-credentials: false(?:\n|$)/);
      }
    }
    expect(installs).toBe(3);
    // Le job `prepare` garde le jeton pour `git ls-remote` : il n'installe aucune dépendance et ne lance que les scripts du dépôt.
    const prepare = (jobs(workflows.release).get('prepare') ?? '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(prepare).toContain('git ls-remote --exit-code --tags origin');
    expect(prepare).not.toMatch(/npm (?:ci|install|run|exec)|npx /);
    for (const run of [...prepare.matchAll(/\bnode ([^\n"]+)/g)].map((m) => m[1])) expect(run).toMatch(/^(?:-p |scripts\/release-notes\.mjs)/);
    // `publish` ne clone rien : il n'a que `gh`.
    expect(jobs(workflows.release).get('publish')).not.toMatch(/uses:/);
  });
});
