/**
 * La colonne de l'onglet 09 · CRY (`docs/ONGLET-CRYPTO.md` § 7), dans cet ordre : Marchés, Indicateurs, Température,
 * Alertes, Source, Agent. Les classes de section sont celles de Visual (`sideSection`, `sideTitle`, `desc`, `tradeRow`) ;
 * `crypto.module.css` ne porte que les lignes de marché et d'alerte.
 * Chaque écriture passe par `useCryptoAction` : un refus du store devient un toast en clair, une base qui refuse
 * l'écriture aussi, et rien ne s'échappe en rejet non géré.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Glyph, Signal } from '@/design/Micro';
import { Button, Etiquette, Led, Regle, Tag, cx } from '@/design/primitives';
import { alertDirection, alertEvaluability, type AlertIdleReason, type AlertReading, type EvaluabilityData } from '@/engine/crypto/alerts';
import { CHARTABLE_MARKETS, cryptoMarket, type CryptoMarketId, type CryptoTimeframe, type CryptoVenue, type VenueState } from '@/engine/crypto/markets';
import type { IndicatorDefinition, IndicatorInstance } from '@/engine/indicators';
import { tr, useI18n } from '@/i18n';
import { fmtSigned, fmtUsdCompact } from '@/lib/cryptoAlertText';
import { fmtInt, fmtNum, fmtPrice, signClass } from '@/lib/format';
import { dateKeyLocal, formatDateFr, formatDuration, formatTimeLocal } from '@/lib/time';
import { useCrypto, type WriteResult } from '@/store/crypto';
import { useUi } from '@/store/ui';
import { IndicatorCards } from '../visual/IndicatorCards';
import v from '../visual/visual.module.css';
import { AlertModal, cryptoCodeText, saveFailedText } from './AlertModal';
import c from './crypto.module.css';
import { alertSignalLevel, alertStateWord, alertSubject, alertThreshold, directionGlyph, directionText } from './cryptoSignals';
import { cryptoIndicatorDesc, cryptoIndicatorName } from './indicatorCopy';

/** Les venues, dans l'ordre du registre, et leur nom. */
const VENUES: readonly CryptoVenue[] = ['coinbase', 'binance', 'bybit'];
export const VENUE_NAME: Record<CryptoVenue, string> = { coinbase: 'Coinbase', binance: 'Binance', bybit: 'Bybit' };

/** L'horloge de l'écran, pour les âges : un rendu par seconde. */
function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** Le libellé d'une unité de temps du chart ; « 1j » se dit « 1d » en anglais et en espagnol. */
export function timeframeLabel(tf: CryptoTimeframe): string {
  switch (tf) {
    case 1:
      return tr('1m', '1m', '1m');
    case 5:
      return tr('5m', '5m', '5m');
    case 15:
      return tr('15m', '15m', '15m');
    case 60:
      return tr('1h', '1h', '1h');
    case 240:
      return tr('4h', '4h', '4h');
    case 1440:
      return tr('1j', '1d', '1d');
  }
}

export function venueStateText(state: VenueState): string {
  switch (state) {
    case 'off':
      return tr('éteinte', 'off', 'apagada');
    case 'connecting':
      return tr('connexion', 'connecting', 'conectando');
    case 'live':
      return tr('direct', 'live', 'directo');
    case 'reconnecting':
      return tr('reconnexion', 'reconnecting', 'reconectando');
    case 'stale':
      return tr('périmée', 'stale', 'caducada');
    case 'blocked':
      return tr('bloquée', 'blocked', 'bloqueada');
  }
}

/**
 * Lance une écriture du store sans jamais laisser s'échapper sa promesse : un refus (`{ ok: false, reason }`) devient un toast
 * en clair, un rejet (la base a refusé la ligne) aussi.
 */
export function useCryptoAction(): (action: Promise<WriteResult | void>) => void {
  const toast = useUi((u) => u.toast);
  return useCallback(
    (action: Promise<WriteResult | void>) => {
      action.then(
        (result) => {
          if (result && !result.ok) toast(cryptoCodeText(result.reason), 'warn');
        },
        () => toast(saveFailedText(), 'warn'),
      );
    },
    [toast],
  );
}

/** « mis à jour il y a 3s » : l'âge du dernier message du ticker, jamais celui d'un trade (Binance et Bybit datent le message). */
function updatedAgo(ms: number): string {
  const age = formatDuration(Math.max(1000, ms));
  return tr(`mis à jour il y a ${age}`, `updated ${age} ago`, `actualizado hace ${age}`);
}

/** Une variation sur 24 h, en pourcent et signée. */
function changeText(pct: number | null | undefined): string {
  return pct === null || pct === undefined || !Number.isFinite(pct) ? '—' : `${fmtSigned(pct, 2)} %`;
}

/** Un relevé de la température qui manque, en clair. */
function missingReadingText(source: AlertReading): string {
  switch (source) {
    case 'funding':
      return tr('aucun relevé du funding', 'no funding reading', 'ninguna lectura del funding');
    case 'breadth':
      return tr('aucun relevé de la largeur', 'no breadth reading', 'ninguna lectura de la amplitud');
    case 'liquidations':
      return tr('aucun relevé des liquidations', 'no liquidations reading', 'ninguna lectura de las liquidaciones');
  }
}

/** Un relevé de la température de plus de deux cadences, en clair. */
function staleReadingText(source: AlertReading): string {
  switch (source) {
    case 'funding':
      return tr('relevé du funding périmé', 'stale funding reading', 'lectura del funding caducada');
    case 'breadth':
      return tr('relevé de la largeur périmé', 'stale breadth reading', 'lectura de la amplitud caducada');
    case 'liquidations':
      return tr('relevé des liquidations périmé', 'stale liquidations reading', 'lectura de las liquidaciones caducada');
  }
}

/**
 * Pourquoi une alerte armée n'est pas évaluée en ce moment, en clair. Le code vient de `alertEvaluability` (moteur), la règle que
 * partagent la colonne, l'évaluateur du desk et `crypto_alert_list` ; calculé pour l'écran, jamais enregistré.
 */
function idleText(reason: AlertIdleReason): string {
  switch (reason.code) {
    case 'venue':
      return `${VENUE_NAME[reason.venue]} : ${venueStateText(reason.state)}`;
    case 'no_price':
      return tr('aucun prix reçu', 'no price received', 'ningún precio recibido');
    case 'no_temperature':
      return tr('aucune lecture de la température', 'no temperature reading', 'ninguna lectura de la temperatura');
    case 'no_reading':
      return missingReadingText(reason.source);
    case 'stale_reading':
      return staleReadingText(reason.source);
  }
}

/** L'heure du franchissement d'une alerte déclenchée, lue sous son seuil. */
function triggeredAtText(at: number): string {
  const time = formatTimeLocal(at);
  return tr(`déclenchée à ${time}`, `triggered at ${time}`, `disparada a las ${time}`);
}

function SideTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={v.sideTitle}>
      <span>{children}</span>
      {action}
    </div>
  );
}

export interface CryptoSideProps {
  /** Le catalogue proposé pour ce marché et cette unité de temps. */
  catalog: IndicatorDefinition[];
  /** Les indicateurs du chart que ce catalogue couvre : ceux qui ont une carte, et que le titre compte. */
  instances: IndicatorInstance[];
}

export function CryptoSide({ catalog, instances }: CryptoSideProps) {
  useI18n((st) => st.locale);
  const now = useNow();
  const run = useCryptoAction();
  const toast = useUi((u) => u.toast);
  const market = useCrypto((s) => s.market);
  const timeframe = useCrypto((s) => s.timeframe);
  const watchlist = useCrypto((s) => s.watchlist);
  const tickers = useCrypto((s) => s.tickers);
  const tickerErrors = useCrypto((s) => s.tickerErrors);
  const venues = useCrypto((s) => s.venues);
  const temperature = useCrypto((s) => s.temperature);
  const alerts = useCrypto((s) => s.alerts);
  const bars = useCrypto((s) => s.bars);
  const agentLog = useCrypto((s) => s.agentLog);
  const setMarket = useCrypto((s) => s.setMarket);
  const addIndicator = useCrypto((s) => s.addIndicator);
  const toggleIndicator = useCrypto((s) => s.toggleIndicator);
  const updateIndicator = useCrypto((s) => s.updateIndicator);
  const removeIndicator = useCrypto((s) => s.removeIndicator);
  const createAlert = useCrypto((s) => s.createAlert);
  const deleteAlert = useCrypto((s) => s.deleteAlert);
  const disable = useCrypto((s) => s.disable);
  const [alertOpen, setAlertOpen] = useState(false);
  const [turningOff, setTurningOff] = useState(false);

  const live: EvaluabilityData = { venues, tickers, temperature, now };
  const spec = cryptoMarket(market);
  const firstBar = bars[0];
  const lastBar = bars[bars.length - 1];
  const day = (time: number) => formatDateFr(dateKeyLocal(new Date(time * 1000)), { short: true });
  const chartTicker = tickers[market];

  const turnOff = () => {
    if (turningOff) return;
    setTurningOff(true);
    disable()
      .catch(() => toast(tr('Le process principal n’a pas répondu : le module reste allumé.', 'The main process did not answer: the module stays on.', 'El proceso principal no respondió: el módulo sigue encendido.'), 'warn'))
      .finally(() => setTurningOff(false));
  };

  /** Le sous-titre d'une ligne de marché : l'âge de sa mise à jour, ou pourquoi elle n'a pas de prix. */
  const marketNote = (id: CryptoMarketId): string => {
    const ticker = tickers[id];
    if (ticker) return updatedAgo(now - ticker.time);
    const error = tickerErrors[id];
    if (error) return cryptoCodeText(error);
    return watchlist.includes(id) ? tr('aucun prix reçu', 'no price received', 'ningún precio recibido') : tr('hors watchlist', 'not in watchlist', 'fuera de la watchlist');
  };

  const funding = temperature?.funding ?? null;
  const breadth = temperature?.breadth ?? null;
  const liquidations = temperature?.liquidations ?? null;
  const openInterest = temperature?.openInterest ?? null;
  const at = (ms: number | undefined) => (ms === undefined ? '—' : formatTimeLocal(ms));
  /** La variation de l'open interest d'un actif sur 24 h (une part : 0,024 = +2,4 %), ou un tiret. */
  const oiChange = (share: number | null | undefined) => (share === null || share === undefined || !Number.isFinite(share) ? '—' : `${fmtSigned(share * 100, 1)} %`);

  return (
    <aside className={v.side}>
      <div className={v.sideSection}>
        <SideTitle>
          <Glyph name="globe" className={c.titleGlyph} />
          {tr('Marchés', 'Markets', 'Mercados')} · {CHARTABLE_MARKETS.length}
        </SideTitle>
        {CHARTABLE_MARKETS.map((id) => {
          const row = cryptoMarket(id);
          if (!row) return null;
          const ticker = tickers[id];
          const on = venues[row.venue] === 'live' && ticker !== undefined;
          return (
            <button key={id} type="button" className={cx(c.marketRow, id === market && c.active)} aria-pressed={id === market} onClick={() => run(setMarket(id))}>
              <span className={c.marketHead}>
                <Led on={on}>{row.symbol}</Led>
                <Etiquette>{VENUE_NAME[row.venue]}</Etiquette>
              </span>
              <span>{fmtPrice(ticker?.last, row.precision)}</span>
              <span className={c.marketAge}>{marketNote(id)}</span>
              <span className={signClass(ticker?.change24hPct)}>{changeText(ticker?.change24hPct)}</span>
            </button>
          );
        })}
      </div>

      <IndicatorCards
        instances={instances}
        catalog={catalog}
        nameOf={cryptoIndicatorName}
        descOf={cryptoIndicatorDesc}
        onAdd={(id) => run(addIndicator(id))}
        onToggle={(id) => run(toggleIndicator(id))}
        onUpdate={(id, patch) => run(updateIndicator(id, patch))}
        onRemove={(id) => run(removeIndicator(id))}
      />

      <div className={v.sideSection}>
        <SideTitle>{tr('Température', 'Temperature', 'Temperatura')} · Binance</SideTitle>
        {/* Une règle par lecture, par côté des liquidations et par actif de l'open interest : une ligne chacune, 24 signes au plus (libellé et valeur) pour la colonne. */}
        <div>
          <Regle label={tr('Funding médian', 'Median funding', 'Funding mediano')} value={funding ? `${fmtSigned(funding.median * 100, 4)} %` : '—'} />
          <Regle label={tr('Largeur 24 h', '24 h breadth', 'Amplitud 24 h')} value={breadth ? `${fmtNum(breadth.upShare * 100, 0)} %` : '—'} />
          <Regle label={tr('Liq. 1 h · long', 'Liq. 1 h · long', 'Liq. 1 h · long')} value={liquidations ? fmtUsdCompact(liquidations.long) : '—'} />
          <Regle label={tr('Liq. 1 h · short', 'Liq. 1 h · short', 'Liq. 1 h · short')} value={liquidations ? fmtUsdCompact(liquidations.short) : '—'} />
          <Regle label={tr('OI 24 h · BTC', 'OI 24 h · BTC', 'OI 24 h · BTC')} value={oiChange(openInterest?.btc)} />
          <Regle label={tr('OI 24 h · ETH', 'OI 24 h · ETH', 'OI 24 h · ETH')} value={oiChange(openInterest?.eth)} />
        </div>
        <div className={v.desc}>
          {tr(
            `Funding ${at(funding?.at)} · largeur ${at(breadth?.at)} · liquidations depuis ${at(liquidations?.since)} · open interest ${at(openInterest?.at)}.`,
            `Funding ${at(funding?.at)} · breadth ${at(breadth?.at)} · liquidations since ${at(liquidations?.since)} · open interest ${at(openInterest?.at)}.`,
            `Funding ${at(funding?.at)} · amplitud ${at(breadth?.at)} · liquidaciones desde ${at(liquidations?.since)} · open interest ${at(openInterest?.at)}.`,
          )}{' '}
          {tr(
            'Liquidations : minorant. Binance ne pousse qu’une liquidation par symbole et par seconde, et la fenêtre repart de zéro à chaque lancement du desk.',
            'Liquidations: a lower bound. Binance pushes only one liquidation per symbol per second, and the window restarts from zero at each desk launch.',
            'Liquidaciones: un mínimo. Binance solo envía una liquidación por símbolo y por segundo, y la ventana vuelve a cero en cada arranque del desk.',
          )}
        </div>
      </div>

      <div className={v.sideSection}>
        <SideTitle
          action={
            <Button size="sm" variant="ghost" onClick={() => setAlertOpen(true)}>
              <Glyph name="addSession" className={c.addGlyph} /> {tr('Ajouter', 'Add', 'Añadir')}
            </Button>
          }
        >
          {tr('Alertes', 'Alerts', 'Alertas')} · {alerts.length}
        </SideTitle>
        {/* Système 4.1 : la section s'ouvre sur la légende des trois niveaux, sans plaque. L'état de chaque alerte est sur sa ligne, le direct du prix sur la ligne de son marché. */}
        <div className={c.alertLegend}>
          <Signal level={1}>{tr('Repère', 'Marker', 'Hito')}</Signal>
          <Signal level={2}>{tr('Attention', 'Attention', 'Atención')}</Signal>
          <Signal level={3}>{tr('Borne franchie', 'Limit crossed', 'Límite superado')}</Signal>
        </div>
        {alerts.length === 0 && (
          <div className={v.desc}>
            {tr(
              'Aucune alerte. Une alerte se déclenche au franchissement de son niveau, desk ouvert : toast et événement pour l’agent.',
              'No alerts. An alert fires when its level is crossed, desk open: a toast and an event for the agent.',
              'Ninguna alerta. Una alerta salta al cruzar su nivel, con el desk abierto: toast y evento para el agente.',
            )}
          </div>
        )}
        {alerts.map((alert) => {
          const verdict = alert.state === 'armed' ? alertEvaluability(alert, live) : null;
          const idle = verdict && !verdict.ok ? idleText(verdict.reason) : null;
          // Un signal par alerte (OROS3.5a) : la forme dit le niveau, le glyphe le sens du seuil, le trait de l'étiquette l'état.
          const level = alertSignalLevel(alert.state);
          const triggeredAt = alert.state === 'triggered' && alert.lastTriggeredAt !== undefined ? alert.lastTriggeredAt : null;
          return (
            <div key={alert.id} className={c.alertRow}>
              <span className={c.alertSignal}>{level !== null && <Signal level={level} />}</span>
              <span className={c.alertValue}>
                <span className={c.alertSubject}>{alertSubject(alert)}</span>
                <span className={c.alertLevel}>
                  <Glyph name={directionGlyph(alert)} className={c.dirGlyph} label={directionText(alertDirection(alert.kind))} />
                  <span>{alertThreshold(alert)}</span>
                </span>
              </span>
              <Tag className={cx(alert.state === 'armed' && c.planTag, alert.state === 'paused' && c.pauseTag)}>{alertStateWord(alert.state)}</Tag>
              <button type="button" className={c.alertRemove} onClick={() => run(deleteAlert(alert.id))} aria-label={tr('Supprimer l’alerte', 'Delete the alert', 'Eliminar la alerta')}>
                ×
              </button>
              {(triggeredAt !== null || alert.author === 'agent') && (
                <span className={c.alertLine}>
                  {triggeredAt !== null && <span>{triggeredAtText(triggeredAt)}</span>}
                  {alert.author === 'agent' && <Etiquette>{tr('AGENT', 'AGENT', 'AGENTE')}</Etiquette>}
                </span>
              )}
              {idle && (
                <span className={c.alertIdle}>
                  {tr('non évaluée', 'not evaluated', 'no evaluada')} · {idle}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className={v.sideSection}>
        <SideTitle>{tr('Source', 'Source', 'Fuente')}</SideTitle>
        <div className={v.desc}>
          {spec?.label ?? market} · {timeframeLabel(timeframe)} — {fmtInt(bars.length)} {tr('bougies', 'candles', 'velas')}, {tr('du', 'from', 'del')} {firstBar ? day(firstBar.time) : '—'} {tr('au', 'to', 'al')} {lastBar ? day(lastBar.time) : '—'}.
          <br />
          {chartTicker
            ? tr(`Dernier prix ${updatedAgo(now - chartTicker.time)}.`, `Last price ${updatedAgo(now - chartTicker.time)}.`, `Último precio ${updatedAgo(now - chartTicker.time)}.`)
            : tr('Aucun prix reçu pour ce marché.', 'No price received for this market.', 'Ningún precio recibido para este mercado.')}
        </div>
        <div>
          {VENUES.map((venue) => (
            <Regle key={venue} label={<Led on={venues[venue] === 'live'}>{VENUE_NAME[venue]}</Led>} value={venueStateText(venues[venue])} />
          ))}
        </div>
        <div className={v.desc}>{tr('Données publiques des exchanges, usage personnel.', 'Public exchange data, personal use.', 'Datos públicos de los exchanges, uso personal.')}</div>
        <div>
          <Button variant="ghost" disabled={turningOff} onClick={turnOff}>
            {tr('Éteindre le module', 'Turn off the module', 'Apagar el módulo')}
          </Button>
        </div>
      </div>

      <div className={v.sideSection}>
        <SideTitle>{tr('Agent', 'Agent', 'Agente')}</SideTitle>
        {agentLog.length === 0 ? (
          <div className={v.desc}>{tr('Aucune écriture de l’agent depuis l’ouverture du desk.', 'No agent write since the desk opened.', 'Ninguna escritura del agente desde la apertura del desk.')}</div>
        ) : (
          agentLog.map((line, i) => (
            <div key={`${line.at}-${i}`} className={v.tradeRow}>
              <span>{formatTimeLocal(line.at)}</span>
              <span>{line.tool}</span>
              <span style={{ gridColumn: '1 / -1', minWidth: 0, overflowWrap: 'anywhere' }}>{line.effect}</span>
            </div>
          ))
        )}
        <div className={v.desc}>
          {tr(
            'Chaque écriture de l’agent passe par le dialogue de confirmation du desk.',
            'Every agent write goes through the desk’s confirmation dialog.',
            'Cada escritura del agente pasa por el diálogo de confirmación del desk.',
          )}
        </div>
      </div>

      {alertOpen && <AlertModal watchlist={watchlist} defaultTarget={market} onClose={() => setAlertOpen(false)} onCreate={(input) => createAlert(input)} />}
    </aside>
  );
}
