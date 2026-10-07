import { createContext, useContext } from 'react';
export interface SiteInfo {
  name: string;
  initialized: boolean;
  stealthMode: boolean;
  iconUrl: string;
  hasCustomIcon: boolean;
}
export const SiteContext = createContext<SiteInfo & { refresh: () => Promise<void> }>({
  name: 'InkParcel',
  initialized: false,
  stealthMode: false,
  iconUrl: '/api/site-icon',
  hasCustomIcon: false,
  refresh: async () => {},
});
export const useSite = () => useContext(SiteContext);
