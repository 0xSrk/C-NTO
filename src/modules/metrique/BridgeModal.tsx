import { useMemo } from 'react';
import { Modal } from '@/design/Modal';
import { Button, Stat, Tag, Toggle, cx } from '@/design/primitives';
import { intlTag, tr, useI18n } from '@/i18n';
import { isDesk } from '@/lib/desk';
import { useBridge } from '@/store/bridge';
import s from './metrique.module.css';

export function BridgeModal({ onClose, onManualImport }: { onClose: () => void; onManualImport: () => void }) {
  const locale = useI18n((s) => s.locale);
  const { status, log, busy, pickFolder, useDefaultFolder, setEnabled, rescan, openFolder } = useBridge();
  const live = !!status?.enabled && !!status.folder && !status.error;
  const fmtTime = useMemo(() => new Intl.DateTimeFormat(intlTag(locale), { hour: '2-digit', minute: '2-digit', second: '2-digit' }), [locale]);

  return (
    <Modal
      title={tr('Pont NinjaTrader', 'NinjaTrader bridge', 'Puente NinjaTrader')}
      sub={tr('import automatique · dossier surveillé', 'automatic import · watched folder', 'importación automática · carpeta vigilada')}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button variant="ghost" onClick={onManualImport}>
            {tr('Import manuel d’un CSV', 'Manual CSV import', 'Importación manual de un CSV')}
          </Button>
          <span style={{ flex: 1 }} />
          {isDesk && status?.folder && (
            <Button variant="ghost" onClick={() => rescan()} disabled={busy}>
              {tr('Relire le dossier', 'Rescan folder', 'Releer la carpeta')}
            </Button>
          )}
          <Button variant="gold" onClick={onClose}>
            {tr('Fermer', 'Close', 'Cerrar')}
          </Button>
        </>
      }
    >
      <div className={s.rows}>
        {!isDesk ? (
          <div className={s.statusBanner}>
            <div>
              <h4>{tr('Mode navigateur', 'Browser mode', 'Modo navegador')}</h4>
              <p>
                {tr(
                  'La surveillance de dossier nécessite le shell local (Electron). En attendant, importez les exports NinjaTrader (« Trades » ou « Executions ») via l’import manuel : les mêmes analyseurs sont utilisés.',
                  'Folder watching requires the local shell (Electron). Meanwhile, import NinjaTrader exports (“Trades” or “Executions”) via manual import: the same parsers are used.',
                  'La vigilancia de carpetas requiere el shell local (Electron). Mientras tanto, importe las exportaciones NinjaTrader (« Trades » o « Executions ») vía importación manual: se usan los mismos analizadores.',
                )}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className={cx(s.statusBanner, live && s.objectif, !!status?.error && s.echec)}>
              <div style={{ flex: 1 }}>
                <h4>
                  {status?.error
                    ? tr('Pont en erreur', 'Bridge error', 'Puente en error')
                    : live
                      ? tr('Pont actif', 'Bridge active', 'Puente activo')
                      : status?.folder
                        ? tr('Pont en pause', 'Bridge paused', 'Puente en pausa')
                        : tr('Pont non configuré', 'Bridge not configured', 'Puente no configurado')}
                </h4>
                <p>
                  {status?.error ??
                    (status?.folder ? (
                      <span className="mono" style={{ fontSize: 11 }}>
                        {status.folder}
                      </span>
                    ) : (
                      tr(
                        'Choisissez le dossier dans lequel NinjaTrader et l’AddOn CΛNTO Bridge déposent leurs CSV.',
                        'Choose the folder where NinjaTrader and the CΛNTO Bridge AddOn drop their CSVs.',
                        'Elija la carpeta en la que NinjaTrader y el AddOn CΛNTO Bridge depositan sus CSV.',
                      )
                    ))}
                </p>
              </div>
              {status?.folder && (
                <Toggle on={!!status.enabled} onChange={(v) => setEnabled(v)} label={status.enabled ? tr('surveillance', 'watching', 'vigilancia') : tr('en pause', 'paused', 'en pausa')} />
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="gold" onClick={() => pickFolder()} disabled={busy}>
                {tr('Choisir un dossier…', 'Choose a folder…', 'Elegir una carpeta…')}
              </Button>
              <Button onClick={() => useDefaultFolder()} disabled={busy} title="Documents/NinjaTrader 8/export/CANTO">
                {tr('Dossier par défaut NinjaTrader', 'Default NinjaTrader folder', 'Carpeta por defecto NinjaTrader')}
              </Button>
              {status?.folder && (
                <Button variant="ghost" onClick={() => openFolder()}>
                  {tr('Ouvrir le dossier', 'Open folder', 'Abrir la carpeta')}
                </Button>
              )}
            </div>

            {status?.folder && (
              <div className={s.miniStats}>
                <Stat small label={tr('Fichiers CSV', 'CSV files', 'Archivos CSV')} value={String(status.files)} hint={tr(`${status.processed} traité(s)`, `${status.processed} processed`, `${status.processed} procesado(s)`)} tone="ice" />
                <Stat small label={tr('En attente', 'Pending', 'En espera')} value={String(status.pending)} hint={tr('lecture / import', 'read / import', 'lectura / importación')} />
                <Stat small label={tr('Dernier événement', 'Last event', 'Último evento')} value={status.lastEvent ? fmtTime.format(status.lastEvent.at) : '—'} hint={status.lastEvent ? `${status.lastEvent.kind} · ${status.lastEvent.file}` : tr('aucun', 'none', 'ninguno')} />
                <Stat
                  small
                  label={tr('Dernier import', 'Last import', 'Última importación')}
                  value={status.lastImport ? tr(`${status.lastImport.trades} trade(s)`, `${status.lastImport.trades} trade(s)`, `${status.lastImport.trades} trade(s)`) : '—'}
                  hint={status.lastImport ? `${fmtTime.format(status.lastImport.at)} · ${status.lastImport.file}` : tr('aucun', 'none', 'ninguno')}
                  tone={status.lastImport && status.lastImport.trades > 0 ? 'pos' : 'flat'}
                />
              </div>
            )}
          </>
        )}

        <div>
          <div className="micro" style={{ marginBottom: 6 }}>
            {tr('Mise en place côté NinjaTrader', 'Setup on the NinjaTrader side', 'Configuración del lado NinjaTrader')}
          </div>
          <ol className={s.note} style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              <b>{tr('Temps réel', 'Real time', 'Tiempo real')}</b>
              {' — '}
              {tr(
                'sur la machine Windows qui fait tourner NinjaTrader 8, copier',
                'on the Windows machine running NinjaTrader 8, copy',
                'en la máquina Windows que ejecuta NinjaTrader 8, copiar',
              )}{' '}
              <code>ninjatrader/CantoBridge.cs</code>{' '}
              {tr('dans', 'into', 'en')} <code>Documents/NinjaTrader 8/bin/Custom/AddOns/</code>
              {tr(
                ', puis NinjaScript Editor ›',
                ', then NinjaScript Editor ›',
                ', luego NinjaScript Editor ›',
              )}{' '}
              <em>Compile</em> (F5).{' '}
              {tr(
                'L’AddOn écrit chaque exécution dans',
                'The AddOn writes each execution to',
                'El AddOn escribe cada ejecución en',
              )}{' '}
              <code>Documents/NinjaTrader 8/export/CANTO/executions-AAAA-MM-JJ.csv</code>.{' '}
              {tr(
                'Le desk CΛNTO — Windows, macOS ou Linux — surveille ce dossier (en local, ou un partage / une synchro) et apparie les exécutions en trades (FIFO).',
                'The CΛNTO desk — Windows, macOS or Linux — watches this folder (locally, or a share / sync) and matches executions into trades (FIFO).',
                'El desk CΛNTO — Windows, macOS o Linux — vigila esta carpeta (en local, o un recurso compartido / sincronización) y empareja las ejecuciones en trades (FIFO).',
              )}
            </li>
            <li>
              <b>{tr('Rattrapage', 'Catch-up', 'Puesta al día')}</b>
              {' — '}
              {tr(
                'Control Center › Trade Performance › Trades (ou onglet Executions) › clic droit ›',
                'Control Center › Trade Performance › Trades (or Executions tab) › right-click ›',
                'Control Center › Trade Performance › Trades (o pestaña Executions) › clic derecho ›',
              )}{' '}
              <em>Export</em>{' '}
              {tr(
                'vers ce dossier : le fichier est importé dès qu’il est écrit.',
                'to this folder: the file is imported as soon as it is written.',
                'hacia esta carpeta: el archivo se importa en cuanto se escribe.',
              )}
            </li>
            <li>
              {tr(
                'Les doublons sont écartés : relire un fichier ou exporter plusieurs fois la même période ne crée jamais de trade en double.',
                'Duplicates are dropped: rescanning a file or exporting the same period several times never creates a duplicate trade.',
                'Los duplicados se descartan: releer un archivo o exportar varias veces el mismo periodo nunca crea un trade duplicado.',
              )}
            </li>
          </ol>
        </div>

        {log.length > 0 && (
          <div>
            <div className="micro" style={{ marginBottom: 6 }}>
              {tr('Journal du pont', 'Bridge journal', 'Diario del puente')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflow: 'auto' }}>
              {log.map((l) => (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10, fontSize: 12, alignItems: 'center' }} className="mono">
                  <span className="dim">{fmtTime.format(l.at)}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.file}{' '}
                    <span className="dim">
                      · {l.kind} · {l.format}
                    </span>
                    {l.warnings.length > 0 && <span className="gold"> · {l.warnings[0]}</span>}
                  </span>
                  {l.error ? <Tag tone="ember">{tr('erreur', 'error', 'error')}</Tag> : <Tag tone={l.trades > 0 ? 'mint' : undefined}>{l.trades} trade(s)</Tag>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
