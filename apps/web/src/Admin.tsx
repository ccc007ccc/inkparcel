import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  FileClock,
  Files,
  Fingerprint,
  KeyRound,
  LogOut,
  Menu,
  Settings2,
  Users,
  X,
} from 'lucide-react';
import { Alert, Brand } from './components';
import { message, post } from './lib';
import { useSite } from './site';
import { FileLibrary } from './pages/Files';
import { KeyManager } from './pages/Keys';
import { Downloads, UsersPage } from './pages/Records';
import { SettingsPage, TracePage } from './pages/SettingsTrace';
export interface AdminProps {
  base: string;
}
const tabs = [
  { id: 'files', label: '文件库', icon: Files },
  { id: 'keys', label: '密钥与提取码', icon: KeyRound },
  { id: 'users', label: '用户', icon: Users },
  { id: 'downloads', label: '领取记录', icon: FileClock },
  { id: 'trace', label: '文件溯源', icon: Fingerprint },
  { id: 'settings', label: '站点设置', icon: Settings2 },
];
export function Admin({ base, onLogout }: AdminProps & { onLogout: () => void }) {
  const site = useSite();
  function current() {
    const hash = location.hash.slice(1).split('?')[0];
    return tabs.some((tab) => tab.id === hash) ? hash : 'files';
  }
  const [tab, setTab] = useState(current);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [userFilter, setUserFilter] = useState<{ id: string; name: string }>();
  useEffect(() => {
    const change = () => {
      setTab(current());
      setOpen(false);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  async function logout() {
    try {
      await post(`${base}/api/logout`);
      onLogout();
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <div className="admin-layout">
      <header className="mobile-header">
        <Brand compact />
        <button
          className="icon-button"
          aria-label={open ? '关闭导航' : '打开导航'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </header>
      {open && (
        <button aria-label="关闭导航" className="sidebar-overlay" onClick={() => setOpen(false)} />
      )}
      <aside className={`sidebar${open ? ' sidebar-open' : ''}`}>
        <Brand />
        <div className="workspace-label">
          <span className="live-dot" />
          管理工作台
        </div>
        <nav aria-label="管理导航">
          {tabs.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={tab === item.id ? 'page' : undefined}
              className={tab === item.id ? 'nav-active' : ''}
              onClick={() => setOpen(false)}
            >
              <item.icon size={19} strokeWidth={1.7} />
              {item.label}
              {tab === item.id && <i />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-caption">
            交付有序
            <br />
            来处可循<span>{site.name} / WORKSPACE</span>
          </div>
          <a href="/" target="_blank" rel="noreferrer">
            <ArrowUpRight size={17} />
            打开下载页
          </a>
          <button onClick={() => void logout()}>
            <LogOut size={17} />
            退出管理
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <Alert>{error}</Alert>
        {tab === 'files' && <FileLibrary base={base} />}
        {tab === 'keys' && <KeyManager base={base} />}
        {tab === 'users' && (
          <UsersPage
            base={base}
            onRecords={(user) => {
              setUserFilter({ id: user.id, name: user.userId });
              location.hash = 'downloads';
            }}
          />
        )}
        {tab === 'downloads' && (
          <Downloads
            base={base}
            userFilter={userFilter}
            onClearUser={() => setUserFilter(undefined)}
          />
        )}
        {tab === 'trace' && <TracePage base={base} />}
        {tab === 'settings' && <SettingsPage base={base} />}
      </main>
    </div>
  );
}
