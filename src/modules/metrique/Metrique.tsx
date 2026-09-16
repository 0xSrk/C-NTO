import { useState } from 'react';
import { IconExport, IconImport, IconLink, IconPlus, IconSettings } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Segmented, Tag } from '@/design/primitives';
import { exportTradesCsv } from '@/engine/import';
import { openTextFile, saveTextFile } from '@/lib/desk';
import { exportVault, restoreVault } from '@/store/db';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useBridge } from '@/store/bridge';
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
  const [view, setView] = useState<View>('bord');
  const [modal, setModal] = useState<null | 'import' | 'manuel' | 'reglages' | 'pont'>(null);
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const loadDemo = useJournal((j) => j.loadDemo);
  const reload = useJournal((j) => j.load);
  const toast = useUi((u) => u.toast);
  const reloadSettings = useSettings((st) => st.load);
  const bridgeStatus = useBridge((b) => b.status);
  const bridgeLive = !!bridgeStatus?.enabled && !!bridgeStatus.folder && !bridgeStatus.error;

  const onExportCsv = async () => {
    if (trades.length === 0) return toast('Aucun trade à exporter.', 'warn');
    await saveTextFile(`canto-trades-${new Date().toISOString().slice(0, 10)}.csv`, exportTradesCsv(trades), 'text/csv');
    toast(`${trades.length} trades exportés (CSV réimportable).`, 'ok');
  };
  const onExportVault = async () => {
    await saveTextFile(`canto-coffre-${new Date().toISOString().slice(0, 10)}.json`, await exportVault(), 'application/json');
    toast('Sauvegarde complète du coffre exportée.', 'ok');
  };
  const onRestore = async () => {
    const f = await openTextFile('.json');
    if (!f) return;
    try {
      const r = await restoreVault(f.text);
      await reload();
      await reloadSettings();
      toast(`Coffre restauré : ${r.sessions} séances, ${r.trades} trades, ${r.notes} notes.`, 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Restauration impossible.', 'error');
    }
  };
  const onDemo = async () => {
    const n = await loadDemo();
    toast(n > 0 ? `${n} séances de démonstration chargées.` : 'Capacité atteinte.', n > 0 ? 'ok' : 'warn');
  };

  return (
    <>
      <ModuleHeader
        tab="metrique"
        actions={
          <>
            <Button variant="gold" onClick={() => setModal('pont')}>
              <IconLink size={14} /> Pont NinjaTrader
              <Tag tone={bridgeLive ? 'mint' : undefined} dot live={bridgeLive}>
                {bridgeLive ? 'actif' : 'inactif'}
              </Tag>
            </Button>
            <Button onClick={() => setModal('import')}>
              <IconImport size={14} /> Importer un CSV
            </Button>
            <Button onClick={() => setModal('manuel')}>
              <IconPlus size={14} /> Séance manuelle
            </Button>
            <Button variant="ghost" onClick={onExportCsv} title="Exporter les trades en CSV">
              <IconExport size={14} /> CSV
            </Button>
            <Button variant="ghost" onClick={onExportVault} title="Sauvegarde complète (JSON)">
              <IconExport size={14} /> Coffre
            </Button>
            <Button variant="ghost" onClick={onRestore} title="Restaurer une sauvegarde JSON">
              Restaurer
            </Button>
            <Button variant="ghost" onClick={() => setModal('reglages')} aria-label="Réglages">
              <IconSettings size={14} />
            </Button>
          </>
        }
      />
      <ModuleContent>
        <div className={s.toolbar}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'bord', label: 'Tableau de bord' },
              { value: 'seances', label: `Séances · ${sessions.length}` },
              { value: 'analyse', label: 'Analyse' },
              { value: 'prop', label: 'Prop firm' },
              { value: 'mc', label: 'Monte Carlo' },
            ]}
          />
          <span className="spacer" style={{ flex: 1 }} />
          {sessions.length === 0 && (
            <Button size="sm" variant="ghost" onClick={onDemo}>
              Charger un jeu de démonstration
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
