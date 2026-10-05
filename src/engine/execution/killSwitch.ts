import { tr } from '@/i18n';

/** Réponse de l'AddOn à un `order.flatten` envoyé par le kill switch. */
export interface KillSwitchOutcome {
  account: string;
  ok: boolean;
  closed?: number;
  error?: string;
}

export interface KillSwitchReport {
  /** Comptes autorisés connus au moment de la coupure. */
  accounts: string[];
  /** Faux si le pont était hors ligne : aucun aplatissement n'a pu partir. */
  sent: boolean;
  results: KillSwitchOutcome[];
}

/**
 * Message de l'opérateur après le kill switch. Il ne dit « aplati » que pour les comptes dont
 * l'AddOn a confirmé l'aplatissement ; tout le reste renvoie vers NinjaTrader.
 */
export function killSwitchSummary(report: KillSwitchReport): { tone: 'warn' | 'error'; text: string } {
  const closedChannel = tr('Canal d’ordres fermé.', 'Order channel closed.', 'Canal de órdenes cerrado.');
  if (!report.sent && report.accounts.length) {
    return {
      tone: 'error',
      text: tr(
        `Kill switch · pont hors ligne : aucun aplatissement n’a pu partir. ${closedChannel} Aplatissez dans NinjaTrader.`,
        `Kill switch · bridge offline: no flatten could be sent. ${closedChannel} Flatten in NinjaTrader.`,
        `Kill switch · puente fuera de línea: no se pudo enviar ningún cierre. ${closedChannel} Cierre en NinjaTrader.`,
      ),
    };
  }
  if (!report.accounts.length) {
    return {
      tone: 'warn',
      text: tr(
        `Kill switch · aucun compte autorisé connu du pont. ${closedChannel} Vérifiez dans NinjaTrader.`,
        `Kill switch · no authorized account known to the bridge. ${closedChannel} Check in NinjaTrader.`,
        `Kill switch · ninguna cuenta autorizada conocida por el puente. ${closedChannel} Verifique en NinjaTrader.`,
      ),
    };
  }
  const done = report.results.filter((r) => r.ok).map((r) => r.account);
  const failed = report.accounts.filter((a) => !done.includes(a));
  if (!failed.length) {
    return {
      tone: 'warn',
      text: tr(
        `Kill switch · ${done.length} compte(s) aplati(s) : ${done.join(', ')}. ${closedChannel}`,
        `Kill switch · ${done.length} account(s) flattened: ${done.join(', ')}. ${closedChannel}`,
        `Kill switch · ${done.length} cuenta(s) cerrada(s): ${done.join(', ')}. ${closedChannel}`,
      ),
    };
  }
  const reasons = failed.map((a) => {
    const why = report.results.find((r) => r.account === a)?.error ?? tr('sans réponse', 'no answer', 'sin respuesta');
    return `${a} (${why})`;
  });
  return {
    tone: 'error',
    text: tr(
      `Kill switch · ${done.length}/${report.accounts.length} compte(s) aplati(s). Non confirmé : ${reasons.join(', ')}. ${closedChannel} Vérifiez dans NinjaTrader.`,
      `Kill switch · ${done.length}/${report.accounts.length} account(s) flattened. Not confirmed: ${reasons.join(', ')}. ${closedChannel} Check in NinjaTrader.`,
      `Kill switch · ${done.length}/${report.accounts.length} cuenta(s) cerrada(s). Sin confirmar: ${reasons.join(', ')}. ${closedChannel} Verifique en NinjaTrader.`,
    ),
  };
}
