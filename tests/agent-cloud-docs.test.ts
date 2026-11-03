import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEMORY_STORE_NAME } from '../electron/agent-cloud-definition';
import { coordinatorAgentBody, FORMATION_BUDGET_CENTS, FORMATION_DOMAINS } from '../electron/agent-cloud-formation';

/** Le texte d'une section `## …` d'un fichier, jusqu'à la suivante. */
function section(file: string, title: string): string {
  const text = readFileSync(file, 'utf8').split(/\r?\n/).join('\n');
  const start = text.indexOf(`\n${title}\n`);
  expect(start, `${file} › ${title}`).toBeGreaterThan(0);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

const cap = `${(FORMATION_BUDGET_CENTS / 100).toFixed(2).replace('.', ',')} $`;

describe('agent cloud · formation quant, documentation', () => {
  it('CLD49 la formation est consignée là où on la cherche', () => {
    // CLAUDE.md § 5 : l'invariant de l'agent cloud s'étend à la formation, sur décision écrite de l'ADMIN, sans rien retirer.
    const s5 = section('CLAUDE.md', '## 5. Invariants de sécurité');
    const cloud = s5.split('\n').find((line) => line.startsWith('- Agent cloud (Managed Agents)'));
    expect(cloud).toBeDefined();
    expect(cloud).toContain('relève sortante seule, vers `api.anthropic.com` seul, sans redirection');
    expect(cloud).toContain("l'agent n'a ni outil du desk ni outil d'ordre");
    const sentence = cloud!.slice(cloud!.indexOf('La formation quant'));
    for (const words of ['décision de l\'ADMIN, 2026-11-03', 'seul siège du Lab', 'Annuler par défaut', 'quantmemo.com', 'lecture seule', 'le desk n\'écrit rien dans ce magasin', 'jamais une consigne', 'un accès refusé par le site arrête la formation'])
      expect(sentence, words).toContain(words);
    expect(section('CLAUDE.md', '## 6. Où consigner')).toContain('formation quant');

    // docs/AGENT-CLOUD.md : le magasin, les domaines, le plafond tirés du code ; les workflows coupés, et comment les rallumer.
    const doc = readFileSync('docs/AGENT-CLOUD.md', 'utf8');
    const training = section('docs/AGENT-CLOUD.md', '## 9. Formation quant');
    expect(doc).toContain('CLD1 à CLD49');
    expect(training).toContain(MEMORY_STORE_NAME);
    for (const domain of FORMATION_DOMAINS) {
      expect(training).toContain(domain);
      expect(training).toContain(`*.${domain}`);
    }
    expect(training).toContain(`Plafond de la session : ${cap}`);
    expect(training).toContain('Workflows coupés');
    expect(doc).not.toMatch(/workflows (sont |restent )?(allumés|actifs|activés)/i);
    expect((coordinatorAgentBody('fr', 'agent_011CZkYpogX7uDKUyvBToREA', false).multiagent as { workflows: unknown }).workflows).toEqual({ type: 'disabled' });
    expect(training).toContain('electron/agent-cloud-formation.ts');
    expect(section('docs/AGENT-CLOUD.md', '## 8. Fichiers')).toContain('electron/agent-cloud-formation.ts');

    // La thèse : la décision 13, datée, après la douzième.
    const these = readFileSync('docs/THESE-AGENTIQUE.md', 'utf8');
    const d13 = these.indexOf("13. **Formation quant de l'agent cloud : oui, sur quantmemo.com.**");
    expect(d13).toBeGreaterThan(these.indexOf('12. **Rapports du Lab'));
    expect(these.slice(d13, these.indexOf('\n', d13))).toContain('Livrée : CLD36 à CLD49.');
    expect(these).toContain("Le 3 novembre 2026, l'ADMIN a demandé la formation quant de l'agent cloud");

    // L'audit : une ligne par ticket, de CLD36 à CLD49, dans la section de la formation (LAB7 vérifie qu'aucun n'est doublé).
    const audit = section('docs/AUDIT.md', '## Agent cloud — formation quant (2026-11-03)');
    const rows = audit.split('\n').filter((line) => /^\| (CLD|LAB)\d+ \|/.test(line)).map((line) => line.split('|')[1]!.trim());
    expect(rows).toEqual(['LAB7', ...Array.from({ length: 14 }, (_, i) => `CLD${36 + i}`)]);
    for (const heading of ['**Décisions tranchées.**', '**Vérifications.**', '**Non vérifié.**', "**Recette de l'ADMIN, desk lancé.**"]) expect(audit, heading).toContain(heading);
  });
});
