import { Modal } from '@/design/Modal';
import { Button, Stat, Tag, Toggle, cx } from '@/design/primitives';
import { isDesk } from '@/lib/desk';
import { useBridge } from '@/store/bridge';
import s from './metrique.module.css';

const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function BridgeModal({ onClose, onManualImport }: { onClose: () => void; onManualImport: () => void }) {
  const { status, log, busy, pickFolder, useDefaultFolder, setEnabled, rescan, openFolder } = useBridge();
  const live = !!status?.enabled && !!status.folder && !status.error;

  return (
    <Modal
      title="Pont NinjaTrader"
      sub="import automatique · dossier surveillé"
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button variant="ghost" onClick={onManualImport}>
            Import manuel d’un CSV
          </Button>
          <span style={{ flex: 1 }} />
          {isDesk && status?.folder && (
            <Button variant="ghost" onClick={() => rescan()} disabled={busy}>
              Relire le dossier
            </Button>
          )}
          <Button variant="gold" onClick={onClose}>
            Fermer
          </Button>
        </>
      }
    >
      <div className={s.rows}>
        {!isDesk ? (
          <div className={s.statusBanner}>
            <div>
              <h4>Mode navigateur</h4>
              <p>La surveillance de dossier nécessite le shell local (Electron). En attendant, importez les exports NinjaTrader (« Trades » ou « Executions ») via l’import manuel : les mêmes analyseurs sont utilisés.</p>
            </div>
          </div>
        ) : (
          <>
            <div className={cx(s.statusBanner, live && s.objectif, !!status?.error && s.echec)}>
              <div style={{ flex: 1 }}>
                <h4>{status?.error ? 'Pont en erreur' : live ? 'Pont actif' : status?.folder ? 'Pont en pause' : 'Pont non configuré'}</h4>
                <p>{status?.error ?? (status?.folder ? <span className="mono" style={{ fontSize: 11 }}>{status.folder}</span> : 'Choisissez le dossier dans lequel NinjaTrader et l’AddOn CΛNTO Bridge déposent leurs CSV.')}</p>
              </div>
              {status?.folder && <Toggle on={!!status.enabled} onChange={(v) => setEnabled(v)} label={status.enabled ? 'surveillance' : 'en pause'} />}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="gold" onClick={() => pickFolder()} disabled={busy}>
                Choisir un dossier…
              </Button>
              <Button onClick={() => useDefaultFolder()} disabled={busy} title="Documents\NinjaTrader 8\export\CANTO">
                Dossier par défaut NinjaTrader
              </Button>
              {status?.folder && (
                <Button variant="ghost" onClick={() => openFolder()}>
                  Ouvrir le dossier
                </Button>
              )}
            </div>

            {status?.folder && (
              <div className={s.miniStats}>
                <Stat small label="Fichiers CSV" value={String(status.files)} hint={`${status.processed} traité(s)`} tone="ice" />
                <Stat small label="En attente" value={String(status.pending)} hint="lecture / import" />
                <Stat small label="Dernier événement" value={status.lastEvent ? fmtTime.format(status.lastEvent.at) : '—'} hint={status.lastEvent ? `${status.lastEvent.kind} · ${status.lastEvent.file}` : 'aucun'} />
                <Stat small label="Dernier import" value={status.lastImport ? `${status.lastImport.trades} trade(s)` : '—'} hint={status.lastImport ? `${fmtTime.format(status.lastImport.at)} · ${status.lastImport.file}` : 'aucun'} tone={status.lastImport && status.lastImport.trades > 0 ? 'pos' : 'flat'} />
              </div>
            )}
          </>
        )}

        <div>
          <div className="micro" style={{ marginBottom: 6 }}>
            Mise en place côté NinjaTrader
          </div>
          <ol className={s.note} style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              <b>Temps réel</b> — copier <code>ninjatrader/CantoBridge.cs</code> dans <code>Documents\NinjaTrader 8\bin\Custom\AddOns\</code>, puis NinjaScript Editor › <em>Compile</em> (F5). L’AddOn écrit chaque exécution dans <code>Documents\NinjaTrader 8\export\CANTO\executions-AAAA-MM-JJ.csv</code> ; CΛNTO les apparie en trades (FIFO) et met le journal à jour à la volée.
            </li>
            <li>
              <b>Rattrapage</b> — Control Center › Trade Performance › Trades (ou onglet Executions) › clic droit › <em>Export</em> vers ce dossier : le fichier est importé dès qu’il est écrit.
            </li>
            <li>Les doublons sont écartés : relire un fichier ou exporter plusieurs fois la même période ne crée jamais de trade en double.</li>
          </ol>
        </div>

        {log.length > 0 && (
          <div>
            <div className="micro" style={{ marginBottom: 6 }}>
              Journal du pont
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflow: 'auto' }}>
              {log.map((l) => (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10, fontSize: 12, alignItems: 'center' }} className="mono">
                  <span className="dim">{fmtTime.format(l.at)}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.file} <span className="dim">· {l.kind} · {l.format}</span>
                    {l.warnings.length > 0 && <span className="gold"> · {l.warnings[0]}</span>}
                  </span>
                  {l.error ? <Tag tone="ember">erreur</Tag> : <Tag tone={l.trades > 0 ? 'mint' : undefined}>{l.trades} trade(s)</Tag>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
