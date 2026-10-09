import { createContext, useContext } from 'react';
import type { DownloadSource } from './lib';
export interface SiteInfo {
  downloadSources: DownloadSource[];
  name: string;
  initialized: boolean;
  stealthMode: boolean;
  iconUrl: string;
  hasCustomIcon: boolean;
}
export const SiteContext = createContext<SiteInfo & { refresh: () => Promise<void> }>({
  downloadSources: [],
  name: 'InkParcel',
  initialized: false,
  stealthMode: false,
  iconUrl: '/api/site-icon',
  hasCustomIcon: false,
  refresh: async () => {},
});
export const useSite = () => useContext(SiteContext);
