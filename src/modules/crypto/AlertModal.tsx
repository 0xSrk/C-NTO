/**
 * La fenêtre « Nouvelle alerte » de l'onglet 09 · CRY (`docs/ONGLET-CRYPTO.md` § 7 et § 8), sur le modèle de l'import de
 * barres de Visual : `Modal` du desk, `Field`, trois `<select>` (cible, type, mode), un `input` pour le niveau, boutons
 * `ghost` et `gold`. Le refus du store s'y lit en clair.
 * Ce fichier porte aussi les textes que l'onglet partage autour des refus : chaque code du process principal et chaque refus du
 * store en phrase (jamais le code seul). Le genre, le niveau et la cible d'une alerte sont dans `@/lib/cryptoAlertText`.
 */
import { useState } from 'react';
import { Modal } from '@/design/Modal';
import { Button, Field } from '@/design/primitives';
import { ALERTS_MAX, CRYPTO_ALERT_KINDS, type CryptoAlert, type CryptoAlertKind } from '@/engine/crypto/alerts';
import { cryptoMarket, isChartableMarket, type CryptoMarketId } from '@/engine/crypto/markets';
import { DRAWINGS_MAX, INDICATORS_MAX, LABEL_MAX } from '@/engine/crypto/persist';
import { tr, useI18n } from '@/i18n';
import { alertKindText, alertTargetText } from '@/lib/cryptoAlertText';
import { fmtPrice } from '@/lib/format';
import type { CryptoRefusal, WriteResult } from '@/store/crypto';
import { useUi } from '@/store/ui';
import v from '../visual/visual.module.css';
import c from './crypto.module.css';

/** Les codes que le process principal rend pour un flux refusé, gardés tels quels dans `chartError`, `proxyError` et `tickerErrors`. */
type MainCode = 'crypto_disabled' | 'blocked' | 'rate_limited' | 'no_history' | 'unknown_stream' | 'invalid_request';

/** Chaque code en clair. Le type exige une phrase pour chaque refus du store : un refus ajouté à `CryptoRefusal` sans texte ne compile pas. */
const CODE_TEXT: Record<MainCode | CryptoRefusal, () => string> = {
  crypto_disabled: () => tr('Module crypto éteint : le process principal refuse le flux.', 'Crypto module off: the main process refuses the stream.', 'Módulo cripto apagado: el proceso principal rechaza el flujo.'),
  blocked: () => tr('Venue bloquée par l’exchange jusqu’au redémarrage du desk.', 'Venue blocked by the exchange until the desk restarts.', 'Venue bloqueada por el exchange hasta que se reinicie el desk.'),
  rate_limited: () => tr('Limite de requêtes de l’exchange atteinte : nouvel essai plus tard.', 'Exchange rate limit reached: retry later.', 'Límite de peticiones del exchange alcanzado: nuevo intento más tarde.'),
  no_history: () => tr('Historique indisponible : le chart ne montre que le direct.', 'History unavailable: the chart shows live data only.', 'Historial no disponible: el gráfico solo muestra el directo.'),
  unknown_stream: () => tr('Flux inconnu du process principal.', 'Stream unknown to the main process.', 'Flujo desconocido para el proceso principal.'),
  invalid_request: () => tr('Demande refusée par le process principal : forme invalide.', 'Request refused by the main process: invalid shape.', 'Petición rechazada por el proceso principal: forma no válida.'),
  not_ready: () => tr('Réglages crypto illisibles : rien n’a été écrit.', 'Crypto settings unreadable: nothing was written.', 'Ajustes cripto ilegibles: no se ha escrito nada.'),
  bad_mode: () => tr('Mode ou auteur invalide.', 'Invalid mode or author.', 'Modo o autor no válido.'),
  unknown_market: () => tr('Marché hors du registre.', 'Market outside the registry.', 'Mercado fuera del registro.'),
  bad_timeframe: () => tr('Unité de temps inconnue.', 'Unknown timeframe.', 'Marco temporal desconocido.'),
  unknown_indicator: () => tr('Indicateur inconnu.', 'Unknown indicator.', 'Indicador desconocido.'),
  bad_params: () => tr('Paramètre hors de ses bornes ou de son pas.', 'Parameter outside its bounds or step.', 'Parámetro fuera de sus límites o de su paso.'),
  indicators_full: () => tr(`Plafond de ${INDICATORS_MAX} indicateurs atteint.`, `Limit of ${INDICATORS_MAX} indicators reached.`, `Límite de ${INDICATORS_MAX} indicadores alcanzado.`),
  bad_price: () => tr('Prix invalide : un nombre strictement positif.', 'Invalid price: a strictly positive number.', 'Precio no válido: un número estrictamente positivo.'),
  bad_label: () => tr('Libellé invalide.', 'Invalid label.', 'Etiqueta no válida.'),
  label_too_long: () => tr(`Libellé trop long : ${LABEL_MAX} caractères au plus.`, `Label too long: ${LABEL_MAX} characters at most.`, `Etiqueta demasiado larga: ${LABEL_MAX} caracteres como máximo.`),
  drawings_full: () => tr(`Plafond de ${DRAWINGS_MAX} tracés atteint.`, `Limit of ${DRAWINGS_MAX} drawings reached.`, `Límite de ${DRAWINGS_MAX} trazados alcanzado.`),
  unknown_drawing: () => tr('Tracé introuvable.', 'Drawing not found.', 'Trazado no encontrado.'),
  not_in_watchlist: () => tr('Marché absent de la watchlist.', 'Market not in the watchlist.', 'Mercado ausente de la watchlist.'),
  alerts_full: () => tr(`Plafond de ${ALERTS_MAX} alertes atteint.`, `Limit of ${ALERTS_MAX} alerts reached.`, `Límite de ${ALERTS_MAX} alertas alcanzado.`),
  unknown_alert: () => tr('Alerte introuvable.', 'Alert not found.', 'Alerta no encontrada.'),
  market_has_alerts: () => tr('Ce marché porte une alerte : supprimez-la d’abord.', 'This market carries an alert: delete it first.', 'Este mercado tiene una alerta: elimínela primero.'),
  bad_target: () => tr('Cible invalide : un marché de la watchlist pour un prix, la température sinon.', 'Invalid target: a watchlist market for a price, the temperature otherwise.', 'Objetivo no válido: un mercado de la watchlist para un precio, la temperatura si no.'),
  bad_kind: () => tr('Type inconnu.', 'Unknown type.', 'Tipo desconocido.'),
  bad_level: () => tr('Niveau invalide : un nombre dans le domaine de son unité.', 'Invalid level: a number within its unit’s range.', 'Nivel no válido: un número dentro del dominio de su unidad.'),
};

/** Un code du process principal ou un refus du store, en clair. Un code inconnu donne une phrase générique qui le cite, jamais le code seul. */
export function cryptoCodeText(code: string): string {
  const text = Object.prototype.hasOwnProperty.call(CODE_TEXT, code) ? CODE_TEXT[code as keyof typeof CODE_TEXT] : undefined;
  return text ? text() : tr(`Demande refusée (motif : ${code}).`, `Request refused (reason: ${code}).`, `Petición rechazada (motivo: ${code}).`);
}

/** La base a refusé l'écriture : l'état a changé à l'écran, la ligne n'est pas enregistrée. */
export function saveFailedText(): string {
  return tr('Enregistrement impossible : la base du desk a refusé l’écriture.', 'Could not save: the desk database refused the write.', 'Imposible guardar: la base del desk rechazó la escritura.');
}

const isPriceKind = (kind: CryptoAlertKind): boolean => kind === 'price_above' || kind === 'price_below';

/** L'unité du niveau, puis la règle du franchissement (la même pour tous les genres). */
function levelHint(target: CryptoAlert['target'], kind: CryptoAlertKind): string {
  let unit: string;
  if (isPriceKind(kind)) {
    const spec = cryptoMarket(target);
    // Le pas de cotation du marché, dit pour repère : le niveau n'y est pas ramené (aucun contrôle ne le promet).
    const step = spec ? fmtPrice(spec.tickSize, spec.precision) : '';
    unit = spec
      ? tr(`Prix en ${spec.quote} ; le marché cote au pas de ${step}.`, `Price in ${spec.quote}; the market quotes in steps of ${step}.`, `Precio en ${spec.quote}; el mercado cotiza en pasos de ${step}.`)
      : tr('Prix dans la devise de cotation du marché.', 'Price in the market’s quote currency.', 'Precio en la divisa de cotización del mercado.');
  } else if (kind === 'funding_median_above' || kind === 'funding_median_below') {
    unit = tr('Pourcentage par intervalle de financement : 0.01 = 0,01 %.', 'Percent per funding interval: 0.01 = 0.01 %.', 'Porcentaje por intervalo de financiación: 0.01 = 0,01 %.');
  } else if (kind === 'breadth_above' || kind === 'breadth_below') {
    unit = tr('Part des paires USDT en hausse sur 24 h, en % : 40 = 40 %.', 'Share of USDT pairs up over 24 h, in %: 40 = 40 %.', 'Parte de los pares USDT al alza en 24 h, en %: 40 = 40 %.');
  } else {
    unit = tr('Dollars US sur l’heure glissante, un minorant.', 'US dollars over the rolling hour, a lower bound.', 'Dólares estadounidenses en la hora móvil, un mínimo.');
  }
  return `${unit} ${tr(
    'L’alerte se déclenche au franchissement du niveau : la première lecture ne fait que poser le côté.',
    'The alert fires when the level is crossed: the first reading only sets the side.',
    'La alerta salta al cruzar el nivel: la primera lectura solo fija el lado.',
  )}`;
}

/** Les genres qu'une cible admet : les prix pour un marché, les six lectures de température sinon. */
function kindsFor(target: CryptoAlert['target']): CryptoAlertKind[] {
  const price = isChartableMarket(target);
  return CRYPTO_ALERT_KINDS.filter((kind) => isPriceKind(kind) === price);
}

/** Le niveau saisi : un champ vide n'est pas zéro (un funding à 0 est un niveau valide). */
function readLevel(raw: string): number {
  const text = raw.trim().replace(',', '.');
  return text === '' ? Number.NaN : Number(text);
}

export type AlertInput = Pick<CryptoAlert, 'target' | 'kind' | 'level' | 'mode'>;

export function AlertModal({
  watchlist,
  defaultTarget,
  onClose,
  onCreate,
}: {
  /** Les marchés qu'une alerte de prix peut viser : ceux de la watchlist. */
  watchlist: readonly CryptoMarketId[];
  /** Le marché du chart, choisi d'abord s'il est dans la watchlist. */
  defaultTarget: CryptoMarketId;
  onClose: () => void;
  onCreate: (input: AlertInput) => Promise<WriteResult>;
}) {
  useI18n((st) => st.locale);
  const toast = useUi((u) => u.toast);
  const [target, setTarget] = useState<CryptoAlert['target']>(() => (watchlist.includes(defaultTarget) ? defaultTarget : (watchlist[0] ?? 'temperature')));
  const kinds = kindsFor(target);
  const [kind, setKind] = useState<CryptoAlertKind>(() => kindsFor(target)[0] ?? 'price_above');
  const [level, setLevel] = useState('');
  const [mode, setMode] = useState<CryptoAlert['mode']>('once');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickTarget = (next: CryptoAlert['target']) => {
    setTarget(next);
    const allowed = kindsFor(next);
    if (!allowed.includes(kind)) setKind(allowed[0] ?? kind);
    setError(null);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await onCreate({ target, kind, level: readLevel(level), mode });
      if (result.ok) {
        toast(tr('Alerte créée.', 'Alert created.', 'Alerta creada.'), 'ok');
        onClose();
      } else {
        setError(cryptoCodeText(result.reason));
      }
    } catch {
      // L'alerte est dans l'état, la base a refusé la ligne : la fenêtre se ferme, une seconde création la doublerait.
      toast(saveFailedText(), 'warn');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={tr('Nouvelle alerte', 'New alert', 'Nueva alerta')}
      onClose={onClose}
      dismissable={!busy}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tr('Annuler', 'Cancel', 'Cancelar')}
          </Button>
          <Button variant="gold" disabled={busy} onClick={() => void create()}>
            {tr('Créer l’alerte', 'Create alert', 'Crear la alerta')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label={tr('Cible', 'Target', 'Objetivo')}>
          <select value={target} onChange={(e) => pickTarget(e.target.value as CryptoAlert['target'])}>
            {watchlist.map((id) => (
              <option key={id} value={id}>
                {alertTargetText(id)}
              </option>
            ))}
            <option value="temperature">{alertTargetText('temperature')}</option>
          </select>
        </Field>
        <Field label={tr('Type', 'Type', 'Tipo')}>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as CryptoAlertKind);
              setError(null);
            }}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {alertKindText(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Niveau', 'Level', 'Nivel')} hint={levelHint(target, kind)} style={{ gridColumn: '1 / -1' }}>
          <input
            type="number"
            step="any"
            value={level}
            onChange={(e) => {
              setLevel(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) {
                e.preventDefault();
                void create();
              }
            }}
          />
        </Field>
        <Field label={tr('Mode', 'Mode', 'Modo')}>
          <select value={mode} onChange={(e) => setMode(e.target.value === 'rearm' ? 'rearm' : 'once')}>
            <option value="once">{tr('Une fois', 'Once', 'Una vez')}</option>
            <option value="rearm">{tr('Réarmée après un retour', 'Re-armed after a return', 'Rearmada tras un retorno')}</option>
          </select>
        </Field>
      </div>
      {error && (
        <p className={c.alertError} role="alert">
          {error}
        </p>
      )}
      <p className={v.desc} style={{ marginTop: 12 }}>
        {tr(
          'Locale, desk ouvert : un toast et un événement pour l’agent, sans notification système. Une donnée périmée ou bloquée n’est pas évaluée.',
          'Local, desk open: a toast and an event for the agent, no system notification. Stale or blocked data is not evaluated.',
          'Local, con el desk abierto: un toast y un evento para el agente, sin notificación del sistema. Un dato caducado o bloqueado no se evalúa.',
        )}
      </p>
    </Modal>
  );
}
