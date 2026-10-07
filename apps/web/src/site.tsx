import { createContext, useContext } from 'react';
export interface SiteInfo {
  name: string;
  initialized: boolean;
  stealthMode: boolean;
  iconUrl: string;
}
export const SiteContext = createContext<SiteInfo & { refresh: () => Promise<void> }>({
  name: '文件分享',
  initialized: false,
  stealthMode: false,
  iconUrl: '/api/site-icon',
  refresh: async () => {},
});
export const useSite = () => useContext(SiteContext);
