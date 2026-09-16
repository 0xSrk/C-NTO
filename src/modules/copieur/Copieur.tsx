import { useEffect, useState } from 'react';
import { IconTrash } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Field, Panel, Stat, Tag, Toggle, cx } from '@/design/primitives';
import { PROP_FIRMS } from '@/engine/propfirm';
import { plural } from '@/lib/format';
import type { CopierAccount } from '@/store/db';
import { COPIER_CHANGELOG, replicatedQty, useCopier } from '@/store/copier';
import s from './copieur.module.css';

const BRIDGE_STEPS = [
  ['hello', 'AddOn → CΛNTO : version, comptes disponibles'],
  ['accounts', 'Instantané des comptes, soldes, positions'],
  ['execution', 'Chaque exécution du compte maître, horodatée'],
  ['copy.order', 'CΛNTO → AddOn : ordre répliqué pour chaque suiveur'],
  ['copy.ack', 'Accusé avec latence mesurée et identifiant NinjaTrader'],
  ['heartbeat', 'Battement toutes les 2 s, coupe-circuit si absent 6 s'],
];

export default function Copieur() {
  const { ready, accounts, config, load, addAccount, updateAccount, removeAccount, updateConfig } = useCopier();
  const [newName, setNewName] = useState('');
  const [newNt, setNewNt] = useState('');
  const [newRole, setNewRole] = useState<CopierAccount['role']>('suiveur');
  const [sampleQty, setSampleQty] = useState(2);
  const [sampleInstr, setSampleInstr] = useState<'NQ' | 'MNQ'>('NQ');

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
            <Tag tone={config.enabled ? 'mint' : undefined} dot live={config.enabled}>
              {config.enabled ? 'armé · en attente du pont' : 'désarmé'}
            </Tag>
            <Toggle on={config.enabled} onChange={(v) => updateConfig({ enabled: v })} label="Armer le copieur" />
          </>
        }
      />
      <ModuleContent>
        <div className={s.layout}>
          <div className={s.col}>
            <div className={s.board}>
              <Stat small label="Pont NinjaTrader" value="Hors ligne" hint="transport WebSocket non connecté" />
              <Stat small label="Maîtres · suiveurs" value={`${masters.length} · ${followers.length}`} hint={plural(followers.filter((f) => f.enabled).length, 'suiveur actif', 'suiveurs actifs')} tone="ice" />
              <Stat small label="Budget latence" value={`${config.latencyBudgetMs} ms`} hint="alerte au-delà" tone="gold" />
              <Stat small label="Version" value={COPIER_CHANGELOG[0].version} hint={`canal ${config.channel}`} />
            </div>

            <div className={s.banner}>
              <b>Prototype.</b> La topologie, les règles de réplication et les filtres sont opérationnels et persistés. La réplication effective des ordres passe par le transport WebSocket de l’AddOn « CΛNTO Bridge », livré dans une prochaine itération : sans pont connecté, aucun ordre n’est envoyé.
            </div>

            <Panel title="Topologie" sub="compte maître → comptes suiveurs">
              <div className={s.topology}>
                <div>
                  <div className={s.colTitle}>Maître</div>
                  {masters.map((a) => (
                    <AccountCard key={a.id} acc={a} onChange={(p) => updateAccount(a.id, p)} onRemove={() => removeAccount(a.id)} />
                  ))}
                  {masters.length === 0 && <div className={s.hint}>Aucun compte maître : ajoutez le compte sur lequel vous tradez réellement.</div>}
                </div>
                <div className={s.arrow}>→</div>
                <div>
                  <div className={s.colTitle}>Suiveurs</div>
                  {followers.map((a) => (
                    <AccountCard key={a.id} acc={a} onChange={(p) => updateAccount(a.id, p)} onRemove={() => removeAccount(a.id)} sample={{ qty: sampleQty, instrument: sampleInstr }} />
                  ))}
                  {followers.length === 0 && <div className={s.hint}>Aucun suiveur : ajoutez vos comptes d’évaluation / financés à répliquer.</div>}
                </div>
              </div>
              <div className={s.addRow} style={{ marginTop: 12 }}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom (Apex 50K #2…)" />
                <input value={newNt} onChange={(e) => setNewNt(e.target.value)} placeholder="Compte NinjaTrader (APEX-1234-02)" />
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={newRole} onChange={(e) => setNewRole(e.target.value as CopierAccount['role'])}>
                    <option value="maitre">Maître</option>
                    <option value="suiveur">Suiveur</option>
                  </select>
                  <Button variant="gold" onClick={add}>
                    Ajouter
                  </Button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }} className={s.hint}>
                Simulation : ordre maître de
                <input type="number" min={1} value={sampleQty} onChange={(e) => setSampleQty(Math.max(1, Number(e.target.value) || 1))} style={{ width: 60, height: 24 }} />
                <select value={sampleInstr} onChange={(e) => setSampleInstr(e.target.value as 'NQ' | 'MNQ')} style={{ height: 24 }}>
                  <option value="NQ">NQ</option>
                  <option value="MNQ">MNQ</option>
                </select>
                → la taille répliquée s’affiche sous chaque suiveur.
              </div>
            </Panel>
          </div>

          <div className={s.col}>
            <Panel title="Filtres de réplication" sub="appliqués avant tout envoi">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className={s.formGrid}>
                  <Field label="Fenêtre · début (locale)">
                    <input type="time" value={config.windowStart} onChange={(e) => updateConfig({ windowStart: e.target.value })} />
                  </Field>
                  <Field label="Fenêtre · fin (locale)">
                    <input type="time" value={config.windowEnd} onChange={(e) => updateConfig({ windowEnd: e.target.value })} />
                  </Field>
                  <Field label="Budget latence (ms)">
                    <input type="number" min={50} step={50} value={config.latencyBudgetMs} onChange={(e) => updateConfig({ latencyBudgetMs: Number(e.target.value) || 250 })} />
                  </Field>
                  <Field label="Marge plancher minimale" hint="fraction du DD max du plan suiveur">
                    <input type="number" min={0} max={1} step={0.05} value={config.followerBufferFloor} onChange={(e) => updateConfig({ followerBufferFloor: Number(e.target.value) || 0 })} />
                  </Field>
                </div>
                <Toggle on={config.copyStops} onChange={(v) => updateConfig({ copyStops: v })} label="Répliquer les stops" />
                <Toggle on={config.copyTargets} onChange={(v) => updateConfig({ copyTargets: v })} label="Répliquer les objectifs" />
                <Toggle on={config.newsBlackout} onChange={(v) => updateConfig({ newsBlackout: v })} label="Blackout ±15 min autour des catalyseurs majeurs" />
              </div>
            </Panel>

            <Panel title="Pont NinjaTrader" sub="séquence du protocole">
              {BRIDGE_STEPS.map(([k, v]) => (
                <div key={k} className={s.bridgeRow}>
                  <span>{v}</span>
                  <b>{k}</b>
                </div>
              ))}
              <p className={s.hint} style={{ marginTop: 8 }}>
                Le pont est un AddOn NinjaScript qui se connecte en WebSocket au shell CΛNTO (127.0.0.1). Il ne quitte jamais la machine : aucune donnée de compte ne transite par un serveur tiers.
              </p>
            </Panel>

            <Panel
              title="Mises à jour"
              sub="journal des versions"
              actions={
                <select value={config.channel} onChange={(e) => updateConfig({ channel: e.target.value as 'stable' | 'beta' })} style={{ height: 24, fontSize: 11, padding: '0 6px' }}>
                  <option value="stable">canal stable</option>
                  <option value="beta">canal beta</option>
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
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className={s.hint} style={{ marginTop: 8 }}>
                Le copieur suivra un cycle de publication régulier ; le canal beta reçoit les règles de réplication en avance de phase.
              </p>
            </Panel>
          </div>
        </div>
      </ModuleContent>
    </>
  );
}

function AccountCard({ acc, onChange, onRemove, sample }: { acc: CopierAccount; onChange: (p: Partial<CopierAccount>) => void; onRemove: () => void; sample?: { qty: number; instrument: 'NQ' | 'MNQ' } }) {
  const rep = sample ? replicatedQty(sample, acc) : null;
  return (
    <div className={cx(s.acc, acc.role === 'maitre' && s.master)}>
      <div className={s.accHead}>
        <Toggle on={acc.enabled} onChange={(v) => onChange({ enabled: v })} />
        <b>{acc.name}</b>
        <Tag tone={acc.role === 'maitre' ? 'gold' : 'ice'}>{acc.role === 'maitre' ? 'maître' : 'suiveur'}</Tag>
        <button onClick={onRemove} aria-label="Retirer">
          <IconTrash size={12} />
        </button>
      </div>
      <div className={s.accGrid}>
        <Field label="Compte NT">
          <input value={acc.ntAccount} onChange={(e) => onChange({ ntAccount: e.target.value })} />
        </Field>
        <Field label="Plan prop">
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
            <Field label="Dimensionnement">
              <select value={acc.sizing.mode} onChange={(e) => onChange({ sizing: { ...acc.sizing, mode: e.target.value as CopierAccount['sizing']['mode'] } })}>
                <option value="ratio">Ratio du maître</option>
                <option value="fixe">Taille fixe</option>
                <option value="risque">Contrats par risque</option>
              </select>
            </Field>
            <Field label={acc.sizing.mode === 'ratio' ? 'Multiplicateur' : 'Contrats'}>
              <input type="number" min={0} step={acc.sizing.mode === 'ratio' ? 0.1 : 1} value={acc.sizing.value} onChange={(e) => onChange({ sizing: { ...acc.sizing, value: Number(e.target.value) || 0 } })} />
            </Field>
            <Field label="Plafond contrats">
              <input type="number" min={1} value={acc.sizing.maxContracts} onChange={(e) => onChange({ sizing: { ...acc.sizing, maxContracts: Math.max(1, Number(e.target.value) || 1) } })} />
            </Field>
            <Field label="Instrument">
              <select value={acc.symbolMap} onChange={(e) => onChange({ symbolMap: e.target.value as CopierAccount['symbolMap'] })}>
                <option value="identique">Identique au maître</option>
                <option value="NQ→MNQ">NQ → MNQ (×10)</option>
                <option value="MNQ→NQ">MNQ → NQ (÷10)</option>
              </select>
            </Field>
          </>
        )}
      </div>
      {rep && sample && (
        <div className={s.preview}>
          {sample.qty} {sample.instrument} maître → <b>{rep.qty} {rep.instrument}</b>
          {rep.note ? ` · ${rep.note}` : ''}
        </div>
      )}
    </div>
  );
}
