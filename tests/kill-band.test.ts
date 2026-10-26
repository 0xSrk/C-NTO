/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { killEngaged, useKillLatch } from '@/app/killState';
import { Shell } from '@/app/Shell';
import type { NtBridgeStatus } from '@/lib/desk';
import { useBridge } from '@/store/bridge';

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
  useBridge.setState({ nt: null });
  useKillLatch.setState({ engaged: false });
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
    // le raccourci porté est celui que le process principal annonce
    expect(alert!.textContent).toContain('Ctrl+Shift+K');
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
