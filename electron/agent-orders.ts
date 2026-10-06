import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  AGENT_ORDER_TAG,
  AGENT_RATE_WINDOW_MS,
  coerceAgentPolicy,
  guardProposal,
  parseProposal,
  raisedLimits,
  type AgentOrderPolicy,
  type AgentOrderProposal,
  type AgentOrderRefusal,
} from './agent/orders';
import { uiText, type AppLocale } from './locale';

/**
 * Ordres proposés par un agent (A5), côté process principal. L'agent propose ; ici on garde, on demande
 * à l'opérateur dans un dialogue du process principal (le renderer ne peut pas le contourner), puis on
 * soumet par le pont, qui applique ses propres gardes, puis celles de l'AddOn. Désactivé à chaque ouverture.
 */

const POLICY_FILE = 'agent-orders.json';
/** Le trader a 45 s pour répondre ; au-delà, la proposition est refusée. Sous le délai des clients MCP (60 s). */
export const AGENT_CONFIRM_TIMEOUT_MS = 45_000;

export type AgentOrderOrigin = 'llm' | 'mcp' | 'orch';

export type AgentOrderOutcome =
  | { status: 'sent'; orderId: string; latencyMs?: number; account: string; instrument: string; side: 'buy' | 'sell'; qty: number; resulting: number }
  | { status: 'refused'; reason: AgentOrderRefusal | 'invalid'; detail: string }
  | { status: 'declined'; detail: string }
  | { status: 'failed'; code?: number; detail: string };

export interface AgentOrderStatus extends AgentOrderPolicy {
  pending: boolean;
}

export interface AgentDialogOptions {
  type: 'warning' | 'question';
  buttons: [string, string];
  defaultId: number;
  cancelId: number;
  noLink: true;
  title: string;
  message: string;
  detail?: string;
  signal?: AbortSignal;
}

export interface BridgeView {
  link: string;
  ordersOpen: boolean;
  accounts: { name: string; positions: { instrument: string; quantity: number }[] }[];
}

export interface AgentOrderDeps {
  userDataDir: string;
  locale: () => AppLocale;
  window: () => { isDestroyed(): boolean } | null;
  showMessageBox: (win: { isDestroyed(): boolean }, options: AgentDialogOptions) => Promise<{ response: number }>;
  bridge: () => BridgeView | null;
  submit: (order: {
    op: 'submit';
    account: string;
    instrument: string;
    action: 'Buy' | 'Sell';
    quantity: number;
    type: 'Market' | 'Limit' | 'StopMarket';
    limitPrice?: number;
    stopPrice?: number;
    tag: string;
  }) => Promise<{ ok: boolean; code?: number; message?: string; orderId?: string; latencyMs?: number }>;
  log: (line: string) => void;
  now?: () => number;
  confirmTimeoutMs?: number;
}

const ORIGIN: Record<AgentOrderOrigin, [string, string, string]> = {
  llm: ['l’agent intégré', 'the built-in agent', 'el agente integrado'],
  mcp: ['un agent externe (MCP)', 'an external agent (MCP)', 'un agente externo (MCP)'],
  orch: ['l’orchestrateur externe', 'the external orchestrator', 'el orquestador externo'],
};

/** Texte du dialogue : sens, quantité, instrument, type, prix, compte, position avant / après, raison de l'agent. */
export function proposalDialog(p: AgentOrderProposal, position: number, resulting: number, origin: AgentOrderOrigin, locale: AppLocale): AgentDialogOptions {
  const t = (fr: string, en: string, es: string) => uiText(locale, fr, en, es);
  const side = p.side === 'buy' ? t('ACHAT', 'BUY', 'COMPRA') : t('VENTE', 'SELL', 'VENTA');
  const kind =
    p.type === 'market'
      ? t('au marché', 'at market', 'a mercado')
      : p.type === 'limit'
        ? t(`limite ${p.limit}`, `limit ${p.limit}`, `límite ${p.limit}`)
        : t(`stop ${p.stop}`, `stop ${p.stop}`, `stop ${p.stop}`);
  const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
  const [ofr, oen, oes] = ORIGIN[origin];
  return {
    type: 'warning',
    title: 'CΛNTO',
    message: t(`Ordre proposé par ${ofr}`, `Order proposed by ${oen}`, `Orden propuesta por ${oes}`),
    detail: [
      `${side} ${p.qty} × ${p.instrument} ${kind}`,
      `${t('Compte', 'Account', 'Cuenta')} : ${p.account}`,
      `${t('Position', 'Position', 'Posición')} : ${fmt(position)} → ${fmt(resulting)}`,
      '',
      `${t('Raison donnée par l’agent', 'Reason given by the agent', 'Razón dada por el agente')} :`,
      p.reason,
      '',
      t('Sans réponse en 45 s, l’ordre n’est pas envoyé.', 'Without an answer within 45 s, the order is not sent.', 'Sin respuesta en 45 s, la orden no se envía.'),
    ].join('\n'),
    buttons: [t('Envoyer l’ordre', 'Send the order', 'Enviar la orden'), t('Refuser', 'Decline', 'Rechazar')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

const fold = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Compte et instrument tels que le pont les nomme, avec la position signée : la lecture ne tient compte
 * ni de la casse ni des espaces (`mnq 12-26` voit `MNQ 12-26`), sinon les gardes de position et de marge
 * liraient 0. Inconnus du pont : les noms de la proposition, position 0.
 */
export function heldPosition(view: BridgeView | null, account: string, instrument: string): { account: string; instrument: string; quantity: number } {
  const accounts = view?.accounts ?? [];
  const acc = accounts.find((a) => a.name === account) ?? accounts.find((a) => fold(a.name) === fold(account));
  if (!acc) return { account, instrument, quantity: 0 };
  const pos = acc.positions.find((x) => x.instrument === instrument) ?? acc.positions.find((x) => fold(x.instrument) === fold(instrument));
  return pos ? { account: acc.name, instrument: pos.instrument, quantity: pos.quantity } : { account: acc.name, instrument, quantity: 0 };
}

export class AgentOrderHost {
  private policy: AgentOrderPolicy;
  private pending = false;
  private recent: number[] = [];
  private readonly file: string;
  private readonly now: () => number;

  constructor(private readonly deps: AgentOrderDeps) {
    this.file = path.join(deps.userDataDir, POLICY_FILE);
    this.now = deps.now ?? Date.now;
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      /* premier lancement : limites par défaut */
    }
    // Les limites survivent au redémarrage ; l'activation, jamais.
    this.policy = coerceAgentPolicy(raw, false);
  }

  status(): AgentOrderStatus {
    return { ...this.policy, pending: this.pending };
  }

  private t(fr: string, en: string, es: string): string {
    return uiText(this.deps.locale(), fr, en, es);
  }

  private persist(): void {
    try {
      mkdirSync(this.deps.userDataDir, { recursive: true });
      const { maxQty, maxPosition, perMinute } = this.policy;
      writeFileSync(this.file, JSON.stringify({ maxQty, maxPosition, perMinute }), { encoding: 'utf8', mode: 0o600 });
    } catch {
      /* limites gardées en mémoire */
    }
  }

  private async ask(options: AgentDialogOptions): Promise<boolean> {
    const win = this.deps.window();
    if (!win || win.isDestroyed()) return false;
    const choice = await this.deps.showMessageBox(win, options);
    return choice.response === 0;
  }

  /** Activation : dialogue du process principal, Annuler par défaut. Vaut jusqu'à la fermeture du desk. */
  async enable(): Promise<AgentOrderStatus> {
    if (this.policy.enabled) return this.status();
    const ok = await this.ask({
      type: 'warning',
      title: 'CΛNTO',
      message: this.t('Autoriser l’agent à proposer des ordres ?', 'Allow the agent to propose orders?', '¿Autorizar al agente a proponer órdenes?'),
      detail: this.t(
        `Comptes Sim seulement. Chaque ordre est montré ici et n’est envoyé qu’après votre confirmation. Au plus ${this.policy.maxQty} contrat(s) par ordre, position ${this.policy.maxPosition} au plus, ${this.policy.perMinute} proposition(s) par minute. Désactivé à la fermeture du desk.`,
        `Sim accounts only. Each order is shown here and is sent only after you confirm. At most ${this.policy.maxQty} contract(s) per order, position ${this.policy.maxPosition} at most, ${this.policy.perMinute} proposal(s) per minute. Turned off when the desk closes.`,
        `Solo cuentas Sim. Cada orden se muestra aquí y solo se envía tras su confirmación. Como máximo ${this.policy.maxQty} contrato(s) por orden, posición ${this.policy.maxPosition} como máximo, ${this.policy.perMinute} propuesta(s) por minuto. Desactivado al cerrar el desk.`,
      ),
      buttons: [this.t('Autoriser', 'Allow', 'Autorizar'), this.t('Annuler', 'Cancel', 'Cancelar')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (ok) {
      this.policy = { ...this.policy, enabled: true };
      this.deps.log('agent ordres autorisés (Sim, confirmation à chaque ordre)');
    }
    return this.status();
  }

  disable(): AgentOrderStatus {
    if (this.policy.enabled) this.deps.log('agent ordres désactivés');
    this.policy = { ...this.policy, enabled: false };
    return this.status();
  }

  /** Baisser une limite est immédiat ; la relever passe par un dialogue du process principal. */
  async setLimits(raw: unknown): Promise<AgentOrderStatus> {
    const next = coerceAgentPolicy({ ...this.policy, ...(raw && typeof raw === 'object' ? raw : {}) }, this.policy.enabled);
    const raised = raisedLimits(this.policy, next);
    if (raised.length) {
      const label = (k: string) => (k === 'maxQty' ? this.t('contrats par ordre', 'contracts per order', 'contratos por orden') : k === 'maxPosition' ? this.t('position maximale', 'maximum position', 'posición máxima') : this.t('propositions par minute', 'proposals per minute', 'propuestas por minuto'));
      const lines = raised.map((k) => `${label(k)} : ${this.policy[k]} → ${next[k]}`).join('\n');
      const ok = await this.ask({
        type: 'warning',
        title: 'CΛNTO',
        message: this.t('Relever les limites de l’agent ?', 'Raise the agent limits?', '¿Subir los límites del agente?'),
        detail: lines,
        buttons: [this.t('Relever', 'Raise', 'Subir'), this.t('Annuler', 'Cancel', 'Cancelar')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (!ok) return this.status();
    }
    const changed = (['maxQty', 'maxPosition', 'perMinute'] as const).filter((k) => next[k] !== this.policy[k]);
    if (changed.length) {
      this.deps.log(`agent limites ${changed.map((k) => `${k} ${this.policy[k]}→${next[k]}`).join(' ')}`);
      this.policy = next;
      this.persist();
    }
    return this.status();
  }

  /**
   * Une proposition de l'agent : gardes, dialogue (45 s, Refuser par défaut), puis soumission par le pont
   * avec le tag `canto-agent`. `propShare` : marge du plan suivi si le compte est le sien, calculée par le renderer.
   */
  async propose(raw: unknown, origin: AgentOrderOrigin, propShare: number | null): Promise<AgentOrderOutcome> {
    const parsed = parseProposal(raw);
    if (!parsed.ok) return { status: 'refused', reason: 'invalid', detail: parsed.detail };
    const now = this.now();
    this.recent = this.recent.filter((t) => now - t < AGENT_RATE_WINDOW_MS);
    const view = this.deps.bridge();
    // Le dialogue, les gardes et l'ordre portent les noms du pont : ceux dont la position vient d'être lue.
    const held = heldPosition(view, parsed.proposal.account, parsed.proposal.instrument);
    const p: AgentOrderProposal = { ...parsed.proposal, account: held.account, instrument: held.instrument };
    const position = held.quantity;
    const verdict = guardProposal(p, this.policy, {
      now,
      link: view?.link ?? 'absent',
      ordersOpen: view?.ordersOpen ?? false,
      position,
      recent: this.recent,
      busy: this.pending,
      propShare: typeof propShare === 'number' && Number.isFinite(propShare) ? propShare : null,
    });
    // La cadence compte les propositions examinées, refusées comprises ; pas celles d'un agent désactivé ou en attente.
    if (verdict.ok || (verdict.reason !== 'busy' && verdict.reason !== 'disabled')) this.recent.push(now);
    const summary = `${p.side} ${p.qty} ${p.instrument} ${p.type} compte=${p.account} origine=${origin}`;
    if (!verdict.ok) {
      this.deps.log(`agent proposition refusée ${summary} motif=${verdict.reason}`);
      return { status: 'refused', reason: verdict.reason, detail: verdict.detail };
    }
    this.pending = true;
    try {
      const timeout = AbortSignal.timeout(this.deps.confirmTimeoutMs ?? AGENT_CONFIRM_TIMEOUT_MS);
      const accepted = await this.ask({ ...proposalDialog(p, position, verdict.resulting, origin, this.deps.locale()), signal: timeout });
      if (!accepted || !this.policy.enabled) {
        const detail = timeout.aborted
          ? this.t('sans réponse du trader en 45 s : non envoyé', 'no answer from the trader within 45 s: not sent', 'sin respuesta del trader en 45 s: no enviada')
          : this.t('refusé par le trader', 'declined by the trader', 'rechazada por el trader');
        this.deps.log(`agent proposition non envoyée ${summary} (${timeout.aborted ? 'délai' : 'refus'})`);
        return { status: 'declined', detail };
      }
      const ack = await this.deps.submit({
        op: 'submit',
        account: p.account,
        instrument: p.instrument,
        action: p.side === 'buy' ? 'Buy' : 'Sell',
        quantity: p.qty,
        type: p.type === 'market' ? 'Market' : p.type === 'limit' ? 'Limit' : 'StopMarket',
        ...(p.limit !== undefined ? { limitPrice: p.limit } : {}),
        ...(p.stop !== undefined ? { stopPrice: p.stop } : {}),
        tag: AGENT_ORDER_TAG,
      });
      if (!ack.ok || !ack.orderId) {
        this.deps.log(`agent ordre refusé par le pont ${summary} code=${ack.code ?? '?'}`);
        return { status: 'failed', code: ack.code, detail: ack.message ?? this.t('refusé par le pont', 'refused by the bridge', 'rechazada por el puente') };
      }
      this.deps.log(`agent ordre envoyé ${summary} id=${ack.orderId}`);
      return { status: 'sent', orderId: ack.orderId, latencyMs: ack.latencyMs, account: p.account, instrument: p.instrument, side: p.side, qty: p.qty, resulting: verdict.resulting };
    } finally {
      this.pending = false;
    }
  }
}

