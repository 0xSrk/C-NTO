import { startTransition, useState } from 'react';
import { IconExport, IconImport, IconLink, IconPlus, IconSettings } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Segmented, Tag } from '@/design/primitives';
import { exportTradesCsv } from '@/engine/import';
import { openTextFile, saveTextFile } from '@/lib/desk';
import { exportVault, restoreVault } from '@/store/db';
import { useLinks } from '@/store/links';
import { plural } from '@/lib/format';
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
import s from './metrique.module.css';

type View = 'bord' | 'seances' | 'analyse' | 'prop' | 'mc';

export default function Metrique() {
  useI18n((s) => s.locale);
  const [view, setView] = useState<View>('bord');
  const [modal, setModal] = useState<null | 'import' | 'manuel' | 'reglages' | 'pont'>(null);
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const loadDemo = useJournal((j) => j.loadDemo);
  const reload = useJournal((j) => j.load);
  const toast = useUi((u) => u.toast);
  const confirmDialog = useUi((u) => u.confirm);
  const reloadSettings = useSettings((st) => st.load);
  const bridgeStatus = useBridge((b) => b.status);
  const bridgeLive = isBridgeLive(bridgeStatus);
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

  return (
    <>
      <ModuleHeader
        tab="metrique"
        actions={
          <>
            <Button variant="gold" onClick={() => setModal('pont')}>
              <IconLink size={14} /> {tr('Pont NinjaTrader', 'NinjaTrader bridge', 'Puente NinjaTrader')}
              <Tag tone={bridgeLive ? 'mint' : undefined} dot live={bridgeLive}>
                {bridgeLive ? tr('actif', 'active', 'activo') : tr('inactif', 'inactive', 'inactivo')}
              </Tag>
            </Button>
            <Button onClick={() => setModal('import')}>
              <IconImport size={14} /> {tr('Importer un CSV', 'Import a CSV', 'Importar un CSV')}
            </Button>
            <Button onClick={() => setModal('manuel')}>
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
          </>
        }
      />
      <ModuleContent>
        <div className={s.toolbar}>
          <Segmented
            value={view}
            onChange={(v) => startTransition(() => setView(v))}
            options={[
              { value: 'bord', label: tr('Tableau de bord', 'Dashboard', 'Tablero') },
              { value: 'seances', label: `${tr('Séances', 'Sessions', 'Sesiones')} · ${sessions.length}` },
              { value: 'analyse', label: tr('Analyse', 'Analysis', 'Análisis') },
              { value: 'prop', label: tr('Firme prop', 'Prop firm', 'Firma prop') },
              { value: 'mc', label: 'Monte-Carlo' },
            ]}
          />
          <span className="spacer" style={{ flex: 1 }} />
          {sessions.length === 0 && (
            <Button size="sm" variant="ghost" onClick={onDemo}>
              {tr('Charger un jeu de démonstration', 'Load a demo dataset', 'Cargar un juego de demostración')}
            </Button>
          )}
        </div>
        {view === 'bord' && <Dashboard onImport={() => setModal('import')} onDemo={onDemo} />}
        {view === 'seances' && <Sessions />}
        {view === 'analyse' && <Analyse />}
        {view === 'prop' && <PropFirmView />}
        {view === 'mc' && <MonteCarloView />}
      </ModuleContent>
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} />}
      {modal === 'pont' && <BridgeModal onClose={() => setModal(null)} onManualImport={() => setModal('import')} />}
      {modal === 'manuel' && <ManualSessionModal onClose={() => setModal(null)} />}
      {modal === 'reglages' && <SettingsModal onClose={() => setModal(null)} />}
    </>
  );
}
