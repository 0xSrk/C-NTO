import { useMemo } from 'react';
import { Glyph } from '@/design/Micro';
import { TYPE_GLYPH } from '@/design/micro/meaning';
import { cx } from '@/design/primitives';
import { journalAccounts, journalInstruments, METRIC_RANGES, type MetricRange, type Selection } from '@/engine/selection';
import type { Session, Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { fmtInt } from '@/lib/format';
import { useUi } from '@/store/ui';
import s from './fiche.module.css';

/**
 * La sélection partagée en puces (OROS5.32, Système 5 « Fiche et Frise » ; correction du juge Palantir). Le compte, la
 * période et l'instrument vivent dans le store (`useUi`) : les puces de Métrique et celles d'« Autour de… » sont les
 * mêmes, et une puce changée ici change partout. Elles ne font que lire le journal ; ce qui sort de la sélection reste en
 * place, atténué à 35 %, et chaque panneau dit n / N.
 */

/** La sélection partagée, lue dans le store : le même objet tant qu'aucune puce ne change. */
export function useSelection(): Selection {
  const account = useUi((u) => u.metricAccount);
  const range = useUi((u) => u.metricRange);
  const instrument = useUi((u) => u.metricInstrument);
  return useMemo(() => ({ account, range, instrument }), [account, range, instrument]);
}

/** Le nom court d'une période, celui des puces de Métrique : 7J, 30J, 90J, TOUT. */
export function rangeLabel(range: MetricRange): string {
  if (range === '7j') return tr('7J', '7D', '7D');
  if (range === '90j') return tr('90J', '90D', '90D');
  if (range === 'tout') return tr('TOUT', 'ALL', 'TODO');
  return tr('30J', '30D', '30D');
}

/** Le nom d'une unité comptée : « séance », « séances »… l'accord suit N. */
export function countUnit(kind: 'session' | 'trade', total: number): string {
  const one = total === 1;
  if (kind === 'trade') return one ? tr('trade', 'trade', 'trade') : tr('trades', 'trades', 'trades');
  return one ? tr('séance', 'session', 'sesión') : tr('séances', 'sessions', 'sesiones');
}

/** n / N : ce que la sélection garde, sur ce que le panneau montre. Le style suit le panneau qui le porte. */
export function SetCount({ n, total, kind, className }: { n: number; total: number; kind: 'session' | 'trade'; className?: string }) {
  useI18n((st) => st.locale);
  return (
    <span
      className={cx(s.setCount, className)}
      data-count={`${n}/${total}`}
      title={tr(`${fmtInt(n)} dans la sélection, sur ${fmtInt(total)}`, `${fmtInt(n)} in the selection, out of ${fmtInt(total)}`, `${fmtInt(n)} en la selección, de ${fmtInt(total)}`)}
    >
      {fmtInt(n)} / {fmtInt(total)} {countUnit(kind, total)}
    </span>
  );
}

/** La puce Compte (C.065) : les comptes du journal ; un compte posé ailleurs et absent du journal reste choisi. */
export function AccountChip({ sessions }: { sessions: readonly Session[] }) {
  useI18n((st) => st.locale);
  const account = useUi((u) => u.metricAccount);
  const setAccount = useUi((u) => u.setMetricAccount);
  const accounts = useMemo(() => journalAccounts(sessions), [sessions]);
  const rows = account && !accounts.includes(account) ? [...accounts, account] : accounts;
  return (
    <label className={cx(s.chip, account && s.chipOn)} data-chip="account">
      <Glyph name={TYPE_GLYPH.compte} className={s.chipGlyph} />
      <select className={s.chipSelect} aria-label={tr('Compte', 'Account', 'Cuenta')} value={account ?? ''} onChange={(event) => setAccount(event.target.value || null)}>
        <option value="">{tr(`Tous les comptes · ${accounts.length}`, `All accounts · ${accounts.length}`, `Todas las cuentas · ${accounts.length}`)}</option>
        {rows.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** La puce Période : 7J, 30J, 90J ou TOUT. */
export function RangeChip() {
  useI18n((st) => st.locale);
  const range = useUi((u) => u.metricRange);
  const setRange = useUi((u) => u.setMetricRange);
  return (
    <label className={cx(s.chip, range !== 'tout' && s.chipOn)} data-chip="range">
      <select className={s.chipSelect} aria-label={tr('Période', 'Range', 'Período')} value={range} onChange={(event) => setRange(event.target.value as MetricRange)}>
        {METRIC_RANGES.map((value) => (
          <option key={value} value={value}>
            {rangeLabel(value)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** La puce Instrument (C.100) : les instruments du journal ; un instrument posé ailleurs et absent du journal reste choisi. */
export function InstrumentChip({ sessions, trades, className }: { sessions: readonly Session[]; trades: readonly Trade[]; className?: string }) {
  useI18n((st) => st.locale);
  const instrument = useUi((u) => u.metricInstrument);
  const setInstrument = useUi((u) => u.setMetricInstrument);
  const instruments = useMemo(() => journalInstruments(sessions, trades), [sessions, trades]);
  const rows = instrument && !instruments.includes(instrument) ? [...instruments, instrument] : instruments;
  return (
    <label className={cx(s.chip, instrument && s.chipOn, className)} data-chip="instrument">
      <Glyph name={TYPE_GLYPH.instrument} className={s.chipGlyph} />
      <select className={s.chipSelect} aria-label={tr('Instrument', 'Instrument', 'Instrumento')} value={instrument ?? ''} onChange={(event) => setInstrument(event.target.value || null)}>
        <option value="">{tr(`Tous les instruments · ${instruments.length}`, `All instruments · ${instruments.length}`, `Todos los instrumentos · ${instruments.length}`)}</option>
        {rows.map((symbol) => (
          <option key={symbol} value={symbol}>
            {symbol}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Les puces de la sélection : le compte, la période et l'instrument, chacune une liste qu'on change sur place. */
export function SelectionChips({ sessions, trades, className }: { sessions: readonly Session[]; trades: readonly Trade[]; className?: string }) {
  useI18n((st) => st.locale);
  return (
    <div className={cx(s.chips, className)} role="group" aria-label={tr('Sélection', 'Selection', 'Selección')} data-chips="">
      <AccountChip sessions={sessions} />
      <RangeChip />
      <InstrumentChip sessions={sessions} trades={trades} />
    </div>
  );
}
