import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { followerCount, railQuantity, type RailSnapshot } from '@/app/railQuantity';
import { useI18n } from '@/i18n';

const EMPTY: RailSnapshot = { sessions: 0, todayEntries: 0, notes: 0, links: 0, agentRunning: false, agentReportsUnread: null, copierFollowers: null, cryptoEnabled: false, cryptoMarkets: 0 };
const shell = readFileSync('src/app/Shell.tsx', 'utf8');
const css = readFileSync('src/app/shell.module.css', 'utf8');
/** Corps de la règle dont le sélecteur ouvre la ligne (pas une règle descendante qui le contient). */
const rule = (selector: string) => {
  const at = css.replace(/\r\n/g, '\n').search(new RegExp(`^${selector.replace(/[.]/g, '\\.')} \\{`, 'm'));
  const text = css.replace(/\r\n/g, '\n');
  return at < 0 ? '' : text.slice(at, text.indexOf('}', at));
};

afterEach(() => useI18n.setState({ locale: 'fr' }));

describe('OROS2.3 rail-bordereau', () => {
  it('chaque module dit sa quantité, lue dans les données du desk', () => {
    const snap: RailSnapshot = { sessions: 140, todayEntries: 3, notes: 48, links: 112, agentRunning: false, agentReportsUnread: 0, copierFollowers: 2, cryptoEnabled: true, cryptoMarkets: 4 };
    expect(railQuantity('metrique', snap)).toBe('140 séances');
    expect(railQuantity('calendrier', snap)).toBe('3 repères ce jour');
    expect(railQuantity('note', snap)).toBe('48 notes · 112 liens');
    expect(railQuantity('agent', snap)).toBe('En veille');
    expect(railQuantity('agent', { ...snap, agentRunning: true })).toBe('Orchestrateur en service');
    expect(railQuantity('copieur', snap)).toBe('2 comptes suiveurs');
    expect(railQuantity('crypto', snap)).toBe('4 marchés suivis');
  });

  it('CLD10 l’agent dit ses rapports non lus avant l’état de l’orchestrateur ; sans statut, rien ne change', () => {
    expect(railQuantity('agent', { ...EMPTY, agentReportsUnread: 1 })).toBe('1 rapport non lu');
    expect(railQuantity('agent', { ...EMPTY, agentReportsUnread: 3, agentRunning: true })).toBe('3 rapports non lus');
    expect(railQuantity('agent', { ...EMPTY, agentReportsUnread: 0, agentRunning: true })).toBe('Orchestrateur en service');
    expect(railQuantity('agent', { ...EMPTY, agentReportsUnread: null })).toBe('En veille');
    useI18n.setState({ locale: 'en' });
    expect(railQuantity('agent', { ...EMPTY, agentReportsUnread: 2 })).toBe('2 unread reports');
    expect(shell).toContain('agentReportsUnread: reportsUnread,');
  });

  it('accorde le nombre et parle la langue du desk', () => {
    expect(railQuantity('metrique', { ...EMPTY, sessions: 1 })).toBe('1 séance');
    useI18n.setState({ locale: 'en' });
    expect(railQuantity('metrique', { ...EMPTY, sessions: 140 })).toBe('140 sessions');
    expect(railQuantity('note', { ...EMPTY, notes: 1, links: 0 })).toBe('1 note · 0 links');
    useI18n.setState({ locale: 'es' });
    expect(railQuantity('crypto', { ...EMPTY, cryptoEnabled: true, cryptoMarkets: 4 })).toBe('4 mercados seguidos');
  });

  it('se tait plutôt que d’inventer : rien sans donnée lue', () => {
    expect(railQuantity('metrique', EMPTY)).toBe('Journal vide');
    for (const id of ['visual', 'portefeuille', 'bot'] as const) expect(railQuantity(id, { ...EMPTY, sessions: 9 })).toBeNull();
    expect(railQuantity('calendrier', EMPTY)).toBeNull();
    expect(railQuantity('copieur', EMPTY)).toBeNull();
    expect(railQuantity('crypto', EMPTY)).toBeNull();
  });

  it('OROS4.19 le rail n’a plus de catégorie : chaque module, en cartouche, dit sa quantité ; l’onglet ouvert s’éclaire, filet plus clair et lumière au sommet', () => {
    expect(shell).not.toMatch(/BORDEREAU|MANIFEST|EN CONCEPTION|IN DESIGN|navLabelHead|conceptLabel|dashed/);
    expect(css).not.toMatch(/\.navLabelHead|\.conceptLabel|\.navItem\.dashed/);
    expect(shell).toMatch(/qty=\{railQuantity\(item\.id, snapshot\)\}/);
    expect(shell).toMatch(/aria-current=\{on \? 'page' : undefined\}/);
    // plus d'ivoire poinçonné : l'onglet ouvert garde la nuit et prend la lumière
    const on = rule('.navItem.on');
    expect(on).not.toMatch(/--ivory|--ink/);
    expect(on).toMatch(/color:\s*var\(--text-0\)/);
    // la cartouche : un filet d'un pixel à l'ivoire très bas, découpé au chanfrein du Lab, et son fond retiré d'un pixel
    const ivory = (body: string) => Number(/color-mix\(in srgb, var\(--ivory\) ([\d.]+)%, var\(--bg-0\)\)\s*;?\s*$/m.exec(body)?.[1] ?? NaN);
    const frame = rule('.navItem::before');
    expect(frame).toMatch(/clip-path:\s*var\(--chamfer\)/);
    expect(ivory(frame)).toBeLessThanOrEqual(8);
    expect(rule('.navItem::after')).toMatch(/inset:\s*1px/);
    // l'onglet ouvert : le filet s'éclaircit, la lumière se pose sur son arête haute ; plus de filament d'or au bord
    const lit = rule('.navItem.on::before');
    expect(ivory(lit)).toBeGreaterThan(ivory(frame));
    expect(lit).toMatch(/top \/ 100% 1px no-repeat/);
    expect(css).not.toMatch(/scaleY\(0\.3\)/);
    // le numéro du raccourci devient un code au coin de la cartouche
    expect(rule('.navIndex')).toMatch(/position:\s*absolute/);
    expect(rule('.navQty')).toMatch(/font-family:\s*var\(--font-mono\)/);
  });
});

describe('R3.7f le Copieur ne compte que ses suiveurs, jamais le maître', () => {
  it('un maître et deux suiveurs : « 2 comptes suiveurs » ; le maître seul : « Aucun suiveur »', () => {
    const desk = [{ role: 'maitre' }, { role: 'suiveur' }, { role: 'suiveur' }] as const;
    expect(followerCount(desk)).toBe(2);
    expect(railQuantity('copieur', { ...EMPTY, copierFollowers: followerCount(desk) })).toBe('2 comptes suiveurs');
    expect(railQuantity('copieur', { ...EMPTY, copierFollowers: followerCount([{ role: 'maitre' }]) })).toBe('Aucun suiveur');
    useI18n.setState({ locale: 'en' });
    expect(railQuantity('copieur', { ...EMPTY, copierFollowers: followerCount(desk) })).toBe('2 follower accounts');
    // Le rail lit ce compte, pas la longueur de la liste des comptes.
    expect(shell).toContain('useCopier((c) => followerCount(c.accounts))');
    expect(shell).toContain('copierFollowers: copierReady ? copierFollowers : null,');
    expect(shell).not.toContain('c.accounts.length');
  });
});

describe('R3.7g module Crypto éteint, le rail se tait', () => {
  it('la liste suivie ne dit rien tant que le module est éteint', () => {
    const watched = { ...EMPTY, cryptoMarkets: 4 };
    expect(railQuantity('crypto', { ...watched, cryptoEnabled: false })).toBeNull();
    expect(railQuantity('crypto', { ...watched, cryptoEnabled: true })).toBe('4 marchés suivis');
    expect(shell).toContain('const cryptoEnabled = useCrypto((c) => c.enabled);');
    expect(shell).toMatch(/^\s+cryptoEnabled,\r?\n\s+cryptoMarkets,\r?$/m);
  });
});
