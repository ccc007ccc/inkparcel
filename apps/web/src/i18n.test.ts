import { afterEach, describe, expect, it } from 'vitest';
import { i18n, t, normalizeLocale, errorMessageKey } from './i18n';
import { date } from './lib';
import zh from './locales/zh-CN.json';
import en from './locales/en.json';
afterEach(async () => {
  await i18n.changeLanguage('zh-CN');
});
describe('Chinese and English localization', () => {
  it('has complete resources with matching interpolation parameters', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    const placeholders = (s: string) => [...s.matchAll(/{{([^}]+)}}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect(en[key].trim().length, key).toBeGreaterThan(0);
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]));
    }
  });
  it('falls back to Chinese and leaves interpolated identity text unchanged', async () => {
    expect(normalizeLocale('fr')).toBe('zh-CN');
    expect(normalizeLocale(null)).toBe('zh-CN');
    expect(t('站点设置')).toBe('站点设置');
    await i18n.changeLanguage('en');
    expect(t('站点设置')).toBe('Site settings');
    expect(t('删除 {{value0}}', { value0: '用户 <test> & 中文' })).toBe(
      'Delete 用户 <test> & 中文',
    );
    expect(t(errorMessageKey('invalid_access'))).toBe('Incorrect user ID or access code');
    expect(t(errorMessageKey('unexpected_backend_code'))).toBe(
      'Request failed. Please try again later',
    );
  });
  it('uses the selected locale for dates and translated counts', async () => {
    const stamp = '2026-10-07T12:00:00Z';
    await i18n.changeLanguage('en');
    expect(date(stamp)).toBe(
      new Intl.DateTimeFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        new Date(stamp),
      ),
    );
    expect(t('pagination.summary', { count: 1234 })).toBe('Items: 1,234');
    await i18n.changeLanguage('zh-CN');
    expect(t('pagination.summary', { count: 1 })).toBe('共 1 项');
  });
});
