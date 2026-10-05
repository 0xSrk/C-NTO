import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_ORDER_REFUSALS } from '@/engine/agent/orders';
import { useI18n } from '@/i18n';
import { outcomeLabel, refusalLabel } from '@/modules/agent/agentOrderLabels';

describe('panneau des ordres proposés par l’agent', () => {
  afterEach(() => useI18n.setState({ locale: 'fr' }));

  it('chaque refus du desk a son libellé, dans les trois langues', () => {
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      const labels = AGENT_ORDER_REFUSALS.map((r) => refusalLabel(r));
      expect(new Set(labels).size).toBe(AGENT_ORDER_REFUSALS.length);
      expect(labels).not.toContain(refusalLabel('invalid'));
    }
  });

  it('seul un ordre envoyé est un succès', () => {
    useI18n.setState({ locale: 'en' });
    expect(outcomeLabel({ status: 'sent', orderId: 'o1', account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, resulting: 1 })).toEqual({ ok: true, text: 'sent · o1' });
    expect(outcomeLabel({ status: 'refused', reason: 'prop_buffer', detail: 'x' })).toEqual({ ok: false, text: 'refused by the desk · prop plan buffer too low' });
    expect(outcomeLabel({ status: 'declined', detail: 'declined by the trader' })).toEqual({ ok: false, text: 'declined by the trader' });
    expect(outcomeLabel({ status: 'failed', code: -32010, detail: 'account not allowed' }).ok).toBe(false);
  });
});
