/**
 * Hôte de réplication. Tourne dans le process principal.
 * Désarmé à chaque démarrage. Les suiveurs ne sont soumis que si `armed` et lien `live`.
 * L'idempotence vit dans `userData/copier-seen.txt`, jamais dans le coffre.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ExecutionPort, Fill } from '../execution/port';
import type { CopierSync } from '../copier/sync';
import { coerceCopierSync } from '../copier/sync';
import { routeFill, type Refusal } from '../copier/router';
import { uiText, type AppLocale } from '../locale';

export interface CopierHostStatus {
  armed: boolean;
  link: 'absent' | 'connecting' | 'live' | 'stale' | 'lost';
  routed: number;
  lastRefusal: Refusal | null;
  flattenOnCut: boolean;
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

const SEEN_FILE = 'copier-seen.txt';

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

export async function confirmCopierArm(args: {
  win: { isDestroyed(): boolean } | null;
  locale: AppLocale;
  showMessageBox: (win: { isDestroyed(): boolean }, options: CopierArmDialog) => Promise<{ response: number }>;
  log: (line: string) => void;
}): Promise<boolean> {
  if (!args.win || args.win.isDestroyed()) return false;
  const choice = await args.showMessageBox(args.win, copierArmDialog(args.locale));
  if (choice.response !== 0) return false;
  args.log('copieur armé');
  return true;
}

export class CopierHost {
  private armed = false;
  private routed = 0;
  private sync: CopierSync | null = null;
  private lastRefusal: Refusal | null = null;
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, { account: string; orderId: string }>();
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
      else if (event.kind === 'status') this.onStatus();
    });
  }

  /** Relit les clés déjà routées. N'arme jamais. */
  open(): void {
    this.armed = false;
    try {
      const text = readFileSync(this.seenPath, 'utf8');
      for (const line of text.split('\n')) {
        const key = line.trim();
        if (key) this.seen.add(key);
      }
    } catch {
      /* premier démarrage : aucun fill déjà routé */
    }
  }

  configure(raw: unknown): boolean {
    const sync = coerceCopierSync(raw);
    if (!sync) return false;
    if (raw !== null && typeof raw === 'object' && Array.isArray((raw as { followers?: unknown }).followers)) {
      for (const row of (raw as { followers: unknown[] }).followers) {
        if (row !== null && typeof row === 'object' && typeof (row as { account?: unknown }).account === 'string') {
          const account = (row as { account: string }).account.trim();
          if (account && !account.startsWith('Sim')) this.log(`copieur suiveur écarté compte=${account}`);
        }
      }
    }
    this.sync = sync;
    this.onStatus();
    return true;
  }

  arm(): void {
    this.armed = true;
    this.onStatus();
  }

  disarm(): void {
    this.armed = false;
    this.onStatus();
  }

  /** D1 : désarme et annule les ordres suiveurs en attente. Aplatit seulement si l'option est armée. */
  cut(): { cancelled: string[] } {
    this.armed = false;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const item of pending) void this.port.cancel(item.account, item.orderId);
    if (this.sync?.flattenOnCut) {
      const accounts = new Set(this.sync.topology.followers.map((follower) => follower.account));
      for (const account of accounts) void this.port.flatten(account);
    }
    this.log(`copieur couper annulés=${pending.length}`);
    this.onStatus();
    return { cancelled: pending.map((item) => item.orderId) };
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
    this.log(`copieur fill maître compte=${fill.account} instrument=${fill.instrument} qty=${fill.qty} id=${fill.executionId}`);
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
      },
    );
    for (const refusal of routed.refused) {
      this.lastRefusal = refusal;
      this.log(`copieur refus motif=${refusal.reason} compte=${refusal.account} instrument=${refusal.instrument} qty=${refusal.qty}`);
    }
    for (const order of routed.orders) {
      const key = `${fill.executionId}\t${order.account}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.remember(key);
      const ack = await this.port.submit(order);
      if (!this.armed) {
        if (ack.ok) void this.port.cancel(order.account, ack.orderId);
        continue;
      }
      if (!ack.ok) {
        this.log(`copieur échec compte=${order.account} code=${ack.code}`);
        continue;
      }
      this.pending.set(ack.orderId, { account: order.account, orderId: ack.orderId });
      this.routed += 1;
      this.log(`copieur ordre compte=${order.account} instrument=${order.instrument} qty=${order.qty} id=${ack.orderId}`);
    }
    this.onStatus();
  }

  private remember(key: string): void {
    mkdirSync(this.userDataDir, { recursive: true });
    appendFileSync(this.seenPath, `${key}\n`, 'utf8');
  }
}
