import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Alert, Brand, Field, Spinner } from './components';
import {
  api,
  authExpiredEvent,
  message,
  passwordKey,
  passwordSalt,
  post,
  type AuthExpired,
  type Session,
} from './lib';
import { PublicLibrary } from './Public';
import { Admin } from './Admin';
import { SiteContext, useSite, type SiteInfo } from './site';

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const [site, setSite] = useState<SiteInfo>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<SiteInfo>('/api/site')
      .then(setSite)
      .catch((error) => setError(message(error)));
  }, []);
  useEffect(() => {
    document.title = site
      ? site.stealthMode && path === '/' && site.name === 'InkParcel'
        ? '文件分享'
        : site.name
      : '文件分享';
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.append(icon);
    }
    icon.href = site?.iconUrl || '/api/site-icon';
  }, [site, path]);
  if (error)
    return (
      <div className="screen-center">
        {path === '/' ? <span>文件分享</span> : <Brand />}
        <Alert>{error}</Alert>
        <button className="button button-primary" onClick={() => location.reload()}>
          重新加载
        </button>
      </div>
    );
  if (!site)
    return (
      <div className="screen-center">
        {path === '/' ? <span>文件分享</span> : <Brand />}
        <Spinner />
      </div>
    );
  const content =
    path === '/admin' ? (
      site.initialized ? (
        <div className="screen-center">
          <Brand />
          <h1>404</h1>
          <p>这个地址不存在。</p>
          <a className="button button-secondary" href="/">
            返回首页
          </a>
        </div>
      ) : (
        <Setup />
      )
    ) : path === '/' ? (
      <Recipient
        name={site.stealthMode && site.name === 'InkParcel' ? '文件分享' : site.name}
        stealthMode={site.stealthMode}
      />
    ) : (
      <AdminGate base={path} />
    );
  return (
    <SiteContext.Provider
      value={{ ...site, refresh: async () => setSite(await api<SiteInfo>('/api/site')) }}
    >
      {content}
    </SiteContext.Provider>
  );
}

function AuthFrame({
  children,
  title,
  subtitle,
  eyebrow,
  minimalName,
}: {
  children: ReactNode;
  title: ReactNode;
  subtitle: string;
  eyebrow: string;
  minimalName?: string;
}) {
  const site = useSite();
  if (minimalName)
    return (
      <div className="auth-page">
        <header className="site-header">
          <Brand compact name={minimalName} />
        </header>
        <main className="simple-access">
          <section className="auth-form-panel">{children}</section>
        </main>
      </div>
    );
  return (
    <div className="auth-page">
      <header className="site-header">
        <Brand />
        <span className="header-note">私有分发 · 可验证交付</span>
      </header>
      <main className="auth-layout">
        <section className="auth-story">
          <div className="eyebrow">
            {site.name} / {eyebrow}
          </div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <div className="parcel-art" aria-hidden="true">
            <div className="parcel-sheet sheet-back" />
            <div className="parcel-sheet sheet-front">
              <div className="sheet-label">A PERSONAL DELIVERY</div>
              <div className="sheet-lines">
                <i />
                <i />
                <i />
              </div>
              <div className="sheet-stamp">
                <Check size={30} />
                <span>VERIFIED</span>
              </div>
              <div className="sheet-foot">
                {site.name} <span>↗</span>
              </div>
            </div>
            <span className="art-caption">一份文件，一枚专属印记。</span>
          </div>
        </section>
        <section className="auth-form-panel">{children}</section>
      </main>
      <footer className="site-footer">
        <span>{site.name} · 文件分发</span>
        <span>交付有序，来处可循。</span>
      </footer>
    </div>
  );
}
function Recipient({ name, stealthMode }: { name: string; stealthMode: boolean }) {
  const [session, setSession] = useState<Session | null>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => {
    api<Session>('/api/session')
      .then(setSession)
      .catch((error) => {
        if (error.status !== 401) setError(message(error));
        setSession(null);
      });
  }, []);
  useEffect(() => {
    const expire = (event: Event) => {
      const detail = (event as CustomEvent<AuthExpired>).detail;
      if (detail.path.startsWith('/api/') && detail.path !== '/api/session') {
        setSession(null);
        setError(detail.message);
      }
    };
    window.addEventListener(authExpiredEvent, expire);
    return () => window.removeEventListener(authExpiredEvent, expire);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      setSession(await post<Session>('/api/access', { userId, code }));
      setCode('');
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (session === undefined)
    return (
      <div className="screen-center">
        <Brand compact={stealthMode} name={name} />
        <Spinner />
      </div>
    );
  if (session)
    return (
      <PublicLibrary
        name={name}
        stealthMode={stealthMode}
        session={session}
        onLogout={() => setSession(null)}
      />
    );
  return (
    <AuthFrame
      minimalName={stealthMode ? name : undefined}
      eyebrow="YOUR PARCEL"
      title={
        <>
          为你准备的，
          <br />
          <em>专属一份。</em>
        </>
      }
      subtitle="用你的身份标识和提取码开启交付。属于你的文件，会带着一枚专属印记抵达。"
    >
      <div className="form-kicker">
        <KeyRound size={19} />
        <span>{stealthMode ? '提取文件' : '领取文件'}</span>
      </div>
      <h2>{stealthMode ? '提取文件' : `欢迎来到 ${name}`}</h2>
      <p className="muted">输入提取信息，查看文件。</p>
      <form onSubmit={submit} className="stack">
        <Field label="用户 ID" hint="请与管理员发码时填写的标识保持一致，区分大小写。">
          <input
            required
            autoComplete="username"
            maxLength={128}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="用户名、邮箱或其他身份标识"
          />
        </Field>
        <Field label={stealthMode ? '提取码' : '专属提取码'}>
          <input
            required
            autoComplete="current-password"
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="粘贴管理员发给你的提取码"
          />
        </Field>
        <Alert>{error}</Alert>
        <button className="button button-primary button-full" disabled={busy}>
          {busy ? (
            <Spinner label="正在验证…" />
          ) : (
            <>
              {stealthMode ? '提取文件' : '打开我的文件'} <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
      {!stealthMode && (
        <p className="auth-note">
          <ShieldCheck size={17} />
          文件包含与你的领取记录关联的溯源标记。
        </p>
      )}
    </AuthFrame>
  );
}
function Setup() {
  const site = useSite();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [path, setPath] = useState(() => `/control-${passwordSalt().slice(0, 12).toLowerCase()}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password !== repeat) {
      setError('两次输入的密码不一致。');
      return;
    }
    setBusy(true);
    try {
      const salt = passwordSalt();
      const key = await passwordKey(password, salt);
      const result = await post<{ adminPath: string }>('/api/setup', {
        bootstrapToken: token,
        passwordKey: key,
        passwordSalt: salt,
        adminPath: path,
      });
      location.assign(result.adminPath);
    } catch (error) {
      setError(message(error));
      setBusy(false);
    }
  }
  return (
    <AuthFrame
      eyebrow="FIRST DELIVERY"
      title="先为交付，安一个家。"
      subtitle="完成一次初始化，开始管理文件与专属提取码。配置完成后，请保存你的管理入口。"
    >
      <div className="form-kicker">
        <ShieldCheck size={20} />
        <span>首次设置</span>
      </div>
      <h2>创建你的 {site.name}</h2>
      <form className="stack" onSubmit={submit}>
        <Field label="初始化令牌" hint="部署时设置的 BOOTSTRAP_TOKEN。">
          <input
            required
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </Field>
        <div className="form-columns">
          <Field label="管理员密码">
            <input
              required
              minLength={12}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 12 个字符"
            />
          </Field>
          <Field label="确认密码">
            <input
              required
              minLength={12}
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            />
          </Field>
        </div>
        <Field
          label="新的管理路径"
          hint="1–64 个英文字母、数字、下划线或连字符，例如 manage 或 /manage，无需包含横线。不可用 admin、api 等系统保留名称，不支持多级路径。设置后 /admin 失效，请保存新地址。"
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
        <Alert>{error}</Alert>
        <button className="button button-primary button-full" disabled={busy}>
          {busy ? (
            <Spinner label="安全初始化中…" />
          ) : (
            <>
              完成设置 <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
    </AuthFrame>
  );
}
function AdminGate({ base }: { base: string }) {
  const [auth, setAuth] = useState<{ authenticated: boolean; passwordSalt: string }>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ authenticated: boolean; passwordSalt: string }>(`${base}/api/auth`)
      .then(setAuth)
      .catch((error) => setError(message(error)));
  }, [base]);
  useEffect(() => {
    const expire = (event: Event) => {
      const detail = (event as CustomEvent<AuthExpired>).detail;
      if (detail.path.startsWith(`${base}/api/`)) {
        setAuth(undefined);
        setPassword('');
        setError('管理会话已失效，请重新登录。');
        void api<{ authenticated: boolean; passwordSalt: string }>(`${base}/api/auth`)
          .then(setAuth)
          .catch((error) => setError(message(error)));
      }
    };
    window.addEventListener(authExpiredEvent, expire);
    return () => window.removeEventListener(authExpiredEvent, expire);
  }, [base]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!auth) return;
    setBusy(true);
    setError('');
    try {
      await post(`${base}/api/login`, {
        passwordKey: await passwordKey(password, auth.passwordSalt),
      });
      setPassword('');
      setAuth({ ...auth, authenticated: true });
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (auth?.authenticated)
    return <Admin base={base} onLogout={() => setAuth({ ...auth, authenticated: false })} />;
  return (
    <AuthFrame
      eyebrow="ADMINISTRATION"
      title="把每一次交付，安排妥当。"
      subtitle="管理文件、分配访问权限，并在需要时验证文件的来处。"
    >
      <div className="form-kicker">
        <LockKeyhole size={20} />
        <span>管理入口</span>
      </div>
      <h2>欢迎回来</h2>
      <p className="muted">输入管理员密码，继续你的工作。</p>
      {!auth && !error ? (
        <Spinner />
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="管理员密码">
            <input
              autoFocus
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Alert>{error}</Alert>
          <button className="button button-primary button-full" disabled={busy || !auth}>
            {busy ? (
              <Spinner label="正在安全验证…" />
            ) : (
              <>
                登录管理后台 <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      )}
      <a href="/" className="back-link">
        返回公开下载页
      </a>
    </AuthFrame>
  );
}
