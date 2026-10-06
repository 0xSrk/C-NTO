import type { BridgeSnapshot, Pocket, PocketValuation } from '@/engine/portfolio/types';
import { tr } from '@/i18n';

/** Source d'une valorisation, en étiquette : le pont (et l'âge de son instantané), le journal, une saisie, le prix. */
export function sourceTag(pocket: Pocket, valuation: Pick<PocketValuation, 'mark'>, snapshots: readonly BridgeSnapshot[], now: number): string {
  if (valuation.mark === 'pont') {
    const bridge = tr('PONT', 'BRIDGE', 'PUENTE');
    const snap = snapshots.find((row) => row.account === (pocket.account ?? ''));
    if (snap) return `${bridge} · ${Math.max(0, Math.round((now - snap.at) / 1000))} S`;
    return bridge;
  }
  if (valuation.mark === 'journal') return tr('JOURNAL', 'JOURNAL', 'DIARIO');
  if (valuation.mark === 'saisi') return tr('SAISIE', 'ENTERED', 'INTRODUCIDO');
  return tr('PRIX', 'PRICE', 'PRECIO');
}

/**
 * Note ou motif d'exclusion du moteur du portefeuille, dans la langue du desk. Le moteur les garde en
 * français, stables pour les outils de l'agent ; seul l'affichage les traduit. Un texte inconnu passe tel quel.
 */
export function engineNote(text: string): string {
  const rate = /^taux (\S+)\/(\S+) manquant$/.exec(text);
  if (rate) return tr(text, `${rate[1]}/${rate[2]} rate missing`, `falta el tipo ${rate[1]}/${rate[2]}`);
  switch (text) {
    case 'pont hors ligne':
      return tr(text, 'bridge offline', 'puente fuera de línea');
    case 'montant non fini':
      return tr(text, 'non-finite amount', 'importe no finito');
    case 'devise invalide':
      return tr(text, 'invalid currency', 'divisa no válida');
    case 'plan manquant':
      return tr(text, 'plan missing', 'falta el plan');
    case 'crypto hors périmètre':
      return tr(text, 'crypto out of scope', 'cripto fuera de alcance');
    case 'type de poche inconnu':
      return tr(text, 'unknown pocket type', 'tipo de bolsa desconocido');
    default:
      return text;
  }
}
