import { useEffect, useState } from 'react';
import { foldAccount, matchAccount, sameAccount } from '@/engine/accounts';
import { AGENT_SIM_PREFIX, type AgentOrderProposal } from '@/engine/agent/orders';
import { guardMirror, type GuardMirror, type MirrorInput } from '@/engine/guardMirror';
import type { Trade } from '@/engine/types';
import type { AgentOrderStatus, NtBridgeStatus } from '@/lib/desk';
import { useAgentOrders } from '@/store/agentOrders';
import { useBridge } from '@/store/bridge';
import { useDayClose } from '@/store/dayClose';
import { propShareFor, traderRulesOf } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { useSettings } from '@/store/settings';
import { useKillLatch } from './killState';

/** L'horloge du miroir : une fenêtre de catalyseur s'ouvre et se ferme avec le temps. */
export const MIRROR_TICK_MS = 15_000;

/**
 * Le compte de l'ouverture fictive : celui qu'on demande ; sinon le compte suivi s'il est `Sim*` ; sinon le premier
 * `Sim*` que le pont annonce (NinjaTrader a toujours Sim101).
 */
export function agentAccount(planAccount: string, nt: NtBridgeStatus | null): string | null {
  if (planAccount.startsWith(AGENT_SIM_PREFIX)) return planAccount;
  const names = nt?.accountNames?.length ? nt.accountNames : (nt?.accounts.map((a) => a.name) ?? []);
  return names.find((name) => name.startsWith(AGENT_SIM_PREFIX)) ?? null;
}

export interface DeskSnapshot {
  now: number;
  status: AgentOrderStatus;
  nt: NtBridgeStatus | null;
  /** Le verrou du renderer : une coupure vue garde le canal fermé jusqu'au redémarrage. */
  killLatched: boolean;
  planAccount: string;
  trades: readonly Trade[];
  /** Compte demandé (la fiche Compte) ; absent : `agentAccount`. */
  account?: string | null;
  side?: AgentOrderProposal['side'];
}

/**
 * L'instantané du desk tel que le process principal le lirait pour une ouverture de l'agent : le lien et le canal du
 * pont (`publicStatus`), la position du compte au pont (nom exact puis replié, comme `heldPosition`), la marge et les
 * règles du trader que le renderer lui transmettrait (`propShareFor`, `traderRulesOf`).
 */
export function deskMirrorInput(snap: DeskSnapshot): MirrorInput {
  const { nt, status } = snap;
  const account = snap.account === undefined ? agentAccount(snap.planAccount, nt) : snap.account;
  const rows = nt?.accounts ?? [];
  const held = account ? matchAccount(rows.map((row) => row.name), account) : null;
  const row = held ? rows.find((r) => r.name === held.name) : undefined;
  const open = row?.positions.find((p) => p.quantity !== 0);
  const last = snap.trades.reduce<Trade | null>((m, t) => (!m || t.entryTime > m.entryTime ? t : m), null);
  const instrument = open?.instrument ?? last?.instrument ?? null;
  // Même repli que `heldPosition` pour l'instrument : exact d'abord, puis sans casse ni espaces.
  const position = instrument && row ? (row.positions.find((p) => p.instrument === instrument) ?? row.positions.find((p) => foldAccount(p.instrument) === foldAccount(instrument)))?.quantity ?? 0 : 0;
  const name = held?.name ?? account;
  return {
    now: snap.now,
    policy: { enabled: status.enabled, maxQty: status.maxQty, maxPosition: status.maxPosition, perMinute: status.perMinute },
    pending: status.pending,
    link: nt?.link ?? 'absent',
    ordersOpen: (nt?.ordersOpen ?? false) && !snap.killLatched,
    account: name,
    instrument,
    position,
    propShare: name ? propShareFor(name) : null,
    traderRules: name ? traderRulesOf({ account: name, instrument: instrument ?? '', qty: 1 }, snap.now) : [],
    ...(snap.side ? { side: snap.side } : {}),
  };
}

export interface MirrorView extends GuardMirror {
  /** Le process principal répond (application de bureau) ; en navigateur, les ordres de l'agent n'existent pas. */
  available: boolean;
  input: MirrorInput;
  /** Compte suivi (`planAccount`) ; '' : tous les comptes. */
  tracked: string;
  /** Le plan suivi borne-t-il ce compte ? La marge datée (`trackedPropShare`) et la perte du jour (`limitAccount`). */
  binds: { margin: boolean; dailyLoss: boolean };
}

/**
 * Le miroir de la garde pour un compte (la fiche Compte) ou pour le compte où l'agent ouvrirait : `guardMirror` lit
 * l'instantané du desk. Aucun bouton, aucune écriture : la garde et la décision restent au process principal.
 */
export function useGuardMirror(account?: string | null, side?: AgentOrderProposal['side']): MirrorView {
  const status = useAgentOrders((s) => s.status);
  const available = useAgentOrders((s) => s.available);
  const nt = useBridge((b) => b.nt);
  const killLatched = useKillLatch((k) => k.engaged);
  const planAccount = useSettings((st) => st.settings.planAccount);
  // Les règles, le plan, le journal et le calendrier changent ce que lisent `propShareFor` et `traderRulesOf`.
  useSettings((st) => st.settings.traderRules);
  useSettings((st) => st.settings.planId);
  useSettings((st) => st.settings.userPlans);
  useJournal((j) => j.sessions);
  useMacro((m) => m.events);
  // La journée fermée (décision 15) : une fermeture retenue au coffre change la règle que lit `traderRulesOf`.
  useDayClose((d) => d.closes);
  const trades = useJournal((j) => j.trades);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), MIRROR_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  const input = deskMirrorInput({ now: Math.max(now, Date.now()), status, nt, killLatched, planAccount, trades, account, side });
  const mirror = guardMirror(input);
  const name = input.account;
  return {
    ...mirror,
    available,
    input,
    tracked: planAccount,
    binds: { margin: input.propShare !== null, dailyLoss: !!name && (!planAccount || sameAccount(planAccount, name)) },
  };
}
