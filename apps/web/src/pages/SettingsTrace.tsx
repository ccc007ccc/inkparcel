import { t } from '../i18n';
import { useSite } from '../site';
import { useRef, useState, useEffect, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileBox,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { blobSource, formatFor, supportedExtensions } from '@inkparcel/marking';
import { Alert, Field, PageHeading, Spinner } from '../components';
import {
  api,
  bytes,
  date,
  message,
  passwordKey,
  passwordSalt,
  patch,
  post,
  type AdminFile,
  type Download,
  type Key,
  type Settings,
  type User,
} from '../lib';
import type { AdminProps } from '../Admin';
interface TraceResult {
  authentic: true;
  contentMatch: boolean | null;
  record: Download;
  user: User;
  key: Key;
  file: AdminFile;
  signedName: string;
}
export function TracePage({ base }: AdminProps) {
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState<TraceResult>();
  const [stage, setStage] = useState<'idle' | 'extracting' | 'hashing' | 'verifying'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );
  async function inspect(selected: File) {
    const current = ++run.current;
    setFile(selected);
    setResult(undefined);
    setError('');
    setProgress(0);
    setStage('extracting');
    try {
      const format = formatFor(selected.name);
      const source = blobSource(selected);
      const marker = await format.handler.extract(source);
      if (current !== run.current) return;
      if (!marker) {
        setError('未找到本站标记。该文件可能尚未经过本站分发，或标记已被移除。');
        return;
      }
      setStage('hashing');
      const fingerprint = await format.fingerprint(source, (done, total) => {
        if (current !== run.current) throw new DOMException(t('已取消'), 'AbortError');
        setProgress(total ? done / total : 0);
      });
      if (current !== run.current) return;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(marker);
      setStage('verifying');
      const result = await post<TraceResult>(`${base}/api/trace`, { marker: text, fingerprint });
      if (current === run.current) setResult(result);
    } catch (error) {
      if (current === run.current) setError(message(error));
    } finally {
      if (current === run.current) setStage('idle');
    }
  }
  return (
    <>
      <PageHeading eyebrow={t('VERIFY THE ORIGIN')} title={t('文件溯源')}>
        {t('从文件中读取专属标记，核验它对应的领取者与版本。')}
      </PageHeading>
      <div className="trace-layout">
        <section>
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept={supportedExtensions.join(',')}
            aria-label={t('选择待溯源文件')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void inspect(file);
              event.target.value = '';
            }}
          />
          <button
            className="drop-zone trace-drop"
            disabled={stage !== 'idle'}
            onClick={() => input.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (stage === 'idle' && event.dataTransfer.files[0])
                void inspect(event.dataTransfer.files[0]);
            }}
          >
            <Fingerprint size={43} strokeWidth={1.2} />
            <strong>{t('选择要验证的文件')}</strong>
            <span>{t('拖放文件到这里，或点击选择')}</span>
            <span className="tag">{t('当前支持 APK')}</span>
          </button>
          {file && (
            <div className="upload-file">
              <FileBox size={22} />
              <div>
                <strong>{file.name}</strong>
                <span>{bytes(file.size)}</span>
              </div>
            </div>
          )}
          {stage !== 'idle' && (
            <div className="trace-progress">
              <Spinner
                label={
                  stage === 'extracting'
                    ? t('正在本地读取标记…')
                    : stage === 'hashing'
                      ? t('正在本地核对内容指纹…')
                      : t('正在验证领取记录…')
                }
              />
              {stage === 'hashing' && (
                <>
                  <progress value={progress} max={1} aria-label={t('本地指纹计算进度')} />
                  <span className="muted small">{Math.round(progress * 100)}%</span>
                </>
              )}
            </div>
          )}
          <Alert>{error}</Alert>
        </section>
        <aside className="trace-explainer">
          <span className="eyebrow">{t('LOCAL FIRST')}</span>
          <h2>{t('文件留在你的浏览器。')}</h2>
          <p>{t('标记读取和内容指纹计算都在本地完成。服务端只接收标记与指纹，不接收所选文件。')}</p>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>{t('本地读取')}</strong>
                <p>{t('提取文件中的专属标记。')}</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>{t('内容比对')}</strong>
                <p>{t('验证文件内容是否与签发版本一致。')}</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>{t('核验来处')}</strong>
                <p>{t('关联领取者、版本及领取记录。')}</p>
              </div>
            </li>
          </ol>
        </aside>
      </div>
      {result && (
        <section className="trace-result">
          <div className="result-heading">
            <CheckCircle2 size={27} />
            <div>
              <h2>{t('标记验证通过')}</h2>
              <p>{t('该标记对应本站的一次真实签发。')}</p>
            </div>
          </div>
          <div className={`content-verdict ${result.contentMatch ? 'match' : 'mismatch'}`}>
            {result.contentMatch ? <ShieldCheck size={22} /> : <AlertTriangle size={22} />}
            <div>
              <strong>
                {result.contentMatch === true
                  ? t('文件内容与签发版本一致')
                  : result.contentMatch === false
                    ? t('文件内容与签发版本不一致')
                    : t('未核验文件内容')}
              </strong>
              <p>
                {result.contentMatch === true
                  ? t('规范化内容指纹匹配，版本与签名身份一致。')
                  : t('标记有效不能证明此文件就是当时签发的完整文件。请结合其他证据判断。')}
              </p>
            </div>
          </div>
          <dl className="trace-details">
            <div>
              <dt>{t('领取者')}</dt>
              <dd>{result.user.userId}</dd>
            </div>
            <div>
              <dt>{t('访问密钥')}</dt>
              <dd>
                {result.key.name}
                {!result.key.enabled && <span className="tag">{t('已停用')}</span>}
              </dd>
            </div>
            <div>
              <dt>{t('签发时的文件名')}</dt>
              <dd>{result.signedName}</dd>
            </div>
            <div>
              <dt>{t('领取时间')}</dt>
              <dd>{date(result.record.createdAt, true)}</dd>
            </div>
            <div>
              <dt>{t('文件版本')}</dt>
              <dd className="mono">{result.file.id}</dd>
            </div>
            <div>
              <dt>{t('领取编号')}</dt>
              <dd className="mono">{result.record.id}</dd>
            </div>
          </dl>
        </section>
      )}
      <div className="inline-note">
        <ShieldCheck size={19} />
        <p>
          {t('溯源结果用于确认签发关联。标记可能被移除或复制，不能仅凭标记认定某个人造成了泄露。')}
        </p>
      </div>
    </>
  );
}
export function SettingsPage({ base }: AdminProps) {
  const site = useSite();
  const [settings, setSettings] = useState<Settings>();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [days, setDays] = useState(30);
  const [stealthMode, setStealthMode] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState('');
  useEffect(() => {
    api<Settings>(`${base}/api/settings`)
      .then((value) => {
        setSettings(value);
        setName(value.siteName);
        setPath(value.adminPath);
        setDays(value.ipRetentionDays);
        setStealthMode(value.stealthMode);
      })
      .catch((error) => setError(message(error)));
  }, [base]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    if (
      path !== settings.adminPath &&
      !confirm(t('将管理入口改为 {{value0}}？旧地址会立即失效，请保存新地址。', { value0: path }))
    )
      return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const next = await patch<Settings>(`${base}/api/settings`, {
        siteName: name,
        adminPath: path,
        ipRetentionDays: days,
        stealthMode,
      });
      if (next.adminPath !== settings.adminPath) {
        location.assign(`${next.adminPath}#settings`);
        return;
      }
      setSettings(next);
      await site.refresh();
      setSuccess('站点设置已保存。');
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function updateIcon(file?: File) {
    setIconBusy(true);
    setIconError('');
    try {
      if (file) {
        if (file.size > 256 * 1024) throw new Error('图标不能超过 256 KiB。');
        let image: ImageBitmap;
        try {
          image = await createImageBitmap(file);
        } catch {
          throw new Error('无法读取图片，请选择有效的 PNG 文件。');
        }
        const valid = image.width <= 1024 && image.height <= 1024;
        image.close();
        if (!valid) throw new Error('图标宽高不能超过 1024 像素。');
      }
      const result = await api<{
        iconUrl: string;
        hasCustomIcon: boolean;
      }>(
        `${base}/api/site-icon`,
        file
          ? {
              method: 'PUT',
              headers: { 'Content-Type': 'image/png' },
              body: file,
            }
          : { method: 'DELETE' },
      );
      setSettings((previous) => (previous ? { ...previous, ...result } : previous));
      await site.refresh();
    } catch (error) {
      setIconError(message(error));
    } finally {
      setIconBusy(false);
    }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError('');
    if (password !== repeat) {
      setPasswordError('两次输入的新密码不一致。');
      return;
    }
    setPasswordBusy(true);
    try {
      const auth = await api<{
        passwordSalt: string;
      }>(`${base}/api/auth`);
      const salt = passwordSalt();
      const currentPasswordKey = await passwordKey(current, auth.passwordSalt);
      const next = await passwordKey(password, salt);
      await post(`${base}/api/password`, {
        currentPasswordKey,
        passwordKey: next,
        passwordSalt: salt,
      });
      setCurrent('');
      setPassword('');
      setRepeat('');
      location.assign(base);
    } catch (error) {
      setPasswordError(message(error));
      setPasswordBusy(false);
    }
  }
  return (
    <>
      <PageHeading eyebrow={t('YOUR WORKSPACE')} title={t('站点设置')}>
        {t('管理站点身份、访问入口与记录保留方式。')}
      </PageHeading>
      {!settings && !error ? (
        <Spinner />
      ) : (
        <>
          <form className="settings-section" onSubmit={save}>
            <div className="settings-intro">
              <h2>{t('基本设置')}</h2>
              <p>{t('这些设置仅影响当前部署。')}</p>
            </div>
            <div className="stack">
              <Field label={t('站点名称')}>
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <div className="field">
                <span>{t('网站图标')}</span>
                <div className="site-icon-settings">
                  {site.hasCustomIcon ? (
                    <img src={site.iconUrl} alt={t('当前网站图标')} width={48} height={48} />
                  ) : (
                    <span className="muted">{t('未设置自定义图标')}</span>
                  )}
                  <label className="button button-secondary">
                    {t('上传网站图标')}
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/png,.png"
                      aria-label={t('上传网站图标')}
                      disabled={iconBusy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) void updateIcon(file);
                      }}
                    />
                  </label>
                  {settings?.hasCustomIcon && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={iconBusy}
                      onClick={() => void updateIcon()}
                    >
                      {t('清除图标')}
                    </button>
                  )}
                </div>
                <small>
                  {t(
                    'PNG 图片，最大 256 KiB，宽高不超过 1024 像素，建议正方形。上传后立即应用于页眉和浏览器标签页。',
                  )}
                </small>
                {iconBusy && <Spinner label={t('正在更新图标…')} />}
                <Alert>{iconError}</Alert>
              </div>
              <Field
                label={t('隐匿模式')}
                hint={t(
                  '开启后只显示提取、文件列表和下载，隐藏溯源说明与项目宣传。标记和后台溯源照常工作；此选项不增强标记的抗移除能力。',
                )}
              >
                <span className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={stealthMode}
                    onChange={(event) => setStealthMode(event.target.checked)}
                  />
                  {t('使用简洁领取页')}
                </span>
              </Field>
              <Field
                label={t('管理入口')}
                hint={t(
                  '1–64 个英文字母、数字、下划线或连字符，例如 manage 或 /manage，无需包含横线。不可用 admin、api 等系统保留名称，不支持多级路径。修改后旧路径返回 404，请保存新地址。',
                )}
              >
                <input
                  required
                  pattern={'/?[A-Za-z0-9_\\-]{1,64}'}
                  minLength={1}
                  maxLength={65}
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t('IP 地址保留天数')}
                hint={t('只清理 IP，不影响用户、文件版本与历史溯源关系。设为 0 时不保留 IP。')}
              >
                <input
                  required
                  type="number"
                  min={0}
                  max={3650}
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                />
              </Field>
              <Alert>{error}</Alert>
              <Alert kind="success">{success}</Alert>
              <div>
                <button className="button button-primary" disabled={busy || !settings}>
                  {busy ? <Spinner label={t('保存中')} /> : t('保存站点设置')}
                </button>
              </div>
            </div>
          </form>
          <form className="settings-section" onSubmit={changePassword}>
            <div className="settings-intro">
              <h2>{t('管理员密码')}</h2>
              <p>{t('更新密码会使所有现有管理会话失效。')}</p>
            </div>
            <div className="stack">
              <Field label={t('当前密码')}>
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                />
              </Field>
              <Field label={t('新密码')}>
                <input
                  required
                  minLength={12}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('至少 12 个字符')}
                />
              </Field>
              <Field label={t('确认新密码')}>
                <input
                  required
                  minLength={12}
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value)}
                />
              </Field>
              <Alert>{passwordError}</Alert>
              <div>
                <button className="button button-secondary" disabled={passwordBusy}>
                  {passwordBusy ? (
                    <Spinner label={t('安全更新中…')} />
                  ) : (
                    <>
                      <LockKeyhole size={16} />
                      {t('更新密码并重新登录')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </>
      )}
      <div className="settings-brand">
        <span className="brand-word">{site.name}</span>
        <span>{t('每一份，都有来处。')}</span>
        <p>{t('开放源代码 · 自托管文件分发')}</p>
      </div>
    </>
  );
}
