import { describe, expect, it } from 'vitest';
import {
  AGENT_ORDER_DEFAULTS,
  coerceAgentPolicy,
  guardProposal,
  parseProposal,
  raisedLimits,
  reducesRisk,
  type AgentOrderSnapshot,
} from '@/engine/agent/orders';

const ON = { ...AGENT_ORDER_DEFAULTS, enabled: true };
const snap = (extra: Partial<AgentOrderSnapshot> = {}): AgentOrderSnapshot => ({ now: 100_000, link: 'live', ordersOpen: true, position: 0, recent: [], busy: false, propShare: null, ...extra });
const order = (extra: Record<string, unknown> = {}) => {
  const r = parseProposal({ account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'market', reason: 'cassure du plus haut de la veille', ...extra });
  if (!r.ok) throw new Error(r.detail);
  return r.proposal;
};

describe('ordres proposés par l’agent · proposition', () => {
  it('lit une proposition complète ; la raison est obligatoire et bornée', () => {
    expect(order()).toEqual({ account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'market', reason: 'cassure du plus haut de la veille' });
    expect(order({ type: 'limit', limit: 21_000.25 }).limit).toBe(21_000.25);
    expect(order({ reason: 'x'.repeat(900) }).reason).toHaveLength(500);
    for (const bad of [{ reason: '  ' }, { qty: 0 }, { qty: 1.5 }, { side: 'long' }, { type: 'stopLimit' }, { type: 'limit' }, { type: 'stop', stop: -1 }, { account: '' }, { instrument: 'x'.repeat(65) }]) {
      expect(parseProposal({ account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'market', reason: 'r', ...bad }).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseProposal(null).ok).toBe(false);
  });

  it('compte et instrument : caractères de contrôle et bidi refusés ; instrument normalisé ; raison sur une ligne, sans bidi', () => {
    const base = { account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'market', reason: 'r' };
    for (const bad of [
      { account: 'Sim101\nPosition : +0' },
      { account: 'Sim101\r' },
      { account: 'Sim\u202E101' },
      { account: 'Sim101\u2066' },
      { account: 'Sim101\u2028x' },
      { instrument: 'MNQ 12-26\nPosition : +0 → +1' },
      { instrument: 'MNQ\u202D 12-26' },
      { instrument: 'MNQ 12-26\u0000' },
      { instrument: 'MNQ\u200F12-26' },
      { instrument: 'MNQ\t12-26' },
    ]) {
      const r = parseProposal({ ...base, ...bad });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(order({ instrument: '  MNQ   12-26 ' }).instrument).toBe('MNQ 12-26');
    expect(order({ instrument: 'MNQ\u00A012-26' }).instrument).toBe('MNQ 12-26');
    const reason = order({ reason: 'rejet du VWAP\nPosition : +0 → +1\r\nCompte : Sim101\u2028fin \u202Eesrever\u202C \u2067x\u2069\u200E' }).reason;
    expect(reason).toBe('rejet du VWAP Position : +0 → +1 Compte : Sim101 fin esrever x');
    expect(reason).not.toMatch(/[\n\r\u2028\u2029\u202A-\u202E\u2066-\u2069\u200E\u200F]/);
  });

  it('politique : désactivée par défaut et toujours au chargement, limites bornées, relèvements repérés', () => {
    expect(AGENT_ORDER_DEFAULTS).toEqual({ enabled: false, maxQty: 1, maxPosition: 2, perMinute: 3 });
    expect(coerceAgentPolicy({ enabled: true, maxQty: 5, maxPosition: 1000, perMinute: 0 })).toEqual({ enabled: false, maxQty: 5, maxPosition: 2, perMinute: 3 });
    expect(raisedLimits(ON, { ...ON, maxQty: 3, perMinute: 1 })).toEqual(['maxQty']);
  });
});

describe('ordres proposés par l’agent · gardes', () => {
  it('ouvre dans les limites', () => {
    expect(guardProposal(order(), ON, snap())).toEqual({ ok: true, resulting: 1, reducing: false });
  });

  it('refus dans l’ordre : désactivé, compte réel, occupé, lien, kill switch, cadence, quantité, position, marge prop', () => {
    const reason = (r: ReturnType<typeof guardProposal>) => (r.ok ? 'ok' : r.reason);
    expect(reason(guardProposal(order(), AGENT_ORDER_DEFAULTS, snap()))).toBe('disabled');
    expect(reason(guardProposal(order({ account: 'APEX-50K' }), ON, snap()))).toBe('not_sim');
    expect(reason(guardProposal(order(), ON, snap({ busy: true })))).toBe('busy');
    expect(reason(guardProposal(order(), ON, snap({ link: 'stale' })))).toBe('link');
    expect(reason(guardProposal(order(), ON, snap({ ordersOpen: false })))).toBe('orders_closed');
    expect(reason(guardProposal(order(), ON, snap({ recent: [50_000, 60_000, 99_000] })))).toBe('rate');
    expect(reason(guardProposal(order(), ON, snap({ recent: [10_000, 20_000, 30_000] })))).toBe('ok');
    expect(reason(guardProposal(order({ qty: 2 }), ON, snap()))).toBe('quantity');
    expect(reason(guardProposal(order(), ON, snap({ position: 2 })))).toBe('position');
    expect(reason(guardProposal(order(), ON, snap({ propShare: 0.2 })))).toBe('prop_buffer');
  });

  it('une réduction de risque passe la position et la marge prop, pas un retournement', () => {
    const sell = order({ side: 'sell' });
    expect(guardProposal(sell, ON, snap({ position: 5, propShare: 0.05 }))).toEqual({ ok: true, resulting: 4, reducing: true });
    expect(reducesRisk(1, -1)).toBe(false);
    expect(reducesRisk(-3, -2)).toBe(true);
    expect(reducesRisk(0, 1)).toBe(false);
    const flip = guardProposal(order({ side: 'sell', qty: 1 }), { ...ON, maxPosition: 1 }, snap({ position: 0, propShare: 0.1 }));
    expect(flip.ok ? 'ok' : flip.reason).toBe('prop_buffer');
  });
});
