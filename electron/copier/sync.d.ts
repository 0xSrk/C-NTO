export interface CopierSync {
  topology: {
    masterAccount: string;
    followers: { account: string; sizing: { mode: 'fixe' | 'ratio' | 'risque'; value: number; maxContracts: number }; symbolMap: { mode: 'identique' } | { mode: 'micro' } | { mode: 'standard' } | { mode: 'explicite'; from: string; to: string } }[];
    latencyBudgetMs: number;
    newsBlackout: boolean;
    windowStart: string;
    windowEnd: string;
    followerBufferFloor: number;
  };
  states: { account: string; plan: unknown; sessions: unknown[]; trades: unknown[] }[];
  catalysts: { at: number }[];
  maxContractsPerOrder: number;
  flattenOnCut: boolean;
}
export function coerceCopierSync(raw: unknown): CopierSync | null;
export function followerExclusion(account: string, masterAccount: string, seen: ReadonlySet<string>): 'non-sim' | 'maitre' | 'doublon' | null;
