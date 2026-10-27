/**
 * @vitest-environment jsdom
 */
import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Shell } from '@/app/Shell';
import { TABS } from '@/app/tabs';
import { ZoomControls } from '@/app/ZoomControls';
import { GLYPH_ID } from '@/design/micro/assets';
import { Panel } from '@/design/primitives';
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

  it('OROS4.20 le compte se pose dans sa cartouche : la micro assemble le pont (1) et le coffre (124), le voyant au cœur ; plus d’intitulé visible', async () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    const account = el.querySelector<HTMLElement>('aside [role="group"][aria-label="Compte actif"]');
    expect(account).not.toBeNull();
    // la ligne « COMPTE ACTIF ····· » est retirée : le nom de l'encart ne vit plus que pour les lecteurs d'écran
    expect(account!.textContent).not.toMatch(/COMPTE ACTIF/i);
    const mark = account!.querySelector<HTMLElement>('[data-part="account-mark"]')!;
    expect(mark).not.toBeNull();
    expect(account!.firstElementChild).toBe(mark);
    const bridge = mark.querySelector(`svg.skg-${GLYPH_ID.bridge}`);
    const vault = mark.querySelector(`svg.skg-${GLYPH_ID.vault}`);
    expect(bridge).not.toBeNull();
    expect(vault).not.toBeNull();
    // le pont entre par la gauche dans le coffre ; le voyant, au cœur, garde son rôle et son libellé
    expect(bridge!.compareDocumentPosition(vault!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const voyant = mark.querySelector<HTMLElement>('[role="img"][class*="voyant"]');
    expect(voyant?.getAttribute('aria-label')).toBe('Hors ligne · import CSV');
    // le nom puis la source, après la micro
    const name = account!.querySelector('[class*="accountName"]');
    expect(name?.textContent).toMatch(/^Tous les comptes · \d+$/);
    expect(mark.compareDocumentPosition(name!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rule(shellCss, '.accountName')).toMatch(/font-size: 12px/);
    // la cartouche du compte parle la langue des onglets : filet découpé au chanfrein, fond retiré d'un pixel
    expect(rule(shellCss, '.account::before')).toMatch(/clip-path: var\(--chamfer\)/);
    expect(rule(shellCss, '.account::after')).toMatch(/inset: 1px/);
    expect(shellCss).not.toMatch(/\.railLabel|\.accountLine/);
    // chaque composant montre la part de son dessin qui sert : le pont jusqu'au bout de sa ligne, le coffre depuis son carré
    const { COMPONENTS } = await import('@/design/micro/assets');
    const px = (body: string, prop: string) => Number.parseFloat(new RegExp(`${prop}: ([\\d.-]+)px`).exec(body)?.[1] ?? 'NaN');
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

  it('OROS4.45 le compte dit l’état du pont une fois : par son voyant ; l’infobulle vit sur la micro, plus sur le groupe', () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    const account = el.querySelector<HTMLElement>('aside [role="group"][aria-label="Compte actif"]')!;
    const mark = account.querySelector<HTMLElement>('[data-part="account-mark"]')!;
    const voyant = mark.querySelector<HTMLElement>('[role="img"][class*="voyant"]')!;
    // Le title du groupe devenait sa description : Chromium lisait « Hors ligne · import CSV » deux fois de suite.
    expect(account.hasAttribute('title')).toBe(false);
    expect(account.querySelectorAll('[title]')).toHaveLength(1);
    expect(mark.getAttribute('title')).toBe(voyant.getAttribute('aria-label'));
    expect(voyant.getAttribute('aria-label')).toBe('Hors ligne · import CSV');
    // le nom et la source restent du texte, sans infobulle
    expect(account.querySelector('[class*="accountName"]')?.hasAttribute('title')).toBe(false);
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

  it('la bande d’étiquette : le losange strié devant le nom, et un seul code-barres dans tout le desk', () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    const footer = el.querySelector('footer')!;
    const name = [...footer.querySelectorAll('span')].find((span) => [...span.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('[ SIΞRRΛSKΛ ]')));
    expect(name).toBeDefined();
    expect(name!.firstElementChild?.querySelector(`svg.skg-${GLYPH_ID.lozenge}`)).not.toBeNull();
    // le code d'accolades du pied (crispEdges) est le seul : ni la plaque, ni la barre de titre, ni l'en-tête n'en portent
    expect(el.querySelectorAll('svg[shape-rendering="crispEdges"]')).toHaveLength(1);
    expect(footer.querySelectorAll('svg[shape-rendering="crispEdges"]')).toHaveLength(1);
    expect(rule(shellCss, '.lozenge')).toMatch(/--k: currentColor/);
  });
});
