import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpFromLine, FileBox, Pause, Play, RefreshCw, X } from 'lucide-react';
import { blobSource, formatFor, supportedExtensions } from '@inkparcel/marking';
import { Alert, KeyPicker, Modal, Spinner } from '../components';
import { api, bytes, message, post, remove, type AdminFile, type Folder, type Key } from '../lib';
import {
  forgetUpload,
  savedUploads,
  saveUpload,
  sendUpload,
  type SavedUpload,
  type UploadState,
} from '../upload';
import type { AdminProps } from '../Admin';
export function UploadModal({
  base,
  folder,
  keys,
  initialFile,
  onClose,
  onDone,
}: AdminProps & {
  folder?: Folder;
  keys: Key[];
  initialFile?: AdminFile;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [keyIds, setKeyIds] = useState<string[]>(folder?.defaultKeyIds ?? []);
  const [session, setSession] = useState<SavedUpload>();
  const [pending, setPending] = useState(savedUploads);
  const [resume, setResume] = useState<SavedUpload>();
  const [stage, setStage] = useState<'idle' | 'hashing' | 'uploading' | 'paused' | 'complete'>(
    'idle',
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [resumeLoad, setResumeLoad] = useState<'loading' | 'ready' | 'failed'>(
    initialFile ? 'loading' : 'ready',
  );
  const [resumeAttempt, setResumeAttempt] = useState(0);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!initialFile) return;
    let live = true;
    setResumeLoad('loading');
    setError('');
    api<UploadState>(`${base}/api/uploads/${initialFile.id}`)
      .then((state) => {
        if (!live) return;
        const saved = {
          fileId: initialFile.id,
          name: initialFile.originalName,
          size: initialFile.size,
          lastModified: 0,
          fingerprint: initialFile.fingerprint,
          partSize: state.partSize,
          partCount: state.partCount,
        };
        saveUpload(saved);
        setResume(saved);
        setPending(savedUploads());
        setResumeLoad('ready');
      })
      .catch((error) => {
        if (live) {
          setError(message(error));
          setResumeLoad('failed');
        }
      });
    return () => {
      live = false;
    };
  }, [base, initialFile, resumeAttempt]);
  const busy = stage === 'hashing' || stage === 'uploading';
  const resumeBlocked =
    !!initialFile && (resumeLoad !== 'ready' || resume?.fileId !== initialFile.id);
  function openPicker() {
    if (busy || resumeBlocked) return;
    if (input.current) {
      input.current.value = '';
      input.current.click();
    }
  }
  function close() {
    if (busy && !confirm(t('关闭后暂停上传。你可以稍后重新选择同一个文件继续。'))) return;
    controller.current?.abort();
    onClose();
  }
  function choose(selected?: File) {
    if (busy || session || resumeBlocked) return;
    setError('');
    setFile(selected);
    setStage('idle');
    setProgress(0);
  }
  async function start() {
    if (!file || busy || resumeBlocked) return;
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      let current = session;
      if (!current) {
        const format = formatFor(file.name);
        setStage('hashing');
        setProgress(0);
        const source = blobSource(file);
        if (await format.handler.extract(source))
          throw new Error('此文件已包含分发标记，请上传未分发的原始版本。');
        await format.assertMarkable(source);
        abort.signal.throwIfAborted();
        const fingerprint = await format.fingerprint(source, (done, total) => {
          abort.signal.throwIfAborted();
          setProgress(total ? done / total : 0);
        });
        abort.signal.throwIfAborted();
        if (resume) {
          if (resume.size !== file.size || resume.fingerprint !== fingerprint)
            throw new Error('文件与待恢复的上传不一致，请重新选择原始文件。');
          current = resume;
        } else {
          const result = await post<{
            fileId: string;
            partSize: number;
            partCount: number;
          }>(
            `${base}/api/uploads`,
            {
              fileName: file.name,
              size: file.size,
              folderId: folder?.id ?? null,
              keyIds,
              fingerprint,
            },
            abort.signal,
          );
          current = {
            ...result,
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
            fingerprint,
          };
          saveUpload(current);
        }
        setSession(current);
        setPending(savedUploads());
      }
      setStage('uploading');
      setProgress(0);
      await sendUpload(base, current, file, abort.signal, (done) => setProgress(done / file.size));
      forgetUpload(current.fileId);
      setPending(savedUploads());
      setStage('complete');
      setProgress(1);
      onDone();
    } catch (error) {
      if (controller.current === abort) {
        setStage('paused');
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setError(message(error));
      }
    }
  }
  async function cancel(saved: SavedUpload) {
    if (!confirm(t('取消“{{value0}}”的上传并清除已传分片？', { value0: saved.name }))) return;
    controller.current?.abort();
    setError('');
    try {
      await remove(`${base}/api/uploads/${saved.fileId}`);
      forgetUpload(saved.fileId);
      setPending(savedUploads());
      if (session?.fileId === saved.fileId) {
        setSession(undefined);
        setFile(undefined);
        setResume(undefined);
        setStage('idle');
        setProgress(0);
      }
      if (resume?.fileId === saved.fileId) setResume(undefined);
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <Modal title={t('上传文件')} onClose={close} wide>
      <div className="stack">
        <p className="muted">
          {t('上传到')}
          <strong>{folder?.name ?? t('全部文件')}</strong>
          {t('。新上传会保留为独立版本。')}
        </p>
        {!session && (
          <>
            <input
              className="sr-only"
              ref={input}
              type="file"
              accept={supportedExtensions.join(',')}
              aria-label={t('选择 APK 文件')}
              onChange={(event) => choose(event.target.files?.[0])}
              disabled={busy || resumeBlocked}
            />
            <button
              className={`drop-zone${file ? ' has-file' : ''}`}
              disabled={busy || resumeBlocked}
              onClick={openPicker}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                choose(event.dataTransfer.files[0]);
              }}
            >
              {file ? (
                <FileBox size={32} strokeWidth={1.3} />
              ) : (
                <ArrowUpFromLine size={32} strokeWidth={1.3} />
              )}
              <strong>
                {file
                  ? file.name
                  : resume
                    ? t('选择原始文件：{{value0}}', { value0: resume.name })
                    : t('拖入 APK，或点击选择')}
              </strong>
              <span>{file ? bytes(file.size) : t('支持大文件分片上传 · 中断后可继续')}</span>
            </button>
            {!resume && !initialFile && (
              <KeyPicker keys={keys} value={keyIds} onChange={setKeyIds} />
            )}
            {resume && (
              <Alert kind="info">
                {t('正在恢复“')}
                {resume.name}
                {t('”。将先在本地验证文件一致性。')}
              </Alert>
            )}
          </>
        )}
        {session && (
          <div className="upload-file">
            <FileBox size={26} />
            <div>
              <strong>{session.name}</strong>
              <span>{bytes(session.size)}</span>
            </div>
          </div>
        )}
        {stage !== 'idle' && (
          <div className="upload-progress">
            <div>
              <span>
                {stage === 'hashing'
                  ? t('本地检查与内容指纹计算')
                  : stage === 'uploading'
                    ? progress >= 1
                      ? t('分片已传完，正在校验文件…')
                      : t('正在上传分片')
                    : stage === 'complete'
                      ? t('文件已入库')
                      : t('上传已暂停')}
              </span>
              <strong>{Math.min(100, Math.round(progress * 100))}%</strong>
            </div>
            <progress max={1} value={progress} aria-label={t('上传进度')} />
            {stage === 'hashing' && (
              <p className="muted small">{t('文件在浏览器中逐段读取，无需一次载入内存。')}</p>
            )}
          </div>
        )}
        {initialFile && resumeLoad === 'loading' && <Spinner label={t('正在读取上传会话…')} />}
        <Alert>{error}</Alert>
        {initialFile && resumeLoad === 'failed' && (
          <button
            className="button button-secondary"
            onClick={() => {
              setResumeLoad('loading');
              setResumeAttempt((value) => value + 1);
            }}
          >
            <RefreshCw size={17} />
            {t('重新读取上传会话')}
          </button>
        )}
        {stage === 'complete' ? (
          <div className="modal-actions">
            <button className="button button-primary" onClick={onClose}>
              {t('完成')}
            </button>
          </div>
        ) : (
          <div className="modal-actions">
            {session && (
              <button
                className="button button-danger"
                disabled={stage === 'hashing'}
                onClick={() => void cancel(session)}
              >
                {t('取消上传')}
              </button>
            )}
            {busy ? (
              <button
                className="button button-secondary"
                onClick={() => {
                  controller.current?.abort();
                  setStage('paused');
                }}
              >
                <Pause size={16} />
                {t('暂停')}
              </button>
            ) : (
              <button
                className="button button-primary"
                disabled={!file || resumeBlocked}
                onClick={() => void start()}
              >
                {stage === 'paused' ? <RefreshCw size={17} /> : <ArrowUpFromLine size={17} />}
                {stage === 'paused' ? t('重试 / 继续') : t('检查并上传')}
              </button>
            )}
          </div>
        )}
        {pending.length > 0 && !session && !initialFile && (
          <div className="pending-uploads">
            <h3>{t('尚未完成的上传')}</h3>
            {pending.map((item) => (
              <div key={item.fileId}>
                <span title={item.name}>
                  {item.name}
                  <small>{bytes(item.size)}</small>
                </span>
                <button
                  className="icon-button"
                  aria-label={t('恢复 {{value0}}', { value0: item.name })}
                  onClick={() => {
                    setResume(item);
                    setFile(undefined);
                    setStage('idle');
                    openPicker();
                  }}
                  disabled={busy || resumeBlocked}
                >
                  <Play size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={t('取消 {{value0}}', { value0: item.name })}
                  onClick={() => void cancel(item)}
                  disabled={busy || resumeBlocked}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
