import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Plate } from '@/design/Micro';
import { Button, Empty, Segmented, Tag } from '@/design/primitives';
import type { Bar } from '@/engine/bars';
import { inputBarsFor, offeredCatalog } from '@/engine/crypto/indicators';
import { CHARTABLE_MARKETS, CRYPTO_TIMEFRAMES, cryptoMarket, type CryptoBar, type CryptoMarketId, type VenueState } from '@/engine/crypto/markets';
import type { CryptoDrawing } from '@/engine/crypto/persist';
import type { IndicatorDefinition, IndicatorInstance, IndicatorLine } from '@/engine/indicators';
import type { Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { cssToken } from '@/lib/cssToken';
import { fmtInt, fmtNum, fmtPrice, signClass } from '@/lib/format';
import { dateKeyLocal, formatDateFr, formatTimeLocal } from '@/lib/time';
import { Chart, type ChartPriceLine, type HoverInfo } from '@/modules/visual/Chart';
import { useCrypto } from '@/store/crypto';
import { useUi } from '@/store/ui';
import v from '../visual/visual.module.css';
import { cryptoCodeText } from './AlertModal';
import c from './crypto.module.css';
import { CryptoSide, VENUE_NAME, timeframeLabel, useCryptoAction, venueStateText } from './CryptoSide';
import { alertPriceLines, chartFeed, linkPlateLabel, linkPlateValues } from './cryptoSignals';

/**
 * Onglet 09 · CRY (`docs/ONGLET-CRYPTO.md` § 7). Éteint par défaut : seul le process principal allume le module, après son
 * propre dialogue ; l'onglet montre alors l'état vide. Allumé, il reprend la composition de 02 · VIS : en-tête (état du flux,
 * marché, unité de temps), chart et légende à gauche, colonne à droite, avec la feuille de Visual.
 */

/** La teinte des tracés quand `--violet` ne se lit pas : sa valeur de `tokens.css`, en notation fonctionnelle (aucun hex ici). */
const DRAWING_COLOR_FALLBACK = 'rgb(169, 150, 224)';
/** Les encres des seuils d'alerte quand `--text-1` (niveau 1) et `--text-0` (niveau 2) ne se lisent pas : leurs valeurs de `tokens.css`. */
const STEEL_FALLBACK = 'rgb(185, 180, 169)';
const IVORY_FALLBACK = 'rgb(245, 242, 234)';
/** Le chart crypto ne projette aucun trade. */
const NO_TRADES: Trade[] = [];
const CVD = 'cvd';
const CVD_BINANCE = 'cvd-binance';

/** Un volume crypto : fractionnaire sous 1 000 (0,42 BTC), entier au-delà (1 250 000 ONE). */
function fmtVolume(v: number | null | undefined): string {
  return v !== null && v !== undefined && Math.abs(v) >= 1000 ? fmtInt(v) : fmtNum(v, 2);
}

interface LineCacheEntry {
  input: readonly CryptoBar[];
  paramsKey: string;
  lines: IndicatorLine[];
}

/**
 * Les lignes d'indicateur du chart, comme dans Visual : mémorisées par instance (bougies lues + paramètres), pour qu'une ligne
 * inchangée garde sa référence. Chaque indicateur lit les bougies que `inputBarsFor` lui donne (celles du marché, ou la série
 * Binance pour `cvd-binance`) ; ces tableaux du store sont en lecture seule, l'indicateur en reçoit une copie, faite une fois
 * par tableau. `definitionOf` rend l'indicateur d'une ligne, pour la légende.
 */
function useCryptoLines(bars: readonly CryptoBar[], proxyBars: readonly CryptoBar[], instances: IndicatorInstance[], catalog: IndicatorDefinition[]): { lines: IndicatorLine[]; definitionOf: Map<string, string> } {
  const cache = useRef<Map<string, LineCacheEntry>>(new Map());
  const copies = useRef<WeakMap<readonly CryptoBar[], Bar[]>>(new WeakMap());
  return useMemo(() => {
    const copyOf = (input: readonly CryptoBar[]): Bar[] => {
      let copy = copies.current.get(input);
      if (!copy) {
        copy = [...input];
        copies.current.set(input, copy);
      }
      return copy;
    };
    const lines: IndicatorLine[] = [];
    const definitionOf = new Map<string, string>();
    const seen = new Set<string>();
    for (const inst of instances) {
      if (!inst.visible) continue;
      const def = catalog.find((d) => d.id === inst.definitionId);
      if (!def) continue;
      seen.add(inst.id);
      const input = inputBarsFor(def.id, bars, proxyBars);
      const paramsKey = `${def.id}|${JSON.stringify(inst.params)}`;
      let entry = cache.current.get(inst.id);
      if (!entry || entry.input !== input || entry.paramsKey !== paramsKey) {
        const res = def.compute(copyOf(input), inst.params);
        entry = { input, paramsKey, lines: res.lines.map((l) => ({ ...l, key: `${inst.id}:${l.key}` })) };
        cache.current.set(inst.id, entry);
      }
      for (const line of entry.lines) definitionOf.set(line.key, def.id);
      lines.push(...entry.lines);
    }
    for (const id of cache.current.keys()) if (!seen.has(id)) cache.current.delete(id);
    return { lines, definitionOf };
  }, [bars, proxyBars, instances, catalog]);
}

/** Les tracés du marché affiché, en lignes de prix : un niveau en donne une, une zone deux. Titre `AGENT` quand l'agent les a posés. */
function drawingLines(drawings: readonly CryptoDrawing[], market: CryptoMarketId): ChartPriceLine[] {
  const color = cssToken('--violet', DRAWING_COLOR_FALLBACK);
  const out: ChartPriceLine[] = [];
  for (const d of drawings) {
    if (d.market !== market) continue;
    const title = d.author === 'agent' ? tr('AGENT', 'AGENT', 'AGENTE') : (d.label ?? '');
    if (d.kind === 'level' && d.price !== undefined) out.push({ id: d.id, price: d.price, title, color });
    if (d.kind === 'zone' && d.from !== undefined && d.to !== undefined) {
      out.push({ id: `${d.id}:from`, price: d.from, title, color });
      out.push({ id: `${d.id}:to`, price: d.to, title, color });
    }
  }
  return out;
}

/**
 * Vrai dès qu'une bougie du direct a changé le chart depuis son dernier vidage. Le chart se vide à chaque changement de marché
 * ou d'unité de temps, l'historique arrive sur un chart vide, le direct sur un chart rempli.
 */
function useLiveSeen(bars: readonly CryptoBar[]): boolean {
  const [seen, setSeen] = useState(false);
  const previous = useRef(bars);
  useEffect(() => {
    const before = previous.current;
    previous.current = bars;
    if (bars.length === 0) setSeen(false);
    else if (before.length > 0 && before !== bars) setSeen(true);
  }, [bars]);
  return seen;
}

export default function Crypto() {
  useI18n((s) => s.locale);
  const ready = useCrypto((s) => s.ready);
  const enabled = useCrypto((s) => s.enabled);
  const requestEnable = useCrypto((s) => s.requestEnable);
  const toast = useUi((u) => u.toast);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    void useCrypto.getState().load();
  }, []);

  // Le chart entre à l'écran : le flux lourd suit dès que l'interrupteur est allumé, et s'arrête quand l'onglet se ferme.
  useEffect(() => {
    useCrypto.getState().openChart();
    return () => useCrypto.getState().closeChart();
  }, []);

  const venueCount = new Set(CHARTABLE_MARKETS.map((id) => cryptoMarket(id)?.venue)).size;
  const meta = `${CHARTABLE_MARKETS.length} ${tr('MARCHÉS', 'MARKETS', 'MERCADOS')} · ${venueCount} ${tr('VENUES', 'VENUES', 'VENUES')}`;

  const enable = () => {
    if (enabling) return;
    setEnabling(true);
    requestEnable()
      .catch(() => toast(tr('Le process principal n’a pas répondu : le module reste éteint.', 'The main process did not answer: the module stays off.', 'El proceso principal no respondió: el módulo sigue apagado.'), 'warn'))
      .finally(() => setEnabling(false));
  };

  if (ready && enabled) return <CryptoDesk meta={meta} />;

  return (
    <>
      <ModuleHeader tab="crypto" meta={meta} />
      <ModuleContent>
        {ready && !enabled ? (
          <Empty
            title={tr('Module crypto éteint', 'Crypto module off', 'Módulo cripto apagado')}
            text={tr(
              'Données publiques de Coinbase, Binance et Bybit, pour un usage personnel. Le desk ne s’y connecte qu’une fois le module activé.',
              'Public data from Coinbase, Binance and Bybit, for personal use. The desk connects only once the module is on.',
              'Datos públicos de Coinbase, Binance y Bybit, para uso personal. El desk solo se conecta una vez activado el módulo.',
            )}
            action={
              <Button variant="chamfer" disabled={enabling} onClick={enable}>
                {tr('Activer le module crypto', 'Turn on the crypto module', 'Activar el módulo cripto')}
              </Button>
            }
          />
        ) : null}
      </ModuleContent>
    </>
  );
}

/** L'onglet allumé : en-tête, chart et légende, colonne. */
function CryptoDesk({ meta }: { meta: string }) {
  const locale = useI18n((s) => s.locale);
  const market = useCrypto((s) => s.market);
  const timeframe = useCrypto((s) => s.timeframe);
  const indicators = useCrypto((s) => s.indicators);
  const bars = useCrypto((s) => s.bars);
  const proxyBars = useCrypto((s) => s.proxyBars);
  const cvdAnchoredAt = useCrypto((s) => s.cvdAnchoredAt);
  const venues = useCrypto((s) => s.venues);
  const drawings = useCrypto((s) => s.drawings);
  const alerts = useCrypto((s) => s.alerts);
  const chartError = useCrypto((s) => s.chartError);
  const proxyError = useCrypto((s) => s.proxyError);
  const setMarket = useCrypto((s) => s.setMarket);
  const setTimeframe = useCrypto((s) => s.setTimeframe);
  const run = useCryptoAction();
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const spec = cryptoMarket(market);
  const precision = spec?.precision ?? 2;
  const minMove = spec?.tickSize ?? 0.01;
  const venueName = spec ? VENUE_NAME[spec.venue] : '';
  const venueState: VenueState = spec ? venues[spec.venue] : 'off';

  const catalog = useMemo(() => offeredCatalog(market, timeframe), [market, timeframe]);
  const shown = useMemo(() => indicators.filter((inst) => catalog.some((def) => def.id === inst.definitionId)), [indicators, catalog]);
  const { lines, definitionOf } = useCryptoLines(bars, proxyBars, shown, catalog);
  const priceFormat = useMemo(() => ({ precision, minMove }), [precision, minMove]);
  // La langue en dépendance : les titres `AGENT` et `ALERTE` passent par `tr`. Les seuils du marché suivent ses tracés (OROS3.5d).
  const priceLines = useMemo(
    () => [...drawingLines(drawings, market), ...alertPriceLines(alerts, market, { 1: cssToken('--text-1', STEEL_FALLBACK), 2: cssToken('--text-0', IVORY_FALLBACK) })],
    [drawings, alerts, market, locale],
  );
  const liveSeen = useLiveSeen(bars);
  // Le flux du chart, que lisent la puce du chart et la plaque LINK de la barre (OROS3.5c).
  const feed = chartFeed({ venueState, liveSeen, barCount: bars.length });
  const link = { venueName, venueState, feed };

  // Une identité stable : un `onHover` neuf recréerait le graphique (Chart.tsx), sans rejouer ses données.
  const onHover = useCallback((info: HoverInfo | null) => setHover(info), []);
  useEffect(() => setHover(null), [market, timeframe]);

  const shownBar = hover?.bar ?? bars[bars.length - 1] ?? null;
  const visible = (definitionId: string) => shown.some((inst) => inst.visible && inst.definitionId === definitionId);
  const cvdBinance = visible(CVD_BINANCE);
  /** L'heure d'ancrage du CVD, quand la ligne est visible et qu'elle s'ancre (Coinbase et Bybit, première bougie vue en entier). */
  const cvdSince = cvdAnchoredAt !== null && visible(CVD) ? formatTimeLocal(cvdAnchoredAt * 1000) : null;
  /** La valeur d'une ligne au survol : à la précision du marché pour un prix (et l'ATR, en unité de prix), en volume sinon. */
  const lineValue = (key: string, value: number) => {
    const line = lines.find((l) => l.key === key);
    return line?.pane === 'price' || definitionOf.get(key) === 'atr' ? fmtPrice(value, precision) : fmtVolume(value);
  };

  return (
    <>
      <ModuleHeader
        tab="crypto"
        meta={meta}
        actions={
          <>
            <Plate id="link" values={linkPlateValues(link)} label={linkPlateLabel(link, venueStateText(venueState))} className={c.linkPlate} />
            {(venueState === 'stale' || venueState === 'reconnecting') && <Tag tone="ember">{tr('données périmées', 'stale data', 'datos caducados')}</Tag>}
            <select value={market} onChange={(e) => run(setMarket(e.target.value))} style={{ minWidth: 260 }}>
              {CHARTABLE_MARKETS.map((id) => (
                <option key={id} value={id}>
                  {cryptoMarket(id)?.label ?? id}
                </option>
              ))}
            </select>
            <Segmented
              value={String(timeframe)}
              onChange={(value) => run(setTimeframe(Number(value)))}
              options={CRYPTO_TIMEFRAMES.map((tf) => ({ value: String(tf), label: timeframeLabel(tf) }))}
            />
          </>
        }
      />
      <ModuleContent noPad>
        <div className={v.layout}>
          <div className={v.chartWrap}>
            <div className={v.legend}>
              <div className={v.legendMain}>
                <b>
                  {spec?.symbol ?? market} · {timeframeLabel(timeframe)}
                </b>
                {shownBar && (
                  <>
                    <span>
                      {formatDateFr(dateKeyLocal(new Date(shownBar.time * 1000)), { short: true })} {formatTimeLocal(shownBar.time * 1000)}
                    </span>
                    <span>
                      O <b className={signClass(shownBar.close - shownBar.open)}>{fmtPrice(shownBar.open, precision)}</b> H <b>{fmtPrice(shownBar.high, precision)}</b> L <b>{fmtPrice(shownBar.low, precision)}</b> C{' '}
                      <b className={signClass(shownBar.close - shownBar.open)}>{fmtPrice(shownBar.close, precision)}</b>
                    </span>
                    <span>Vol {fmtVolume(shownBar.volume)}</span>
                  </>
                )}
              </div>
              {/* L'ancrage du CVD vit sur la deuxième ligne, comme les valeurs au survol : la première ligne, déjà longue, passerait sous la puce. */}
              {(cvdSince !== null || cvdBinance) && (
                <div className={v.legendRow}>
                  {cvdSince !== null && <span>{tr(`CVD depuis ${cvdSince}`, `CVD since ${cvdSince}`, `CVD desde ${cvdSince}`)}</span>}
                  {cvdBinance && <span>{tr('CVD Binance', 'CVD Binance', 'CVD Binance')}</span>}
                </div>
              )}
              {hover && hover.values.length > 0 && (
                <div className={v.legendRow}>
                  {hover.values
                    .filter((value) => value.value !== null)
                    .slice(0, 8)
                    .map((value) => (
                      <span key={value.key}>
                        <i style={{ background: value.color }} />
                        {value.label} <b>{value.value === null ? '—' : lineValue(value.key, value.value)}</b>
                      </span>
                    ))}
                </div>
              )}
              {chartError && (
                <div className={v.legendRow}>
                  <span>{cryptoCodeText(chartError)}</span>
                </div>
              )}
              {cvdBinance && proxyError && (
                <div className={v.legendRow}>
                  <span>
                    {tr('CVD Binance', 'CVD Binance', 'CVD Binance')} · {cryptoCodeText(proxyError)}
                  </span>
                </div>
              )}
            </div>
            <div className={v.stamp}>
              {feed === 'FROZEN' ? (
                <Tag tone="ember">
                  {venueName} · {tr('figé', 'frozen', 'congelado')}
                </Tag>
              ) : feed === 'ACTIVE' ? (
                <Tag tone="gold" dot live>
                  {venueName} · {tr('direct', 'live', 'directo')}
                </Tag>
              ) : (
                <Tag tone="ice">{tr('Historique', 'History', 'Histórico')}</Tag>
              )}
            </div>
            <Chart bars={bars} timeframe={timeframe} lines={lines} trades={NO_TRADES} onHover={onHover} priceFormat={priceFormat} priceLines={priceLines} />
          </div>
          <CryptoSide catalog={catalog} instances={shown} />
        </div>
      </ModuleContent>
    </>
  );
}
