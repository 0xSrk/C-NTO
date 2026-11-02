import { Fragment } from 'react';
import { Glyph, Signal } from '@/design/Micro';
import type { KillSwitchReport } from '@/engine/execution/killSwitch';
import { tr, useI18n } from '@/i18n';
import { fmtInt } from '@/lib/format';
import { dateTimeFormatter, ET_ZONE } from '@/lib/time';
import { useBridge, type LastKill } from '@/store/bridge';
import s from './shell.module.css';

/** « CommandOrControl+Shift+K » (raccourci du process principal) tel que le clavier le porte. */
export function shortcutLabel(accelerator: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return accelerator.replace(/CommandOrControl|CmdOrCtrl/g, mac ? '⌘' : 'Ctrl');
}

/**
 * Les raisons que le process principal donne d'un aplatissement non confirmé (`electron/nt-bridge/server.ts`, et
 * l'AddOn pour le compte non connecté), dites dans les trois langues. Une autre raison se lit telle que l'AddOn l'a dite.
 */
const REASONS: Readonly<Record<string, readonly [fr: string, en: string, es: string]>> = {
  'délai dépassé': ['sans réponse', 'no answer', 'sin respuesta'],
  'pont indisponible': ['pont hors ligne', 'bridge offline', 'puente fuera de línea'],
  'pont perdu, ordre non réémis': ['pont perdu', 'bridge lost', 'puente perdido'],
  'connexion remplacée': ['connexion remplacée', 'connection replaced', 'conexión reemplazada'],
  'pont arrêté': ['pont arrêté', 'bridge stopped', 'puente detenido'],
  'compte non connecté': ['compte non connecté', 'account not connected', 'cuenta no conectada'],
};

/** Pourquoi un compte n'est pas dit aplati : sans réponse de l'AddOn, ou la raison qu'il a donnée. */
export function killReason(error: string | undefined): string {
  const known = error === undefined ? REASONS['délai dépassé'] : REASONS[error];
  return known ? tr(known[0], known[1], known[2]) : (error ?? '');
}

export interface KillReading {
  /** Les comptes qui demandent un geste, dans l'ordre du rapport, groupés par raison. */
  gesture: { reason: string; accounts: string[] }[];
  /** Comptes dont l'AddOn a confirmé l'aplatissement. */
  flattened: number;
  total: number;
}

/** Le rapport de coupure lu dans l'ordre de l'action : ce qui reste à faire d'abord, puis ce qui a été fait. */
export function readKill(report: KillSwitchReport): KillReading {
  const ok = new Set(report.results.filter((r) => r.ok).map((r) => r.account));
  const groups = new Map<string, string[]>();
  for (const account of report.accounts) {
    if (ok.has(account)) continue;
    const reason = killReason(report.results.find((r) => r.account === account)?.error);
    groups.set(reason, [...(groups.get(reason) ?? []), account]);
  }
  return {
    gesture: [...groups].map(([reason, accounts]) => ({ reason, accounts })),
    flattened: report.accounts.filter((account) => ok.has(account)).length,
    total: report.accounts.length,
  };
}

/** L'heure de la coupure à New York, à la seconde (« 14:32:07 »). */
function etSeconds(ms: number): string {
  return dateTimeFormatter({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: ET_ZONE }, 'en-GB').format(ms);
}

/** Le rapport de coupure (décision 8 de l'ADMIN) : le geste qui reste à faire en tête, à l'ivoire ; puis les ordres d'aplatir et n / N. */
function KillReport({ report }: { report: LastKill }) {
  const reading = readKill(report);
  const time = etSeconds(report.at);
  const flatten = tr('aplatir dans NinjaTrader', 'flatten in NinjaTrader', 'cerrar en NinjaTrader');
  const none = tr('Aucun compte autorisé connu du pont · vérifier dans NinjaTrader', 'No authorized account known to the bridge · check in NinjaTrader', 'Ninguna cuenta autorizada conocida por el puente · verificar en NinjaTrader');
  // La ligne entière, pour l'infobulle quand la bande l'abrège : chaque compte reste nommé.
  const whole = reading.total === 0 ? none : [...reading.gesture.map((group) => `${group.accounts.join(', ')} ${group.reason}`), flatten].join(' · ');
  const gesture =
    reading.total === 0 ? (
      <>{none}</>
    ) : reading.gesture.length ? (
      <>
        {reading.gesture.map((group, index) => (
          <Fragment key={group.reason}>
            {index > 0 ? ' · ' : null}
            <b>{group.accounts.join(', ')}</b> {group.reason}
          </Fragment>
        ))}
        {` · ${flatten}`}
      </>
    ) : null;
  const sent = report.sent && reading.total > 0;
  return (
    <div className={s.bandReport}>
      {gesture ? (
        <p className={s.bandGesture} data-kill="gesture" title={whole}>
          <Glyph name="refused" className={s.bandRefused} label={tr('non aplati', 'not flattened', 'no cerrada')} />
          <span>{gesture}</span>
        </p>
      ) : null}
      <p className={s.bandCut} data-kill="cut">
        {sent
          ? tr(`Ordres d’aplatir partis à ${time} ET`, `Flatten orders sent at ${time} ET`, `Órdenes de cierre enviadas a las ${time} ET`)
          : tr(`Aucun ordre d’aplatir parti · coupure à ${time} ET`, `No flatten order sent · cut at ${time} ET`, `Ninguna orden de cierre enviada · corte a las ${time} ET`)}
        {reading.total > 0 ? (
          <>
            {' · '}
            <b>
              {fmtInt(reading.flattened)} / {fmtInt(reading.total)}
            </b>{' '}
            {tr('aplatis', 'flattened', 'cerradas')}
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Bande de niveau 3 sous la barre de titre : le kill switch est engagé, la soumission reste fermée jusqu'au redémarrage
 * du desk. Système 5 (décision 8 de l'ADMIN, 2026-11-01) : la dernière étiquette sort ; le cercle barré C.123, par la
 * primitive Signal, et le filet --signal portent le seul rouge ; le texte reste ivoire. Le rapport de coupure suit, dans
 * l'ordre de l'action : le compte qui demande un geste, puis les ordres d'aplatir et n / N. Sans rapport connu, la bande
 * dit la coupure et rien d'autre. Jamais animée.
 */
export function KillBand({ shortcut = 'CommandOrControl+Shift+K' }: { shortcut?: string }) {
  useI18n((st) => st.locale);
  const report = useBridge((b) => b.lastKill);
  return (
    <div className={s.band} role="alert">
      <Signal level={3} className={s.bandSignal} />
      <div className={s.bandText}>
        <b>{tr('Kill switch engagé', 'Kill switch engaged', 'Kill switch activado')}</b>
        <span>
          {tr('Soumission fermée jusqu’au redémarrage du desk', 'Submission closed until the desk restarts', 'Envío cerrado hasta reiniciar el desk')} · {shortcutLabel(shortcut)}
        </span>
      </div>
      {report ? <KillReport report={report} /> : null}
    </div>
  );
}
