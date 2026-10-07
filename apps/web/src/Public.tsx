import { t } from './i18n';
import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  FileBox,
  Folder as FolderIcon,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { Alert, Brand, Breadcrumbs, Empty, Pagination, Spinner } from './components';
import {
  api,
  bytes,
  date,
  downloadUrl,
  message,
  post,
  query,
  type Folder,
  type PublicFile,
  type Session,
} from './lib';
interface Library {
  files: PublicFile[];
  folders: Folder[];
  breadcrumbs: Folder[];
  total: number;
  page: number;
  pageSize: number;
}
export function PublicLibrary({
  name,
  stealthMode,
  session,
  onLogout,
}: {
  name: string;
  stealthMode: boolean;
  session: Session;
  onLogout: () => void;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [library, setLibrary] = useState<Library>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLibrary(undefined);
    setError('');
    api<Library>(`/api/files${query({ folderId, page })}`)
      .then((result) => {
        if (live) setLibrary(result);
      })
      .catch((error) => {
        if (live) setError(message(error));
      });
    return () => {
      live = false;
    };
  }, [folderId, page]);
  function navigate(id: string | null) {
    setFolderId(id);
    setPage(1);
  }
  async function download(file: PublicFile) {
    setBusy(file.id);
    setError('');
    try {
      const result = await post<{
        url: string;
        fileName: string;
      }>(`/api/files/${file.id}/downloads`);
      downloadUrl(result.url, result.fileName);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(null);
    }
  }
  async function logout() {
    try {
      await post('/api/logout');
      onLogout();
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <div className="public-page">
      <header className="site-header">
        <Brand compact={stealthMode} name={name} />
        <button className="button button-quiet" onClick={() => void logout()}>
          <LogOut size={16} />
          {t('退出')}
        </button>
      </header>
      <main className="public-main">
        <section className="public-intro">
          <div>
            {!stealthMode && <span className="eyebrow">{t('YOUR PERSONAL LIBRARY')}</span>}
            <h1>{name}</h1>
            <p>
              {t('你好，')}
              <strong>{session.user.userId}</strong>
              {t('。你的文件已准备就绪。')}
            </p>
          </div>
          {!stealthMode && (
            <div className="recipient-seal">
              <ShieldCheck size={23} />
              <span>
                {t('专属访问')}
                <small>{session.key.name}</small>
              </span>
            </div>
          )}
        </section>
        <div className="library-top">
          <Breadcrumbs folders={library?.breadcrumbs ?? []} onChange={navigate} />
          <span className="muted small">
            {library ? t('{{value0}} 个文件', { value0: library.total }) : ''}
          </span>
        </div>
        <Alert>{error}</Alert>
        {!library && !error ? (
          <div className="loading-area">
            <Spinner />
          </div>
        ) : (
          library && (
            <>
              {library.folders.length > 0 && (
                <div className="folder-grid">
                  {library.folders.map((folder) => (
                    <button
                      className="folder-tile"
                      key={folder.id}
                      onClick={() => navigate(folder.id)}
                    >
                      <FolderIcon size={25} strokeWidth={1.5} />
                      <span>{folder.name}</span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </div>
              )}
              {library.files.length ? (
                <div className="file-list">
                  {library.files.map((file) => (
                    <article className="public-file" key={file.id}>
                      <div className="file-icon">
                        <FileBox size={25} strokeWidth={1.5} />
                      </div>
                      <div className="file-info">
                        <h2>{file.name}</h2>
                        <p>
                          {bytes(file.size)}
                          <span>·</span>
                          {date(file.uploadedAt)}
                        </p>
                      </div>
                      <button
                        className="button button-secondary"
                        aria-label={`${stealthMode ? t('下载') : t('领取')} ${file.name}`}
                        disabled={busy === file.id}
                        onClick={() => void download(file)}
                      >
                        {busy === file.id ? (
                          <Spinner label={t('准备中')} />
                        ) : (
                          <>
                            <ArrowDownToLine size={17} />
                            <span>{stealthMode ? t('下载') : t('领取文件')}</span>
                          </>
                        )}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  title={
                    library.folders.length ? t('此文件夹下没有文件') : t('暂时没有可领取的文件')
                  }
                >
                  {t('文件准备好后会出现在这里。')}
                </Empty>
              )}
              <Pagination
                total={library.total}
                page={page}
                pageSize={library.pageSize}
                onChange={setPage}
              />
            </>
          )
        )}
        {!stealthMode && (
          <p className="delivery-note">
            <ShieldCheck size={17} />
            {t('下载文件将写入与你的领取记录关联的专属标记。')}
          </p>
        )}
      </main>
      {!stealthMode && (
        <footer className="site-footer">
          <span>{name}</span>
          <span>{t('一份文件，一枚印记。')}</span>
        </footer>
      )}
    </div>
  );
}
