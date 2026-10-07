import { t } from '../i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Plus, Ticket, Pencil, Power, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Alert,
  CopyButton,
  Empty,
  Field,
  Modal,
  PageHeading,
  Spinner,
  StatusBadge,
} from '../components';
import { api, date, message, patch, post, remove, type Key } from '../lib';
import type { AdminProps } from '../Admin';
export function KeyManager({ base }: AdminProps) {
  const [keys, setKeys] = useState<Key[]>();
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Key>();
  const [codeKey, setCodeKey] = useState<Key>();
  const [secret, setSecret] = useState<{
    name: string;
    secret: string;
  }>();
  function load() {
    void api<{
      items: Key[];
    }>(`${base}/api/keys`)
      .then((result) => setKeys(result.items))
      .catch((error) => setError(message(error)));
  }
  useEffect(load, [base]);
  async function toggle(key: Key) {
    if (
      key.enabled &&
      !confirm(
        t('停用“{{value0}}”？使用此密钥的提取码和现有下载将立即失效，历史溯源仍然保留。', {
          value0: key.name,
        }),
      )
    )
      return;
    setError('');
    try {
      await patch(`${base}/api/keys/${key.id}`, { enabled: !key.enabled });
      load();
    } catch (error) {
      setError(message(error));
    }
  }
  async function deleteKey(key: Key) {
    if (
      !confirm(
        t(
          '删除“{{value0}}”？该密钥会从列表移除，提取码和下载永久停用，文件授权及文件夹默认选择会清除。历史记录与溯源保留，不能重新启用。',
          { value0: key.name },
        ),
      )
    )
      return;
    setError('');
    try {
      await remove(`${base}/api/keys/${key.id}`);
      load();
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <>
      <PageHeading
        eyebrow={t('ACCESS & IDENTITY')}
        title={t('密钥与提取码')}
        action={
          <button className="button button-primary" onClick={() => setCreating(true)}>
            <Plus size={18} />
            {t('创建密钥')}
          </button>
        }
      >
        {t('用命名密钥区分分发范围，为每位领取者生成专属提取码。')}
      </PageHeading>
      <Alert>{error}</Alert>
      <div className="section-caption">
        <span>{t('访问密钥')}</span>
        <span>{keys ? t('{{value0}} 个密钥', { value0: keys.length }) : ''}</span>
      </div>
      {!keys ? (
        <div className="loading-area">
          <Spinner />
        </div>
      ) : keys.length ? (
        <div className="key-list">
          {keys.map((key) => (
            <article className="key-row" key={key.id}>
              <div className={`key-icon${key.enabled ? '' : ' disabled'}`}>
                <KeyRound size={23} />
              </div>
              <div className="key-details">
                <h2>
                  {key.name}
                  <StatusBadge active={key.enabled} />
                </h2>
                <p>
                  <code>{key.code}</code>
                  <span>
                    {t('创建于')}
                    {date(key.createdAt)}
                  </span>
                </p>
              </div>
              <div className="row-actions">
                <button
                  className="button button-secondary"
                  disabled={!key.enabled}
                  onClick={() => setCodeKey(key)}
                >
                  <Ticket size={16} />
                  {t('发放提取码')}
                </button>
                <button
                  className="icon-button"
                  aria-label={t('重命名 {{value0}}', { value0: key.name })}
                  title={t('重命名')}
                  onClick={() => setEditing(key)}
                >
                  <Pencil size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`${key.enabled ? t('停用') : t('启用')} ${key.name}`}
                  title={key.enabled ? t('停用') : t('启用')}
                  onClick={() => void toggle(key)}
                >
                  <Power size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label={t('删除 {{value0}}', { value0: key.name })}
                  title={t('删除密钥')}
                  onClick={() => void deleteKey(key)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty title={t('从第一把密钥开始')} icon={<KeyRound size={32} strokeWidth={1.4} />}>
          {t('创建密钥后，为文件选择访问范围，再向领取者发码。')}
        </Empty>
      )}
      <div className="inline-note">
        <ShieldCheck size={19} />
        <p>{t('停用可以恢复；删除会移出列表并永久停用。两种操作都保留历史溯源所需资料。')}</p>
      </div>
      {creating && (
        <KeyForm
          base={base}
          onClose={() => setCreating(false)}
          onDone={(result) => {
            setCreating(false);
            setSecret({ name: result.key.name, secret: result.secret });
            load();
          }}
        />
      )}
      {editing && (
        <RenameKey
          base={base}
          item={editing}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            load();
          }}
        />
      )}
      {codeKey && <CodeForm base={base} item={codeKey} onClose={() => setCodeKey(undefined)} />}
      {secret && (
        <Modal title={t('密钥已创建')} onClose={() => setSecret(undefined)}>
          <div className="stack">
            <Alert kind="success">
              “{secret.name}
              {t('”已经准备就绪。')}
            </Alert>
            <p className="muted">
              {t('密钥明文仅在此显示一次。如需离线备份，请妥善保存，勿发送给领取者。')}
            </p>
            <textarea
              className="secret-value"
              readOnly
              rows={3}
              value={secret.secret}
              aria-label={t('新密钥，请安全保存')}
            />
            <div className="modal-actions">
              <CopyButton value={secret.secret} label={t('复制密钥')} />
              <button className="button button-primary" onClick={() => setSecret(undefined)}>
                {t('完成')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function KeyForm({
  base,
  onClose,
  onDone,
}: AdminProps & {
  onClose: () => void;
  onDone: (result: { key: Key; secret: string }) => void;
}) {
  const [name, setName] = useState('');
  const [importing, setImporting] = useState(false);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(
        await post(`${base}/api/keys`, { name, ...(importing ? { secret: secret.trim() } : {}) }),
      );
    } catch (error) {
      setError(message(error));
      setBusy(false);
    }
  }
  return (
    <Modal title={t('创建访问密钥')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label={t('密钥名称')} hint={t('例如：内测组、合作伙伴。名称可随时修改。')}>
          <input
            autoFocus
            required
            maxLength={128}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('为这把密钥起个名字')}
          />
        </Field>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={importing}
            onChange={(event) => setImporting(event.target.checked)}
          />
          {t('导入已有密钥')}
        </label>
        {importing && (
          <Field label={t('密钥内容')} hint={t('32 字节密钥的 base64url 编码。')}>
            <textarea
              required
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              spellCheck={false}
              rows={3}
              autoComplete="off"
            />
          </Field>
        )}
        <Alert>{error}</Alert>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            {t('取消')}
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? <Spinner label={t('创建中')} /> : importing ? t('导入密钥') : t('生成密钥')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function RenameKey({
  base,
  item,
  onClose,
  onDone,
}: AdminProps & {
  item: Key;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await patch(`${base}/api/keys/${item.id}`, { name });
      onDone();
    } catch (error) {
      setError(message(error));
      setBusy(false);
    }
  }
  return (
    <Modal title={t('重命名密钥')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label={t('密钥名称')}>
          <input
            autoFocus
            required
            maxLength={128}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Alert>{error}</Alert>
        <div className="modal-actions">
          <button className="button button-primary" disabled={busy}>
            {t('保存')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CodeForm({
  base,
  item,
  onClose,
}: AdminProps & {
  item: Key;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [result, setResult] = useState<{
    userId: string;
    code: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setResult(undefined);
    setBusy(true);
    setError('');
    try {
      setResult(await post(`${base}/api/keys/${item.id}/code`, { userId }));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('发放专属提取码')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">
          {t('访问范围：')}
          <strong>{item.name}</strong>
        </p>
        <Field
          label={t('领取者用户 ID')}
          hint={t('支持用户名、邮箱、工号等自定标识，区分大小写。')}
        >
          <input
            autoFocus
            required
            maxLength={128}
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setResult(undefined);
            }}
            placeholder={t('输入领取者的身份标识')}
          />
        </Field>
        <Alert>{error}</Alert>
        <button className="button button-primary" disabled={busy}>
          {busy ? <Spinner label={t('生成中')} /> : t('生成提取码')}
        </button>
        {result && (
          <div className="issued-code">
            <span className="eyebrow">{t('PERSONAL ACCESS CODE')}</span>
            <strong>{result.userId}</strong>
            <code>{result.code}</code>
            <CopyButton
              value={t('用户 ID：{{value0}}\n提取码：{{value1}}\n领取地址：{{value2}}/', {
                value0: result.userId,
                value1: result.code,
                value2: location.origin,
              })}
              label={t('复制领取信息')}
            />
            <p className="muted small">{t('该用户首次验证通过后将自动登记。')}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}
