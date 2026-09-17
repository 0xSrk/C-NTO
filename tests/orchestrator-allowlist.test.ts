import { describe, expect, it } from 'vitest';
import { orchMethodAllowed, ORCH_READ_METHODS, ORCH_WRITE_METHODS } from '@/engine/agent/ports';
import { orchMethodAllowed as orchMain } from '../electron/orchestrator';

describe('orchestrator allowlist extraite', () => {
  it('écritures hors allowlist → rejet (équivalent -32601)', () => {
    expect(orchMethodAllowed('create_note', false)).toBe(false);
    expect(orchMain('create_note', false)).toBe(false);
    expect(orchMethodAllowed('annotate_session', false)).toBe(false);
    expect(orchMain('copy.order', false)).toBe(false);
  });

  it('lectures typiques autorisées', () => {
    for (const m of ORCH_READ_METHODS) {
      expect(orchMethodAllowed(m, false)).toBe(true);
      expect(orchMain(m, false)).toBe(true);
    }
  });

  it('écritures seulement si allowWrites', () => {
    for (const m of ORCH_WRITE_METHODS) {
      expect(orchMethodAllowed(m, true)).toBe(true);
      expect(orchMain(m, true)).toBe(true);
      expect(orchMethodAllowed(m, false)).toBe(false);
    }
  });
});
