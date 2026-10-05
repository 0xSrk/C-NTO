import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** L'AddOn se compile dans NinjaTrader 8 (Windows), pas ici : on garde la forme du correctif. */
function flattenBody(): string {
  const src = readFileSync('ninjatrader/CantoBridge.cs', 'utf8');
  const start = src.indexOf('private JObject FlattenAccount(');
  const end = src.indexOf('private static bool IsTerminal(', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('AddOn · order.flatten', () => {
  it('aplatit aussi les instruments qui portent un ordre vivant, pas seulement les positions', () => {
    const body = flattenBody();
    expect(body).toMatch(/foreach \(Position position in account\.Positions\)/);
    expect(body).toMatch(/foreach \(Order order in account\.Orders\)/);
    expect(body).toMatch(/IsTerminal\(order\.OrderState\)/);
    expect(body).toMatch(/account\.Flatten\(instruments\)/);
    // Flatten hors des verrous : NinjaTrader met à jour ces collections pendant l'aplatissement.
    expect(body.lastIndexOf('lock (')).toBeLessThan(body.indexOf('account.Flatten(instruments)'));
  });

  it('annonce sa version : le panneau montre si l’AddOn corrigé est compilé', () => {
    expect(readFileSync('ninjatrader/CantoBridge.cs', 'utf8')).toContain('["addonVersion"] = "2.1.1"');
  });
});
