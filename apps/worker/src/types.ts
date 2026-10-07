import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  APP_SECRET: string;
  BOOTSTRAP_TOKEN?: string;
  ENVIRONMENT?: string;
}
export interface SettingsRow {
  id: number;
  site_name: string;
  admin_path: string;
  password_verifier: string;
  password_salt: string;
  auth_version: number;
  ip_retention_days: number;
  created_at: string;
}
export interface KeyRow {
  id: string;
  code: string;
  name: string;
  secret_encrypted: string;
  secret_digest: string;
  enabled: number;
  created_at: string;
}
export interface UserRow {
  id: string;
  user_id: string;
  first_seen_at: string;
  last_seen_at: string;
  notes: string;
  blocked: number;
}
export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}
export interface FileRow {
  id: string;
  name: string;
  original_name: string;
  folder_id: string | null;
  object_key: string;
  size: number;
  fingerprint: string;
  handler_version: string;
  status: string;
  uploaded_at: string;
}
export interface UploadRow {
  file_id: string;
  multipart_id: string;
  state: string;
  updated_at: string;
}
export interface DownloadRow {
  id: string;
  user_id: string;
  key_id: string;
  file_id: string;
  signed_name: string;
  marker: string;
  created_at: string;
  ip: string | null;
  status: string;
}
export interface Session {
  kind: 'admin' | 'recipient';
  exp: number;
  sid: string;
  ver?: number;
  uid?: string;
  kid?: string;
}
export type Bindings = {
  Bindings: Env;
  Variables: { settings: SettingsRow | null; session: Session; user: UserRow; key: KeyRow };
};
export type Ctx = Context<Bindings>;
export interface MarkerClaims {
  v: 1;
  issuanceId: string;
  userId: string;
  keyId: string;
  fileId: string;
  fingerprint: string;
  name: string;
  issuedAt: string;
}
