import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type AppLocale = 'fr' | 'en' | 'es';

export const LOCALE_FILE = 'locale.json';

export function parseLocale(value: unknown): AppLocale | null {
  return value === 'fr' || value === 'en' || value === 'es' ? value : null;
}

export function readLocaleFile(userData: string): AppLocale {
  try {
    const raw = JSON.parse(readFileSync(path.join(userData, LOCALE_FILE), 'utf8')) as { locale?: unknown };
    return parseLocale(raw.locale) ?? 'fr';
  } catch {
    return 'fr';
  }
}

export function writeLocaleFile(userData: string, locale: AppLocale): void {
  writeFileSync(path.join(userData, LOCALE_FILE), `${JSON.stringify({ locale })}\n`, 'utf8');
}

/** Texte du process principal dans la langue enregistrée. */
export function uiText(locale: AppLocale, fr: string, en: string, es: string): string {
  if (locale === 'en') return en;
  if (locale === 'es') return es;
  return fr;
}
