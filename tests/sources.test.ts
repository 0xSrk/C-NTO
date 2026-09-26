import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allowedHosts, dataFetchAllowed, getSource, listSources, SOURCES } from '@/engine/sources';

describe('registre de sources', () => {
  it('a des identifiants uniques et des hôtes nus', () => {
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of SOURCES) {
      for (const host of spec.hosts) {
        expect(host.includes('://')).toBe(false);
        expect(host.includes('/')).toBe(false);
        expect(host.includes(':')).toBe(false);
        expect(host).toBe(host.trim().toLowerCase());
      }
    }
  });

  it('exclut les hôtes non redistribuables et exige un libellé byok', () => {
    const allowed = allowedHosts();
    for (const spec of SOURCES) {
      if (spec.auth === 'byok') expect(spec.byokLabel && spec.byokLabel.length > 0).toBe(true);
      for (const host of spec.hosts) {
        expect(allowed.includes(host)).toBe(spec.redistributable);
      }
    }
    expect(allowed.includes('endpoints.investing.com')).toBe(false);
    expect(allowed.includes('nfs.faireconomy.media')).toBe(false);
    expect(allowed.includes('www.cmegroup.com')).toBe(false);
    expect(allowed.includes('api.bls.gov')).toBe(true);
    expect(allowed.includes('www.bls.gov')).toBe(true);
    expect(getSource('investing').redistributable).toBe(false);
    expect(getSource('bundle').kind).toBe('calendar');
    expect(getSource('bundle').hosts).toEqual([]);
    expect(getSource('bundle').auth).toBe('none');
    expect(getSource('bundle').freshness).toBe('static');
    expect(getSource('bundle').redistributable).toBe(true);
    expect(getSource('bundle').terms.summary).toMatch(/Banque centrale européenne/);
    expect(getSource('nt8-bridge').redistributable).toBe(true);
    expect(getSource('nt8-bridge').hosts).toEqual([]);
    expect(() => getSource('inexistante')).toThrow(/inconnue/);
    expect(listSources('marketdata').map((s) => s.id).sort()).toEqual(['csv', 'demo', 'nt8-bridge']);
  });

  it('n’autorise que les hôtes des adaptateurs redistribuables', () => {
    const allowed = allowedHosts();
    expect(allowed).toEqual([
      'api.bls.gov',
      'api.stlouisfed.org',
      'apps.bea.gov',
      'www.bea.gov',
      'www.bls.gov',
      'www.ecb.europa.eu',
      'www.eia.gov',
      'www.federalreserve.gov',
      'www.treasurydirect.gov',
    ]);
    expect(allowed.includes('endpoints.investing.com')).toBe(false);
    expect(dataFetchAllowed('https://endpoints.investing.com/pd-instruments/v1/calendars/economic/events/occurrences')).toBe(false);
    expect(dataFetchAllowed('https://nfs.faireconomy.media/ff_calendar_thisweek.json')).toBe(false);
    expect(dataFetchAllowed('https://api.bls.gov/publicAPI/v2/timeseries/data/')).toBe(true);
    expect(dataFetchAllowed('https://www.bls.gov/schedule/news_release/empsit.htm')).toBe(true);
    expect(dataFetchAllowed('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')).toBe(true);
    expect(dataFetchAllowed('https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html')).toBe(true);
    expect(dataFetchAllowed('https://www.eia.gov/petroleum/supply/weekly/schedule.php')).toBe(true);
    expect(dataFetchAllowed('https://www.treasurydirect.gov/TA_WS/securities/announced')).toBe(true);
    expect(dataFetchAllowed('https://www.cmegroup.com/markets.html')).toBe(false);
    expect(dataFetchAllowed('https://api.openai.com/v1/models')).toBe(false);
    expect(dataFetchAllowed('http://api.bls.gov/publicAPI')).toBe(false);
    expect(dataFetchAllowed('pas une url')).toBe(false);
  });

  it('le process principal dérive ses hôtes du registre, sans fetch ajouté dans main', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    expect(main).toContain('allowedHosts()');
    expect(main).toContain('dataFetchAllowed');
    expect(main.includes('net.fetch')).toBe(false);
    expect(main).toContain("detail: 'aucune source live'");
  });
});
