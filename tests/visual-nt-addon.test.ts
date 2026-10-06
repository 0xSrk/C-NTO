/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bar } from '@/engine/bars';
import { createNt8Port, type FeedEvent, type HistoryRequest, type Nt8Transport, type SubscribeRequest } from '@/engine/marketdata';
import { useI18n } from '@/i18n';
import { contractsSeen, ntContract, quarterlyMonth } from '@/modules/visual/ntContract';
import { NtFollowPanel, useNtFollow, type NtFollowInput } from '@/modules/visual/NtFollowPanel';
import { followNt } from '@/modules/visual/ntFollow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Bornes de `System.DateTime` en secondes epoch : au-delà, `AddSeconds` lève une exception. */
const DATETIME_MIN_S = -62_135_596_800;
const DATETIME_MAX_S = 253_402_300_799;
const NOW = Date.UTC(2026, 9, 6, 14, 2, 30);
const NOW_S = Math.floor(NOW / 1000);

/**
 * Faux AddOn 2.2.0, tel que le renderer le voit à travers le process principal (`marketdata:*`).
 * Lu dans `ninjatrader/CantoBridge.cs` :
 * - `History` lit `from` et `to` en secondes (`FromUnixSeconds` = `DateTime(1970).AddSeconds`) ; hors de
 *   `DateTime`, l'exception part en erreur -32000, que le process principal rend `{ ok: false, detail }` ;
 * - `SubscribeMarket` et `History` résolvent `Instrument.GetInstrument(nom)` et lèvent « instrument inconnu »
 *   si NinjaTrader ne le trouve pas : il connaît le contrat complet (`NQ 12-26`) ;
 * - les barres sont datées à leur clôture, en secondes ; `OnLiveBar` les envoie sous `Instrument.FullName`.
 * `resolveRoot` simule un NinjaTrader qui résoudrait une racine seule (`NQ`) en contrat du mois.
 */
function addon22(opts: { resolveRoot?: boolean } = {}) {
  const listeners = new Set<(event: FeedEvent) => void>();
  const histories: HistoryRequest[] = [];
  const subscribes: SubscribeRequest[] = [];
  const contracts = ['NQ 12-26', 'MNQ 12-26', 'NQ 03-27', 'ES 12-26'];
  const getInstrument = (name: string): string | null => {
    const key = name.trim().toUpperCase();
    const exact = contracts.find((full) => full === key);
    if (exact) return exact;
    return opts.resolveRoot ? (contracts.find((full) => full.startsWith(`${key} `)) ?? null) : null;
  };
  const transport: Nt8Transport = {
    async history(req) {
      histories.push({ ...req });
      for (const s of [req.from, req.to]) {
        if (!(s >= DATETIME_MIN_S && s <= DATETIME_MAX_S)) {
          return { ok: false, detail: 'The added or subtracted value results in an un-representable DateTime.\r\nParameter name: value' };
        }
      }
      if (!getInstrument(req.instrument)) return { ok: false, detail: 'instrument inconnu' };
      const step = req.timeframe * 60;
      const bars: Bar[] = [];
      for (let close = Math.floor(req.to / step) * step; close >= req.from && bars.length < 12; close -= step) {
        bars.unshift({ time: close, open: 21_000, high: 21_010, low: 20_990, close: 21_005, volume: 100 });
      }
      return { ok: true, bars };
    },
    async subscribe(req) {
      subscribes.push({ ...req });
      return getInstrument(req.instrument) ? { ok: true, subscriptionId: `s${subscribes.length}` } : { ok: false, detail: 'instrument inconnu' };
    },
    async unsubscribe() {
      return { ok: true };
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  /** `OnLiveBar` : la barre part sous le nom complet du contrat abonné. */
  const liveBar = (asked: string, timeframe: number, close: number, final = false) => {
    const instrument = getInstrument(asked) ?? asked;
    const event: FeedEvent = { kind: 'bar', instrument, timeframe, bar: { time: close, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }, final };
    for (const cb of listeners) cb(event);
  };
  return { transport, histories, subscribes, liveBar };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useI18n.setState({ locale: 'fr' });
  vi.useRealTimers();
});

/** Visual réduit au suivi : le crochet, le bloc de la colonne, et le nombre de barres que le graphique recevrait. */
function Probe(props: NtFollowInput) {
  const follow = useNtFollow(props);
  return createElement('div', { 'data-bars': follow.bars ? String(follow.bars.length) : 'none' }, createElement(NtFollowPanel, { follow }));
}

async function mount(props: NtFollowInput): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(Probe, props)));
  return host;
}

function type(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('A13.4 Visual suit NinjaTrader avec l’AddOn 2.2.0 réel', () => {
  it('demande cinq jours en secondes jusqu’à maintenant, reçoit l’historique puis le direct sous le nom complet', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const addon = addon22();
    const histories: Bar[][] = [];
    const live: FeedEvent[] = [];
    const follow = followNt(createNt8Port(addon.transport), 'NQ 12-26', 5, (bars) => histories.push(bars), (event) => live.push(event));
    await flush();

    expect(addon.histories).toEqual([{ instrument: 'NQ 12-26', timeframe: 5, from: NOW_S - 5 * 86_400, to: NOW_S }]);
    expect(histories).toHaveLength(1);
    expect(histories[0]?.length).toBe(12);
    // Datées à l'ouverture dans le desk : la dernière barre (clôture 14:00) ouvre à 13:55.
    expect(histories[0]?.at(-1)?.time).toBe(Date.UTC(2026, 9, 6, 13, 55) / 1000);
    expect(addon.subscribes).toEqual([{ instrument: 'NQ 12-26', kind: 'bars', timeframe: 5 }]);

    addon.liveBar('NQ 12-26', 5, Date.UTC(2026, 9, 6, 14, 5) / 1000);
    expect(live.filter((event) => event.kind === 'bar')).toHaveLength(1);
    follow.stop();
  });

  it('le port garde les barres renvoyées sous le nom complet, même demandées autrement', async () => {
    const T = Date.UTC(2026, 9, 6, 14, 5) / 1000;
    const strict = addon22();
    const seen: FeedEvent[] = [];
    createNt8Port(strict.transport).subscribe!({ instrument: 'nq 12-26', kind: 'bars', timeframe: 5 }, (event) => seen.push(event));
    await flush();
    strict.liveBar('NQ 12-26', 5, T);
    strict.liveBar('NQ 03-27', 5, T);
    strict.liveBar('NQ 12-26', 1, T);
    expect(seen.filter((event) => event.kind === 'bar').map((event) => (event.kind === 'bar' ? `${event.instrument}|${event.timeframe}` : ''))).toEqual(['NQ 12-26|5']);

    // Si NinjaTrader résolvait la racine, ses barres arriveraient sous `NQ 12-26` : la racine suivie les garde.
    const lenient = addon22({ resolveRoot: true });
    const rooted: FeedEvent[] = [];
    createNt8Port(lenient.transport).subscribe!({ instrument: 'NQ', kind: 'bars', timeframe: 5 }, (event) => rooted.push(event));
    await flush();
    lenient.liveBar('NQ', 5, T);
    lenient.liveBar('MNQ 12-26', 5, T);
    expect(rooted.filter((event) => event.kind === 'bar').map((event) => (event.kind === 'bar' ? event.instrument : ''))).toEqual(['NQ 12-26']);
  });

  it('un refus de l’AddOn remonte à l’appelant au lieu d’être avalé', async () => {
    const addon = addon22();
    const errors: string[] = [];
    const histories: Bar[][] = [];
    followNt(createNt8Port(addon.transport), 'NQ', 5, (bars) => histories.push(bars), undefined, (detail: string) => errors.push(detail));
    await flush();
    expect(histories).toEqual([]);
    expect(errors).toEqual(['instrument inconnu']);
    expect(addon.subscribes).toEqual([]);

    // Abonnement refusé après un historique servi : l'échec remonte aussi.
    const refusing = addon22();
    refusing.transport.subscribe = async () => ({ ok: false, detail: 'abonnement refusé' });
    const later: string[] = [];
    followNt(createNt8Port(refusing.transport), 'NQ 12-26', 5, () => undefined, undefined, (detail: string) => later.push(detail));
    await flush();
    expect(later).toEqual(['abonnement refusé']);
  });
});

describe('A13.4 contrat demandé à NinjaTrader', () => {
  const at = (iso: string) => Date.parse(iso);

  it('échéance trimestrielle : bascule le jeudi 8 jours avant le 3e vendredi, heure de New York', () => {
    expect(quarterlyMonth(at('2026-10-06T14:00:00Z'))).toBe('12-26');
    expect(quarterlyMonth(at('2026-12-09T20:00:00Z'))).toBe('12-26');
    // 3e vendredi de décembre 2026 : le 18 ; bascule le jeudi 10.
    expect(quarterlyMonth(at('2026-12-10T15:00:00Z'))).toBe('03-27');
    expect(quarterlyMonth(at('2026-03-11T15:00:00Z'))).toBe('03-26');
    expect(quarterlyMonth(at('2026-03-12T15:00:00Z'))).toBe('06-26');
  });

  it('prend le contrat vu sur le pont, sinon l’échéance trimestrielle, sinon rien', () => {
    const now = at('2026-10-06T14:00:00Z');
    const seen = contractsSeen(
      [{ positions: [{ instrument: 'MNQ 12-26', quantity: 2 }, { instrument: 'ES 12-26', quantity: 0 }] }],
      ['nq 03-27', 'CL 11-26', 'MNQ 12-26'],
    );
    expect(seen).toEqual(['MNQ 12-26', 'NQ 03-27', 'CL 11-26']);
    expect(ntContract('NQ', seen, now)).toBe('NQ 03-27');
    expect(ntContract('MNQ', seen, now)).toBe('MNQ 12-26');
    expect(ntContract('ES', seen, now)).toBe('ES 12-26');
    expect(ntContract('CL', seen, now)).toBe('CL 11-26');
    expect(ntContract('CL', [], now)).toBeNull();
    expect(ntContract('GC', [], now)).toBeNull();
    expect(ntContract('nq 06-27', seen, now)).toBe('NQ 06-27');
    expect(ntContract('XYZ', seen, now)).toBeNull();
  });

  it('le bloc demande le contrat complet, et dit l’échec au trader dans sa langue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const addon = addon22();
    const node = await mount({ instrument: 'NQ', timeframe: 5, transport: addon.transport, seen: [] });
    const input = node.querySelector('input') as HTMLInputElement;
    const button = node.querySelector('button') as HTMLButtonElement;
    expect(input.value).toBe('NQ 12-26');
    expect(button.textContent).toBe('Suivre le pont');

    await act(async () => {
      button.click();
      await flush();
    });
    expect(addon.histories).toEqual([{ instrument: 'NQ 12-26', timeframe: 5, from: NOW_S - 5 * 86_400, to: NOW_S }]);
    expect(node.querySelector('[data-bars]')?.getAttribute('data-bars')).toBe('12');
    expect(input.disabled).toBe(true);
    expect(node.querySelector('[role="alert"]')).toBeNull();

    // Arrêt, puis un contrat que NinjaTrader ne connaît pas : le refus de l'AddOn s'affiche.
    await act(async () => button.click());
    expect(node.querySelector('[data-bars]')?.getAttribute('data-bars')).toBe('none');
    await act(async () => type(input, 'nq 06-27'));
    await act(async () => {
      button.click();
      await flush();
    });
    expect(addon.histories.at(-1)?.instrument).toBe('NQ 06-27');
    const alert = () => node.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert()).toBe('NinjaTrader ne connaît pas « NQ 06-27 ». Saisissez le contrat tel que NinjaTrader l’écrit, racine et échéance (NQ 12-26).');
    expect(node.querySelector('[data-bars]')?.getAttribute('data-bars')).toBe('none');
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(alert()).toBe('NinjaTrader does not know “NQ 06-27”. Enter the contract as NinjaTrader writes it, root and expiry (NQ 12-26).');
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(alert()).toBe('NinjaTrader no conoce « NQ 06-27 ». Introduzca el contrato tal como lo escribe NinjaTrader, raíz y vencimiento (NQ 12-26).');

    // Une racine seule n'est pas un contrat : rien ne part, le trader est invité à le compléter.
    await act(async () => useI18n.setState({ locale: 'fr' }));
    const sent = addon.histories.length;
    await act(async () => type(input, 'NQ'));
    await act(async () => {
      button.click();
      await flush();
    });
    expect(addon.histories).toHaveLength(sent);
    expect(alert()).toBe('Saisissez le contrat NinjaTrader complet de NQ, par exemple NQ 12-26.');
  });

  it('hors du desk installé, le bloc le dit au lieu de se taire', async () => {
    const node = await mount({ instrument: 'NQ', timeframe: 5, seen: [] });
    await act(async () => (node.querySelector('button') as HTMLButtonElement).click());
    expect(node.querySelector('[role="alert"]')?.textContent).toBe('Le pont NinjaTrader n’est pas ouvert : Visual suit NinjaTrader depuis le desk installé.');
  });
});
