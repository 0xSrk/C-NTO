import { useMemo, useState } from 'react';
import { Fan } from '@/design/charts/Fan';
import { Empty, Field, Panel, Segmented, Stat } from '@/design/primitives';
import { monteCarlo } from '@/engine/montecarlo';
import { fmtInt, fmtPct, fmtUsd } from '@/lib/format';
import s from './metrique.module.css';
import { useStats } from './useStats';

export function MonteCarloView() {
  const { sessions, trades, plan } = useStats();
  const [level, setLevel] = useState<'seances' | 'trades'>('seances');
  const [runs, setRuns] = useState(2000);
  const [horizon, setHorizon] = useState<number | ''>('');
  const [ruin, setRuin] = useState<number | ''>(plan?.maxDrawdown ?? 2500);
  const [target, setTarget] = useState<number | ''>(plan?.profitTarget ?? 3000);
  const [seed, setSeed] = useState(1337);

  const sample = useMemo(() => (level === 'seances' ? sessions.map((x) => x.pnl) : trades.map((x) => x.pnl)), [level, sessions, trades]);

  const result = useMemo(
    () =>
      monteCarlo(sample, {
        runs,
        horizon: horizon === '' ? undefined : horizon,
        seed,
        ruinDrawdown: ruin === '' ? undefined : ruin,
        target: target === '' ? undefined : target,
      }),
    [sample, runs, horizon, seed, ruin, target],
  );

  if (sample.length < 5) return <Empty title="Échantillon insuffisant" text="Le bootstrap Monte Carlo nécessite au moins 5 séances (ou trades)." />;

  return (
    <div className={s.grid}>
      <Panel className={s.c4} title="Paramètres" sub="bootstrap avec remise">
        <div className={s.rows}>
          <Segmented value={level} onChange={setLevel} options={[{ value: 'seances', label: `Séances · ${sessions.length}` }, { value: 'trades', label: `Trades · ${trades.length}` }]} />
          <div className={s.formGrid}>
            <Field label="Simulations">
              <input type="number" min={100} max={20000} step={100} value={runs} onChange={(e) => setRuns(Number(e.target.value) || 100)} />
            </Field>
            <Field label="Horizon (périodes)" hint={`vide = ${sample.length}`}>
              <input type="number" min={1} max={5000} value={horizon} onChange={(e) => setHorizon(e.target.value === '' ? '' : Number(e.target.value))} placeholder={String(sample.length)} />
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
            Chaque trajectoire tire {result?.horizon ?? sample.length} résultats au hasard, avec remise, dans votre historique réel. Le résultat ne suppose aucune loi de distribution : il ne fait que réordonner votre propre passé pour mesurer la part de chance dans votre courbe actuelle.
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
