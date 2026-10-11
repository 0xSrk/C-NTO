/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import p from '@/design/primitives.module.css';
import { CRYPTO_INDICATORS } from '@/engine/crypto/indicators';
import { INDICATORS, type IndicatorInstance } from '@/engine/indicators';
import { useI18n, type Locale } from '@/i18n';
import { cryptoIndicatorDesc, cryptoIndicatorName } from '@/modules/crypto/indicatorCopy';
import { IndicatorCards, trIndicatorDesc, trIndicatorName, trParamLabel } from '@/modules/visual/IndicatorCards';
import v from '@/modules/visual/visual.module.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Le graphique (canevas) n'existe pas sous jsdom : le panneau d'indicateurs de Visual est tout ce que ce test regarde.
vi.mock('@/modules/visual/Chart', () => ({ Chart: () => null }));

import Visual from '@/modules/visual/Visual';
import { useBars } from '@/store/bars';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useI18n.setState({ locale: 'fr' });
});

async function mount(element: ReturnType<typeof createElement>): Promise<HTMLDivElement> {
  const node = document.createElement('div');
  document.body.appendChild(node);
  host = node;
  root = createRoot(node);
  await act(async () => root?.render(element));
  return node;
}

function button(node: ParentNode, text: string): HTMLButtonElement {
  const found = [...node.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text);
  if (!found) throw new Error(`bouton « ${text} » introuvable`);
  return found as HTMLButtonElement;
}

/** Un bouton du catalogue, retrouvé par le nom que porte son `<span>` (le `<small>` d'abréviation précède). */
function catalogItem(node: ParentNode, name: string): HTMLButtonElement {
  const found = [...node.querySelectorAll('button')].find((b) => b.querySelector('span')?.textContent === name);
  if (!found) throw new Error(`entrée de catalogue « ${name} » introuvable`);
  return found as HTMLButtonElement;
}

/** Saisie dans un `<input>` contrôlé par React : l'écriture passe par le setter natif, sinon React ne voit rien. */
function type(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ───────────────────────────── Visual garde ses cartes ─────────────────────────────

/** Quatre instances : paramètre numérique, paramètre à choix (masqué), sans paramètre, et une définition inconnue (écartée). */
const INSTANCES: IndicatorInstance[] = [
  { id: 'a', definitionId: 'ema', params: { period: 21 }, visible: true },
  { id: 'b', definitionId: 'vwap', params: { bands: '1' }, visible: false },
  { id: 'c', definitionId: 'prev-session', params: {}, visible: true },
  { id: 'd', definitionId: 'inconnu', params: {}, visible: true },
];

const PLUS = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="2"><path d="M8 3v10M3 8h10"></path></svg>';

/** Le marquage de `Visual.tsx` avant l'extraction des cartes (CRY4.2), écrit à la main avec les vraies classes des deux modules. */
const HEAD = `<div class="${v.sideTitle}"><span>Indicateurs · 4</span><button type="button" class="${p.btn} ${p.ghost} ${p.sm}">${PLUS} Ajouter</button></div>`;
const CATALOG =
  `<div class="${v.catalog}">` +
  [
    ['EMA', 'Moyenne mobile exponentielle'],
    ['SMA', 'Moyenne mobile simple'],
    ['VWAP', 'VWAP de séance'],
    ['OR', 'Opening Range (RTH)'],
    ['PDH/PDL', 'Niveaux séance précédente'],
    ['ATR', 'Average True Range'],
    ['RVOL', 'Volume relatif'],
  ]
    .map(([short, name]) => `<button class="${v.catalogItem}"><small>${short}</small><span>${name}</span></button>`)
    .join('') +
  '</div>';
const toggle = (on: boolean) => `<button type="button" class="${p.toggle}${on ? ` ${p.on}` : ''}" role="switch" aria-checked="${on}"><span class="${p.toggleTrack}"></span></button>`;
const head = (on: boolean, name: string) => `<div class="${v.indicatorHead}">${toggle(on)}<b>${name}</b><button aria-label="Retirer">×</button></div>`;
const CARDS =
  `<div class="${v.indicator}">${head(true, 'Moyenne mobile exponentielle')}<div class="${v.params}"><label>Période<input min="2" max="500" step="1" type="number" value="21"></label></div><div class="${v.desc}">Tendance court/moyen terme. Les scalpers Nasdaq surveillent souvent EMA 9 / 21 sur 1–5 min.</div></div>` +
  `<div class="${v.indicator} ${v.off}">${head(false, 'VWAP de séance')}<div class="${v.params}"><label>Bandes<select><option value="0">Aucune</option><option value="1">±1σ</option><option value="2">±1σ et ±2σ</option></select></label></div><div class="${v.desc}">Prix moyen pondéré par le volume, réinitialisé à chaque séance Globex (18:00 ET). Bandes ±1σ / ±2σ.</div></div>` +
  `<div class="${v.indicator}">${head(true, 'Niveaux séance précédente')}<div class="${v.desc}">Plus haut, plus bas et clôture de la séance précédente : supports/résistances suivis par la majorité des intervenants.</div></div>`;
const LAB = `<p class="${v.desc}">Chaque nouvel indicateur forgé par le Lab rejoint ce catalogue avec ses paramètres : le graphique évolue avec la méthode du trader.</p>`;

const spies = {
  addIndicator: vi.fn(async () => {}),
  updateIndicator: vi.fn(async () => {}),
  toggleIndicator: vi.fn(async () => {}),
  removeIndicator: vi.fn(async () => {}),
};

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockClear();
  useBars.setState({ ready: true, series: [], activeId: null, indicators: INSTANCES, ...spies });
});

/** La section « Indicateurs » de la colonne de Visual : la première de `<aside>`. */
const panel = (node: HTMLElement) => node.querySelector('aside')?.children[0] as HTMLElement;

describe('CRY4.2 Visual garde le rendu de son panneau d’indicateurs', () => {
  it('rend le marquage d’avant l’extraction, catalogue fermé', async () => {
    const node = await mount(createElement(Visual));
    expect(panel(node).outerHTML).toBe(`<div class="${v.sideSection}">${HEAD}${CARDS}${LAB}</div>`);
  });

  it('ouvre le catalogue par « Ajouter », avec le même marquage', async () => {
    const node = await mount(createElement(Visual));
    await act(async () => button(panel(node), 'Ajouter').click());
    expect(panel(node).outerHTML).toBe(`<div class="${v.sideSection}">${HEAD}${CATALOG}${CARDS}${LAB}</div>`);
    await act(async () => button(panel(node), 'Ajouter').click());
    expect(panel(node).outerHTML).toBe(`<div class="${v.sideSection}">${HEAD}${CARDS}${LAB}</div>`);
  });

  it('garde son comportement : ajout (catalogue refermé), bascule, retrait, paramètres', async () => {
    const node = await mount(createElement(Visual));
    await act(async () => button(panel(node), 'Ajouter').click());
    await act(async () => catalogItem(panel(node), 'Moyenne mobile simple').click());
    expect(spies.addIndicator).toHaveBeenCalledExactlyOnceWith('sma');
    expect(panel(node).querySelector(`.${v.catalog}`)).toBeNull();

    const switches = panel(node).querySelectorAll<HTMLButtonElement>('[role="switch"]');
    await act(async () => switches[1]?.click());
    expect(spies.toggleIndicator).toHaveBeenCalledExactlyOnceWith('b');

    const removes = panel(node).querySelectorAll<HTMLButtonElement>('button[aria-label="Retirer"]');
    await act(async () => removes[2]?.click());
    expect(spies.removeIndicator).toHaveBeenCalledExactlyOnceWith('c');

    // Paramètre numérique : rien dans le store tant que la saisie n'est pas validée (Entrée), puis la valeur saisie.
    const period = panel(node).querySelector<HTMLInputElement>('input[type="number"]');
    await act(async () => type(period as HTMLInputElement, '34'));
    expect(spies.updateIndicator).not.toHaveBeenCalled();
    await act(async () => period?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(spies.updateIndicator).toHaveBeenCalledExactlyOnceWith('a', { period: 34 });

    // Paramètre à choix : la valeur du `<option>` choisi.
    const bands = panel(node).querySelector<HTMLSelectElement>('select');
    await act(async () => {
      (bands as HTMLSelectElement).value = '2';
      bands?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(spies.updateIndicator).toHaveBeenLastCalledWith('b', { bands: '2' });
  });

  it('suit la langue : titre, bouton, noms et descriptions', async () => {
    useI18n.setState({ locale: 'en' });
    const node = await mount(createElement(Visual));
    const text = panel(node).textContent ?? '';
    expect(text).toContain('Indicators · 4');
    expect(text).toContain('Add');
    expect(text).toContain('Exponential moving average');
    expect(text).toContain('Period');
    expect(text).toContain('Previous session high, low and close: supports/resistances watched by most participants.');
    expect(text).toContain('Each new indicator forged by the Lab joins this catalog');
  });
});

// ───────────────────────────── Le composant partagé ─────────────────────────────

type CardsProps = Parameters<typeof IndicatorCards>[0];

function cards(props: Partial<CardsProps> = {}) {
  const calls = { onAdd: vi.fn(), onToggle: vi.fn(), onUpdate: vi.fn(), onRemove: vi.fn() };
  const all: CardsProps = { instances: INSTANCES.slice(0, 2), catalog: INDICATORS, nameOf: trIndicatorName, descOf: trIndicatorDesc, ...calls, ...props };
  return { props: all, calls };
}

describe('CRY4.2 IndicatorCards', () => {
  it('rend une carte par instance, et le titre compte les instances', async () => {
    const node = await mount(createElement(IndicatorCards, cards().props));
    const found = node.querySelectorAll(`.${v.indicator}`);
    expect(found).toHaveLength(2);
    expect(node.querySelector(`.${v.sideTitle} span`)?.textContent).toBe('Indicateurs · 2');
    expect(found[0]?.classList.contains(v.off as string)).toBe(false);
    expect(found[1]?.classList.contains(v.off as string)).toBe(true);
  });

  it('Toggle appelle onToggle avec l’identifiant de l’instance', async () => {
    const { props, calls } = cards();
    const node = await mount(createElement(IndicatorCards, props));
    const switches = node.querySelectorAll<HTMLButtonElement>('[role="switch"]');
    await act(async () => switches[1]?.click());
    expect(calls.onToggle).toHaveBeenCalledExactlyOnceWith('b');
    await act(async () => switches[0]?.click());
    expect(calls.onToggle).toHaveBeenLastCalledWith('a');
    expect(calls.onRemove).not.toHaveBeenCalled();
  });

  it('× appelle onRemove avec l’identifiant de l’instance', async () => {
    const { props, calls } = cards();
    const node = await mount(createElement(IndicatorCards, props));
    const removes = node.querySelectorAll<HTMLButtonElement>('button[aria-label="Retirer"]');
    expect(removes).toHaveLength(2);
    expect(removes[0]?.textContent).toBe('×');
    await act(async () => removes[1]?.click());
    expect(calls.onRemove).toHaveBeenCalledExactlyOnceWith('b');
    expect(calls.onToggle).not.toHaveBeenCalled();
  });

  it('« Ajouter » ouvre le catalogue ; choisir une entrée appelle onAdd puis referme', async () => {
    const { props, calls } = cards();
    const node = await mount(createElement(IndicatorCards, props));
    expect(node.querySelector(`.${v.catalog}`)).toBeNull();
    await act(async () => button(node, 'Ajouter').click());
    const items = [...node.querySelectorAll(`.${v.catalogItem}`)];
    expect(items.map((item) => item.querySelector('small')?.textContent)).toEqual(INDICATORS.map((def) => def.short));
    await act(async () => catalogItem(node, 'Moyenne mobile exponentielle').click());
    expect(calls.onAdd).toHaveBeenCalledExactlyOnceWith('ema');
    expect(node.querySelector(`.${v.catalog}`)).toBeNull();
  });

  it('les paramètres remontent par onUpdate : nombre à la validation, choix au changement', async () => {
    const { props, calls } = cards();
    const node = await mount(createElement(IndicatorCards, props));
    const period = node.querySelector<HTMLInputElement>('input[type="number"]');
    await act(async () => type(period as HTMLInputElement, '34'));
    expect(calls.onUpdate).not.toHaveBeenCalled();
    await act(async () => period?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(calls.onUpdate).toHaveBeenCalledExactlyOnceWith('a', { period: 34 });
    const bands = node.querySelector<HTMLSelectElement>('select');
    await act(async () => {
      (bands as HTMLSelectElement).value = '0';
      bands?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(calls.onUpdate).toHaveBeenLastCalledWith('b', { bands: '0' });
  });

  it('lit le catalogue et la copie reçus : nom, description, abréviation, instance hors catalogue écartée', async () => {
    const nameOf = vi.fn((id: string, fallback: string) => `N·${id}·${fallback}`);
    const descOf = vi.fn((id: string, fallback: string) => `D·${id}·${fallback}`);
    const instances: IndicatorInstance[] = [
      { id: 'x1', definitionId: 'cvd', params: {}, visible: true },
      { id: 'x2', definitionId: 'vwap', params: { bands: '1' }, visible: true },
      { id: 'x3', definitionId: 'ema', params: { period: 21 }, visible: true },
    ];
    const catalog = CRYPTO_INDICATORS.filter((def) => def.id !== 'ema');
    const node = await mount(createElement(IndicatorCards, cards({ instances, catalog, nameOf, descOf }).props));
    // « vwap » et « ema » ne sont pas dans ce catalogue : pas de carte, mais le titre compte les trois instances.
    expect(node.querySelector(`.${v.sideTitle} span`)?.textContent).toBe('Indicateurs · 3');
    expect(node.querySelectorAll(`.${v.indicator}`)).toHaveLength(1);
    const cvd = CRYPTO_INDICATORS.find((def) => def.id === 'cvd');
    expect(node.querySelector(`.${v.indicatorHead} b`)?.textContent).toBe(`N·cvd·${cvd?.name}`);
    expect(node.querySelector(`.${v.indicator} .${v.desc}`)?.textContent).toBe(`D·cvd·${cvd?.description}`);
    expect(node.querySelector(`.${v.params}`)).toBeNull();

    await act(async () => button(node, 'Ajouter').click());
    const items = [...node.querySelectorAll(`.${v.catalogItem}`)];
    expect(items.map((item) => item.querySelector('small')?.textContent)).toEqual(catalog.map((def) => def.short));
    expect(items.map((item) => item.querySelector('span')?.textContent)).toEqual(catalog.map((def) => `N·${def.id}·${def.name}`));
  });

  it('rend, pour les mêmes entrées, exactement le marquage de Visual', async () => {
    const node = await mount(createElement(IndicatorCards, cards({ instances: INSTANCES }).props));
    expect(node.innerHTML).toBe(`<div class="${v.sideSection}">${HEAD}${CARDS}${LAB}</div>`);
    await act(async () => button(node, 'Ajouter').click());
    expect(node.innerHTML).toBe(`<div class="${v.sideSection}">${HEAD}${CATALOG}${CARDS}${LAB}</div>`);
  });

  it('traduit le titre, le bouton et les libellés de paramètres dans les trois langues', async () => {
    const labels: Record<Locale, string[]> = {
      fr: ['Indicateurs · 4', 'Ajouter', 'Période', 'Bandes', 'Aucune'],
      en: ['Indicators · 4', 'Add', 'Period', 'Bands', 'None'],
      es: ['Indicadores · 4', 'Añadir', 'Periodo', 'Bandas', 'Ninguna'],
    };
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      const node = await mount(createElement(IndicatorCards, cards({ instances: INSTANCES }).props));
      const text = node.textContent ?? '';
      for (const label of labels[locale]) expect(text, `${locale} · ${label}`).toContain(label);
      act(() => root?.unmount());
      node.remove();
      root = null;
      host = null;
    }
  });

  it('se réaffiche quand la langue change, sans que le parent y soit abonné', async () => {
    const node = await mount(createElement(IndicatorCards, cards().props));
    expect(node.textContent).toContain('Indicateurs · 2');
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(node.textContent).toContain('Indicadores · 2');
  });

  it('ne lit aucun store : tout arrive par les props', () => {
    const source = readFileSync('src/modules/visual/IndicatorCards.tsx', 'utf8');
    expect(source).not.toMatch(/from '@\/store/);
    expect(source).not.toMatch(/from '\.\.?\/[^']*store/);
    expect(source).toContain("from './visual.module.css'");
  });

  it('garde la copie de Visual : noms, descriptions et libellés', () => {
    expect(trIndicatorName('ema', 'repli')).toBe('Moyenne mobile exponentielle');
    expect(trIndicatorName('atr', 'repli')).toBe('Average True Range');
    expect(trIndicatorName('inconnu', 'repli')).toBe('repli');
    expect(trIndicatorDesc('sma', 'repli')).toBe('Moyenne arithmétique des clôtures. SMA 200 = référence de tendance long terme.');
    expect(trIndicatorDesc('inconnu', 'repli')).toBe('repli');
    expect(trParamLabel('Bandes')).toBe('Bandes');
    expect(trParamLabel('Autre')).toBe('Autre');
    useI18n.setState({ locale: 'en' });
    expect(trIndicatorName('volume-ma', 'repli')).toBe('Relative volume');
    expect(trParamLabel('±1σ et ±2σ')).toBe('±1σ and ±2σ');
    expect(trParamLabel('Durée (min)')).toBe('Duration (min)');
  });
});

// ───────────────────────────── La copie du catalogue crypto ─────────────────────────────

const CRYPTO_IDS = ['cvd', 'cvd-binance', 'vwap-utc', 'levels-utc'] as const;

const NAMES: Record<(typeof CRYPTO_IDS)[number], Record<Locale, string>> = {
  cvd: { fr: 'Delta de volume cumulé', en: 'Cumulative volume delta', es: 'Delta de volumen acumulado' },
  'cvd-binance': { fr: 'Delta de volume cumulé · Binance', en: 'Cumulative volume delta · Binance', es: 'Delta de volumen acumulado · Binance' },
  'vwap-utc': { fr: 'VWAP 00:00 UTC', en: 'VWAP 00:00 UTC', es: 'VWAP 00:00 UTC' },
  'levels-utc': { fr: 'Niveaux du jour UTC précédent', en: 'Previous UTC day levels', es: 'Niveles del día UTC anterior' },
};

describe('CRY4.2 indicatorCopy', () => {
  it('donne le nom des quatre indicateurs crypto dans les trois langues', () => {
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      for (const id of CRYPTO_IDS) expect(cryptoIndicatorName(id, 'repli'), `${locale} · ${id}`).toBe(NAMES[id][locale]);
    }
  });

  it('donne une description par langue, distincte, qui dit ce que l’indicateur calcule', () => {
    const facts: Record<(typeof CRYPTO_IDS)[number], RegExp> = {
      cvd: /Coinbase/,
      'cvd-binance': /BTCUSDT/,
      'vwap-utc': /00:00 UTC/,
      'levels-utc': /00:00.*24:00 UTC/,
    };
    for (const id of CRYPTO_IDS) {
      const byLocale = {} as Record<Locale, string>;
      for (const locale of ['fr', 'en', 'es'] as const) {
        useI18n.setState({ locale });
        byLocale[locale] = cryptoIndicatorDesc(id, 'repli');
        expect(byLocale[locale], `${locale} · ${id}`).not.toBe('repli');
        expect(byLocale[locale].length, `${locale} · ${id}`).toBeGreaterThan(40);
        expect(byLocale[locale], `${locale} · ${id}`).toMatch(facts[id]);
      }
      expect(new Set(Object.values(byLocale)).size, id).toBe(3);
    }
  });

  it('décrit chaque CVD pour ce qu’il lit : le marché du chart, ou la série Binance', () => {
    useI18n.setState({ locale: 'fr' });
    expect(cryptoIndicatorDesc('cvd', '')).toContain('cumulé bougie après bougie');
    expect(cryptoIndicatorDesc('cvd-binance', '')).toContain('un autre marché que celui du chart');
    useI18n.setState({ locale: 'en' });
    expect(cryptoIndicatorDesc('cvd-binance', '')).toContain('Binance USDT series');
    useI18n.setState({ locale: 'es' });
    expect(cryptoIndicatorDesc('vwap-utc', '')).toContain('00:00 UTC');
  });

  it('se replie sur la copie de Visual pour tout autre identifiant, et sur le repli pour un inconnu', () => {
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      for (const id of ['ema', 'sma', 'volume-ma', 'atr']) {
        expect(cryptoIndicatorName(id, 'repli')).toBe(trIndicatorName(id, 'repli'));
        expect(cryptoIndicatorDesc(id, 'repli')).toBe(trIndicatorDesc(id, 'repli'));
        expect(cryptoIndicatorName(id, 'repli')).not.toBe('repli');
        expect(cryptoIndicatorDesc(id, 'repli')).not.toBe('repli');
      }
      expect(cryptoIndicatorName('inconnu', 'nom de repli')).toBe('nom de repli');
      expect(cryptoIndicatorDesc('inconnu', 'description de repli')).toBe('description de repli');
    }
  });

  it('couvre tout le catalogue crypto : hors du français, aucune entrée ne retombe sur son texte français', () => {
    for (const locale of ['en', 'es'] as const) {
      useI18n.setState({ locale });
      for (const def of CRYPTO_INDICATORS) {
        // « VWAP 00:00 UTC » et « Average True Range » s'écrivent pareil dans les trois langues.
        if (def.id !== 'vwap-utc' && def.id !== 'atr') expect(cryptoIndicatorName(def.id, def.name), `${locale} · ${def.id}`).not.toBe(def.name);
        expect(cryptoIndicatorDesc(def.id, def.description), `${locale} · ${def.id}`).not.toBe(def.description);
      }
    }
  });

  it('ne porte que du texte : ni couleur, ni store', () => {
    const source = readFileSync('src/modules/crypto/indicatorCopy.ts', 'utf8');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/from '@\/store/);
  });
});
