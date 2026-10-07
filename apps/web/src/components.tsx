import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clipboard,
  FolderOpen,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react';
import { copy, type Folder, type Key } from './lib';
import { useSite } from './site';
export function Brand({ compact = false, name }: { compact?: boolean; name?: string }) {
  const site = useSite();
  return (
    <div className="brand">
      <span className="brand-symbol">
        <img src={site.iconUrl} alt="" width={24} height={24} />
      </span>
      <span>
        {name ?? site.name}
        {!compact && <small>每一份，都有来处</small>}
      </span>
    </div>
  );
}
export function Spinner({ label = '正在载入…' }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <LoaderCircle size={17} className="spin" />
      <span>{label}</span>
    </span>
  );
}
export function Alert({
  children,
  kind = 'error',
}: {
  children: ReactNode;
  kind?: 'error' | 'success' | 'info';
}) {
  return children ? (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  ) : null;
}
export function Empty({
  title,
  children,
  icon = <FolderOpen size={30} strokeWidth={1.3} />,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {action && <div className="heading-actions">{action}</div>}
    </header>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal${wide ? ' modal-wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function KeyPicker({
  keys,
  value,
  onChange,
  label = '允许访问的密钥',
}: {
  keys: Key[];
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
}) {
  return (
    <fieldset className="key-picker">
      <legend>{label}</legend>
      <p className="muted small">可多选。不选择时，仅管理员可见。</p>
      {keys.length ? (
        <div className="key-options">
          {keys.map((key) => (
            <label key={key.id}>
              <input
                type="checkbox"
                checked={value.includes(key.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked ? [...value, key.id] : value.filter((id) => id !== key.id),
                  )
                }
              />
              <span>
                {key.name}
                <small>
                  {key.code}
                  {!key.enabled && ' · 已停用'}
                </small>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="muted small">还没有密钥，可稍后在文件设置中分配。</p>
      )}
    </fieldset>
  );
}
export function Breadcrumbs({
  folders,
  onChange,
}: {
  folders: Folder[];
  onChange: (id: string | null) => void;
}) {
  return (
    <nav className="breadcrumbs" aria-label="文件夹路径">
      <button onClick={() => onChange(null)}>全部文件</button>
      {folders.map((folder) => (
        <span key={folder.id}>
          <ChevronRight size={14} />
          <button onClick={() => onChange(folder.id)}>{folder.name}</button>
        </span>
      ))}
    </nav>
  );
}
export function Pagination({
  total,
  page,
  pageSize = 50,
  onChange,
}: {
  total: number;
  page: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>共 {total} 项</span>
      {count > 1 && (
        <div>
          <button
            className="icon-button"
            aria-label="上一页"
            disabled={page <= 1}
            onClick={() => onChange(page - 1)}
          >
            <ArrowLeft size={17} />
          </button>
          <span>
            {page} / {count}
          </span>
          <button
            className="icon-button"
            aria-label="下一页"
            disabled={page >= count}
            onClick={() => onChange(page + 1)}
          >
            <ArrowRight size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = '搜索…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  function submit(event: FormEvent) {
    event.preventDefault();
    onChange(draft.trim());
  }
  return (
    <form className="search-box" role="search" onSubmit={submit}>
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button className="text-button" type="submit">
        搜索
      </button>
    </form>
  );
}
export function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);
  return (
    <button
      type="button"
      className="button button-secondary"
      onClick={() => {
        void copy(value)
          .then(() => {
            setCopied(true);
            setError(false);
          })
          .catch(() => setError(true));
      }}
    >
      {copied ? <Check size={16} /> : <Clipboard size={16} />}
      {error ? '请手动选取复制' : copied ? '已复制' : label}
    </button>
  );
}
export function StatusBadge({
  active,
  on = '启用',
  off = '停用',
}: {
  active: boolean;
  on?: string;
  off?: string;
}) {
  return (
    <span className={`badge${active ? ' badge-green' : ''}`}>
      <i />
      {active ? on : off}
    </span>
  );
}
