import { tr } from '@/i18n';
import type { CopierCutReport } from '@/lib/desk';

/** Message après Couper : ce qui est annulé, et surtout ce qui reste ouvert sur les suiveurs. */
export function cutSummary(report: CopierCutReport): { text: string; tone: 'ok' | 'warn' } {
  const cancelled = report.cancelled.length;
  const head = tr(`Copie coupée · ${cancelled} ordre(s) annulé(s).`, `Copy cut · ${cancelled} order(s) cancelled.`, `Copia cortada · ${cancelled} orden(es) anulada(s).`);
  if (report.flattened.length) {
    const names = report.flattened.join(', ');
    return { text: `${head} ${tr(`Aplatissement demandé : ${names}.`, `Flatten requested: ${names}.`, `Aplanamiento solicitado: ${names}.`)}`, tone: 'ok' };
  }
  if (!report.open.length) return { text: head, tone: 'ok' };
  const rows = report.open.map((row) => `${row.account} ${row.instrument} ${row.qty > 0 ? '+' : ''}${row.qty}`).join(' · ');
  return {
    text: `${head} ${tr(
      `Positions copiées encore ouvertes : ${rows}. Couper ne les clôt pas : activez « Aplatir les suiveurs en coupant » ou clôturez-les dans NinjaTrader.`,
      `Copied positions still open: ${rows}. Cut does not close them: turn on “Flatten followers when cutting” or close them in NinjaTrader.`,
      `Posiciones copiadas aún abiertas: ${rows}. Cortar no las cierra: active « Aplanar seguidores al cortar » o ciérrelas en NinjaTrader.`,
    )}`,
    tone: 'warn',
  };
}
