import { t } from '../i18n';
import { useEffect, useState, type FormEvent } from 'react';
import {
  FileBox,
  Folder as FolderIcon,
  FolderPlus,
  Pencil,
  Trash2,
  Upload,
  LockKeyhole,
} from 'lucide-react';
import {
  Alert,
  Breadcrumbs,
  Empty,
  Field,
  KeyPicker,
  Modal,
  PageHeading,
  Pagination,
  SearchBox,
  Spinner,
} from '../components';
import {
  api,
  bytes,
  date,
  descendants,
  folderTrail,
  message,
  patch,
  post,
  query,
  remove,
  type AdminFile,
  type Folder,
  type Key,
} from '../lib';
import type { AdminProps } from '../Admin';
import { UploadModal } from './Upload';
export function FileLibrary({ base }: AdminProps) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [files, setFiles] = useState<AdminFile[]>();
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [resumeFile, setResumeFile] = useState<AdminFile>();
  const [folderModal, setFolderModal] = useState<Folder | 'new'>();
  const [editFile, setEditFile] = useState<AdminFile>();
  function refresh() {
    setVersion((value) => value + 1);
  }
  useEffect(() => {
    let live = true;
    setError('');
    setFiles(undefined);
    void Promise.all([
      api<{
        items: Folder[];
      }>(`${base}/api/folders`),
      api<{
        items: Key[];
      }>(`${base}/api/keys`),
      api<{
        files: AdminFile[];
        total: number;
        pageSize: number;
      }>(`${base}/api/files${query({ folderId, page, q: search })}`),
    ])
      .then(([folders, keys, files]) => {
        if (!live) return;
        setFolders(folders.items);
        setKeys(keys.items);
        setFiles(files.files);
        setTotal(files.total);
        setPageSize(files.pageSize);
      })
      .catch((error) => {
        if (live) setError(message(error));
      });
    return () => {
      live = false;
    };
  }, [base, folderId, page, search, version]);
  function navigate(id: string | null) {
    setFolderId(id);
    setPage(1);
    setSearch('');
  }
  async function deleteFile(file: AdminFile) {
    if (
      !confirm(
        t('删除“{{value0}}”？文件将无法下载，历史领取与溯源记录会保留。', { value0: file.name }),
      )
    )
      return;
    try {
      await remove(`${base}/api/files/${file.id}`);
      refresh();
    } catch (error) {
      setError(message(error));
    }
  }
  async function deleteFolder(folder: Folder) {
    if (!confirm(t('删除文件夹“{{value0}}”？只有空文件夹可以删除。', { value0: folder.name })))
      return;
    try {
      await remove(`${base}/api/folders/${folder.id}`);
      refresh();
    } catch (error) {
      setError(message(error));
    }
  }
  const visibleFolders = search
    ? []
    : folders.filter((folder) => (folder.parentId ?? null) === folderId);
  const current = folders.find((folder) => folder.id === folderId);
  return (
    <>
      <PageHeading
        eyebrow={t('THE LIBRARY')}
        title={t('文件库')}
        action={
          <>
            <button className="button button-secondary" onClick={() => setFolderModal('new')}>
              <FolderPlus size={17} />
              {t('新建文件夹')}
            </button>
            <button className="button button-primary" onClick={() => setUploading(true)}>
              <Upload size={17} />
              {t('上传文件')}
            </button>
          </>
        }
      >
        {t('整理每一份交付，为文件选择可见的密钥。')}
      </PageHeading>
      <div className="library-toolbar">
        <Breadcrumbs folders={folderTrail(folders, folderId)} onChange={navigate} />
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder={t('搜索全部文件')}
        />
      </div>
      <Alert>{error}</Alert>
      {!files && !error ? (
        <div className="loading-area">
          <Spinner />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="file-table">
            <thead>
              <tr>
                <th>{t('名称')}</th>
                <th>{t('可见范围')}</th>
                <th>{t('大小')}</th>
                <th>{t('上传时间')}</th>
                <th>
                  <span className="sr-only">{t('操作')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleFolders.map((folder) => (
                <tr key={folder.id}>
                  <td>
                    <button className="file-name-button" onClick={() => navigate(folder.id)}>
                      <span className="table-file-icon folder-color">
                        <FolderIcon size={23} strokeWidth={1.5} />
                      </span>
                      <strong>{folder.name}</strong>
                    </button>
                  </td>
                  <td className="muted">{t('文件夹')}</td>
                  <td className="muted">—</td>
                  <td className="muted">—</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        aria-label={t('编辑文件夹 {{value0}}', { value0: folder.name })}
                        title={t('编辑 / 移动文件夹')}
                        onClick={() => setFolderModal(folder)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={t('删除文件夹 {{value0}}', { value0: folder.name })}
                        title={t('删除空文件夹')}
                        onClick={() => void deleteFolder(folder)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {files?.map((file) => (
                <tr key={file.id}>
                  <td>
                    <button className="file-name-button" onClick={() => setEditFile(file)}>
                      <span className="table-file-icon">
                        <FileBox size={23} strokeWidth={1.5} />
                      </span>
                      <span>
                        <strong>{file.name}</strong>
                        {file.status !== 'ready' && (
                          <small>
                            {(
                              {
                                pending: t('待完成上传'),
                                failed: t('校验失败'),
                                deleted: t('已删除'),
                              } as Record<string, string>
                            )[file.status] ?? file.status}
                          </small>
                        )}
                        {search && file.folderId && (
                          <small>
                            {folderTrail(folders, file.folderId)
                              .map((folder) => folder.name)
                              .join(' / ')}
                          </small>
                        )}
                      </span>
                    </button>
                  </td>
                  <td>
                    {file.keyIds.length ? (
                      <div className="acl-tags">
                        {file.keyIds.slice(0, 2).map((id) => (
                          <span className="tag" key={id}>
                            {keys.find((key) => key.id === id)?.name ?? t('已归档密钥')}
                          </span>
                        ))}
                        {file.keyIds.length > 2 && (
                          <span className="tag">+{file.keyIds.length - 2}</span>
                        )}
                      </div>
                    ) : (
                      <span className="admin-only">
                        <LockKeyhole size={13} />
                        {t('仅管理员')}
                      </span>
                    )}
                  </td>
                  <td className="nowrap muted">{bytes(file.size)}</td>
                  <td className="nowrap muted">{date(file.uploadedAt)}</td>
                  <td>
                    <div className="row-actions">
                      {file.status === 'pending' && (
                        <button
                          className="icon-button"
                          aria-label={t('继续上传 {{value0}}', { value0: file.name })}
                          title={t('继续上传')}
                          onClick={() => {
                            setResumeFile(file);
                            setUploading(true);
                          }}
                        >
                          <Upload size={16} />
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={t('编辑 {{value0}}', { value0: file.name })}
                        title={t('编辑 / 权限 / 移动')}
                        onClick={() => setEditFile(file)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={t('删除 {{value0}}', { value0: file.name })}
                        title={t('删除文件')}
                        onClick={() => void deleteFile(file)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {files?.length === 0 && visibleFolders.length === 0 && (
            <Empty title={search ? t('没有找到匹配的文件') : t('这里还是一张白纸')}>
              {search ? t('换个关键词试试。') : t('上传第一个 APK，开始一次可验证的交付。')}
            </Empty>
          )}
        </div>
      )}
      <Pagination total={total} page={page} pageSize={pageSize} onChange={setPage} />
      <p className="muted small library-footnote">
        {t('文件夹用于整理。移动文件不会改变它的可见范围。')}
      </p>
      {uploading && (
        <UploadModal
          base={base}
          folder={current}
          keys={keys}
          initialFile={resumeFile}
          onClose={() => {
            setUploading(false);
            setResumeFile(undefined);
          }}
          onDone={refresh}
        />
      )}
      {folderModal && (
        <FolderForm
          base={base}
          item={folderModal === 'new' ? undefined : folderModal}
          parentId={folderId}
          folders={folders}
          keys={keys}
          onClose={() => setFolderModal(undefined)}
          onDone={() => {
            setFolderModal(undefined);
            refresh();
          }}
        />
      )}
      {editFile && (
        <FileForm
          base={base}
          item={editFile}
          folders={folders}
          keys={keys}
          onClose={() => setEditFile(undefined)}
          onDone={() => {
            setEditFile(undefined);
            refresh();
          }}
        />
      )}
    </>
  );
}
function FolderSelect({
  folders,
  value,
  onChange,
  exclude,
}: {
  folders: Folder[];
  value: string | null;
  onChange: (value: string | null) => void;
  exclude?: string;
}) {
  const hidden = exclude ? descendants(folders, exclude) : new Set<string>();
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">{t('全部文件（根目录）')}</option>
      {folders
        .filter((folder) => !hidden.has(folder.id))
        .map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folderTrail(folders, folder.id)
              .map((folder) => folder.name)
              .join(' / ')}
          </option>
        ))}
    </select>
  );
}
function FolderForm({
  base,
  item,
  parentId,
  folders,
  keys,
  onClose,
  onDone,
}: AdminProps & {
  item?: Folder;
  parentId: string | null;
  folders: Folder[];
  keys: Key[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [parent, setParent] = useState(item ? item.parentId : parentId);
  const [keyIds, setKeyIds] = useState(item?.defaultKeyIds ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = { name, parentId: parent, defaultKeyIds: keyIds };
      if (item) await patch(`${base}/api/folders/${item.id}`, data);
      else await post(`${base}/api/folders`, data);
      onDone();
    } catch (error) {
      setError(message(error));
      setBusy(false);
    }
  }
  return (
    <Modal title={item ? t('编辑文件夹') : t('新建文件夹')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label={t('文件夹名称')}>
          <input
            autoFocus
            required
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('例如：发行版本')}
          />
        </Field>
        <Field label={t('所在位置')}>
          <FolderSelect folders={folders} value={parent} onChange={setParent} exclude={item?.id} />
        </Field>
        <KeyPicker
          keys={keys}
          value={keyIds}
          onChange={setKeyIds}
          label={t('新上传文件的默认密钥')}
        />
        <p className="muted small">{t('只作为上传时的预选项，不影响已有文件。')}</p>
        <Alert>{error}</Alert>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            {t('取消')}
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? <Spinner label={t('保存中')} /> : t('保存文件夹')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function FileForm({
  base,
  item,
  folders,
  keys,
  onClose,
  onDone,
}: AdminProps & {
  item: AdminFile;
  folders: Folder[];
  keys: Key[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [folderId, setFolderId] = useState(item.folderId);
  const [keyIds, setKeyIds] = useState(item.keyIds);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await patch(`${base}/api/files/${item.id}`, { name, folderId, keyIds });
      onDone();
    } catch (error) {
      setError(message(error));
      setBusy(false);
    }
  }
  return (
    <Modal title={t('文件设置')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label={t('显示名称')}>
          <input
            autoFocus
            required
            maxLength={255}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t('所在文件夹')}>
          <FolderSelect folders={folders} value={folderId} onChange={setFolderId} />
        </Field>
        <KeyPicker keys={keys} value={keyIds} onChange={setKeyIds} />
        <dl className="details-list">
          <div>
            <dt>{t('原始名称')}</dt>
            <dd>{item.originalName}</dd>
          </div>
          <div>
            <dt>{t('版本')}</dt>
            <dd className="mono">{item.id}</dd>
          </div>
          <div>
            <dt>{t('大小')}</dt>
            <dd>{bytes(item.size)}</dd>
          </div>
          <div>
            <dt>{t('上传时间')}</dt>
            <dd>{date(item.uploadedAt, true)}</dd>
          </div>
        </dl>
        <Alert>{error}</Alert>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            {t('取消')}
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? <Spinner label={t('保存中')} /> : t('保存更改')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
