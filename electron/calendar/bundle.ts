/**
 * Socle calendrier : l'instantané embarqué, sans réseau.
 * `fetch` filtre la plage et ne lève pas.
 */

import { materializeBundle } from '../calendar-bundle/index';
import type { CalendarEventRow } from './types';

export { bundleCoverage, bundleYear } from '../calendar-bundle/index';

export const bundleAdapter = {
  sourceId: 'bundle' as const,
  async fetch(range: { from: string; to: string }): Promise<CalendarEventRow[]> {
    try {
      return materializeBundle(range, 0);
    } catch {
      return [];
    }
  },
};
