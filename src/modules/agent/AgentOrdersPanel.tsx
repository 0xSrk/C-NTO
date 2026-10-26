import { useEffect, useState } from 'react';
import { Plate } from '@/design/Micro';
import { Button, Field, Tag } from '@/design/primitives';
import { AGENT_CONFIRM_TIMEOUT_MS, AGENT_ORDER_BOUNDS, AGENT_ORDER_TAG } from '@/engine/agent/orders';
import { tr, useI18n } from '@/i18n';
import { dateTimeFormatter } from '@/lib/time';
import { useAgentOrders } from '@/store/agentOrders';
import { useBridge } from '@/store/bridge';
import { agentGuardLabel, agentGuardValues } from './agentGuard';
import { originLabel, outcomeLabel } from './agentOrderLabels';
import s from './agent.module.css';

type LimitKey = keyof typeof AGENT_ORDER_BOUNDS;

/** Ordres proposés par l'agent (A5) : activation et limites passent par le process principal. */
export function AgentOrdersPanel({ available }: { available: boolean }) {
  useI18n((st) => st.locale);
  const status = useAgentOrders((a) => a.status);
  const last = useAgentOrders((a) => a.last);
  const refresh = useAgentOrders((a) => a.refresh);
  const enable = useAgentOrders((a) => a.enable);
  const disable = useAgentOrders((a) => a.disable);
  const setLimits = useAgentOrders((a) => a.setLimits);
  // Le raccourci du kill switch, tel que l'annonce le process principal ; inconnu hors du shell.
  const killShortcut = useBridge((b) => b.nt?.killSwitchShortcut ?? null);
  const confirmSeconds = AGENT_CONFIRM_TIMEOUT_MS / 1000;
  const [draft, setDraft] = useState<Record<LimitKey, number>>({ maxQty: status.maxQty, maxPosition: status.maxPosition, perMinute: status.perMinute });

  useEffect(() => {
    if (available) void refresh().catch(() => undefined);
  }, [available, refresh]);

  useEffect(() => {
    setDraft({ maxQty: status.maxQty, maxPosition: status.maxPosition, perMinute: status.perMinute });
  }, [status.maxQty, status.maxPosition, status.perMinute]);

  const changed = draft.maxQty !== status.maxQty || draft.maxPosition !== status.maxPosition || draft.perMinute !== status.perMinute;
  const fields: [LimitKey, string][] = [
    ['maxQty', tr('Contrats / ordre', 'Contracts / order', 'Contratos / orden')],
    ['maxPosition', tr('Position max.', 'Max. position', 'Posición máx.')],
    ['perMinute', tr('Propositions / min', 'Proposals / min', 'Propuestas / min')],
  ];
  const outcome = last ? outcomeLabel(last.outcome) : null;

  return (
    <div className={s.section}>
      {/* La plaque de la garde en tête : les invariants que le process principal applique, lus, pas recopiés. */}
      <Plate id="agentGuard" values={agentGuardValues(killShortcut)} label={agentGuardLabel(killShortcut)} className={s.guardPlate} />
      <div className={s.sectionTitle}>
        <span>{tr('Ordres proposés par l’agent', 'Orders proposed by the agent', 'Órdenes propuestas por el agente')}</span>
        <Tag tone={status.pending ? 'gold' : status.enabled ? 'ember' : undefined} dot live={status.pending || status.enabled}>
          {status.pending
            ? tr('en attente du trader', 'waiting for the trader', 'esperando al trader')
            : status.enabled
              ? tr('autorisés · Sim', 'allowed · Sim', 'autorizadas · Sim')
              : tr('désactivés', 'off', 'desactivadas')}
        </Tag>
      </div>
      {available ? (
        <>
          <div className={s.hint}>
            {tr(
              `L’agent ne soumet rien : avec propose_order, il propose un ordre sur un compte Sim. Le desk vérifie les limites ci-dessous, puis vous montre l’ordre et sa raison dans une fenêtre du système. Rien n’est envoyé sans votre confirmation (${confirmSeconds} s, Refuser par défaut). Désactivé à chaque ouverture du desk.`,
              `The agent submits nothing: with propose_order, it proposes an order on a Sim account. The desk checks the limits below, then shows you the order and its reason in a system window. Nothing is sent without your confirmation (${confirmSeconds} s, Decline by default). Turned off each time the desk opens.`,
              `El agente no envía nada: con propose_order, propone una orden en una cuenta Sim. El desk comprueba los límites de abajo y luego le muestra la orden y su razón en una ventana del sistema. Nada se envía sin su confirmación (${confirmSeconds} s, Rechazar por defecto). Desactivado cada vez que se abre el desk.`,
            )}
          </div>
          <div className={s.row2}>
            <Field label={tr('État', 'Status', 'Estado')}>
              {status.enabled ? (
                <Button size="sm" variant="danger" onClick={() => void disable()}>
                  {tr('Couper', 'Cut', 'Cortar')}
                </Button>
              ) : (
                <Button size="sm" variant="gold" onClick={() => void enable()}>
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
                variant="gold"
                onClick={async () => {
                  // Relèvement refusé dans la fenêtre du système : les champs reviennent aux limites en place.
                  await setLimits(draft);
                  const now = useAgentOrders.getState().status;
                  setDraft({ maxQty: now.maxQty, maxPosition: now.maxPosition, perMinute: now.perMinute });
                }}
              >
                {tr('Appliquer les limites', 'Apply limits', 'Aplicar los límites')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft({ maxQty: status.maxQty, maxPosition: status.maxPosition, perMinute: status.perMinute })}>
                {tr('Annuler', 'Cancel', 'Cancelar')}
              </Button>
            </div>
          )}
          <div className={s.hint}>
            {tr(
              'Baisser une limite est immédiat ; la relever passe par une fenêtre du système. Au-dessous de 25 % de marge du plan prop suivi, ou après le kill switch, l’agent ne peut plus ouvrir ni augmenter. Agents externes : l’outil n’apparaît qu’avec l’écriture autorisée.',
              'Lowering a limit is immediate; raising it goes through a system window. Below 25% of the tracked prop plan buffer, or after the kill switch, the agent can no longer open or add. External agents: the tool only appears when writing is allowed.',
              'Bajar un límite es inmediato; subirlo pasa por una ventana del sistema. Por debajo del 25 % de margen del plan prop seguido, o tras el kill switch, el agente ya no puede abrir ni aumentar. Agentes externos: la herramienta solo aparece con la escritura autorizada.',
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
