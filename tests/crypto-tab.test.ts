/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoMainStatus } from '@/lib/desk';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Process principal simulé derrière `window.canto.crypto`, posé avant tout import (le desk le lit au chargement).
 * `main.status` est l'interrupteur qu'il tient ; `main.accepts` est la réponse du dialogue d'activation.
 */
const fake = vi.hoisted(() => {
  const off: CryptoMainStatus = { enabled: false, venues: { coinbase: 'off', binance: 'off', bybit: 'off' } };
  const on: CryptoMainStatus = { enabled: true, venues: { coinbase: 'connecting', binance: 'connecting', bybit: 'connecting' } };
  const main = { status: off, accepts: false };
  const listeners = new Set<(status: CryptoMainStatus) => void>();
  const api = {
    status: vi.fn(async () => main.status),
    enable: vi.fn(async () => {
      if (main.accepts) main.status = on;
      return main.status;
    }),
    disable: vi.fn(async () => {
      main.status = off;
      return main.status;
    }),
    onStatus: vi.fn((cb: (status: CryptoMainStatus) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    // Allumé, le store ouvre son flux léger (CRY3.4) : ces flux répondent sans rien pousser.
    history: vi.fn(async () => ({ ok: false, detail: 'no_history' })),
    subscribe: vi.fn(async () => ({ ok: true, subscriptionId: 'sub' })),
    unsubscribe: vi.fn(async () => ({ ok: true })),
    temperature: vi.fn(async () => null),
    onEvent: vi.fn(() => () => {}),
    onTemperature: vi.fn(() => () => {}),
  };
  (window as unknown as { canto: unknown }).canto = { crypto: api };
  /** Le process principal change d'état de lui-même et le pousse au renderer. */
  const push = (status: CryptoMainStatus) => {
    main.status = status;
    for (const cb of listeners) cb(status);
  };
  return { ...api, main, off, on, push };
});

// Allumé, l'onglet monte le chart (CRY4.3) : le canevas n'existe pas sous jsdom, et ce fichier ne regarde que l'interrupteur.
vi.mock('@/modules/visual/Chart', () => ({ Chart: () => null }));

import Crypto from '@/modules/crypto/Crypto';
import { useCrypto } from '@/store/crypto';

const TITLE = 'Module crypto éteint';
const ENABLE = 'Activer le module crypto';
const TAGLINE = 'Chart · température · alertes';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  fake.main.status = fake.off;
  fake.main.accepts = false;
  fake.status.mockClear();
  fake.enable.mockClear();
  fake.disable.mockClear();
  // `onStatus` garde son historique : le store ne s'y inscrit qu'une fois pour tout le fichier.
  useCrypto.setState({ ready: false, enabled: false, venues: fake.off.venues });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(): Promise<HTMLDivElement> {
  const node = document.createElement('div');
  document.body.appendChild(node);
  host = node;
  root = createRoot(node);
  await act(async () => root?.render(createElement(Crypto)));
  return node;
}

const buttonOf = (node: HTMLElement, text: string) => [...node.querySelectorAll('button')].find((el) => el.textContent === text);

describe('onglet 09 · CRY, éteint par défaut', () => {
  it('éteint : état vide et bouton chanfrein qui demande l’activation au process principal', async () => {
    const container = await mount();
    expect(fake.status).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(TAGLINE);
    expect(container.textContent).toContain(TITLE);
    expect(container.textContent).toContain('Données publiques de Coinbase, Binance et Bybit, pour un usage personnel. Le desk ne s’y connecte qu’une fois le module activé.');
    const button = buttonOf(container, ENABLE);
    expect(button).toBeDefined();
    expect(button?.className).toContain('chamfer');
    await act(async () => button!.click());
    expect(fake.enable).toHaveBeenCalledTimes(1);
    expect(fake.disable).not.toHaveBeenCalled();
    // Dialogue refusé : le process principal rend l'interrupteur éteint, l'écran ne bouge pas.
    expect(container.textContent).toContain(TITLE);
  });

  it('dialogue accepté : l’écran quitte l’état vide, l’en-tête reste', async () => {
    fake.main.accepts = true;
    const container = await mount();
    await act(async () => buttonOf(container, ENABLE)?.click());
    expect(useCrypto.getState()).toMatchObject({ ready: true, enabled: true, venues: fake.on.venues });
    expect(container.textContent).not.toContain(TITLE);
    expect(buttonOf(container, ENABLE)).toBeUndefined();
    expect(container.textContent).toContain(TAGLINE);
  });

  it('un statut poussé par le process principal bascule l’écran', async () => {
    const container = await mount();
    expect(container.textContent).toContain(TITLE);
    await act(async () => fake.push(fake.on));
    expect(container.textContent).not.toContain(TITLE);
    await act(async () => fake.push(fake.off));
    expect(container.textContent).toContain(TITLE);
  });

  it('allumé : pas de faux « éteint » pendant la lecture du statut', async () => {
    let answer: (status: CryptoMainStatus) => void = () => {};
    fake.status.mockReturnValueOnce(
      new Promise<CryptoMainStatus>((resolve) => {
        answer = resolve;
      }),
    );
    const container = await mount();
    expect(useCrypto.getState().ready).toBe(false);
    expect(container.textContent).toContain(TAGLINE);
    expect(container.textContent).not.toContain(TITLE);
    await act(async () => answer(fake.on));
    expect(useCrypto.getState()).toMatchObject({ ready: true, enabled: true });
    expect(container.textContent).not.toContain(TITLE);
  });

  it('statut illisible : le module reste éteint et l’écran se montre quand même', async () => {
    fake.status.mockRejectedValueOnce(new Error('canal fermé'));
    const container = await mount();
    expect(useCrypto.getState()).toMatchObject({ ready: true, enabled: false });
    expect(container.textContent).toContain(TITLE);
  });

  it('navigateur, sans window.canto.crypto : état vide, et le bouton ne fait rien', async () => {
    const canto = (window as unknown as { canto: { crypto?: unknown } }).canto;
    const api = canto.crypto;
    delete canto.crypto;
    try {
      const container = await mount();
      expect(useCrypto.getState()).toMatchObject({ ready: true, enabled: false });
      expect(container.textContent).toContain(TITLE);
      await act(async () => buttonOf(container, ENABLE)?.click());
      expect(fake.status).not.toHaveBeenCalled();
      expect(fake.enable).not.toHaveBeenCalled();
      expect(container.textContent).toContain(TITLE);
    } finally {
      canto.crypto = api;
    }
  });
});

describe('store crypto', () => {
  it('lit le statut à chaque load et ne s’abonne qu’une fois à onStatus', async () => {
    await useCrypto.getState().load();
    await useCrypto.getState().load();
    expect(fake.status).toHaveBeenCalledTimes(2);
    expect(fake.onStatus).toHaveBeenCalledTimes(1);
  });

  it('requestEnable et disable reprennent le statut rendu par le process principal', async () => {
    await useCrypto.getState().requestEnable();
    expect(useCrypto.getState().enabled).toBe(false);
    fake.main.accepts = true;
    await useCrypto.getState().requestEnable();
    expect(useCrypto.getState()).toMatchObject({ enabled: true, venues: fake.on.venues });
    await useCrypto.getState().disable();
    expect(fake.disable).toHaveBeenCalledTimes(1);
    expect(useCrypto.getState()).toMatchObject({ enabled: false, venues: fake.off.venues });
  });
});
