/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Lundi 26 octobre 2026 : la fenêtre des résultats mégacaps (mercredi 28) tombe dans les 10 jours du Bot. */
const NOW = Date.parse('2026-10-26T12:00:00Z');

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  const { useBots } = await import('@/store/bots');
  // Ni base ni automate : seuls les garde-fous imposés comptent ici.
  useBots.setState({ ready: true, bots: [], activeId: null, load: async () => undefined });
});

afterEach(async () => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  const { useI18n } = await import('@/i18n');
  useI18n.setState({ locale: 'fr' });
});

/** Les garde-fous imposés, tels que le Bot les affiche. */
async function guards(locale: 'fr' | 'en' | 'es'): Promise<string[]> {
  const { useI18n } = await import('@/i18n');
  useI18n.setState({ locale });
  const { default: Bot } = await import('@/modules/bot/Bot');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(Bot)));
  const { default: s } = await import('@/modules/bot/bot.module.css');
  const out = [...host.querySelectorAll(`.${s.guard}`)].map((el) => el.textContent ?? '');
  act(() => root?.unmount());
  host.remove();
  return out;
}

describe('R3.7e le Bot dit le catalyseur du moteur dans la langue du desk, comme le calendrier', () => {
  it('la fenêtre des résultats mégacaps en anglais, en espagnol, en français', async () => {
    const en = await guards('en');
    expect(en).toContain('Risk day 2026-10-28 · Megacap earnings window (MSFT · GOOGL · META · AAPL · AMZN)');
    expect(en.join('\n')).not.toMatch(/Fenêtre|résultats/);
    expect(await guards('es')).toContain('Jornada de riesgo 2026-10-28 · Ventana de resultados megacaps (MSFT · GOOGL · META · AAPL · AMZN)');
    expect(await guards('fr')).toContain('Journée à risque 2026-10-28 · Fenêtre résultats mégacaps (MSFT · GOOGL · META · AAPL · AMZN)');
  });
});
