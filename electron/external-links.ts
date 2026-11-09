/**
 * Liens sortants (SEC2.4). Un lien cliqué dans le desk — une note, une réponse de l'agent, une description du calendrier —
 * partait vers le navigateur du système sans rien montrer : le texte d'un lien peut dire « bls.gov » et viser un autre
 * hôte. Le process principal montre maintenant l'hôte réel dans un dialogue (Annuler par défaut) avant d'ouvrir.
 *
 * Sans Electron : le dialogue, l'ouverture et le journal sont donnés, les tests les remplacent.
 */
import { uiText, type AppLocale } from './locale';

export interface ExternalTarget {
  /** L'URL normalisée, celle qui s'ouvre. */
  url: string;
  /** L'hôte réel, en ASCII (un nom internationalisé se lit en punycode), avec son port s'il n'est pas celui du schéma. */
  host: string;
}

export interface ExternalLinkDialog {
  type: 'question';
  buttons: [string, string];
  defaultId: 1;
  cancelId: 1;
  noLink: true;
  title: string;
  message: string;
  detail: string;
}

const URL_SHOWN_MAX = 240;
/** Contrôles, formats (dont les inversions bidirectionnelles), surrogats isolés, séparateurs de ligne : jamais dans un dialogue. */
const DIALOG_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

/**
 * Ce qu'un lien sortant a le droit d'être : `https`, ou `http` vers `127.0.0.1` (une passerelle locale du desk). Tout
 * autre schéma (`file:`, `javascript:`, `data:`, un protocole d'application) est refusé sans dialogue, comme une URL qui
 * porte un identifiant (`https://bls.gov@autre.example/` : le nom lu n'est pas l'hôte visé).
 */
export function externalTarget(raw: unknown): ExternalTarget | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  const local = parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !local) return null;
  if (!parsed.hostname) return null;
  return { url: parsed.href, host: parsed.host };
}

/** « Ouvrir ce lien ? », avec l'hôte réel en tête et l'adresse dessous. Annuler par défaut. */
export function externalLinkDialog(locale: AppLocale, target: ExternalTarget): ExternalLinkDialog {
  const clean = target.url.replace(DIALOG_FORBIDDEN, '');
  const shown = clean.length > URL_SHOWN_MAX ? `${clean.slice(0, URL_SHOWN_MAX)}…` : clean;
  const host = target.host.replace(DIALOG_FORBIDDEN, '');
  return {
    type: 'question',
    title: 'CΛNTO',
    message: uiText(locale, 'Ouvrir ce lien dans le navigateur ?', 'Open this link in the browser?', '¿Abrir este enlace en el navegador?'),
    detail: `${uiText(locale, 'Hôte', 'Host', 'Host')} : ${host}\n\n${shown}`,
    buttons: [uiText(locale, 'Ouvrir', 'Open', 'Abrir'), uiText(locale, 'Annuler', 'Cancel', 'Cancelar')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

export type ExternalLinkOutcome = 'opened' | 'declined' | 'refused' | 'busy';

export interface ExternalLinksDeps<W> {
  locale: () => AppLocale;
  showMessageBox: (win: W | null, options: ExternalLinkDialog) => Promise<{ response: number }>;
  open: (url: string) => Promise<unknown> | unknown;
  log: (line: string) => void;
}

/**
 * La porte des liens sortants. Un dialogue à la fois : une page qui en demanderait cent n'en ouvre qu'un, les autres
 * demandes tombent. Le journal ne garde que l'hôte, jamais l'adresse (elle peut porter un jeton).
 */
export class ExternalLinks<W> {
  private busy = false;

  constructor(private readonly deps: ExternalLinksDeps<W>) {}

  async request(win: W | null, raw: unknown): Promise<ExternalLinkOutcome> {
    const target = externalTarget(raw);
    if (!target) {
      this.deps.log('lien externe refusé : schéma ou adresse non admis');
      return 'refused';
    }
    if (this.busy) return 'busy';
    this.busy = true;
    try {
      const choice = await this.deps.showMessageBox(win, externalLinkDialog(this.deps.locale(), target));
      if (choice.response !== 0) return 'declined';
      this.deps.log(`lien externe ouvert hôte=${target.host}`);
      await this.deps.open(target.url);
      return 'opened';
    } catch (err) {
      this.deps.log(`lien externe non ouvert hôte=${target.host} : ${err instanceof Error ? err.message : String(err)}`);
      return 'declined';
    } finally {
      this.busy = false;
    }
  }
}
