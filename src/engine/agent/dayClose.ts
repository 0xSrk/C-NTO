/**
 * La journée fermée (décision 15 de l'ADMIN, 2026-11-03 : « On ferme la journée une fois la limite touchée. »). Une fois
 * la perte du jour atteinte — réalisé du jour plus latent négatif, au moins égal à la limite —, la journée CME reste fermée
 * aux ouvertures de l'agent jusqu'à la journée CME suivante, même si un gain ramène ensuite la perte sous la limite ; une
 * réduction de risque passe toujours (`guardProposal`). Le renderer tient sa fermeture au coffre ; le process principal
 * tient la sienne, dans son dossier de données, dès qu'il l'a vue : rien ici ne rouvre une journée, seule la journée CME
 * suivante la lève.
 * Un seul import, la journée CME du desk (`../tradingDay`) : ce module tourne dans le moteur et dans le process principal.
 */
import { cmeTradingDay } from '../tradingDay';

export interface AgentDayClose {
  /** La journée CME fermée (`cmeTradingDay`). */
  day: string;
  /** Le compte dont la perte du jour a atteint la limite ; '' : tous les comptes (la limite les suit tous). */
  account: string;
  /** Depuis quand (epoch ms) : la sortie qui a porté la perte à la limite, ou l'instant où elle a été vue. */
  at: number;
}

/** Fermetures retenues au plus, par journée : une par compte ; au-delà, une seule de tous les comptes. */
export const AGENT_DAY_CLOSE_MAX = 32;
const ACCOUNT_MAX = 128;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Contrôles (C0, C1), formats (bidi, largeur nulle), séparateurs de ligne et de paragraphe : un compte qui en porte est refusé. */
const CONTROL_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Le nom d'un compte replié : sans casse ni espaces de trop, comme la garde lit le pont (`heldPosition`, `sameAccount`). */
export function foldDayAccount(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Une fermeture relue d'un fichier, du coffre ou d'une IPC : une journée CME bien formée, un compte borné sans caractère de
 * contrôle ('' : tous les comptes), un instant fini de cette même journée. Sinon rien.
 */
export function parseDayClose(raw: unknown): AgentDayClose | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.day !== 'string' || !DAY_RE.test(r.day)) return null;
  if (typeof r.account !== 'string' || r.account.length > ACCOUNT_MAX || CONTROL_RE.test(r.account)) return null;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at) || cmeTradingDay(r.at) !== r.day) return null;
  return { day: r.day, account: r.account.trim().replace(/\s+/g, ' '), at: r.at };
}

const byTime = (a: AgentDayClose, b: AgentDayClose) => a.at - b.at || a.account.localeCompare(b.account);

/**
 * Journées retenues, outre celle de la fermeture qu'on ajoute : les plus récentes de la liste (OROS5.48k). L'horloge qui
 * écrit peut être fausse : aucune journée ne sort parce qu'elle serait « passée » à ses yeux, seule la plus ancienne sort
 * au-delà de trois. Chacune est bornée par le repli au-delà du plafond : quatre journées tiennent dans une liste relue.
 */
const DAYS_KEPT = 3;

/** Les `DAYS_KEPT` journées les plus récentes d'une liste. */
function recentDays(list: readonly AgentDayClose[]): Set<string> {
  return new Set([...new Set(list.map((c) => c.day))].sort().slice(-DAYS_KEPT));
}

/**
 * Ajoute une fermeture : une entrée par compte (nom replié) et par journée, l'heure la plus ancienne. Restent la journée
 * de la fermeture — celle de l'horloge qui l'envoie — et les trois plus récentes (OROS5.48f, OROS5.48k) : une horloge qui
 * avançait, puis corrigée, ne fait céder ni la journée qu'elle a fermée en avance ni la vraie, fermée avant ou après ;
 * seule la plus ancienne sort, au-delà de trois. Rien ne rouvre : une fermeture ne retire jamais une autre fermeture de
 * sa journée. Au-delà du plafond (OROS5.48e), les fermetures de la journée se replient en une seule, de tous les comptes,
 * à l'heure la plus ancienne : on ferme davantage, jamais moins, et aucune fermeture plus ancienne ne fait sortir la vraie.
 */
export function withDayClose(list: readonly AgentDayClose[], close: AgentDayClose): AgentDayClose[] {
  const days = recentDays([...list, close]).add(close.day);
  const out = list.filter((c) => days.has(c.day)).map((c) => ({ ...c }));
  const key = foldDayAccount(close.account);
  const same = out.find((c) => c.day === close.day && foldDayAccount(c.account) === key);
  if (same) same.at = Math.min(same.at, close.at);
  else out.push({ ...close });
  const day = out.filter((c) => c.day === close.day).sort(byTime);
  const kept = day.length <= AGENT_DAY_CLOSE_MAX ? day : [{ day: close.day, account: '', at: day[0]!.at }];
  return [...kept, ...out.filter((c) => c.day !== close.day)].sort((a, b) => a.day.localeCompare(b.day) || byTime(a, b));
}

/** Les fermetures lues d'une liste, une à une (`parseDayClose`) ; au plus quatre journées pleines. */
function readDayCloses(raw: unknown): AgentDayClose[] {
  return Array.isArray(raw) ? raw.slice(0, (DAYS_KEPT + 1) * AGENT_DAY_CLOSE_MAX).flatMap((item) => parseDayClose(item) ?? []) : [];
}

/** Restent les trois journées les plus récentes et, `now` donné, la journée CME en cours de l'horloge qui relit. */
function keepDayCloses(read: readonly AgentDayClose[], now?: number): AgentDayClose[] {
  const recent = recentDays(read);
  const today = now === undefined ? null : cmeTradingDay(now);
  // les plus récentes d'abord, puis celle de l'horloge : chacune reste (`withDayClose`)
  const order = [...read.filter((c) => recent.has(c.day)), ...read.filter((c) => c.day === today && !recent.has(c.day))];
  return order.reduce<AgentDayClose[]>((out, close) => withDayClose(out, close), []);
}

/**
 * Les fermetures relues d'une liste (fichier, coffre) : chacune lue par `parseDayClose`. Une valeur illisible : aucune.
 * Restent les trois journées les plus récentes et, `now` donné, la journée CME en cours de l'horloge qui relit (OROS5.48f,
 * OROS5.48k).
 */
export function coerceDayCloses(raw: unknown, now?: number): AgentDayClose[] {
  return keepDayCloses(readDayCloses(raw), now);
}

/** Deux listes réunies (un coffre restauré sur la fermeture en place), chacune lue en entier : rien des trois journées les plus récentes ni, `now` donné, de la journée en cours ne se perd. */
export function mergeDayCloses(a: unknown, b: unknown, now?: number): AgentDayClose[] {
  return keepDayCloses([...readDayCloses(a), ...readDayCloses(b)], now);
}

/** Une fermeture de tous les comptes vaut pour chacun ; celle d'un compte, pour ce compte seul, nom replié. */
function covers(close: AgentDayClose, account: string): boolean {
  return close.account === '' || foldDayAccount(close.account) === foldDayAccount(account);
}

/** Les fermetures qui valent pour `account`, toutes journées : la frise lit celle de la journée de son curseur. */
export function dayClosesFor(list: readonly AgentDayClose[], account: string): AgentDayClose[] {
  return list.filter((c) => covers(c, account));
}

/** La fermeture qui vaut pour `account` à `now` : celle de la journée CME en cours, la plus ancienne ; `null` sinon. */
export function dayCloseFor(list: readonly AgentDayClose[], account: string, now: number): AgentDayClose | null {
  const day = cmeTradingDay(now);
  let best: AgentDayClose | null = null;
  for (const c of list) if (c.day === day && covers(c, account) && (!best || c.at < best.at)) best = c;
  return best;
}
