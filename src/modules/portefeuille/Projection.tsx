import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Fan } from '@/design/charts/Fan';
import { Button, Empty, Field, Panel, Progress, Stat } from '@/design/primitives';
import { clampMonteCarlo, MAX_HORIZON, MAX_RUNS, monteCarlo, type MonteCarloOptions, type MonteCarloResult } from '@/engine/montecarlo';
import { tr, useI18n } from '@/i18n';
import { fmtInt, fmtPct } from '@/lib/format';
import { listenWorker } from '@/lib/worker';
import s from './portefeuille.module.css';

async function monteCarloOffthread(input: number[], opts: MonteCarloOptions = {}): Promise<MonteCarloResult | null> {
  if (opts.signal?.aborted) return null;
  const { signal, onProgress, ...rest } = opts;
  if (typeof Worker === 'undefined') return monteCarlo(input, opts);
  try {
    const worker = new Worker(new URL('../../engine/montecarlo.worker.ts', import.meta.url), { type: 'module' });
    const pending = listenWorker<MonteCarloResult | null>(worker, { signal, onProgress });
    worker.postMessage({ pnls: input, opts: rest });
    return await pending;
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) return null;
    return monteCarlo(input, opts);
  }
}

export function Projection({
  sample,
  currency,
  discrete,
  money,
  ruinValue,
  ruinSource,
  windowDays,
  onWindowDays,
}: {
  sample: number[];
  currency: string;
  discrete: boolean;
  money: (amount: number | null | undefined, currency: string, sign?: boolean) => string;
  ruinValue: number;
  ruinSource: 'prop' | 'historique';
  windowDays: number;
  onWindowDays: (n: number) => void;
}) {
  useI18n((st) => st.locale);
  const [runs, setRuns] = useState(2000);
  const [horizon, setHorizon] = useState<number | ''>('');
  const [ruin, setRuin] = useState<number | ''>(ruinValue);
  const [touchedRuin, setTouchedRuin] = useState(false);
  const [target, setTarget] = useState<number | ''>('');
  const [seed, setSeed] = useState(1337);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!touchedRuin) setRuin(ruinValue);
  }, [ruinValue, touchedRuin]);

  const params = useDeferredValue(useMemo(() => ({ runs, horizon, seed, ruin, target }), [runs, horizon, seed, ruin, target]));
  const effective = clampMonteCarlo(params.runs, params.horizon === '' ? sample.length : params.horizon);
  const shown = (amount: number | null | undefined, sign = false) => (discrete ? `••••• ${currency}` : money(amount, currency, sign));

  useEffect(() => {
    if (sample.length < 5) {
      setResult(null);
      setBusy(false);
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setProgress(0);
    void monteCarloOffthread(sample, {
      runs: params.runs,
      horizon: params.horizon === '' ? undefined : params.horizon,
      seed: params.seed,
      ruinDrawdown: params.ruin === '' ? undefined : params.ruin,
      target: params.target === '' ? undefined : params.target,
      signal: ac.signal,
      onProgress: (done, total) => {
        if (!ac.signal.aborted) setProgress(total ? done / total : 0);
      },
    }).then((r) => {
      if (ac.signal.aborted) return;
      setResult(r);
      setProgress(1);
      setBusy(false);
    });
    return () => ac.abort();
  }, [sample, params]);

  if (sample.length < 5) {
    return (
      <Empty
        title={tr('Échantillon insuffisant', 'Insufficient sample', 'Muestra insuficiente')}
        text={tr(
          'La projection demande au moins 5 journées de PnL consolidé.',
          'The projection needs at least 5 consolidated PnL days.',
          'La proyección necesita al menos 5 jornadas de PnL consolidado.',
        )}
      />
    );
  }

  const ruinHint =
    ruinSource === 'prop'
      ? tr('somme des drawdowns restants des poches prop', 'sum of remaining prop-firm drawdowns', 'suma de los drawdowns prop restantes')
      : tr('drawdown max historique consolidé', 'historical consolidated max drawdown', 'drawdown máximo histórico consolidado');

  return (
    <div className={s.stack}>
      <Panel
        title={tr('Paramètres', 'Parameters', 'Parámetros')}
        sub={tr('bootstrap avec remise · worker existant', 'bootstrap with replacement · existing worker', 'bootstrap con reemplazo · worker existente')}
        actions={
          busy ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                abortRef.current?.abort();
                setBusy(false);
              }}
            >
              {tr('Annuler', 'Cancel', 'Cancelar')}
            </Button>
          ) : undefined
        }
      >
        <div className={s.stack}>
          {busy && <Progress value={progress} tone="gold" />}
          <div className={s.form}>
            <Field label={tr('Journées', 'Days', 'Jornadas')} hint={tr('défaut 120', 'default 120', 'predeterminado 120')}>
              <input
                type="number"
                min={5}
                max={5000}
                value={windowDays}
                onChange={(e) => onWindowDays(Math.max(1, Number(e.target.value) || 120))}
              />
            </Field>
            <Field label={tr('Simulations', 'Simulations', 'Simulaciones')} hint={tr(`max ${MAX_RUNS}`, `max ${MAX_RUNS}`, `máx. ${MAX_RUNS}`)}>
              <input type="number" min={100} max={MAX_RUNS} step={100} value={runs} onChange={(e) => setRuns(Number(e.target.value) || 100)} />
            </Field>
            <Field
              label={tr('Horizon (périodes)', 'Horizon (periods)', 'Horizonte (periodos)')}
              hint={tr(`vide = ${sample.length} · max ${MAX_HORIZON}`, `empty = ${sample.length} · max ${MAX_HORIZON}`, `vacío = ${sample.length} · máx. ${MAX_HORIZON}`)}
            >
              <input type="number" min={1} max={MAX_HORIZON} value={horizon} placeholder={String(sample.length)} onChange={(e) => setHorizon(e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <Field label={tr('Drawdown de ruine', 'Ruin drawdown', 'Drawdown de ruina')} hint={`${ruinHint} · ${currency}`}>
              <input
                type="number"
                min={0}
                step={100}
                value={ruin}
                onChange={(e) => {
                  setTouchedRuin(true);
                  setRuin(e.target.value === '' ? '' : Number(e.target.value));
                }}
              />
            </Field>
            <Field label={tr('Objectif', 'Target', 'Objetivo')} hint={tr('optionnel', 'optional', 'opcional')}>
              <input type="number" min={0} step={100} value={target} onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <Field label={tr('Graine', 'Seed', 'Semilla')}>
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
            </Field>
          </div>
          {touchedRuin && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTouchedRuin(false);
                setRuin(ruinValue);
              }}
            >
              {tr('Reprendre les seuils', 'Use the thresholds again', 'Volver a los umbrales')}
            </Button>
          )}
          {effective.runs !== params.runs && (
            <p className={s.note}>{tr(`Simulations ramenées à ${effective.runs}.`, `Simulations clamped to ${effective.runs}.`, `Simulaciones ajustadas a ${effective.runs}.`)}</p>
          )}
        </div>
      </Panel>
      {result && (
        <>
          <div className={s.heartStats}>
            <Stat small label={tr('PnL final médian', 'Median final PnL', 'PnL final mediano')} value={shown(result.finalPnl.p50, true)} hint={`p5 ${shown(result.finalPnl.p5)} · p95 ${shown(result.finalPnl.p95)}`} tone={result.finalPnl.p50 >= 0 ? 'pos' : 'neg'} />
            <Stat small label={tr('Drawdown max médian', 'Median max drawdown', 'Drawdown máx. mediano')} value={shown(-result.maxDrawdown.p50)} tone="neg" />
            <Stat
              small
              label={tr('Probabilité de ruine', 'Ruin probability', 'Probabilidad de ruina')}
              value={result.ruinProbability === null ? '—' : fmtPct(result.ruinProbability)}
              hint={ruin === '' ? tr('seuil non défini', 'threshold not set', 'umbral no definido') : shown(typeof ruin === 'number' ? -ruin : null)}
              tone={result.ruinProbability !== null && result.ruinProbability > 0.2 ? 'neg' : 'flat'}
            />
            <Stat
              small
              label={tr('Probabilité objectif', 'Target probability', 'Probabilidad objetivo')}
              value={result.targetProbability === null ? '—' : fmtPct(result.targetProbability)}
              hint={target === '' ? tr('objectif non défini', 'target not set', 'objetivo no definido') : shown(typeof target === 'number' ? target : null, true)}
            />
          </div>
          <Panel title={tr('Éventail des trajectoires', 'Path fan', 'Abanico de trayectorias')} sub={`${fmtInt(result.runs)} · ${result.horizon}`}>
            <Fan result={result} height={280} formatY={(v) => shown(v)} ruin={ruin === '' ? undefined : ruin} target={target === '' ? undefined : target} />
          </Panel>
        </>
      )}
    </div>
  );
}
