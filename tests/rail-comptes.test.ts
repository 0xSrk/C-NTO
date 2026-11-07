/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { connectedAccounts } from '@/app/RailAccounts';
import { accountsFit, ACCOUNT_ROW_GAP, ACCOUNT_ROW_H, ACCOUNT_ROWS_MIN, GATE_LINE_H, railFit, type AccountSpace } from '@/app/railFit';
import { Shell } from '@/app/Shell';
import type { NtBridgeStatus } from '@/lib/desk';
import { useBridge } from '@/store/bridge';

/**
 * OROS5.51 — les comptes connectés au pied du rail (décision de l'ADMIN, 2026-11-07) : la cartouche « Tous les comptes »
 * cède la place aux comptes que le pont NT8 rapporte, son lien vivant ; ils s'empilent, autant que la place le permet sans
 * faire défiler les cartouches, la ligne d'écrous des portes réservée, deux au moins.
 */

const status = (link: NtBridgeStatus['link'], accountNames: string[]): NtBridgeStatus => ({
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

describe('OROS5.51 · les comptes connectés', () => {
  it('un compte est connecté quand le pont vivant le rapporte : hors ligne, les derniers noms reçus ne comptent plus ; un nom vide non plus ; une fois chacun, dans l’ordre du pont', () => {
    expect(connectedAccounts(null)).toEqual([]);
    expect(connectedAccounts(undefined)).toEqual([]);
    for (const link of ['absent', 'connecting', 'stale', 'lost'] as const) expect(connectedAccounts(status(link, ['Sim101'])), link).toEqual([]);
    expect(connectedAccounts(status('live', []))).toEqual([]);
    expect(connectedAccounts(status('live', ['', '   ']))).toEqual([]);
    expect(connectedAccounts(status('live', ['Sim101']))).toEqual(['Sim101']);
    expect(connectedAccounts(status('live', ['Apex-PA-50K', 'Sim101', 'Apex-PA-50K', '']))).toEqual(['Apex-PA-50K', 'Sim101']);
  });
});

describe('OROS5.51 · accountsFit, la place de la pile', () => {
  /** Une place dont le pied laisse `room` px à la pile, la ligne d'écrous des portes déjà réservée. */
  const space = (room: number): AccountSpace => {
    const base = { nav: 400, gap: 16, footGap: 20, signature: 98 };
    return { ...base, content: room + base.nav + base.gap + base.footGap + base.signature + base.gap + GATE_LINE_H };
  };
  const stack = (rows: number) => rows * ACCOUNT_ROW_H + (rows - 1) * ACCOUNT_ROW_GAP;

  it('deux lignes au moins, même sans place ; puis une de plus par 32 px que les cartouches laissent', () => {
    expect([ACCOUNT_ROW_H, ACCOUNT_ROW_GAP, ACCOUNT_ROWS_MIN]).toEqual([28, 4, 2]);
    expect(accountsFit(space(-500))).toBe(2);
    expect(accountsFit(space(0))).toBe(2);
    expect(accountsFit(space(stack(2)))).toBe(2);
    expect(accountsFit(space(stack(3) - 1))).toBe(2);
    expect(accountsFit(space(stack(3)))).toBe(3);
    expect(accountsFit(space(stack(7)))).toBe(7);
    expect(accountsFit(space(stack(7) + ACCOUNT_ROW_H + ACCOUNT_ROW_GAP - 1))).toBe(7);
  });

  it('au-delà de deux lignes, la pile laisse aux portes leur ligne d’écrous : railFit ne tombe jamais à « none » à cause d’elle', () => {
    for (let room = 0; room <= 400; room += 1) {
      const s = space(room);
      const rows = accountsFit(s);
      if (rows <= ACCOUNT_ROWS_MIN) continue;
      const foot = stack(rows) + s.footGap + s.signature;
      expect(railFit({ content: s.content, nav: s.nav, foot, gap: s.gap }), `${room} px, ${rows} lignes`).not.toBe('none');
    }
  });
});

describe('OROS5.51 · la pile mesurée sur le rail', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.restoreAllMocks();
    useBridge.setState({ nt: null });
  });

  it('la pile reçoit les lignes que la place lui laisse (`--rows`) ; sans mesure, deux', () => {
    useBridge.setState({ nt: status('live', ['Sim101', 'Apex-PA-50K', 'Apex-PA-100K']) });
    const mount = () => {
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
      act(() => root!.render(createElement(Shell, null, createElement('div', null, 'module'))));
      return host.querySelector<HTMLElement>('[data-chassis="rail"] [data-part="accounts"]')!;
    };
    // jsdom ne met rien en page : sans hauteur de rail, la pile garde ses deux lignes
    let stackEl = mount();
    expect(stackEl.dataset.rows).toBe('2');
    expect(stackEl.style.getPropertyValue('--rows')).toBe('2');
    act(() => root!.unmount());
    host!.remove();
    // un rail de 900 px, des cartouches de 400, un sceau de 98 : (900 − 400 − 98 − 16 + 4) / 32 → 12 lignes (jsdom ne
    // calcule ni marge ni écart)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return this instanceof HTMLElement && this.dataset.chassis === 'rail' ? 900 : 0;
    });
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
      return this.tagName === 'NAV' ? 400 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.querySelector('[data-part="lab-seal"]') && !this.querySelector('[data-part="accounts"]') ? 98 : 0;
    });
    stackEl = mount();
    expect(accountsFit({ content: 900, nav: 400, gap: 0, footGap: 0, signature: 98 })).toBe(12);
    expect(stackEl.dataset.rows).toBe('12');
    expect(stackEl.style.getPropertyValue('--rows')).toBe('12');
  });
});
