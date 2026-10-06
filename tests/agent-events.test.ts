import { describe, expect, it } from 'vitest';
import { DESK_EVENT_KINDS, isDeskEventKind } from '@/engine/agent/catalog';
import { DeskEventLog, catalystInstant, dueCatalysts, fillData, linkTransition, propBufferAlert, propBufferLevel } from '@/engine/agent/events';
import type { CalEvent } from '@/engine/calendar';

describe('journal des événements du desk', () => {
  it('curseur : les suivants seulement, pages bornées, filtre sans recul', () => {
    const log = new DeskEventLog('e1');
    for (let i = 1; i <= 5; i++) log.push(i % 2 ? 'fill' : 'catalyst', { i }, 1000 + i);
    const first = log.read({ limit: 2 });
    expect(first.events.map((e) => e.data.i)).toEqual([4, 5]);
    expect(first.cursor).toBe('e1.5');
    expect(log.read({ cursor: first.cursor }).events).toEqual([]);

    log.push('prop_buffer', { i: 6 });
    log.push('fill', { i: 7 });
    const next = log.read({ cursor: 'e1.5', limit: 1 });
    expect(next.events.map((e) => e.data.i)).toEqual([6]);
    expect(next.more).toBe(true);
    expect(log.read({ cursor: next.cursor }).events.map((e) => e.data.i)).toEqual([7]);

    const fills = log.read({ cursor: 'e1.0', kinds: ['fill'] });
    expect(fills.events.map((e) => e.data.i)).toEqual([1, 3, 5, 7]);
    expect(fills.cursor).toBe('e1.7');
  });

  it('autre lancement ou curseur faux : reset ; journal plein : événements perdus comptés', () => {
    const log = new DeskEventLog('e2', 3);
    for (let i = 1; i <= 5; i++) log.push('fill', { i });
    expect(log.size).toBe(3);
    const lost = log.read({ cursor: 'e2.1' });
    expect(lost.dropped).toBe(1);
    expect(lost.events.map((e) => e.seq)).toEqual([3, 4, 5]);
    for (const bad of ['e1.2', 'e2.99', 'nimporte', '']) {
      const page = log.read({ cursor: bad });
      if (bad) expect(page.reset, bad).toBe(true);
      expect(page.events.map((e) => e.seq)).toEqual([3, 4, 5]);
    }
    expect(log.read({ limit: 0 }).events).toHaveLength(1);
    expect(log.read({ limit: 10_000 }).events).toHaveLength(3);
  });

  it('types d’événements connus, partagés avec le process principal', () => {
    expect(DESK_EVENT_KINDS).toEqual(['fill', 'prop_buffer', 'catalyst', 'bridge_link', 'agent_order', 'daily_loss', 'discipline']);
    expect(isDeskEventKind('fill')).toBe(true);
    expect(isDeskEventKind('order.submit')).toBe(false);
    expect(isDeskEventKind(3)).toBe(false);
  });
});

describe('marge du plan prop', () => {
  const base = { planId: 'p', account: 'PA-1', maxDrawdown: 2000, floor: 48_000, balance: 50_000, unrealized: 0 };

  it('alerte à 50, 25, 10 % et au franchissement, une fois par seuil', () => {
    let level = 0;
    const seen: unknown[] = [];
    for (const buffer of [2000, 1100, 1000, 900, 480, 450, 150, -10]) {
      const r = propBufferAlert(level, { ...base, buffer });
      level = r.level;
      if (r.data) seen.push([r.data.threshold, r.data.breached]);
    }
    expect(seen).toEqual([
      [0.5, false],
      [0.25, false],
      [0.1, false],
      [0, true],
    ]);
  });

  it('le latent négatif du compte compte, le latent positif non', () => {
    const r = propBufferAlert(0, { ...base, buffer: 1500, unrealized: -600 });
    expect(r.data).toMatchObject({ threshold: 0.5, liveBuffer: 900, journalBuffer: 1500, unrealized: -600 });
    expect(propBufferAlert(0, { ...base, buffer: 900, unrealized: 5000 }).data).toMatchObject({ liveBuffer: 900 });
  });

  it('hystérésis : pas de rafale autour d’un seuil, réarmement après 5 points', () => {
    expect(propBufferLevel(0.24, 0)).toBe(2);
    expect(propBufferLevel(0.27, 2)).toBe(2);
    expect(propBufferLevel(0.31, 2)).toBe(1);
    expect(propBufferLevel(0.6, 3)).toBe(0);
    let level = 2;
    let alerts = 0;
    for (const buffer of [520, 480, 530, 470, 620, 480]) {
      const r = propBufferAlert(level, { ...base, buffer });
      level = r.level;
      if (r.data) alerts++;
    }
    expect(alerts).toBe(1);
  });

  it('plan sans drawdown ou marge illisible : rien', () => {
    expect(propBufferAlert(0, { ...base, maxDrawdown: 0, buffer: -5 }).data).toBeNull();
    expect(propBufferAlert(0, { ...base, buffer: Number.NaN }).data).toBeNull();
  });
});

describe('catalyseurs proches', () => {
  const ev = (id: string, date: string, timeET: string | undefined, impact: 1 | 2 | 3): CalEvent => ({ id, date, timeET, title: id, category: 'emploi', impact, description: '', estimated: false });

  it('majeurs dans les 15 minutes, heure de New York, une seule fois', () => {
    const nfp = ev('nfp', '2026-10-02', '08:30', 3);
    expect(catalystInstant(nfp)).toBe(Date.UTC(2026, 9, 2, 12, 30));
    const now = Date.UTC(2026, 9, 2, 12, 20);
    const events = [nfp, ev('mineur', '2026-10-02', '08:30', 2), ev('tard', '2026-10-02', '10:00', 3), ev('sans-heure', '2026-10-02', undefined, 3), ev('passe', '2026-10-02', '08:00', 3)];
    const due = dueCatalysts(events, now, new Set());
    expect(due.map((d) => d.id)).toEqual(['nfp']);
    expect(due[0]?.data).toMatchObject({ at: '2026-10-02T12:30:00.000Z', minutesBefore: 10, impact: 3, source: 'local' });
    expect(dueCatalysts(events, now, new Set(['nfp']))).toEqual([]);
  });

  it('heure d’hiver : 08:30 New York = 13:30 UTC', () => {
    expect(catalystInstant(ev('cpi', '2026-12-10', '08:30', 3))).toBe(Date.UTC(2026, 11, 10, 13, 30));
  });
});

describe('fills et lien du pont', () => {
  it('fill complet borné, incomplet refusé', () => {
    const fill = { account: 'Sim101', instrument: 'NQ 12-26', action: 'Buy', quantity: 2, price: 21_000.25, time: Date.UTC(2026, 9, 5, 14), entryExit: 'Entry', secret: 'x' };
    expect(fillData(fill)).toEqual({ account: 'Sim101', instrument: 'NQ 12-26', action: 'Buy', quantity: 2, price: 21_000.25, time: '2026-10-05T14:00:00.000Z', entryExit: 'Entry' });
    expect(fillData({ ...fill, quantity: Number.NaN })).toBeNull();
    expect(fillData({ ...fill, account: 'a'.repeat(65) })).toBeNull();
    expect(fillData(null)).toBeNull();
  });

  it('le lien : un changement d’état, pas le premier état connu', () => {
    expect(linkTransition(null, 'live')).toBeNull();
    expect(linkTransition('live', 'live')).toBeNull();
    expect(linkTransition('live', 'lost', '2.1.1')).toEqual({ from: 'live', to: 'lost', addonVersion: '2.1.1' });
  });
});
