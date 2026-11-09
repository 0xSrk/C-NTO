import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dexie est remplacé par une coquille : les stores lus ici ouvrent une base à l'import, rien n'y est écrit.
vi.mock('dexie', () => {
  class FakeDexie {
    constructor(_name: string) {}
    version() {
      const chain = {
        stores() {
          return chain;
        },
        upgrade() {
          return chain;
        },
      };
      return chain;
    }
    on() {}
    close() {}
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

import { parseBlsSchedule } from '../electron/calendar/bls';
import { parseFedSchedule } from '../electron/calendar/fed';
import { bundleCoverage, materializeBundle } from '@/engine/calendar-bundle';
import {
  COVERAGE_ESTIMATE_NOTE,
  CPI_DAY_RANGE,
  ESTIMATE_HORIZON_DAYS,
  FOMC_MAX_GAP_DAYS,
  MONTHLY_MAX_GAP_DAYS,
  coverageEstimates,
  coverageFamily,
  coverageGaps,
  cpiEstimateDates,
  nfpEstimateDates,
  usFederalHoliday,
} from '@/engine/calendarCoverage';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { coerceCopierSync } from '@/engine/copier/sync';
import { routeFill } from '@/engine/copier/router';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import { catalystSource, estimateMark, eventProvenance } from '@/engine/macroMerge';
import { useI18n } from '@/i18n';
import { trEventDesc } from '@/lib/eventTitles';
import { addDays, ET_ZONE, zonedToUtc } from '@/lib/time';
import { coverageNotice } from '@/modules/calendrier/calState';
import { copierCatalysts } from '@/store/copierSync';
import { traderRuleBlocks } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { SEPT_2026, sept2026Rows } from './helpers/calendarSept2026';

/**
 * SEC2.2 — le calendrier dit quand il ne couvre plus, et les gardes lisent alors des dates estimées. L'instantané
 * embarqué s'arrête au NFP du 4 décembre et au CPI du 10 décembre 2026, et la page du BLS refuse le desk (403) : en
 * janvier, ni le blackout du Copieur ni la garde « catalyseur » de l'agent ne voyaient ces publications, sans que rien ne
 * le dise. Passé quarante jours sans prochain NFP ou CPI connu (soixante pour le FOMC), le Calendrier le dit ; le NFP et
 * le CPI sont estimés par règle, marqués « ≈ », et injectés dans les deux gardes.
 */

/**
 * L'état de septembre 2026, figé : NFP, CPI et FOMC tels que les desks les ont connus jusqu'à la 3.10.0, sans le
 * calendrier 2027 du BLS. C'est sur lui que la garde se prouve ; le fichier embarqué, lui, change à chaque régénération.
 */
const SEPT: CalendarEventRow[] = sept2026Rows();
/** Tout l'instantané embarqué, tel que le process principal le rend (SEC2.8 : avec le premier trimestre 2027 du BLS). */
const BUNDLE: CalendarEventRow[] = materializeBundle({ from: '2025-01-01', to: '2028-12-31' }, 1);
const official = (family: 'nfp' | 'cpi' | 'fomc') => SEPT.filter((row) => coverageFamily(row) === family).map((row) => row.date).sort();
const fixture = (name: string) => readFileSync(`tests/fixtures/calendar/${name}`, 'utf8');
const row = (id: string, date: string): CalendarEventRow => ({ id, sourceId: 'bls', date, timeET: '08:30', title: 'Rapport emploi US (NFP)', category: 'emploi', impact: 3, instruments: [], estimated: false, syncedAt: 1 });
const at = (date: string, time: string) => zonedToUtc(date, time, ET_ZONE);

describe('SEC2.2 les règles d’estimation, éprouvées sur les dates officielles de 2026', () => {
  it('l’état de septembre porte douze NFP et douze CPI de 2026, et s’arrête au 4 et au 10 décembre', () => {
    expect(official('nfp')).toHaveLength(12);
    expect(official('cpi')).toHaveLength(12);
    expect(official('nfp').at(-1)).toBe('2026-12-04');
    expect(official('cpi').at(-1)).toBe('2026-12-10');
    // Ce sont les dates des pages officielles transcrites dans les fixtures, lues par les parseurs du desk.
    const in2026 = (rows: { date: string }[]) => rows.map((r) => r.date).filter((date) => date.startsWith('2026'));
    expect(in2026(parseBlsSchedule(fixture('bls-empsit.html'), 'empsit'))).toEqual(SEPT_2026.nfp);
    expect(in2026(parseBlsSchedule(fixture('bls-cpi.html'), 'cpi'))).toEqual(SEPT_2026.cpi);
    // La page de la Fed porte aussi les années passées ; l'instantané gardait sa couverture, de janvier 2026 à mars 2027.
    const decisions = parseFedSchedule(fixture('fed.html')).filter((r) => coverageFamily(r) === 'fomc' && r.date >= '2026-01-01' && r.date <= '2027-03-31').map((r) => r.date);
    expect(decisions.sort()).toEqual(SEPT_2026.fomc);
  });

  it('NFP : le troisième vendredi après la semaine du 12 retrouve onze des douze publications de 2026', () => {
    const missed: string[] = [];
    for (const date of official('nfp')) {
      const month = Number(date.slice(5, 7));
      const year = Number(date.slice(0, 4));
      // La publication d'un mois porte sur le mois précédent.
      const candidates = month === 1 ? nfpEstimateDates(year - 1, 12) : nfpEstimateDates(year, month - 1);
      if (!candidates.includes(date)) missed.push(date);
    }
    // Le report du 11 février 2026 (règle au 6) ne se prévoit pas : une estimation reste une estimation.
    expect(missed).toEqual(['2026-02-11']);
  });

  it('NFP : un vendredi férié donne le jeudi d’avant et le vendredi d’après ; un 2 janvier, ce vendredi et le suivant', () => {
    // Décembre 2026 : la règle tombe le 1er janvier 2027, férié.
    expect(nfpEstimateDates(2026, 12)).toEqual(['2026-12-31', '2027-01-08']);
    // Juin 2026 : la règle tombe le 3 juillet, férié observé (le 4 est un samedi) ; le BLS a publié le jeudi 2.
    expect(nfpEstimateDates(2026, 6)).toEqual(['2026-07-02', '2026-07-10']);
    // Décembre 2025 : la règle tombe le 2 janvier 2026 ; le BLS a publié le 9.
    expect(nfpEstimateDates(2025, 12)).toEqual(['2026-01-02', '2026-01-09']);
    expect(nfpEstimateDates(2027, 1)).toEqual(['2027-02-05']);
    expect(nfpEstimateDates(2027, 2)).toEqual(['2027-03-05']);
  });

  it('CPI : chaque publication de 2026 tombe un jour ouvré du 10 au 15, fériés fédéraux exclus', () => {
    expect(CPI_DAY_RANGE).toEqual({ from: 10, to: 15 });
    for (const date of official('cpi')) {
      expect(cpiEstimateDates(Number(date.slice(0, 4)), Number(date.slice(5, 7))), date).toContain(date);
    }
    expect(cpiEstimateDates(2027, 1)).toEqual(['2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15']);
    // Le 15 février 2027 est Presidents' Day ; le 11 novembre, Veterans Day.
    expect(cpiEstimateDates(2027, 2)).toEqual(['2027-02-10', '2027-02-11', '2027-02-12']);
    expect(cpiEstimateDates(2026, 11)).toEqual(['2026-11-10', '2026-11-12', '2026-11-13']);
  });

  it('les fériés fédéraux, tels qu’ils sont observés ; le Vendredi saint n’en est pas un', () => {
    for (const date of ['2027-01-01', '2026-07-03', '2027-01-18', '2027-02-15', '2026-11-11', '2026-11-26', '2026-12-25', '2021-12-31']) expect(usFederalHoliday(date), date).toBe(true);
    for (const date of ['2026-04-03', '2026-07-02', '2026-12-31', '2027-01-08', '2026-12-24']) expect(usFederalHoliday(date), date).toBe(false);
  });
});

describe('SEC2.2 la garde de couverture', () => {
  it('tant que le prochain NFP, le prochain CPI et le prochain FOMC sont connus et proches, rien', () => {
    expect(coverageGaps(SEPT, '2026-11-09')).toEqual([]);
    expect(coverageEstimates(SEPT, '2026-11-09')).toEqual([]);
    // La veille du dernier NFP connu, toujours rien.
    expect(coverageGaps(SEPT, '2026-12-04')).toEqual([]);
  });

  it('au lendemain du dernier NFP connu, le trou se dit ; le 15 décembre 2026, NFP et CPI', () => {
    expect(coverageGaps(SEPT, '2026-12-05')).toEqual([{ family: 'nfp', next: null, last: '2026-12-04' }]);
    expect(coverageGaps(SEPT, '2026-12-15')).toEqual([
      { family: 'nfp', next: null, last: '2026-12-04' },
      { family: 'cpi', next: null, last: '2026-12-10' },
    ]);
    // Le FOMC est connu jusqu'au 17 mars 2027 : son trou s'ouvre après.
    expect(coverageGaps(SEPT, '2027-03-18').map((gap) => gap.family)).toEqual(['nfp', 'cpi', 'fomc']);
    // Sans aucune ligne, tout manque.
    expect(coverageGaps([], '2026-11-09')).toEqual([
      { family: 'nfp', next: null, last: null },
      { family: 'cpi', next: null, last: null },
      { family: 'fomc', next: null, last: null },
    ]);
  });

  it('les bornes : quarante jours pour un NFP ou un CPI, soixante pour un FOMC', () => {
    expect(MONTHLY_MAX_GAP_DAYS).toBe(40);
    expect(FOMC_MAX_GAP_DAYS).toBe(60);
    const nfp = (date: string) => [row(`bls:nfp-${date}`, date), row('bls:cpi-2026-06-10', '2026-06-10'), row('fed:fomc-2026-06-17', '2026-06-17')];
    expect(coverageGaps(nfp(addDays('2026-06-01', 40)), '2026-06-01')).toEqual([]);
    expect(coverageGaps(nfp(addDays('2026-06-01', 41)), '2026-06-01')).toEqual([{ family: 'nfp', next: '2026-07-12', last: '2026-07-12' }]);
    const fomc = (date: string) => [row('bls:nfp-2026-06-05', '2026-06-05'), row('bls:cpi-2026-06-10', '2026-06-10'), row(`fed:fomc-${date}`, date)];
    expect(coverageGaps(fomc(addDays('2026-06-01', 60)), '2026-06-01')).toEqual([]);
    expect(coverageGaps(fomc(addDays('2026-06-01', 61)), '2026-06-01').map((gap) => gap.family)).toEqual(['fomc']);
  });

  it('le 15 décembre 2026 : les NFP estimés du 31 décembre et du 8 janvier, les CPI estimés de janvier, rien avant la dernière date connue', () => {
    const estimates = coverageEstimates(SEPT, '2026-12-15');
    const dates = (title: string) => estimates.filter((event) => event.title === title).map((event) => event.date);
    expect(dates('Rapport emploi US (NFP)')).toEqual(['2026-12-31', '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02']);
    expect(dates('Inflation CPI')).toEqual([
      '2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15',
      '2027-02-10', '2027-02-11', '2027-02-12',
      '2027-03-10', '2027-03-11', '2027-03-12', '2027-03-15',
      '2027-04-12', '2027-04-13', '2027-04-14',
    ]);
    // Le CPI de décembre est sorti le 10 : aucune estimation ne le double le 15.
    expect(estimates.some((event) => event.date <= '2026-12-24' && event.title === 'Inflation CPI')).toBe(false);
    // Chaque estimation le dit, et vaut un catalyseur majeur à 8 h 30 ET.
    for (const event of estimates) {
      expect(event).toMatchObject({ estimated: true, impact: 3, timeET: '08:30', source: 'local', description: COVERAGE_ESTIMATE_NOTE });
      expect(estimateMark(event)).toBe('≈');
      expect(event.date >= '2026-12-15' && event.date <= addDays('2026-12-15', ESTIMATE_HORIZON_DAYS)).toBe(true);
    }
    expect(new Set(estimates.map((event) => event.id)).size).toBe(estimates.length);
    expect(estimates.map((event) => event.date)).toEqual([...estimates.map((event) => event.date)].sort());
  });

  it('une date officielle connue referme le trou : plus aucune estimation de sa famille', () => {
    const withJanuary = [...SEPT, row('bls:nfp-2027-01-08', '2027-01-08')];
    expect(coverageGaps(withJanuary, '2026-12-15').map((gap) => gap.family)).toEqual(['cpi']);
    expect(coverageEstimates(withJanuary, '2026-12-15').some((event) => event.title === 'Rapport emploi US (NFP)')).toBe(false);
  });

  it('la source unique du catalyseur les montre avec la journée, sans doubler le CPI estimé du générateur local', () => {
    // Sans journée, rien ne change : la source reste celle d'avant.
    const before = catalystSource(SEPT, [2026, 2027]);
    expect(before.some((event) => event.id.includes('-estime_'))).toBe(false);
    const shown = catalystSource(SEPT, [2026, 2027], '2026-12-15');
    const nfp = shown.filter((event) => event.title === 'Rapport emploi US (NFP)' && event.date >= '2026-12-15').map((event) => `${estimateMark(event)}${event.date}`);
    expect(nfp).toEqual(['≈2026-12-31', '≈2027-01-08', '≈2027-02-05', '≈2027-03-05', '≈2027-04-02']);
    // Le 13 janvier 2027, deuxième mercredi : le CPI estimé du générateur local y est déjà, un seul repère ce jour-là.
    expect(shown.filter((event) => event.date === '2027-01-13' && event.title === 'Inflation CPI')).toHaveLength(1);
    expect(shown.filter((event) => event.date === '2027-01-12' && event.title === 'Inflation CPI')).toHaveLength(1);
    // Hors des années demandées, aucune estimation (les lignes officielles, elles, sont toujours rendues entières).
    const only2026 = catalystSource(SEPT, [2026], '2026-12-15').filter((event) => event.id.includes('-estime_'));
    expect(only2026.map((event) => event.date)).toEqual(['2026-12-31']);
    expect(shown.length).toBe(before.length + coverageEstimates(SEPT, '2026-12-15').length - 4);
  });
});

describe('SEC2.2 les estimations sont dans les gardes', () => {
  const NOW = at('2026-12-15', '10:00');

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    useMacro.setState({ events: SEPT, ready: true });
    useJournal.setState({ sessions: [], trades: [] });
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, traderRules: { ...DEFAULT_TRADER_RULES, catalystBlackoutMin: 30 } } });
  });
  afterEach(() => {
    vi.useRealTimers();
    useMacro.setState({ events: [], ready: false });
    useSettings.setState({ settings: DEFAULT_SETTINGS });
    useI18n.setState({ locale: 'fr' });
  });

  it('blackout du Copieur : les instants des NFP et CPI estimés partent au process principal, les plus proches d’abord', () => {
    const estimates = coverageEstimates(SEPT, '2026-12-15');
    const plain = copierCatalysts(SEPT, [], NOW).map((c) => c.at);
    const guarded = copierCatalysts(SEPT, estimates, NOW).map((c) => c.at);
    for (const instant of [at('2026-12-31', '08:30'), at('2027-01-08', '08:30'), at('2027-01-13', '08:30')]) {
      expect(plain).not.toContain(instant);
      expect(guarded).toContain(instant);
    }
    // Triés, sans doublon, sans catalyseur passé depuis plus d'une heure : le process principal garde les 64 premiers.
    expect(guarded).toEqual([...new Set(guarded)].sort((a, b) => a - b));
    expect(guarded.every((instant) => instant >= NOW - 60 * 60 * 1000)).toBe(true);
    expect(copierCatalysts(SEPT, [], at('2026-12-09', '14:10')).map((c) => c.at)).toContain(at('2026-12-09', '14:00'));
    expect(copierCatalysts(SEPT, [], at('2026-12-09', '15:01')).map((c) => c.at)).not.toContain(at('2026-12-09', '14:00'));
    const many = Array.from({ length: 100 }, (_, i) => row(`bls:nfp-x${i}`, addDays('2027-06-01', i)));
    const kept = coerceCopierSync({ masterAccount: 'Sim101', maxContractsPerOrder: 20, followers: [], catalysts: copierCatalysts([...many, ...SEPT], estimates, NOW) })!.catalysts.map((c) => c.at);
    expect(kept).toHaveLength(64);
    expect(kept).toContain(at('2026-12-31', '08:30'));
  });

  it('blackout du Copieur : une ouverture copiée à 8 h 30 le 8 janvier 2027 est refusée ; sans les estimations, elle partait', () => {
    const topology = { masterAccount: 'Sim101', followers: [{ account: 'Sim102', sizing: { mode: 'ratio' as const, value: 1, maxContracts: 5 }, symbolMap: { mode: 'identique' as const } }], latencyBudgetMs: 60_000, newsBlackout: true, windowStart: '00:00', windowEnd: '23:59', followerBufferFloor: 0.3 };
    const time = at('2027-01-08', '08:31');
    const fill = { account: 'Sim101', instrument: 'NQ 03-27', side: 'buy' as const, qty: 1, price: 25_000, time, executionId: 'e1' };
    const context = (catalysts: { at: number }[]) => ({ now: time, localMinutes: 12 * 60, catalysts, maxContractsPerOrder: 20, states: [] });
    const without = routeFill(fill, topology, context(copierCatalysts(SEPT, [], NOW)));
    expect(without.orders).toHaveLength(1);
    const guarded = routeFill(fill, topology, context(copierCatalysts(SEPT, coverageEstimates(SEPT, '2026-12-15'), NOW)));
    expect(guarded.orders).toEqual([]);
    expect(guarded.refused).toEqual([{ reason: 'blackout', account: 'Sim102', instrument: 'NQ 03-27', qty: 1 }]);
  });

  it('garde « catalyseur » de l’agent : une ouverture proposée à 8 h 20 le 31 décembre et le 8 janvier est dans la fenêtre du NFP estimé', () => {
    const proposal = { account: 'Sim101', instrument: 'MNQ 03-27', qty: 1 };
    for (const day of ['2026-12-31', '2027-01-08']) {
      const blocks = traderRuleBlocks(proposal, at(day, '08:20'));
      expect(blocks.map((block) => block.rule), day).toEqual(['catalyst_window']);
      expect(blocks[0]!.detail, day).toContain('08:30');
    }
    // Un CPI estimé de janvier, hors du deuxième mercredi que le générateur local donnait déjà.
    expect(traderRuleBlocks(proposal, at('2027-01-12', '08:20')).map((block) => block.rule)).toEqual(['catalyst_window']);
    // Hors fenêtre, ou un jour sans estimation, rien.
    expect(traderRuleBlocks(proposal, at('2027-01-08', '10:00'))).toEqual([]);
    expect(traderRuleBlocks(proposal, at('2027-01-07', '08:20'))).toEqual([]);
    // Tant que le calendrier couvre, la garde lit les dates officielles, et elles seules.
    expect(traderRuleBlocks(proposal, at('2026-12-04', '08:20')).map((block) => block.rule)).toEqual(['catalyst_window']);
    expect(traderRuleBlocks(proposal, at('2026-11-27', '08:20'))).toEqual([]);
  });

  it('le Calendrier le dit, dans les trois langues, avec la dernière date connue', () => {
    expect(coverageNotice([])).toBeNull();
    const gaps = coverageGaps(SEPT, '2026-12-15');
    expect(coverageNotice(gaps)).toMatchObject({ text: 'Couverture · NFP et CPI estimés par règle' });
    expect(coverageNotice(gaps)!.detail).toContain('NFP 04.12.2026 · CPI 10.12.2026');
    expect(coverageNotice(coverageGaps(SEPT, '2026-12-05'))!.text).toBe('Couverture · NFP estimé par règle');
    expect(coverageNotice(coverageGaps(SEPT, '2027-03-18'))!.text).toBe('Couverture · NFP et CPI estimés par règle · FOMC sans date');
    expect(coverageNotice(coverageGaps([], '2026-11-09'))!.detail).toContain('NFP aucune');
    useI18n.setState({ locale: 'en' });
    expect(coverageNotice(gaps)!.text).toBe('Coverage · NFP and CPI estimated by rule');
    expect(trEventDesc(COVERAGE_ESTIMATE_NOTE)).toContain('estimated by rule');
    useI18n.setState({ locale: 'es' });
    expect(coverageNotice(gaps)!.text).toBe('Cobertura · NFP y CPI estimados por regla');
    expect(trEventDesc(COVERAGE_ESTIMATE_NOTE)).toContain('estimada por regla');
  });

  it('câblage : le Calendrier, la barre d’état, la frise et les objets lisent la source avec la journée ; le Copieur envoie les estimations', () => {
    const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    expect(read('src/modules/calendrier/Calendrier.tsx')).toMatch(/catalystSource\(eventsMacro, \[year - 1, year, year \+ 1\], etToday\)/);
    expect(read('src/modules/calendrier/Calendrier.tsx')).toMatch(/coverageNotice\(coverageGaps\(eventsMacro, etToday\)\)/);
    expect(read('src/app/useDayBornes.ts')).toMatch(/catalystSource\(official, \[year, year \+ 1\], today\)/);
    expect(read('src/app/FriseAnswer.tsx')).toMatch(/catalystSource\(official, \[first, year, year \+ 1\], today\)/);
    expect(read('src/app/objects/index.ts')).toMatch(/catalystSource\(rows, years\.split\(','\)\.map\(Number\), today\)/);
    expect(read('src/store/copierSync.ts')).toMatch(/copierCatalysts\(useMacro\.getState\(\)\.events, coverageEstimates\(useMacro\.getState\(\)\.events, etDateKey\(Date\.now\(\)\)\)\)/);
    // La braise, jamais le rouge, réservé au niveau 3.
    const css = read('src/modules/calendrier/calendrier.module.css');
    expect(css).toMatch(/\.feedStatus\.gap \{\n  color: var\(--ember\);\n\}/);
  });
});

/**
 * SEC2.8 — l'instantané embarqué porte le premier trimestre 2027 du BLS. Le BLS a publié son calendrier 2027 ; ses deux
 * pages, relues le 9 novembre 2026 par l'adaptateur du desk, sont transcrites dans les fixtures, et l'instantané en est
 * régénéré. Jusqu'au NFP du 5 mars et au CPI du 10 mars 2027, les gardes lisent des dates officielles : la garde de
 * couverture ne se déclenche plus en décembre, et le 31 décembre 2026, que la règle estimait, n'est plus un blackout.
 */
describe('SEC2.8 l’instantané porte les dates 2027 publiées par le BLS', () => {
  const published = (kind: 'empsit' | 'cpi') => parseBlsSchedule(fixture(kind === 'empsit' ? 'bls-empsit.html' : 'bls-cpi.html'), kind).filter((r) => r.date.startsWith('2027'));
  const bundled = (family: 'nfp' | 'cpi') => BUNDLE.filter((r) => coverageFamily(r) === family && r.date.startsWith('2027'));
  const dates = (rows: { date: string }[]) => rows.map((r) => r.date);
  const proposal = { account: 'Sim101', instrument: 'MNQ 03-27', qty: 1 };
  const NOW = at('2026-12-15', '10:00');

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    useMacro.setState({ events: BUNDLE, ready: true });
    useJournal.setState({ sessions: [], trades: [] });
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, traderRules: { ...DEFAULT_TRADER_RULES, catalystBlackoutMin: 30 } } });
  });
  afterEach(() => {
    vi.useRealTimers();
    useMacro.setState({ events: [], ready: false });
    useSettings.setState({ settings: DEFAULT_SETTINGS });
  });

  it('les fixtures portent les douze NFP et les douze CPI de 2027, à 8 h 30, tels que le BLS les publie', () => {
    expect(dates(published('empsit'))).toEqual(['2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02', '2027-05-07', '2027-06-04', '2027-07-02', '2027-08-06', '2027-09-03', '2027-10-08', '2027-11-05', '2027-12-03']);
    expect(dates(published('cpi'))).toEqual(['2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12', '2027-06-10', '2027-07-14', '2027-08-11', '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10']);
    for (const r of [...published('empsit'), ...published('cpi')]) expect(r, r.id).toMatchObject({ timeET: '08:30', impact: 3, estimated: false });
  });

  it('l’instantané embarque celles de sa couverture : officielles, non estimées', () => {
    const coverage = bundleCoverage();
    const covered = (rows: { date: string }[]) => dates(rows).filter((date) => date >= coverage.from && date <= coverage.to);
    expect(dates(bundled('nfp'))).toEqual(covered(published('empsit')));
    expect(dates(bundled('cpi'))).toEqual(covered(published('cpi')));
    for (const date of ['2027-01-08', '2027-02-05', '2027-03-05']) expect(dates(bundled('nfp'))).toContain(date);
    for (const date of ['2027-01-13', '2027-02-11', '2027-03-10']) expect(dates(bundled('cpi'))).toContain(date);
    for (const r of [...bundled('nfp'), ...bundled('cpi')]) {
      expect(r, r.id).toMatchObject({ sourceId: 'bundle', origin: 'bls', timeET: '08:30', impact: 3, estimated: false });
      expect(eventProvenance(r.sourceId, r.origin)).toBe('Calendrier embarqué · BLS');
    }
  });

  it('les règles d’estimation retrouvent les vingt-quatre dates de 2027, une année sur laquelle elles n’ont pas été réglées', () => {
    let single = 0;
    for (const r of published('empsit')) {
      const month = Number(r.date.slice(5, 7));
      const candidates = month === 1 ? nfpEstimateDates(2026, 12) : nfpEstimateDates(2027, month - 1);
      expect(candidates, r.date).toContain(r.date);
      if (candidates.length === 1) single += 1;
    }
    // Onze par le seul troisième vendredi ; le 8 janvier par l'écart du Nouvel An (la règle tombe le 1er, férié).
    expect(single).toBe(11);
    for (const r of published('cpi')) expect(cpiEstimateDates(2027, Number(r.date.slice(5, 7))), r.date).toContain(r.date);
  });

  it('le 15 décembre 2026 : plus de trou, plus d’estimation, et le Copieur reçoit les instants officiels de janvier', () => {
    expect(coverageGaps(BUNDLE, '2026-12-15')).toEqual([]);
    expect(coverageEstimates(BUNDLE, '2026-12-15')).toEqual([]);
    expect(coverageNotice(coverageGaps(BUNDLE, '2026-12-15'))).toBeNull();
    const instants = copierCatalysts(BUNDLE, coverageEstimates(BUNDLE, '2026-12-15'), NOW).map((c) => c.at);
    expect(instants).toContain(at('2027-01-08', '08:30'));
    expect(instants).toContain(at('2027-01-13', '08:30'));
    // Le 31 décembre n'était qu'une date de la règle : le BLS publie le 8 janvier.
    expect(instants).not.toContain(at('2026-12-31', '08:30'));
  });

  it('garde « catalyseur » de l’agent : la fenêtre du NFP officiel du 8 janvier, plus rien le 31 décembre', () => {
    const blocks = traderRuleBlocks(proposal, at('2027-01-08', '08:20'));
    expect(blocks.map((block) => block.rule)).toEqual(['catalyst_window']);
    expect(blocks[0]!.detail).toContain('08:30');
    expect(traderRuleBlocks(proposal, at('2027-01-13', '08:20')).map((block) => block.rule)).toEqual(['catalyst_window']);
    expect(traderRuleBlocks(proposal, at('2026-12-31', '08:20'))).toEqual([]);
    // Les jours ouvrés du 10 au 15 que la règle fermait pour le CPI de janvier ne le sont plus, sauf le 13.
    expect(traderRuleBlocks(proposal, at('2027-01-12', '08:20'))).toEqual([]);
  });

  it('le trou s’ouvre au lendemain de la dernière date embarquée, et la règle prend le relais sur les dates que le BLS publie', () => {
    const last = dates(bundled('nfp')).at(-1)!;
    const next = addDays(last, 1);
    expect(coverageGaps(BUNDLE, last).some((gap) => gap.family === 'nfp')).toBe(false);
    expect(coverageGaps(BUNDLE, next)).toContainEqual({ family: 'nfp', next: null, last });
    const estimated = coverageEstimates(BUNDLE, next).filter((event) => event.title === 'Rapport emploi US (NFP)').map((event) => event.date);
    expect(estimated.length).toBeGreaterThan(0);
    for (const date of dates(published('empsit')).filter((d) => d > addDays(last, 14) && d <= addDays(next, ESTIMATE_HORIZON_DAYS))) expect(estimated, date).toContain(date);
  });
});
