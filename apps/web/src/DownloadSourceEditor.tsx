import { Field } from './components';
import { t } from './i18n';
import type { DownloadSource } from './lib';

export function DownloadSourceEditor({
  value,
  onChange,
}: {
  value: DownloadSource[];
  onChange: (value: DownloadSource[]) => void;
}) {
  function update(index: number, patch: Partial<DownloadSource>) {
    onChange(value.map((source, i) => (i === index ? { ...source, ...patch } : source)));
  }
  return (
    <fieldset className="download-source-editor stack">
      <legend>{t('下载源与可信域名')}</legend>
      <p className="muted small">
        {t(
          '添加直连或 CDN 域名，用户下载时可选择线路。这些域名也将获准访问本站 API，请只添加你管理的域名。',
        )}
      </p>
      {value.map((source, index) => (
        <div className="download-source-row" key={index}>
          <Field label={t('线路名称 {{value0}}', { value0: index + 1 })}>
            <input
              required
              maxLength={40}
              value={source.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
          </Field>
          <Field label={t('线路地址 {{value0}}', { value0: index + 1 })}>
            <input
              required
              type="url"
              maxLength={256}
              value={source.origin}
              placeholder="https://cdn.example.com"
              spellCheck={false}
              onChange={(event) => update(index, { origin: event.target.value })}
            />
          </Field>
          <button
            type="button"
            className="button button-quiet"
            aria-label={t('移除线路 {{value0}}', { value0: index + 1 })}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            {t('移除')}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button-secondary"
        disabled={value.length >= 8}
        onClick={() => onChange([...value, { name: '', origin: '' }])}
      >
        {t('添加下载源')}
      </button>
      <p className="muted small">
        {t(
          '最多 8 条，仅填写 HTTPS 域名，不含路径。当前访问域名始终可用。CDN 必须关闭 API 和下载缓存，并透传 Cookie、查询参数及 Range 请求头。',
        )}
      </p>
    </fieldset>
  );
}
