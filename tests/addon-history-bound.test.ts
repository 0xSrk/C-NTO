import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HISTORY_MAX_BARS, MAX_FRAME_BYTES } from '../electron/nt-bridge/protocol';

/**
 * SEC2.9 — la borne d'historique vit aussi dans l'AddOn. SEC1.4 borne ce que le desk demande ; l'AddOn 2.2.0 rendait tout ce
 * que NinjaTrader lui donnait pour la fenêtre, jusqu'à 50 000 barres dans une trame, et rien ne garantit que NinjaTrader
 * s'en tienne à la fenêtre demandée. Une trame au-delà de la limite du desk ferme le lien, ordres en vol et kill switch
 * compris. L'AddOn 2.2.1 ne rend jamais plus de barres que le desk n'en demande, les plus récentes.
 *
 * L'AddOn se compile dans NinjaTrader 8 (Windows), pas ici : on garde la forme du correctif.
 */
const src = readFileSync('ninjatrader/CantoBridge.cs', 'utf8').replace(/\r\n/g, '\n');

function historyBody(): string {
  const start = src.indexOf('private JObject History(JObject p)');
  const end = src.indexOf('private JObject SubmitOrder(JObject p)', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('SEC2.9 AddOn · marketdata.history borné', () => {
  it('la borne de l’AddOn est celle du desk, et une trame de cette taille tient sous sa limite', () => {
    const bound = Number(/private const int HistoryMaxBars = (\d+);/.exec(src)?.[1]);
    expect(bound).toBe(HISTORY_MAX_BARS);
    // Une barre telle que l'AddOn l'écrit, aux prix d'un NQ : 2 000 d'entre elles, l'enveloppe en plus.
    const bar = JSON.stringify({ time: 1_794_268_800, open: 25_123.25, high: 25_131.75, low: 25_118.5, close: 25_127.25, volume: 12_345 });
    expect(bound * (bar.length + 1) + 256).toBeLessThan(MAX_FRAME_BYTES);
  });

  it('History ne rend que les barres les plus récentes, HistoryMaxBars au plus, sans autre plafond écrit en dur', () => {
    const body = historyBody();
    expect(body).toContain('int count = Math.Min(request.Bars.Count, HistoryMaxBars);');
    expect(body).toContain('int start = Math.Max(0, request.Bars.Count - count);');
    expect(body).toMatch(/for \(int i = start; i < request\.Bars\.Count; i\+\+\)/);
    expect(body).not.toMatch(/Math\.Min\(request\.Bars\.Count, \d+\)/);
    expect(src).not.toContain('50000');
  });

  it('annonce sa version : le panneau du pont montre si l’AddOn borné est compilé', () => {
    expect(src).toContain('["addonVersion"] = "2.2.1"');
    expect([...src.matchAll(/\["addonVersion"\] = "/g)]).toHaveLength(1);
  });
});
