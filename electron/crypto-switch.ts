import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentDialogOptions } from './agent-orders';
import { uiText, type AppLocale } from './locale';

/**
 * Interrupteur du module crypto (onglet 09 · CRY), côté process principal. Éteint par défaut ; seul le dialogue
 * du process principal l'allume, le renderer lit l'état et ne l'écrit jamais. Contrairement aux ordres de
 * l'agent (désactivés à chaque ouverture), l'état est gardé dans `userData/crypto.json` : un module allumé le
 * reste au redémarrage. Fichier absent, illisible ou corrompu : éteint.
 */

const SWITCH_FILE = 'crypto.json';

export interface CryptoSwitchDeps {
  userDataDir: string;
  locale: () => AppLocale;
  window: () => { isDestroyed(): boolean } | null;
  showMessageBox: (win: { isDestroyed(): boolean }, options: AgentDialogOptions) => Promise<{ response: number }>;
  log: (line: string) => void;
}

/** Cause d'un échec pour le journal : première ligne du message, bornée. */
function why(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (text.split('\n')[0] ?? '').slice(0, 120);
}

export class CryptoSwitchHost {
  private on: boolean;
  /** Le dialogue d'activation ouvert, tant qu'il l'est : un second appel en reçoit la même promesse. */
  private asking: Promise<boolean> | null = null;
  /** Un objet par abonnement : deux abonnements de la même fonction restent indépendants. */
  private readonly listeners = new Set<{ readonly cb: (enabled: boolean) => void }>();
  private readonly file: string;

  constructor(private readonly deps: CryptoSwitchDeps) {
    this.file = path.join(deps.userDataDir, SWITCH_FILE);
    this.on = this.read();
  }

  /** État courant. Le renderer le lit par l'IPC (CRY2.5), il ne l'écrit pas. */
  get enabled(): boolean {
    return this.on;
  }

  /** Seul `{ "enabled": true }` allume ; tout le reste (absent, illisible, corrompu, autre forme) éteint. */
  private read(): boolean {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      return typeof raw === 'object' && raw !== null && (raw as { enabled?: unknown }).enabled === true;
    } catch {
      return false;
    }
  }

  private persist(): void {
    try {
      mkdirSync(this.deps.userDataDir, { recursive: true });
      writeFileSync(this.file, JSON.stringify({ enabled: this.on }), { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      // L'état reste tenu en mémoire pour la séance. Allumé, le prochain lancement sera éteint : sens sûr.
      this.deps.log(`crypto : ${SWITCH_FILE} non écrit (${why(error)})`);
      if (!this.on) this.removeFile();
    }
  }

  /**
   * Éteint, un fichier qui ne s'écrit pas n'est pas sans danger : l'ancien `true` resterait sur le disque et
   * rallumerait le module, sans dialogue, au prochain lancement. « Absent » vaut « éteint » à la lecture, et
   * supprimer réussit parfois quand écrire échoue (fichier en lecture seule). Jamais `recursive` : seul le fichier.
   */
  private removeFile(): void {
    try {
      rmSync(this.file, { force: true });
    } catch (error) {
      this.deps.log(`crypto : ${SWITCH_FILE} non supprimé (${why(error)}) ; l’état précédent du disque sera relu au prochain lancement`);
    }
  }

  private t(fr: string, en: string, es: string): string {
    return uiText(this.deps.locale(), fr, en, es);
  }

  private dialog(): AgentDialogOptions {
    return {
      type: 'question',
      title: 'CΛNTO',
      message: this.t('Activer le module crypto ?', 'Turn on the crypto module?', '¿Activar el módulo cripto?'),
      detail: this.t(
        'Le desk se connectera aux données publiques de Coinbase, Binance et Bybit, pour un usage personnel. Vous pouvez éteindre le module à tout moment, dans l’onglet 09 · CRY. Ce choix vaut aussi pour les prochains lancements, jusqu’à ce que vous éteigniez le module.',
        'The desk will connect to the public data of Coinbase, Binance and Bybit, for personal use. You can turn the module off at any time, in the 09 · CRY tab. This choice also applies to the next launches, until you turn the module off.',
        'El desk se conectará a los datos públicos de Coinbase, Binance y Bybit, para uso personal. Puede apagar el módulo en cualquier momento, en la pestaña 09 · CRY. Esta elección también se aplica a los próximos arranques, hasta que apague el módulo.',
      ),
      buttons: [this.t('Activer', 'Turn on', 'Activar'), this.t('Annuler', 'Cancel', 'Cancelar')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
  }

  /**
   * Change l'état : mémoire, fichier, journal, puis abonnés. Le fichier est écrit même sans changement, pour
   * qu'après `disable()` il ne dise jamais `true` (supprimé, s'il ne peut être écrit : `persist`). Les abonnés
   * ne sont prévenus que d'un changement réel, et même quand le disque a échoué : l'extinction ne dépend pas de lui.
   */
  private set(enabled: boolean): void {
    const changed = enabled !== this.on;
    this.on = enabled;
    this.persist();
    if (!changed) return;
    this.deps.log(enabled ? 'crypto activé (dialogue du process principal)' : 'crypto désactivé');
    for (const listener of [...this.listeners]) {
      // Un abonné a changé l'état entre-temps : les suivants ont déjà reçu l'état à jour, pas un état périmé.
      if (this.on !== enabled) return;
      try {
        listener.cb(enabled);
      } catch (error) {
        // Un abonné défaillant (fenêtre détruite…) ne doit empêcher ni les autres ni l'extinction.
        this.deps.log(`crypto : un abonné de l’interrupteur a échoué (${why(error)})`);
      }
    }
  }

  private async confirm(win: { isDestroyed(): boolean }): Promise<boolean> {
    try {
      const choice = await this.deps.showMessageBox(win, this.dialog());
      if (choice.response !== 0) return false;
    } catch (error) {
      this.deps.log(`crypto : dialogue d’activation en échec (${why(error)})`);
      return false;
    }
    this.set(true);
    return this.on;
  }

  /**
   * Allumage : dialogue du process principal, Annuler par défaut. Déjà allumé : `true`, sans dialogue. Fenêtre
   * absente : reste éteint, sans dialogue. Un appel reçu pendant qu'un dialogue est ouvert (double clic sur
   * « Activer ») rend la même promesse que le premier : jamais deux dialogues. Un dialogue en échec laisse le
   * module éteint (`false`) au lieu de rejeter. Rend l'état obtenu.
   */
  requestEnable(): Promise<boolean> {
    if (this.on) return Promise.resolve(true);
    if (this.asking) return this.asking;
    const win = this.deps.window();
    if (!win || win.isDestroyed()) return Promise.resolve(false);
    const asking = this.confirm(win).finally(() => {
      this.asking = null;
    });
    this.asking = asking;
    return asking;
  }

  /** Extinction : sans dialogue, immédiate. Rend l'état obtenu, donc `false`. */
  disable(): boolean {
    this.set(false);
    return this.on;
  }

  /** Abonnement aux changements d'état (`true` : allumé, `false` : éteint) ; rend la fonction qui désabonne. */
  onChange(cb: (enabled: boolean) => void): () => void {
    const listener = { cb };
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
