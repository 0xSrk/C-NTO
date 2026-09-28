/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changelog, parseChangelogPayload, CHANGELOG_MAX_BYTES } from '@/engine/changelog';

const SRC = readFileSync('electron/launcher-ui.js', 'utf8');

interface Status {
  current: string;
  latest: string | null;
  available: boolean;
  busy: boolean;
  source: 'git' | 'github' | 'none';
  error?: string;
}

const UPDATED: Status = { current: '3.1.0', latest: '3.1.0', available: false, busy: false, source: 'github' };
const AVAILABLE: Status = { current: '2.2.1', latest: '3.1.0', available: true, busy: false, source: 'github' };

function installDom(): void {
  document.body.innerHTML = `
    <button id="btn-close"></button>
    <div id="lang-label"></div>
    <div id="lang-row"><button data-locale="fr"></button><button data-locale="en"></button><button data-locale="es"></button></div>
    <button id="btn-launch"><span id="btn-launch-label"></span></button>
    <button id="btn-update" hidden><span id="btn-update-label"></span></button>
    <p id="meta"><span id="meta-text"></span></p>
    <div id="notes-slot">
      <button type="button" id="notes-toggle" hidden aria-expanded="false" aria-controls="notes-panel"></button>
      <div id="notes-panel" hidden></div>
    </div>
    <div id="frame"></div>
    <div id="word"></div>
    <div id="xfer"></div>
    <div id="nano"></div>
    <span id="hud-text"></span>
    <span id="hud-fill"></span>
    <span id="hud-count"></span>
    <span id="hud-clock"></span>
  `;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
}

async function boot(status: Status, notes: unknown): Promise<void> {
  installDom();
  const canto = {
    update: {
      check: async () => status,
      changelog: async () => notes,
      startDesk: async () => true,
      apply: async () => status,
      relaunch: async () => true,
      onProgress: () => () => undefined,
    },
    locale: {
      get: async () => 'fr' as const,
      set: async (locale: string) => locale,
    },
    window: { close() {} },
  };
  (window as unknown as { canto: typeof canto }).canto = canto;
  window.eval(SRC);
  await vi.waitFor(() => {
    expect(document.getElementById('meta-text')?.textContent ?? '').not.toMatch(/Contrôle/);
  });
}

describe('nouveautés du lanceur', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('masque le bouton quand le desk est à jour', async () => {
    await boot(UPDATED, changelog);
    const button = document.getElementById('notes-toggle') as HTMLButtonElement;
    expect(button.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('propose le déroulé replié, puis les points de 3.0.0 et 3.1.0', async () => {
    await boot(AVAILABLE, changelog);
    const button = document.getElementById('notes-toggle') as HTMLButtonElement;
    const panel = document.getElementById('notes-panel') as HTMLElement;
    expect(button.hidden).toBe(false);
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('notes-panel');
    expect(button.textContent).toBe('Nouveautés de la v3.1.0 ▾');
    expect(panel.hidden).toBe(true);

    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    const text = panel.textContent ?? '';
    expect(text).toContain('Lanceur AUBE III.');
    expect(text).toContain('Nouveau module Portefeuille');
    expect(text.indexOf('Lanceur AUBE III.')).toBeLessThan(text.indexOf('Nouveau module Portefeuille'));
    expect(text).not.toContain('Lanceur AUBE II.');
    expect(panel.querySelector('img')).toBeNull();
  });

  it('rend une balise injectée en texte', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    await boot(AVAILABLE, {
      schemaVersion: 1,
      entries: [
        {
          version: '3.1.0',
          date: '2026-09-27',
          kind: 'fonctionnalite',
          highlights: { fr: [hostile], en: [hostile], es: [hostile] },
        },
      ],
    });
    const button = document.getElementById('notes-toggle') as HTMLButtonElement;
    button.click();
    const panel = document.getElementById('notes-panel') as HTMLElement;
    expect(panel.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(panel.querySelector('img')).toBeNull();
  });

  it('n’affiche pas le bouton si l’asset est invalide ou dépasse 64 Ko', async () => {
    expect(parseChangelogPayload('{')).toBeNull();
    expect(parseChangelogPayload(' '.repeat(CHANGELOG_MAX_BYTES + 1))).toBeNull();
    await boot(AVAILABLE, parseChangelogPayload('{'));
    expect((document.getElementById('notes-toggle') as HTMLButtonElement).hidden).toBe(true);
    await boot(AVAILABLE, parseChangelogPayload(' '.repeat(CHANGELOG_MAX_BYTES + 1)));
    expect((document.getElementById('notes-toggle') as HTMLButtonElement).hidden).toBe(true);
  });
});
