/**
 * @vitest-environment jsdom
 */
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { code128Path } from '@/lib/code128';

const HTML = readFileSync('electron/launcher.html', 'utf8');
const UI = readFileSync('electron/launcher-ui.js', 'utf8');
const MICRO = readFileSync('electron/launcher-micro.js', 'utf8');
const CSS = /<style>([\s\S]*?)<\/style>/.exec(HTML)?.[1] ?? '';
const TOKENS = readFileSync('src/design/tokens.css', 'utf8');

interface Status {
  current: string;
  latest: string | null;
  available: boolean;
  busy: boolean;
  source: 'git' | 'github' | 'none';
  error?: string;
}

const UP_TO_DATE: Status = { current: '3.6.0', latest: '3.6.0', available: false, busy: false, source: 'github' };
const AVAILABLE: Status = { current: '3.6.0', latest: '3.7.0', available: true, busy: false, source: 'github' };
const FAILED: Status = { current: '3.6.0', latest: null, available: false, busy: false, source: 'github', error: 'Impossible de joindre GitHub' };

/** Le corps du lanceur, sans ses scripts : le test les évalue lui-même, dans l'ordre de la page. */
function installPage(): void {
  const body = /<body>([\s\S]*?)<\/body>/.exec(HTML)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
}

interface Boot {
  status?: Status | 'pending';
  locale?: 'fr' | 'en' | 'es';
  shell?: boolean;
  apply?: () => Promise<Status>;
}

let progress: ((p: { received: number; total: number }) => void) | null = null;

async function boot({ status = UP_TO_DATE, locale = 'fr', shell = true, apply }: Boot = {}): Promise<void> {
  installPage();
  progress = null;
  const canto = {
    version: async () => '3.6.0',
    update: {
      check: () => (status === 'pending' ? new Promise<Status>(() => undefined) : Promise.resolve(status)),
      changelog: async () => ({ schemaVersion: 1, entries: [{ version: '3.7.0', date: '2026-10-26', kind: 'fonctionnalite', highlights: { fr: ['Point'], en: ['Point'], es: ['Punto'] } }] }),
      startDesk: async () => true,
      apply: apply ?? (async () => (status === 'pending' ? UP_TO_DATE : status)),
      relaunch: async () => true,
      onProgress: (cb: (p: { received: number; total: number }) => void) => {
        progress = cb;
        return () => undefined;
      },
    },
    locale: { get: async () => locale, set: async (next: string) => next },
    window: { close() {} },
  };
  (window as unknown as { canto?: unknown }).canto = shell ? canto : undefined;
  window.eval(MICRO);
  window.eval(UI);
  await vi.waitFor(() => {
    const text = document.getElementById('meta-text')?.textContent ?? '';
    if (status !== 'pending' && shell) expect(text).not.toMatch(/Contrôle|Checking|Comprobando/);
    expect(document.getElementById('plate-seal')?.textContent).toMatch(/V\.3\.6\.0/);
  });
  await new Promise((r) => setTimeout(r, 0));
}

/** Texte d'un emplacement lié (tspan .lm-v), dans l'ordre de la plaque. */
const slots = (id: string) => [...document.querySelectorAll(`#${id} .lm-v`)].map((n) => n.textContent);

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { canto?: unknown }).canto;
  delete (window as unknown as { cantoMicro?: unknown }).cantoMicro;
});

describe('OROS3.9 lanceur recomposé en Système 4.0 — la page', () => {
  it('ouvre sa feuille sur un bloc de jetons, aux valeurs du Système 4.0, et n’écrit aucune couleur ailleurs', () => {
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    expect(css.startsWith(':root {')).toBe(true);
    const block = css.slice(0, css.indexOf('}') + 1);
    const tokens = [...block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)];
    expect(tokens.length).toBeGreaterThanOrEqual(12);
    for (const [, name, value] of tokens) {
      const ref = TOKENS.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
      if (ref) expect(value!.toLowerCase(), name).toBe(ref.toLowerCase());
    }
    for (const name of ['--bg-0', '--text-0', '--ivory', '--ink', '--gold', '--signal']) expect(block, name).toContain(`${name}:`);
    const rest = css.slice(block.length) + HTML.replace(/<style>[\s\S]*?<\/style>/, '');
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).toEqual([]);
  });

  it('parle avec les trois voix du Système 4.0, embarquées depuis src/design/fonts, sans Inter ni police distante', () => {
    const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(new Set(faces.map((f) => /font-family:\s*'([^']+)'/.exec(f)?.[1]))).toEqual(new Set(['Instrument Sans', 'Geist Mono', 'IBM Plex Sans']));
    for (const face of faces) {
      const file = /url\(\.\/fonts\/([^)]+\.woff2)\)/.exec(face)?.[1];
      expect(file, face).toBeTruthy();
      expect(statSync(path.join('src/design/fonts', file!)).size, file).toBeGreaterThan(1000);
    }
    expect(HTML).not.toMatch(/Inter|JetBrains|fonts\.(googleapis|gstatic)/);
  });

  it('ne réagit pas au passage du pointeur : aucune règle :hover', () => {
    expect(CSS).not.toMatch(/:hover/);
  });

  it('ne peint plus de scène 3D : l’aube se lève sur l’horizon du sceau, en vecteurs', () => {
    expect(readFileSync('electron/aube.js', 'utf8')).not.toMatch(/webgl/i);
    expect(HTML).not.toContain('aube-gl');
  });

  it('charge ses micrographies avant l’interface, et un seul code-barres, en bas à droite de la bande', () => {
    const scripts = [...HTML.matchAll(/<script src="\.\/([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual(['launcher-micro.js', 'aube.js', 'launcher-ui.js']);
    installPage();
    const codes = document.querySelectorAll('svg.code');
    expect(codes).toHaveLength(1);
    const strip = document.querySelector('footer.strip')!;
    expect(strip.lastElementChild).toBe(codes[0]);
    expect(HTML).not.toMatch(/datamatrix|qr-?code/i);
  });

  it('embarque ses voix, leurs licences et ses micrographies à côté du lanceur', () => {
    const dest = mkdtempSync(path.join(tmpdir(), 'canto-launcher-'));
    const run = spawnSync(process.execPath, ['scripts/copy-electron-assets.mjs', dest], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    for (const file of ['launcher.html', 'launcher-ui.js', 'launcher-micro.js', 'aube.js']) expect(existsSync(path.join(dest, file)), file).toBe(true);
    for (const face of CSS.matchAll(/url\(\.\/fonts\/([^)]+\.woff2)\)/g)) expect(existsSync(path.join(dest, 'fonts', face[1]!)), face[1]).toBe(true);
    for (const licence of ['OFL-InstrumentSans.txt', 'OFL-GeistMono.txt', 'OFL-IBMPlexSans.txt']) {
      expect(readFileSync(path.join(dest, 'fonts', licence), 'utf8'), licence).toMatch(/SIL Open Font License/);
    }
  });
});

describe('OROS3.9 lanceur recomposé en Système 4.0 — les plaques lisent l’état réel', () => {
  it('à jour : la plaque du sceau porte la version, la publication dit le canal et la latence, la bande porte le vrai code', async () => {
    await boot({ status: UP_TO_DATE });
    expect(slots('plate-seal')).toEqual(['3.6.0']);
    const [next, state, channel, latency] = slots('plate-release');
    expect([next, state, channel]).toEqual(['3.6.0', 'À JOUR', 'GITHUB']);
    expect(latency).toMatch(/^\d+ MS$/);
    expect(slots('plate-artefact')).toEqual(['PRÊT']);
    expect(document.getElementById('meta')!.dataset.level).toBe('1');
    expect(document.querySelector('#meta-glyph .skg-131')).not.toBeNull();
    expect((document.getElementById('btn-update') as HTMLButtonElement).hidden).toBe(true);
    expect(document.getElementById('strip-code')!.textContent).toBe('SK-ART-002-3.6.0');
    expect(document.getElementById('strip-channel')!.textContent).toBe('■ GITHUB');
    expect(document.querySelector('svg.code path')!.getAttribute('d')).toBe(code128Path('SK-ART-002-3.6.0', 12).d);
  });

  it('mise à jour disponible : la version suivante paraît, le signal passe au rayonnement, le bouton or s’ouvre', async () => {
    await boot({ status: AVAILABLE });
    expect(slots('plate-release').slice(0, 3)).toEqual(['3.7.0', 'DISPO', 'GITHUB']);
    expect(document.getElementById('meta')!.dataset.level).toBe('2');
    expect(document.querySelector('#meta-glyph .skg-12')).not.toBeNull();
    expect((document.getElementById('btn-update') as HTMLButtonElement).hidden).toBe(false);
    expect(document.querySelector('#glyph-update .skg-45')).not.toBeNull();
    expect(document.querySelector('#glyph-launch .skg-46')).not.toBeNull();
  });

  it('échec : le cercle barré marque le niveau 3, la plaque ne devine aucune version, le texte reste ivoire', async () => {
    await boot({ status: FAILED });
    const [next, state, channel] = slots('plate-release');
    expect([next, state, channel]).toEqual(['—', 'ÉCHEC', 'GITHUB']);
    expect(document.getElementById('meta')!.dataset.level).toBe('3');
    expect(document.querySelector('#meta-glyph .skg-123')).not.toBeNull();
    expect(document.getElementById('meta-text')!.textContent).toBe('Impossible de joindre GitHub');
    expect(document.getElementById('strip-channel')!.textContent).toBe('□ GITHUB');
    expect(CSS).not.toMatch(/(?:^|[\s;{])color:\s*var\(--signal\)/m);
  });

  it('contrôle en cours : l’anneau de « maintenant » tourne, la version lue tout de suite, le reste se lit « — »', async () => {
    await boot({ status: 'pending' });
    expect(document.querySelector('#meta-glyph .skg-27')).not.toBeNull();
    expect(document.getElementById('meta')!.dataset.level).toBe('busy');
    expect(slots('plate-seal')).toEqual(['3.6.0']);
    expect(slots('plate-release')).toEqual(['—', '—', '—', '—']);
    expect(document.getElementById('strip-code')!.textContent).toBe('SK-ART-002-3.6.0');
  });

  it('téléchargement : la règle se remplit de points d’or au pourcentage reçu, la plaque le relève', async () => {
    let finish: (s: Status) => void = () => undefined;
    await boot({ status: AVAILABLE, apply: () => new Promise<Status>((r) => (finish = r)) });
    (document.getElementById('btn-update') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(progress).not.toBeNull());
    progress!({ received: 40 * 1048576, total: 100 * 1048576 });
    const gauge = document.getElementById('gauge')!;
    expect(gauge.hidden).toBe(false);
    expect(gauge.style.getPropertyValue('--fill')).toBe('0.4');
    expect(document.querySelector('#gauge .skg-31')).not.toBeNull();
    expect(slots('plate-release')[1]).toBe('40 %');
    expect(slots('plate-artefact')).toEqual(['MAJ…']);
    expect(document.getElementById('meta-text')!.textContent).toContain('40 %');
    finish({ ...UP_TO_DATE, applied: false, opened: 'installer' } as Status);
  });

  it('les relevés suivent la langue du desk', async () => {
    await boot({ status: UP_TO_DATE, locale: 'en' });
    await vi.waitFor(() => expect(slots('plate-release')[1]).toBe('LATEST'));
    expect(slots('plate-artefact')).toEqual(['READY']);
  });

  it('sans shell : rien d’inventé, le signal dit l’échec', async () => {
    installPage();
    (window as unknown as { canto?: unknown }).canto = undefined;
    window.eval(MICRO);
    window.eval(UI);
    expect(document.getElementById('meta-text')!.textContent).toBe('Shell indisponible');
    expect(document.getElementById('meta')!.dataset.level).toBe('3');
    expect(slots('plate-seal')).toEqual(['—']);
    expect(slots('plate-release')).toEqual(['—', '—', '—', '—']);
  });
});
