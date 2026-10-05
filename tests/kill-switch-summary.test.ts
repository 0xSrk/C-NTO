import { describe, expect, it } from 'vitest';
import { killSwitchSummary } from '@/engine/execution/killSwitch';
import { useI18n } from '@/i18n';

describe('message du kill switch', () => {
  useI18n.setState({ locale: 'fr' });

  it('tout confirmé : comptes aplatis nommés', () => {
    const m = killSwitchSummary({ accounts: ['Sim101', 'Sim102'], sent: true, results: [{ account: 'Sim101', ok: true, closed: 1 }, { account: 'Sim102', ok: true, closed: 0 }] });
    expect(m.tone).toBe('warn');
    expect(m.text).toContain('2 compte(s) aplati(s) : Sim101, Sim102');
  });

  it('un refus : il n’est pas compté comme aplati et la raison est donnée', () => {
    const m = killSwitchSummary({ accounts: ['Sim101', 'APEX-50K'], sent: true, results: [{ account: 'Sim101', ok: true, closed: 1 }, { account: 'APEX-50K', ok: false, error: 'délai dépassé' }] });
    expect(m.tone).toBe('error');
    expect(m.text).toContain('1/2');
    expect(m.text).toContain('APEX-50K (délai dépassé)');
    expect(m.text).toContain('NinjaTrader');
  });

  it('pont hors ligne : aucun « aplati »', () => {
    const m = killSwitchSummary({ accounts: ['Sim101'], sent: false, results: [{ account: 'Sim101', ok: false, error: 'pont indisponible' }] });
    expect(m.tone).toBe('error');
    expect(m.text).not.toMatch(/aplati\(s\)/);
    expect(m.text).toContain('hors ligne');
  });

  it('aucun compte connu : le dire', () => {
    expect(killSwitchSummary({ accounts: [], sent: true, results: [] }).text).toContain('aucun compte autorisé');
  });
});
