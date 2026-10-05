import type { AgentOrderRefusal } from '@/engine/agent/orders';
import { tr } from '@/i18n';
import type { AgentOrderOrigin, AgentOrderOutcome } from '@/lib/desk';

export function originLabel(origin: AgentOrderOrigin): string {
  if (origin === 'mcp') return 'MCP';
  if (origin === 'orch') return tr('orchestrateur', 'orchestrator', 'orquestador');
  return tr('agent du desk', 'desk agent', 'agente del desk');
}

/** Motif de refus du desk (`guardProposal`), dans la langue de l'interface. */
export function refusalLabel(reason: AgentOrderRefusal | 'invalid'): string {
  switch (reason) {
    case 'disabled':
      return tr('ordres de l’agent désactivés', 'agent orders turned off', 'órdenes del agente desactivadas');
    case 'not_sim':
      return tr('compte non Sim', 'not a Sim account', 'cuenta no Sim');
    case 'busy':
      return tr('une proposition attendait déjà', 'a proposal was already waiting', 'ya esperaba una propuesta');
    case 'link':
      return tr('pont NinjaTrader indisponible', 'NinjaTrader bridge unavailable', 'puente NinjaTrader no disponible');
    case 'orders_closed':
      return tr('canal d’ordres fermé (kill switch)', 'order channel closed (kill switch)', 'canal de órdenes cerrado (kill switch)');
    case 'rate':
      return tr('trop de propositions par minute', 'too many proposals per minute', 'demasiadas propuestas por minuto');
    case 'quantity':
      return tr('trop de contrats par ordre', 'too many contracts per order', 'demasiados contratos por orden');
    case 'position':
      return tr('position atteinte trop grande', 'resulting position too large', 'posición resultante demasiado grande');
    case 'prop_buffer':
      return tr('marge du plan prop trop basse', 'prop plan buffer too low', 'margen del plan prop demasiado bajo');
    default:
      return tr('proposition invalide', 'invalid proposal', 'propuesta inválida');
  }
}

export function outcomeLabel(o: AgentOrderOutcome): { ok: boolean; text: string } {
  if (o.status === 'sent') return { ok: true, text: `${tr('envoyé', 'sent', 'enviada')} · ${o.orderId}` };
  if (o.status === 'declined') return { ok: false, text: o.detail };
  if (o.status === 'refused') return { ok: false, text: `${tr('refusé par le desk', 'refused by the desk', 'rechazada por el desk')} · ${refusalLabel(o.reason)}` };
  return { ok: false, text: `${tr('refusé par le pont', 'refused by the bridge', 'rechazada por el puente')} · ${o.detail}` };
}
