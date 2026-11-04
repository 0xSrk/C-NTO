import { useEffect, useState } from 'react';
import { CriteriaMirror } from '@/app/Criteria';
import { agentCriteria } from '@/app/criteriaMirror';
import { useKillSwitch } from '@/app/killState';
import { readGates } from '@/app/RailGates';
import { useGuardMirror } from '@/app/useGuardMirror';
import { Glyph } from '@/design/Micro';
import e from '@/design/etat.module.css';
import { Button, Field, cx } from '@/design/primitives';
import { AGENT_CONFIRM_TIMEOUT_MS, AGENT_ORDER_BOUNDS, AGENT_ORDER_LIMITS, AGENT_ORDER_TAG, AGENT_SIM_PREFIX } from '@/engine/agent/orders';
import { tr, useI18n } from '@/i18n';
import type { AgentOrderStatus } from '@/lib/desk';
import { dateTimeFormatter } from '@/lib/time';
import { useAgentOrders } from '@/store/agentOrders';
import { useBridge } from '@/store/bridge';
import { killSwitchText } from './agentGuard';
import { originLabel, outcomeLabel } from '@/lib/agentOrderLabels';
import s from './agent.module.css';

type LimitKey = keyof typeof AGENT_ORDER_BOUNDS;

/** Le nom de chaque limite, dans la langue du desk. */
function limitWord(key: LimitKey): string {
  if (key === 'maxQty') return tr('contrats par ordre', 'contracts per order', 'contratos por orden');
  if (key === 'maxPosition') return tr('position maximale', 'maximum position', 'posición máxima');
  return tr('propositions par minute', 'proposals per minute', 'propuestas por minuto');
}

/** Le pied de M.060 : les comptes, le délai du dialogue et son refus par défaut, lus des constantes de la garde. */
export function guardFoot(): string {
  const seconds = AGENT_CONFIRM_TIMEOUT_MS / 1000;
  return tr(
    `comptes ${AGENT_SIM_PREFIX}* · ${seconds} s · refuser par défaut`,
    `${AGENT_SIM_PREFIX}* accounts · ${seconds} s · decline by default`,
    `cuentas ${AGENT_SIM_PREFIX}* · ${seconds} s · rechazar por defecto`,
  );
}

/**
 * M.060, la garde d'écriture de l'agent (OROS5.42 ; repris de d4) : elle remplace le paragraphe de la notice. L'état des
 * ordres, dans les mots de la porte du rail (une seule source, `readGates`) ; les trois limites, chacune sa barre sur sa
 * borne (`AGENT_ORDER_BOUNDS`) ; le pied, lu des constantes. Son trait vient de la table d'états : en service, plein ; en
 * attente de vous, halo tireté ; désactivés ou fermés, filet graphite. Elle ne fait que lire.
 */
export function OrdersGuard({ status, available, killed }: { status: AgentOrderStatus; available: boolean; killed: boolean }) {
  const gate = readGates({ orders: status, ordersAvailable: available, copier: null, allowWrite: false, link: null, ordersOpen: undefined, killed }).find((g) => g.id === 'agentOrders')!;
  return (
    <div className={cx(s.access, e[gate.etat])} data-plate="M.060" data-state={gate.state}>
      <p className={s.accessState}>
        <b>{tr('Ordres de l’agent', 'Agent orders', 'Órdenes del agente')}</b>
        <span data-orders-state="">{gate.word}</span>
      </p>
      <ul className={s.accessBars}>
        {AGENT_ORDER_LIMITS.map((key) => {
          const hi = AGENT_ORDER_BOUNDS[key][1];
          const value = status[key];
          return (
            <li key={key} data-limit={key}>
              <span className={s.accessLabel}>{limitWord(key)}</span>
              <span className={s.accessTrack} aria-hidden>
                <i style={{ width: `${Math.min(100, Math.max(0, (value / hi) * 100))}%` }} />
              </span>
              <b>
                {value} / {hi}
              </b>
            </li>
          );
        })}
      </ul>
      <p className={s.accessFoot} data-foot="">
        {guardFoot()}
      </p>
    </div>
  );
}

/** Ordres proposés par l'agent (A5) : activation et limites passent par le process principal. */
export function AgentOrdersPanel({ available }: { available: boolean }) {
  useI18n((st) => st.locale);
  const status = useAgentOrders((a) => a.status);
  const last = useAgentOrders((a) => a.last);
  const refresh = useAgentOrders((a) => a.refresh);
  const enable = useAgentOrders((a) => a.enable);
  const disable = useAgentOrders((a) => a.disable);
  const setLimits = useAgentOrders((a) => a.setLimits);
  // Le raccourci du kill switch, tel que l'annonce le process principal ; inconnu hors du shell, la notice ne le dit pas.
  const killShortcut = useBridge((b) => b.nt?.killSwitchShortcut ?? null);
  const kill = killSwitchText(killShortcut);
  // Après le kill switch, la garde refuse tout jusqu'au redémarrage : M.060 le dit, comme la porte du rail.
  const killed = useKillSwitch().engaged;
  // Les critères d'Activer en miroir (OROS5.43) : le compte où l'agent ouvrirait, lu par le miroir de la garde.
  const mirror = useGuardMirror();
  const activation = agentCriteria(mirror, status, killed);
  const [draft, setDraft] = useState<Record<LimitKey, number>>({ maxQty: status.maxQty, maxPosition: status.maxPosition, perMinute: status.perMinute });

  useEffect(() => {
    if (available) void refresh().catch(() => undefined);
  }, [available, refresh]);

  useEffect(() => {
    setDraft({ maxQty: status.maxQty, maxPosition: status.maxPosition, perMinute: status.perMinute });
  }, [status.maxQty, status.maxPosition, status.perMinute]);

  const changed = draft.maxQty !== status.maxQty || draft.maxPosition !== status.maxPosition || draft.perMinute !== status.perMinute;
  // Relever une limite ouvre le dialogue du process principal (C.070) ; seulement baisser est immédiat.
  const raising = draft.maxQty > status.maxQty || draft.maxPosition > status.maxPosition || draft.perMinute > status.perMinute;
  const fields: [LimitKey, string][] = [
    ['maxQty', tr('Contrats / ordre', 'Contracts / order', 'Contratos / orden')],
    ['maxPosition', tr('Position max.', 'Max. position', 'Posición máx.')],
    ['perMinute', tr('Propositions / min', 'Proposals / min', 'Propuestas / min')],
  ];
  const outcome = last ? outcomeLabel(last.outcome) : null;

  return (
    <div className={s.section}>
      {/* Système 4.1 : le panneau s'ouvre sur son titre, sans plaque ; M.060 dit l'état une fois (OROS5.42). */}
      <div className={s.sectionTitle}>
        <span>{tr('Ordres proposés par l’agent', 'Orders proposed by the agent', 'Órdenes propuestas por el agente')}</span>
      </div>
      <OrdersGuard status={status} available={available} killed={killed} />
      {available ? (
        <>
          <CriteriaMirror
            id="agent"
            mirror={activation}
            on={status.enabled}
            opening={tr('Activer · coupés à chaque ouverture du desk ; le dialogue du desk décide', 'Enable · cut each time the desk opens; the desk dialog decides', 'Activar · cortadas en cada apertura del desk; el diálogo del desk decide')}
          />
          <div className={s.row2}>
            <Field label={tr('État', 'Status', 'Estado')}>
              {status.enabled ? (
                <Button size="sm" variant="danger" onClick={() => void disable()}>
                  {tr('Couper', 'Cut', 'Cortar')}
                </Button>
              ) : (
                // C.070 : l'écrou de la garde. Autoriser ouvre toujours le dialogue du process principal (Annuler par défaut).
                <Button size="sm" onClick={() => void enable()} title={tr('Dialogue du desk, Annuler par défaut', 'Desk dialog, Cancel by default', 'Diálogo del desk, Cancelar por defecto')}>
                  <Glyph name="guard" className={s.gateNut} />
                  {tr('Autoriser…', 'Allow…', 'Autorizar…')}
                </Button>
              )}
            </Field>
            <Field label={tr('Tag NinjaTrader', 'NinjaTrader tag', 'Tag NinjaTrader')}>
              <code className="mono">{AGENT_ORDER_TAG}</code>
            </Field>
          </div>
          <div className={s.row2} style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {fields.map(([key, label]) => {
              const [lo, hi] = AGENT_ORDER_BOUNDS[key];
              return (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    min={lo}
                    max={hi}
                    step={1}
                    value={draft[key]}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      setDraft((d) => ({ ...d, [key]: Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d[key] }));
                    }}
                  />
                </Field>
              );
            })}
          </div>
          {changed && (
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                size="sm"
                data-limits={raising ? 'raise' : 'lower'}
                title={raising ? tr('Dialogue du desk, Annuler par défaut', 'Desk dialog, Cancel by default', 'Diálogo del desk, Cancelar por defecto') : undefined}
                onClick={async () => {
                  // Relèvement refusé dans la fenêtre du système : les champs reviennent aux limites en place.
                  await setLimits(draft);
                  const now = useAgentOrders.getState().status;
                  setDraft({ maxQty: now.maxQty, maxPosition: now.maxPosition, perMinute: now.perMinute });
                }}
              >
                {raising ? <Glyph name="guard" className={s.gateNut} /> : null}
                {raising ? tr('Relever les limites…', 'Raise the limits…', 'Subir los límites…') : tr('Abaisser les limites', 'Lower the limits', 'Bajar los límites')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft({ maxQty: status.maxQty, maxPosition: status.maxPosition, perMinute: status.perMinute })}>
                {tr('Annuler', 'Cancel', 'Cancelar')}
              </Button>
            </div>
          )}
          <div className={s.hint}>
            {tr(
              `Baisser une limite est immédiat ; la relever passe par une fenêtre du système. Au-dessous de 25 % de marge du plan prop suivi, ou après le ${kill}, l’agent ne peut plus ouvrir ni augmenter. Agents externes : l’outil n’apparaît qu’avec l’écriture autorisée.`,
              `Lowering a limit is immediate; raising it goes through a system window. Below 25% of the tracked prop plan buffer, or after the ${kill}, the agent can no longer open or add. External agents: the tool only appears when writing is allowed.`,
              `Bajar un límite es inmediato; subirlo pasa por una ventana del sistema. Por debajo del 25 % de margen del plan prop seguido, o tras el ${kill}, el agente ya no puede abrir ni aumentar. Agentes externos: la herramienta solo aparece con la escritura autorizada.`,
            )}
          </div>
          {last && outcome && (
            <div className={s.log}>
              <span>
                {dateTimeFormatter({ hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(last.at)} · {originLabel(last.origin)} ·{' '}
                <b>
                  {last.side} {last.qty ?? '?'} {last.instrument || '?'} {last.type}
                </b>{' '}
                {last.account || '?'} <span className={outcome.ok ? s.ok : s.ko}>{outcome.text}</span>
              </span>
            </div>
          )}
        </>
      ) : (
        <div className={s.hint}>
          {tr(
            'Disponible dans le shell local (Electron) : la confirmation de chaque ordre passe par une fenêtre du système.',
            'Available in the local shell (Electron): each order is confirmed in a system window.',
            'Disponible en el shell local (Electron): cada orden se confirma en una ventana del sistema.',
          )}
        </div>
      )}
    </div>
  );
}
