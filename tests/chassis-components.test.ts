/**
 * @vitest-environment jsdom
 */
import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACCOUNT_ROW_GAP, ACCOUNT_ROW_H, ACCOUNT_ROWS_MIN } from '@/app/railFit';
import { Shell } from '@/app/Shell';
import { TABS } from '@/app/tabs';
import { ZoomControls } from '@/app/ZoomControls';
import { GLYPH_ID } from '@/design/micro/assets';
import { Panel } from '@/design/primitives';
import { useI18n } from '@/i18n';
import type { NtBridgeStatus } from '@/lib/desk';
import { useBridge } from '@/store/bridge';
import { useUi } from '@/store/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useUi.setState({ tab: 'metrique' });
  useBridge.setState({ nt: null });
  useI18n.setState({ locale: 'fr' });
});

/** Le statut du pont tel que le process principal le pousse : le lien et les comptes qu'il rapporte. */
const bridge = (link: NtBridgeStatus['link'], accountNames: string[]): NtBridgeStatus => ({
  link,
  port: 0,
  addonVersion: '2.2.0',
  ntVersion: '8.1',
  accounts: [],
  accountsAt: null,
  accountNames,
  heartbeatLatencyMs: 12,
  ordersOpen: link === 'live',
  ordersClosed: false,
  hasToken: true,
  extraAccounts: [],
  maxContractsPerOrder: 5,
  killSwitchShortcut: 'CommandOrControl+Shift+K',
});

const shellCss = readFileSync('src/app/shell.module.css', 'utf8').replace(/\r\n/g, '\n');
const primCss = readFileSync('src/design/primitives.module.css', 'utf8').replace(/\r\n/g, '\n');
/** Corps de la règle dont le sélecteur ouvre la ligne. */
const rule = (css: string, selector: string) => {
  const at = css.search(new RegExp(`^${selector.replace(/[.()]/g, '\\$&')} \\{`, 'm'));
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('OROS2.11 composants de la planche dans le châssis', () => {
  it('OROS4.2 chaque module du rail porte son emblème en tête, seul ; l’onglet ouvert l’allume à l’or ; OROS4.19 le numéro du raccourci au coin', () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    for (const tab of TABS) {
      const item = el.querySelector<HTMLElement>(`nav button[data-tab="${tab.id}"]`);
      expect(item, tab.id).not.toBeNull();
      const emblem = item!.querySelector(`svg.skg-${GLYPH_ID[tab.id]}`);
      expect(emblem, tab.id).not.toBeNull();
      // l'emblème ouvre l'onglet ; le numéro le ferme
      expect(item!.firstElementChild?.contains(emblem!), tab.id).toBe(true);
      const index = item!.querySelector('[data-part="rail-index"]');
      expect(index?.textContent, tab.id).toBe(tab.index);
      expect(emblem!.compareDocumentPosition(index!) & Node.DOCUMENT_POSITION_FOLLOWING, tab.id).toBeTruthy();
    }
    expect(rule(shellCss, '.navItem')).toMatch(/grid-template-columns: 20px minmax\(0, 1fr\);/);
    // le code du raccourci sort de la grille : il se pose au coin, sous le chanfrein, et laisse au nom toute la largeur
    expect(rule(shellCss, '.navIndex')).toMatch(/position: absolute;\s*top: 6px;\s*right: 14px;/);
    expect(rule(shellCss, '.navEmblem')).toMatch(/--k: var\(--text-1\)/);
    expect(rule(shellCss, '.navItem.on .navEmblem')).toMatch(/--k: var\(--gold\)/);
  });

  it('OROS4.19a l’orchestrateur en service : le badge LIEN se pose sur la ligne du nom, le numéro reste au coin', async () => {
    const { useAgent } = await import('@/store/agent');
    const orchestrator = useAgent.getState().orchestrator;
    useAgent.setState({ orchestrator: { ...orchestrator, running: true } });
    try {
      const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
      const agent = el.querySelector<HTMLElement>('nav button[data-tab="agent"]')!;
      const badge = [...agent.querySelectorAll('span')].find((span) => span.textContent === 'LIEN')!;
      expect(badge).toBeDefined();
      // le badge suit le nom dans sa ligne ; la grille de l'onglet ne garde que l'emblème et le texte
      const head = badge.parentElement!;
      expect(head.className).toMatch(/navHead/);
      expect(head.firstElementChild?.textContent).toBe('Agent IA');
      expect(badge.parentElement!.closest('[class*="navText"]')).not.toBeNull();
      expect([...agent.children].filter((child) => !/navIndex|srOnly/.test(child.className))).toHaveLength(2);
      expect(rule(shellCss, '.navHead')).toMatch(/display: flex;\s*align-items: baseline;/);
    } finally {
      useAgent.setState({ orchestrator });
    }
  });

  it('OROS4.41 le numéro du coin garde sa place : la ligne du nom et du badge s’arrête avant lui ; trop longue, le nom cède, jamais le badge', () => {
    const px = (body: string, prop: string) => Number.parseFloat(new RegExp(`(?:^|[\\s;{])${prop}: ([\\d.-]+)px`).exec(body)?.[1] ?? 'NaN');
    // Le numéro, hors du flux : deux chiffres de Geist Mono (chasse de 0,6 em), espacés de 0,06 em, à 14 px du bord droit,
    // soit 27,2 px depuis le bord de la cartouche (mesuré dans Chromium : 13,2 px de large).
    const index = rule(shellCss, '.navIndex');
    const spacing = Number(/letter-spacing: ([\d.]+)em/.exec(index)?.[1]);
    const footprint = px(index, 'right') + 2 * px(index, 'font-size') * (0.6 + spacing);
    expect(footprint).toBeCloseTo(27.2, 1);
    // La ligne du nom finit à la marge de la cartouche plus sa réserve. Sans réserve, elle allait jusqu'à 12 px du bord,
    // sous le numéro : ENLACE le chevauchait de 6,9 px quand une barre classique ramenait la cartouche à 180 px.
    const margin = Number(/padding: [\d.]+px ([\d.]+)px/.exec(rule(shellCss, '.navItem'))?.[1]);
    const reserve = px(rule(shellCss, '.navHead'), 'padding-right') || 0;
    expect(margin + reserve - footprint).toBeGreaterThanOrEqual(4);
    // Trop longue, la ligne fait céder le nom, à l'ellipse ; le badge garde sa place.
    expect(rule(shellCss, '.navLabel')).toMatch(/flex: 0 1 auto;[\s\S]*min-width: 0;[\s\S]*text-overflow: ellipsis;/);
    expect(rule(shellCss, '.lienBadge')).toMatch(/flex: none;/);
  });

  it('OROS4.44 le focus clavier d’une cartouche se voit en entier : son filet passe à l’or, au chanfrein, et l’anneau rogné par la nav devient transparent pour elle seule', async () => {
    const { cssRules } = await import('./helpers/cssRules');
    const rules = cssRules(shellCss);
    const find = (selector: string) => rules.find((r) => r.at.length === 0 && r.selector.split(',').map((s) => s.trim()).includes(selector));
    // L'anneau du desk se trace 2 px hors du bouton ; la nav (overflow: auto) le coupait, il n'en restait que des traits.
    const tokens = readFileSync('src/design/tokens.css', 'utf8');
    expect(tokens).toMatch(/:focus-visible \{\s*outline: 1px solid var\(--gold\);\s*outline-offset: 2px;/);
    expect(rule(shellCss, '.nav')).toMatch(/overflow: auto;/);
    // Transparent plutôt que retiré : en couleurs forcées (contraste élevé), le filet s'efface et le système redessine l'anneau.
    expect(find('.navItem:focus-visible')?.body).toMatch(/outline-color: transparent/);
    expect(find('.navItem:focus-visible')?.body).not.toMatch(/outline: none/);
    // Le filet (::before, découpé au chanfrein) prend l'or, l'onglet ouvert compris.
    for (const selector of ['.navItem:focus-visible::before', '.navItem.on:focus-visible::before']) {
      expect(find(selector)?.body, selector).toMatch(/background: var\(--gold\)/);
    }
    expect(rule(shellCss, '.navItem::before')).toMatch(/clip-path: var\(--chamfer\)/);
    // Le focus vient après le survol, à spécificité égale : une cartouche sous le pointeur garde son filet d'or.
    const at = (selector: string) => rules.findIndex((r) => r.selector.split(',').map((s) => s.trim()).includes(selector));
    expect(at('.navItem.on:focus-visible::before')).toBeGreaterThan(at('.navItem.on:hover::before'));
    expect(at('.navItem:focus-visible::before')).toBeGreaterThan(at('.navItem:hover::before'));
    // Rien d'autre ne perd l'anneau du desk dans le châssis.
    const dropped = rules.filter((r) => /outline:\s*none|outline-color:\s*transparent/.test(r.body)).map((r) => r.selector);
    expect(dropped).toEqual(['.navItem:focus-visible']);
  });

  it('OROS4.14 chaque emblème du rail et chaque couche d’en-tête pèse le même trait : entre 0,4 et 0,75 px rendu', async () => {
    const { COMPONENTS } = await import('@/design/micro/assets');
    const { LAYER_GLYPH } = await import('@/app/moduleLayers');
    const { cssRules } = await import('./helpers/cssRules');
    const rules = cssRules(shellCss);
    /** La graisse qu'impose la feuille du châssis à une classe du master, sous `scope`. */
    const override = (scope: string, cls: string) => {
      for (const r of rules) {
        if (r.selector.split(',').some((sel) => sel.trim() === `${scope} :global(.${cls})`)) return Number.parseFloat(/stroke-width:\s*([\d.]+)px/.exec(r.body)?.[1] ?? 'NaN');
      }
      return null;
    };
    const check = (n: number, size: number, scope: string, what: string) => {
      const svg = COMPONENTS[n]!;
      const [, , w, h] = /viewBox="([^"]+)"/.exec(svg)![1]!.split(' ').map(Number);
      const scale = size / Math.max(w!, h!);
      const style = /<style>([^<]*)<\/style>/.exec(svg)?.[1] ?? '';
      for (const [, selectors, body] of style.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const width = /stroke-width:\s*([\d.]+)px/.exec(body!)?.[1];
        if (!width) continue;
        for (const [, cls] of selectors!.matchAll(/\.(g\d+-\d+)/g)) {
          const rendered = (override(scope, cls!) ?? Number(width)) * scale;
          expect(rendered, `${what} · .${cls}`).toBeGreaterThanOrEqual(0.4);
          expect(rendered, `${what} · .${cls}`).toBeLessThanOrEqual(0.75);
        }
      }
    };
    expect(rule(shellCss, '.navEmblem')).toMatch(/width: 20px;\s*height: 20px/);
    expect(rule(shellCss, '.layerGlyph')).toMatch(/width: 18px;\s*height: 18px/);
    for (const tab of TABS) check(GLYPH_ID[tab.id], 20, '.navEmblem', `rail ${tab.id}`);
    for (const [layer, glyph] of Object.entries(LAYER_GLYPH)) check(GLYPH_ID[glyph], 18, '.layerGlyph', `couche ${layer}`);
  });

  it('OROS5.51 au pied du rail, les comptes connectés : rien sans compte connecté ; une ligne par compte que rapporte le pont vivant — la micro qui assemble le pont (1) et le coffre (124), son voyant à la menthe, le nom — empilées ; ni cartouche, ni filet, ni « Tous les comptes »', async () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    const rail = el.querySelector<HTMLElement>('aside[data-chassis="rail"]')!;
    const group = () => rail.querySelector<HTMLElement>('[role="group"][aria-label="Comptes connectés"]');
    const foot = () => rail.lastElementChild as HTMLElement;
    // sans pont : rien au-dessus du sceau (décision de l'ADMIN, 2026-11-07) ; la cartouche et ses mots sont retirés
    expect(group()).toBeNull();
    expect(rail.querySelector('[data-account-open], [data-part="account-mark"], [aria-label="Compte actif"]')).toBeNull();
    expect(rail.textContent).not.toMatch(/Tous les comptes|Import CSV|NinjaTrader 8/);
    expect(foot().firstElementChild!.querySelector('[data-part="lab-seal"]')).not.toBeNull();
    // hors ligne, le process principal garde les derniers noms reçus : ils ne comptent pas ; un pont vivant sans compte non plus
    for (const [link, names] of [['lost', ['Sim101']], ['stale', ['Sim101']], ['connecting', ['Sim101']], ['live', []], ['live', ['', '  ']]] as const) {
      act(() => useBridge.setState({ nt: bridge(link, [...names]) }));
      expect(group(), `${link} ${names.join(',')}`).toBeNull();
    }
    // un compte connecté : sa ligne, au-dessus du sceau
    act(() => useBridge.setState({ nt: bridge('live', ['Sim101']) }));
    expect(foot().firstElementChild).toBe(group());
    expect(group()!.querySelectorAll('[data-account-open]')).toHaveLength(1);
    // plusieurs : empilés dans l'ordre où le pont les rapporte, une fois chacun
    act(() => useBridge.setState({ nt: bridge('live', ['Sim101', 'Apex-PA-50K', 'Sim101']) }));
    const rows = [...group()!.querySelectorAll<HTMLButtonElement>(':scope > button')];
    expect(rows.map((row) => row.dataset.accountOpen)).toEqual(['Sim101', 'Apex-PA-50K']);
    for (const row of rows) {
      // la micro, puis le nom ; rien d'autre : ni source, ni intitulé
      const mark = row.querySelector<HTMLElement>('[data-part="account-mark"]')!;
      expect(row.firstElementChild).toBe(mark);
      expect(row.children).toHaveLength(2);
      expect(row.lastElementChild!.textContent).toBe(row.dataset.accountOpen);
      // le pont entre par la gauche dans le coffre ; le voyant au cœur
      const bridgeGlyph = mark.querySelector(`svg.skg-${GLYPH_ID.bridge}`);
      const vault = mark.querySelector(`svg.skg-${GLYPH_ID.vault}`);
      expect(bridgeGlyph).not.toBeNull();
      expect(vault).not.toBeNull();
      expect(bridgeGlyph!.compareDocumentPosition(vault!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(mark.querySelector('[data-voyant]')).not.toBeNull();
    }
    // la lumière verte : le voyant, fixe, à la menthe ; plus d'or, de veille ni d'anneau éteint
    const voyant = rule(shellCss, '.voyant');
    expect(voyant).toMatch(/background: var\(--mint\);/);
    expect(voyant).toMatch(/box-shadow: 0 0 1\.5px var\(--mint\), 0 0 6px color-mix\(in srgb, var\(--mint\) 75%, transparent\);/);
    expect(voyant).not.toMatch(/--gold|animation/);
    expect(shellCss).not.toMatch(/\.voyantOn|\.voyantVeille|\.voyantOff|\.accountSource|\.accountOpen/);
    // ni cartouche, ni filet, ni fond : ni calques au chanfrein, ni compartiment
    for (const selector of ['.accounts', '.account', '.accountMark']) {
      const body = rule(shellCss, selector);
      expect(body, selector).not.toBe('');
      expect(body, selector).not.toMatch(/border|background|clip-path|box-shadow/);
    }
    expect(rule(shellCss, '.account::before')).toBe('');
    expect(rule(shellCss, '.account::after')).toBe('');
    // la pile : 28 px par ligne, 4 px entre deux, les mesures que compte `accountsFit` ; autant de lignes que la place le
    // permet (`--rows`), deux au moins, puis elle défile d'une ligne à l'autre
    const px = (body: string, prop: string) => Number.parseFloat(new RegExp(`(?:^|[\\s;{])${prop}: ([\\d.-]+)px`).exec(body)?.[1] ?? 'NaN');
    const stack = rule(shellCss, '.accounts');
    const row = rule(shellCss, '.account');
    expect(px(row, 'min-height')).toBe(ACCOUNT_ROW_H);
    expect(px(row, 'min-height')).toBeGreaterThanOrEqual(px(rule(shellCss, '.accountArt'), 'height'));
    expect(px(stack, 'gap')).toBe(ACCOUNT_ROW_GAP);
    expect(stack).toMatch(/max-height: calc\(var\(--rows, 2\) \* 28px \+ \(var\(--rows, 2\) - 1\) \* 4px\);/);
    expect(ACCOUNT_ROWS_MIN).toBe(2);
    expect(group()!.style.getPropertyValue('--rows')).toBe('2');
    expect(stack).toMatch(/overflow-y: auto;/);
    expect(stack).toMatch(/scroll-snap-type: y mandatory;/);
    expect(row).toMatch(/scroll-snap-align: start;/);
    // la barre de la pile, fine, dans la marge droite du rail, comme celle de la nav ; la ligne garde la largeur de la nav
    expect(stack).toMatch(/margin-right: -12px;/);
    expect(row).toMatch(/width: min\(100cqw, 100%\);/);
    expect(rule(shellCss, '.accountName')).toMatch(/font-size: 12px/);
    // chaque composant montre la part de son dessin qui sert : le pont jusqu'au bout de sa ligne, le coffre depuis son carré
    const { COMPONENTS } = await import('@/design/micro/assets');
    const bridgeWin = rule(shellCss, '.accountBridge');
    const bridgeGlyph = rule(shellCss, '.accountBridge > span');
    const vaultWin = rule(shellCss, '.accountVault');
    const vaultGlyph = rule(shellCss, '.accountVault > span');
    expect(COMPONENTS[1]).toContain('<line class="g1-1" x1="89.91" y1="17.94" x2="13.75" y2="17.94"/>');
    expect(COMPONENTS[124]).toContain('<rect class="g124-1" x="47.16" y="47.16" width="121.12" height="121.12"/>');
    expect(px(bridgeWin, 'width') / px(bridgeGlyph, 'width')).toBeCloseTo(89.91 / 125.42, 3);
    expect(-px(vaultGlyph, 'margin-left') / px(vaultGlyph, 'width')).toBeCloseTo(47.16 / 215.44, 3);
    expect(px(bridgeWin, 'width') + px(vaultWin, 'width')).toBeCloseTo(40, 2);
    // un même trait : ≈ 0,6 px rendu pour les deux, entre 0,4 et 0,75 px comme les emblèmes du rail
    const stroke = (selector: string) => px(rule(shellCss, selector), 'stroke-width');
    const bridgeStroke = stroke('.accountBridge :global(.g1-1)') * (px(bridgeGlyph, 'width') / 125.42);
    const vaultStroke = Number.parseFloat(/stroke-width: ([\d.]+)px/.exec(shellCss.slice(shellCss.indexOf('.accountVault :global(.g124-1),')))![1]!) * (px(vaultGlyph, 'width') / 215.44);
    for (const rendered of [bridgeStroke, vaultStroke]) {
      expect(rendered).toBeGreaterThanOrEqual(0.4);
      expect(rendered).toBeLessThanOrEqual(0.75);
    }
  });

  it('OROS5.51 une ligne de compte se dit une fois : son nom accessible porte le lien au pont, l’infobulle vit sur la micro, cachée aux lecteurs d’écran ; trois langues', () => {
    useBridge.setState({ nt: bridge('live', ['Sim101']) });
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    const group = el.querySelector<HTMLElement>('aside [role="group"][aria-label="Comptes connectés"]')!;
    const row = group.querySelector<HTMLButtonElement>('button[data-account-open="Sim101"]')!;
    const mark = row.querySelector<HTMLElement>('[data-part="account-mark"]')!;
    expect(row.getAttribute('aria-label')).toBe('Ouvrir la fiche du compte Sim101, connecté au pont NT8');
    // une seule infobulle, sur la micro : ni le groupe, ni la ligne, ni le nom ne la redisent
    expect(group.hasAttribute('title')).toBe(false);
    expect(row.hasAttribute('title')).toBe(false);
    expect([...group.querySelectorAll('[title]')]).toEqual([mark]);
    expect(mark.getAttribute('title')).toBe('Connecté au pont NT8');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    // le voyant ne parle plus seul : la ligne le dit
    expect(group.querySelector('[role="img"]')).toBeNull();
    act(() => useI18n.setState({ locale: 'en' }));
    expect(el.querySelector('aside [data-part="accounts"]')?.getAttribute('aria-label')).toBe('Connected accounts');
    expect(row.getAttribute('aria-label')).toBe('Open the Sim101 account record, connected to the NT8 bridge');
    expect(mark.getAttribute('title')).toBe('Connected to the NT8 bridge');
    act(() => useI18n.setState({ locale: 'es' }));
    expect(el.querySelector('aside [data-part="accounts"]')?.getAttribute('aria-label')).toBe('Cuentas conectadas');
    expect(row.getAttribute('aria-label')).toBe('Abrir la ficha de la cuenta Sim101, conectada al puente NT8');
    expect(mark.getAttribute('title')).toBe('Conectada al puente NT8');
  });

  it('OROS4.11 la quantité du rail n’est jamais coupée : elle passe à la ligne, deux lignes au plus, entre ses parties', async () => {
    const { useNotes } = await import('@/store/notes');
    const { useLinks } = await import('@/store/links');
    const notes = useNotes.getState().notes;
    const links = useLinks.getState().links;
    useNotes.setState({ notes: [{ id: 'a' }, { id: 'b' }] as unknown as typeof notes });
    useLinks.setState({ links: Array.from({ length: 472 }, (_, i) => ({ id: `l${i}` })) as unknown as typeof links });
    try {
      const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
      const qty = el.querySelector('nav button[data-tab="note"] [class*="navQty"]')!;
      // Deux parties, chacune insécable : la ligne ne se brise qu'au séparateur.
      expect(qty.textContent).toBe('2 notes · 472 liens');
      expect([...qty.children].map((part) => part.textContent)).toEqual(['2 notes', '472 liens']);
      const parts = rule(shellCss, '.navQtyPart');
      expect(parts).toMatch(/white-space: nowrap/);
      // Une quantité d'une seule partie (« Orchestrateur en service ») se brise entre ses mots.
      const agent = el.querySelector('nav button[data-tab="agent"] [class*="navQty"]')!;
      expect(agent.children).toHaveLength(0);
    } finally {
      useNotes.setState({ notes });
      useLinks.setState({ links });
    }
    const body = rule(shellCss, '.navQty');
    expect(body).not.toMatch(/text-overflow: ellipsis|white-space: nowrap/);
    expect(body).toMatch(/-webkit-line-clamp: 2/);
  });

  it('OROS4.17 le zoom de la barre de titre : « − valeur + » dans un cadre, deux traits nets, plus le composant coupé en deux', () => {
    const el = mount(createElement(ZoomControls));
    const group = el.querySelector<HTMLElement>('[role="group"]')!;
    const buttons = [...group.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Réduire le zoom', 'Basculer auto / manuel', 'Augmenter le zoom']);
    const [minus, pct, plus] = buttons;
    // le moins est un trait, le plus une croix ; aucun composant de la planche ne s'y découpe
    expect(minus!.querySelector('svg path')?.getAttribute('d')).toBe('M1 5 H9');
    expect(plus!.querySelector('svg path')?.getAttribute('d')).toBe('M1 5 H9 M5 1 V9');
    expect(group.querySelector(`svg.skg-${GLYPH_ID.zoom}`)).toBeNull();
    // le pourcentage reste lisible et bascule auto / manuel
    expect(pct!.textContent).toMatch(/AUTO|FIXE/);
    // un cadre fin (les carrés : OROS4.46)
    expect(rule(shellCss, '.zoomPad')).toMatch(/height: 22px/);
    expect(shellCss).not.toMatch(/\.zoomPlus|\.zoomMinus/);
  });

  it('OROS4.46 les deux gestes du zoom sont de vrais carrés : leur côté est la hauteur du cadre, ses filets ôtés', async () => {
    const { cssRules } = await import('./helpers/cssRules');
    const px = (body: string, prop: string) => Number.parseFloat(new RegExp(`(?:^|[\\s;{])${prop}: ([\\d.]+)px`).exec(body)?.[1] ?? 'NaN');
    // Le desk compte les filets dans la boîte : le cadre de 22 px ne laisse que 20 px de haut à ses boutons, étirés.
    // Comparer la hauteur du cadre à la largeur du bouton donnait des « carrés » de 22 × 20 (mesurés dans Chromium).
    expect(readFileSync('src/design/tokens.css', 'utf8')).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing: border-box;/);
    const pad = rule(shellCss, '.zoomPad');
    expect(pad).toMatch(/align-items: stretch;/);
    const filet = Number(/border: ([\d.]+)px solid/.exec(pad)?.[1]);
    const inner = px(pad, 'height') - 2 * filet;
    const btn = rule(shellCss, '.zoomBtn');
    expect(px(btn, 'width')).toBe(inner);
    // rien sur le bouton ne fausse le carré : ni marge intérieure, ni filet, ni hauteur à lui, dans aucune de ses règles
    const own = cssRules(shellCss).filter((r) => r.selector.split(',').some((sel) => /^\.zoomBtn(?::not\(:disabled\))?$/.test(sel.trim())));
    expect(own.length).toBeGreaterThanOrEqual(2);
    for (const r of own) expect(r.props.filter((prop) => /^(padding|border|height|min-height|box-sizing)/.test(prop)), r.selector).toEqual([]);
    // sur la grille de 4 px du desk, les filets à part
    expect(inner % 4).toBe(0);
  });

  it('l’en-tête de panneau pose son code entre repères d’angle ; chaque panneau a ses croix de calage aux quatre coins', () => {
    const el = mount(createElement(Panel, { code: 'K.01', title: 'Espérance', sub: '/ trade', children: 'corps' }));
    const head = el.querySelector('header')!;
    const code = head.querySelector<HTMLElement>('[data-part="panel-code"]');
    expect(code?.textContent).toBe('K.01');
    expect(code!.compareDocumentPosition(head.querySelector('h3')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const before = rule(primCss, '.panelCode::before');
    const after = rule(primCss, '.panelCode::after');
    expect(before).toMatch(/border-width: 1px 0 0 1px/);
    expect(after).toMatch(/border-width: 0 1px 1px 0/);
    const crosses = rule(primCss, '.panel::after');
    expect(crosses).toMatch(/inset: -4px/);
    expect(crosses).toMatch(/background: var\(--line-3\)/);
    for (const corner of ['0 0', '100% 0', '0 100%', '100% 100%']) expect(crosses).toContain(`) ${corner} / 7px 7px no-repeat`);
    // sans code, l'en-tête reste celui d'avant
    act(() => root!.render(createElement(Panel, { title: 'Sans code', children: 'corps' })));
    expect(el.querySelector('[data-part="panel-code"]')).toBeNull();
  });

  it('OROS5.49 la signature : le nom suit le code d’accolades sans losange entre eux, et un seul code-barres dans tout le desk', () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    const footer = el.querySelector('footer')!;
    const name = [...footer.querySelectorAll('span')].find((span) => [...span.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('[ SIΞRRΛSKΛ ]')));
    expect(name).toBeDefined();
    // le losange strié (composant 10) qui séparait les barres du nom est retiré (décision de l'ADMIN, 2026-11-07)
    expect(name!.children).toHaveLength(0);
    expect(name!.textContent).toBe('[ SIΞRRΛSKΛ ]');
    expect(footer.querySelector(`svg.skg-${GLYPH_ID.lozenge}`)).toBeNull();
    expect(el.querySelector(`svg.skg-${GLYPH_ID.lozenge}`)).toBeNull();
    // le nom vient juste après le geste du siège, qui enveloppe les barres
    const sig = name!.parentElement!;
    expect(sig.className).toMatch(/sigEnd/);
    expect(sig.lastElementChild).toBe(name);
    expect(name!.previousElementSibling?.querySelector('svg[shape-rendering="crispEdges"]')).not.toBeNull();
    // le code d'accolades du pied (crispEdges) est le seul : ni la plaque, ni la barre de titre, ni l'en-tête n'en portent
    expect(el.querySelectorAll('svg[shape-rendering="crispEdges"]')).toHaveLength(1);
    expect(footer.querySelectorAll('svg[shape-rendering="crispEdges"]')).toHaveLength(1);
    expect(rule(shellCss, '.lozenge')).toBe('');
    expect(rule(shellCss, '.stripName')).not.toMatch(/gap:/);
    // DESIGN.md § 07 dit la signature telle qu'elle est
    const doc = readFileSync('docs/DESIGN.md', 'utf8').replace(/\r\n/g, '\n');
    const signature = doc.slice(doc.indexOf('## 07.'), doc.indexOf('## 08.'));
    expect(signature).not.toMatch(/puis le losange strié et `\[ SIΞRRΛSKΛ \]`/);
    expect(signature).toMatch(/puis `\[ SIΞRRΛSKΛ \]`, qui suit les barres sans le losange strié \(10\)[^.]*2026-11-07/);
  });
});
