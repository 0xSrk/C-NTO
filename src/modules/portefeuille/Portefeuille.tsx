import { useEffect, useMemo, useRef, useState } from 'react';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { LineArea, type LineSeries } from '@/design/charts/LineArea';
import { Button, Empty, Field, Panel, Segmented, Tag, tableClass } from '@/design/primitives';
import { PROP_FIRMS, findPlan, type PropPlan } from '@/engine/propfirm';
import { bilan, bilanBounds, bilanToCsv, projectionRuin, type BilanPreset } from '@/engine/portfolio/bilan';
import { buildEquityPoints, consolidateEquity, projectionSeries } from '@/engine/portfolio/equity';
import { exposure } from '@/engine/portfolio/exposure';
import { convertAmount } from '@/engine/portfolio/fx';
import { positionMultiplier } from '@/engine/portfolio/price';
import { riskFromEquity } from '@/engine/portfolio/risk';
import {
  CREATABLE_POCKET_KINDS,
  isCreatableKind,
  isTraditionalKind,
  type CreatablePocketKind,
  type Pocket,
  type PocketKind,
  type Position,
  type ValuationMark,
} from '@/engine/portfolio/types';
import { consolidate, valuePocket } from '@/engine/portfolio/valuation';
import { Synthese } from './Synthese';
import { intlTag, tr, useI18n } from '@/i18n';
import { saveTextFile, openTextFile } from '@/lib/desk';
import { fmtNum } from '@/lib/format';
import { useBridge } from '@/store/bridge';
import { useJournal } from '@/store/journal';
import { usePortfolio } from '@/store/portfolio';
import { useSettings } from '@/store/settings';
import s from './portefeuille.module.css';

const DISCRETE_KEY = 'canto.ptf.discrete';
const PALETTE = ['var(--mint)', 'var(--text-0)', 'var(--ember)', 'var(--text-1)', 'var(--gold)'];

const moneyCache = new Map<string, Intl.NumberFormat>();

function readDiscrete(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(DISCRETE_KEY) === '1';
  } catch {
    return false;
  }
}

function formatMoney(amount: number | null | undefined, currency: string, discrete: boolean, sign = false): string {
  const code = currency.trim().toUpperCase();
  const label = /^[A-Z]{3}$/.test(code) ? code : '—';
  if (discrete) return `••••• ${label}`;
  if (amount == null || !Number.isFinite(amount) || !/^[A-Z]{3}$/.test(code)) return `— ${label}`;
  const tag = intlTag();
  const key = `${tag}|${code}`;
  let fmt = moneyCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(tag, { style: 'currency', currency: code, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    moneyCache.set(key, fmt);
  }
  const n = Math.abs(amount) < 1e-9 ? 0 : amount;
  const body = fmt.format(n);
  if (sign && n > 0 && !body.includes('+')) return `+${body}`;
  return body;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNum(raw: string): number | null {
  const n = Number(raw.trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function kindLabel(kind: PocketKind): string {
  const map: Record<PocketKind, [string, string, string]> = {
    propfirm: ['Prop firm', 'Prop firm', 'Prop firm'],
    futures: ['Futures', 'Futures', 'Futuros'],
    actions: ['Actions', 'Equities', 'Acciones'],
    indices: ['Indices', 'Indices', 'Índices'],
    forex: ['Forex', 'Forex', 'Forex'],
    commodites: ['Commodités', 'Commodities', 'Materias primas'],
    cfd: ['CFD', 'CFD', 'CFD'],
    liquidites: ['Liquidités', 'Cash', 'Liquidez'],
    crypto: ['Crypto', 'Crypto', 'Cripto'],
  };
  const row = map[kind];
  return tr(row[0], row[1], row[2]);
}

function markLabel(mark: ValuationMark): string {
  if (mark === 'pont') return tr('pont', 'bridge', 'puente');
  if (mark === 'journal') return tr('journal', 'journal', 'diario');
  if (mark === 'saisi') return tr('saisi', 'entered', 'introducido');
  return tr('au prix de revient', 'at cost', 'a precio de coste');
}

function statusLabel(status: string): string {
  if (status === 'objectif') return tr('objectif', 'target', 'objetivo');
  if (status === 'echec') return tr('échec', 'failed', 'fallo');
  return tr('en cours', 'in progress', 'en curso');
}

interface DraftPocket {
  id?: string;
  name: string;
  kind: CreatablePocketKind;
  currency: string;
  account: string;
  planId: string;
  venue: string;
}

function blankPocket(): DraftPocket {
  return { name: '', kind: 'propfirm', currency: 'USD', account: '', planId: 'apex-50', venue: '' };
}

function CommitInput({ value, label, onCommit }: { value: string; label: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

export default function Portefeuille() {
  const locale = useI18n((st) => st.locale);
  const [discrete, setDiscrete] = useState(readDiscrete);
  const ready = usePortfolio((st) => st.ready);
  const pockets = usePortfolio((st) => st.pockets);
  const positions = usePortfolio((st) => st.positions);
  const cash = usePortfolio((st) => st.cash);
  const fx = usePortfolio((st) => st.fx);
  const load = usePortfolio((st) => st.load);
  const savePocket = usePortfolio((st) => st.savePocket);
  const archivePocket = usePortfolio((st) => st.archivePocket);
  const reactivatePocket = usePortfolio((st) => st.reactivatePocket);
  const savePosition = usePortfolio((st) => st.savePosition);
  const removePosition = usePortfolio((st) => st.removePosition);
  const saveCash = usePortfolio((st) => st.saveCash);
  const removeCash = usePortfolio((st) => st.removeCash);
  const saveFx = usePortfolio((st) => st.saveFx);
  const removeFx = usePortfolio((st) => st.removeFx);
  const importPositions = usePortfolio((st) => st.importPositions);
  const replaceEquity = usePortfolio((st) => st.replaceEquity);

  const sessions = useJournal((st) => st.sessions);
  const trades = useJournal((st) => st.trades);
  const nt = useBridge((st) => st.nt);
  const base = useSettings((st) => st.settings.portfolio.baseCurrency);
  const userPlans = useSettings((st) => st.settings.userPlans);
  const updateSettings = useSettings((st) => st.update);

  const [now, setNow] = useState(() => Date.now());
  const [preset, setPreset] = useState<BilanPreset>('30j');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [windowDays, setWindowDays] = useState(120);
  const pocketNameRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<DraftPocket>(blankPocket);
  const [focusPocket, setFocusPocket] = useState('');
  const [posSymbol, setPosSymbol] = useState('');
  const [posQty, setPosQty] = useState('');
  const [posAvg, setPosAvg] = useState('');
  const [posLast, setPosLast] = useState('');
  const [posCcy, setPosCcy] = useState('');
  const [cashPocket, setCashPocket] = useState('');
  const [cashCcy, setCashCcy] = useState('USD');
  const [cashAmount, setCashAmount] = useState('');
  const [cashDate, setCashDate] = useState('');
  const [fxPair, setFxPair] = useState('EURUSD');
  const [fxRate, setFxRate] = useState('');
  const [baseDraft, setBaseDraft] = useState(base);

  useEffect(() => setBaseDraft(base), [base]);
  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const money = (amount: number | null | undefined, currency: string, sign = false) => formatMoney(amount, currency, discrete, sign);
  const toggleDiscrete = () => {
    const next = !discrete;
    try {
      sessionStorage.setItem(DISCRETE_KEY, next ? '1' : '0');
    } catch {
      /* session indisponible */
    }
    setDiscrete(next);
  };

  const active = useMemo(() => pockets.filter((p) => !p.archivedAt), [pockets]);
  const plans = useMemo(() => {
    const bundled = PROP_FIRMS.flatMap((f) => f.plans);
    const ids = new Set(bundled.map((p) => p.id));
    return [...bundled, ...userPlans.filter((p) => !ids.has(p.id))];
  }, [userPlans]);
  const accounts = useMemo(() => [...new Set(sessions.map((row) => row.account).filter((a): a is string => !!a && a.length > 0))].sort(), [sessions]);
  const snapshots = useMemo(() => {
    if (!nt || nt.link !== 'live') return [];
    return nt.accounts.map((a) => ({
      account: a.name,
      cashValue: a.cashValue,
      unrealizedPnl: a.unrealizedPnl,
      positions: a.positions,
      at: now,
    }));
  }, [nt, now]);

  const valuations = useMemo(
    () =>
      active.map((pocket) =>
        valuePocket(pocket, {
          now,
          sessions,
          trades,
          plan: pocket.planId ? findPlan(pocket.planId) : undefined,
          bridgeSnapshot: snapshots.find((snap) => snap.account === (pocket.account ?? '')) ?? null,
          positions,
          cash,
          fx,
          base,
        }),
      ),
    [active, now, sessions, trades, snapshots, positions, cash, fx, base],
  );
  const coeur = useMemo(() => consolidate(valuations, base, now), [valuations, base, now]);
  const points = useMemo(() => buildEquityPoints(pockets, { sessions, positions, cash, fx }), [pockets, sessions, positions, cash, fx]);
  const curve = useMemo(() => consolidateEquity(active, points, fx, base), [active, points, fx, base]);
  const risk = useMemo(() => riskFromEquity(curve.series), [curve]);
  const expo = useMemo(
    () => exposure({ pockets: active, positions, snapshots, fx, base, now, netValue: coeur.netValue }),
    [active, positions, snapshots, fx, base, now, coeur.netValue],
  );
  const bounds = useMemo(() => bilanBounds(preset, now, customFrom && customTo ? { from: customFrom, to: customTo } : undefined), [preset, now, customFrom, customTo]);
  const bounds30 = useMemo(() => bilanBounds('30j', now), [now]);
  const report = useMemo(() => bilan(bounds, { pockets: active, points, sessions, fx, base }), [bounds, active, points, sessions, fx, base]);
  const report30 = useMemo(() => bilan(bounds30, { pockets: active, points, sessions, fx, base }), [bounds30, active, points, sessions, fx, base]);
  const sample = useMemo(() => projectionSeries(curve.series, windowDays), [curve, windowDays]);

  const propDrawdowns = useMemo(() => {
    const out: number[] = [];
    for (const v of valuations) {
      if (v.kind !== 'propfirm' || !v.prop || v.equityBase == null) continue;
      const pocket = active.find((p) => p.id === v.pocketId);
      if (!pocket) continue;
      const converted = convertAmount(v.prop.toDrawdown, pocket.currency, base, fx);
      if (converted.ok) out.push(converted.value);
    }
    return out;
  }, [valuations, active, base, fx]);
  const ruin = useMemo(() => projectionRuin(propDrawdowns, risk.maxDrawdown), [propDrawdowns, risk.maxDrawdown]);

  useEffect(() => {
    if (!ready) return;
    void replaceEquity(points);
  }, [ready, points, replaceEquity]);

  const traditional = active.filter((p) => isTraditionalKind(p.kind));
  const selected = traditional.find((p) => p.id === focusPocket) ?? traditional[0];
  const pocketName = (id: string) => pockets.find((p) => p.id === id)?.name ?? id;

  const submitPocket = async () => {
    const existing = draft.id ? pockets.find((p) => p.id === draft.id) : undefined;
    const row: Pocket = {
      id: draft.id ?? '',
      name: draft.name,
      kind: draft.kind,
      currency: draft.currency,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    if (draft.account.trim()) row.account = draft.account;
    if (draft.kind === 'propfirm' && draft.planId) row.planId = draft.planId;
    if (draft.venue.trim()) row.venue = draft.venue;
    if (existing?.archivedAt) row.archivedAt = existing.archivedAt;
    const saved = await savePocket(row);
    if (saved) setDraft(blankPocket());
  };

  const submitPosition = async () => {
    if (!selected) return;
    const quantity = parseNum(posQty);
    const avgPrice = parseNum(posAvg);
    if (quantity == null || avgPrice == null) return;
    const last = posLast.trim() === '' ? undefined : parseNum(posLast);
    const row: Position = {
      id: '',
      pocketId: selected.id,
      symbol: posSymbol,
      quantity,
      avgPrice,
      currency: posCcy.trim() || selected.currency,
      openedAt: Date.now(),
    };
    if (last != null) {
      row.lastPrice = last;
      row.lastPriceAt = Date.now();
    }
    const saved = await savePosition(row);
    if (!saved) return;
    setPosSymbol('');
    setPosQty('');
    setPosAvg('');
    setPosLast('');
    setPosCcy('');
  };

  const patchPosition = async (line: Position, patch: Partial<Position>) => {
    const next: Position = { ...line, ...patch };
    if ('lastPrice' in patch && patch.lastPrice == null) {
      delete next.lastPrice;
      delete next.lastPriceAt;
    }
    if (patch.lastPrice != null) next.lastPriceAt = Date.now();
    await savePosition(next);
  };

  const submitCash = async () => {
    const amount = parseNum(cashAmount);
    const pocketId = cashPocket || active[0]?.id || '';
    if (amount == null || !pocketId || !cashDate) return;
    const at = Date.parse(`${cashDate}T16:00:00Z`);
    if (!Number.isFinite(at)) return;
    const saved = await saveCash({ id: '', pocketId, currency: cashCcy, amount, at });
    if (saved) setCashAmount('');
  };

  const submitFx = async () => {
    const rate = parseNum(fxRate);
    if (rate == null) return;
    await saveFx(fxPair, rate);
    setFxRate('');
  };

  const commitBase = async () => {
    const code = baseDraft.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      setBaseDraft(base);
      return;
    }
    if (code !== base) await updateSettings({ portfolio: { baseCurrency: code } });
  };

  const importCsv = async () => {
    if (!selected) return;
    const file = await openTextFile('.csv,.txt');
    if (!file) return;
    await importPositions(selected.id, file.text);
  };

  const lineSeries = useMemo(() => {
    const total: LineSeries = {
      id: 'consolidee',
      label: tr('Consolidée', 'Consolidated', 'Consolidada'),
      color: 'var(--gold)',
      area: true,
      width: 1.6,
      points: curve.series.map((p) => ({ x: Date.parse(`${p.date}T00:00:00Z`), y: p.equity, label: p.date })),
    };
    const rest: LineSeries[] = [];
    let color = 0;
    for (const pocket of active) {
      const mine = points.filter((p) => p.pocketId === pocket.id);
      const pts: LineSeries['points'] = [];
      let dropped = false;
      for (const p of mine) {
        const converted = convertAmount(p.equity, p.currency, base, fx);
        if (!converted.ok) {
          dropped = true;
          break;
        }
        pts.push({ x: Date.parse(`${p.date}T00:00:00Z`), y: converted.value, label: p.date });
      }
      if (dropped || pts.length === 0) continue;
      rest.push({
        id: pocket.id,
        label: pocket.name,
        color: PALETTE[color % PALETTE.length] ?? 'var(--text-0)',
        width: 1,
        points: pts,
      });
      color += 1;
    }
    return [total, ...rest];
  }, [curve, points, active, base, fx, locale]);

  const sources = useMemo(() => new Set(valuations.map((row) => row.mark)).size, [valuations]);

  return (
    <>
      <ModuleHeader
        tab="portefeuille"
        crumb={tr('SYNTHÈSE', 'SYNTHESIS', 'SÍNTESIS')}
        meta={`${active.length} ${tr('POCHES', 'POCKETS', 'BOLSAS')} · ${sources} ${tr('SOURCES', 'SOURCES', 'FUENTES')} · ${base}`}
        actions={
          <>
            <Button size="sm" variant="ghost" active={discrete} onClick={toggleDiscrete}>
              {discrete ? tr('Afficher les montants', 'Show amounts', 'Mostrar importes') : tr('Mode discret', 'Discrete mode', 'Modo discreto')}
            </Button>
            <Segmented
              value={preset}
              onChange={setPreset}
              options={[
                { value: '7j', label: '7J' },
                { value: '30j', label: '30J' },
                { value: 'trimestre', label: tr('TRIM.', 'QTR.', 'TRIM.') },
                { value: 'annee', label: tr('ANNÉE', 'YEAR', 'AÑO') },
              ]}
            />
            <Button
              variant="chamfer"
              onClick={() => {
                pocketNameRef.current?.scrollIntoView({ block: 'center' });
                pocketNameRef.current?.focus();
              }}
            >
              {tr('Nouvelle poche', 'New pocket', 'Nueva bolsa')}
            </Button>
          </>
        }
      />
      <ModuleContent>
        <div className={s.frame}>
          <Synthese
            discrete={discrete}
            base={base}
            now={now}
            preset={preset}
            coeur={coeur}
            valuations={valuations}
            pockets={pockets}
            points={points}
            fx={fx}
            snapshots={snapshots}
            expo={expo}
            report={report}
            report30={report30}
            series={curve.series}
            currentDrawdown={risk.currentDrawdown}
            sample={sample}
            money={money}
            ruinValue={roundMoney(ruin.ruinDrawdown)}
            ruinSource={ruin.source}
            windowDays={windowDays}
            onWindowDays={setWindowDays}
            onExportCsv={() => void saveTextFile(`bilan-${report.from}-${report.to}.csv`, bilanToCsv(report), 'text/csv')}
            customFrom={customFrom}
            customTo={customTo}
            onCustom={(from, to) => {
              setCustomFrom(from);
              setCustomTo(to);
              if (from && to) setPreset('personnalisee');
            }}
          />
          <Panel title={tr('Poches', 'Pockets', 'Bolsas')} sub={tr('création, édition, archivage', 'create, edit, archive', 'creación, edición, archivo')}>
            <div className={s.stack}>
              <div className={s.form}>
                <Field label={tr('Nom', 'Name', 'Nombre')}>
                  <input ref={pocketNameRef} aria-label={tr('Nom de la poche', 'Pocket name', 'Nombre de la bolsa')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </Field>
                <Field label={tr('Type', 'Type', 'Tipo')}>
                  <select aria-label={tr('Type de poche', 'Pocket type', 'Tipo de bolsa')} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as CreatablePocketKind })}>
                    {CREATABLE_POCKET_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabel(kind)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr('Devise', 'Currency', 'Divisa')}>
                  <input aria-label={tr('Devise de la poche', 'Pocket currency', 'Divisa de la bolsa')} value={draft.currency} maxLength={3} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} />
                </Field>
                {(draft.kind === 'propfirm' || draft.kind === 'futures') && (
                  <Field label={tr('Compte', 'Account', 'Cuenta')}>
                    <input aria-label={tr('Compte', 'Account', 'Cuenta')} list="ptf-accounts" value={draft.account} onChange={(e) => setDraft({ ...draft, account: e.target.value })} />
                    <datalist id="ptf-accounts">
                      {accounts.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </Field>
                )}
                {draft.kind === 'propfirm' && (
                  <Field label={tr('Plan', 'Plan', 'Plan')}>
                    <select aria-label={tr('Plan prop', 'Prop plan', 'Plan prop')} value={draft.planId} onChange={(e) => setDraft({ ...draft, planId: e.target.value })}>
                      <option value="">{tr('—', '—', '—')}</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {planOption(plan)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {isTraditionalKind(draft.kind) && (
                  <Field label={tr('Lieu', 'Venue', 'Lugar')}>
                    <input aria-label={tr('Lieu', 'Venue', 'Lugar')} value={draft.venue} onChange={(e) => setDraft({ ...draft, venue: e.target.value })} />
                  </Field>
                )}
              </div>
              <div className={s.actions}>
                <Button variant="default" onClick={() => void submitPocket()}>
                  {draft.id ? tr('Enregistrer la poche', 'Save pocket', 'Guardar la bolsa') : tr('Créer la poche', 'Create pocket', 'Crear la bolsa')}
                </Button>
                {draft.id && (
                  <Button variant="ghost" onClick={() => setDraft(blankPocket())}>
                    {tr('Annuler', 'Cancel', 'Cancelar')}
                  </Button>
                )}
              </div>
              {pockets.length === 0 ? (
                <Empty title={tr('Aucune poche', 'No pocket', 'Ninguna bolsa')} text={tr('Une poche prop, un compte futures, des titres ou des liquidités.', 'A prop pocket, a futures account, securities or cash.', 'Una bolsa prop, una cuenta de futuros, títulos o liquidez.')} />
              ) : (
                <div className={s.tableWrap}>
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th>{tr('Poche', 'Pocket', 'Bolsa')}</th>
                        <th>{tr('Type', 'Type', 'Tipo')}</th>
                        <th>{tr('Native', 'Native', 'Nativa')}</th>
                        <th>{base}</th>
                        <th>{tr('Marque', 'Mark', 'Marca')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {pockets.map((pocket) => {
                        const v = valuations.find((row) => row.pocketId === pocket.id);
                        return (
                          <tr key={pocket.id} className={pocket.archivedAt ? s.archived : undefined}>
                            <td>
                              {pocket.name}
                              {pocket.account ? ` · ${pocket.account}` : ''}
                              {pocket.venue ? ` · ${pocket.venue}` : ''}
                              {v?.prop?.alert ? <Tag tone="ember">{tr('alerte', 'alert', 'alerta')}</Tag> : null}
                            </td>
                            <td>{kindLabel(pocket.kind)}</td>
                            <td>{v ? money(v.nativeEquity, pocket.currency) : '—'}</td>
                            <td>{v?.equityBase == null ? (v?.reason ?? '—') : money(v.equityBase, base)}</td>
                            <td>
                              {v ? markLabel(v.mark) : '—'}
                              {v?.unrealized == null && v && isTraditionalKind(pocket.kind) ? ` · ${tr('au prix de revient', 'at cost', 'a precio de coste')}` : ''}
                              {v?.unrealized != null ? ` · ${tr('latent', 'open', 'latente')} ${money(v.unrealized, pocket.currency, true)}` : ''}
                              {v?.prop ? ` · ${tr('DD restant', 'DD left', 'DD restante')} ${money(v.prop.toDrawdown, pocket.currency)} · ${statusLabel(v.prop.status)}` : ''}
                            </td>
                            <td>
                              <div className={s.actions}>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    setDraft({
                                      id: pocket.id,
                                      name: pocket.name,
                                      kind: isCreatableKind(pocket.kind) ? pocket.kind : 'actions',
                                      currency: pocket.currency,
                                      account: pocket.account ?? '',
                                      planId: pocket.planId ?? '',
                                      venue: pocket.venue ?? '',
                                    })
                                  }
                                >
                                  {tr('Modifier', 'Edit', 'Editar')}
                                </Button>
                                {pocket.archivedAt ? (
                                  <Button size="sm" variant="ghost" onClick={() => void reactivatePocket(pocket.id)}>
                                    {tr('Réactiver', 'Restore', 'Reactivar')}
                                  </Button>
                                ) : (
                                  <Button size="sm" variant="ghost" onClick={() => void archivePocket(pocket.id)}>
                                    {tr('Archiver', 'Archive', 'Archivar')}
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Panel>

          <Panel title={tr('Positions', 'Positions', 'Posiciones')} sub={tr('symbol, quantity, avgPrice, currency, lastPrice', 'symbol, quantity, avgPrice, currency, lastPrice', 'symbol, quantity, avgPrice, currency, lastPrice')}>
            {traditional.length === 0 ? (
              <Empty title={tr('Aucune poche traditionnelle', 'No traditional pocket', 'Ninguna bolsa tradicional')} text={tr('Actions, indices, forex, commodités ou CFD.', 'Equities, indices, forex, commodities or CFD.', 'Acciones, índices, forex, materias primas o CFD.')} />
            ) : (
              <div className={s.stack}>
                <Field label={tr('Poche', 'Pocket', 'Bolsa')}>
                  <select aria-label={tr('Poche des positions', 'Position pocket', 'Bolsa de las posiciones')} value={selected?.id ?? ''} onChange={(e) => setFocusPocket(e.target.value)}>
                    {traditional.map((pocket) => (
                      <option key={pocket.id} value={pocket.id}>
                        {pocket.name} · {pocket.currency}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className={s.form}>
                  <Field label={tr('Symbole', 'Symbol', 'Símbolo')}>
                    <input aria-label={tr('Symbole', 'Symbol', 'Símbolo')} value={posSymbol} onChange={(e) => setPosSymbol(e.target.value)} />
                  </Field>
                  <Field label={tr('Quantité', 'Quantity', 'Cantidad')}>
                    <input aria-label={tr('Quantité', 'Quantity', 'Cantidad')} value={posQty} onChange={(e) => setPosQty(e.target.value)} />
                  </Field>
                  <Field label={tr('Prix de revient', 'Average price', 'Precio de coste')}>
                    <input aria-label={tr('Prix de revient', 'Average price', 'Precio de coste')} value={posAvg} onChange={(e) => setPosAvg(e.target.value)} />
                  </Field>
                  <Field label={tr('Dernier prix', 'Last price', 'Último precio')}>
                    <input aria-label={tr('Dernier prix', 'Last price', 'Último precio')} value={posLast} onChange={(e) => setPosLast(e.target.value)} placeholder={tr('optionnel', 'optional', 'opcional')} />
                  </Field>
                  <Field label={tr('Devise', 'Currency', 'Divisa')}>
                    <input aria-label={tr('Devise de la position', 'Position currency', 'Divisa de la posición')} value={posCcy} maxLength={3} placeholder={selected?.currency} onChange={(e) => setPosCcy(e.target.value.toUpperCase())} />
                  </Field>
                </div>
                <div className={s.actions}>
                  <Button variant="default" onClick={() => void submitPosition()}>
                    {tr('Ajouter la position', 'Add position', 'Añadir la posición')}
                  </Button>
                  <Button variant="ghost" onClick={() => void importCsv()}>
                    {tr('Importer un CSV', 'Import a CSV', 'Importar un CSV')}
                  </Button>
                </div>
                <div className={s.tableWrap}>
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th>{tr('Symbole', 'Symbol', 'Símbolo')}</th>
                        <th>{tr('Quantité', 'Quantity', 'Cantidad')}</th>
                        <th>{tr('Prix de revient', 'Average price', 'Precio de coste')}</th>
                        <th>{tr('Dernier prix', 'Last price', 'Último precio')}</th>
                        <th>{tr('Devise', 'Currency', 'Divisa')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {positions
                        .filter((line) => line.pocketId === selected?.id)
                        .map((line) => (
                          <tr key={line.id} className={line.closedAt ? s.archived : undefined}>
                            <td>
                              <CommitInput value={line.symbol} label={tr('Symbole', 'Symbol', 'Símbolo')} onCommit={(value) => void patchPosition(line, { symbol: value })} />
                            </td>
                            <td>
                              <CommitInput
                                value={String(line.quantity)}
                                label={tr('Quantité', 'Quantity', 'Cantidad')}
                                onCommit={(value) => {
                                  const n = parseNum(value);
                                  if (n != null) void patchPosition(line, { quantity: n });
                                }}
                              />
                            </td>
                            <td>
                              <CommitInput
                                value={String(line.avgPrice)}
                                label={tr('Prix de revient', 'Average price', 'Precio de coste')}
                                onCommit={(value) => {
                                  const n = parseNum(value);
                                  if (n != null) void patchPosition(line, { avgPrice: n });
                                }}
                              />
                            </td>
                            <td>
                              <CommitInput
                                value={line.lastPrice == null ? '' : String(line.lastPrice)}
                                label={tr('Dernier prix', 'Last price', 'Último precio')}
                                onCommit={(value) => {
                                  if (value.trim() === '') void patchPosition(line, { lastPrice: undefined });
                                  else {
                                    const n = parseNum(value);
                                    if (n != null) void patchPosition(line, { lastPrice: n });
                                  }
                                }}
                              />
                            </td>
                            <td>{line.currency}</td>
                            <td>
                              <div className={s.actions}>
                                {!line.closedAt && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      const realized = line.lastPrice != null ? line.quantity * (line.lastPrice - line.avgPrice) * positionMultiplier(line) : line.realizedPnl;
                                      void patchPosition(line, { closedAt: Date.now(), realizedPnl: realized });
                                    }}
                                  >
                                    {tr('Clôturer', 'Close', 'Cerrar')}
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => void removePosition(line.id)}>
                                  {tr('Retirer', 'Remove', 'Quitar')}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Panel>

          <Panel title={tr('Liquidités et taux', 'Cash and rates', 'Liquidez y tipos')} sub={tr('taux saisi, inverse déduit', 'entered rate, inverse implied', 'tipo introducido, inverso deducido')}>
            <div className={s.stack}>
              <div className={s.form}>
                <Field label={tr('Devise de base', 'Base currency', 'Divisa base')}>
                  <input aria-label={tr('Devise de base', 'Base currency', 'Divisa base')} value={baseDraft} maxLength={3} onChange={(e) => setBaseDraft(e.target.value.toUpperCase())} onBlur={() => void commitBase()} />
                </Field>
                <Field label={tr('Poche', 'Pocket', 'Bolsa')}>
                  <select aria-label={tr('Poche de liquidité', 'Cash pocket', 'Bolsa de liquidez')} value={cashPocket || active[0]?.id || ''} onChange={(e) => setCashPocket(e.target.value)}>
                    {active.map((pocket) => (
                      <option key={pocket.id} value={pocket.id}>
                        {pocket.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr('Montant', 'Amount', 'Importe')}>
                  <input aria-label={tr('Montant', 'Amount', 'Importe')} value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
                </Field>
                <Field label={tr('Devise', 'Currency', 'Divisa')}>
                  <input aria-label={tr('Devise de la liquidité', 'Cash currency', 'Divisa de la liquidez')} value={cashCcy} maxLength={3} onChange={(e) => setCashCcy(e.target.value.toUpperCase())} />
                </Field>
                <Field label={tr('Date', 'Date', 'Fecha')}>
                  <input aria-label={tr('Date de la liquidité', 'Cash date', 'Fecha de la liquidez')} type="date" value={cashDate} onChange={(e) => setCashDate(e.target.value)} />
                </Field>
              </div>
              <div className={s.actions}>
                <Button variant="default" onClick={() => void submitCash()}>
                  {tr('Ajouter la liquidité', 'Add cash', 'Añadir liquidez')}
                </Button>
              </div>
              {cash.length > 0 && (
                <div className={s.tableWrap}>
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th>{tr('Poche', 'Pocket', 'Bolsa')}</th>
                        <th>{tr('Montant', 'Amount', 'Importe')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {cash.map((row) => (
                        <tr key={row.id}>
                          <td>{pocketName(row.pocketId)}</td>
                          <td>{money(row.amount, row.currency)}</td>
                          <td>
                            <Button size="sm" variant="ghost" onClick={() => void removeCash(row.id)}>
                              {tr('Retirer', 'Remove', 'Quitar')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className={s.form}>
                <Field label={tr('Paire', 'Pair', 'Par')} hint="EURUSD">
                  <input aria-label={tr('Paire de devises', 'Currency pair', 'Par de divisas')} value={fxPair} maxLength={6} onChange={(e) => setFxPair(e.target.value.toUpperCase())} />
                </Field>
                <Field label={tr('Taux', 'Rate', 'Tipo')}>
                  <input aria-label={tr('Taux', 'Rate', 'Tipo')} value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
                </Field>
              </div>
              <div className={s.actions}>
                <Button variant="default" onClick={() => void submitFx()}>
                  {tr('Enregistrer le taux', 'Save rate', 'Guardar el tipo')}
                </Button>
              </div>
              {fx.length > 0 && (
                <div className={s.tableWrap}>
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th>{tr('Paire', 'Pair', 'Par')}</th>
                        <th>{tr('Taux', 'Rate', 'Tipo')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {fx.map((row) => (
                        <tr key={row.pair}>
                          <td>{row.pair}</td>
                          <td>{discrete ? '•••••' : fmtNum(row.rate, 6)}</td>
                          <td>
                            <Button size="sm" variant="ghost" onClick={() => void removeFx(row.pair)}>
                              {tr('Retirer', 'Remove', 'Quitar')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Panel>

          <Panel title={tr('Courbe', 'Curve', 'Curva')} sub={tr('consolidée et par poche, en devise de base', 'consolidated and by pocket, in the base currency', 'consolidada y por bolsa, en la divisa base')}>
            {curve.series.length === 0 ? (
              <Empty title={tr('Pas encore de courbe', 'No curve yet', 'Aún no hay curva')} text={tr('Une séance, une position ou une liquidité crée le premier point.', 'A session, a position or a cash balance creates the first point.', 'Una sesión, una posición o una liquidez crea el primer punto.')} />
            ) : (
              <LineArea series={lineSeries} height={260} legend formatY={(v) => money(v, base)} baseline={null} />
            )}
          </Panel>
        </div>
      </ModuleContent>
    </>
  );
}

function planOption(plan: PropPlan): string {
  return `${plan.firm} · ${plan.label}`;
}
