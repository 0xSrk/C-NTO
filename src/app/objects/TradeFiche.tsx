import { useMemo } from 'react';
import { Montant } from '@/design/primitives';
import { releaseLabel, tradeReleaseDistance, type EntityRef } from '@/engine/ontology';
import { tradeRisk, type RiskSource } from '@/engine/riskConsole';
import type { Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { fmtInt, fmtPrice, fmtUsd } from '@/lib/format';
import { formatDuration } from '@/lib/time';
import { useSettings } from '@/store/settings';
import { ActivitySection, copyAction, FicheHead, FicheSection, ficheTitle, linkProvenance, LinksByPredicate, ObjectLink, openDayAction, Properties, Provenance, sourceWord, type PropertyRow } from './Fiche';
import { etClock, objectLabel, shortDay, type IndexSources } from './index';
import { fmtR, IdentityGrid, RScaleBar } from './Instruments';
import s from './fiche.module.css';
import { AroundOf } from './AroundOf';

/**
 * La fiche Trade (OROS5.28, correction du juge Palantir) : un trade est un objet, plus une ligne. M.057 met son P&L net au
 * numéral, sa séance en lien ; puis son échelle en R (M.022, le stop en simple trait), son entrée et sa sortie à l'heure
 * de New York, son R, son MAE et son MFE — « — » quand ils sont inconnus, jamais zéro —, sa distance à la publication lue
 * au moteur, ses liens et sa provenance. Elle ne fait que lire.
 */

const signedClass = (v: number) => (v > 0 ? s.pos : v < 0 ? s.neg : undefined);
const montantChars = (v: number) => fmtUsd(v, { cents: true, sign: true }).length;

/** Une excursion (MAE, MFE) : un montant positif du journal ; absente ou illisible, « — ». */
export function excursion(v: number | undefined): string {
  return v !== undefined && Number.isFinite(v) ? fmtUsd(Math.abs(v), { cents: true }) : '—';
}

function riskWord(source: RiskSource): string {
  if (source === 'stop') return tr('stop initial', 'initial stop', 'stop inicial');
  if (source === 'saisi') return tr('risque saisi', 'entered risk', 'riesgo introducido');
  if (source === 'fixe') return tr('montant fixe par contrat', 'fixed amount per contract', 'importe fijo por contrato');
  return tr('inconnu', 'unknown', 'desconocido');
}

export function TradeFiche({ target, ctx, now }: { target: EntityRef; ctx: IndexSources; now: number }) {
  useI18n((st) => st.locale);
  const riskPerContract = useSettings((st) => st.settings.riskPerContract);
  const trade: Trade | undefined = ctx.trades.find((t) => t.id === target.id);
  const risk = useMemo(() => (trade ? tradeRisk(trade, riskPerContract) : null), [trade, riskPerContract]);
  const release = useMemo(() => (trade ? releaseLabel(tradeReleaseDistance(trade, ctx.links, ctx.catalysts)) : '—'), [trade, ctx.links, ctx.catalysts]);
  if (!trade || !risk) return null;
  const session = ctx.sessions.find((x) => x.id === trade.sessionId);
  const exitKnown = Number.isFinite(trade.exitTime);
  const account = trade.account?.trim() ?? '';
  const sessionLabel = session ? (objectLabel({ type: 'session', id: session.id }, ctx, now) ?? session.date) : null;
  const properties: PropertyRow[] = [
    [tr('Entrée', 'Entry', 'Entrada'), `${etClock(trade.entryTime)} ET · ${fmtPrice(trade.entryPrice)}`],
    [tr('Sortie', 'Exit', 'Salida'), exitKnown ? `${etClock(trade.exitTime)} ET · ${fmtPrice(trade.exitPrice)}` : '—'],
    [tr('Durée', 'Duration', 'Duración'), exitKnown ? formatDuration(trade.exitTime - trade.entryTime) : '—'],
    [tr('R réalisé', 'Realized R', 'R realizado'), risk.realizedR !== null ? `${fmtR(risk.realizedR, 2)} R` : '—'],
    [tr('Risque', 'Risk', 'Riesgo'), risk.risk !== null ? `${fmtUsd(risk.risk, { cents: true })} · ${riskWord(risk.source)}` : '—'],
    ['MAE', excursion(trade.mae)],
    ['MFE', excursion(trade.mfe)],
    [tr('Publication', 'Release', 'Publicación'), release],
    [tr('Compte', 'Account', 'Cuenta'), account ? <ObjectLink key="account" to={{ type: 'compte', id: account }} label={account} /> : '—'],
    [tr('Stratégie', 'Strategy', 'Estrategia'), trade.strategy?.trim() || '—'],
    [tr('Étiquettes', 'Tags', 'Etiquetas'), trade.tags?.length ? trade.tags.join(' · ') : '—'],
    [tr('Commission', 'Commission', 'Comisión'), fmtUsd(-Math.abs(trade.commission), { cents: true }).replace(/^-/, '−')],
  ];
  return (
    <>
      <FicheHead type="trade" title={ficheTitle(target, ctx, now)} actions={[...(session ? [openDayAction(session.date)] : []), copyAction(target)]} />
      <div className={s.body} data-fiche="trade">
        <IdentityGrid
          label={tr('Identité du trade', 'Trade identity', 'Identidad del trade')}
          lead={session && sessionLabel ? <ObjectLink to={{ type: 'session', id: session.id }} label={sessionLabel} className={s.identLink} /> : <span className={s.identText}>{tr('sans séance', 'no session', 'sin sesión')}</span>}
          when={`${session ? shortDay(session.date) : ''} ${etClock(trade.entryTime)} ET`.trim()}
          numeral={<Montant value={trade.pnl} className={signedClass(trade.pnl)} />}
          chars={montantChars(trade.pnl)}
          sub={`${tr('net', 'net', 'neto')} · USD`}
          aside={
            <>
              <span className={s.identStrong}>
                {trade.direction === 'long' ? 'Long' : 'Short'} {fmtInt(trade.qty)} {trade.instrument}
              </span>
              <span className={s.identUnit}>{risk.realizedR !== null ? `${fmtR(risk.realizedR)} R` : 'R —'}</span>
            </>
          }
          foot={[`MAE ${excursion(trade.mae)}`, `MFE ${excursion(trade.mfe)}`]}
        />
        <FicheSection part="rscale" title={tr('Échelle en R', 'R scale', 'Escala en R')} meta={release !== '—' ? <span className={s.release}>{release}</span> : undefined}>
          <div className={s.rLine}>
            <RScaleBar risk={risk.risk} realizedR={risk.realizedR} plannedRr={risk.plannedRr} domain={null} />
          </div>
        </FicheSection>
        <FicheSection part="properties" title={tr('Propriétés', 'Properties', 'Propiedades')}>
          <Properties rows={properties} />
        </FicheSection>
        <FicheSection part="links" title={tr('Liens', 'Links', 'Enlaces')}>
          <LinksByPredicate target={target} ctx={ctx} now={now} />
        </FicheSection>

        <FicheSection part="around" title={tr('Autour de…', 'Around…', 'Alrededor de…')}>
          <AroundOf target={target} ctx={ctx} now={now} />
        </FicheSection>
        <ActivitySection target={target} ctx={ctx} />
        <FicheSection part="provenance" title={tr('Provenance', 'Provenance', 'Procedencia')}>
          <Provenance
            lines={[
              trade.executionIds?.length
                ? tr(`Trade · ${fmtInt(trade.executionIds.length)} exécutions du pont`, `Trade · ${fmtInt(trade.executionIds.length)} bridge executions`, `Trade · ${fmtInt(trade.executionIds.length)} ejecuciones del puente`)
                : `${tr('Trade', 'Trade', 'Trade')} · ${sourceWord(session?.source ?? '')}`,
              tr('R : le risque du trade (stop, saisi ou fixe), le calcul de la console de risque', 'R: the trade’s risk (stop, entered or fixed), the risk console’s computation', 'R: el riesgo del trade (stop, introducido o fijo), el cálculo de la consola de riesgo'),
              ...linkProvenance(target, ctx.links),
            ]}
          />
        </FicheSection>
      </div>
    </>
  );
}
