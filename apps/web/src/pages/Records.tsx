import { t } from '../i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { Ban, FileClock, Pencil, ShieldCheck, Users as UsersIcon, X, Trash2 } from 'lucide-react';
import {
  Alert,
  Empty,
  Field,
  Modal,
  PageHeading,
  Pagination,
  SearchBox,
  Spinner,
  StatusBadge,
} from '../components';
import {
  api,
  date,
  message,
  patch,
  remove,
  query,
  type Download,
  type Key,
  type PageResult,
  type User,
} from '../lib';
import type { AdminProps } from '../Admin';
export function UsersPage({
  base,
  onRecords,
}: AdminProps & {
  onRecords: (user: User) => void;
}) {
  const [result, setResult] = useState<PageResult<User>>();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<User>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setResult(undefined);
    setError('');
    api<PageResult<User>>(`${base}/api/users${query({ q, page })}`)
      .then((value) => {
        if (live) setResult(value);
      })
      .catch((error) => {
        if (live) setError(message(error));
      });
    return () => {
      live = false;
    };
  }, [base, q, page, version]);
  async function block(user: User) {
    if (
      !confirm(
        user.blocked
          ? t('恢复“{{value0}}”的访问权限？', { value0: user.userId })
          : t('封禁“{{value0}}”？该用户的所有密钥访问与下载都会停止，历史记录保留。', {
              value0: user.userId,
            }),
      )
    )
      return;
    setError('');
    try {
      await patch(`${base}/api/users/${user.id}`, { blocked: !user.blocked });
      setVersion((value) => value + 1);
    } catch (error) {
      setError(message(error));
    }
  }
  async function deleteUser(user: User) {
    if (
      !confirm(
        t(
          '删除“{{value0}}”？该用户会从列表移除并永久停止访问，原用户 ID 不能再通过提取码自动登记。历史领取记录与溯源保留；如需以后恢复访问，请使用封禁。',
          { value0: user.userId },
        ),
      )
    )
      return;
    setError('');
    try {
      await remove(`${base}/api/users/${user.id}`);
      if (result?.items.length === 1 && page > 1) setPage(page - 1);
      else setVersion((value) => value + 1);
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <>
      <PageHeading eyebrow={t('RECIPIENTS')} title={t('用户')}>
        {t('首次验证通过时自动登记。一个用户 ID 对应一份持续的领取记录。')}
      </PageHeading>
      <div className="toolbar">
        <SearchBox
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(1);
          }}
          placeholder={t('搜索用户 ID 或备注')}
        />
      </div>
      <Alert>{error}</Alert>
      {!result && !error ? (
        <div className="loading-area">
          <Spinner />
        </div>
      ) : (
        result && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('用户 ID')}</th>
                    <th>{t('状态')}</th>
                    <th>{t('最近使用')}</th>
                    <th>{t('备注')}</th>
                    <th>
                      <span className="sr-only">{t('操作')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="user-cell">
                          <span className="avatar">
                            {Array.from(user.userId)[0]?.toUpperCase() ?? '?'}
                          </span>
                          <span>
                            <strong>{user.userId}</strong>
                            <small>
                              {t('首次使用')}
                              {date(user.firstSeenAt)}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge active={!user.blocked} on={t('正常')} off={t('已封禁')} />
                      </td>
                      <td className="muted nowrap">{date(user.lastSeenAt, true)}</td>
                      <td className="note-cell">
                        {user.notes || <span className="muted">—</span>}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            title={t('领取记录')}
                            aria-label={t('查看 {{value0}} 的领取记录', { value0: user.userId })}
                            onClick={() => onRecords(user)}
                          >
                            <FileClock size={17} />
                          </button>
                          <button
                            className="icon-button"
                            title={t('编辑备注')}
                            aria-label={t('编辑 {{value0}} 的备注', { value0: user.userId })}
                            onClick={() => setEditing(user)}
                          >
                            <Pencil size={17} />
                          </button>
                          <button
                            className="icon-button"
                            title={user.blocked ? t('解除封禁') : t('封禁用户')}
                            aria-label={`${user.blocked ? t('解封') : t('封禁')} ${user.userId}`}
                            onClick={() => void block(user)}
                          >
                            {user.blocked ? <ShieldCheck size={17} /> : <Ban size={17} />}
                          </button>
                          <button
                            className="icon-button"
                            title={t('删除用户')}
                            aria-label={t('删除 {{value0}}', { value0: user.userId })}
                            onClick={() => void deleteUser(user)}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!result.items.length && (
                <Empty
                  title={q ? t('没有找到这位用户') : t('等待第一位领取者')}
                  icon={<UsersIcon size={32} strokeWidth={1.4} />}
                >
                  {q ? t('换个关键词试试。') : t('向对方发放提取码，首次验证后会自动出现在这里。')}
                </Empty>
              )}
            </div>
            <Pagination
              total={result.total}
              page={page}
              pageSize={result.pageSize}
              onChange={setPage}
            />
          </>
        )
      )}
      {editing && (
        <UserNotes
          base={base}
          user={editing}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            setVersion((value) => value + 1);
          }}
        />
      )}
    </>
  );
}
function UserNotes({
  base,
  user,
  onClose,
  onDone,
}: AdminProps & {
  user: User;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState(user.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await patch(`${base}/api/users/${user.id}`, { notes });
      onDone();
    } catch (error) {
      setError(message(error));
      setBusy(false);
    }
  }
  return (
    <Modal title={t('编辑用户备注')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">{user.userId}</p>
        <Field label={t('备注')} hint={t('仅管理员可见。')}>
          <textarea
            autoFocus
            rows={5}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('记录便于识别的信息…')}
          />
        </Field>
        <Alert>{error}</Alert>
        <div className="modal-actions">
          <button className="button button-primary" disabled={busy}>
            {busy ? <Spinner label={t('保存中')} /> : t('保存备注')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Downloads({
  base,
  userFilter,
  onClearUser,
}: AdminProps & {
  userFilter?: {
    id: string;
    name: string;
  };
  onClearUser: () => void;
}) {
  const [result, setResult] = useState<PageResult<Download>>();
  const [keys, setKeys] = useState<Key[]>([]);
  const [keyId, setKeyId] = useState('');
  const [q, setQ] = useState('');
  const [fileId, setFileId] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Download>();
  useEffect(() => {
    api<{
      items: Key[];
    }>(`${base}/api/keys`)
      .then((result) => setKeys(result.items))
      .catch((error) => setError(message(error)));
  }, [base]);
  useEffect(() => setPage(1), [userFilter]);
  useEffect(() => {
    let live = true;
    setResult(undefined);
    setError('');
    api<PageResult<Download>>(
      `${base}/api/downloads${query({ q, keyId, userId: userFilter?.id, fileId, page })}`,
    )
      .then((result) => {
        if (live) setResult(result);
      })
      .catch((error) => {
        if (live) setError(message(error));
      });
    return () => {
      live = false;
    };
  }, [base, q, keyId, fileId, userFilter, page]);
  return (
    <>
      <PageHeading eyebrow={t('DELIVERY HISTORY')} title={t('领取记录')}>
        {t('查看谁领取了哪一份文件，保留每次交付的版本与密钥关联。')}
      </PageHeading>
      <div className="toolbar record-toolbar">
        <SearchBox
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(1);
          }}
          placeholder={t('搜索用户或文件名称')}
        />
        <select
          aria-label={t('按密钥筛选')}
          value={keyId}
          onChange={(event) => {
            setKeyId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('所有密钥')}</option>
          {keys.map((key) => (
            <option key={key.id} value={key.id}>
              {key.name}
              {!key.enabled && t('（已停用）')}
            </option>
          ))}
        </select>
      </div>
      {(userFilter || fileId) && (
        <div className="filter-chips">
          {userFilter && (
            <button onClick={onClearUser}>
              {t('用户：')}
              {userFilter.name}
              <X size={14} />
            </button>
          )}
          {fileId && (
            <button
              onClick={() => {
                setFileId('');
                setPage(1);
              }}
            >
              {t('已筛选文件版本')}
              <X size={14} />
            </button>
          )}
        </div>
      )}
      <Alert>{error}</Alert>
      {!result && !error ? (
        <div className="loading-area">
          <Spinner />
        </div>
      ) : (
        result && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('领取者')}</th>
                    <th>{t('文件')}</th>
                    <th>{t('密钥')}</th>
                    <th>{t('时间')}</th>
                    <th>IP</th>
                    <th>
                      <span className="sr-only">{t('详情')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.userName}</strong>
                      </td>
                      <td>
                        <button
                          className="text-button record-file"
                          onClick={() => {
                            setFileId(item.fileId);
                            setPage(1);
                          }}
                          title={t('筛选此文件的所有记录')}
                        >
                          {item.fileName}
                        </button>
                      </td>
                      <td>
                        <span className="tag">{item.keyName}</span>
                      </td>
                      <td className="muted nowrap">{date(item.createdAt, true)}</td>
                      <td className="mono muted small">{item.ip || t('未保留')}</td>
                      <td>
                        <button className="text-button" onClick={() => setDetail(item)}>
                          {t('详情')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!result.items.length && (
                <Empty
                  title={t('还没有匹配的领取记录')}
                  icon={<FileClock size={32} strokeWidth={1.4} />}
                >
                  {t('文件被领取后，记录会显示在这里。')}
                </Empty>
              )}
            </div>
            <Pagination
              total={result.total}
              page={page}
              pageSize={result.pageSize}
              onChange={setPage}
            />
          </>
        )
      )}
      <div className="inline-note">
        <FileClock size={18} />
        <p>
          {t(
            '记录表示文件已签发或传输已发起，不代表对方已经完整保存文件。断点续传归入同一条领取记录。',
          )}
        </p>
      </div>
      {detail && (
        <Modal title={t('领取详情')} onClose={() => setDetail(undefined)}>
          <dl className="details-list">
            <div>
              <dt>{t('领取者')}</dt>
              <dd>{detail.userName}</dd>
            </div>
            <div>
              <dt>{t('文件')}</dt>
              <dd>{detail.fileName}</dd>
            </div>
            <div>
              <dt>{t('密钥')}</dt>
              <dd>{detail.keyName}</dd>
            </div>
            <div>
              <dt>{t('时间')}</dt>
              <dd>{date(detail.createdAt, true)}</dd>
            </div>
            <div>
              <dt>{t('领取编号')}</dt>
              <dd className="mono">{detail.id}</dd>
            </div>
            <div>
              <dt>{t('版本编号')}</dt>
              <dd className="mono">{detail.fileId}</dd>
            </div>
            <div>
              <dt>IP</dt>
              <dd className="mono">{detail.ip || t('未保留')}</dd>
            </div>
            <div>
              <dt>{t('状态')}</dt>
              <dd>
                {detail.status === 'issued'
                  ? t('已签发')
                  : detail.status === 'started'
                    ? t('已发起传输')
                    : detail.status}
              </dd>
            </div>
          </dl>
        </Modal>
      )}
    </>
  );
}
