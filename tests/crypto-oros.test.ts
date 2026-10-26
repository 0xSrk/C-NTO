/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoAlert } from '@/engine/crypto/alerts';
import type { CryptoMarketId } from '@/engine/crypto/markets';
import type { CryptoMainStatus } from '@/lib/desk';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * OROS3.5 · l'onglet crypto au Système 4.0 « ΟΡΟΣ ». Le process principal simulé derrière `window.canto.crypto` (posé avant
 * tout import) : allumé, trois venues `live`, des flux qui s'abonnent sans rien pousser, un historique qui ne répond jamais.
 */
const fake = vi.hoisted(() => {
  const on: CryptoMainStatus = { enabled: true, venues: { coinbase: 'live', binance: 'live', bybit: 'live' } };
  const api = {
    status: vi.fn(async () => on),
    enable: vi.fn(async () => on),
    disable: vi.fn(async () => on),
    onStatus: vi.fn(() => () => {}),
    history: vi.fn(() => new Promise<never>(() => {})),
    subscribe: vi.fn(async () => ({ ok: true, subscriptionId: 'sub' })),
    unsubscribe: vi.fn(async () => ({ ok: true })),
    temperature: vi.fn(async () => null),
    onEvent: vi.fn(() => () => {}),
    onTemperature: vi.fn(() => () => {}),
  };
  (window as unknown as { canto: unknown }).canto = { crypto: api };
  return { api, on };
});

/** La table `settings` en mémoire : rien n'est lu, rien ne refuse. */
vi.mock('@/store/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/db')>();
  return { ...actual, getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback), setSetting: vi.fn(async () => undefined) };
});

/** Le chart (canevas) n'existe pas sous jsdom : chaque rendu y dépose ses props. */
const chart = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock('@/modules/visual/Chart', () => ({
  Chart: (props: unknown) => {
    chart.props.push(props);
    return null;
  },
}));

import p from '@/design/primitives.module.css';
import { useI18n } from '@/i18n';
import { fmtPrice } from '@/lib/format';
import { formatTimeLocal } from '@/lib/time';
import c from '@/modules/crypto/crypto.module.css';
import Crypto from '@/modules/crypto/Crypto';
import v from '@/modules/visual/visual.module.css';
import { useCrypto, type CryptoState } from '@/store/crypto';
import { useUi } from '@/store/ui';

const BTC: CryptoMarketId = 'coinbase:BTC-USD';
const NOW = Date.now();
const TRIGGERED_AT = NOW - 25 * 60_000;

const alert = (id: string, patch: Partial<CryptoAlert>): CryptoAlert => ({ id, target: BTC, kind: 'price_above', level: 85_000, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW, ...patch });

/** Deux seuils sur BTC (au-dessus armé, en dessous déclenché), un funding de l'agent, un seuil en pause. */
const ALERTS: CryptoAlert[] = [
  alert('up', {}),
  alert('down', { kind: 'price_below', level: 81_200, state: 'triggered', lastTriggeredAt: TRIGGERED_AT }),
  alert('funding', { target: 'temperature', kind: 'funding_median_above', level: 0.01, mode: 'rearm', author: 'agent' }),
  alert('paused', { level: 90_000, state: 'paused' }),
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  for (const fn of Object.values(fake.api)) fn.mockClear();
  chart.props.length = 0;
  useI18n.setState({ locale: 'fr' });
  useUi.setState({ toasts: [] });
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

/** La section de la colonne dont le titre commence par `title`. */
function section(node: HTMLElement, title: string): HTMLElement {
  const head = [...node.querySelectorAll(`.${v.sideTitle}`)].find((el) => visible(el.firstElementChild).startsWith(title));
  if (!head?.parentElement) throw new Error(`section « ${title} » introuvable`);
  return head.parentElement;
}

/** Le texte lu d'un nœud, sans les feuilles de style que portent les composants de la planche (`<style>` de leurs SVG). */
function visible(el: Element | null | undefined): string {
  if (!el) return '';
  const copy = el.cloneNode(true) as Element;
  for (const style of copy.querySelectorAll('style')) style.remove();
  return copy.textContent ?? '';
}

/** Les lignes d'alerte, dans l'ordre de la liste ; `title` : le titre de la section dans la langue active. */
const alertRows = (node: HTMLElement, title = 'Alertes'): HTMLElement[] => [...section(node, title).querySelectorAll<HTMLElement>(`.${c.alertRow}`)];
/** La plaque SIGNAL en tête de la section des alertes ; `title` : le titre de la section dans la langue active. */
const signalPlate = (node: HTMLElement, title = 'Alertes'): HTMLElement | null => section(node, title).querySelector(`.${c.alertHead} [role="img"]`);
const tagOf = (row: HTMLElement): HTMLElement | null => row.querySelector(`.${p.tag}`);
const levelOf = (row: HTMLElement): string | null => row.querySelector('[data-level]')?.getAttribute('data-level') ?? null;
const css = () => readFileSync('src/modules/crypto/crypto.module.css', 'utf8');
/** Le bloc de règles d'une classe de `crypto.module.css`. */
const rule = (name: string): string => new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css())?.[1] ?? '';

describe('OROS3.5a les alertes sont des signaux', () => {
  it('armée : signal de niveau 1 et étiquette « Armée » au trait tireté ; déclenchée : niveau 2, « Déclenchée » au trait plein', async () => {
    const node = await mount({ alerts: ALERTS });
    const [up, down, funding] = alertRows(node);
    expect(levelOf(up!)).toBe('1');
    expect(levelOf(funding!)).toBe('1');
    expect(levelOf(down!)).toBe('2');
    expect(tagOf(up!)?.textContent).toBe('Armée');
    expect(tagOf(down!)?.textContent).toBe('Déclenchée');
    // Le trait dit l'état : tireté pour ce qui est armé (prévu), plein pour ce qui a eu lieu.
    expect(tagOf(up!)?.classList.contains(c.planTag as string)).toBe(true);
    expect(tagOf(down!)?.classList.contains(c.planTag as string)).toBe(false);
    expect(rule('planTag')).toMatch(/border-style:\s*dashed/);
    // L'heure du franchissement reste lue, sous le seuil.
    expect(down!.textContent).toContain(formatTimeLocal(TRIGGERED_AT));
  });

  it('en pause : aucun signal, étiquette au trait pointillé', async () => {
    const node = await mount({ alerts: ALERTS });
    const paused = alertRows(node)[3]!;
    expect(levelOf(paused)).toBeNull();
    expect(tagOf(paused)?.textContent).toBe('En pause');
    expect(tagOf(paused)?.classList.contains(c.pauseTag as string)).toBe(true);
    expect(rule('pauseTag')).toMatch(/border-style:\s*dotted/);
  });

  it('le sens du seuil est un glyphe de la planche : flèche montante pour ≥, descendante pour ≤, nommée pour les lecteurs d’écran', async () => {
    const node = await mount({ alerts: ALERTS });
    const [up, down, funding] = alertRows(node);
    const glyph = (row: HTMLElement) => row.querySelector(`.${c.dirGlyph}`);
    expect(glyph(up!)?.querySelector('svg.skg-106')).not.toBeNull();
    expect(glyph(up!)?.getAttribute('aria-label')).toBe('au-dessus de');
    expect(glyph(down!)?.querySelector('svg.skg-107')).not.toBeNull();
    expect(glyph(down!)?.getAttribute('aria-label')).toBe('en dessous de');
    expect(glyph(funding!)?.querySelector('svg.skg-106')).not.toBeNull();
    // Le seuil se lit d'un trait : sujet, sens, niveau — le marché à sa précision, la température dans son unité.
    const value = (row: HTMLElement) => visible(row.querySelector(`.${c.alertValue}`));
    expect(value(up!)).toBe(`BTC-USD${fmtPrice(85_000, 2)}`);
    expect(value(down!)).toBe(`BTC-USD${fmtPrice(81_200, 2)}`);
    expect(value(funding!)).toBe('Funding médian+0,0100 %');
    // Le glyphe tient sur une ligne de 11 px : son trait est relevé pour rester lisible.
    expect(rule('dirGlyph')).toMatch(/width:\s*12px/);
    expect(css()).toMatch(/\.dirGlyph :global\(\.g106-1\)[^{]*\{[^}]*stroke-width/);
  });

  it('l’auteur et la raison d’une alerte non évaluée restent sous le seuil', async () => {
    const node = await mount({ alerts: ALERTS, venues: { coinbase: 'stale', binance: 'live', bybit: 'live' } });
    const [up, , funding] = alertRows(node);
    expect(funding!.textContent).toContain('[ AGENT ]');
    expect(up!.textContent).toMatch(/non évaluée · Coinbase/);
  });

  it('les états et les sens se disent dans les trois langues', async () => {
    const node = await mount({ alerts: ALERTS });
    for (const [locale, title, armed, triggered, paused, above] of [
      ['en', 'Alerts', 'Armed', 'Triggered', 'Paused', 'above'],
      ['es', 'Alertas', 'Armada', 'Disparada', 'En pausa', 'por encima de'],
    ] as const) {
      await act(async () => useI18n.setState({ locale }));
      const [up, down, , pause] = alertRows(node, title);
      expect(tagOf(up!)?.textContent, locale).toBe(armed);
      expect(tagOf(down!)?.textContent, locale).toBe(triggered);
      expect(tagOf(pause!)?.textContent, locale).toBe(paused);
      expect(up!.querySelector(`.${c.dirGlyph}`)?.getAttribute('aria-label'), locale).toBe(above);
    }
  });
});

describe('OROS3.5b la plaque SIGNAL ouvre la section des alertes, liée au marché du chart', () => {
  const ONE: CryptoMarketId = 'binance:ONEUSDT';
  const ticker = { [BTC]: { market: BTC, last: 82_487.05, change24hPct: -0.21, time: NOW } };
  /** Le texte d'une ligne de la plaque, par la classe de son master (`mgsignal-2` : WATCH / TARGET / STATE ; `mgsignal-6` : la pastille). */
  const slot = (plate: HTMLElement | null, cls: string): string => visible(plate?.querySelector(`text.${cls}`));

  it('cible le marché du chart, lit l’état de ses alertes (déclenchée avant armée) et le direct de son prix', async () => {
    const node = await mount({ alerts: ALERTS, tickers: ticker });
    const plate = signalPlate(node);
    expect(plate).not.toBeNull();
    expect(plate!.querySelector('svg.mg-signal')).not.toBeNull();
    // La plaque ouvre la section : avant la première ligne d'alerte.
    const head = section(node, 'Alertes').querySelector(`.${c.alertHead}`);
    const first = alertRows(node)[0];
    expect(head && first && head.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot(plate, 'mgsignal-2')).toBe('WATCHTARGET: BTC-USDSTATE: TRIGGERED');
    expect(slot(plate, 'mgsignal-6')).toBe('LIVE');
    expect(plate?.getAttribute('aria-label')).toBe('Signal : BTC-USD · alerte déclenchée · prix en direct');
  });

  it('armée seule : ARMED ; aucune alerte sur le marché : un tiret ; prix pas encore reçu ou venue périmée : pas de direct', async () => {
    const node = await mount({ alerts: [ALERTS[0]!, ALERTS[2]!], tickers: ticker });
    expect(slot(signalPlate(node), 'mgsignal-2')).toBe('WATCHTARGET: BTC-USDSTATE: ARMED');
    await act(async () => useCrypto.setState({ venues: { coinbase: 'stale', binance: 'live', bybit: 'live' } }));
    expect(slot(signalPlate(node), 'mgsignal-6')).toBe('—');
    await act(async () => useCrypto.setState({ market: ONE }));
    expect(slot(signalPlate(node), 'mgsignal-2')).toBe('WATCHTARGET: ONEUSDTSTATE: —');
    expect(slot(signalPlate(node), 'mgsignal-6')).toBe('—');
    expect(signalPlate(node)?.getAttribute('aria-label')).toBe('Signal : ONEUSDT · aucune alerte · prix pas en direct');
  });

  it('la légende dit les trois niveaux par leur forme ; seul le niveau 3 est rouge, et il n’écrit pas', async () => {
    const node = await mount({ alerts: ALERTS });
    const legend = section(node, 'Alertes').querySelector(`.${c.alertLegend}`);
    const signals = [...(legend?.querySelectorAll<HTMLElement>('[data-level]') ?? [])];
    expect(signals.map((el) => el.getAttribute('data-level'))).toEqual(['1', '2', '3']);
    expect(signals.map((el) => visible(el))).toEqual(['Repère', 'Attention', 'Borne franchie']);
    expect(signals.map((el) => el.classList.contains('sig-l3'))).toEqual([false, false, true]);
    // Encre et papier de la plaque posés par la zone : l'acier sur le panneau, jamais le rouge.
    expect(rule('alertHead')).toMatch(/--k:\s*var\(--text-1\)/);
    expect(rule('alertHead')).toMatch(/--p:\s*var\(--bg-1\)/);
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect([...(section(node, 'Alerts').querySelectorAll(`.${c.alertLegend} [data-level]`) ?? [])].map((el) => visible(el))).toEqual(['Marker', 'Attention', 'Limit crossed']);
    expect(signalPlate(node, 'Alerts')?.getAttribute('aria-label')).toMatch(/^Signal: BTC-USD · /);
  });
});
