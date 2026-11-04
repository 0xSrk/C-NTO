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

/** Fermetures retenues au plus : une par compte, sur la journée la plus récente. */
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

/**
 * Ajoute une fermeture : seule la journée la plus récente reste, une entrée par compte (nom replié), et l'heure la plus
 * ancienne. Rien ne rouvre : une fermeture ne retire jamais une autre fermeture de sa journée.
 */
export function withDayClose(list: readonly AgentDayClose[], close: AgentDayClose): AgentDayClose[] {
  const latest = list.reduce((max, c) => (c.day > max ? c.day : max), close.day);
  const out = list.filter((c) => c.day === latest).map((c) => ({ ...c }));
  if (close.day !== latest) return out;
  const key = foldDayAccount(close.account);
  const same = out.find((c) => foldDayAccount(c.account) === key);
  if (same) same.at = Math.min(same.at, close.at);
  else out.push({ ...close });
  return out.sort((a, b) => a.at - b.at || a.account.localeCompare(b.account)).slice(0, AGENT_DAY_CLOSE_MAX);
}

/** Les fermetures relues d'une liste (fichier, coffre) : chacune lue par `parseDayClose`. Une valeur illisible : aucune. */
export function coerceDayCloses(raw: unknown): AgentDayClose[] {
  if (!Array.isArray(raw)) return [];
  let out: AgentDayClose[] = [];
  for (const item of raw.slice(0, 4 * AGENT_DAY_CLOSE_MAX)) {
    const close = parseDayClose(item);
    if (close) out = withDayClose(out, close);
  }
  return out;
}

/** Deux listes réunies (un coffre restauré sur la fermeture en place) : rien de la journée la plus récente ne se perd. */
export function mergeDayCloses(a: unknown, b: unknown): AgentDayClose[] {
  return coerceDayCloses([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
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
