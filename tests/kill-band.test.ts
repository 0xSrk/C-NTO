/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { KillBand } from '@/app/KillBand';
import { killEngaged, useKillLatch } from '@/app/killState';
import { Shell } from '@/app/Shell';
import { useI18n } from '@/i18n';
import type { NtBridgeStatus } from '@/lib/desk';
import { useBridge, type LastKill } from '@/store/bridge';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

/** Statut tel que le process principal le pousse sur `ntbridge:status`. */
function status(patch: Partial<NtBridgeStatus>): NtBridgeStatus {
  return { link: 'live', port: 0, addonVersion: '2.4.0', ntVersion: '8.1', accounts: [], accountsAt: null, accountNames: ['SIM101'], heartbeatLatencyMs: 12, ordersOpen: true, hasToken: true, extraAccounts: [], maxContractsPerOrder: 1, killSwitchShortcut: 'CommandOrControl+Shift+K', ...patch };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useBridge.setState({ nt: null, lastKill: null });
  useKillLatch.setState({ engaged: false });
  useI18n.setState({ locale: 'fr' });
});

function mountShell() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Shell, null, createElement('div', null, 'module'))));
  return host;
}
const band = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[role="alert"]')].find((node) => node.textContent?.includes('Kill switch engagé')) ?? null;

describe('OROS3.1 bande du kill switch', () => {
  it('le statut du pont prouve la coupure quand le lien vit et que le canal d’ordres est fermé', () => {
    expect(killEngaged(null)).toBe(false);
    expect(killEngaged(status({ ordersOpen: true }))).toBe(false);
    expect(killEngaged(status({ ordersOpen: false }))).toBe(true);
    // lien absent : `ordersOpen` est faux sans coupure, rien ne prouve le kill switch
    expect(killEngaged(status({ link: 'absent', ordersOpen: false }))).toBe(false);
    expect(killEngaged(status({ link: 'lost', ordersOpen: false }))).toBe(false);
  });

  it('le raccourci du process principal ferme le canal : la bande de niveau 3 se pose sous la barre de titre', () => {
    useBridge.setState({ nt: status({ ordersOpen: true }) });
    const el = mountShell();
    expect(band(el)).toBeNull();
    // Ctrl+Shift+K dans le process principal : le pont pousse un statut au canal fermé
    act(() => useBridge.setState({ nt: status({ ordersOpen: false }) }));
    const alert = band(el);
    expect(alert).not.toBeNull();
    const header = el.querySelector('header')!;
    const rail = el.querySelector('aside')!;
    expect(header.compareDocumentPosition(alert!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert!.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // le raccourci porté est celui que le process principal annonce, écrit comme l'aide l'écrit (OROS5.47a)
    expect(alert!.textContent).toContain('Ctrl+Maj+K');
  });

  it('jusqu’au redémarrage du desk : la bande reste si le lien tombe ensuite, et se pose aussi pour une coupure vue avant le châssis', () => {
    const el = mountShell();
    act(() => useBridge.setState({ nt: status({ ordersOpen: false }) }));
    act(() => useBridge.setState({ nt: status({ link: 'lost', ordersOpen: false }) }));
    expect(band(el)).not.toBeNull();
    act(() => root?.unmount());
    host?.remove();
    root = null;
    // coupure survenue pendant le verrou : le châssis monté ensuite la montre, lien tombé ou non
    useKillLatch.setState({ engaged: false });
    useBridge.setState({ nt: status({ ordersOpen: false }) });
    useBridge.setState({ nt: status({ link: 'stale', ordersOpen: false }) });
    expect(band(mountShell())).not.toBeNull();
  });

  it('la grille du châssis réserve la rangée de la bande entre la barre de titre et le rail', () => {
    const css = readFileSync('src/app/shell.module.css', 'utf8').replace(/\r\n/g, '\n');
    const shell = css.slice(css.indexOf('.shell {'), css.indexOf('}', css.indexOf('.shell {')));
    expect(shell).toMatch(/grid-template-rows: var\(--titlebar-h\) auto 1fr var\(--statusbar-h\)/);
    expect(shell).toMatch(/'title title'\s*'band band'\s*'rail main'\s*'status status'/);
    const look = css.slice(css.indexOf('\n.band {'), css.indexOf('}', css.indexOf('\n.band {')));
    expect(look).toMatch(/grid-area: band/);
    // niveau 3 : jamais animée
    expect(look).not.toMatch(/animation|transition/);
  });
});

/** Les déclarations d'un sélecteur dans la feuille du châssis, toutes règles confondues (hors blocs @). */
function declared(selector: string): string {
  const css = readFileSync('src/app/shell.module.css', 'utf8').replace(/\r\n/g, '\n');
  return cssRules(css)
    .filter((rule) => rule.at.length === 0 && rule.selector.split(/\s*,\s*/).includes(selector))
    .map((rule) => rule.body)
    .join(';');
}

/** 14:32:07 à New York le 2 novembre 2026 (heure normale de l'Est, UTC−5). */
const CUT_AT = Date.UTC(2026, 10, 2, 19, 32, 7);
const cut = (patch: Partial<LastKill> = {}): LastKill => ({
  at: CUT_AT,
  accounts: ['Sim101', 'SimApex2'],
  sent: true,
  results: [
    { account: 'Sim101', ok: true, closed: 1 },
    { account: 'SimApex2', ok: false, error: 'délai dépassé' },
  ],
  ...patch,
});
function mountBand(report: LastKill | null) {
  useBridge.setState({ lastKill: report });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(KillBand)));
  return host.querySelector<HTMLElement>('[role="alert"]')!;
}
function unmountBand() {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
}
/** Les lignes du rapport de coupure, dans l'ordre du document. */
const reportLines = (alert: HTMLElement) => [...alert.querySelectorAll<HTMLElement>('[data-kill]')].map((node) => [node.dataset.kill, node.textContent ?? ''] as const);

describe('OROS5.19 le rapport de coupure se lit dans l’ordre de l’action (décision 8)', () => {
  it('le compte qui demande un geste en tête, à l’ivoire, avec C.042 ; puis les ordres d’aplatir partis à hh:mm:ss et n / N', () => {
    const alert = mountBand(cut());
    const lines = reportLines(alert);
    expect(lines.map(([kind]) => kind)).toEqual(['gesture', 'cut']);
    expect(lines[0]![1]).toBe('SimApex2 sans réponse · aplatir dans NinjaTrader');
    expect(lines[1]![1]).toBe('Ordres d’aplatir partis à 14:32:07 ET · 1 / 2 aplatis');
    // C.042, la croix creuse : ce qui n'a pas eu lieu, sans rouge
    const gesture = alert.querySelector<HTMLElement>('[data-kill="gesture"]')!;
    const refused = gesture.querySelector('svg.skg-42');
    expect(refused).not.toBeNull();
    expect(refused!.closest('[role="img"]')?.getAttribute('aria-label')).toBe('non aplati');
    expect(gesture.querySelector('b')?.textContent).toBe('SimApex2');
    // après le titre de la bande, jamais avant
    const title = alert.querySelector('b')!;
    expect(title.textContent).toBe('Kill switch engagé');
    expect(title.compareDocumentPosition(gesture) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // à l'ivoire, comme le titre ; la ligne des ordres reste au gris du sous-titre
    expect(declared('.bandGesture')).toMatch(/(^|[\s;{])color: var\(--text-0\)/);
    expect(declared('.bandGesture')).toMatch(/--k: var\(--text-0\)/);
    expect(declared('.bandCut')).toMatch(/(^|[\s;{])color: var\(--text-2\)/);
    expect(declared('.bandReport')).not.toMatch(/animation|transition/);
  });

  it('chaque compte qui reste à aplatir est nommé, groupé par raison ; tout aplati, aucun geste n’est demandé', () => {
    const three = cut({
      accounts: ['Sim101', 'SimApex2', 'SimApex3', 'Sim104'],
      results: [
        { account: 'Sim101', ok: true, closed: 2 },
        { account: 'SimApex2', ok: false, error: 'délai dépassé' },
        { account: 'SimApex3', ok: false, error: 'délai dépassé' },
        { account: 'Sim104', ok: false, error: 'compte non connecté' },
      ],
    });
    expect(reportLines(mountBand(three))).toEqual([
      ['gesture', 'SimApex2, SimApex3 sans réponse · Sim104 compte non connecté · aplatir dans NinjaTrader'],
      ['cut', 'Ordres d’aplatir partis à 14:32:07 ET · 1 / 4 aplatis'],
    ]);
    unmountBand();
    const done = cut({ results: [{ account: 'Sim101', ok: true, closed: 1 }, { account: 'SimApex2', ok: true, closed: 0 }] });
    expect(reportLines(mountBand(done))).toEqual([['cut', 'Ordres d’aplatir partis à 14:32:07 ET · 2 / 2 aplatis']]);
  });

  it('pont hors ligne : aucun ordre n’est dit parti ; aucun compte connu : la bande renvoie vers NinjaTrader', () => {
    const offline = cut({ accounts: ['SimApex2'], sent: false, results: [{ account: 'SimApex2', ok: false, error: 'pont indisponible' }] });
    expect(reportLines(mountBand(offline))).toEqual([
      ['gesture', 'SimApex2 pont hors ligne · aplatir dans NinjaTrader'],
      ['cut', 'Aucun ordre d’aplatir parti · coupure à 14:32:07 ET · 0 / 1 aplatis'],
    ]);
    unmountBand();
    const none = cut({ accounts: [], results: [] });
    expect(reportLines(mountBand(none))).toEqual([
      ['gesture', 'Aucun compte autorisé connu du pont · vérifier dans NinjaTrader'],
      ['cut', 'Aucun ordre d’aplatir parti · coupure à 14:32:07 ET'],
    ]);
    unmountBand();
    // une raison que le desk ne connaît pas se lit telle que l'AddOn l'a dite
    const raw = cut({ results: [{ account: 'Sim101', ok: true, closed: 1 }, { account: 'SimApex2', ok: false, error: 'Account locked' }] });
    expect(reportLines(mountBand(raw))[0]).toEqual(['gesture', 'SimApex2 Account locked · aplatir dans NinjaTrader']);
    unmountBand();
    // une raison vide : l'AddOn a répondu sans rien dire, l'aplatissement n'est pas confirmé
    const blank = cut({ results: [{ account: 'Sim101', ok: true, closed: 1 }, { account: 'SimApex2', ok: false, error: '  ' }] });
    expect(reportLines(mountBand(blank))[0]).toEqual(['gesture', 'SimApex2 non confirmé · aplatir dans NinjaTrader']);
  });

  it('à l’étroit (fenêtre minimale, zoom relevé), le sous-titre et son raccourci restent entiers ; chaque ligne du rapport passe à la ligne, deux au plus', () => {
    const body = declared;
    // le titre et le sous-titre gardent leur largeur : le rapport cède la place
    expect(body('.bandText')).toMatch(/flex: none/);
    expect(body('.bandReport')).toMatch(/min-width: 0/);
    // le geste et la ligne des ordres passent à la ligne au lieu de s'abréger, deux lignes au plus, dans les 66 px de la bande
    for (const line of ['.bandGesture > span:last-child', '.bandCut']) {
      expect(body(line), line).toMatch(/-webkit-line-clamp: 2/);
      expect(body(line), line).toMatch(/display: -webkit-box/);
    }
    expect(body('.bandReport p')).not.toMatch(/white-space: nowrap|text-overflow/);
    // n / N ne se coupe jamais
    expect(body('.bandCut b')).toMatch(/white-space: nowrap/);
    expect(body('.bandGesture')).toMatch(/align-items: flex-start/);
  });

  it('sans rapport encore : la bande dit la coupure et n’invente aucun compte', () => {
    const alert = mountBand(null);
    expect(alert.textContent).toContain('Kill switch engagé');
    expect(reportLines(alert)).toEqual([]);
    expect(alert.querySelector('svg.skg-42')).toBeNull();
  });

  it('trois langues', () => {
    const said = (['fr', 'en', 'es'] as const).map((locale) => {
      useI18n.setState({ locale });
      const lines = reportLines(mountBand(cut())).map(([, text]) => text);
      const title = host!.querySelector('[role="alert"] b')?.textContent;
      unmountBand();
      return [title, ...lines];
    });
    expect(said).toEqual([
      ['Kill switch engagé', 'SimApex2 sans réponse · aplatir dans NinjaTrader', 'Ordres d’aplatir partis à 14:32:07 ET · 1 / 2 aplatis'],
      ['Kill switch engaged', 'SimApex2 no answer · flatten in NinjaTrader', 'Flatten orders sent at 14:32:07 ET · 1 / 2 flattened'],
      ['Kill switch activado', 'SimApex2 sin respuesta · cerrar en NinjaTrader', 'Órdenes de cierre enviadas a las 14:32:07 ET · 1 / 2 cerradas'],
    ]);
  });

  it('la soumission reste fermée jusqu’au redémarrage : le rapport ne rouvre rien, la bande reste', () => {
    useBridge.setState({ nt: status({ ordersOpen: false }) });
    const el = mountShell();
    act(() => useBridge.setState({ lastKill: cut() }));
    // le pont revient, canal toujours fermé : la bande reste et garde son rapport
    act(() => useBridge.setState({ nt: status({ link: 'live', ordersOpen: false, ordersClosed: true }) }));
    const alert = band(el);
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('Soumission fermée jusqu’au redémarrage du desk');
    expect(reportLines(alert!).map(([kind]) => kind)).toEqual(['gesture', 'cut']);
  });
});
