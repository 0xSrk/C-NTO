import { useEffect, useState } from 'react';
import { IconTrash } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Field, Panel, Stat, Tag, Toggle, cx } from '@/design/primitives';
import { PROP_FIRMS } from '@/engine/propfirm';
import { tr, useI18n } from '@/i18n';
import { plural } from '@/lib/format';
import { APP_VERSION } from '@/lib/version';
import type { CopierAccount } from '@/store/db';
import { COPIER_CHANGELOG, replicatedQty, useCopier } from '@/store/copier';
import s from './copieur.module.css';

function bridgeSteps(): [string, string][] {
  return [
    ['hello', tr('AddOn → CΛNTO : version, comptes disponibles', 'AddOn → CΛNTO: version, available accounts', 'AddOn → CΛNTO: versión, cuentas disponibles')],
    ['accounts', tr('Instantané des comptes, soldes, positions', 'Snapshot of accounts, balances, positions', 'Instantánea de cuentas, saldos, posiciones')],
    ['execution', tr('Chaque exécution du compte maître, horodatée', 'Each master-account execution, timestamped', 'Cada ejecución de la cuenta maestra, con marca de tiempo')],
    ['heartbeat', tr('Battement toutes les 2 s, coupe-circuit si absent 6 s', 'Heartbeat every 2 s, circuit breaker if absent 6 s', 'Latido cada 2 s, cortocircuito si ausente 6 s')],
  ];
}

function changelogItem(it: string): string {
  const map: Record<string, [string, string, string]> = {
    'Langue du desk au lanceur : Français, English, Español — le choix est conservé': [
      'Langue du desk au lanceur : Français, English, Español — le choix est conservé',
      'Desk language on the launcher: Français, English, Español — the choice is kept',
      'Idioma del desk en el lanzador: Français, English, Español — la elección se conserva',
    ],
    'Desk natif macOS, Windows et Linux — installeurs DMG, NSIS et AppImage / deb': [
      'Desk natif macOS, Windows et Linux — installeurs DMG, NSIS et AppImage / deb',
      'Native desk for macOS, Windows and Linux — DMG, NSIS and AppImage / deb installers',
      'Desk nativo macOS, Windows y Linux — instaladores DMG, NSIS y AppImage / deb',
    ],
    'Pont fichier inclus sur chaque OS : le desk surveille l’export CANTO, l’AddOn NT8 reste compilé sous Windows': [
      'Pont fichier inclus sur chaque OS : le desk surveille l’export CANTO, l’AddOn NT8 reste compilé sous Windows',
      'File bridge included on every OS: the desk watches the CANTO export; the NT8 AddOn remains compiled under Windows',
      'Puente de archivos incluido en cada SO: el desk vigila la exportación CANTO; el AddOn NT8 sigue compilado en Windows',
    ],
    'Alignement desk v1.1.2 — badge CONCEPTION, kill switch, aucun ordre': [
      'Alignement desk v1.1.2 — badge CONCEPTION, kill switch, aucun ordre',
      'Desk v1.1.2 alignment — DESIGN badge, kill switch, no orders',
      'Alineación desk v1.1.2 — insignia CONCEPCIÓN, kill switch, sin órdenes',
    ],
    'Grammaire visuelle Lab — précision lithographique, LED unique': [
      'Grammaire visuelle Lab — précision lithographique, LED unique',
      'Lab visual grammar — lithographic precision, single LED',
      'Gramática visual Lab — precisión litográfica, LED única',
    ],
    'Modèle maître / suiveurs, sizing fixe · ratio · risque, NQ ↔ MNQ': [
      'Modèle maître / suiveurs, sizing fixe · ratio · risque, NQ ↔ MNQ',
      'Master / follower model, fixed · ratio · risk sizing, NQ ↔ MNQ',
      'Modelo maestro / seguidores, sizing fijo · ratio · riesgo, NQ ↔ MNQ',
    ],
    'Filtres : fenêtre horaire, blackout catalyseurs, marge plancher': [
      'Filtres : fenêtre horaire, blackout catalyseurs, marge plancher',
      'Filters: time window, catalyst blackout, floor buffer',
      'Filtros: ventana horaria, blackout de catalizadores, margen suelo',
    ],
    'Spécification du pont NinjaTrader (docs/PONT-NINJATRADER.md)': [
      'Spécification du pont NinjaTrader (docs/PONT-NINJATRADER.md)',
      'NinjaTrader bridge specification (docs/PONT-NINJATRADER.md)',
      'Especificación del puente NinjaTrader (docs/PONT-NINJATRADER.md)',
    ],
  };
  const t = map[it];
  return t ? tr(t[0], t[1], t[2]) : it;
}

function translateRepNote(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const capped = /^plafonné à (\d+)$/.exec(note);
  if (capped) {
    return tr(`plafonné à ${capped[1]}`, `capped at ${capped[1]}`, `limitado a ${capped[1]}`);
  }
  if (note === 'taille nulle') return tr('taille nulle', 'zero size', 'tamaño nulo');
  return note;
}

export default function Copieur() {
  useI18n((s) => s.locale);
  const { ready, accounts, config, load, addAccount, updateAccount, removeAccount, updateConfig } = useCopier();
  const [newName, setNewName] = useState('');
  const [newNt, setNewNt] = useState('');
  const [newRole, setNewRole] = useState<CopierAccount['role']>('suiveur');
  const [sampleQty, setSampleQty] = useState(2);
  const [sampleInstr, setSampleInstr] = useState<'NQ' | 'MNQ'>('NQ');
  const BRIDGE_STEPS = bridgeSteps();

  useEffect(() => {
    if (!ready) load();
  }, [ready, load]);

  const masters = accounts.filter((a) => a.role === 'maitre');
  const followers = accounts.filter((a) => a.role === 'suiveur');

  const add = async () => {
    if (!newName.trim()) return;
    await addAccount({ name: newName.trim(), ntAccount: newNt.trim() || newName.trim(), role: newRole, enabled: true, sizing: { mode: 'ratio', value: 1, maxContracts: 5 }, symbolMap: 'identique' });
    setNewName('');
    setNewNt('');
  };

  return (
    <>
      <ModuleHeader
        tab="copieur"
        actions={
          <>
            <Tag tone="amber" dot>
              {tr('CONCEPTION', 'DESIGN', 'CONCEPCIÓN')}
            </Tag>
            <Tag tone={config.enabled ? 'ember' : 'mint'} dot>
              {config.enabled ? tr('ARMÉ', 'ARMED', 'ARMADO') : tr('DÉSARMÉ', 'DISARMED', 'DESARMADO')}
            </Tag>
            <Button size="sm" variant="danger" onClick={() => updateConfig({ enabled: false })}>
              {tr('Couper', 'Cut', 'Cortar')}
            </Button>
          </>
        }
      />
      <ModuleContent>
        <div className={s.layout}>
          <div className={s.col}>
            <div className={s.board}>
              <Stat small label={tr('Pont NinjaTrader', 'NinjaTrader bridge', 'Puente NinjaTrader')} value={tr('Hors ligne', 'Offline', 'Fuera de línea')} hint={tr('pont local, non connecté', 'local bridge, not connected', 'puente local, no conectado')} />
              <Stat
                small
                label={tr('Maîtres · suiveurs', 'Masters · followers', 'Maestros · seguidores')}
                value={`${masters.length} · ${followers.length}`}
                hint={plural(followers.filter((f) => f.enabled).length, tr('suiveur actif', 'active follower', 'seguidor activo'), tr('suiveurs actifs', 'active followers', 'seguidores activos'))}
                tone="ice"
              />
              <Stat small label={tr('Budget latence', 'Latency budget', 'Presupuesto de latencia')} value={`${config.latencyBudgetMs} ms`} hint={tr('alerte au-delà', 'alert beyond', 'alerta más allá')} tone="gold" />
              <Stat small label={tr('Version', 'Version', 'Versión')} value={COPIER_CHANGELOG[0]?.version ?? APP_VERSION} hint={`${tr('canal', 'channel', 'canal')} ${config.channel}`} />
            </div>

            <div className={s.banner}>
              <b>{tr('Prototype.', 'Prototype.', 'Prototipo.')}</b>{' '}
              {tr(
                'La topologie, les règles de réplication et les filtres sont opérationnels et persistés. La réplication effective des ordres passe par le transport WebSocket de l’AddOn « CΛNTO Bridge », livré dans une prochaine itération : sans pont connecté, aucun ordre n’est envoyé.',
                'Topology, replication rules, and filters are operational and persisted. Live order replication goes through the WebSocket transport of the “CΛNTO Bridge” AddOn, shipping in a later iteration: with no connected bridge, no order is sent.',
                'La topología, las reglas de replicación y los filtros son operativos y persistidos. La replicación efectiva de órdenes pasa por el transporte WebSocket del AddOn « CΛNTO Bridge », entregado en una próxima iteración: sin puente conectado, no se envía ningún orden.',
              )}
            </div>

            <Panel title={tr('Topologie', 'Topology', 'Topología')} sub={tr('compte maître → comptes suiveurs', 'master account → follower accounts', 'cuenta maestra → cuentas seguidoras')}>
              <div className={s.topology}>
                <div>
                  <div className={s.colTitle}>{tr('Maître', 'Master', 'Maestro')}</div>
                  {masters.map((a) => (
                    <AccountCard key={a.id} acc={a} onChange={(p) => updateAccount(a.id, p)} onRemove={() => removeAccount(a.id)} />
                  ))}
                  {masters.length === 0 && (
                    <div className={s.hint}>{tr('Aucun compte maître : ajoutez le compte sur lequel vous tradez réellement.', 'No master account: add the account you actually trade on.', 'Ninguna cuenta maestra: añada la cuenta en la que opera realmente.')}</div>
                  )}
                </div>
                <div className={s.arrow}>→</div>
                <div>
                  <div className={s.colTitle}>{tr('Suiveurs', 'Followers', 'Seguidores')}</div>
                  {followers.map((a) => (
                    <AccountCard key={a.id} acc={a} onChange={(p) => updateAccount(a.id, p)} onRemove={() => removeAccount(a.id)} sample={{ qty: sampleQty, instrument: sampleInstr }} />
                  ))}
                  {followers.length === 0 && (
                    <div className={s.hint}>{tr('Aucun suiveur : ajoutez vos comptes d’évaluation / financés à répliquer.', 'No followers: add your evaluation / funded accounts to replicate.', 'Ningún seguidor: añada sus cuentas de evaluación / financiadas a replicar.')}</div>
                  )}
                </div>
              </div>
              <div className={s.addRow} style={{ marginTop: 12 }}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={tr('Nom (Apex 50K #2…)', 'Name (Apex 50K #2…)', 'Nombre (Apex 50K #2…)')} />
                <input value={newNt} onChange={(e) => setNewNt(e.target.value)} placeholder={tr('Compte NinjaTrader (APEX-1234-02)', 'NinjaTrader account (APEX-1234-02)', 'Cuenta NinjaTrader (APEX-1234-02)')} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={newRole} onChange={(e) => setNewRole(e.target.value as CopierAccount['role'])}>
                    <option value="maitre">{tr('Maître', 'Master', 'Maestro')}</option>
                    <option value="suiveur">{tr('Suiveur', 'Follower', 'Seguidor')}</option>
                  </select>
                  <Button variant="gold" onClick={add}>
                    {tr('Ajouter', 'Add', 'Añadir')}
                  </Button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }} className={s.hint}>
                {tr('Simulation : ordre maître de', 'Simulation: master order of', 'Simulación: orden maestra de')}
                <input type="number" min={1} value={sampleQty} onChange={(e) => setSampleQty(Math.max(1, Number(e.target.value) || 1))} style={{ width: 60, height: 24 }} />
                <select value={sampleInstr} onChange={(e) => setSampleInstr(e.target.value as 'NQ' | 'MNQ')} style={{ height: 24 }}>
                  <option value="NQ">NQ</option>
                  <option value="MNQ">MNQ</option>
                </select>
                {tr('→ la taille répliquée s’affiche sous chaque suiveur.', '→ replicated size shows under each follower.', '→ el tamaño replicado se muestra bajo cada seguidor.')}
              </div>
            </Panel>
          </div>

          <div className={s.col}>
            <Panel title={tr('Filtres de réplication', 'Replication filters', 'Filtros de replicación')} sub={tr('appliqués avant tout envoi', 'applied before any send', 'aplicados antes de cualquier envío')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className={s.formGrid}>
                  <Field label={tr('Fenêtre · début (locale)', 'Window · start (local)', 'Ventana · inicio (local)')}>
                    <input type="time" value={config.windowStart} onChange={(e) => updateConfig({ windowStart: e.target.value })} />
                  </Field>
                  <Field label={tr('Fenêtre · fin (locale)', 'Window · end (local)', 'Ventana · fin (local)')}>
                    <input type="time" value={config.windowEnd} onChange={(e) => updateConfig({ windowEnd: e.target.value })} />
                  </Field>
                  <Field label={tr('Budget latence (ms)', 'Latency budget (ms)', 'Presupuesto de latencia (ms)')}>
                    <input type="number" min={50} step={50} value={config.latencyBudgetMs} onChange={(e) => updateConfig({ latencyBudgetMs: Number(e.target.value) || 250 })} />
                  </Field>
                  <Field label={tr('Marge plancher minimale', 'Minimum floor buffer', 'Margen suelo mínimo')} hint={tr('fraction du DD max du plan suiveur', 'fraction of the follower plan max DD', 'fracción del DD máx. del plan seguidor')}>
                    <input type="number" min={0} max={1} step={0.05} value={config.followerBufferFloor} onChange={(e) => updateConfig({ followerBufferFloor: Number(e.target.value) || 0 })} />
                  </Field>
                </div>
                <Toggle on={config.copyStops} onChange={(v) => updateConfig({ copyStops: v })} label={tr('Répliquer les stops', 'Replicate stops', 'Replicar los stops')} />
                <Toggle on={config.copyTargets} onChange={(v) => updateConfig({ copyTargets: v })} label={tr('Répliquer les objectifs', 'Replicate targets', 'Replicar los objetivos')} />
                <Toggle
                  on={config.newsBlackout}
                  onChange={(v) => updateConfig({ newsBlackout: v })}
                  label={tr('Blackout ±15 min autour des catalyseurs majeurs', 'Blackout ±15 min around major catalysts', 'Blackout ±15 min alrededor de catalizadores mayores')}
                />
              </div>
            </Panel>

            <Panel title={tr('Pont NinjaTrader', 'NinjaTrader bridge', 'Puente NinjaTrader')} sub={tr('séquence du protocole', 'protocol sequence', 'secuencia del protocolo')}>
              {BRIDGE_STEPS.map(([k, v]) => (
                <div key={k} className={s.bridgeRow}>
                  <span>{v}</span>
                  <b>{k}</b>
                </div>
              ))}
              <p className={s.hint} style={{ marginTop: 8 }}>
                {tr(
                  'Le pont est un AddOn NinjaScript qui se connecte en WebSocket au shell CΛNTO (127.0.0.1). Il ne quitte jamais la machine : aucune donnée de compte ne transite par un serveur tiers.',
                  'The bridge is a NinjaScript AddOn that connects over WebSocket to the CΛNTO shell (127.0.0.1). It never leaves the machine: no account data goes through a third-party server.',
                  'El puente es un AddOn NinjaScript que se conecta por WebSocket al shell CΛNTO (127.0.0.1). Nunca sale de la máquina: ningún dato de cuenta pasa por un servidor de terceros.',
                )}
              </p>
            </Panel>

            <Panel
              title={tr('Mises à jour', 'Updates', 'Actualizaciones')}
              sub={tr('journal des versions', 'version log', 'diario de versiones')}
              actions={
                <select value={config.channel} onChange={(e) => updateConfig({ channel: e.target.value as 'stable' | 'beta' })} style={{ height: 28, fontSize: 11, padding: '0 6px' }}>
                  <option value="stable">{tr('canal stable', 'stable channel', 'canal estable')}</option>
                  <option value="beta">{tr('canal beta', 'beta channel', 'canal beta')}</option>
                </select>
              }
            >
              {COPIER_CHANGELOG.map((c) => (
                <div key={c.version} className={s.change}>
                  <b>
                    v{c.version} · {c.date}
                  </b>
                  <ul>
                    {c.items.map((it) => (
                      <li key={it}>{changelogItem(it)}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className={s.hint} style={{ marginTop: 8 }}>
                {tr(
                  'Le copieur suivra un cycle de publication régulier ; le canal beta reçoit les règles de réplication en avance de phase.',
                  'The copier will follow a regular release cycle; the beta channel gets replication rules ahead of schedule.',
                  'El copiador seguirá un ciclo de publicación regular; el canal beta recibe las reglas de replicación por adelantado.',
                )}
              </p>
            </Panel>
          </div>
        </div>
      </ModuleContent>
    </>
  );
}

function AccountCard({ acc, onChange, onRemove, sample }: { acc: CopierAccount; onChange: (p: Partial<CopierAccount>) => void; onRemove: () => void; sample?: { qty: number; instrument: 'NQ' | 'MNQ' } }) {
  useI18n((s) => s.locale);
  const rep = sample ? replicatedQty(sample, acc) : null;
  const note = translateRepNote(rep?.note);
  return (
    <div className={cx(s.acc, acc.role === 'maitre' && s.master)}>
      <div className={s.accHead}>
        <Toggle on={acc.enabled} onChange={(v) => onChange({ enabled: v })} disabled />
        <b>{acc.name}</b>
        <Tag tone={acc.role === 'maitre' ? 'gold' : 'ice'}>{acc.role === 'maitre' ? tr('maître', 'master', 'maestro') : tr('suiveur', 'follower', 'seguidor')}</Tag>
        <button onClick={onRemove} aria-label={tr('Retirer', 'Remove', 'Quitar')}>
          <IconTrash size={12} />
        </button>
      </div>
      <div className={s.accGrid}>
        <Field label={tr('Compte NT', 'NT account', 'Cuenta NT')}>
          <input value={acc.ntAccount} onChange={(e) => onChange({ ntAccount: e.target.value })} />
        </Field>
        <Field label={tr('Plan prop', 'Prop plan', 'Plan prop')}>
          <select value={acc.planId ?? ''} onChange={(e) => onChange({ planId: e.target.value || undefined, firm: PROP_FIRMS.find((f) => f.plans.some((p) => p.id === e.target.value))?.name })}>
            <option value="">—</option>
            {PROP_FIRMS.map((f) => (
              <optgroup key={f.id} label={f.name}>
                {f.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {acc.role === 'suiveur' && (
          <>
            <Field label={tr('Dimensionnement', 'Sizing', 'Dimensionamiento')}>
              <select value={acc.sizing.mode} onChange={(e) => onChange({ sizing: { ...acc.sizing, mode: e.target.value as CopierAccount['sizing']['mode'] } })}>
                <option value="ratio">{tr('Ratio du maître', 'Master ratio', 'Ratio del maestro')}</option>
                <option value="fixe">{tr('Taille fixe', 'Fixed size', 'Tamaño fijo')}</option>
                <option value="risque">{tr('Contrats par risque', 'Contracts by risk', 'Contratos por riesgo')}</option>
              </select>
            </Field>
            <Field label={acc.sizing.mode === 'ratio' ? tr('Multiplicateur', 'Multiplier', 'Multiplicador') : tr('Contrats', 'Contracts', 'Contratos')}>
              <input type="number" min={0} step={acc.sizing.mode === 'ratio' ? 0.1 : 1} value={acc.sizing.value} onChange={(e) => onChange({ sizing: { ...acc.sizing, value: Number(e.target.value) || 0 } })} />
            </Field>
            <Field label={tr('Plafond contrats', 'Contract cap', 'Tope de contratos')}>
              <input type="number" min={1} value={acc.sizing.maxContracts} onChange={(e) => onChange({ sizing: { ...acc.sizing, maxContracts: Math.max(1, Number(e.target.value) || 1) } })} />
            </Field>
            <Field label={tr('Instrument', 'Instrument', 'Instrumento')}>
              <select value={acc.symbolMap} onChange={(e) => onChange({ symbolMap: e.target.value as CopierAccount['symbolMap'] })}>
                <option value="identique">{tr('Identique au maître', 'Same as master', 'Idéntico al maestro')}</option>
                <option value="NQ→MNQ">NQ → MNQ (×10)</option>
                <option value="MNQ→NQ">MNQ → NQ (÷10)</option>
              </select>
            </Field>
          </>
        )}
      </div>
      {rep && sample && (
        <div className={s.preview}>
          {sample.qty} {sample.instrument} {tr('maître', 'master', 'maestro')} →{' '}
          <b>
            {rep.qty} {rep.instrument}
          </b>
          {note ? ` · ${note}` : ''}
        </div>
      )}
    </div>
  );
}
