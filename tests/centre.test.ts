import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

/** Un centre jetable, hors du dépôt. */
function centre() {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'canto-centre-')), 'centre');
  dirs.push(path.dirname(dir));
  const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/centre.mjs', ...args], { encoding: 'utf8', env: { ...process.env, CANTO_CENTRE: dir } });
  return { dir, run };
}

describe('LAB1 centre de contrôle du Lab : privé, sans secret, sans se marcher dessus', () => {
  it('init pose les dossiers et les gabarits, sans jamais rien écraser ; jamais dans le dépôt', () => {
    const { dir, run } = centre();
    expect(run('init').status).toBe(0);
    for (const sub of ['verrous', 'boites/claude', 'boites/hermes', 'boites/admin', 'journal', 'archives']) expect(existsSync(path.join(dir, sub)), sub).toBe(true);
    for (const file of ['LISEZMOI.md', 'etat.md', 'priorites.md', 'critique.md']) expect(existsSync(path.join(dir, file)), file).toBe(true);
    writeFileSync(path.join(dir, 'etat.md'), 'tenu à la main');
    expect(run('init').status).toBe(0);
    expect(readFileSync(path.join(dir, 'etat.md'), 'utf8')).toBe('tenu à la main');
    const inside = spawnSync(process.execPath, ['scripts/centre.mjs', 'init'], { encoding: 'utf8', env: { ...process.env, CANTO_CENTRE: path.resolve('centre-dans-le-depot') } });
    expect(inside.status).not.toBe(0);
    expect(inside.stderr).toContain('jamais dans le dépôt');
    expect(existsSync(path.resolve('centre-dans-le-depot'))).toBe(false);
  });

  it('un verrou par zone : posé une fois, refusé aux autres, prolongé par son agent, libéré par lui ou l’admin', () => {
    const { dir, run } = centre();
    run('init');
    expect(run('verrou', 'agent-cloud', '--agent', 'claude', '--motif', 'mise à jour de l’agent').status).toBe(0);
    const other = run('verrou', 'agent-cloud', '--agent', 'hermes');
    expect(other.status).not.toBe(0);
    expect(other.stderr).toMatch(/tenu par claude/);
    expect(run('verrou', 'agent-cloud', '--agent', 'claude').stdout).toMatch(/prolongé/);
    expect(run('libere', 'agent-cloud', '--agent', 'hermes').status).not.toBe(0);
    expect(run('libere', 'agent-cloud', '--agent', 'claude').status).toBe(0);
    expect(run('verrou', 'agent-cloud', '--agent', 'hermes').status).toBe(0);
    expect(run('libere', 'agent-cloud', '--agent', 'admin').status).toBe(0);
    expect(readdirSync(path.join(dir, 'verrous'))).toEqual([]);
    expect(run('verrou', '../cles', '--agent', 'claude').status).not.toBe(0);
    expect(run('verrou', 'cles', '--agent', 'inconnu').status).not.toBe(0);
  });

  it('un verrou périmé ne se reprend qu’explicitement', () => {
    const { dir, run } = centre();
    run('init');
    writeFileSync(path.join(dir, 'verrous', 'release.verrou'), JSON.stringify({ zone: 'release', agent: 'hermes', depuis: '2026-10-25T08:00:00Z', expire: '2026-10-25T12:00:00Z', motif: '' }));
    const refused = run('verrou', 'release', '--agent', 'claude');
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/périmé/);
    expect(run('etat').stdout).toMatch(/release · hermes · PÉRIMÉ/);
    const taken = run('verrou', 'release', '--agent', 'claude', '--reprendre');
    expect(taken.status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, 'verrous', 'release.verrou'), 'utf8')).agent).toBe('claude');
  });

  it('aucun secret n’entre : clé d’API, ligne de siège, clé privée, jeton, mot de passe ; la prose et les empreintes passent', () => {
    const { dir, run } = centre();
    run('init');
    const secrets = [
      'clé sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123',
      'SIEGE1.eyJhcnRlZmFjdCI6IjAwMiJ9.c2lnbmF0dXJl',
      '-----BEGIN PRIVATE KEY----- MC4CAQAwBQ',
      'ghp_0123456789abcdefghijABCDEFGHIJ',
      'mdp : x7!hunter2',
      'code de déverrouillage = Zq8rT1wX',
      'Zr4kQ9pLm2Xv7Tn1Bc8Wy5Hd3Gf6Js0AeK',
    ];
    for (const secret of secrets) {
      const sent = run('message', '--de', 'claude', '--pour', 'hermes', '--sujet', 'essai', '--corps', secret);
      expect(sent.status, secret).not.toBe(0);
      expect(sent.stderr).toMatch(/ressemble à un secret/);
      expect(run('journal', '--agent', 'claude', '--zone', 'cles', '--action', secret).status, secret).not.toBe(0);
    }
    expect(readdirSync(path.join(dir, 'boites', 'hermes'))).toEqual([]);
    const fine = run('message', '--de', 'claude', '--pour', 'hermes', '--priorite', 'P1', '--sujet', 'Agent cloud à mettre à jour', '--corps', 'Le jeton : renouvelé. PR #125, commit 71cec0e5d2a1f0c9b8e7d6a5f4e3d2c1b0a9f8e7, la ligne de siège est dans ~/.canto/.');
    expect(fine.status, fine.stderr).toBe(0);
    expect(readdirSync(path.join(dir, 'boites', 'hermes'))).toHaveLength(1);
  });

  it('boîtes et journal : un message lisible par son destinataire, traité vers les archives ; un journal par jour, en ajout seul', () => {
    const { dir, run } = centre();
    run('init');
    run('message', '--de', 'hermes', '--pour', 'claude', '--priorite', 'P0', '--sujet', 'Siège de Filou émis', '--corps', 'Code envoyé par l’ADMIN.');
    const box = run('boite', 'claude');
    expect(box.stdout).toMatch(/^P0 · hermes · Siège de Filou émis · \d{8}-\d{6}-hermes-siege-de-filou-emis\.md$/m);
    const name = readdirSync(path.join(dir, 'boites', 'claude'))[0]!;
    expect(readFileSync(path.join(dir, 'boites', 'claude', name), 'utf8')).toMatch(/^---\nde: hermes\npour: claude\ndate: \S+\npriorite: P0\nsujet: Siège de Filou émis\netat: ouvert\n---/);
    expect(run('boite', 'claude', '--traite', '../etat.md').status).not.toBe(0);
    expect(run('boite', 'claude', '--traite', name).status).toBe(0);
    expect(existsSync(path.join(dir, 'archives', 'claude', name))).toBe(true);
    expect(run('boite', 'claude').stdout).toMatch(/vide/);
    run('journal', '--agent', 'claude', '--zone', 'agent-cloud', '--action', 'agent mis à jour', '--resultat', 'v2, en pause', '--lien', 'PR #125');
    run('journal', '--agent', 'hermes', '--zone', 'sieges', '--action', 'siège émis');
    const days = readdirSync(path.join(dir, 'journal'));
    expect(days).toHaveLength(1);
    const lines = readFileSync(path.join(dir, 'journal', days[0]!), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- \d{2}:\d{2}:\d{2}Z · claude · agent-cloud · agent mis à jour → v2, en pause \(PR #125\)$/);
  });
});
