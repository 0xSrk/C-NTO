import { useMemo } from 'react';
import { cx, Montant } from '@/design/primitives';
import { getInstrument, hasInstrument } from '@/engine/instruments';
import { computeTradeStats } from '@/engine/metrics';
import { sampleOf, type EntityRef } from '@/engine/ontology';
import { tr, useI18n } from '@/i18n';
import { fmtInt, fmtPct, fmtPrice, fmtUsd, plural } from '@/lib/format';
import { copyAction, FicheHead, FicheSection, ficheTitle, LinksByPredicate, linkProvenance, Properties, Provenance } from './Fiche';
import { shortDay, type IndexSources } from './index';
import { IdentityGrid } from './Instruments';
import { sampleWord } from './sample';
import s from './fiche.module.css';
import { AroundOf } from './AroundOf';

/**
 * La fiche Instrument (OROS5.28, correction du juge Palantir) : le symbole du registre du desk, ses séances, ses trades et
 * leur réussite, lus par le moteur (`computeTradeStats`) sur les seuls trades de l'instrument ; rien n'est recalculé ici.
 */

const signedClass = (v: number) => (v > 0 ? s.pos : v < 0 ? s.neg : undefined);

export function InstrumentFiche({ target, ctx, now }: { target: EntityRef; ctx: IndexSources; now: number }) {
  useI18n((st) => st.locale);
  const symbol = target.id.trim().toUpperCase();
  const spec = hasInstrument(symbol) ? getInstrument(symbol) : null;
  const sessions = useMemo(() => ctx.sessions.filter((x) => x.instruments.some((i) => i.trim().toUpperCase() === symbol)).sort((a, b) => a.date.localeCompare(b.date)), [ctx.sessions, symbol]);
  const trades = useMemo(() => ctx.trades.filter((t) => t.instrument.trim().toUpperCase() === symbol), [ctx.trades, symbol]);
  const stats = useMemo(() => computeTradeStats([...trades]), [trades]);
  const sample = sampleOf(stats.count);
  return (
    <>
      <FicheHead type="instrument" title={ficheTitle(target, ctx, now)} actions={[copyAction(target)]} />
      <div className={s.body} data-fiche="instrument">
        <IdentityGrid
          label={tr('Identité de l’instrument', 'Instrument identity', 'Identidad del instrumento')}
          lead={<span className={s.identText}>{spec?.name ?? tr('hors registre', 'outside the registry', 'fuera del registro')}</span>}
          when={sessions.length ? `${shortDay(sessions[0]!.date)} → ${shortDay(sessions[sessions.length - 1]!.date)}` : '—'}
          numeral={stats.count > 0 ? fmtPct(stats.winRate, 0) : '—'}
          chars={stats.count > 0 ? 4 : 1}
          sub={tr('réussite', 'win rate', 'acierto')}
          aside={
            <>
              {stats.count > 0 ? <Montant value={stats.netPnl} className={cx(s.identPnl, signedClass(stats.netPnl))} /> : <span className={s.identStrong}>—</span>}
              <span className={s.identUnit}>{tr('net', 'net', 'neto')} · USD</span>
            </>
          }
          foot={[`${plural(sessions.length, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))} · ${plural(stats.count, 'trade', 'trades')}`, `${tr('échantillon', 'sample', 'muestra')} ${sampleWord(sample)}`]}
        />
        <FicheSection part="properties" title={tr('Propriétés', 'Properties', 'Propiedades')}>
          <Properties
            rows={[
              [tr('Nom', 'Name', 'Nombre'), spec?.name ?? '—'],
              [tr('Place', 'Exchange', 'Mercado'), spec?.exchange ?? '—'],
              [tr('Valeur du point', 'Point value', 'Valor del punto'), spec ? fmtUsd(spec.pointValue, { cents: spec.pointValue % 1 !== 0 }) : '—'],
              [tr('Tick', 'Tick', 'Tick'), spec ? fmtPrice(spec.tickSize) : '—'],
              [tr('Séances', 'Sessions', 'Sesiones'), fmtInt(sessions.length)],
              [tr('Trades · gagnants', 'Trades · winners', 'Trades · ganadores'), stats.count > 0 ? `${fmtInt(stats.count)} · ${fmtInt(stats.wins)}` : '—'],
              [tr('Réussite', 'Win rate', 'Acierto'), stats.count > 0 ? fmtPct(stats.winRate, 1) : '—'],
            ]}
          />
        </FicheSection>
        <FicheSection part="links" title={tr('Liens', 'Links', 'Enlaces')}>
          <LinksByPredicate target={target} ctx={ctx} now={now} />
        </FicheSection>

        <FicheSection part="around" title={tr('Autour de…', 'Around…', 'Alrededor de…')}>
          <AroundOf target={target} ctx={ctx} now={now} />
        </FicheSection>
        <FicheSection part="provenance" title={tr('Provenance', 'Provenance', 'Procedencia')}>
          <Provenance
            lines={[
              spec ? tr('Instrument du registre du desk', 'Instrument from the desk registry', 'Instrumento del registro del desk') : tr('Symbole hors du registre du desk', 'Symbol outside the desk registry', 'Símbolo fuera del registro del desk'),
              tr('Réussite : les trades de l’instrument, lus par le moteur', 'Win rate: the instrument’s trades, read by the engine', 'Acierto: los trades del instrumento, leídos por el motor'),
              ...linkProvenance(target, ctx.links),
            ]}
          />
        </FicheSection>
      </div>
    </>
  );
}
