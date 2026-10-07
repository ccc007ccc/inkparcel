import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh-CN.json';
import en from './locales/en.json';
export type Locale = 'zh-CN' | 'en';
export const localeStorageKey = 'inkparcel.locale';
export function normalizeLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'zh-CN';
}
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(localeStorageKey);
    if (saved !== null) return normalizeLocale(saved);
  } catch {
    /* Cookie preference still works when local storage is unavailable. */
  }
  if (typeof document !== 'undefined') {
    const match = /(?:^|;\s*)inkparcel_language=([^;]*)/.exec(document.cookie);
    if (match) return normalizeLocale(match[1]);
  }
  return 'zh-CN';
}
// Source-message keys keep Chinese copy readable; key separators must stay disabled.
const resources: Record<Locale, { translation: Record<keyof typeof zh, string> }> = {
  'zh-CN': { translation: zh },
  en: { translation: en },
};
void i18next.use(initReactI18next).init({
  resources,
  lng: initialLocale(),
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en'],
  keySeparator: false,
  nsSeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});
export const i18n = i18next;
export function t(key: string, values?: Record<string, unknown>): string {
  return i18next.t(
    key,
    values
      ? Object.fromEntries(
          Object.entries(values).map(([name, value]) => [
            name,
            typeof value === 'number' && name !== 'count'
              ? new Intl.NumberFormat(getLocale()).format(value)
              : value,
          ]),
        )
      : undefined,
  );
}
export const getLocale = (): Locale => normalizeLocale(i18next.resolvedLanguage);
export async function setLocale(value: unknown) {
  const locale = normalizeLocale(value);
  try {
    localStorage.setItem(localeStorageKey, locale);
  } catch {
    /* Language switching works without persistent storage. */
  }
  if (typeof document !== 'undefined')
    document.cookie = `inkparcel_language=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  await i18next.changeLanguage(locale);
}
export function errorMessageKey(code: string): string {
  const key = `error.${code}`;
  return Object.hasOwn(en, key) ? key : 'error.request_failed';
}
