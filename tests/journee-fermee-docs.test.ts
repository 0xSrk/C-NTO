import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * OROS5.48c — la décision 15 de l'ADMIN (2026-11-03, « On ferme la journée une fois la limite touchée ») se lit là où on la
 * cherche : `CLAUDE.md` § 5, dans la puce « Agent », à la suite des règles du trader ; `docs/THESE-AGENTIQUE.md` § 7, à la
 * suite des décisions ; la section « Système 5 » de `docs/AUDIT.md`. Aucune garde du § 5 n'en sort affaiblie.
 */

// Sous Windows, la copie de travail peut porter des fins de ligne \r\n.
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** Le texte d'une section `## …` d'un fichier, jusqu'à la suivante. */
function section(file: string, title: string): string {
  const text = read(file);
  const start = text.indexOf(`\n${title}\n`);
  expect(start, `${file} › ${title}`).toBeGreaterThan(0);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

describe('OROS5.48c · la journée fermée, consignée', () => {
  it('CLAUDE.md § 5 : la puce « Agent » la dit à la suite des règles du trader, datée, sans rien retirer des gardes', () => {
    const s5 = section('CLAUDE.md', '## 5. Invariants de sécurité');
    const agent = s5.split('\n').find((line) => line.startsWith('- Agent : '));
    expect(agent).toBeDefined();
    const sentence = "journée CME fermée aux ouvertures dès la perte du jour atteinte et jusqu'à la journée CME suivante, même si un gain la ramène sous la limite, le process principal tenant son propre verrou, que le renderer ne peut pas lever (décision de l'ADMIN, 2026-11-03)";
    expect(agent).toContain(sentence);
    const at = agent!.indexOf(sentence);
    expect(at).toBeGreaterThan(agent!.indexOf('règles du trader — perte du jour atteinte, fenêtre de catalyseur, instrument hors liste —'));
    expect(at).toBeLessThan(agent!.indexOf('canal fermé après le kill switch'));
    // les gardes d'avant restent toutes, dans le même ordre
    const guards = ["`copy.order` n'est pas un outil d'agent", "l'agent ne soumet jamais d'ordre", 'comptes `Sim*` seulement', "limites de l'agent", 'cadence', 'marge prop datée de la jauge K.04', 'règles du trader', 'canal fermé après le kill switch', 'une réduction de risque passe toujours', 'Refuser par défaut, 45 s', "Désactivé à chaque ouverture du desk", "décisions de l'ADMIN, 2026-10-05 et 2026-10-06"];
    const positions = guards.map((g) => agent!.indexOf(g));
    for (const [i, p] of positions.entries()) expect(p, guards[i]).toBeGreaterThanOrEqual(0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('docs/THESE-AGENTIQUE.md § 7 : la décision 14, à la suite des treize autres, datée et livrée', () => {
    const s7 = section('docs/THESE-AGENTIQUE.md', "## 7. Décisions de l'ADMIN (6 octobre 2026)");
    const numbers = [...s7.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    const fourteen = s7.split('\n').find((line) => line.startsWith('14. **'))!;
    expect(fourteen).toContain('« On ferme la journée une fois la limite touchée. »');
    expect(fourteen).toContain("jusqu'à la journée CME suivante");
    expect(fourteen).toContain('une réduction de risque passe toujours');
    expect(fourteen).toContain('« journée fermée depuis hh:mm ET »');
    expect(fourteen).toContain('Livrée : OROS5.48 à OROS5.48b');
    expect(s7).toContain('Le 3 novembre 2026, l\'ADMIN a tranché la question de la perte du jour');
  });

  it('docs/AUDIT.md › Système 5 : la décision 15 entre dans la liste, ses quatre tickets dans le tableau, et ne reste plus à mener', () => {
    const s5 = section('docs/AUDIT.md', '## Système 5 « Fiche et Frise » (2026-11-01)');
    expect(s5).not.toContain('À venir, hors de ce tableau : la décision 15');
    expect(s5).not.toContain("D'ici là, la garde relit la perte nette à chaque entrée");
    const fifteen = s5.split('\n').find((line) => line.startsWith('15. **Perte du jour'))!;
    expect(fifteen).toContain('OROS5.48 à OROS5.48c');
    // la liste des décisions est d'un seul tenant, de 1 à 15
    const list = s5.slice(s5.indexOf('\n1. **Or.**'), s5.indexOf('\n\n', s5.indexOf('\n15. **')));
    expect([...list.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const row = (id: string) => s5.split('\n').find((line) => line.startsWith(`| ${id} |`));
    expect(row('OROS5.48')).toContain('`tests/journee-cme-partagee.test.ts`');
    expect(row('OROS5.48a')).toContain('`tests/journee-fermee-process.test.ts`');
    expect(row('OROS5.48b')).toContain('`tests/journee-fermee.test.ts`');
    expect(row('OROS5.48c')).toContain('`tests/journee-fermee-docs.test.ts`');
    const closing = s5.slice(s5.indexOf('**Clôture de la vague.**'));
    expect(closing).toContain('La décision 15 est menée en OROS5.48 à OROS5.48c');
    expect(closing).not.toContain('la décision 15, à mener');
  });

  it('la carte du code agentique la nomme ; aucun document ne cite de source hors du dépôt', () => {
    const brief = read('docs/BRIEF-AGENTIQUE-VAGUE-2.md');
    const orders = brief.split('\n').find((line) => line.startsWith('| Ordres proposés |'))!;
    for (const name of ['`src/engine/agent/dayClose.ts`', '`useDayClose`', '`agent.dayClose`', '`recordDayClose`', '`agent-day-close.json`', '`agent-orders:close-day`', '`cmeTradingDay`']) expect(orders, name).toContain(name);
    for (const file of ['CLAUDE.md', 'docs/THESE-AGENTIQUE.md', 'docs/AUDIT.md', 'docs/BRIEF-AGENTIQUE-VAGUE-2.md']) expect(read(file), file).not.toMatch(/DECISIONS\.md|FOLLOWUPS\.md|scratchpad/);
  });
});
