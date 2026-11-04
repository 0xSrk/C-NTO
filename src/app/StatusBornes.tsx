import { Glyph, Signal } from '@/design/Micro';
import { cx, Led } from '@/design/primitives';
import type { BorneLevel, DayBornes } from '@/engine/bornes';
import { tr, useI18n } from '@/i18n';
import { fmtInt, fmtPct, fmtUsd } from '@/lib/format';
import { useBridge } from '@/store/bridge';
import { dayClosedText } from '@/store/deskEvents';
import { useObjects } from '@/store/objects';
import { useUi } from '@/store/ui';
import { etClock, shortDay } from './objects/index';
import { useDayBornes } from './useDayBornes';
import s from './shell.module.css';

/**
 * La ligne de la journée dans la barre d'état (OROS5.22, Système 5 « Fiche et Frise », décision 7 de l'ADMIN) : le pont
 * et son âge, les comptes qu'il rapporte et sa latence, puis les bornes du jour lues du calcul unique (`useDayBornes`,
 * `src/engine/bornes.ts`) — la perte du jour sur sa limite et sa source, les trades sur leur maximum, la marge datée.
 * Faute de valeur, « — », jamais 0 ; rien de réglé, « Bornes à régler ». La borne la plus proche passe à l'ivoire, les
 * autres restent au graphite ; à 75 % de la limite, C.012 ; au-delà, le niveau 3 par la primitive Signal.
 *
 * Chaque cellule porte son nom accessible complet et ouvre la fiche Compte du compte suivi (OROS5.27), ou sa coupe de
 * Métrique quand les bornes suivent tous les comptes ; rien n'écrit : la barre lit,
 * la garde reste au process principal. 28 px, pas un de plus.
 */

export type BorneCellKey = 'loss' | 'trades' | 'margin' | 'settings';

/**
 * Où une cellule mène : la fiche Compte du compte que les bornes suivent (OROS5.27, décision 11) ; sans compte suivi (tous
 * les comptes agrégés), la coupe existante de Métrique ; rien de réglé, les Réglages du desk.
 */
export interface BorneTarget {
  tab: 'metrique';
  view?: 'bord' | 'prop';
  modal?: 'reglages';
  /** Le compte suivi : la cellule ouvre sa fiche. */
  account?: string;
}

/** La fiche Compte du compte borné, ou la coupe de Métrique quand les bornes suivent tous les comptes. */
const borneTarget = (account: string | null, view: 'bord' | 'prop'): BorneTarget => (account ? { tab: 'metrique', view, account } : { tab: 'metrique', view });

export interface BorneCell {
  key: BorneCellKey;
  level: BorneLevel;
  /** La borne la plus proche de sa limite (`DayBornes.nearest`) : à l'ivoire. */
  nearest: boolean;
  /** Le nom, entier puis court (la barre à l'étroit). */
  name: string;
  short: string;
  /** La valeur lue sur sa borne : « 386 / 500 $ », « — / 500 $ » ; datée quand elle n'est pas du jour (« · 30.10 »). */
  value: string;
  /** La valeur à l'étroit, quand elle a une forme courte (« objectif · 16.04 »), puis plus étroite (« 16.04 »). */
  valueShort?: string;
  valueNarrow?: string;
  /** D'où vient la limite de la perte du jour : la règle du trader (C.109) ou le plan. */
  source?: 'trader' | 'plan';
  /** Les trades pris et leur maximum, pour la matrice C.114. */
  matrix?: { count: number | null; max: number };
  /** Une valeur datée d'une autre journée que celle qu'on lit, ou périmée : C.013. */
  stale?: boolean;
  /** Une borne hors service (objectif atteint, compte invalidé) : au graphite, sans or ni signal. */
  off?: boolean;
  /** Le nom accessible, complet. */
  label: string;
  target: BorneTarget;
}

/** L'âge d'une lecture du pont : « 4 s », « 2 min », « 1 h ». */
export function ageText(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 90) return `${sec} s`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min} min`;
  return `${Math.round(min / 60)} h`;
}

/** D'où viennent les valeurs vives : le pont et l'âge de sa lecture, le journal du jour, ou la dernière séance. */
export function readFrom(b: DayBornes): string {
  const { day } = b;
  if (day.live) {
    if (day.ageMs === null) return tr('pont, âge inconnu', 'bridge, age unknown', 'puente, antigüedad desconocida');
    const age = ageText(day.ageMs);
    return day.stale ? tr(`pont périmé, lu il y a ${age}`, `stale bridge, read ${age} ago`, `puente caducado, leído hace ${age}`) : tr(`pont il y a ${age}`, `bridge ${age} ago`, `puente hace ${age}`);
  }
  if (day.today) return tr('journal du jour', 'today’s journal', 'diario del día');
  if (day.key) return tr(`dernière séance, ${shortDay(day.key)}`, `last session, ${shortDay(day.key)}`, `última sesión, ${shortDay(day.key)}`);
  return tr('aucune séance lue', 'no session read', 'ninguna sesión leída');
}

const accountWords = (account: string | null) => (account ? tr(`compte ${account}`, `account ${account}`, `cuenta ${account}`) : tr('tous les comptes', 'all accounts', 'todas las cuentas'));

/** La journée lue n'est pas celle de maintenant (la dernière séance, hors séance) : la valeur dit sa date, avec C.013. */
const datedDay = (b: DayBornes): string | null => (!b.day.today && b.day.key ? shortDay(b.day.key) : null);

/**
 * Une valeur datée d'une autre journée garde sa date jusqu'à 1 480 px ; plus à l'étroit, la date cède et C.013 la marque
 * seul, le nom accessible la disant toujours (OROS5.45 : la barre tient à 1180 × 720 dans les trois langues).
 */
function undated(bare: string, dated: string | null): Pick<BorneCell, 'valueShort' | 'valueNarrow'> {
  return dated ? { valueShort: `${bare} · ${dated}`, valueNarrow: bare } : {};
}

function lossCell(b: DayBornes): BorneCell | null {
  const { loss } = b;
  // La journée fermée (décision 15) : dite par les mots de la garde, jusqu'à la journée CME suivante. Retirer la limite
  // après la fermeture ne la rouvre pas : la cellule reste, et dit la seule fermeture (OROS5.48h).
  const closed = loss.closedSince !== null ? dayClosedText(loss.closedSince) : null;
  if (loss.limit === null && !closed) return null;
  const limit = loss.limit === null ? null : fmtUsd(loss.limit);
  const plan = b.margin.planLabel;
  const source = loss.source === 'plan' ? (plan ? tr(`plan ${plan}`, `plan ${plan}`, `plan ${plan}`) : tr('plan suivi', 'tracked plan', 'plan seguido')) : tr('règle du trader', 'trader rule', 'regla del trader');
  const parts: string[] = [];
  if (limit === null) {
    parts.push(loss.value === null ? tr('Perte du jour non lue', 'Day loss not read', 'Pérdida del día no leída') : tr(`Perte du jour ${fmtInt(loss.value)}`, `Day loss ${fmtInt(loss.value)}`, `Pérdida del día ${fmtInt(loss.value)}`));
    parts.push(tr('aucune limite réglée', 'no limit set', 'ningún límite ajustado'));
  } else if (loss.value === null) parts.push(tr(`Perte du jour non lue, limite ${limit}`, `Day loss not read, limit ${limit}`, `Pérdida del día no leída, límite ${limit}`));
  else {
    parts.push(tr(`Perte du jour ${fmtInt(loss.value)} sur ${limit}`, `Day loss ${fmtInt(loss.value)} of ${limit}`, `Pérdida del día ${fmtInt(loss.value)} de ${limit}`));
    const rest = loss.remaining ?? 0;
    const left = Math.round(rest);
    if (left > 0) parts.push(tr(`reste ${fmtInt(rest)}`, `${fmtInt(rest)} left`, `quedan ${fmtInt(rest)}`));
    else if (left === 0) parts.push(tr('limite atteinte', 'limit reached', 'límite alcanzado'));
    else parts.push(tr(`dépassée de ${fmtInt(-rest)}`, `exceeded by ${fmtInt(-rest)}`, `superada en ${fmtInt(-rest)}`));
    if (loss.level === 2 && loss.consumed !== null) parts.push(tr(`${fmtPct(loss.consumed, 0)} de la limite`, `${fmtPct(loss.consumed, 0)} of the limit`, `${fmtPct(loss.consumed, 0)} del límite`));
  }
  if (closed) parts.push(closed);
  if (limit !== null) parts.push(source);
  parts.push(accountWords(loss.account), readFrom(b));
  const dated = datedDay(b);
  const read = loss.value === null ? '—' : fmtInt(loss.value);
  const bare = limit === null ? read : `${read} / ${limit}`;
  return {
    key: 'loss',
    level: loss.level,
    nearest: b.nearest === 'loss',
    name: tr('Perte du jour', 'Day loss', 'Pérdida del día'),
    short: tr('Perte', 'Loss', 'Pérdida'),
    // Fermée, la valeur le dit en entier, puis l'heure seule à l'étroit ; la réponse du temps le redit dans sa forme courte.
    value: closed ? `${bare} · ${closed}` : `${bare}${dated ? ` · ${dated}` : ''}`,
    ...(closed && loss.closedSince !== null ? { valueShort: `${bare} · ${tr('fermée', 'closed', 'cerrada')} ${etClock(loss.closedSince)}`, valueNarrow: bare } : undated(bare, dated)),
    ...(limit !== null ? { source: loss.source ?? 'trader' } : {}),
    stale: b.day.stale || dated !== null,
    label: parts.join(', '),
    target: borneTarget(loss.account, 'bord'),
  };
}

function tradesCell(b: DayBornes): BorneCell | null {
  const { trades } = b;
  if (trades.max === null) return null;
  const parts: string[] = [];
  if (trades.count === null) parts.push(tr(`Trades non lus, au plus ${fmtInt(trades.max)}`, `Trades not read, at most ${fmtInt(trades.max)}`, `Trades no leídos, como máximo ${fmtInt(trades.max)}`));
  else {
    parts.push(tr(`Trades ${fmtInt(trades.count)} sur ${fmtInt(trades.max)}`, `Trades ${fmtInt(trades.count)} of ${fmtInt(trades.max)}`, `Trades ${fmtInt(trades.count)} de ${fmtInt(trades.max)}`));
    const left = trades.max - trades.count;
    if (left > 0) parts.push(tr(`reste ${fmtInt(left)}`, `${fmtInt(left)} left`, `quedan ${fmtInt(left)}`));
    else if (left === 0) parts.push(tr('maximum atteint', 'maximum reached', 'máximo alcanzado'));
    else parts.push(tr(`dépassé de ${fmtInt(-left)}`, `exceeded by ${fmtInt(-left)}`, `superado en ${fmtInt(-left)}`));
  }
  parts.push(tr('règle du trader', 'trader rule', 'regla del trader'), accountWords(b.loss.account), readFrom(b));
  const dated = datedDay(b);
  return {
    key: 'trades',
    level: trades.level,
    nearest: b.nearest === 'trades',
    name: tr('Trades', 'Trades', 'Trades'),
    short: tr('Trades', 'Trades', 'Trades'),
    value: `${trades.count === null ? '—' : fmtInt(trades.count)} / ${fmtInt(trades.max)}${dated ? ` · ${dated}` : ''}`,
    ...undated(`${trades.count === null ? '—' : fmtInt(trades.count)} / ${fmtInt(trades.max)}`, dated),
    matrix: { count: trades.count, max: trades.max },
    stale: b.day.stale || dated !== null,
    label: parts.join(', '),
    target: borneTarget(b.loss.account, 'bord'),
  };
}

function marginCell(b: DayBornes): BorneCell | null {
  const { margin } = b;
  if (margin.planLabel === null) return null;
  const date = margin.date ? shortDay(margin.date) : null;
  const state =
    margin.status === 'objectif' ? tr('objectif atteint', 'target reached', 'objetivo alcanzado') : margin.status === 'echec' ? tr('compte invalidé', 'account failed', 'cuenta invalidada') : null;
  const stateShort = margin.status === 'objectif' ? tr('objectif', 'target', 'objetivo') : margin.status === 'echec' ? tr('invalidé', 'failed', 'invalidada') : null;
  const amount = margin.value === null ? '—' : fmtUsd(margin.value);
  const when = date ? ` · ${date}` : '';
  const value = state ? `${state}${when}` : `${amount}${when}`;
  const parts: string[] = [];
  if (margin.value === null) parts.push(tr('Marge au plancher non lue', 'Margin to floor not read', 'Margen al suelo no leído'));
  else {
    parts.push(tr(`Marge au plancher ${fmtUsd(margin.value)}`, `Margin to floor ${fmtUsd(margin.value)}`, `Margen al suelo ${fmtUsd(margin.value)}`));
    if (margin.share !== null) parts.push(tr(`${fmtPct(margin.share, 0)} du drawdown`, `${fmtPct(margin.share, 0)} of the drawdown`, `${fmtPct(margin.share, 0)} del drawdown`));
  }
  if (state) parts.push(state);
  if (date) parts.push(tr(`datée du ${date}`, `dated ${date}`, `fechado el ${date}`));
  parts.push(margin.planLabel, accountWords(margin.account));
  if (margin.live) parts.push(tr('latent négatif retranché', 'negative open P&L deducted', 'latente negativo deducido'));
  return {
    key: 'margin',
    level: margin.level,
    nearest: b.nearest === 'margin',
    name: tr('Marge', 'Margin', 'Margen'),
    short: tr('Marge', 'Margin', 'Margen'),
    value,
    // Hors service, l'état cède à l'étroit (« objectif · 16.04 », puis la date seule) : le nom accessible le garde entier.
    ...(stateShort ? { valueShort: `${stateShort}${when}`, valueNarrow: date ?? stateShort } : {}),
    stale: margin.otherDay || b.day.stale,
    off: !margin.inService,
    label: parts.join(', '),
    target: borneTarget(margin.account, 'prop'),
  };
}

/**
 * Les cellules des bornes de la journée, lues de `dayBornes` : la perte du jour (une limite réglée, par la règle ou le
 * plan), les trades (un maximum réglé), la marge (un plan suivi). Rien de réglé : une seule cellule, « Bornes à
 * régler », qui ouvre les Réglages du desk.
 */
export function borneCells(b: DayBornes): BorneCell[] {
  const cells = [lossCell(b), tradesCell(b), marginCell(b)].filter((cell): cell is BorneCell => cell !== null);
  if (cells.length > 0) return cells;
  return [
    {
      key: 'settings',
      level: 0,
      nearest: false,
      name: tr('Bornes à régler', 'Bounds to set', 'Límites por ajustar'),
      short: tr('Bornes à régler', 'Bounds to set', 'Límites por ajustar'),
      value: '',
      label: tr(
        'Bornes à régler : ni limite de perte du jour, ni maximum de trades, ni plan suivi. Ouvre les Réglages du desk.',
        'Bounds to set: no day loss limit, no trade maximum, no tracked plan. Opens the desk settings.',
        'Límites por ajustar: ni límite de pérdida del día, ni máximo de trades, ni plan seguido. Abre los ajustes del desk.',
      ),
      target: { tab: 'metrique', modal: 'reglages' },
    },
  ];
}

/** Le nom accessible du pont : l'état du lien et l'âge de sa dernière lecture. */
export function bridgeLabel(b: DayBornes, link: string | null): string {
  if (link !== 'live') return tr('Pont NT8 hors ligne', 'NT8 bridge offline', 'Puente NT8 fuera de línea');
  if (b.day.ageMs === null) return tr('Pont NT8 en direct', 'NT8 bridge live', 'Puente NT8 en directo');
  const age = ageText(b.day.ageMs);
  return b.day.stale
    ? tr(`Pont NT8 en direct, lecture périmée, il y a ${age}`, `NT8 bridge live, stale reading, ${age} ago`, `Puente NT8 en directo, lectura caducada, hace ${age}`)
    : tr(`Pont NT8 en direct, comptes lus il y a ${age}`, `NT8 bridge live, accounts read ${age} ago`, `Puente NT8 en directo, cuentas leídas hace ${age}`);
}

/**
 * Ouvre ce qu'une cellule montre, par un saut que Retour arrière défait : la fiche Compte du compte suivi (le focus passe à
 * la fiche, Échap le rend à la cellule), ou la coupe de Métrique. Rien sous le verrou.
 */
export function openBorne(target: BorneTarget, origin?: HTMLElement | null): boolean {
  if (target.account) return useObjects.getState().openObject({ type: 'compte', id: target.account }, { jump: true, focus: true, origin: origin ?? null });
  if (!useObjects.getState().jumpTo(target.tab, target.view ? { view: target.view } : {})) return false;
  if (target.modal) useUi.getState().requestModal(target.tab, target.modal);
  return true;
}

/**
 * C.114, la matrice des entrées : une pastille par trade permis, pleine quand il est pris, creuse sinon ; douze au plus,
 * remplies dans la même proportion au-delà. Tirée des données de la cellule, à l'encre de la zone ; ce n'est pas un glyphe
 * de la planche. Au-delà du maximum, le niveau 3 se dit par la primitive Signal, pas par la matrice.
 */
export function TradesMatrix({ count, max, className }: { count: number | null; max: number; className?: string }) {
  const shown = Math.max(1, Math.min(12, Math.round(max)));
  const taken = count === null ? 0 : Math.min(shown, Math.round((Math.max(0, count) / Math.max(1, max)) * shown));
  const rows = shown > 6 ? 2 : 1;
  const cols = Math.ceil(shown / rows);
  const pitch = 4.5;
  const r = 1.5;
  return (
    <svg className={className} width={cols * pitch} height={rows * pitch} viewBox={`0 0 ${cols * pitch} ${rows * pitch}`} aria-hidden="true" data-taken={taken} data-shown={shown}>
      {Array.from({ length: shown }, (_, i) => {
        const cx = (i % cols) * pitch + pitch / 2;
        const cy = Math.floor(i / cols) * pitch + pitch / 2;
        return i < taken ? <circle key={i} cx={cx} cy={cy} r={r} fill="var(--k)" /> : <circle key={i} cx={cx} cy={cy} r={r - 0.4} fill="none" stroke="var(--k)" strokeWidth={0.8} />;
      })}
    </svg>
  );
}

/** Une cellule : le signal (niveau 2 ou 3), le signe de la borne, son nom, sa valeur, et la source de sa limite. */
function Cell({ cell }: { cell: BorneCell }) {
  return (
    <button
      type="button"
      className={cx(s.borne, cell.nearest && s.borneNear, cell.off && s.borneOff)}
      data-borne={cell.key}
      data-level={cell.level}
      data-nearest={cell.nearest ? '' : undefined}
      aria-label={cell.label}
      title={cell.label}
      onClick={(event) => openBorne(cell.target, event.currentTarget)}
    >
      {!cell.off && cell.level === 3 ? <Signal level={3} className={s.borneSignal} /> : !cell.off && cell.level === 2 ? <Signal level={2} className={s.borneSignal} /> : null}
      {cell.key === 'trades' && cell.matrix ? <TradesMatrix count={cell.matrix.count} max={cell.matrix.max} className={s.borneMatrix} /> : null}
      {cell.key === 'margin' ? <Glyph name="margin" className={s.borneMargin} /> : null}
      {cell.key === 'settings' ? <Glyph name="settings" className={s.borneGlyph} /> : null}
      {cell.stale ? <Glyph name="stale" className={s.borneStale} /> : null}
      <span className={s.borneName}>
        <span className={s.borneLong}>{cell.name}</span>
        <span className={s.borneShort} aria-hidden>
          {cell.short}
        </span>
      </span>
      {cell.value ? (
        cell.valueShort ? (
          <b className={s.borneValue}>
            <span className={s.valueLong}>{cell.value}</span>
            <span className={s.valueShort}>{cell.valueShort}</span>
            <span className={s.valueNarrow}>{cell.valueNarrow ?? cell.valueShort}</span>
          </b>
        ) : (
          <b className={s.borneValue}>{cell.value}</b>
        )
      ) : null}
      {/* La source de la limite : C.109, le signe des règles du trader, ou le plan, en mot. */}
      {cell.key === 'loss' && cell.source ? (
        cell.source === 'plan' ? (
          <span className={s.borneSource} data-source="plan">
            {tr('plan', 'plan', 'plan')}
          </span>
        ) : (
          <span className={s.borneSource} data-source="trader">
            <Glyph name="traderRule" className={s.borneGlyph} />
          </span>
        )
      ) : null}
    </button>
  );
}

/**
 * Un libellé dont les mots cèdent à l'étroit (`.statusWord`) : la valeur reste, dans l'ordre de la langue (« il y a 4 s »,
 * « 4 s ago », « hace 4 s »).
 */
function Words({ parts }: { parts: readonly [before: string, core: string, after: string] }) {
  const [before, core, after] = parts;
  // Un seul élément : dans une ligne flexible, l'espace d'un mot ne s'ajoute pas à l'écart des éléments.
  return (
    <span className={s.statusWords}>
      {before ? <span className={s.statusWord}>{before}</span> : null}
      {core}
      {after ? <span className={s.statusWord}>{after}</span> : null}
    </span>
  );
}

/**
 * La ligne de la journée, à gauche de la barre d'état : le pont, l'âge de sa lecture, ses comptes et sa latence — lisibles,
 * jamais dans une ellipse —, puis les bornes du jour.
 */
export function StatusBornes() {
  useI18n((st) => st.locale);
  const b = useDayBornes();
  const nt = useBridge((st) => st.nt);
  const live = nt?.link === 'live';
  const reported = nt?.accountNames?.filter(Boolean) ?? [];
  const cells = borneCells(b);
  const bridge = bridgeLabel(b, nt?.link ?? null);
  const age = live && b.day.ageMs !== null ? ageText(b.day.ageMs) : null;
  const latency = nt?.heartbeatLatencyMs ?? null;
  return (
    <>
      <span className={s.statusLive} role="group" aria-label={bridge} title={bridge} data-status="bridge">
        <Led on={live}>
          <Words parts={[tr('PONT ', '', 'PUENTE '), 'NT8', tr('', ' BRIDGE', '')]} />
        </Led>
        {' · '}
        {live ? 'LIVE' : tr('HORS LIGNE', 'OFFLINE', 'FUERA DE LÍNEA')}
        {age !== null ? (
          <span className={s.statusAge}>
            {' · '}
            {b.day.stale ? <Glyph name="stale" className={s.borneStale} /> : null}
            <Words parts={[tr('il y a ', '', 'hace '), age, tr('', ' ago', '')]} />
          </span>
        ) : null}
      </span>
      {reported.length > 0 ? (
        <span className={s.statusKeep} data-status="accounts" title={tr('Comptes rapportés par le pont', 'Accounts reported by the bridge', 'Cuentas informadas por el puente')}>
          {reported.join(' · ')}
        </span>
      ) : null}
      {latency !== null ? (
        <span className={s.statusKeep} data-status="latency" title={tr(`Latence du pont : ${latency} ms`, `Bridge latency: ${latency} ms`, `Latencia del puente: ${latency} ms`)}>
          <Words parts={[tr('LATENCE ', 'LATENCY ', 'LATENCIA '), `${latency} MS`, '']} />
        </span>
      ) : null}
      <i className={s.statusSep} aria-hidden />
      <span className={s.bornes} role="group" aria-label={tr('Bornes de la journée', 'Bounds of the day', 'Límites de la jornada')} data-status="bornes">
        {cells.map((cell) => (
          <Cell key={cell.key} cell={cell} />
        ))}
      </span>
    </>
  );
}
