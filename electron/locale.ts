import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type AppLocale = 'fr' | 'en' | 'es';

export const LOCALE_FILE = 'locale.json';

/** Cache mémoire : `readLocaleFile` est appelé sur des chemins chauds (statut du pont, IPC). */
const cache = new Map<string, AppLocale>();

export function parseLocale(value: unknown): AppLocale | null {
  return value === 'fr' || value === 'en' || value === 'es' ? value : null;
}

export function readLocaleFile(userData: string): AppLocale {
  const hit = cache.get(userData);
  if (hit) return hit;
  let locale: AppLocale = 'fr';
  try {
    const raw = JSON.parse(readFileSync(path.join(userData, LOCALE_FILE), 'utf8')) as { locale?: unknown };
    locale = parseLocale(raw.locale) ?? 'fr';
  } catch {
    /* premier lancement : français */
  }
  cache.set(userData, locale);
  return locale;
}

export function writeLocaleFile(userData: string, locale: AppLocale): void {
  cache.set(userData, locale);
  writeFileSync(path.join(userData, LOCALE_FILE), `${JSON.stringify({ locale })}\n`, 'utf8');
}

/** Texte du process principal dans la langue enregistrée. */
export function uiText(locale: AppLocale, fr: string, en: string, es: string): string {
  if (locale === 'en') return en;
  if (locale === 'es') return es;
  return fr;
}
