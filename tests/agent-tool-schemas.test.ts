import { describe, expect, it } from 'vitest';
import { DESK_TOOL_KINDS } from '@/engine/agent/catalog';
import { toolSchemas } from '@/engine/agent/tools';
import { PREDICATES } from '@/engine/ontology/schema';
import { callTool } from './helpers/agentEval';
import { demoDesk } from './helpers/demoDesk';

interface Prop {
  type?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  description?: string;
  items?: Prop;
}

/** Arguments réels : des prix et des montants. Tout autre nombre est un compte, donc un entier. */
const REAL_VALUED = new Set(['propose_order.limit', 'propose_order.stop', 'monte_carlo.ruinDrawdown', 'monte_carlo.target']);
/** Noms d'arguments qui comptent quelque chose (contrats, lignes, tirages, journées, minutes, niveaux). */
const COUNT_NAMES = new Set(['qty', 'limit', 'minImpact', 'runs', 'horizon', 'timeframe', 'openingRangeMinutes']);
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
/** Arguments de date connus : ils portent tous le motif. */
const DATE_ARGS = ['desk_overview.from', 'desk_overview.to', 'list_sessions.from', 'list_sessions.to', 'get_session.date', 'calendar_events.from', 'calendar_events.to', 'journal_breakdown.from', 'journal_breakdown.to', 'monte_carlo.from', 'monte_carlo.to'];

function properties(): [string, Prop][] {
  return toolSchemas().flatMap((tool) => Object.entries(((tool.parameters as { properties?: Record<string, Prop> }).properties ?? {})).map(([key, prop]) => [`${tool.name}.${key}`, prop] as [string, Prop]));
}

describe('schémas des outils : arguments typés', () => {
  it('chaque outil du catalogue a un schéma objet fermé', () => {
    const schemas = toolSchemas();
    expect(schemas.map((t) => t.name).sort()).toEqual(Object.keys(DESK_TOOL_KINDS).sort());
    for (const t of schemas) expect(t.parameters, t.name).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('aucun nombre réel hors prix et montants ; chaque compte est un entier borné', () => {
    for (const [name, prop] of properties()) {
      if (prop.type === 'number') expect(REAL_VALUED.has(name), `${name} : number`).toBe(true);
      if (COUNT_NAMES.has(name.split('.')[1]!) && !REAL_VALUED.has(name)) expect(prop.type, name).toBe('integer');
      if (prop.type === 'integer') {
        expect(typeof prop.minimum, `${name}.minimum`).toBe('number');
        if (prop.maximum !== undefined) expect(prop.maximum, name).toBeGreaterThanOrEqual(prop.minimum!);
      }
    }
  });

  it('dates : motif YYYY-MM-DD sur chaque argument de date', () => {
    const all = new Map(properties());
    const described = [...all].filter(([, p]) => p.description?.includes('YYYY-MM-DD')).map(([n]) => n);
    for (const name of new Set([...DATE_ARGS, ...described])) {
      const prop = all.get(name);
      expect(prop, name).toBeDefined();
      expect(prop?.type, name).toBe('string');
      expect(prop?.pattern, name).toBe(DATE_PATTERN);
    }
    const re = new RegExp(DATE_PATTERN);
    expect(re.test('2026-10-01')).toBe(true);
    expect(re.test('2026/10/01')).toBe(false);
    expect(re.test('next week')).toBe(false);
  });

  it('link_notes.predicate : l’énumération des prédicats connus', () => {
    const prop = new Map(properties()).get('link_notes.predicate');
    expect(prop).toMatchObject({ type: 'string', enum: [...PREDICATES] });
  });

  it('les bornes du schéma sont celles que l’outil applique', async () => {
    const all = new Map(properties());
    const desk = demoDesk();
    const runs = all.get('monte_carlo.runs')!;
    const horizon = all.get('monte_carlo.horizon')!;
    const mc = await callTool<{ runs: number; horizon: number }>(desk.ports, 'monte_carlo', { runs: runs.maximum! * 10, horizon: horizon.maximum! * 10 });
    expect(mc).toMatchObject({ runs: runs.maximum, horizon: horizon.maximum });
    const low = await callTool<{ runs: number; horizon: number }>(desk.ports, 'monte_carlo', { runs: 1, horizon: 1 });
    expect(low).toMatchObject({ runs: runs.minimum, horizon: horizon.minimum });
    const limit = all.get('list_sessions.limit')!;
    const long = demoDesk({ sessions: limit.maximum! + 60 });
    const list = await callTool<{ count: number }>(long.ports, 'list_sessions', { limit: limit.maximum! + 100 });
    expect(list.count).toBe(limit.maximum);
  });
});
