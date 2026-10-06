import { describe, expect, it } from 'vitest';
import { prepareVaultRestore } from '@/store/db';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { ROUTINE_OF, routineDue } from '@/engine/agent/routineDue';

const at = zonedToUtc('2026-10-06', '08:45', ET_ZONE);

// « Rien ne part sans clic » se prouve sur le composant lui-même : tests/agent-tab.test.ts (A12.6).
describe('A12.3 pastille du brief et du débrief', () => {
  it('chaque bouton lance sa routine ; la pastille tient une fois par journée CME', () => {
    expect(ROUTINE_OF).toEqual({ brief: 'pre_session_brief', debrief: 'session_debrief' });
    const due = routineDue(at, { tradesToday: 0, dailyLossFull: false });
    expect(due.brief).toBe(true);
    const seen = { brief: due.day };
    expect(routineDue(at, { tradesToday: 0, dailyLossFull: false, seen }).brief).toBe(false);
    const later = zonedToUtc('2026-10-06', '16:20', ET_ZONE);
    const close = routineDue(later, { tradesToday: 2, dailyLossFull: false, seen });
    expect(close.debrief).toBe(true);
    expect(routineDue(later, { tradesToday: 2, dailyLossFull: false, seen: { ...seen, debrief: close.day } }).debrief).toBe(false);
  });

  it('la journée vue se restaure depuis le coffre, et un coffre ancien reste lisible', () => {
    const old = prepareVaultRestore(JSON.stringify({ artefact: 'CΛNTO', sessions: [], settings: [{ key: 'agent.conversation', value: 'conv_1' }] }));
    expect(old.otherSettings.map((row) => row.key)).toEqual(['agent.conversation']);
    const kept = prepareVaultRestore(
      JSON.stringify({
        artefact: 'CΛNTO',
        sessions: [],
        settings: [{ key: 'agent.routineSeen', value: { brief: '2026-10-06', debrief: '2026-10-06' } }],
      }),
    );
    expect(kept.otherSettings).toEqual([{ key: 'agent.routineSeen', value: { brief: '2026-10-06', debrief: '2026-10-06' } }]);
    const bad = prepareVaultRestore(JSON.stringify({ artefact: 'CΛNTO', sessions: [], settings: [{ key: 'agent.routineSeen', value: { brief: 'demain' } }] }));
    expect(bad.otherSettings).toEqual([]);
    expect(bad.skipped.settings).toBe(1);
  });
});
