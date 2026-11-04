import { describe, expect, it } from 'vitest';
import { limitReachedAt } from '@/engine/discipline';
import type { Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

/**
 * OROS5.48u — une limite abaissée en cours de journée : deux lectures étaient possibles (dater la fermeture du changement
 * de limite, ou de la sortie passée qui atteint la nouvelle limite). La garde garde la seconde, celle du code (CLAUDE.md
 * § 2.5) : la journée est rejouée avec la limite en vigueur à l'instant (`limitReachedAt`). Dans les deux lectures, la
 * journée est fermée dès le changement ; seule l'heure dite diffère.
 */
const et = (day: string, hhmm: string) => zonedToUtc(day, hhmm, ET_ZONE);
const DAY = '2026-10-06';
const SIM = 'SimApex1';
const trade = (id: string, exit: string, pnl: number): Trade => ({ id, sessionId: 's6', instrument: 'MNQ', account: SIM, direction: 'long', qty: 1, entryTime: et(DAY, exit) - 600_000, exitTime: et(DAY, exit), entryPrice: 0, exitPrice: 0, pnl, commission: 0 });

describe('OROS5.48u · la fermeture née d’une limite abaissée date de la sortie qui l’atteint', () => {
  const closed = [trade('a', '09:40', -200), trade('b', '10:20', -120), trade('c', '11:05', 50)];

  it('à 600 $, la journée reste ouverte ; abaissée à 300 $ à 12:00, elle est fermée depuis 10:20 ET', () => {
    expect(limitReachedAt(closed, { day: DAY, account: SIM, limit: 600, until: et(DAY, '12:00') })).toBeNull();
    // perte réalisée : 200 à 09:40, 320 à 10:20 (la nouvelle limite est atteinte), 270 à 11:05 après le gain
    expect(limitReachedAt(closed, { day: DAY, account: SIM, limit: 300, until: et(DAY, '12:00') })).toBe(et(DAY, '10:20'));
  });

  it('le gain de 11:05, qui ramène la perte à 270 $, ne rouvre pas la journée', () => {
    expect(limitReachedAt(closed, { day: DAY, account: SIM, limit: 300, until: et(DAY, '11:30') })).toBe(et(DAY, '10:20'));
  });
});
