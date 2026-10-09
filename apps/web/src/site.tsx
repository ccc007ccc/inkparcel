import { createContext, useContext } from 'react';
import type { DownloadSource } from './lib';
export interface SiteInfo {
  downloadSources: DownloadSource[];
  showDownloadSourceDomains: boolean;
  name: string;
  initialized: boolean;
  stealthMode: boolean;
  iconUrl: string;
  hasCustomIcon: boolean;
}
export const SiteContext = createContext<SiteInfo & { refresh: () => Promise<void> }>({
  downloadSources: [],
  showDownloadSourceDomains: true,
  name: 'InkParcel',
  initialized: false,
  stealthMode: false,
  iconUrl: '/api/site-icon',
  hasCustomIcon: false,
  refresh: async () => {},
});
export const useSite = () => useContext(SiteContext);
