/**
 * Hôte de réplication. Tourne dans le process principal.
 * Désarmé à chaque démarrage. Les suiveurs ne sont soumis que si `armed` et lien `live`.
 * L'armement exige un état frais des comptes : le livre du maître se recale alors sur sa position réelle (SEC2.1).
 * L'idempotence vit dans `userData/copier-seen.txt`, jamais dans le coffre.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AccountView, ExecutionPort, Fill, LinkState } from '../execution/port';
import { applyMasterFill, FLAT, positionKey, rebaseExposure, type MasterExposure } from '../copier/position';
import type { CopierSync } from '../copier/sync';
import { coerceCopierSync, followerExclusion } from '../copier/sync';
import { routeFill, type Refusal } from '../copier/router';
import { uiText, type AppLocale } from '../locale';

export interface CopierHostStatus {
  armed: boolean;
  link: 'absent' | 'connecting' | 'live' | 'stale' | 'lost';
  routed: number;
  lastRefusal: Refusal | null;
  flattenOnCut: boolean;
}

/** Ce que Couper laisse derrière lui. Sans « Aplatir en coupant », les positions copiées restent ouvertes. */
export interface CopierCutReport {
  cancelled: string[];
  /** Positions commandées par le copieur encore ouvertes sur les suiveurs (signées). */
  open: { account: string; instrument: string; qty: number }[];
  /** Suiveurs dont l'aplatissement a été demandé (option « Aplatir en coupant »). */
  flattened: string[];
}

export interface CopierArmDialog {
  type: 'warning';
  buttons: [string, string];
  defaultId: number;
  cancelId: number;
  noLink: true;
  title: string;
  message: string;
}

/** Le dialogue qui dit pourquoi la réplication ne s'arme pas : un constat, un seul bouton. */
export interface CopierArmRefusalDialog {
  type: 'warning';
  buttons: [string];
  defaultId: 0;
  cancelId: 0;
  noLink: true;
  title: string;
  message: string;
  detail: string;
}

/**
 * Pourquoi la réplication ne s'arme pas. `master` : aucun compte maître ; `link` : pont hors ligne ; `stale` : aucun
 * état des comptes depuis `ARM_STATE_MAX_AGE_MS` ; `accounts` : le maître ou des suiveurs absents de cet état (`missing`).
 */
export interface CopierArmRefusal {
  reason: 'master' | 'link' | 'stale' | 'accounts';
  missing: string[];
}

/** Âge au-delà duquel un état des comptes ne permet plus d'armer. L'AddOn le renvoie toutes les 5 s et à chaque changement de position. */
export const ARM_STATE_MAX_AGE_MS = 10_000;

const SEEN_FILE = 'copier-seen.txt';

/** Contrôles, formats (dont les inversions bidirectionnelles), surrogats isolés, séparateurs de ligne : jamais dans un dialogue. */
const DIALOG_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;
const DIALOG_NAME_MAX = 40;
const DIALOG_NAMES_MAX = 4;

function dialogNames(names: readonly string[]): string {
  const shown = names.slice(0, DIALOG_NAMES_MAX).map((name) => {
    const clean = name.replace(DIALOG_FORBIDDEN, '');
    return clean.length > DIALOG_NAME_MAX ? `${clean.slice(0, DIALOG_NAME_MAX)}…` : clean;
  });
  return names.length > DIALOG_NAMES_MAX ? `${shown.join(', ')}, …` : shown.join(', ');
}

function localMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  const h = hour === 24 ? 0 : hour;
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

/** Même ton que le dialogue de compte réel : avertissement, Annuler par défaut. */
export function copierArmDialog(locale: AppLocale): CopierArmDialog {
  const allow = uiText(locale, 'Armer la réplication', 'Arm replication', 'Armar la réplica');
  const cancel = uiText(locale, 'Annuler', 'Cancel', 'Cancelar');
  const message = uiText(
    locale,
    'La réplication enverra des ordres sur les comptes suiveurs Sim.',
    'Replication will send orders on the Sim follower accounts.',
    'La réplica enviará órdenes en las cuentas seguidoras Sim.',
  );
  return { type: 'warning', title: 'CΛNTO', message, buttons: [allow, cancel], defaultId: 1, cancelId: 1, noLink: true };
}

/** Ce qui manque pour armer, en mots. Rien ne s'arme : le trader lit, corrige, puis arme à nouveau. */
export function copierArmRefusalDialog(locale: AppLocale, refusal: CopierArmRefusal): CopierArmRefusalDialog {
  const names = dialogNames(refusal.missing);
  const detail =
    refusal.reason === 'master'
      ? uiText(locale, 'Aucun compte maître actif. Choisissez le compte maître dans le Copieur.', 'No active master account. Choose the master account in the Copier.', 'Ninguna cuenta maestra activa. Elija la cuenta maestra en el Copiador.')
      : refusal.reason === 'link'
        ? uiText(
            locale,
            'Le pont NinjaTrader n’est pas en ligne : la position du compte maître n’est pas connue. Ouvrez NinjaTrader, attendez le lien, puis armez à nouveau.',
            'The NinjaTrader bridge is not live: the master account position is not known. Open NinjaTrader, wait for the link, then arm again.',
            'El puente NinjaTrader no está en línea: no se conoce la posición de la cuenta maestra. Abra NinjaTrader, espere el enlace y arme de nuevo.',
          )
        : refusal.reason === 'stale'
          ? uiText(
              locale,
              'Le pont n’a pas rendu l’état des comptes depuis dix secondes : la position du compte maître n’est pas connue. Attendez le prochain état, puis armez à nouveau.',
              'The bridge has not returned the account state for ten seconds: the master account position is not known. Wait for the next state, then arm again.',
              'El puente no ha devuelto el estado de las cuentas desde hace diez segundos: no se conoce la posición de la cuenta maestra. Espere el próximo estado y arme de nuevo.',
            )
          : uiText(
              locale,
              `NinjaTrader ne rend pas l’état de ces comptes : ${names}. Vérifiez leur nom et leur connexion, puis armez à nouveau.`,
              `NinjaTrader does not return the state of these accounts: ${names}. Check their name and connection, then arm again.`,
              `NinjaTrader no devuelve el estado de estas cuentas: ${names}. Compruebe su nombre y su conexión, y arme de nuevo.`,
            );
  return {
    type: 'warning',
    title: 'CΛNTO',
    message: uiText(locale, 'Réplication non armée', 'Replication not armed', 'Réplica no armada'),
    detail,
    buttons: [uiText(locale, 'Fermer', 'Close', 'Cerrar')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

/**
 * Armer, du clic à l'armement (SEC2.1). Sans état frais des comptes, un dialogue dit ce qui manque et rien ne s'arme ;
 * sinon le dialogue d'armement (Annuler par défaut), puis l'armement, qui relit l'état : il a pu se perdre entre-temps.
 */
export async function requestCopierArm(args: {
  win: { isDestroyed(): boolean } | null;
  locale: AppLocale;
  showMessageBox: (win: { isDestroyed(): boolean }, options: CopierArmDialog | CopierArmRefusalDialog) => Promise<{ response: number }>;
  log: (line: string) => void;
  refusal: () => CopierArmRefusal | null;
  arm: () => CopierArmRefusal | null;
}): Promise<boolean> {
  const win = args.win;
  if (!win || win.isDestroyed()) return false;
  const before = args.refusal();
  if (before) {
    await args.showMessageBox(win, copierArmRefusalDialog(args.locale, before));
    return false;
  }
  const choice = await args.showMessageBox(win, copierArmDialog(args.locale));
  if (choice.response !== 0) return false;
  const after = args.arm();
  if (after) {
    if (!win.isDestroyed()) await args.showMessageBox(win, copierArmRefusalDialog(args.locale, after));
    return false;
  }
  args.log('copieur armé');
  return true;
}

export class CopierHost {
  private armed = false;
  private routed = 0;
  private sync: CopierSync | null = null;
  private lastRefusal: Refusal | null = null;
  /** Fills du maître déjà portés au livre (persistés) : un fill rejoué ne compte pas deux fois. */
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, { account: string; orderId: string }>();
  /** Exposition du maître par instrument. */
  private readonly exposure = new Map<string, MasterExposure>();
  /** Positions commandées aux suiveurs par le copieur, `compte|instrument`. Mises à jour à l'envoi, défaites sur refus. */
  private readonly commanded = new Map<string, number>();
  /** Dernier état des comptes vu par le pont : positions réelles et P&L latent. */
  private accounts: AccountView[] | null = null;
  /** Quand cet état est arrivé (horloge de l'hôte) : l'armement en exige un frais. */
  private accountsAt: number | null = null;
  private readonly seenPath: string;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly port: ExecutionPort,
    private readonly userDataDir: string,
    private readonly log: (line: string) => void,
    private readonly onStatus: () => void = () => {},
    private readonly now: () => number = () => Date.now(),
  ) {
    this.seenPath = path.join(userDataDir, SEEN_FILE);
    this.unsubscribe = port.subscribe((event) => {
      if (event.kind === 'fill') void this.onFill(event.fill);
      else if (event.kind === 'accounts') {
        this.accounts = event.accounts;
        this.accountsAt = this.now();
      }
      else if (event.kind === 'status') this.onStatus();
    });
  }

  /** Relit les clés déjà routées. N'arme jamais. */
  open(): void {
    this.armed = false;
    try {
      const text = readFileSync(this.seenPath, 'utf8');
      // Une ligne par fill du maître : `<executionId>\t` (ancien format : `<executionId>\t<suiveur>`).
      for (const line of text.split('\n')) {
        const id = line.split('\t')[0]?.trim();
        if (id) this.seen.add(id);
      }
    } catch {
      /* premier démarrage : aucun fill déjà routé */
    }
  }

  configure(raw: unknown): boolean {
    const sync = coerceCopierSync(raw);
    if (!sync) return false;
    // Un autre maître : son exposition repart de sa position réelle à l'armement.
    if (this.sync && this.sync.topology.masterAccount !== sync.topology.masterAccount) this.exposure.clear();
    if (raw !== null && typeof raw === 'object' && Array.isArray((raw as { followers?: unknown }).followers)) {
      const taken = new Set<string>();
      for (const row of (raw as { followers: unknown[] }).followers) {
        if (row !== null && typeof row === 'object' && typeof (row as { account?: unknown }).account === 'string') {
          const account = (row as { account: string }).account.trim();
          if (!account) continue;
          const why = followerExclusion(account, sync.topology.masterAccount, taken);
          if (why) this.log(`copieur suiveur écarté compte=${account} motif=${why}`);
          else taken.add(account);
        }
      }
    }
    this.sync = sync;
    this.onStatus();
    return true;
  }

  /**
   * Ce qui empêche d'armer, ou `null` (SEC2.1). Il faut un maître, le pont en ligne, et un état des comptes de moins de
   * `ARM_STATE_MAX_AGE_MS` qui couvre le maître et chaque suiveur : le livre se recale sur la position réelle du maître,
   * le plancher d'un suiveur lit son latent, et sa réduction se borne à sa position réelle.
   */
  armRefusal(): CopierArmRefusal | null {
    const sync = this.sync;
    const master = sync?.topology.masterAccount;
    if (!sync || !master) return { reason: 'master', missing: [] };
    const link: LinkState = this.port.status().state;
    if (link !== 'live') return { reason: 'link', missing: [] };
    const age = this.accountsAt === null ? null : this.now() - this.accountsAt;
    if (!this.accounts || age === null || !(age >= 0 && age < ARM_STATE_MAX_AGE_MS)) return { reason: 'stale', missing: [] };
    const known = new Set(this.accounts.map((account) => account.name));
    const missing = [master, ...sync.topology.followers.map((follower) => follower.account)].filter((name) => !known.has(name));
    return missing.length > 0 ? { reason: 'accounts', missing } : null;
  }

  /**
   * Arme la réplication, ou rend ce qui l'empêche. L'exposition du maître est recalée sur sa position réelle d'après le
   * pont : une position déjà ouverte n'est pas copiée, seules les positions ouvertes ensuite le sont. Sans cette
   * position, le livre partirait de zéro et la sortie du maître deviendrait une ouverture chez le suiveur : refusé.
   */
  arm(): CopierArmRefusal | null {
    const refusal = this.armRefusal();
    const master = this.sync?.topology.masterAccount;
    const view = master ? this.accounts?.find((account) => account.name === master) : undefined;
    if (refusal || !view) {
      const why = refusal ?? { reason: 'accounts' as const, missing: master ? [master] : [] };
      this.log(`copieur armement refusé motif=${why.reason}${why.missing.length > 0 ? ` comptes=${dialogNames(why.missing)}` : ''}`);
      return why;
    }
    const instruments = new Set([...this.exposure.keys(), ...view.positions.map((p) => p.instrument)]);
    for (const instrument of instruments) {
      const actual = view.positions.find((p) => p.instrument === instrument)?.qty ?? 0;
      this.exposure.set(instrument, rebaseExposure(this.exposure.get(instrument) ?? FLAT, actual));
    }
    this.armed = true;
    this.onStatus();
    return null;
  }

  disarm(): void {
    this.armed = false;
    this.onStatus();
  }

  /**
   * D1 : désarme et annule les ordres suiveurs en attente. Aplatit seulement si l'option est armée.
   * Sinon, rend les positions copiées encore ouvertes : Couper ne les clôt pas, l'opérateur doit le savoir.
   */
  cut(): CopierCutReport {
    this.armed = false;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const item of pending) void this.port.cancel(item.account, item.orderId);
    let flattened: string[] = [];
    if (this.sync?.flattenOnCut) {
      flattened = [...new Set(this.sync.topology.followers.map((follower) => follower.account))];
      for (const account of flattened) void this.port.flatten(account);
      for (const key of [...this.commanded.keys()]) if (flattened.some((account) => key.startsWith(`${account}|`))) this.commanded.delete(key);
    }
    const open = this.openPositions();
    this.log(`copieur couper annulés=${pending.length} ouverts=${open.map((row) => `${row.account}:${row.instrument}:${row.qty}`).join(',') || '0'}`);
    this.onStatus();
    return { cancelled: pending.map((item) => item.orderId), open, flattened };
  }

  /** Positions commandées non nulles ; bornées par la position réelle quand le pont la connaît. */
  private openPositions(): CopierCutReport['open'] {
    const out: CopierCutReport['open'] = [];
    for (const [key, held] of this.commanded) {
      if (held === 0) continue;
      const [account = '', instrument = ''] = key.split('|');
      const view = this.accounts?.find((row) => row.name === account);
      const actual = view ? (view.positions.find((p) => p.instrument === instrument)?.qty ?? 0) : undefined;
      const qty = actual === undefined ? held : Math.sign(actual) === Math.sign(held) ? Math.sign(held) * Math.min(Math.abs(held), Math.abs(actual)) : 0;
      if (qty !== 0) out.push({ account, instrument, qty });
    }
    return out;
  }

  status(): CopierHostStatus {
    return {
      armed: this.armed,
      link: this.port.status().state,
      routed: this.routed,
      lastRefusal: this.lastRefusal,
      flattenOnCut: this.sync?.flattenOnCut ?? false,
    };
  }

  dispose(): void {
    this.unsubscribe();
    this.armed = false;
  }

  private async onFill(fill: Fill): Promise<void> {
    const sync = this.sync;
    if (!sync || fill.account !== sync.topology.masterAccount || !fill.executionId) return;
    // Un ordre du copieur ne se recopie jamais, même si le compte maître le recevait.
    if (fill.orderId && this.pending.has(fill.orderId)) {
      this.log(`copieur fill d'un ordre copié ignoré compte=${fill.account} id=${fill.executionId}`);
      return;
    }
    this.log(`copieur fill maître compte=${fill.account} instrument=${fill.instrument} qty=${fill.qty} id=${fill.executionId}`);
    // Le livre suit le maître armé ou non ; un fill déjà vu ne compte pas deux fois (rejeu, redémarrage).
    const before = this.exposure.get(fill.instrument) ?? FLAT;
    let after = before;
    if (!this.seen.has(fill.executionId)) {
      after = applyMasterFill(before, fill.side === 'buy' ? fill.qty : -fill.qty, this.armed);
      this.exposure.set(fill.instrument, after);
      this.seen.add(fill.executionId);
      this.remember(`${fill.executionId}\t`);
    }
    if (!this.armed) {
      this.log(`copieur désarmé id=${fill.executionId}`);
      return;
    }
    const link = this.port.status().state;
    if (link !== 'live') {
      this.log(`copieur lien=${link} id=${fill.executionId}`);
      return;
    }
    const routed = routeFill(
      {
        account: fill.account,
        instrument: fill.instrument,
        side: fill.side,
        qty: fill.qty,
        price: fill.price,
        time: fill.time,
        executionId: fill.executionId,
      },
      sync.topology,
      {
        now: this.now(),
        localMinutes: localMinutes(fill.time),
        catalysts: sync.catalysts,
        maxContractsPerOrder: sync.maxContractsPerOrder,
        states: sync.states,
        copied: after.copied,
        commanded: Object.fromEntries(this.commanded),
        actual: this.actualPositions(sync),
        unrealized: this.followerUnrealized(sync),
      },
    );
    for (const refusal of routed.refused) {
      this.lastRefusal = refusal;
      this.log(`copieur refus motif=${refusal.reason} compte=${refusal.account} instrument=${refusal.instrument} qty=${refusal.qty}`);
    }
    // Comptabilité à l'envoi, avant tout await : un fill suivant voit déjà ces ordres et n'envoie que l'écart restant.
    const sent = routed.orders.map((order) => {
      const key = positionKey(order.account, order.instrument);
      const signed = order.side === 'buy' ? order.qty : -order.qty;
      this.commanded.set(key, (this.commanded.get(key) ?? 0) + signed);
      return { order, key, signed };
    });
    for (const { order, key, signed } of sent) {
      let ack: Awaited<ReturnType<ExecutionPort['submit']>>;
      try {
        ack = await this.port.submit(order);
      } catch (err) {
        ack = { ok: false, code: -32000, message: err instanceof Error ? err.message : String(err) };
      }
      if (!ack.ok) {
        // Refusé : la position commandée revient en arrière, le prochain fill du maître renverra l'écart.
        this.commanded.set(key, (this.commanded.get(key) ?? 0) - signed);
        this.log(`copieur échec compte=${order.account} code=${ack.code}`);
        continue;
      }
      if (!this.armed) {
        void this.port.cancel(order.account, ack.orderId);
        continue;
      }
      this.pending.set(ack.orderId, { account: order.account, orderId: ack.orderId });
      this.routed += 1;
      this.log(`copieur ordre compte=${order.account} instrument=${order.instrument} ${order.side} qty=${order.qty} id=${ack.orderId}`);
    }
    this.onStatus();
  }

  /** Positions réelles des suiveurs, d'après le dernier état des comptes du pont (0 si le compte y est sans position). */
  private actualPositions(sync: CopierSync): Record<string, number> {
    const out: Record<string, number> = {};
    if (!this.accounts) return out;
    for (const follower of sync.topology.followers) {
      const view = this.accounts.find((account) => account.name === follower.account);
      if (!view) continue;
      for (const key of this.commanded.keys()) {
        if (!key.startsWith(`${follower.account}|`)) continue;
        const instrument = key.slice(follower.account.length + 1);
        out[key] = view.positions.find((p) => p.instrument === instrument)?.qty ?? 0;
      }
    }
    return out;
  }

  /** P&L latent des suiveurs, d'après le dernier état des comptes du pont : le plancher prop le retranche de la marge. */
  private followerUnrealized(sync: CopierSync): Record<string, number> {
    const out: Record<string, number> = {};
    if (!this.accounts) return out;
    for (const follower of sync.topology.followers) {
      const value = this.accounts.find((account) => account.name === follower.account)?.unrealizedPnl;
      if (typeof value === 'number' && Number.isFinite(value)) out[follower.account] = value;
    }
    return out;
  }

  private remember(key: string): void {
    mkdirSync(this.userDataDir, { recursive: true });
    appendFileSync(this.seenPath, `${key}\n`, 'utf8');
  }
}
