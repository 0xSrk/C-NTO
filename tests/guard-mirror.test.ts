import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_CONFIRM_TIMEOUT_MS, AGENT_ORDER_DEFAULTS, AGENT_ORDER_REFUSALS, guardProposal, parseProposal, type AgentOrderPolicy, type AgentOrderRefusal } from '@/engine/agent/orders';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import { gateWords, guardMirror, mirrorIssueName, mirrorProposal, MIRROR_ISSUES, type MirrorInput } from '@/engine/guardMirror';
import { useI18n } from '@/i18n';
import type { NtBridgeStatus } from '@/lib/desk';
import { agentAccount, deskMirrorInput } from '@/app/useGuardMirror';
import { AGENT_ORDERS_OFF } from '@/store/agentOrders';
import { useJournal } from '@/store/journal';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

/** OROS5.10 : le miroir de la garde, jugé par `guardProposal` lui-même. */

const NOW = Date.parse('2026-10-07T13:00:00Z');
const ON: AgentOrderPolicy = { ...AGENT_ORDER_DEFAULTS, enabled: true };
const RULE = { rule: 'after_daily_limit' as const, detail: 'perte du jour 600 $ ≥ limite 500 $ (règle du trader)' };

const input = (over: Partial<MirrorInput> = {}): MirrorInput => ({
  now: NOW,
  policy: ON,
  pending: false,
  link: 'live',
  ordersOpen: true,
  account: 'Sim101',
  instrument: 'MNQ 12-26',
  position: 0,
  propShare: null,
  traderRules: [],
  ...over,
});

/** Le verdict du process principal sur l'ordre fictif : la lecture, puis la garde, avec les mêmes entrées. */
function direct(i: MirrorInput) {
  const parsed = parseProposal(mirrorProposal(i));
  if (!parsed.ok) return { ok: false as const, reason: 'invalid' as const, detail: parsed.detail };
  return guardProposal(parsed.proposal, i.policy, { now: i.now, link: i.link, ordersOpen: i.ordersOpen, position: i.position, recent: i.recent ?? [], busy: i.pending, propShare: i.propShare, traderRule: i.traderRules[0] ?? null });
}

/** Une entrée qui fait refuser la garde sur chaque issue, et sur elle seule en premier. */
const REFUSING: Record<AgentOrderRefusal, Partial<MirrorInput>> = {
  disabled: { policy: { ...ON, enabled: false } },
  not_sim: { account: 'Apex-PA-50K' },
  busy: { pending: true },
  link: { link: 'absent', ordersOpen: false },
  orders_closed: { ordersOpen: false },
  rate: { recent: [NOW - 50_000, NOW - 40_000, NOW - 1_000] },
  quantity: { qty: 2 },
  position: { position: 2 },
  prop_buffer: { propShare: 0.2 },
  trader_rule: { traderRules: [RULE] },
};

afterEach(() => {
  useI18n.setState({ locale: 'fr' });
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  useJournal.setState({ sessions: [], trades: [] });
});

describe('OROS5.10 · le miroir lit guardProposal, il ne recopie rien', () => {
  it('pour chaque issue d’AGENT_ORDER_REFUSALS, le premier refus du miroir est le verdict de guardProposal', () => {
    for (const key of AGENT_ORDER_REFUSALS) {
      const i = input(REFUSING[key]);
      const m = guardMirror(i);
      const verdict = direct(i);
      expect(verdict.ok ? null : verdict.reason, key).toBe(key);
      expect(m.verdict).toEqual(verdict);
      expect(m.first?.key, key).toBe(key);
      expect(m.first?.detail).toBe(verdict.ok ? undefined : verdict.detail);
    }
    // et sans refus : la décision revient à l'opérateur, dans le dialogue du desk
    const free = guardMirror(input());
    expect(free.verdict).toEqual(direct(input()));
    expect(free.first).toBeNull();
    expect(free.gates.at(-1)).toMatchObject({ key: 'declined', state: 'operator', distance: { kind: 'timeout', ms: AGENT_CONFIRM_TIMEOUT_MS } });
  });

  it('les douze issues, dans l’ordre de la garde : la lecture, les dix gardes, puis vous ; chacune lue par la garde', () => {
    expect(MIRROR_ISSUES).toEqual(['invalid', ...AGENT_ORDER_REFUSALS, 'declined']);
    const m = guardMirror(input({ policy: { ...ON, enabled: false }, ordersOpen: false, propShare: 0.2, traderRules: [RULE, { rule: 'instrument_not_allowed', detail: 'MNQ hors des instruments autorisés (ES)' }] }));
    expect(m.gates.map((g) => g.key)).toEqual([...MIRROR_ISSUES]);
    // ce qui refuserait ensuite se lit aussi, dans l'ordre : désactivé, canal fermé, marge, règle
    expect(m.gates.filter((g) => g.state === 'refuse').map((g) => g.key)).toEqual(['disabled', 'orders_closed', 'prop_buffer', 'trader_rule']);
    // la quantité et la cadence d'une vraie proposition ne se connaissent qu'à son arrivée : la borne seule
    expect(m.gates.find((g) => g.key === 'quantity')).toMatchObject({ state: 'proposal', distance: { kind: 'bound', max: 1, unit: 'contracts' } });
    expect(m.gates.find((g) => g.key === 'rate')).toMatchObject({ state: 'proposal', distance: { kind: 'bound', max: 3, unit: 'perMinute' } });
    // avec leurs distances et en mots, dans les trois langues
    expect(m.gates.find((g) => g.key === 'prop_buffer')?.distance).toEqual({ kind: 'margin', share: 0.2, floor: 0.25 });
    expect(gateWords(m.gates.find((g) => g.key === 'prop_buffer')!)).toBe('marge à 20 % du drawdown maximal, sous 25 %');
    expect(gateWords(m.gates.find((g) => g.key === 'trader_rule')!)).toBe(`${RULE.detail} · MNQ hors des instruments autorisés (ES)`);
    expect(gateWords(m.gates.find((g) => g.key === 'position')!)).toBe('position 0 → +1, au plus 2');
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      const names = MIRROR_ISSUES.map(mirrorIssueName);
      expect(new Set(names).size).toBe(12);
      for (const gate of m.gates) expect(gateWords(gate)).not.toBe('');
    }
  });

  it('un compte hors Sim* arrête la chaîne : la suite ne le concerne pas', () => {
    const m = guardMirror(input({ account: 'Apex-PA-50K', propShare: 0.1 }));
    expect(m.first?.key).toBe('not_sim');
    expect(m.gates.filter((g) => g.state === 'moot').map((g) => g.key)).toEqual(['busy', 'link', 'orders_closed', 'rate', 'quantity', 'position', 'prop_buffer', 'trader_rule', 'declined']);
  });
});

describe('OROS5.10 · pont hors ligne : « link » refuse avant tout ce qui se lit au pont', () => {
  it('le lien refuse, et ni le canal ni la position ne se disent : jamais « canal ouvert »', () => {
    // Le process principal lit `ordersOpen` faux hors ligne ; le renderer pourrait le croire vrai : le miroir ne le dit pas.
    for (const ordersOpen of [false, true]) {
      const i = input({ link: 'absent', ordersOpen, propShare: 0.2 });
      const m = guardMirror(i);
      expect(m.first?.key).toBe('link');
      expect(direct(i)).toMatchObject({ ok: false, reason: 'link' });
      expect(m.gates.find((g) => g.key === 'orders_closed')?.state).toBe('unknown');
      expect(m.gates.find((g) => g.key === 'position')?.state).toBe('unknown');
      // ce qui ne se lit pas au pont se dit encore : la marge du plan refuserait ensuite
      expect(m.gates.find((g) => g.key === 'prop_buffer')?.state).toBe('refuse');
      for (const locale of ['fr', 'en', 'es'] as const) {
        useI18n.setState({ locale });
        const words = m.gates.map(gateWords).join(' | ');
        expect(words).not.toMatch(/canal d’ordres ouvert|order channel open|canal de órdenes abierto/);
      }
      useI18n.setState({ locale: 'fr' });
    }
  });

  it('l’instantané du desk sans pont : lien absent, canal lu fermé, premier refus « link » une fois l’agent activé', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount: 'Apex-PA-50K', traderRules: DEFAULT_TRADER_RULES } });
    const snap = { now: NOW, status: { ...AGENT_ORDERS_OFF, enabled: true }, nt: null, killLatched: false, planAccount: 'Apex-PA-50K', trades: [] };
    // sans pont, aucun compte Sim* connu : le compte demandé est lu tel quel
    expect(agentAccount('Apex-PA-50K', null)).toBeNull();
    const i = deskMirrorInput({ ...snap, account: 'Sim101' });
    expect(i).toMatchObject({ link: 'absent', ordersOpen: false, account: 'Sim101', position: 0, propShare: null, traderRules: [] });
    expect(guardMirror({ ...i, instrument: 'MNQ 12-26' }).first?.key).toBe('link');
    // désactivé à l'ouverture du desk : c'est le premier refus, le lien suit
    const off = guardMirror({ ...deskMirrorInput({ ...snap, status: AGENT_ORDERS_OFF, account: 'Sim101' }), instrument: 'MNQ 12-26' });
    expect(off.gates.filter((g) => g.state === 'refuse').map((g) => g.key)).toEqual(['disabled', 'link']);
  });

  it('le pont en ligne : le compte Sim* du pont, sa position sur l’instrument, le canal fermé après le kill switch', () => {
    const nt = {
      link: 'live',
      ordersOpen: true,
      accountNames: ['Apex-PA-50K', 'Sim101'],
      accounts: [
        { name: 'Apex-PA-50K', cashValue: 0, realizedPnl: 0, unrealizedPnl: 0, positions: [] },
        { name: 'Sim101', cashValue: 0, realizedPnl: 0, unrealizedPnl: 0, positions: [{ instrument: 'MNQ 12-26', quantity: -2, avgPrice: 1 }] },
      ],
    } as unknown as NtBridgeStatus;
    expect(agentAccount('Apex-PA-50K', nt)).toBe('Sim101');
    expect(agentAccount('SimApex1', nt)).toBe('SimApex1');
    const base = { now: NOW, status: { ...AGENT_ORDERS_OFF, enabled: true }, nt, killLatched: false, planAccount: 'Apex-PA-50K', trades: [] };
    const i = deskMirrorInput(base);
    expect(i).toMatchObject({ account: 'Sim101', instrument: 'MNQ 12-26', position: -2, link: 'live', ordersOpen: true });
    // l'ouverture fictive éloigne de zéro : une vente, qui dépasse la position de l'agent
    const m = guardMirror(i);
    expect(m.proposal.side).toBe('sell');
    expect(m.first?.key).toBe('position');
    // le nom replié du pont est reconnu, comme `heldPosition`
    expect(deskMirrorInput({ ...base, account: ' sim101 ' })).toMatchObject({ account: 'Sim101', position: -2 });
    // le verrou du renderer : une coupure vue garde le canal fermé
    expect(guardMirror(deskMirrorInput({ ...base, killLatched: true })).first?.key).toBe('orders_closed');
  });
});

describe('OROS5.10 · une réduction de risque passe toujours', () => {
  it('position, marge et règles du trader ne bornent pas une réduction ; une ouverture, si', () => {
    const over = { position: 2, propShare: 0.05, traderRules: [RULE] };
    const reduce = input({ ...over, side: 'sell' });
    const m = guardMirror(reduce);
    expect(direct(reduce)).toEqual({ ok: true, resulting: 1, reducing: true });
    expect(m.verdict).toEqual(direct(reduce));
    expect(m.reducing).toBe(true);
    expect(m.first).toBeNull();
    for (const key of ['position', 'prop_buffer', 'trader_rule'] as const) expect(m.gates.find((g) => g.key === key)).toMatchObject({ state: 'pass', reduction: true });
    expect(gateWords(m.gates.find((g) => g.key === 'prop_buffer')!)).toBe('réduction de risque : passe toujours');
    // la même position, une ouverture : la position refuse d'abord, puis la marge et la règle se lisent
    const open = guardMirror(input({ ...over, side: 'buy' }));
    expect(open.reducing).toBe(false);
    expect(open.gates.filter((g) => g.state === 'refuse').map((g) => g.key)).toEqual(['position', 'prop_buffer', 'trader_rule']);
    // un retournement n'est pas une réduction
    const flip = guardMirror(input({ position: 1, side: 'sell', qty: 2, policy: { ...ON, maxQty: 2 }, propShare: 0.05 }));
    expect(flip.reducing).toBe(false);
    expect(flip.first?.key).toBe('prop_buffer');
  });
});

describe('OROS5.10 · un miroir, rien de plus', () => {
  it('le moteur et le crochet ne lèvent aucune garde et n’écrivent rien', () => {
    const engine = readFileSync('src/engine/guardMirror.ts', 'utf8');
    expect(engine).not.toMatch(/from ['"]@\/(store|modules|app)|from ['"]electron/);
    const hook = readFileSync('src/app/useGuardMirror.ts', 'utf8');
    expect(hook).not.toMatch(/\.(enable|disable|setLimits|propose|refresh|killSwitch|allowRealAccount|setMaxContracts)\(|window\.canto|\bdesk\??\.[A-Za-z]/);
  });
});
