import type { SlotValues } from '@/design/Micro';
import { AGENT_CONFIRM_TIMEOUT_MS, AGENT_ORDER_BOUNDS, AGENT_SIM_PREFIX } from '@/engine/agent/orders';
import { tr } from '@/i18n';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

/** Raccourci Electron (`CommandOrControl+Shift+K`) dit comme au clavier : `Ctrl+Shift+K` (`Cmd` sur macOS). */
export function shortcutLabel(accelerator: string): string {
  return accelerator
    .split('+')
    .map((key) => {
      switch (key.toLowerCase()) {
        case 'commandorcontrol':
        case 'cmdorctrl':
          return MAC ? 'Cmd' : 'Ctrl';
        case 'command':
        case 'cmd':
          return 'Cmd';
        case 'control':
          return 'Ctrl';
        case 'option':
          return 'Alt';
        default:
          return key.length === 1 ? key.toUpperCase() : key;
      }
    })
    .join('+');
}

/**
 * Ce que lit la plaque AGENT_GUARD : les invariants de la garde de l'agent (préfixe des comptes Sim, bornes de la
 * quantité par ordre, délai du dialogue de confirmation), et le raccourci du kill switch tel que l'annonce le process
 * principal — `null` quand il ne l'a pas dit (navigateur, pont absent) : la plaque écrit « — ».
 */
export function agentGuardValues(killShortcut: string | null | undefined): SlotValues {
  const [lo, hi] = AGENT_ORDER_BOUNDS.maxQty;
  return {
    accounts: `${AGENT_SIM_PREFIX.toUpperCase()}* // ${lo}–${hi}`,
    confirm: `${AGENT_CONFIRM_TIMEOUT_MS / 1000} S`,
    kill: killShortcut ? shortcutLabel(killShortcut).toUpperCase() : null,
  };
}

/** La même garde, en phrase, pour les lecteurs d'écran. */
export function agentGuardLabel(killShortcut: string | null | undefined): string {
  const [lo, hi] = AGENT_ORDER_BOUNDS.maxQty;
  const seconds = AGENT_CONFIRM_TIMEOUT_MS / 1000;
  const kill = killShortcut ? shortcutLabel(killShortcut) : tr('inconnu', 'unknown', 'desconocido');
  return tr(
    `Garde de l’agent : propose, ne soumet jamais · comptes ${AGENT_SIM_PREFIX}* (${lo} à ${hi} contrats par ordre) · confirmation par dialogue, ${seconds} s · kill switch ${kill}`,
    `Agent guard: proposes, never submits · ${AGENT_SIM_PREFIX}* accounts (${lo} to ${hi} contracts per order) · confirmation dialog, ${seconds} s · kill switch ${kill}`,
    `Guardia del agente: propone, nunca envía · cuentas ${AGENT_SIM_PREFIX}* (${lo} a ${hi} contratos por orden) · confirmación por diálogo, ${seconds} s · kill switch ${kill}`,
  );
}
