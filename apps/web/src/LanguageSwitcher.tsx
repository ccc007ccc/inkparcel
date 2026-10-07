import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getLocale, setLocale, t } from './i18n';
export function LanguageSwitcher({ inline = false }: { inline?: boolean }) {
  const { i18n } = useTranslation();
  const locale = getLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale, i18n]);
  return (
    <div className={`language-switcher${inline ? ' language-inline' : ''}`}>
      <label>
        <span>{t('locale.label')}</span>
        <select
          aria-label="语言 / Language"
          value={locale}
          onChange={(event) => void setLocale(event.target.value)}
        >
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
      </label>
    </div>
  );
}
