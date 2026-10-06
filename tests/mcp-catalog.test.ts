import { describe, expect, it } from 'vitest';
import { DESK_TOOL_HINTS, DESK_TOOL_KINDS, DESK_TOOL_TITLES } from '@/engine/agent/catalog';

const names = Object.keys(DESK_TOOL_KINDS) as (keyof typeof DESK_TOOL_KINDS)[];

describe('catalogue · indications d’outil', () => {
  it('chaque outil du catalogue a ses indications, et rien d’autre', () => {
    expect(Object.keys(DESK_TOOL_HINTS ?? {}).sort()).toEqual([...names].sort());
  });

  it('lecture : readOnly et idempotente ; écriture : jamais readOnly', () => {
    for (const name of names) {
      const hints = DESK_TOOL_HINTS[name];
      expect(hints.readOnly, name).toBe(DESK_TOOL_KINDS[name] === 'read');
      if (DESK_TOOL_KINDS[name] === 'read') expect(hints, name).toEqual({ readOnly: true, destructive: false, idempotent: true, openWorld: false });
    }
  });

  it('annotate_session remplace (destructif, idempotent) ; propose_order agit hors du desk', () => {
    expect(DESK_TOOL_HINTS.annotate_session).toEqual({ readOnly: false, destructive: true, idempotent: true, openWorld: false });
    expect(DESK_TOOL_HINTS.propose_order).toEqual({ readOnly: false, destructive: true, idempotent: false, openWorld: true });
    expect(DESK_TOOL_HINTS.create_note).toEqual({ readOnly: false, destructive: false, idempotent: false, openWorld: false });
  });
});

describe('catalogue · titres d’outil', () => {
  it('chaque outil du catalogue a un titre en français, anglais et espagnol, et rien d’autre', () => {
    expect(Object.keys(DESK_TOOL_TITLES ?? {}).sort()).toEqual([...names].sort());
    for (const name of names) {
      const titles = DESK_TOOL_TITLES[name];
      expect(titles, name).toHaveLength(3);
      for (const t of titles) expect(t.trim().length, name).toBeGreaterThan(2);
      expect(new Set(titles).size, `${name} : titres traduits`).toBeGreaterThan(1);
    }
  });
});
