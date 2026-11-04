import { useEffect, useLayoutEffect, useState } from 'react';
import { Glyph } from '@/design/Micro';
import { cx } from '@/design/primitives';
import e from '@/design/etat.module.css';
import { tr, useI18n } from '@/i18n';
import { desk, type AgentOrderStatus, type CopierHostStatus } from '@/lib/desk';
import { fmtInt } from '@/lib/format';
import { useAgentOrders } from '@/store/agentOrders';
import { useBridge } from '@/store/bridge';
import { deskEventLog, useDeskEvents } from '@/store/deskEvents';
import { useObjects } from '@/store/objects';
import { useSettings } from '@/store/settings';
import { useUi, type TabId } from '@/store/ui';
import { useKillSwitch } from './killState';
import type { EtatStroke } from './objects/index';
import { railFit, type GatesMode } from './railFit';
import { openRegistre } from './registre';
import s from './shell.module.css';

/**
 * Les portes du rail (OROS5.25, Système 5 « Fiche et Frise », décision 11 de l'ADMIN ; repris du prototype D · Porte, d4).
 * Sous les neuf cartouches, en lecture, les quatre écritures que le process principal garde, chacune par l'écrou de la
 * garde (C.070) : les ordres de l'agent, le Copieur, l'écriture des agents, le canal d'ordres. Le trait de l'écrou vient
 * de la table d'états : ouverte, pleine ; une décision attend l'opérateur, tiretée, à l'or (décision 1) ; fermée,
 * désactivée, désarmée, hors ligne, éteinte. « Hors ligne » se distingue de « fermé jusqu'au redémarrage ».
 *
 * Une porte ouvre ce qui la règle — la vue, puis l'élément exact — sans jamais armer ni activer : le focus se pose sur la
 * section qui la règle, jamais sur Armer ni sur Autoriser ; l'écriture reste au geste de l'opérateur, derrière le dialogue
 * du process principal. Les portes ne lisent que des états : aucune méthode d'écriture d'un store ni du process principal.
 * Au bout, le lien « Registre n » ouvre le registre du lancement en tiroir bas (OROS5.38).
 */

export type GateId = 'agentOrders' | 'copier' | 'agentWrite' | 'channel';
/** Ouverte, en attente de l'opérateur, fermée (désactivée, désarmée, lecture seule), hors ligne, fermée jusqu'au redémarrage. */
export type GateState = 'open' | 'pending' | 'off' | 'offline' | 'closedRestart';

/** Où une porte mène : un module, sa vue, l'élément qui prend le focus ; ou une fenêtre de Métrique. */
export interface GateTarget {
  tab: TabId;
  view?: string;
  modal?: 'pont';
  /** L'élément qui prend le focus : la section qui règle la porte, jamais un bouton qui l'ouvre. */
  focus?: string;
}

export interface Gate {
  id: GateId;
  state: GateState;
  /** Le trait de l'écrou, dans la table d'états. */
  etat: EtatStroke;
  name: string;
  /** L'état, en mots. */
  word: string;
  /** Le nom accessible : la porte, son état, ce qu'elle ouvre. */
  label: string;
  target: GateTarget;
}

export interface GateInput {
  orders: AgentOrderStatus;
  /** Le process principal garde les ordres de l'agent (le desk) ; hors du desk, hors ligne. */
  ordersAvailable: boolean;
  /** Le statut du Copieur, lu du process principal ; `null` hors du desk ou avant la première lecture. */
  copier: CopierHostStatus | null;
  allowWrite: boolean;
  /** Le lien du pont et son canal. */
  link: string | null;
  ordersOpen: boolean | undefined;
  /** Kill switch engagé : la soumission reste fermée jusqu'au redémarrage du desk. */
  killed: boolean;
}

const ETAT: Readonly<Record<GateState, EtatStroke>> = { open: 'plein', pending: 'tirete', off: 'eteint', offline: 'eteint', closedRestart: 'eteint' };

/** Le sélecteur de la section qui règle une porte : l'élément marqué, que la porte rend au focus. */
export const gateTarget = (id: GateId) => `[data-gate-target="${id}"]`;

/** Les quatre portes, lues des états du desk ; pur. */
export function readGates(input: GateInput): Gate[] {
  const offline = tr('hors ligne', 'offline', 'fuera de línea');
  const orders: GateState = input.killed ? 'closedRestart' : !input.ordersAvailable ? 'offline' : input.orders.pending ? 'pending' : input.orders.enabled ? 'open' : 'off';
  const copier: GateState = input.killed ? 'closedRestart' : !input.copier ? 'offline' : input.copier.armed ? 'open' : 'off';
  const channel: GateState = input.killed ? 'closedRestart' : input.link !== 'live' ? 'offline' : input.ordersOpen ? 'open' : 'off';
  const gate = (id: GateId, state: GateState, name: string, words: Partial<Record<GateState, string>>, opens: string, target: GateTarget): Gate => {
    const word = words[state] ?? offline;
    return { id, state, etat: ETAT[state], name, word, label: `${name} : ${word} — ${opens}`, target };
  };
  return [
    gate(
      'agentOrders',
      orders,
      tr('Ordres de l’agent', 'Agent orders', 'Órdenes del agente'),
      {
        open: tr('autorisés · Sim', 'allowed · Sim', 'autorizadas · Sim'),
        pending: tr('en attente de vous', 'waiting for you', 'esperándole'),
        off: tr('désactivés', 'off', 'desactivadas'),
        closedRestart: tr('fermés jusqu’au redémarrage', 'closed until restart', 'cerradas hasta el reinicio'),
      },
      tr('ouvre leurs réglages, dans Agent IA ; les autoriser passe par un dialogue du desk', 'opens their settings, in AI Agent; allowing them goes through a desk dialog', 'abre sus ajustes, en Agente IA; autorizarlas pasa por un diálogo del desk'),
      { tab: 'agent', view: 'options', focus: gateTarget('agentOrders') },
    ),
    gate(
      'copier',
      copier,
      tr('Copieur', 'Copier', 'Copiador'),
      { open: tr('armé', 'armed', 'armado'), off: tr('désarmé', 'disarmed', 'desarmado'), closedRestart: tr('fermé jusqu’au redémarrage', 'closed until restart', 'cerrado hasta el reinicio') },
      tr('ouvre le Copieur ; l’armer passe par un dialogue du desk', 'opens the Copier; arming goes through a desk dialog', 'abre el Copiador; armarlo pasa por un diálogo del desk'),
      { tab: 'copieur', focus: '[data-plate="copieur"]' },
    ),
    gate(
      'agentWrite',
      input.allowWrite ? 'open' : 'off',
      tr('Écriture des agents', 'Agents writing', 'Escritura de los agentes'),
      { open: tr('autorisée', 'allowed', 'autorizada'), off: tr('lecture seule', 'read only', 'solo lectura') },
      tr('ouvre la passerelle MCP et l’orchestrateur, dans Agent IA', 'opens the MCP gateway and the orchestrator, in AI Agent', 'abre la pasarela MCP y el orquestador, en Agente IA'),
      { tab: 'agent', view: 'options', focus: gateTarget('agentWrite') },
    ),
    gate(
      'channel',
      channel,
      tr('Canal d’ordres', 'Order channel', 'Canal de órdenes'),
      { open: tr('ouvert', 'open', 'abierto'), off: tr('fermé', 'closed', 'cerrado'), closedRestart: tr('fermé jusqu’au redémarrage', 'closed until restart', 'cerrado hasta el reinicio') },
      tr('ouvre le pont NinjaTrader', 'opens the NinjaTrader bridge', 'abre el puente NinjaTrader'),
      { tab: 'metrique', modal: 'pont' },
    ),
  ];
}

/**
 * Pose le focus sur l'élément qui règle la porte, dès qu'il est posé et visible (le module se monte, la vue s'ouvre ; une
 * vue cachée garde ses sections dans le DOM, `hidden`) : il le reçoit sans devenir une étape de Tab, et ce n'est jamais un
 * bouton. Le premier essai attend que le saut soit rendu, puis il réessaie tant que le focus ne s'y est pas posé.
 */
export function landOn(selector: string, tries = 40): void {
  const step = (left: number) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && !el.closest('[hidden]')) {
      if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
      el.scrollIntoView?.({ block: 'nearest' });
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return;
    }
    if (left > 0) setTimeout(() => step(left - 1), 25);
  };
  setTimeout(() => step(tries), 0);
}

/** Ouvre ce qui règle une porte : un saut vers le module et sa vue, puis la section ou la fenêtre. Rien sous le verrou. */
export function openGate(target: GateTarget): boolean {
  const objects = useObjects.getState();
  if (!objects.jumpTo(target.tab, target.view ? { view: target.view } : {})) return false;
  if (target.modal) useUi.getState().requestModal('metrique', target.modal);
  if (target.focus) landOn(target.focus);
  return true;
}

/** Le statut du Copieur, lu du process principal (lecture seule) ; `null` hors du desk ou avant la première lecture. */
function useCopierHost(): CopierHostStatus | null {
  const [host, setHost] = useState<CopierHostStatus | null>(null);
  useEffect(() => {
    const api = desk?.copier;
    if (!api) return;
    void api
      .status()
      .then(setHost)
      .catch(() => undefined);
    return api.onStatus(setHost);
  }, []);
  return host;
}

/**
 * La forme des portes dans la place que laisse le rail (`railFit`) : mesurée sur le rail (sa hauteur, celle, naturelle,
 * de ses cartouches, et celle de son pied), suivie à chaque changement de taille. Sans mesure (rien n'est encore posé),
 * en lignes.
 */
function useGatesMode(): GatesMode {
  const [mode, setMode] = useState<GatesMode>('rows');
  useLayoutEffect(() => {
    const rail = document.querySelector<HTMLElement>('[data-chassis="rail"]');
    const nav = rail?.querySelector<HTMLElement>('nav');
    // Le pied (le compte, le sceau, les langues) ferme le rail : son dernier élément.
    const foot = rail?.lastElementChild;
    if (!rail || !nav || !(foot instanceof HTMLElement) || foot === nav) return;
    const px = (v: string) => Number.parseFloat(v) || 0;
    const read = () => {
      if (rail.clientHeight === 0) return;
      const cs = getComputedStyle(rail);
      const next = railFit({ content: rail.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom), nav: nav.scrollHeight, foot: foot.offsetHeight, gap: px(cs.rowGap) });
      setMode((prev) => (prev === next ? prev : next));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(rail);
    ro.observe(nav);
    ro.observe(foot);
    for (const child of nav.children) ro.observe(child);
    return () => ro.disconnect();
  }, []);
  return mode;
}

/** Les portes au rail, sous les cartouches : en lignes, ou à l'étroit en une ligne d'écrous ; le compte du registre au bout. */
export function RailGates() {
  useI18n((st) => st.locale);
  const orders = useAgentOrders((a) => a.status);
  const ordersAvailable = useAgentOrders((a) => a.available);
  const allowWrite = useSettings((st) => st.settings.orchestratorAllowWrite);
  const nt = useBridge((b) => b.nt);
  const kill = useKillSwitch();
  const copier = useCopierHost();
  const count = useDeskEvents((d) => d.count);
  const mode = useGatesMode();
  // Le statut des ordres de l'agent vient du process principal : relu dès l'ouverture, sans attendre l'onglet Agent IA.
  useEffect(() => {
    void useAgentOrders
      .getState()
      .refresh()
      .catch(() => undefined);
  }, []);
  if (mode === 'none') return null;
  const gates = readGates({ orders, ordersAvailable, copier: desk?.copier ? copier : null, allowWrite, link: nt?.link ?? null, ordersOpen: nt?.ordersOpen, killed: kill.engaged });
  // Le lien compte ce que le registre qu'il ouvre garde : 500 au plus (décision 13). Au-delà, son nom dit les deux nombres.
  const kept = Math.min(count, deskEventLog.size);
  const registry =
    count > kept
      ? tr(
          `Registre du lancement : ${count} événement(s) depuis l’ouverture, les ${kept} derniers en mémoire — ouvrir le registre`,
          `Launch log: ${count} event(s) since opening, the last ${kept} in memory — open the log`,
          `Registro del lanzamiento: ${count} evento(s) desde la apertura, los ${kept} últimos en memoria — abrir el registro`,
        )
      : tr(
          `Registre du lancement : ${kept} événement(s), en mémoire — ouvrir le registre`,
          `Launch log: ${kept} event(s), in memory — open the log`,
          `Registro del lanzamiento: ${kept} evento(s), en memoria — abrir el registro`,
        );
  return (
    <div className={cx(s.gates, mode === 'line' && s.gatesLine)} role="group" aria-label={tr('Portes du process principal, en lecture', 'Main process gates, read-only', 'Puertas del proceso principal, en lectura')} data-gates={mode}>
      {gates.map((g) => (
        <button key={g.id} type="button" className={s.gate} data-gate={g.id} data-state={g.state} aria-label={g.label} title={g.label} onClick={() => openGate(g.target)}>
          <span className={cx(s.gateNut, e[g.etat])} data-etat={g.etat}>
            <Glyph name="guard" className={s.gateGlyph} />
          </span>
          {mode === 'rows' ? (
            <>
              <span className={s.gateName}>{g.name}</span>
              <span className={s.gateWord}>{g.word}</span>
            </>
          ) : null}
        </button>
      ))}
      {/* « Registre n » (OROS5.38) : il ouvre le registre du lancement en tiroir bas ; Échap y rend le focus. */}
      <button type="button" className={s.registry} data-registry="" aria-label={registry} title={registry} onClick={(event) => openRegistre(event.currentTarget)}>
        <span aria-hidden>{tr('Registre', 'Log', 'Registro')}</span>
        <b aria-hidden>{fmtInt(kept)}</b>
      </button>
    </div>
  );
}
