/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mercredi 28 octobre 2026, 11:05 à New York (séance RTH). */
const NOW = zonedToUtc('2026-10-28', '11:05', ET_ZONE);

function row(id: string, date: string, timeET: string, title: string, impact: 1 | 2 | 3, actual?: string): CalendarEventRow {
  return { id: `bls:${id}`, sourceId: 'bls', date, timeET, title, category: 'emploi', impact, instruments: [], actual, estimated: false, syncedAt: NOW - 3_600_000 };
}

/** Publications officielles de la semaine : deux passées (une publiée), une à venir aujourd'hui, une dans la fenêtre, une au-delà de l'horizon. */
const ROWS: CalendarEventRow[] = [
  row('pub', '2026-10-28', '08:30', 'Indice témoin publié', 1, '1,2'),
  row('past', '2026-10-28', '10:30', 'Activité témoin passée', 1),
  row('fomc', '2026-10-28', '14:00', 'Décision témoin FOMC', 3),
  row('next', '2026-11-02', '10:00', 'Confiance témoin', 2),
  row('far', '2026-11-05', '08:30', 'Chômage témoin', 2),
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  const { useMacro } = await import('@/store/macro');
  const { useSettings, DEFAULT_SETTINGS } = await import('@/store/settings');
  const { useI18n } = await import('@/i18n');
  useI18n.setState({ locale: 'fr' });
  // Ni base ni réseau : le cache et la synchro sont posés à la main.
  useMacro.setState({ events: ROWS, sources: [{ sourceId: 'bls', state: 'ok', syncedAt: NOW - 3_600_000 }], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, calendarView: 'flux' } });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

async function calendrier(): Promise<HTMLDivElement> {
  const { default: Calendrier } = await import('@/modules/calendrier/Calendrier');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(Calendrier)));
  return host;
}

/** Ligne du flux dont le titre est `title`. */
function fluxRow(node: HTMLElement, title: string): HTMLElement {
  const found = [...node.querySelectorAll<HTMLElement>('[data-stroke]')].find((el) => el.textContent?.includes(title));
  if (!found) throw new Error(`ligne introuvable : ${title}`);
  return found;
}

describe('OROS3.4a le trait dit l’état, la forme dit l’impact', () => {
  it('publié ou passé : plein ; prévu dans la fenêtre : tireté ; au-delà de l’horizon : pointillé', async () => {
    const { CATALYST_HORIZON_DAYS } = await import('@/engine/agent/tools');
    const { horizonEnd, strokeOf } = await import('@/modules/calendrier/calState');
    expect(horizonEnd(NOW)).toBe('2026-11-04');
    expect(CATALYST_HORIZON_DAYS).toBe(7);
    const at = (date: string, timeET: string, actual?: string) => strokeOf({ date, timeET, actual }, NOW);
    expect(at('2026-10-28', '08:30', '1,2')).toBe('publie');
    expect(at('2026-10-28', '10:30')).toBe('publie');
    expect(at('2026-10-27', '14:00')).toBe('publie');
    expect(at('2026-10-28', '14:00')).toBe('prevu');
    expect(at('2026-11-04', '10:00')).toBe('prevu');
    expect(at('2026-11-05', '08:30')).toBe('horizon');
    // Un résultat publié reste plein, même daté au-delà (source en avance).
    expect(at('2026-11-05', '08:30', '3,1')).toBe('publie');
  });

  it('l’impact est une forme : trois barres de hauteur croissante, allumées jusqu’au niveau', async () => {
    const { impactBars } = await import('@/modules/calendrier/calState');
    expect(impactBars(1)).toEqual([
      { height: 6.5, on: true },
      { height: 9, on: false },
      { height: 11.5, on: false },
    ]);
    expect(impactBars(3).map((bar) => bar.on)).toEqual([true, true, true]);
  });

  it('chaque ligne du flux porte son trait ; l’impact se lit en barres, sans couleur de catégorie', async () => {
    const node = await calendrier();
    expect(fluxRow(node, 'Indice témoin publié').dataset.stroke).toBe('publie');
    expect(fluxRow(node, 'Activité témoin passée').dataset.stroke).toBe('publie');
    expect(fluxRow(node, 'Décision témoin FOMC').dataset.stroke).toBe('prevu');
    expect(fluxRow(node, 'Confiance témoin').dataset.stroke).toBe('prevu');
    expect(fluxRow(node, 'Chômage témoin').dataset.stroke).toBe('horizon');
    const impact = fluxRow(node, 'Décision témoin FOMC').querySelector('[data-impact]')!;
    expect(impact.getAttribute('data-impact')).toBe('3');
    expect(impact.getAttribute('aria-label')).toBe('impact 3 sur 3');
    expect(impact.querySelectorAll('i')).toHaveLength(3);
    // Aucune couleur dépensée : ni variable de catégorie, ni teinte en dur, nulle part dans le module.
    expect(node.querySelectorAll('[style*="--cat"]')).toHaveLength(0);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/modules/calendrier/Calendrier.tsx', 'utf8')).not.toMatch(/#[0-9a-f]{6}\b/i);
    expect(readFileSync('src/modules/calendrier/calendrier.module.css', 'utf8')).not.toMatch(/var\(--cat\)/);
  });

  it('la légende dit le trait (plein, tireté, pointillé) et montre les barres de l’impact', async () => {
    const node = await calendrier();
    const legend = node.querySelector('[data-legend="trait"]')!;
    expect([...legend.querySelectorAll('[data-stroke]')].map((el) => (el as HTMLElement).dataset.stroke)).toEqual(['publie', 'prevu', 'horizon']);
    expect(legend.textContent).toMatch(/Plein.*publié.*Tireté.*prévu.*Pointillé.*horizon/s);
    const impact = node.querySelector('[data-legend="impact"]')!;
    expect([...impact.querySelectorAll('[data-impact]')].map((el) => el.getAttribute('data-impact'))).toEqual(['1', '2', '3']);
  });
});

describe('OROS3.4b « maintenant » en lentille du sceau, l’horizon marqué de son glyphe', () => {
  it('« maintenant » se place après les publications passées du jour ; l’horizon est le premier jour au-delà de la fenêtre', async () => {
    const { horizonDay, nowIndex } = await import('@/modules/calendrier/calState');
    const today = [
      { date: '2026-10-28', timeET: '08:30' },
      { date: '2026-10-28', timeET: '10:30' },
      { date: '2026-10-28', timeET: '14:00' },
    ];
    expect(nowIndex(today, NOW)).toBe(2);
    expect(nowIndex([], NOW)).toBe(0);
    expect(horizonDay(['2026-10-28', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'], NOW)).toBe('2026-11-05');
    expect(horizonDay(['2026-10-28', '2026-11-04'], NOW)).toBeNull();
  });

  it('le flux du jour porte « maintenant » : glyphe de l’instant, heure, lentille ; une seule fois, entre passé et à venir', async () => {
    const { GLYPH_ID } = await import('@/design/micro/assets');
    const node = await calendrier();
    const marks = node.querySelectorAll('[data-now]');
    expect(marks).toHaveLength(1);
    const now = marks[0] as HTMLElement;
    expect(now.textContent).toMatch(/Maintenant/);
    expect(now.textContent).toMatch(/11:05 ET/);
    expect(now.querySelector(`svg.skg-${GLYPH_ID.now}`)?.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(now.querySelector('svg[data-lens] path')?.getAttribute('d')).toMatch(/^M0 4 C120 1\.6 280 1\.6 400 4 C280 6\.4 120 6\.4 0 4 ?Z$/);
    const past = fluxRow(node, 'Activité témoin passée');
    const next = fluxRow(node, 'Décision témoin FOMC');
    expect(past.compareDocumentPosition(now) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(now.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const { readFileSync } = await import('node:fs');
    // L'instant est vivant : son glyphe est à l'or.
    expect(readFileSync('src/modules/calendrier/calendrier.module.css', 'utf8')).toMatch(/\.nowGlyph\s*\{[^}]*--k:\s*var\(--gold\)/);
  });

  it('le premier jour au-delà de l’horizon porte le glyphe de l’horizon, et lui seul', async () => {
    const { GLYPH_ID } = await import('@/design/micro/assets');
    const node = await calendrier();
    const marked = [...node.querySelectorAll(`svg.skg-${GLYPH_ID.horizon}`)].map((svg) => svg.closest('[data-day]')?.getAttribute('data-day'));
    expect(marked).toEqual(['2026-11-05']);
    const head = node.querySelector('[data-day="2026-11-05"]')!;
    expect(head.textContent).toMatch(/Horizon/);
  });
});

describe('OROS3.4b′ la grille mensuelle marque aussi l’horizon', () => {
  it('la case du premier jour au-delà de l’horizon porte son glyphe', async () => {
    const { GLYPH_ID } = await import('@/design/micro/assets');
    const { useSettings, DEFAULT_SETTINGS } = await import('@/store/settings');
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, calendarView: 'grille' } });
    const node = await calendrier();
    const marked = [...node.querySelectorAll(`svg.skg-${GLYPH_ID.horizon}`)].map((svg) => svg.closest('[data-day]')?.getAttribute('data-day'));
    expect(marked).toEqual(['2026-11-05']);
  });
});

describe('OROS4.12 « aujourd’hui » dans la langue du desk ; le rappel tient dans sa colonne', () => {
  it('la case du jour dit « auj. », « today », « hoy » : la feuille de style n’écrit plus de texte', async () => {
    const { useSettings, DEFAULT_SETTINGS } = await import('@/store/settings');
    const { useI18n } = await import('@/i18n');
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, calendarView: 'grille' } });
    const node = await calendrier();
    const today = () => node.querySelector('[data-day="2026-10-28"]')?.textContent ?? '';
    expect(today()).toBe('28 · auj.');
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(today()).toBe('28 · today');
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(today()).toBe('28 · hoy');
    // Un autre jour ne porte pas la marque.
    expect(node.querySelector('[data-day="2026-10-29"]')?.textContent).toBe('29');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/modules/calendrier/calendrier.module.css', 'utf8')).not.toMatch(/content:\s*'[^']*[a-z]/i);
  });

  it('le formulaire du rappel ne déborde pas : l’heure se lit en entier, le titre rétrécit, l’ajout reste au bout', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/modules/calendrier/calendrier.module.css', 'utf8');
    // L'heure garde sa largeur naturelle (« 14:30 » comme « 02:30 PM ») ; seul le titre rétrécit.
    expect(css).toMatch(/\.persoForm \{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
    expect(css).toMatch(/\.persoTitle \{[^}]*min-width: 0/);
    const node = await calendrier();
    const form = node.querySelector('aside form')!;
    expect([...form.children].map((el) => el.tagName)).toEqual(['INPUT', 'INPUT', 'BUTTON']);
    expect(form.children[0]?.getAttribute('type')).toBe('time');
    expect(form.children[1]?.classList.length).toBe(1);
  });
});

describe('OROS4.10 la colonne s’ouvre sans plaque : chaque relevé est dit une fois, à sa place', () => {
  it('ni plaque TIME ENGINE ni cadre de HUD : la colonne commence par la légende du trait', async () => {
    const node = await calendrier();
    expect(node.querySelector('svg.mg-timeEngine')).toBeNull();
    expect(node.querySelector('aside')?.firstElementChild?.querySelector('[data-legend="trait"]')).not.toBeNull();
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/modules/calendrier/Calendrier.tsx', 'utf8')).not.toMatch(/<Plate\b|timeEngine/);
    expect(readFileSync('src/modules/calendrier/calendrier.module.css', 'utf8')).not.toMatch(/\.timeHud|\.timePlate/);
    // La lecture de la plaque est partie avec elle : rien ne la recompose ailleurs.
    const calState = await import('@/modules/calendrier/calState');
    expect(Object.keys(calState)).not.toContain('timeEngineValues');
    expect(Object.keys(calState)).not.toContain('syncLabel');
  });

  it('la synchro se lit dans la barre d’outils et sur les options, les catalyseurs du jour dans le panneau du jour', async () => {
    const { GLYPH_ID } = await import('@/design/micro/assets');
    const node = await calendrier();
    expect(node.textContent).toMatch(/Sources BLS/);
    const sync = [...node.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((el) => /Synchroniser/.test(el.textContent ?? ''))!;
    expect(sync.querySelector(`svg.skg-${GLYPH_ID.sync}`)).not.toBeNull();
    expect(sync.textContent).toMatch(/à jour/);
    // Le jour ouvert est aujourd'hui : son panneau dit le catalyseur à venir (la séance, elle, est dans la barre d'état du desk).
    expect(node.querySelector('aside')?.textContent).toContain('Décision témoin FOMC');
  });
});
