import { afterEach, describe, expect, it } from 'vitest';
import { DESK_TOOLS, toolSchemas } from '@/engine/agent/tools';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import { MEMORY_CHARS_CLOUD, memoryDigest, traderMemory } from '@/engine/agent/memory';
import type { DeskNote } from '@/engine/agent/ports';
import { executeDeskTool } from '@/engine/agent/runner';
import { useI18n } from '@/i18n';
import { prepareVaultRestore } from '@/store/db';
import { fakePorts } from './helpers/deskPorts';

const lesson = (id: string, adoptedAt?: number): DeskNote => ({
  id,
  title: `Leçon ${id}`,
  body: 'Je coupe après deux pertes. #leçon',
  tags: ['leçon'],
  updatedAt: Date.UTC(2026, 9, 6),
  by: 'agent',
  ...(adoptedAt !== undefined ? { adoptedAt } : {}),
});

describe('A15.1 adopter une leçon', () => {
  it('coffre ancien lisible, adoptedAt non numérique retiré (A15.4 : la note reste), leçon adoptée seule en mémoire, aucun outil ne la pose', async () => {
    const old = prepareVaultRestore(JSON.stringify({ artefact: 'CΛNTO', sessions: [], notes: [{ id: 'old', title: 'T', body: 'b', tags: [], updatedAt: 1 }] }));
    expect(old.notes.map((n) => n.id)).toEqual(['old']);
    const bad = prepareVaultRestore(
      JSON.stringify({
        artefact: 'CΛNTO',
        sessions: [],
        notes: [
          { id: 'bad', title: 'T', body: 'b', tags: [], updatedAt: 1, adoptedAt: 'demain' },
          { id: 'ok', title: 'T', body: 'b', tags: [], updatedAt: 1, adoptedAt: 50, by: 'agent' },
        ],
      }),
    );
    expect(bad.notes.map((n) => n.id)).toEqual(['bad', 'ok']);
    expect(bad.notes[0]).not.toHaveProperty('adoptedAt');
    expect(bad.notes[1]?.adoptedAt).toBe(50);
    expect(bad.skipped.notes).toBeUndefined();

    const adopted = lesson('a1', Date.UTC(2026, 9, 7));
    const loose = lesson('a2');
    const memory = traderMemory({ rules: DEFAULT_TRADER_RULES, plan: null, planAccount: '', notes: [adopted, loose] });
    expect(memory.lessons.map((n) => n.id)).toEqual(['a1']);
    expect(memory.excludedAgentNotes).toBe(1);

    const seen: unknown[][] = [];
    await executeDeskTool(
      fakePorts({
        createNote: async (...args) => {
          seen.push(args);
          return { id: 'n', title: String(args[0]) };
        },
      }),
      'create_note',
      { title: 'Leçon', body: 'texte #leçon', tags: ['leçon'], adoptedAt: 123 },
      { source: 'llm', confirmFn: async () => true },
    );
    expect(seen).toEqual([['Leçon', 'texte #leçon', ['leçon']]]);
    // Aucun paramètre d'outil ne porte ce nom (la description de trader_memory le cite comme champ rendu).
    expect(JSON.stringify(DESK_TOOLS.map((t) => t.parameters))).not.toContain('adoptedAt');
  });
});

describe('A15.4 restauration d’un adoptedAt invalide', () => {
  it('le champ est retiré et la note gardée ; un adoptedAt valide passe ; une clé __proto__ écarte toujours la note', () => {
    const row = (id: string, extra: string) => `{"id":"${id}","title":"${id}","body":"b #leçon","tags":["leçon"],"updatedAt":1,"by":"agent"${extra}}`;
    // Écrit à la main : JSON.stringify ne sait pas produire 1e999 (Infinity à la lecture) ni une clé __proto__ propre.
    const json = `{"artefact":"CΛNTO","sessions":[],"notes":[${[
      row('texte', ',"adoptedAt":"demain"'),
      row('nul', ',"adoptedAt":null'),
      row('infini', ',"adoptedAt":1e999'),
      row('objet', ',"adoptedAt":{"at":1}'),
      row('valide', ',"adoptedAt":50'),
      row('proto', ',"adoptedAt":"x","__proto__":{"polluted":true}'),
    ].join(',')}]}`;
    const restored = prepareVaultRestore(json);
    expect(restored.notes.map((n) => n.id)).toEqual(['texte', 'nul', 'infini', 'objet', 'valide']);
    for (const n of restored.notes.slice(0, 4)) expect(Object.prototype.hasOwnProperty.call(n, 'adoptedAt'), n.id).toBe(false);
    expect(restored.notes[4]?.adoptedAt).toBe(50);
    expect(restored.notes.every((n) => n.by === 'agent' && n.body === 'b #leçon')).toBe(true);
    // Seule la note à clé __proto__ est comptée écartée, comme avant.
    expect(restored.skipped.notes).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // Sans adoption lisible, la leçon d'agent reste hors de la mémoire.
    const memory = traderMemory({ rules: DEFAULT_TRADER_RULES, plan: null, planAccount: '', notes: restored.notes });
    expect(memory.lessons.map((n) => n.id)).toEqual(['valide']);
    expect(memory.excludedAgentNotes).toBe(4);
  });
});

describe('A15.3 provenance d’une note d’agent adoptée', () => {
  afterEach(() => useI18n.setState({ locale: 'fr' }));

  const ADOPTED_AT = Date.UTC(2026, 9, 7, 9, 30);
  const mine: DeskNote = { id: 't1', title: 'Pas de revanche', body: 'Je me lève dix minutes. #leçon', tags: ['leçon'], updatedAt: Date.UTC(2026, 9, 5) };
  const notes = [mine, lesson('a1', ADOPTED_AT), lesson('a2')];

  it('la mémoire, trader_memory et la consigne gardent by: agent et adoptedAt, « adoptée par le trader »', async () => {
    const memory = traderMemory({ rules: DEFAULT_TRADER_RULES, plan: null, planAccount: '', notes });
    expect(memory.lessons.map((n) => [n.id, n.by, n.adoptedAt])).toEqual([
      ['a1', 'agent', ADOPTED_AT],
      ['t1', 'trader', undefined],
    ]);
    expect(memory.lessons[1]).not.toHaveProperty('adoptedAt');
    expect(memory.excludedAgentNotes).toBe(1);

    const out = (await executeDeskTool(fakePorts({ notes: () => notes }), 'trader_memory', {}, { source: 'llm' })) as { lessons: Record<string, unknown>[]; excludedAgentNotes: number };
    expect(out.lessons[0]).toMatchObject({ id: 'a1', by: 'agent', adoptedAt: new Date(ADOPTED_AT).toISOString() });
    expect(out.lessons[1]).toMatchObject({ id: 't1', by: 'trader' });
    expect(out.lessons[1]).not.toHaveProperty('adoptedAt');
    expect(out.excludedAgentNotes).toBe(1);

    const said = { fr: 'adoptée par le trader', en: 'adopted by the trader', es: 'adoptada por el trader' } as const;
    const former = { fr: 'Les notes écrites par un agent n’y entrent pas', en: 'Notes written by an agent are left out', es: 'Las notas escritas por un agente no entran' } as const;
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      // Consigne : la ligne de la note adoptée dit sa provenance et la date d'adoption ; celle du trader non.
      const lines = memoryDigest(memory, MEMORY_CHARS_CLOUD).split('\n');
      const adoptedLine = lines.find((l) => l.includes('Leçon a1')) ?? '';
      expect(adoptedLine, locale).toContain(said[locale]);
      expect(adoptedLine, locale).toContain('2026-10-07');
      expect(lines.find((l) => l.includes('Pas de revanche')), locale).not.toContain(said[locale]);
      expect(lines[0], locale).toMatch(/adopt/);
      // Description de l'outil : plus « aucune note d'agent », mais l'adoption par le trader.
      const description = toolSchemas().find((t) => t.name === 'trader_memory')!.description;
      expect(description, locale).not.toContain(former[locale]);
      expect(description, locale).toContain(said[locale]);
      expect(description, locale).toContain('adoptedAt');
    }
  });
});
