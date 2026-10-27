/**
 * @vitest-environment jsdom
 */
import { readdirSync, readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoAlert } from '@/engine/crypto/alerts';
import type { CryptoBar, CryptoMarketId, VenueState } from '@/engine/crypto/markets';
import type { CryptoDrawing } from '@/engine/crypto/persist';
import type { TemperatureReading } from '@/engine/crypto/temperature';
import type { IndicatorInstance, IndicatorLine } from '@/engine/indicators';
import type { CryptoMainStatus } from '@/lib/desk';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Le process principal simulé derrière `window.canto.crypto`, posé avant tout import (le desk le lit au chargement). Allumé,
 * trois venues `live` : le store ouvre ses flux, qui s'abonnent sans rien pousser ; l'historique ne répond jamais, pour que
 * les bougies soient celles que le test pose par `useCrypto.setState`.
 */
const fake = vi.hoisted(() => {
  const off: CryptoMainStatus = { enabled: false, venues: { coinbase: 'off', binance: 'off', bybit: 'off' } };
  const on: CryptoMainStatus = { enabled: true, venues: { coinbase: 'live', binance: 'live', bybit: 'live' } };
  const main = { status: on };
  const api = {
    status: vi.fn(async () => main.status),
    enable: vi.fn(async () => {
      main.status = on;
      return main.status;
    }),
    disable: vi.fn(async () => {
      main.status = off;
      return main.status;
    }),
    onStatus: vi.fn(() => () => {}),
    history: vi.fn(() => new Promise<never>(() => {})),
    subscribe: vi.fn(async () => ({ ok: true, subscriptionId: 'sub' })),
    unsubscribe: vi.fn(async () => ({ ok: true })),
    temperature: vi.fn(async () => null),
    onEvent: vi.fn(() => () => {}),
    onTemperature: vi.fn(() => () => {}),
  };
  (window as unknown as { canto: unknown }).canto = { crypto: api };
  return { api, main, off, on };
});

/** La table `settings` en mémoire ; `fail` fait refuser chaque écriture, comme une base pleine. */
const db = vi.hoisted(() => ({ rows: new Map<string, unknown>(), fail: false }));
vi.mock('@/store/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/db')>();
  return {
    ...actual,
    getSetting: vi.fn(async (key: string, fallback: unknown) => (db.rows.has(key) ? db.rows.get(key) : fallback)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      if (db.fail) throw new Error('QuotaExceededError');
      db.rows.set(key, structuredClone(value));
    }),
  };
});

interface ChartProps {
  bars: CryptoBar[];
  timeframe: number;
  lines: IndicatorLine[];
  onHover?: (info: unknown) => void;
  priceFormat?: { precision: number; minMove: number };
  priceLines?: { id: string; price: number; title: string; color: string }[];
}

/** Le chart (canevas) n'existe pas sous jsdom : chaque rendu y dépose ses props. */
const chart = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock('@/modules/visual/Chart', () => ({
  Chart: (props: unknown) => {
    chart.props.push(props);
    return null;
  },
}));

import { CHARTABLE_MARKETS, CRYPTO_MARKETS } from '@/engine/crypto/markets';
import p from '@/design/primitives.module.css';
import { useI18n } from '@/i18n';
import { fmtPrice } from '@/lib/format';
import Crypto from '@/modules/crypto/Crypto';
import { IndicatorCards } from '@/modules/visual/IndicatorCards';
import v from '@/modules/visual/visual.module.css';
import { useCrypto, type CryptoState } from '@/store/crypto';
import { useUi } from '@/store/ui';

const BTC: CryptoMarketId = 'coinbase:BTC-USD';
const ONE: CryptoMarketId = 'binance:ONEUSDT';
const T0 = Date.UTC(2026, 9, 11, 9, 0) / 1000;

const btcBars: CryptoBar[] = [
  { time: T0, open: 82_400, high: 82_610.5, low: 82_390.25, close: 82_500, volume: 12.5, buyVolume: 7 },
  { time: T0 + 3600, open: 82_500, high: 82_700, low: 82_450, close: 82_528.75, volume: 9.25, buyVolume: 4 },
];
const oneBars: CryptoBar[] = [
  { time: T0, open: 0.002151, high: 0.002171, low: 0.002149, close: 0.002163, volume: 1_250_000, buyVolume: 700_000 },
];

const lastChart = (): ChartProps => {
  const props = chart.props.at(-1);
  if (!props) throw new Error('chart jamais rendu');
  return props as ChartProps;
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  db.rows.clear();
  db.fail = false;
  fake.main.status = fake.on;
  for (const fn of Object.values(fake.api)) fn.mockClear();
  chart.props.length = 0;
  useI18n.setState({ locale: 'fr' });
  useUi.setState({ toasts: [] });
  // L'état d'ouverture du desk : rien n'est lu ; l'écoute des flux voit l'interrupteur éteint et arrête ceux d'un test précédent.
  useCrypto.setState(useCrypto.getInitialState(), true);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
});

async function mount(state: Partial<CryptoState> = {}): Promise<HTMLDivElement> {
  const node = document.createElement('div');
  document.body.appendChild(node);
  host = node;
  root = createRoot(node);
  await act(async () => root?.render(createElement(Crypto)));
  if (Object.keys(state).length > 0) await act(async () => useCrypto.setState(state));
  return node;
}

const set = (state: Partial<CryptoState>) => act(async () => useCrypto.setState(state));

/** Le texte lu d'un nœud, sans les feuilles de style que portent les composants de la planche (`<style>` de leurs SVG). */
function readText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const style of copy.querySelectorAll('style')) style.remove();
  return copy.textContent ?? '';
}

function buttons(node: ParentNode, text: string): HTMLButtonElement[] {
  return [...node.querySelectorAll('button')].filter((b) => readText(b).trim() === text);
}

function button(node: ParentNode, text: string): HTMLButtonElement {
  const found = buttons(node, text)[0];
  if (!found) throw new Error(`bouton « ${text} » introuvable`);
  return found;
}

const click = (el: HTMLElement) => act(async () => el.click());

/** Écrit dans un `<input>` ou un `<select>` contrôlé par React : le setter natif, puis l'événement que React écoute. */
async function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

/** Les actions de l'en-tête : le parent du sélecteur de marché. */
function headerActions(node: HTMLElement): HTMLElement {
  const select = node.querySelector('select');
  if (!select?.parentElement) throw new Error('sélecteur de marché introuvable');
  return select.parentElement;
}

const sideTitles = (node: HTMLElement): string[] => [...node.querySelectorAll(`.${v.sideTitle}`)].map((el) => el.firstElementChild?.textContent ?? '');

/** La section de la colonne dont le titre commence par `title`. */
function section(node: HTMLElement, title: string): HTMLElement {
  const head = [...node.querySelectorAll(`.${v.sideTitle}`)].find((el) => (el.firstElementChild?.textContent ?? '').startsWith(title));
  if (!head?.parentElement) throw new Error(`section « ${title} » introuvable`);
  return head.parentElement;
}

/** Les `Regle` d'une section : [libellé, valeur] (`<span>libellé</span><i /><span>valeur</span>`). */
const rules = (el: HTMLElement): [string, string][] => [...el.querySelectorAll(`.${p.regle}`)].map((r) => [r.children[0]?.textContent ?? '', r.children[2]?.textContent ?? '']);

const legend = (node: HTMLElement): string => node.querySelector(`.${v.legend}`)?.textContent ?? '';
const stamp = (node: HTMLElement): string => node.querySelector(`.${v.stamp}`)?.textContent ?? '';
const dialog = (): HTMLElement | null => document.body.querySelector('[role="dialog"]');
const toasts = () => useUi.getState().toasts;

const instance = (id: string, definitionId: string, params: Record<string, number | string> = {}): IndicatorInstance => ({ id, definitionId, params, visible: true });

describe('CRY4.3 › en-tête', () => {
  it('en-tête 09 Crypto, quatre marchés dans l’ordre du registre, six timeframes', async () => {
    const node = await mount();
    const head = node.textContent ?? '';
    expect(node.querySelector('h1')?.textContent).toBe('09Crypto');
    expect(head).toContain('4 MARCHÉS · 3 VENUES');
    const select = node.querySelector('select');
    const options = [...(select?.querySelectorAll('option') ?? [])];
    expect(options.map((o) => o.value)).toEqual([...CHARTABLE_MARKETS]);
    expect(options.map((o) => o.textContent)).toEqual(['BTC-USD · Coinbase', 'ONDO-USD · Coinbase', 'ONEUSDT · Binance', 'ZIGUSDT · Bybit']);
    expect(select?.value).toBe(BTC);
    const tfs = [...headerActions(node).querySelectorAll('button')];
    expect(tfs.map((b) => b.textContent)).toEqual(['1m', '5m', '15m', '1h', '4h', '1j']);
    expect(tfs.find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent).toBe('1h');
  });

  it('1d en anglais et en espagnol', async () => {
    const node = await mount();
    for (const locale of ['en', 'es'] as const) {
      await act(async () => useI18n.setState({ locale }));
      expect([...headerActions(node).querySelectorAll('button')].map((b) => b.textContent)).toEqual(['1m', '5m', '15m', '1h', '4h', '1d']);
    }
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(node.textContent).toContain('4 MARKETS · 3 VENUES');
  });

  it('flux : la barre dit « données périmées » si stale ou reconnecting, rien sinon ; sans plaque LINK, le direct se lit sur la puce du chart (OROS4.10)', async () => {
    const node = await mount();
    const tags = () => [...headerActions(node).querySelectorAll('span')].map((el) => el.textContent);
    expect(headerActions(node).querySelector('[role="img"]')).toBeNull();
    expect(tags()).not.toContain('données périmées');
    for (const state of ['stale', 'reconnecting'] as const) {
      await set({ venues: { coinbase: state, binance: 'live', bybit: 'live' } });
      expect(tags()).toContain('données périmées');
    }
    for (const state of ['connecting', 'blocked', 'off', 'live'] as const) {
      await set({ venues: { coinbase: state, binance: 'live', bybit: 'live' } });
      expect(tags()).not.toContain('données périmées');
    }
    expect(tags().join(' ')).not.toMatch(/direct/);
  });

  it('le sélecteur et le Segmented écrivent dans le store', async () => {
    const node = await mount();
    await setValue(node.querySelector('select') as HTMLSelectElement, ONE);
    expect(useCrypto.getState().market).toBe(ONE);
    await click(button(headerActions(node), '4h'));
    expect(useCrypto.getState().timeframe).toBe(240);
  });
});

describe('CRY4.3 › chart et légende', () => {
  it('ouvre le chart au montage et le ferme au démontage', async () => {
    await mount();
    expect(useCrypto.getState().chartOpen).toBe(true);
    act(() => root?.unmount());
    root = null;
    expect(useCrypto.getState().chartOpen).toBe(false);
  });

  it('BTC à 2 décimales ; après setMarket(ONE), 6 décimales dans la légende et le priceFormat du chart', async () => {
    const node = await mount({ bars: btcBars });
    expect(legend(node)).toContain('BTC-USD · 1h');
    expect(legend(node)).toContain(`C ${fmtPrice(82_528.75, 2)}`);
    expect(legend(node)).toContain(`O ${fmtPrice(82_500, 2)}`);
    expect(lastChart().priceFormat).toEqual({ precision: 2, minMove: 0.01 });
    expect(lastChart().bars).toBe(useCrypto.getState().bars);

    await act(async () => {
      await useCrypto.getState().setMarket(ONE);
    });
    await set({ bars: oneBars });
    expect(legend(node)).toContain('ONEUSDT · 1h');
    expect(legend(node)).toContain(`C ${fmtPrice(0.002163, 6)}`);
    expect(fmtPrice(0.002163, 6)).toMatch(/0.002163/);
    expect(lastChart().priceFormat).toEqual({ precision: 6, minMove: 0.000001 });
  });

  it('chaque marché passe la précision et le pas du registre', async () => {
    await mount();
    for (const id of CHARTABLE_MARKETS) {
      await act(async () => {
        await useCrypto.getState().setMarket(id);
      });
      const spec = CRYPTO_MARKETS.find((m) => m.id === id);
      expect(lastChart().priceFormat).toEqual({ precision: spec?.precision, minMove: spec?.tickSize });
    }
  });

  it('ancrage du CVD : « CVD depuis HH:MM » quand l’ancre existe, « CVD Binance » quand il est visible', async () => {
    const node = await mount({ bars: btcBars });
    expect(legend(node)).not.toContain('CVD depuis');
    await set({ cvdAnchoredAt: T0 + 3600 });
    expect(legend(node)).toContain('CVD depuis 10:00');
    expect(legend(node)).not.toContain('CVD Binance');
    await set({ indicators: [...useCrypto.getState().indicators, instance('i_bin', 'cvd-binance')] });
    expect(legend(node)).toContain('CVD Binance');
  });

  it('ancrage du CVD : sur la deuxième ligne de la légende, jamais sur la première, que la puce recouvre', async () => {
    const node = await mount({ bars: btcBars, cvdAnchoredAt: T0 + 3600 });
    await set({ indicators: [...useCrypto.getState().indicators, instance('i_bin', 'cvd-binance')] });
    const main = node.querySelector(`.${v.legendMain}`) as HTMLElement;
    const rows = [...node.querySelectorAll(`.${v.legendRow}`)];
    expect(main.textContent).toContain('BTC-USD · 1h');
    expect(main.textContent).not.toContain('CVD');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('CVD depuis 10:00');
    expect(rows[0]?.textContent).toContain('CVD Binance');
    expect(main.nextElementSibling).toBe(rows[0]);
  });

  it('ancrage du CVD : sans ancre ni CVD Binance, la légende n’a pas de deuxième ligne', async () => {
    const node = await mount({ bars: btcBars });
    expect(node.querySelectorAll(`.${v.legendRow}`)).toHaveLength(0);
  });

  it('un code du process principal s’affiche en clair, jamais seul', async () => {
    const node = await mount({ bars: btcBars });
    await set({ chartError: 'rate_limited' });
    expect(legend(node)).toContain('Limite de requêtes');
    expect(legend(node)).not.toContain('rate_limited');
    await set({ chartError: 'no_history' });
    expect(legend(node)).toContain('Historique indisponible');
    await set({ chartError: 'code_inconnu' });
    expect(legend(node)).not.toMatch(/^code_inconnu$/);
    expect(legend(node)).toMatch(/refus/i);
  });

  it('puce : « Historique » avant le premier tick, « Coinbase · direct » ensuite, « Coinbase · figé » sur une venue périmée', async () => {
    const node = await mount({ bars: btcBars });
    expect(stamp(node)).toBe('Historique');
    await set({ bars: [...btcBars.slice(0, 1), { ...btcBars[1]!, close: 82_530 }] });
    expect(stamp(node)).toBe('Coinbase · direct');
    await set({ venues: { coinbase: 'stale', binance: 'live', bybit: 'live' } });
    expect(stamp(node)).toBe('Coinbase · figé');
    await set({ venues: { coinbase: 'live', binance: 'live', bybit: 'live' } });
    await act(async () => {
      await useCrypto.getState().setMarket(ONE);
    });
    expect(stamp(node)).toBe('Historique');
  });

  it('tracés du marché en priceLines : violet, titre AGENT pour l’agent, sinon le label ; les autres marchés à part', async () => {
    const drawings: CryptoDrawing[] = [
      { id: 'd1', market: BTC, kind: 'level', price: 82_000, author: 'agent', createdAt: 1 },
      { id: 'd2', market: BTC, kind: 'level', price: 83_000, label: 'Support', author: 'trader', createdAt: 2 },
      { id: 'd3', market: BTC, kind: 'zone', from: 81_000, to: 81_500, author: 'trader', createdAt: 3 },
      { id: 'd4', market: ONE, kind: 'level', price: 0.0021, author: 'trader', createdAt: 4 },
    ];
    await mount({ drawings });
    const color = 'rgb(169, 150, 224)';
    expect(lastChart().priceLines).toEqual([
      { id: 'd1', price: 82_000, title: 'AGENT', color },
      { id: 'd2', price: 83_000, title: 'Support', color },
      { id: 'd3:from', price: 81_000, title: '', color },
      { id: 'd3:to', price: 81_500, title: '', color },
    ]);
    // Le titre suit la langue, sans attendre un changement de tracé.
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(lastChart().priceLines?.[0]?.title).toBe('AGENTE');
  });

  it('onHover garde son identité d’un rendu à l’autre', async () => {
    await mount({ bars: btcBars });
    const first = lastChart().onHover;
    await set({ bars: [...btcBars] });
    await set({ venues: { coinbase: 'stale', binance: 'live', bybit: 'live' } });
    expect(first).toBeTypeOf('function');
    expect(lastChart().onHover).toBe(first);
  });

  it('une ligne inchangée garde sa référence quand un autre indicateur change (copie des bougies mémorisée)', async () => {
    await mount({ bars: btcBars });
    const cvd = lastChart().lines.find((l) => l.key === 'i_cvd:cvd');
    expect(cvd).toBeDefined();
    await act(async () => {
      await useCrypto.getState().addIndicator('ema');
    });
    const after = lastChart().lines;
    expect(after.some((l) => l.key.endsWith(':ema'))).toBe(true);
    expect(after.find((l) => l.key === 'i_cvd:cvd')?.data).toBe(cvd?.data);
    expect(useCrypto.getState().bars).toBe(lastChart().bars);
  });
});

describe('CRY4.3 › catalogue d’indicateurs', () => {
  const catalogNames = (node: HTMLElement) => [...node.querySelectorAll(`.${v.catalogItem} span`)].map((el) => el.textContent);

  it('CVD Binance proposé seulement pour un marché qui a une source Binance', async () => {
    const node = await mount();
    await click(button(section(node, 'Indicateurs'), 'Ajouter'));
    expect(catalogNames(node)).toContain('Delta de volume cumulé · Binance');
    await act(async () => {
      await useCrypto.getState().setMarket(ONE);
    });
    expect(catalogNames(node)).not.toContain('Delta de volume cumulé · Binance');
    expect(catalogNames(node)).toContain('Delta de volume cumulé');
  });

  it('en 1j, ni VWAP 00:00 UTC ni niveaux du jour UTC : ni proposés, ni calculés', async () => {
    const node = await mount({ bars: btcBars });
    expect(lastChart().lines.some((l) => l.key.startsWith('i_vwap:'))).toBe(true);
    await act(async () => {
      await useCrypto.getState().setTimeframe(1440);
    });
    await set({ bars: btcBars });
    expect(lastChart().lines.some((l) => l.key.startsWith('i_vwap:'))).toBe(false);
    expect(lastChart().lines.some((l) => l.key === 'i_cvd:cvd')).toBe(true);
    await click(button(section(node, 'Indicateurs'), 'Ajouter'));
    expect(catalogNames(node)).not.toContain('VWAP 00:00 UTC');
    expect(catalogNames(node)).not.toContain('Niveaux du jour UTC précédent');
    expect(sideTitles(node)[1]).toBe('Indicateurs · 1');
  });

  it('CVD Binance d’un marché sans source : ni carte ni ligne', async () => {
    await mount({ bars: oneBars });
    await act(async () => {
      await useCrypto.getState().setMarket(ONE);
    });
    await set({ bars: oneBars, indicators: [...useCrypto.getState().indicators, instance('i_bin', 'cvd-binance')] });
    expect(lastChart().lines.some((l) => l.key.startsWith('i_bin:'))).toBe(false);
  });

  it('OROS4.7 plus de note d’accroche sous le catalogue, ni sur l’onglet crypto ni dans Visual', async () => {
    const node = await mount();
    expect(node.textContent).not.toContain('forgé par le Lab');
    const props = { instances: [], catalog: [], nameOf: (_: string, f: string) => f, descOf: (_: string, f: string) => f, onAdd: () => {}, onToggle: () => {}, onUpdate: () => {}, onRemove: () => {} };
    const other = document.createElement('div');
    document.body.appendChild(other);
    const otherRoot = createRoot(other);
    await act(async () => otherRoot.render(createElement(IndicatorCards, props)));
    expect(other.textContent).not.toContain('forgé par le Lab');
    act(() => otherRoot.unmount());
  });

  it('EMA et ATR : une copie crypto, sans Nasdaq ni points', async () => {
    const node = await mount();
    await set({ indicators: [instance('a', 'ema', { period: 21 }), instance('b', 'atr', { period: 14 })] });
    for (const locale of ['fr', 'en', 'es'] as const) {
      await act(async () => useI18n.setState({ locale }));
      const text = section(node, locale === 'fr' ? 'Indicateurs' : locale === 'en' ? 'Indicators' : 'Indicadores').textContent ?? '';
      expect(text).not.toMatch(/Nasdaq|NQ|points|puntos/);
    }
  });
});

describe('CRY4.3 › colonne', () => {
  it('titres dans l’ordre exact', async () => {
    const node = await mount();
    expect(sideTitles(node)).toEqual(['Marchés · 4', 'Indicateurs · 2', 'Température · Binance', 'Alertes · 0', 'Source', 'Agent']);
  });

  it('une ligne par marché : prix à la précision du marché, variation signée, âge de la mise à jour ; un clic change le marché', async () => {
    const now = Date.now();
    const node = await mount({
      tickers: {
        [BTC]: { market: BTC, last: 82_528.75, change24hPct: 1.25, time: now - 3000 },
        [ONE]: { market: ONE, last: 0.002163, change24hPct: -2.5, time: now - 1000 },
      },
    });
    const markets = section(node, 'Marchés');
    const text = markets.textContent ?? '';
    expect(text).toContain(fmtPrice(82_528.75, 2));
    expect(text).toContain(fmtPrice(0.002163, 6));
    // `Etiquette` passe en capitales par sa feuille ; le texte garde la casse du nom.
    expect(text).toContain('[ Coinbase ]');
    expect(text).toContain('[ Binance ]');
    expect(text).toMatch(/mis à jour il y a \d+s/);
    expect(text).not.toMatch(/dernier trade/i);
    expect(markets.querySelector('.pos')?.textContent).toMatch(/^\+1,25/);
    expect(markets.querySelector('.neg')?.textContent).toMatch(/2,50/);
    const row = [...markets.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('ONEUSDT'));
    await click(row as HTMLButtonElement);
    expect(useCrypto.getState().market).toBe(ONE);
  });

  it('température : une règle par lecture, par côté des liquidations et par actif de l’open interest, et le minorant écrit', async () => {
    const now = Date.now();
    const temperature: TemperatureReading = {
      funding: { median: 0.00003, btc: 0.0001, symbols: 300, at: now },
      breadth: { upShare: 0.38, pairs: 400, at: now },
      liquidations: { long: 4_100_000, short: 1_200_000, since: now - 3_600_000, at: now, lowerBound: true },
      openInterest: { btc: 0.024, eth: -0.011, at: now },
    };
    const node = await mount({ temperature });
    const side = section(node, 'Température');
    expect(rules(side)).toEqual([
      ['Funding médian', '+0,0030 %'],
      ['Largeur 24 h', '38 %'],
      ['Liq. 1 h · long', '4,1 M$'],
      ['Liq. 1 h · short', '1,2 M$'],
      ['OI 24 h · BTC', '+2,4 %'],
      ['OI 24 h · ETH', '-1,1 %'],
    ]);
    expect(side.textContent).toMatch(/minorant/);
    // Sans lecture : les six règles restent, avec des tirets.
    await set({ temperature: null });
    expect(rules(section(node, 'Température')).map(([, value]) => value)).toEqual(['—', '—', '—', '—', '—', '—']);
  });

  it('chaque règle de la colonne tient sur une ligne : 24 signes au plus, libellé et valeur, en trois langues', async () => {
    // Colonne de 240 à 255 px (300 moins le filet, deux marges de 16, la bande de 12 de la plaque, et 0 à 15 de barre de
    // défilement), règle en 12 px mono : 8,4 px par signe et deux intervalles de 10 px. 24 signes laissent au moins 18 px au
    // filet pointillé (mesuré dans le navigateur). Les valeurs sont les plus longues attendues.
    const now = Date.now();
    const temperature: TemperatureReading = {
      funding: { median: -0.000125, btc: -0.0001, symbols: 300, at: now },
      breadth: { upShare: 1, pairs: 400, at: now },
      liquidations: { long: 123_400_000, short: 612_000, since: now - 3_600_000, at: now, lowerBound: true },
      openInterest: { btc: 0.123, eth: -0.123, at: now },
    };
    const node = await mount({ temperature, venues: { coinbase: 'reconnecting', binance: 'reconnecting', bybit: 'reconnecting' } });
    for (const locale of ['fr', 'en', 'es'] as const) {
      await act(async () => useI18n.setState({ locale }));
      const temp = rules(section(node, locale === 'fr' ? 'Température' : locale === 'en' ? 'Temperature' : 'Temperatura'));
      const source = rules(section(node, locale === 'es' ? 'Fuente' : 'Source'));
      expect(temp, locale).toHaveLength(6);
      expect(source, locale).toHaveLength(3);
      for (const [label, value] of [...temp, ...source]) expect(label.length + value.length, `${locale} : ${label} · ${value}`).toBeLessThanOrEqual(24);
    }
  });

  it('Source : venues et leurs voyants, données publiques, « Éteindre le module » appelle disable puis l’état vide', async () => {
    const node = await mount({ bars: btcBars });
    const source = section(node, 'Source');
    expect(source.textContent).toContain('2 bougies');
    expect(source.textContent).toContain('Données publiques des exchanges, usage personnel.');
    for (const name of ['Coinbase', 'Binance', 'Bybit']) expect(source.textContent).toContain(name);
    await click(button(source, 'Éteindre le module'));
    expect(fake.api.disable).toHaveBeenCalledTimes(1);
    expect(node.textContent).toContain('Module crypto éteint');
    expect(button(node, 'Activer le module crypto').className).toContain('chamfer');
  });

  it('Agent : les dernières écritures, heure, outil et effet', async () => {
    const at = Date.UTC(2026, 9, 11, 14, 5);
    const node = await mount({ agentLog: [{ at, tool: 'crypto_alert_set', effect: 'Alerte créée : prix au-dessus de 85000 · BTC-USD · Coinbase' }] });
    const text = section(node, 'Agent').textContent ?? '';
    expect(text).toContain('14:05');
    expect(text).toContain('crypto_alert_set');
    expect(text).toContain('Alerte créée');
  });

  it('Agent : l’effet occupe toute la largeur et se coupe n’importe où, un mot long ne fait pas défiler la colonne', async () => {
    const effect = 'Niveau tracé : BTC-USD · Coinbase à Résistance_hebdomadaire_très_longue_sans_espace_82100.123456789';
    const node = await mount({ agentLog: [{ at: Date.now(), tool: 'crypto_drawing_set', effect }] });
    const cell = [...section(node, 'Agent').querySelectorAll(`.${v.tradeRow} > span`)].find((el) => el.textContent === effect) as HTMLElement | undefined;
    expect(cell, 'cellule de l’effet').toBeDefined();
    expect(cell?.style.gridColumn).toBe('1 / -1');
    expect(cell?.style.minWidth).toBe('0px');
    expect(cell?.style.overflowWrap).toBe('anywhere');
  });
});

describe('CRY4.3 › interrupteur', () => {
  it('éteint : l’état vide de CRY0.4, sans chart ni colonne', async () => {
    fake.main.status = fake.off;
    const node = await mount();
    expect(node.textContent).toContain('Module crypto éteint');
    expect(node.querySelector('select')).toBeNull();
    expect(sideTitles(node)).toEqual([]);
    expect(chart.props).toHaveLength(0);
  });

  it('le bouton d’activation reste désactivé tant que le dialogue du process principal n’a pas répondu', async () => {
    fake.main.status = fake.off;
    let answer: (status: CryptoMainStatus) => void = () => {};
    fake.api.enable.mockImplementationOnce(
      () =>
        new Promise<CryptoMainStatus>((resolve) => {
          answer = resolve;
        }),
    );
    const node = await mount();
    const enable = button(node, 'Activer le module crypto');
    await click(enable);
    expect(enable.disabled).toBe(true);
    await click(enable);
    expect(fake.api.enable).toHaveBeenCalledTimes(1);
    await act(async () => answer(fake.on));
    expect(node.textContent).not.toContain('Module crypto éteint');
  });

  it('« Éteindre le module » désactivé pendant l’appel ; un échec du process principal : toast, pas de rejet non géré', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      let fail: (e: Error) => void = () => {};
      fake.api.disable.mockImplementationOnce(
        () =>
          new Promise<CryptoMainStatus>((_, reject) => {
            fail = reject;
          }),
      );
      const node = await mount();
      const off = button(node, 'Éteindre le module');
      await click(off);
      expect(off.disabled).toBe(true);
      await click(off);
      expect(fake.api.disable).toHaveBeenCalledTimes(1);
      await act(async () => fail(new Error('canal fermé')));
      await act(async () => new Promise((r) => setTimeout(r, 0)));
      expect(off.disabled).toBe(false);
      expect(toasts().some((t) => t.tone === 'warn')).toBe(true);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('activation refusée par un canal en échec : toast, et le bouton revient', async () => {
    fake.main.status = fake.off;
    fake.api.enable.mockRejectedValueOnce(new Error('canal fermé'));
    const node = await mount();
    const enable = button(node, 'Activer le module crypto');
    await click(enable);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(enable.disabled).toBe(false);
    expect(toasts().some((t) => t.tone === 'warn')).toBe(true);
  });
});

describe('CRY4.3 › écritures refusées', () => {
  it('une écriture que la base refuse : toast, et aucun rejet non géré', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const node = await mount();
      db.fail = true;
      await click(button(headerActions(node), '5m'));
      await act(async () => new Promise((r) => setTimeout(r, 0)));
      expect(toasts().map((t) => t.tone)).toContain('warn');
      expect(toasts().at(-1)?.text).toMatch(/Enregistrement impossible/);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('un refus du store : toast en clair, jamais le code seul', async () => {
    const node = await mount();
    await set({ indicators: Array.from({ length: 50 }, (_, i) => instance(`e${i}`, 'ema', { period: 20 })) });
    await click(button(section(node, 'Indicateurs'), 'Ajouter'));
    const ema = [...node.querySelectorAll(`.${v.catalogItem}`)].find((el) => el.querySelector('small')?.textContent === 'EMA');
    await click(ema as HTMLButtonElement);
    const last = toasts().at(-1);
    expect(last?.tone).toBe('warn');
    expect(last?.text).toContain('50');
    expect(last?.text).not.toBe('indicators_full');
    expect(last?.text).not.toContain('indicators_full');
  });
});

describe('CRY4.3 › alertes', () => {
  const now = Date.now();
  const priceAlert: CryptoAlert = { id: 'a1', target: BTC, kind: 'price_above', level: 85_000, mode: 'once', author: 'trader', state: 'armed', createdAt: now };
  const fundingAlert: CryptoAlert = { id: 'a2', target: 'temperature', kind: 'funding_median_above', level: 0.01, mode: 'rearm', author: 'agent', state: 'armed', createdAt: now };

  it('une ligne par alerte ; « non évaluée » avec sa raison sur une donnée qui n’est pas en direct ; [ AGENT ]', async () => {
    const venues: Record<'coinbase' | 'binance' | 'bybit', VenueState> = { coinbase: 'stale', binance: 'live', bybit: 'live' };
    const node = await mount({ alerts: [priceAlert, fundingAlert], venues, temperature: null });
    const alerts = section(node, 'Alertes');
    expect(sideTitles(node)[3]).toBe('Alertes · 2');
    const text = alerts.textContent ?? '';
    // Le seuil se lit d'un trait (OROS3.5a) : symbole du marché, glyphe du sens nommé pour les lecteurs d'écran, niveau.
    expect(text).toContain('BTC-USD');
    expect(alerts.querySelector('[aria-label="au-dessus de"]')).not.toBeNull();
    expect(text).toContain(fmtPrice(85_000, 2));
    expect(text.match(/\[ AGENT \]/g)).toHaveLength(1);
    expect(text.match(/non évaluée/g)).toHaveLength(2);
    expect(text).toMatch(/non évaluée · Coinbase/);

    await set({
      venues: { coinbase: 'live', binance: 'live', bybit: 'live' },
      tickers: { [BTC]: { market: BTC, last: 82_000, change24hPct: 0, time: Date.now() } },
      temperature: {
        funding: { median: 0.00009, btc: null, symbols: 300, at: Date.now() },
        breadth: null,
        liquidations: { long: 0, short: 0, since: Date.now(), at: Date.now(), lowerBound: true },
        openInterest: null,
      },
    });
    expect(section(node, 'Alertes').textContent).not.toContain('non évaluée');

    // Un relevé du funding plus vieux que deux cadences : l'alerte n'est plus évaluée.
    await set({
      temperature: {
        funding: { median: 0.00009, btc: null, symbols: 300, at: Date.now() - 10 * 60_000 },
        breadth: null,
        liquidations: { long: 0, short: 0, since: Date.now(), at: Date.now(), lowerBound: true },
        openInterest: null,
      },
    });
    expect((section(node, 'Alertes').textContent ?? '').match(/non évaluée/g)).toHaveLength(1);
  });

  it('la fenêtre d’alerte : pas du prix, erreur en clair, indication de l’unité du funding, création', async () => {
    const node = await mount();
    await click(button(section(node, 'Alertes'), 'Ajouter'));
    const modal = dialog();
    expect(modal).not.toBeNull();
    const [target, kind] = [...(modal?.querySelectorAll('select') ?? [])] as HTMLSelectElement[];
    expect(target?.value).toBe(BTC);
    expect([...(kind?.querySelectorAll('option') ?? [])].map((o) => o.value)).toEqual(['price_above', 'price_below']);

    // L'aide d'un prix dit le pas de cotation du marché, pour repère : aucun nombre de décimales n'est promis (ni contrôlé).
    for (const [locale, text] of [
      ['en', 'Price in USD; the market quotes in steps of 0.01.'],
      ['es', 'Precio en USD; el mercado cotiza en pasos de 0,01.'],
      ['fr', 'Prix en USD ; le marché cote au pas de 0,01.'],
    ] as const) {
      await act(async () => useI18n.setState({ locale }));
      expect(dialog()?.textContent, locale).toContain(text);
      expect(dialog()?.textContent, locale).not.toMatch(/décimales au plus|decimals at most|decimales como máximo/);
    }

    // Niveau vide : refus du store, affiché en clair.
    await click(button(modal as HTMLElement, 'Créer l’alerte'));
    expect(modal?.textContent).toMatch(/Niveau invalide/);
    expect(modal?.textContent).not.toContain('bad_level');

    await setValue(target as HTMLSelectElement, 'temperature');
    const kinds = [...((dialog()?.querySelectorAll('select')[1] as HTMLSelectElement | undefined)?.querySelectorAll('option') ?? [])].map((o) => o.value);
    expect(kinds).toEqual(['funding_median_above', 'funding_median_below', 'liquidations_long_1h_above', 'liquidations_short_1h_above', 'breadth_above', 'breadth_below']);
    const hint = dialog()?.textContent ?? '';
    expect(hint).toContain('0.01 = 0,01 %');
    expect(hint).toMatch(/franchissement/);
    expect(hint).toMatch(/première lecture/);

    await setValue(dialog()?.querySelector('select') as HTMLSelectElement, BTC);
    await setValue(dialog()?.querySelector('input') as HTMLInputElement, '90000');
    await click(button(dialog() as HTMLElement, 'Créer l’alerte'));
    expect(useCrypto.getState().alerts).toMatchObject([{ target: BTC, kind: 'price_above', level: 90_000, mode: 'once', author: 'trader', state: 'armed' }]);
    expect(dialog()).toBeNull();
    expect(section(node, 'Alertes').textContent).toContain(fmtPrice(90_000, 2));
  });
});

describe('CRY4.3 › design', () => {
  it('aucune couleur hex dans src/modules/crypto', () => {
    const files = readdirSync('src/modules/crypto').map((name) => `src/modules/crypto/${name}`);
    expect(files).toContain('src/modules/crypto/crypto.module.css');
    for (const path of files) expect(readFileSync(path, 'utf8'), path).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('crypto.module.css : jetons seulement, aucun --lab', () => {
    const css = readFileSync('src/modules/crypto/crypto.module.css', 'utf8');
    expect(css).not.toContain('--lab');
    expect(css).not.toMatch(/rgba?\(/);
  });

  it('OROS4.10 la colonne a la marge de celle de Visual : le châssis n’a plus de plaque verticale au bord droit', async () => {
    const node = await mount();
    const side = node.querySelector('aside');
    expect(side?.className).toBe(v.side);
    expect(readFileSync('src/modules/crypto/crypto.module.css', 'utf8')).not.toMatch(/\.side\s*\{/);
    expect(readFileSync('src/app/shell.module.css', 'utf8')).not.toMatch(/\.edge\s*\{/);
  });

  it('l’onglet importe la feuille de Visual, sans copie', () => {
    const source = readFileSync('src/modules/crypto/Crypto.tsx', 'utf8');
    expect(source).toMatch(/from '\.\.\/visual\/visual\.module\.css'/);
  });
});
