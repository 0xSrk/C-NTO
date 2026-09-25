import { create } from 'zustand';
import { desk } from '@/lib/desk';

export type Locale = 'fr' | 'en' | 'es';

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
];

const INTL: Record<Locale, string> = { fr: 'fr-FR', en: 'en-US', es: 'es-ES' };

export function parseLocale(value: unknown): Locale | null {
  return value === 'fr' || value === 'en' || value === 'es' ? value : null;
}

export function intlTag(locale: Locale = useI18n.getState().locale): string {
  return INTL[locale];
}

function localeFromLocation(): Locale | null {
  if (typeof window === 'undefined') return null;
  return parseLocale(new URLSearchParams(window.location.search).get('lang'));
}

function localeFromStorage(): Locale | null {
  try {
    return parseLocale(localStorage.getItem('canto.locale'));
  } catch {
    return null;
  }
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18n = create<I18nState>((set) => ({
  locale: localeFromLocation() ?? localeFromStorage() ?? 'fr',
  setLocale: (locale) => {
    try {
      localStorage.setItem('canto.locale', locale);
    } catch {
      /* navigation privée */
    }
    applyDocumentLocale(locale);
    set({ locale });
  },
}));

applyDocumentLocale(useI18n.getState().locale);

/** Texte selon la langue active. À appeler au moment du rendu ou de l'action. */
export function tr(fr: string, en: string, es: string): string {
  const locale = useI18n.getState().locale;
  if (locale === 'en') return en;
  if (locale === 'es') return es;
  return fr;
}

/** Enregistre la langue pour le launcher et le desk, puis l'applique tout de suite. */
export async function chooseLocale(locale: Locale): Promise<void> {
  useI18n.getState().setLocale(locale);
  if (desk?.locale) await desk.locale.set(locale);
}

/** Abonne le composant à la langue pour qu'il se réaffiche. */
export function useTr(): (fr: string, en: string, es: string) => string {
  const locale = useI18n((s) => s.locale);
  return (fr, en, es) => (locale === 'en' ? en : locale === 'es' ? es : fr);
}
