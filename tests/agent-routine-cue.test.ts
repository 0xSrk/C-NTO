import { describe, expect, it, vi } from 'vitest';
import { prepareVaultRestore } from '@/store/db';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { pressRoutine, routineDue } from '@/engine/agent/routineDue';

const at = zonedToUtc('2026-10-06', '08:45', ET_ZONE);

describe('A12.3 pastille du brief et du débrief', () => {
  it('la pastille tient une fois par journée CME, et rien ne part sans clic', () => {
    const run = vi.fn();
    const due = routineDue(at, { tradesToday: 0, dailyLossFull: false });
    expect(due.brief).toBe(true);
    expect(pressRoutine('brief', due, {}, false, run)).toEqual({});
    expect(run).not.toHaveBeenCalled();
    const seen = pressRoutine('brief', due, {}, true, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('pre_session_brief');
    expect(routineDue(at, { tradesToday: 0, dailyLossFull: false, seen }).brief).toBe(false);
    const later = zonedToUtc('2026-10-06', '16:20', ET_ZONE);
    const close = routineDue(later, { tradesToday: 2, dailyLossFull: false, seen });
    expect(close.debrief).toBe(true);
    expect(pressRoutine('debrief', close, seen, false, run)).toEqual(seen);
    expect(run).toHaveBeenCalledTimes(1);
    const both = pressRoutine('debrief', close, seen, true, run);
    expect(run).toHaveBeenCalledWith('session_debrief');
    expect(routineDue(later, { tradesToday: 2, dailyLossFull: false, seen: both }).debrief).toBe(false);
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
