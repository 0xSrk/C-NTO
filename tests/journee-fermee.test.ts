import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardProposal, type AgentOrderPolicy, type AgentOrderSnapshot } from '@/engine/agent/orders';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import type { Session, Trade } from '@/engine/types';
import type { Locale } from '@/i18n';
import { fmtUsd } from '@/lib/format';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

/**
 * OROS5.48b — décision 15 de l'ADMIN (2026-11-03) : « On ferme la journée une fois la limite touchée. » Une fois la perte du
 * jour atteinte (réalisé du jour plus latent négatif, au moins égal à la limite), la journée CME reste fermée aux ouvertures
 * de l'agent jusqu'à la journée CME suivante, même si un gain ramène ensuite la perte sous la limite. Une réduction de
 * risque passe toujours. La garde du renderer, le coffre, la frise, la barre d'état et le miroir de la garde le disent
 * ensemble ; le process principal tient la sienne (OROS5.48a, `tests/journee-fermee-process.test.ts`).
 */

// Le coffre de la table `settings`, hors du registre des modules : il survit au rechargement que simule `vi.resetModules`.
const vault = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (key: string, fallback: unknown) => (vault.has(key) ? structuredClone(vault.get(key)) : fallback)),
  setSetting: vi.fn(async (key: string, value: unknown) => {
    vault.set(key, structuredClone(value));
  }),
}));

const et = (day: string, hhmm: string) => zonedToUtc(day, hhmm, ET_ZONE);
const DAY = '2026-10-06';
const SIM = 'SimApex1';
const ON: AgentOrderPolicy = { enabled: true, maxQty: 1, maxPosition: 2, perMinute: 3 };

const trade = (id: string, exit: string, pnl: number): Trade => ({ id, sessionId: 's6', instrument: 'MNQ', account: SIM, direction: 'long', qty: 1, entryTime: et(DAY, exit) - 600_000, exitTime: et(DAY, exit), entryPrice: 0, exitPrice: 0, pnl, commission: 0 });
const session = (trades: Trade[]): Session => ({ id: 's6', date: DAY, account: SIM, instruments: ['MNQ'], source: 'ninjatrader', tradeCount: trades.length, pnl: trades.reduce((sum, t) => sum + t.pnl, 0), grossProfit: 0, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 });

/** Le desk, à neuf (un lancement, ou un renderer rechargé) : les stores relus, le process principal doublé. */
async function desk(closeDay = vi.fn(async () => true)) {
  vi.stubGlobal('window', { location: { search: '' }, canto: { agentOrders: { closeDay } } });
  vi.resetModules();
  const stores = {
    dayClose: await import('@/store/dayClose'),
    deskEvents: await import('@/store/deskEvents'),
    bridge: await import('@/store/bridge'),
    journal: await import('@/store/journal'),
    settings: await import('@/store/settings'),
    macro: await import('@/store/macro'),
    i18n: await import('@/i18n'),
  };
  const { useSettings, DEFAULT_SETTINGS } = stores.settings;
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: SIM, traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 600 } } });
  stores.macro.useMacro.setState({ events: [] });
  stores.i18n.useI18n.setState({ locale: 'fr' });
  return { ...stores, closeDay };
}

/** Le journal et le latent du pont, comme ils sont à l'instant lu. */
function state(s: Awaited<ReturnType<typeof desk>>, trades: Trade[], unrealized: number | null) {
  s.journal.useJournal.setState({ sessions: trades.length ? [session(trades)] : [], trades });
  s.bridge.useBridge.setState({ nt: unrealized === null ? null : ({ link: 'live', accountsAt: Date.now(), accounts: [{ name: SIM, cashValue: 0, realizedPnl: 0, unrealizedPnl: unrealized, positions: [] }], accountNames: [SIM] } as never) });
}

const OPEN = { account: SIM, instrument: 'MNQ 12-26', qty: 1 };

afterEach(() => {
  vi.unstubAllGlobals();
  vault.clear();
});

describe('OROS5.48b · la journée fermée, côté renderer', () => {
  it('la perte du jour atteinte ferme la journée : un gain qui la ramène sous la limite ne la rouvre pas', async () => {
    const s = await desk();
    const all = [trade('a', '10:20', -300), trade('b', '10:56', -320), trade('c', '11:40', 80)];
    state(s, all, 0);
    // 11:45 : −540 $ relus, sous la limite de 600 $ ; la journée reste fermée depuis 10:56 ET
    const at = et(DAY, '11:45');
    const blocks = s.deskEvents.traderRuleBlocks(OPEN, at);
    expect(blocks).toEqual([{ rule: 'after_daily_limit', detail: 'journée fermée depuis 10:56 ET : limite 600 $ atteinte (règle du trader)' }]);
    expect(s.deskEvents.dailyLossReached(at)).toBe(true);
    // encore à la limite : la perte relue suit le motif
    expect(s.deskEvents.traderRuleBlocks(OPEN, et(DAY, '11:10'))[0]?.detail).toBe('journée fermée depuis 10:56 ET : perte du jour 620 $ ≥ limite 600 $ (règle du trader)');
    // avant 10:56, rien n'était atteint
    expect(s.deskEvents.traderRuleBlocks(OPEN, et(DAY, '10:30'))).toEqual([]);
    // en trois langues
    const say = (locale: Locale) => {
      s.i18n.useI18n.setState({ locale });
      return s.deskEvents.traderRuleBlocks(OPEN, at)[0]?.detail;
    };
    expect(say('en')).toBe('day closed since 10:56 ET: limit 600 $ reached (trader rule)');
    expect(say('es')).toBe('jornada cerrada desde 10:56 ET: límite 600 $ alcanzado (regla del trader)');
  });

  it('la journée CME suivante la lève : 18:00 ET, et non minuit', async () => {
    const s = await desk();
    state(s, [trade('a', '10:20', -300), trade('b', '10:56', -320), trade('c', '11:40', 80)], 0);
    expect(s.deskEvents.traderRuleBlocks(OPEN, et(DAY, '17:59'))).toHaveLength(1);
    expect(s.deskEvents.traderRuleBlocks(OPEN, et(DAY, '18:01'))).toEqual([]);
    expect(s.deskEvents.dailyLossReached(et(DAY, '18:01'))).toBe(false);
  });

  it('une réduction de risque passe pendant la journée fermée ; une ouverture est refusée par la garde même', async () => {
    const s = await desk();
    state(s, [trade('a', '10:20', -300), trade('b', '10:56', -320), trade('c', '11:40', 80)], 0);
    const rule = s.deskEvents.traderRuleOf({ ...OPEN, side: 'sell', type: 'market', reason: 'r' }, et(DAY, '11:45'));
    expect(rule?.rule).toBe('after_daily_limit');
    const order = (side: 'buy' | 'sell') => ({ account: SIM, instrument: 'MNQ 12-26', side, qty: 1, type: 'market' as const, reason: 'r' });
    const snap: AgentOrderSnapshot = { now: et(DAY, '11:45'), link: 'live', ordersOpen: true, position: 1, recent: [], busy: false, propShare: null, traderRule: rule };
    expect(guardProposal(order('sell'), ON, snap)).toEqual({ ok: true, resulting: 0, reducing: true });
    expect(guardProposal(order('buy'), ON, snap)).toEqual({ ok: false, reason: 'trader_rule', detail: 'journée fermée depuis 10:56 ET : limite 600 $ atteinte (règle du trader)' });
  });

  it('au latent : retenue au coffre et dite au process principal ; elle survit au rechargement du renderer (coffre relu)', async () => {
    // −300 $ à 10:20, +80 $ à 11:40 : le réalisé n'atteint jamais 600 $ ; à 11:00, le latent du pont (−400 $) l'y porte
    const realized = [trade('a', '10:20', -300), trade('c', '11:40', 80)];
    const first = await desk();
    state(first, realized.slice(0, 1), -400);
    first.deskEvents.recordDayClose(et(DAY, '11:00'));
    expect(vault.get('agent.dayClose')).toEqual([{ day: DAY, account: SIM, at: et(DAY, '11:00') }]);
    expect(first.closeDay).toHaveBeenCalledWith({ account: SIM, at: et(DAY, '11:00') });
    // le latent revient : la garde du même renderer tient
    state(first, realized, 0);
    expect(first.deskEvents.traderRuleBlocks(OPEN, et(DAY, '11:45'))[0]?.detail).toBe('journée fermée depuis 11:00 ET : limite 600 $ atteinte (règle du trader)');
    // rechargé : les stores repartent vides, le coffre est relu ; la journée reste fermée et le process principal le réentend
    const again = await desk();
    state(again, realized, 0);
    expect(again.deskEvents.traderRuleBlocks(OPEN, et(DAY, '11:45'))).toEqual([]);
    // le rechargement relit le coffre à 11:46 : la journée CME en cours est celle de la fermeture
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(et(DAY, '11:46'));
    await again.dayClose.useDayClose.getState().load();
    vi.useRealTimers();
    expect(again.deskEvents.traderRuleBlocks(OPEN, et(DAY, '11:46'))).toEqual([{ rule: 'after_daily_limit', detail: 'journée fermée depuis 11:00 ET : limite 600 $ atteinte (règle du trader)' }]);
    expect(again.deskEvents.dailyLossReached(et(DAY, '11:46'))).toBe(true);
    expect(again.closeDay).toHaveBeenCalledWith({ account: SIM, at: et(DAY, '11:00') });
    // une fermeture d'un compte que la limite ne suit pas ne vise que lui
    expect(again.deskEvents.traderRuleBlocks({ ...OPEN, account: 'Sim101' }, et(DAY, '11:46'))).toEqual([]);
  });

  it('le coffre : la ligne passe par la table de restauration ; un coffre ancien reste lisible ; une restauration ne rouvre rien', async () => {
    const { prepareVaultRestore, restoredSettingValue } = await import('@/store/db');
    const { DAY_CLOSE_KEY } = await import('@/store/dayClose');
    expect(DAY_CLOSE_KEY).toBe('agent.dayClose');
    const close = { day: DAY, account: SIM, at: et(DAY, '11:00') };
    const kept = prepareVaultRestore(JSON.stringify({ artefact: 'CΛNTO', sessions: [], settings: [{ key: DAY_CLOSE_KEY, value: [close, { day: 'demain' }] }] }));
    expect(kept.otherSettings).toEqual([{ key: DAY_CLOSE_KEY, value: [close] }]);
    const bad = prepareVaultRestore(JSON.stringify({ artefact: 'CΛNTO', sessions: [], settings: [{ key: DAY_CLOSE_KEY, value: 'fermée' }] }));
    expect(bad.otherSettings).toEqual([]);
    expect(bad.skipped.settings).toBe(1);
    // un coffre d'avant la décision 15 n'a pas la ligne : rien n'est écarté
    const old = prepareVaultRestore(JSON.stringify({ artefact: 'CΛNTO', sessions: [], settings: [{ key: 'agent.routineSeen', value: { brief: DAY } }] }));
    expect(old.skipped.settings ?? 0).toBe(0);
    // restaurer un coffre d'hier sur la journée fermée d'aujourd'hui : la fermeture d'aujourd'hui reste, celle d'hier à côté (OROS5.48k)
    const yesterday = { day: '2026-10-05', account: SIM, at: et('2026-10-05', '10:00') };
    expect(restoredSettingValue(DAY_CLOSE_KEY, [close], [yesterday])).toEqual([yesterday, close]);
    expect(restoredSettingValue('agent.routineSeen', { brief: 'x' }, { brief: DAY })).toEqual({ brief: DAY });
  });

  it('OROS5.48m la table de restauration relit la ligne avec l’heure : la journée en cours reste à côté de trois journées à venir', async () => {
    const { prepareVaultRestore, restoredSettingValue } = await import('@/store/db');
    const { dayCloseFor } = await import('@/engine/agent/dayClose');
    // un coffre exporté à 11:30 : la fermeture d'aujourd'hui, et trois journées à venir retenues pendant que l'horloge
    // du poste avançait ; il est restauré sur un poste neuf (aucune ligne en place, aucun fichier au process principal)
    const today = { day: DAY, account: SIM, at: et(DAY, '10:56') };
    const ahead = ['2026-10-07', '2026-10-08', '2026-10-09'].map((day) => ({ day, account: SIM, at: et(day, '09:00') }));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(et(DAY, '11:45'));
    try {
      const restored = prepareVaultRestore(JSON.stringify({ artefact: 'CΛNTO', sessions: [], settings: [{ key: 'agent.dayClose', value: [today, ...ahead] }] }));
      expect(restored.otherSettings).toEqual([{ key: 'agent.dayClose', value: [today, ...ahead] }]);
      const written = restoredSettingValue('agent.dayClose', undefined, restored.otherSettings[0]!.value);
      expect(dayCloseFor(written as never, SIM, et(DAY, '11:45'))).toEqual(today);
    } finally {
      vi.useRealTimers();
    }
  });

  it('OROS5.48f une fermeture d’une journée à venir (une horloge qui avançait) ne retient ni n’efface celle de la vraie journée', async () => {
    const { dayCloseFor } = await import('@/engine/agent/dayClose');
    const ahead = { day: '2026-10-08', account: 'z', at: et('2026-10-08', '09:00') };
    // le coffre tient déjà une fermeture du 2026-10-08 ; à 11:00 le 2026-10-06, le latent porte la perte à la limite
    vault.set('agent.dayClose', [ahead]);
    const s = await desk();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(et(DAY, '09:30'));
    await s.dayClose.useDayClose.getState().load();
    vi.useRealTimers();
    const realized = [trade('a', '10:20', -300), trade('c', '11:40', 80)];
    state(s, realized.slice(0, 1), -400);
    s.deskEvents.recordDayClose(et(DAY, '11:00'));
    expect(s.closeDay).toHaveBeenCalledWith({ account: SIM, at: et(DAY, '11:00') });
    expect(dayCloseFor(vault.get('agent.dayClose') as never, SIM, et(DAY, '11:45'))).toEqual({ day: DAY, account: SIM, at: et(DAY, '11:00') });
    // 11:45 : le latent est revenu ; la journée reste fermée
    state(s, realized, 0);
    expect(s.deskEvents.traderRuleBlocks(OPEN, et(DAY, '11:45'))).toEqual([{ rule: 'after_daily_limit', detail: 'journée fermée depuis 11:00 ET : limite 600 $ atteinte (règle du trader)' }]);
    // relu après un redémarrage, le coffre la garde
    const again = await desk();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(et(DAY, '11:46'));
    await again.dayClose.useDayClose.getState().load();
    vi.useRealTimers();
    state(again, realized, 0);
    expect(again.deskEvents.traderRuleBlocks(OPEN, et(DAY, '11:46'))[0]?.rule).toBe('after_daily_limit');
    // restaurer un coffre qui porte une fermeture à venir n'efface pas celle d'aujourd'hui
    const { restoredSettingValue } = await import('@/store/db');
    const close = { day: DAY, account: SIM, at: et(DAY, '10:56') };
    const restored = restoredSettingValue('agent.dayClose', [close], [ahead], et(DAY, '11:45'));
    expect(dayCloseFor(restored as never, SIM, et(DAY, '11:45'))).toEqual(close);
  });

  it('OROS5.48k fermer la journée, puis une journée à venir quand l’horloge avance : l’horloge corrigée, la vraie reste fermée', async () => {
    const { dayCloseFor } = await import('@/engine/agent/dayClose');
    // 10:00 : aucune sortie, le latent du pont (−700 $) porte la perte au-delà de 600 $
    const s = await desk();
    state(s, [], -700);
    s.deskEvents.recordDayClose(et(DAY, '10:00'));
    expect(vault.get('agent.dayClose')).toEqual([{ day: DAY, account: SIM, at: et(DAY, '10:00') }]);
    // l'horloge du poste saute de deux jours, le latent est encore à la limite : cette journée-là se ferme aussi
    s.deskEvents.recordDayClose(et('2026-10-08', '10:10'));
    expect(s.closeDay).toHaveBeenLastCalledWith({ account: SIM, at: et('2026-10-08', '10:10') });
    // l'horloge corrigée, un gain ramène le latent à −100 $ : la journée reste fermée, au store comme au coffre
    state(s, [], -100);
    const at = et(DAY, '10:20');
    expect(s.deskEvents.traderRuleBlocks(OPEN, at)).toEqual([{ rule: 'after_daily_limit', detail: 'journée fermée depuis 10:00 ET : limite 600 $ atteinte (règle du trader)' }]);
    expect(s.deskEvents.dailyLossReached(at)).toBe(true);
    expect(dayCloseFor(vault.get('agent.dayClose') as never, SIM, at)).toEqual({ day: DAY, account: SIM, at: et(DAY, '10:00') });
    // rechargé à 10:31, le coffre relu : de même, et le process principal la réentend
    const again = await desk();
    state(again, [], -100);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(et(DAY, '10:31'));
    await again.dayClose.useDayClose.getState().load();
    vi.useRealTimers();
    expect(again.deskEvents.traderRuleBlocks(OPEN, et(DAY, '10:31'))[0]?.detail).toBe('journée fermée depuis 10:00 ET : limite 600 $ atteinte (règle du trader)');
    expect(again.closeDay).toHaveBeenCalledWith({ account: SIM, at: et(DAY, '10:00') });
  });

  it('OROS5.48h la limite retirée après la fermeture : la barre d’état dit encore la journée fermée, au niveau 3', async () => {
    const s = await desk();
    const all = [trade('a', '10:20', -300), trade('b', '10:56', -320), trade('c', '11:40', 80)];
    state(s, all, 0);
    s.deskEvents.recordDayClose(et(DAY, '11:41'));
    // le trader retire sa limite : la garde tient la journée fermée, la barre aussi
    s.settings.useSettings.setState({ settings: { ...s.settings.useSettings.getState().settings, traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 0 } } });
    const now = et(DAY, '11:45');
    expect(s.deskEvents.traderRuleBlocks(OPEN, now)).toEqual([{ rule: 'after_daily_limit', detail: 'journée fermée depuis 10:56 ET : perte du jour atteinte' }]);
    const { borneCells } = await import('@/app/StatusBornes');
    const { dayBornes, replayBornes } = await import('@/engine/bornes');
    const { trades, sessions } = s.journal.useJournal.getState();
    const nt = s.bridge.useBridge.getState().nt!;
    const replay = replayBornes({ sessions, trades, account: SIM, plan: null, rules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 0 } });
    const bornes = dayBornes(replay, { now, link: 'live', accountsAt: now - 2_000, accounts: nt.accounts, catalysts: [], dayClosedSince: s.deskEvents.trackedDayClosedSince(now) });
    expect(bornes.loss).toMatchObject({ limit: null, closedSince: et(DAY, '10:56'), level: 3 });
    const cells = borneCells(bornes);
    expect(cells.map((c) => c.key)).not.toContain('settings');
    const loss = cells.find((c) => c.key === 'loss')!;
    expect(loss).toMatchObject({ level: 3, value: '540 · journée fermée depuis 10:56 ET', valueShort: '540 · fermée 10:56', valueNarrow: '540' });
    expect(loss.source).toBeUndefined();
    expect(loss.label).toBe('Perte du jour 540, aucune limite réglée, journée fermée depuis 10:56 ET, compte SimApex1, pont il y a 2 s');
    for (const [locale, words] of [
      ['en', 'Day loss 540, no limit set, day closed since 10:56 ET'],
      ['es', 'Pérdida del día 540, ningún límite ajustado, jornada cerrada desde 10:56 ET'],
    ] as const) {
      s.i18n.useI18n.setState({ locale });
      expect(borneCells(bornes).find((c) => c.key === 'loss')!.label, locale).toContain(words);
    }
    // sans fermeture ni limite, la cellule de perte ne se pose pas : « Bornes à régler », comme avant
    const open = dayBornes(replay, { now, link: 'live', accountsAt: now - 2_000, accounts: nt.accounts, catalysts: [], dayClosedSince: null });
    expect(borneCells(open).map((c) => c.key)).toEqual(['settings']);
  });

  it('OROS5.48i le pont perdu, sans séance du jour : la barre d’état dit la journée fermée, et non la dernière séance', async () => {
    const s = await desk();
    // aucune sortie aujourd'hui, une position ouverte : à 11:00, le latent du pont (−700 $) porte la perte au-delà de 600 $
    state(s, [], -700);
    s.deskEvents.recordDayClose(et(DAY, '11:00'));
    // puis NinjaTrader se déconnecte
    s.bridge.useBridge.setState({ nt: null });
    const now = et(DAY, '11:45');
    const { borneCells } = await import('@/app/StatusBornes');
    const { dayBornes, replayBornes } = await import('@/engine/bornes');
    const yesterday: Trade = { ...trade('y', '10:00', -63), sessionId: 's5', entryTime: et('2026-10-05', '10:00') - 600_000, exitTime: et('2026-10-05', '10:00') };
    const before: Session = { ...session([yesterday]), id: 's5', date: '2026-10-05' };
    for (const [sessions, trades] of [
      [[], []],
      [[before], [yesterday]],
    ] as const) {
      const replay = replayBornes({ sessions: [...sessions], trades: [...trades], account: SIM, plan: null, rules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 600 } });
      const bornes = dayBornes(replay, { now, link: 'absent', accountsAt: null, accounts: [], catalysts: [], dayClosedSince: s.deskEvents.trackedDayClosedSince(now) });
      expect(bornes.day.today, `${sessions.length} séance(s)`).toBe(false);
      expect(bornes.loss).toMatchObject({ value: null, closedSince: et(DAY, '11:00'), level: 3 });
      const loss = borneCells(bornes).find((c) => c.key === 'loss')!;
      expect(loss).toMatchObject({ level: 3, value: `— / ${fmtUsd(600)} · journée fermée depuis 11:00 ET`, stale: false });
      expect(loss.label).toBe(`Perte du jour non lue, limite ${fmtUsd(600)}, journée fermée depuis 11:00 ET, règle du trader, compte SimApex1`);
    }
    // la garde et la frise le disent de même
    expect(s.deskEvents.traderRuleBlocks(OPEN, now)[0]?.detail).toBe('journée fermée depuis 11:00 ET : limite 600 $ atteinte (règle du trader)');
    // sans fermeture, la dernière séance reste une lecture datée, au niveau 0, comme avant
    const replay = replayBornes({ sessions: [before], trades: [yesterday], account: SIM, plan: null, rules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 600 } });
    const open = dayBornes(replay, { now, link: 'absent', accountsAt: null, accounts: [], catalysts: [], dayClosedSince: null });
    expect(open.loss).toMatchObject({ value: 63, closedSince: null, level: 0 });
    expect(borneCells(open).find((c) => c.key === 'loss')).toMatchObject({ value: `63 / ${fmtUsd(600)} · 05.10`, stale: true });
  });

  it('la frise, la barre d’état et le miroir de la garde disent la même chose : « journée fermée depuis hh:mm ET »', async () => {
    const s = await desk();
    state(s, [trade('a', '10:20', -300), trade('b', '10:56', -320), trade('c', '11:40', 80)], 0);
    const now = et(DAY, '11:45');
    const { hourAt } = await import('@/lib/frise');
    const { friseLine } = await import('@/app/FriseAnswer');
    const { borneCells } = await import('@/app/StatusBornes');
    const { deskMirrorInput } = await import('@/app/useGuardMirror');
    const { guardMirror, gateWords } = await import('@/engine/guardMirror');
    const { dayBornes, replayBornes } = await import('@/engine/bornes');
    const { dayClosesFor } = await import('@/engine/agent/dayClose');
    const read = () => {
      const { trades, sessions } = s.journal.useJournal.getState();
      const closes = dayClosesFor(s.dayClose.useDayClose.getState().closes, SIM);
      const answer = hourAt({ at: now, now, events: [], trades, rules: { catalystBlackoutMin: 0 }, limit: 600, kill: false, unrealized: 0, closes });
      const frise = friseLine(answer, { at: now, events: [], sources: 'complete' }).text;
      const replay = replayBornes({ sessions, trades, account: SIM, plan: null, rules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 600 } });
      const nt = s.bridge.useBridge.getState().nt!;
      const bornes = dayBornes(replay, { now, link: 'live', accountsAt: now - 2_000, accounts: nt.accounts, catalysts: [], dayClosedSince: s.deskEvents.trackedDayClosedSince(now) });
      const loss = borneCells(bornes).find((c) => c.key === 'loss')!;
      const status = { enabled: true, maxQty: 1, maxPosition: 2, perMinute: 3, pending: false };
      const mirror = guardMirror(deskMirrorInput({ now, status, nt: { ...nt, ordersOpen: true } as never, killLatched: false, planAccount: SIM, trades }));
      const gate = mirror.gates.find((g) => g.key === 'trader_rule')!;
      return { frise, bornes, loss, gate, words: gateWords(gate) };
    };
    const fr = read();
    expect(fr.frise).toBe('Journée fermée depuis 10:56 ET');
    // la barre : C.123 tant que la journée est fermée, même à 540 $ sur 600 $
    expect(fr.bornes.loss.closedSince).toBe(et(DAY, '10:56'));
    expect(fr.loss.level).toBe(3);
    expect(fr.loss.value).toBe(`540 / ${fmtUsd(600)} · journée fermée depuis 10:56 ET`);
    expect(fr.loss.label).toContain('journée fermée depuis 10:56 ET');
    // le miroir : la règle du trader refuse, et dit pourquoi
    expect(fr.gate.state).toBe('refuse');
    expect(fr.words).toContain('journée fermée depuis 10:56 ET');
    for (const [locale, words] of [
      ['en', 'Day closed since 10:56 ET'],
      ['es', 'Jornada cerrada desde 10:56 ET'],
    ] as const) {
      s.i18n.useI18n.setState({ locale });
      const r = read();
      expect(r.frise, locale).toBe(words);
      expect(r.loss.value, locale).toContain(words.charAt(0).toLowerCase() + words.slice(1));
      expect(r.words, locale).toContain(words.charAt(0).toLowerCase() + words.slice(1));
    }
  });
});
