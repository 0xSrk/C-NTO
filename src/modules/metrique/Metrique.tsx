import { startTransition, useEffect, useMemo, useState } from 'react';
import { IconExport, IconLink, IconPlus, IconSettings } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Segmented, Tag } from '@/design/primitives';
import { exportTradesCsv } from '@/engine/import';
import { findPlan } from '@/engine/propfirm';
import { desk, openTextFile, saveTextFile } from '@/lib/desk';
import { exportVault, restoreVault } from '@/store/db';
import { useLinks } from '@/store/links';
import { fmtInt, fmtUsd, plural, signClass } from '@/lib/format';
import { etDateKey } from '@/lib/time';
import { tr, useI18n } from '@/i18n';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useAgent } from '@/store/agent';
import { useBars } from '@/store/bars';
import { useBots } from '@/store/bots';
import { useMacro } from '@/store/macro';
import { isBridgeLive, useBridge } from '@/store/bridge';
import { useCalendar } from '@/store/calendar';
import { useCopier } from '@/store/copier';
import { useCrypto } from '@/store/crypto';
import { useNotes } from '@/store/notes';
import { useUi } from '@/store/ui';
import { Analyse } from './Analyse';
import { BridgeModal } from './BridgeModal';
import { Dashboard } from './Dashboard';
import { ImportModal } from './ImportModal';
import { ManualSessionModal } from './ManualSessionModal';
import { MonteCarloView } from './MonteCarloView';
import { PropFirmView } from './PropFirmView';
import { Sessions } from './Sessions';
import { SettingsModal } from './SettingsModal';
import d from './dashboard.module.css';
import { filterJournal, rangeFrom, scopeFor, type MetricRange } from './range';
import { liveSession } from './liveSession';
import { INCOMPLETE_BOOK, ordersPanel, watchOrders } from './liveOrders';
import type { OrderBookView } from '@/engine/execution/orderBook';

type View = 'bord' | 'seances' | 'analyse' | 'prop' | 'mc';

function shortDay(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

export default function Metrique() {
  useI18n((s) => s.locale);
  const [view, setView] = useState<View>('bord');
  const [range, setRange] = useState<MetricRange>('30j');
  const metricAccount = useUi((u) => u.metricAccount);
  const setMetricAccount = useUi((u) => u.setMetricAccount);
  const [modal, setModal] = useState<null | 'import' | 'manuel' | 'reglages' | 'pont'>(null);
  const [book, setBook] = useState<OrderBookView | null>(null);
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const loadDemo = useJournal((j) => j.loadDemo);
  const reload = useJournal((j) => j.load);
  const toast = useUi((u) => u.toast);
  const confirmDialog = useUi((u) => u.confirm);
  const reloadSettings = useSettings((st) => st.load);
  const bridgeStatus = useBridge((b) => b.status);
  const bridgeLive = isBridgeLive(bridgeStatus);
  const nt = useBridge((b) => b.nt);
  const traderRules = useSettings((st) => st.settings.traderRules);
  const planId = useSettings((st) => st.settings.planId);
  const planAccount = useSettings((st) => st.settings.planAccount);
  // Horloge de la séance en cours : « frais » vieillit même quand le pont se tait.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => watchOrders(desk?.ntbridge, setBook), []);
  const orders = ordersPanel(book, nt?.link ?? 'absent');
  // Compte suivi, comme `discipline_status` et l'alerte `daily_loss` : pas le filtre du journal.
  const head = liveSession({
    link: nt?.link ?? 'absent',
    now,
    accountsAt: nt?.accountsAt,
    accounts: nt?.accounts ?? [],
    account: planAccount,
    sessions,
    trades,
    rules: traderRules,
    plan: findPlan(planId),
  });
  const backupIncludeHeavy = useSettings((st) => st.settings.backupIncludeHeavy);

  const onExportCsv = async () => {
    if (trades.length === 0) return toast(tr('Aucun trade à exporter.', 'No trade to export.', 'Ningún trade que exportar.'), 'warn');
    const saved = await saveTextFile(`canto-trades-${new Date().toISOString().slice(0, 10)}.csv`, exportTradesCsv(trades), 'text/csv');
    if (saved)
      toast(
        `${plural(trades.length, tr('trade exporté', 'exported trade', 'trade exportado'), tr('trades exportés', 'exported trades', 'trades exportados'))} (${tr('CSV réimportable', 're-importable CSV', 'CSV reimportable')}).`,
        'ok',
      );
  };
  const onExportVault = async () => {
    const saved = await saveTextFile(`canto-coffre-${new Date().toISOString().slice(0, 10)}.json`, await exportVault({ includeHeavy: backupIncludeHeavy === true }), 'application/json');
    if (saved)
      toast(
        backupIncludeHeavy
          ? tr('Coffre exporté (barres et messages agent inclus, clé API exclue).', 'Vault exported (bars and agent messages included, API key excluded).', 'Caja exportada (barras y mensajes del agente incluidos, clave API excluida).')
          : tr('Sauvegarde du coffre exportée (clé API et blob chiffré exclus).', 'Vault backup exported (API key and encrypted blob excluded).', 'Copia de la caja exportada (clave API y blob cifrado excluidos).'),
        'ok',
      );
  };
  const onRestore = async () => {
    const f = await openTextFile('.json');
    if (!f) return;
    if (
      !(await confirmDialog(
        tr('Restaurer cette sauvegarde ?', 'Restore this backup?', '¿Restaurar esta copia?'),
        tr(
          'Les séances, trades, notes, calendrier, automates et comptes du copieur présents dans le fichier remplacent ceux du coffre. Une clé API en clair (coffre navigateur) est reprise puis chiffrée immédiatement sous le shell.',
          'Sessions, trades, notes, calendar, bots and copier accounts in the file replace those in the vault. A plaintext API key (browser vault) is taken then encrypted immediately under the shell.',
          'Las sesiones, trades, notas, calendario, autómatas y cuentas del copiador presentes en el archivo reemplazan las de la caja. Una clave API en claro (caja del navegador) se retoma y se cifra de inmediato bajo el shell.',
        ),
      ))
    )
      return;
    try {
      const r = await restoreVault(f.text);
      // `useBars.load()` relit la base à chaque appel (le garde-fou `loading` ne fait que dédupliquer les appels concurrents).
      await Promise.all([
        reload(),
        reloadSettings(),
        useNotes.getState().load(),
        useCalendar.getState().load(),
        useBots.getState().load(),
        useCopier.getState().load(),
        useMacro.getState().load(),
        useLinks.getState().load(),
        useAgent.getState().load(),
        useBars.getState().load(),
        useCrypto.getState().reloadSettings(),
      ]);
      const skippedNote = r.skipped > 0 ? ` ${plural(r.skipped, tr('ligne invalide ignorée', 'invalid row skipped', 'fila inválida ignorada'), tr('lignes invalides ignorées', 'invalid rows skipped', 'filas inválidas ignoradas'))}.` : '';
      toast(
        `${tr('Coffre restauré', 'Vault restored', 'Caja restaurada')} : ${plural(r.sessions, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))}, ${plural(r.trades, tr('trade', 'trade', 'trade'), tr('trades', 'trades', 'trades'))}, ${plural(r.notes, tr('note', 'note', 'nota'), tr('notes', 'notes', 'notas'))}.${r.apiKeyReencrypted ? ` ${tr('Clé API re-chiffrée.', 'API key re-encrypted.', 'Clave API cifrada de nuevo.')}` : ''}${skippedNote}`,
        r.skipped > 0 ? 'warn' : 'ok',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : tr('Restauration impossible.', 'Restore failed.', 'Restauración imposible.'), 'error');
    }
  };
  const onDemo = async () => {
    const n = await loadDemo();
    toast(
      n > 0
        ? tr(
            `${plural(n, 'séance')} de démonstration chargées.`,
            `${plural(n, 'session', 'sessions')} of demo data loaded.`,
            `${plural(n, 'sesión', 'sesiones')} de demostración cargadas.`,
          )
        : tr('Capacité atteinte.', 'Capacity reached.', 'Capacidad alcanzada.'),
      n > 0 ? 'ok' : 'warn',
    );
  };

  const accounts = useMemo(() => [...new Set(sessions.map((row) => row.account).filter((name): name is string => !!name))].sort(), [sessions]);
  useEffect(() => {
    if (metricAccount && !accounts.includes(metricAccount)) setMetricAccount(null);
  }, [accounts, metricAccount, setMetricAccount]);
  const asOf = etDateKey(Date.now());
  const filtered = useMemo(() => filterJournal(sessions, trades, range, asOf, metricAccount), [sessions, trades, range, asOf, metricAccount]);
  const ordered = useMemo(() => [...filtered.sessions].sort((a, b) => a.date.localeCompare(b.date)), [filtered.sessions]);
  // Tout l'historique du compte filtré : la marge d'un plan suivi ne dépend pas de la période.
  const history = useMemo(() => scopeFor('prop', sessions, trades, range, asOf, metricAccount), [sessions, trades, range, asOf, metricAccount]);
  const scope = useMemo(() => (view === 'analyse' || view === 'prop' || view === 'mc' ? scopeFor(view, sessions, trades, range, asOf, metricAccount) : null), [view, sessions, trades, range, asOf, metricAccount]);
  // Ce que l'onglet fait des filtres de l'en-tête.
  const scopeNote =
    view === 'seances'
      ? tr('Filtres propres à l’onglet', 'Tab’s own filters', 'Filtros propios de la pestaña')
      : view === 'prop'
        ? tr('Période ignorée : le plancher dépend de tout l’historique du compte', 'Range ignored: the floor depends on the account’s whole history', 'Período ignorado: el suelo depende de todo el historial de la cuenta')
        : view === 'mc' && !metricAccount
          ? tr('Compte obligatoire : choisissez-en un en haut', 'Account required: pick one above', 'Cuenta obligatoria: elija una arriba')
          : tr('Période et compte appliqués', 'Range and account applied', 'Período y cuenta aplicados');
  const span = ordered.length > 0 ? `${shortDay(ordered[0]?.date ?? '')} → ${shortDay(ordered[ordered.length - 1]?.date ?? '')}` : '—';
  const crumbs: Record<View, string> = {
    bord: tr('TABLEAU DE BORD', 'DASHBOARD', 'TABLERO'),
    seances: tr('SÉANCES', 'SESSIONS', 'SESIONES'),
    analyse: tr('ANALYSE', 'ANALYSIS', 'ANÁLISIS'),
    prop: tr('FIRME PROP', 'PROP FIRM', 'FIRMA PROP'),
    mc: 'MONTE-CARLO',
  };
  const views: { value: View; letter: string; label: string }[] = [
    { value: 'bord', letter: 'A', label: tr('Tableau de bord', 'Dashboard', 'Tablero') },
    { value: 'seances', letter: 'B', label: tr('Séances', 'Sessions', 'Sesiones') },
    { value: 'analyse', letter: 'C', label: tr('Analyse', 'Analysis', 'Análisis') },
    { value: 'prop', letter: 'D', label: tr('Firme prop', 'Prop firm', 'Firma prop') },
    { value: 'mc', letter: 'E', label: 'Monte-Carlo' },
  ];

  return (
    <>
      <ModuleHeader
        tab="metrique"
        crumb={crumbs[view]}
        cells={[
          { label: tr('Période', 'Range', 'Período'), value: span },
          { label: tr('Séances', 'Sessions', 'Sesiones'), value: fmtInt(ordered.length) },
        ]}
        actions={
          <>
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: '7j', label: '7J' },
                { value: '30j', label: '30J' },
                { value: '90j', label: '90J' },
                { value: 'tout', label: tr('TOUT', 'ALL', 'TODO') },
              ]}
            />
            <select className={d.account} aria-label={tr('Compte', 'Account', 'Cuenta')} value={metricAccount ?? ''} onChange={(event) => setMetricAccount(event.target.value || null)}>
              <option value="">{tr(`Tous les comptes · ${accounts.length}`, `All accounts · ${accounts.length}`, `Todas las cuentas · ${accounts.length}`)}</option>
              {accounts.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <Button variant="chamfer" onClick={() => setModal('import')}>
              {tr('Importer un CSV', 'Import a CSV', 'Importar un CSV')}
            </Button>
          </>
        }
      />
      <div className={d.subtabs} role="tablist">
        {views.map((item) => (
          <button key={item.value} type="button" role="tab" aria-selected={view === item.value} className={`${d.subtab} ${view === item.value ? d.on : ''}`} onClick={() => startTransition(() => setView(item.value))}>
            <i>{item.letter}</i>
            {item.label}
          </button>
        ))}
        <span className={d.scopeNote}>{scopeNote}</span>
      </div>
      <ModuleContent>
        {head && (
          <div className={d.live}>
            <span>
              {tr('Compte suivi', 'Tracked account', 'Cuenta seguida')}
              <b>{head.account ?? tr('tous les comptes', 'all accounts', 'todas las cuentas')}</b>
            </span>
            <span>
              {tr('Réalisé', 'Realized', 'Realizado')}
              <b className={signClass(head.realized)}>{fmtUsd(head.realized, { sign: true })}</b>
            </span>
            <span>
              {tr('Latent', 'Unrealized', 'Latente')}
              <b className={signClass(head.unrealized)}>{fmtUsd(head.unrealized, { sign: true })}</b>
            </span>
            <span>
              {tr('Solde', 'Balance', 'Saldo')}
              <b>{fmtUsd(head.balance)}</b>
            </span>
            <span>
              {tr('Positions', 'Positions', 'Posiciones')}
              <b>{head.positions.length ? head.positions.map((p) => `${p.quantity} ${p.instrument}`).join(' · ') : '—'}</b>
            </span>
            <span>
              {tr('Perte du jour', 'Day loss', 'Pérdida del día')}
              <b>
                {fmtUsd(head.loss)}
                {head.limit ? ` / ${fmtUsd(head.limit.amount)}` : ''}
                {head.limit ? ` · ${head.limit.source === 'plan' ? tr('plan', 'plan', 'plan') : tr('règle', 'rule', 'regla')}` : ''}
              </b>
            </span>
            <span>
              {tr('Trades', 'Trades', 'Trades')}
              <b>
                {head.maxTrades ? `${fmtInt(head.trades)} / ${fmtInt(head.maxTrades)}` : fmtInt(head.trades)}
                {' · '}
                {head.fresh ? tr('frais', 'fresh', 'reciente') : tr('périmé', 'stale', 'caducado')}
              </b>
            </span>
          </div>
        )}
        {orders && (
          <div className={d.liveOrders}>
            {orders.incomplete && <p>{tr(INCOMPLETE_BOOK[0], INCOMPLETE_BOOK[1], INCOMPLETE_BOOK[2])}</p>}
            {orders.rows.length === 0 ? (
              <p>{tr('Aucun ordre en cours.', 'No working order.', 'Ninguna orden en curso.')}</p>
            ) : (
              orders.rows.map((row, index) => (
                <p key={index}>
                  {row.side === 'buy' ? tr('achat', 'buy', 'compra') : tr('vente', 'sell', 'venta')} {fmtInt(row.qty)} {row.instrument} · {row.account} · {row.state}
                  {row.byAgent ? ` · ${tr('agent', 'agent', 'agente')}` : ''}
                  {row.unconfirmed ? ` · ${tr('non confirmé', 'unconfirmed', 'no confirmada')}` : ''}
                </p>
              ))
            )}
          </div>
        )}
        <div className={d.tools}>
          <Button variant="ghost" onClick={() => setModal('pont')}>
            <IconLink size={14} /> {tr('Pont NinjaTrader', 'NinjaTrader bridge', 'Puente NinjaTrader')}
            <Tag tone={bridgeLive ? 'mint' : undefined} dot live={bridgeLive}>
              {bridgeLive ? tr('actif', 'active', 'activo') : tr('inactif', 'inactive', 'inactivo')}
            </Tag>
          </Button>
          <Button variant="ghost" onClick={() => setModal('manuel')}>
            <IconPlus size={14} /> {tr('Séance manuelle', 'Manual session', 'Sesión manual')}
          </Button>
          <Button variant="ghost" onClick={onExportCsv} title={tr('Exporter les trades en CSV', 'Export trades as CSV', 'Exportar los trades en CSV')}>
            <IconExport size={14} /> CSV
          </Button>
          <Button variant="ghost" onClick={onExportVault} title={tr('Sauvegarde complète du coffre (JSON)', 'Full vault backup (JSON)', 'Copia completa de la caja (JSON)')}>
            <IconExport size={14} /> {tr('Coffre', 'Vault', 'Caja')}
          </Button>
          <Button variant="ghost" onClick={onRestore} title={tr('Restaurer une sauvegarde JSON', 'Restore a JSON backup', 'Restaurar una copia JSON')}>
            {tr('Restaurer', 'Restore', 'Restaurar')}
          </Button>
          <Button variant="ghost" onClick={() => setModal('reglages')} aria-label={tr('Réglages', 'Settings', 'Ajustes')} title={tr('Réglages du desk', 'Desk settings', 'Ajustes del desk')}>
            <IconSettings size={14} />
          </Button>
          {sessions.length === 0 && (
            <Button size="sm" variant="ghost" onClick={onDemo}>
              {tr('Charger un jeu de démonstration', 'Load a demo dataset', 'Cargar un juego de demostración')}
            </Button>
          )}
        </div>
        {view === 'bord' && (
          <Dashboard
            sessions={filtered.sessions}
            trades={filtered.trades}
            range={range}
            period={{ from: rangeFrom(range, asOf), to: asOf }}
            history={history}
            journalEmpty={sessions.length === 0}
            onImport={() => setModal('import')}
            onDemo={onDemo}
            onSessions={() => startTransition(() => setView('seances'))}
          />
        )}
        {view === 'seances' && <Sessions />}
        {view === 'analyse' && scope && <Analyse sessions={scope.sessions} trades={scope.trades} />}
        {view === 'prop' && scope && <PropFirmView scope={scope} />}
        {view === 'mc' && scope && <MonteCarloView scope={scope} />}
      </ModuleContent>
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} />}
      {modal === 'pont' && <BridgeModal onClose={() => setModal(null)} onManualImport={() => setModal('import')} />}
      {modal === 'manuel' && <ManualSessionModal onClose={() => setModal(null)} />}
      {modal === 'reglages' && <SettingsModal onClose={() => setModal(null)} />}
    </>
  );
}
