import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Fan } from '@/design/charts/Fan';
import { Button, Empty, Field, Panel, Progress, Segmented, Stat, cx } from '@/design/primitives';
import { clampMonteCarlo, MAX_HORIZON, MAX_RUNS, monteCarlo, type MonteCarloOptions, type MonteCarloResult } from '@/engine/montecarlo';
import { fmtInt, fmtPct, fmtUsd } from '@/lib/format';
import { listenWorker } from '@/lib/worker';
import s from './metrique.module.css';
import { useStats } from './useStats';

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

export function MonteCarloView() {
  const { sessions, trades, plan } = useStats();
  const [level, setLevel] = useState<'seances' | 'trades'>('seances');
  const [runs, setRuns] = useState(2000);
  const [horizon, setHorizon] = useState<number | ''>('');
  const [ruin, setRuin] = useState<number | ''>(plan?.maxDrawdown ?? 2500);
  const [target, setTarget] = useState<number | ''>(plan?.profitTarget ?? 3000);
  const [seed, setSeed] = useState(1337);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const sample = useMemo(() => (level === 'seances' ? sessions.map((x) => x.pnl) : trades.map((x) => x.pnl)), [level, sessions, trades]);
  const params = useDeferredValue(useMemo(() => ({ runs, horizon, seed, ruin, target }), [runs, horizon, seed, ruin, target]));
  const effective = clampMonteCarlo(params.runs, params.horizon === '' ? sample.length : params.horizon);

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

  if (sample.length < 5) return <Empty title="Échantillon insuffisant" text="Le bootstrap Monte Carlo nécessite au moins 5 séances (ou trades)." />;

  return (
    <div className={cx(s.grid, s.gridTop)}>
      <Panel
        className={s.c4}
        title="Paramètres"
        sub="bootstrap avec remise"
        actions={
          busy ? (
            <Button size="sm" variant="ghost" onClick={() => { abortRef.current?.abort(); setBusy(false); }}>
              Annuler
            </Button>
          ) : undefined
        }
      >
        <div className={s.rows}>
          {busy && <Progress value={progress} tone="gold" />}
          <Segmented value={level} onChange={setLevel} options={[{ value: 'seances', label: `Séances · ${sessions.length}` }, { value: 'trades', label: `Trades · ${trades.length}` }]} />
          <div className={s.formGrid}>
            <Field label="Simulations" hint={effective.runs !== params.runs ? `ramené à ${effective.runs} (budget de calcul)` : `max ${MAX_RUNS}`}>
              <input type="number" min={100} max={MAX_RUNS} step={100} value={runs} onChange={(e) => setRuns(Number(e.target.value) || 100)} />
            </Field>
            <Field label="Horizon (périodes)" hint={`vide = ${sample.length} · max ${MAX_HORIZON}`}>
              <input type="number" min={1} max={MAX_HORIZON} value={horizon} onChange={(e) => setHorizon(e.target.value === '' ? '' : Number(e.target.value))} placeholder={String(sample.length)} />
            </Field>
            <Field label="Drawdown de ruine ($)" hint={plan ? `${plan.firm} ${plan.label} : ${fmtUsd(plan.maxDrawdown)}` : undefined}>
              <input type="number" min={0} step={100} value={ruin} onChange={(e) => setRuin(e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <Field label="Objectif ($)">
              <input type="number" min={0} step={100} value={target} onChange={(e) => setTarget(e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <Field label="Graine" hint="reproductibilité">
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
            </Field>
          </div>
          <p className={s.note}>
            Chaque trajectoire tire {result?.horizon ?? sample.length} résultats au hasard, avec remise, dans votre historique réel (bootstrap i.i.d. : l’autocorrélation n’est pas modélisée). Le résultat ne suppose aucune loi de distribution : il ne fait que réordonner votre propre passé pour mesurer la part de chance dans votre courbe actuelle.
          </p>
        </div>
      </Panel>

      <div className={`${s.c8} ${s.rows}`}>
        {result && (
          <>
            <div className={s.miniStats}>
              <Stat small label="PnL final médian" value={fmtUsd(result.finalPnl.p50)} hint={`p5 ${fmtUsd(result.finalPnl.p5)} · p95 ${fmtUsd(result.finalPnl.p95)}`} tone={result.finalPnl.p50 >= 0 ? 'pos' : 'neg'} />
              <Stat small label="Drawdown max médian" value={fmtUsd(-result.maxDrawdown.p50)} hint={`p95 ${fmtUsd(-result.maxDrawdown.p95)}`} tone="neg" />
              <Stat small label="Probabilité de ruine" value={result.ruinProbability === null ? '—' : fmtPct(result.ruinProbability)} hint={ruin === '' ? 'seuil non défini' : `toucher −${fmtUsd(ruin)}`} tone={result.ruinProbability !== null && result.ruinProbability > 0.2 ? 'neg' : 'flat'} />
              <Stat small label="Probabilité objectif" value={result.targetProbability === null ? '—' : fmtPct(result.targetProbability)} hint={target === '' ? 'objectif non défini' : `atteindre +${fmtUsd(target)} avant ruine`} tone={result.targetProbability !== null && result.targetProbability > 0.6 ? 'pos' : 'flat'} />
            </div>
            <Panel title="Éventail des trajectoires" sub={`${fmtInt(result.runs)} simulations · ${result.horizon} périodes`}>
              <Fan result={result} height={300} formatY={(v) => fmtUsd(v)} ruin={ruin === '' ? undefined : ruin} target={target === '' ? undefined : target} />
            </Panel>
            <Panel title="Percentiles" sub="distribution des résultats">
              <div className={s.formGrid}>
                <dl className={s.kv}>
                  <dt>PnL final · p5</dt>
                  <dd className="neg">{fmtUsd(result.finalPnl.p5)}</dd>
                  <dt>p25</dt>
                  <dd>{fmtUsd(result.finalPnl.p25)}</dd>
                  <dt>p50</dt>
                  <dd>{fmtUsd(result.finalPnl.p50)}</dd>
                  <dt>p75</dt>
                  <dd>{fmtUsd(result.finalPnl.p75)}</dd>
                  <dt>p95</dt>
                  <dd className="pos">{fmtUsd(result.finalPnl.p95)}</dd>
                  <dt>Moyenne</dt>
                  <dd>{fmtUsd(result.finalPnl.mean)}</dd>
                </dl>
                <dl className={s.kv}>
                  <dt>Drawdown max · p5</dt>
                  <dd>{fmtUsd(-result.maxDrawdown.p5)}</dd>
                  <dt>p25</dt>
                  <dd>{fmtUsd(-result.maxDrawdown.p25)}</dd>
                  <dt>p50</dt>
                  <dd>{fmtUsd(-result.maxDrawdown.p50)}</dd>
                  <dt>p75</dt>
                  <dd>{fmtUsd(-result.maxDrawdown.p75)}</dd>
                  <dt>p95</dt>
                  <dd className="neg">{fmtUsd(-result.maxDrawdown.p95)}</dd>
                  <dt>Moyenne</dt>
                  <dd>{fmtUsd(-result.maxDrawdown.mean)}</dd>
                </dl>
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
