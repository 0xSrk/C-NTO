import type { AgentOrderPolicy } from '@/engine/agent/orders';
import { routeFill } from '@/engine/copier/router';
import { coerceCopierSync, followerExclusion, ignoredFollowers, packCopierSync, type PackAccount } from '@/engine/copier/sync';
import type { CopierConfig } from '@/engine/copier/types';
import type { GuardMirror } from '@/engine/guardMirror';
import type { PropPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { tr } from '@/i18n';

/**
 * Les critères en miroir d'Armer (Copieur) et d'Activer (ordres de l'agent) (OROS5.43, Système 5 « Fiche et Frise » ;
 * repris du prototype D · Porte, d4, D11 ; greffe du juge Palantir). Pur. Aucun critère n'est recodé : chacun se lit de la
 * garde qui l'applique — pour le Copieur, la charge que relit le process principal (`packCopierSync` puis
 * `coerceCopierSync`), l'exclusion des suiveurs (`followerExclusion`, `ignoredFollowers`) et le plancher que le routeur
 * oppose à une ouverture copiée (`routeFill`, la marge datée de K.04) ; pour l'agent, le miroir de `guardProposal`.
 *
 * Un miroir : il dit le premier critère manquant en mots, il n'arme, n'active ni ne bloque rien. Le bouton ouvre toujours
 * le dialogue du process principal, qui seul décide.
 */

export type CriterionState = 'met' | 'missing';

export interface Criterion {
  id: string;
  state: CriterionState;
  /** Le nom court du critère. */
  name: string;
  /** Ce que la garde lit, en mots : ce qui le remplit, ou ce qui manque. */
  words: string;
}

export interface CriteriaView {
  criteria: Criterion[];
  /** Le premier critère manquant, dans l'ordre de la liste ; `null` : la décision revient au dialogue du desk. */
  first: Criterion | null;
}

function view(criteria: Criterion[]): CriteriaView {
  return { criteria, first: criteria.find((c) => c.state === 'missing') ?? null };
}

const list = (names: readonly string[]) => names.join(', ');

/* ─── Copieur : Armer ─────────────────────────────────────────────────────────────────────────────────────────── */

export interface CopierCriteriaInput {
  /** Les comptes du Copieur, tels que le coffre les tient. */
  accounts: readonly PackAccount[];
  config: CopierConfig;
  sessions: Session[];
  trades: Trade[];
  planById: (id: string) => PropPlan | undefined;
  /** Le latent du pont par compte, au nom exact, comme le lit le Copieur du process principal. */
  unrealized: Readonly<Record<string, number>>;
  maxContractsPerOrder: number;
  now: number;
}

/** L'instrument de l'ouverture fictive qui éprouve le plancher : la garde ne lit pas l'instrument pour la marge. */
const PROBE_INSTRUMENT = 'NQ 12-26';

/**
 * Les suiveurs dont une ouverture copiée serait refusée au plancher (`floor`) : le routeur même, sur une ouverture fictive
 * d'un contrat du maître, sans fenêtre, sans blackout, sans budget de latence ni plafond qui l'arrêtent avant la marge.
 */
export function floorRefusals(input: CopierCriteriaInput): string[] {
  const sync = coerceCopierSync(packCopierSync({ accounts: [...input.accounts], config: input.config, sessions: input.sessions, trades: input.trades, planById: input.planById, catalysts: [], maxContractsPerOrder: input.maxContractsPerOrder }));
  if (!sync || !sync.topology.masterAccount) return [];
  const topology = {
    ...sync.topology,
    windowStart: '00:00',
    windowEnd: '23:59',
    newsBlackout: false,
    followers: sync.topology.followers.map((follower) => ({ ...follower, sizing: { mode: 'fixe' as const, value: 1, maxContracts: 1 }, symbolMap: { mode: 'identique' as const } })),
  };
  const fill = { account: topology.masterAccount, instrument: PROBE_INSTRUMENT, side: 'buy' as const, qty: 1, price: 1, time: input.now, executionId: 'miroir' };
  const { refused } = routeFill(fill, topology, { now: input.now, localMinutes: 12 * 60, catalysts: [], maxContractsPerOrder: sync.maxContractsPerOrder, states: sync.states, unrealized: { ...input.unrealized } });
  return refused.filter((r) => r.reason === 'floor').map((r) => r.account);
}

/**
 * Armer le Copieur : un compte maître actif ; des suiveurs `Sim*` seulement ; jamais le maître ni un doublon ; la marge
 * datée de K.04 de chaque suiveur au-dessus de son plancher. Le premier manquant se dit en mots.
 */
export function copierCriteria(input: CopierCriteriaInput): CriteriaView {
  const active = input.accounts.filter((a) => a.enabled);
  const masters = active.filter((a) => a.role === 'maitre' && a.ntAccount.trim());
  const masterName = masters.length === 1 ? masters[0]!.ntAccount.trim() : '';
  const followers = active.filter((a) => a.role === 'suiveur').map((a) => a.ntAccount.trim());
  const nonSim = followers.filter((name) => followerExclusion(name, masterName, new Set()) === 'non-sim');
  const ignored = ignoredFollowers(input.accounts);
  const kept = followers.filter((name) => !nonSim.includes(name) && !ignored.includes(name));
  const floor = floorRefusals(input);
  const pct = Math.round(input.config.followerBufferFloor * 100);
  return view([
    masters.length === 1
      ? { id: 'master', state: 'met', name: tr('maître', 'master', 'maestro'), words: masterName }
      : {
          id: 'master',
          state: 'missing',
          name: tr('maître', 'master', 'maestro'),
          words: masters.length === 0 ? tr('aucun compte maître actif', 'no active master account', 'ninguna cuenta maestra activa') : tr(`${masters.length} comptes maîtres actifs : un seul`, `${masters.length} active master accounts: one only`, `${masters.length} cuentas maestras activas: una sola`),
        },
    nonSim.length === 0 && kept.length > 0
      ? { id: 'sim', state: 'met', name: tr('suiveurs Sim*', 'Sim* followers', 'seguidores Sim*'), words: list(kept) }
      : {
          id: 'sim',
          state: 'missing',
          name: tr('suiveurs Sim*', 'Sim* followers', 'seguidores Sim*'),
          words: nonSim.length
            ? tr(`hors Sim, jamais copiés : ${list(nonSim)}`, `not Sim, never copied: ${list(nonSim)}`, `no Sim, nunca copiados: ${list(nonSim)}`)
            : tr('aucun suiveur Sim* actif', 'no active Sim* follower', 'ningún seguidor Sim* activo'),
        },
    ignored.length === 0
      ? { id: 'distinct', state: 'met', name: tr('ni le maître ni un doublon', 'neither the master nor a duplicate', 'ni el maestro ni un duplicado'), words: tr('chaque suiveur une fois', 'each follower once', 'cada seguidor una vez') }
      : { id: 'distinct', state: 'missing', name: tr('ni le maître ni un doublon', 'neither the master nor a duplicate', 'ni el maestro ni un duplicado'), words: tr(`écartés : ${list(ignored)}`, `left out: ${list(ignored)}`, `apartados: ${list(ignored)}`) },
    floor.length === 0
      ? { id: 'floor', state: 'met', name: tr('marge datée K.04', 'dated margin K.04', 'margen fechado K.04'), words: tr(`au-dessus du plancher de ${pct} %`, `above the ${pct}% floor`, `por encima del suelo del ${pct} %`) }
      : { id: 'floor', state: 'missing', name: tr('marge datée K.04', 'dated margin K.04', 'margen fechado K.04'), words: tr(`sous le plancher de ${pct} % : ${list(floor)}`, `below the ${pct}% floor: ${list(floor)}`, `bajo el suelo del ${pct} %: ${list(floor)}`) },
  ]);
}

/* ─── Ordres de l'agent : Activer ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Activer les ordres de l'agent : un compte `Sim*` où il proposerait, lu par la garde (`not_sim` du miroir) ; les limites
 * que la garde applique ; le kill switch, qui ferme le canal jusqu'au redémarrage (`orders_closed`). Le premier manquant se
 * dit en mots.
 */
export function agentCriteria(mirror: Pick<GuardMirror, 'gates' | 'proposal'>, policy: Pick<AgentOrderPolicy, 'maxQty' | 'maxPosition' | 'perMinute'>, killed: boolean): CriteriaView {
  const sim = mirror.gates.find((g) => g.key === 'not_sim');
  const account = mirror.proposal.account.trim();
  return view([
    account && sim?.state !== 'refuse'
      ? { id: 'sim', state: 'met', name: tr('comptes Sim*', 'Sim* accounts', 'cuentas Sim*'), words: account }
      : {
          id: 'sim',
          state: 'missing',
          name: tr('comptes Sim*', 'Sim* accounts', 'cuentas Sim*'),
          words: account ? tr(`${account} hors Sim : l’agent ne propose que sur les comptes Sim*`, `${account} is not Sim: the agent only proposes on Sim* accounts`, `${account} no es Sim: el agente solo propone en cuentas Sim*`) : tr('aucun compte Sim* connu du pont', 'no Sim* account known to the bridge', 'ninguna cuenta Sim* conocida por el puente'),
        },
    {
      id: 'limits',
      state: 'met',
      name: tr('limites', 'limits', 'límites'),
      words: tr(
        `${policy.maxQty} contrat(s) par ordre · position ${policy.maxPosition} · ${policy.perMinute} par minute`,
        `${policy.maxQty} contract(s) per order · position ${policy.maxPosition} · ${policy.perMinute} per minute`,
        `${policy.maxQty} contrato(s) por orden · posición ${policy.maxPosition} · ${policy.perMinute} por minuto`,
      ),
    },
    killed
      ? { id: 'kill', state: 'missing', name: tr('kill switch', 'kill switch', 'kill switch'), words: tr('engagé : canal fermé jusqu’au redémarrage', 'engaged: channel closed until restart', 'activado: canal cerrado hasta el reinicio') }
      : { id: 'kill', state: 'met', name: tr('kill switch', 'kill switch', 'kill switch'), words: tr('non engagé', 'not engaged', 'no activado') },
  ]);
}
