# HTTP 与共享模块契约

简体中文 | [English](en/API.md)

本文定义 Worker 与浏览器共享的 v0.1 接口。JSON 成功响应直接返回对象，错误格式为 `{error:{code,message}}`。写操作必须提供同源 `Origin` 头和对应的 HttpOnly Cookie；除上传分片外，请求体使用 JSON。时间戳均为 ISO 8601 UTC，ID 均为不透明字符串。

## 路由与认证

下文 `A` 表示配置的管理路径（例如 `/control-random`），不得编译进前端静态资源，也不得通过公开发现接口返回。

| 方法 / 路径         | 请求                                                  | 响应                                                                             |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET `/api/site`     | —                                                     | `{name, initialized, stealthMode, iconUrl, hasCustomIcon}`                       |
| GET `/api/setup`    | —                                                     | 初始化前返回 `{available:true}`，之后为 404                                      |
| POST `/api/setup`   | `{bootstrapToken,passwordKey,passwordSalt,adminPath}` | `{adminPath}` 与管理员 Cookie                                                    |
| GET `A/api/auth`    | —                                                     | `{authenticated,passwordSalt,kdf:{algorithm:"PBKDF2-SHA256",iterations:600000}}` |
| POST `A/api/login`  | `{passwordKey}`                                       | `{ok:true}` 与管理员 Cookie                                                      |
| POST `A/api/logout` | —                                                     | `{ok:true}` 并清除管理员 Cookie                                                  |
| POST `/api/access`  | `{userId,code}`                                       | `{user:{id,userId},key:{id,name}}` 与领取者 Cookie                               |
| GET `/api/session`  | —                                                     | 同上会话对象，或 401                                                             |
| POST `/api/logout`  | —                                                     | `{ok:true}` 并清除领取者 Cookie                                                  |

`passwordKey` 与 `passwordSalt` 使用无填充 base64url，分别包含 32 字节派生值和至少 16 字节随机盐。前端通过 WebCrypto PBKDF2-SHA256 派生密码密钥，迭代 600,000 次，输出 256 位。

管理员会话有效期 8 小时，领取者会话 24 小时。被撤销的领取会话返回 401，`error.code=access_revoked`。生产环境 HTTP GET/HEAD 跳转至 HTTPS，不安全的 HTTP 请求被拒绝；只有明确本地模式且使用回环主机名时才允许 HTTP 开发。

## 领取者文件库

| 方法 / 路径                     | 请求                           | 响应                                              |
| ------------------------------- | ------------------------------ | ------------------------------------------------- |
| GET `/api/files`                | 可选 `folderId`，`page` 默认 1 | `{files,folders,breadcrumbs,total,page,pageSize}` |
| POST `/api/files/:id/downloads` | `{}`                           | `{id,url,fileName}`                               |
| GET / HEAD `/api/downloads/:id` | 标准 HTTP 范围头               | 个性化附件流                                      |

公开文件对象为 `{id,name,size,uploadedAt}`，文件夹为 `{id,name,parentId}`。面包屑包含祖先文件夹对象，只返回可见文件和文件夹。根目录为 `folderId=null`（省略查询参数）。

下载同时绑定领取会话的用户与密钥，字节范围以个性化输出为准。每次请求均校验身份和权限。`fileName` 为实际附件名：缺少受支持扩展名时按格式注册表补齐，文件列表中的显示名称不变。

## 管理接口

以下路径均以 `A/api` 为前缀，并要求管理员认证。

| 方法 / 路径                      | 请求                                                   | 响应                                                                     |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| GET `/keys`                      | —                                                      | `{items:Key[]}`                                                          |
| POST `/keys`                     | `{name,secret?}`，省略 secret 时生成 32 字节秘密值     | `{key:Key,secret}`，秘密值仅显示一次                                     |
| PATCH `/keys/:id`                | `{name?,enabled?}`                                     | `{key:Key}`                                                              |
| POST `/keys/:id/code`            | `{userId}`                                             | `{userId,code}`                                                          |
| GET `/folders`                   | —                                                      | `{items:Folder[]}`                                                       |
| POST `/folders`                  | `{name,parentId?,defaultKeyIds?}`                      | `{folder:Folder}`                                                        |
| PATCH `/folders/:id`             | `{name?,parentId?,defaultKeyIds?}`                     | `{folder:Folder}`                                                        |
| DELETE `/folders/:id`            | 仅允许空文件夹                                         | `{ok:true}`                                                              |
| GET `/files`                     | 可选 `folderId`、`page`、`q`                           | `{files:AdminFile[],total,page,pageSize}`                                |
| PATCH `/files/:id`               | `{name?,folderId?,keyIds?}`                            | `{file:AdminFile}`                                                       |
| DELETE `/files/:id`              | 退役元数据并移除 R2 对象                               | `{ok:true}`                                                              |
| POST `/uploads`                  | `{fileName,size,folderId?,keyIds,fingerprint}`         | `{fileId,partSize,partCount}`                                            |
| GET `/uploads/:id`               | —                                                      | `{fileId,partSize,partCount,parts:[{partNumber,etag,size}]}`             |
| PUT `/uploads/:id/parts/:number` | 二进制分片请求体                                       | `{partNumber,etag,size}`                                                 |
| POST `/uploads/:id/complete`     | `{}`                                                   | `{file:AdminFile}`                                                       |
| DELETE `/uploads/:id`            | 中止未完成上传                                         | `{ok:true}`                                                              |
| GET `/users`                     | 可选 `q`、`page`                                       | `{items:User[],total,page,pageSize}`                                     |
| PATCH `/users/:id`               | `{notes?,blocked?}`                                    | `{user:User}`                                                            |
| GET `/downloads`                 | 可选 `userId`、`keyId`、`fileId`、`q`、`page`          | `{items:Download[],total,page,pageSize}`                                 |
| POST `/trace`                    | `{marker,fingerprint?}`                                | `{authentic:true,contentMatch,record,user,key,file,signedName}`          |
| GET `/settings`                  | —                                                      | `{siteName,adminPath,ipRetentionDays,stealthMode,iconUrl,hasCustomIcon}` |
| PATCH `/settings`                | `{siteName?,adminPath?,ipRetentionDays?,stealthMode?}` | 更新后的设置                                                             |
| POST `/password`                 | `{currentPasswordKey,passwordKey,passwordSalt}`        | `{ok:true}`，原管理员会话失效                                            |

- `Key`：`{id,code,name,enabled,createdAt}`。导入秘密值使用 32 字节 base64url。
- `Folder`：`{id,name,parentId,defaultKeyIds}`。
- `AdminFile`：`{id,name,originalName,folderId,size,fingerprint,keyIds,status,uploadedAt}`。
- `User`：`{id,userId,firstSeenAt,lastSeenAt,notes,blocked}`。备注支持多行（CRLF 转为 LF），其他身份/名称字段只允许单行。拒绝未配对 UTF-16 代理项和不支持的控制字符。
- `Download`：`{id,userId,userName,keyId,keyName,fileId,fileName,createdAt,ip,status}`；`userId` 是内部 ID，`userName` 是外部自定标识。
- 提供指纹时 `contentMatch` 为布尔值，否则为 null。无效封装返回具体错误；未知或已删除对象不得抹去有效溯源记录。普通列表不得返回原始秘密值或完整标记。
- 列表每页 50 条，内部限制页大小；`q` 是有长度上限的字面搜索字符串。
- 当前安装最多支持 100 个密钥和 1000 个文件夹。ACL 更新在事务内使用批量 SQL，即使一次选中全部 100 个密钥也是如此。

### 删除与管理路径

`DELETE A/api/keys/:id` 和 `DELETE A/api/users/:id` 均需要管理员会话与同源 Origin，返回 `{ok:true}`，可重复调用。删除为逻辑删除，普通列表不再返回该身份；密钥永久停用并清除文件授权与文件夹默认选择，用户永久封禁以防旧提取码自动登记。历史签发、身份映射和密钥材料保留用于溯源，PATCH 不能恢复已删除身份。100 个密钥上限只统计未删除密钥；仍拒绝导入已删除密钥的相同秘密值。

初始化和设置中的 `adminPath` 接受单段 1–64 个英文字母、数字、下划线或连字符，去除首尾空白并自动补上开头 `/`；例如 `manage` 规范化为 `/manage`。无需包含连字符，不支持中文、多级路径、查询串或片段。`admin`、`api`、`assets`、`favicon`、`robots`、`downloads` 为不区分大小写的保留名称。

## 标记包

二进制解析、支持的签名和指纹规范化见 [APK 格式](apk-format.md)。包名为 `@inkparcel/marking`，实现位于 `packages/marking`。

```ts
export interface ByteRange {
  offset: number;
  length: number;
}
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  stream(offset: number, length: number): Promise<ReadableStream<Uint8Array>>;
}
export interface MarkedFile {
  size: number;
  stream(range?: ByteRange): Promise<ReadableStream<Uint8Array>>;
}
export interface MarkerHandler {
  mark(source: ByteSource, marker: Uint8Array): Promise<MarkedFile>;
  extract(source: ByteSource): Promise<Uint8Array | null>;
}
export const apkHandler: MarkerHandler;
export function blobSource(blob: Blob): ByteSource;
export function inspectApk(source: ByteSource): Promise<unknown>;
export function fingerprintApk(
  source: ByteSource,
  onProgress?: (bytes: number, total: number) => void,
): Promise<string>;
export function handlerFor(fileName: string): MarkerHandler;
export interface FileFormat {
  id: string;
  version: string;
  extensions: readonly string[];
  mediaType: string;
  handler: MarkerHandler;
  fingerprint(
    source: ByteSource,
    onProgress?: (bytes: number, total: number) => void,
  ): Promise<string>;
  assertMarkable(source: ByteSource): Promise<void>;
}
export function formatFor(fileName: string): FileFormat;
export const supportedExtensions: readonly string[];
```

指纹输出为 64 字符小写 SHA-256 十六进制。APK 实现必须记录规范化算法并保留原始签名身份。对本包而言，标记是语义不透明的 UTF-8 认证封装文本；Worker/浏览器仅在封装边界使用 TextEncoder/TextDecoder。

APK 描述符为 `id="apk"`、`version="apk-v1"`、`extensions=[".apk"]`。预检保证上传变为 ready 前，任何允许的标记都能写入。完成上传、签发和下载时检查存储的格式版本；不匹配返回 409，不能改变已有签发的字节。添加新格式模块与注册项即可提供标记/提取、指纹、预检与媒体元数据，无需在工作流中添加格式分支。

`stealthMode` 为布尔设置，默认 false，只能通过管理员设置接口修改；`/api/site` 返回它供前端选择公开页面样式。PATCH 省略时保留原值。该设置仅改变页面呈现，不改变认证、标记、下载或溯源。

`siteName` 统一用于页面中的站点名称与网页标题，`iconUrl` 为同源公开图标地址。`PUT A/api/site-icon` 接受原始 `image/png` 字节，最大 256 KiB、宽高各 1–1024 像素，检查 PNG 签名、头部和结尾结构；浏览器还验证图片可解码。`DELETE A/api/site-icon` 恢复内置图标。两者均要求管理员认证与同源 Origin，返回 `{iconUrl,hasCustomIcon}`。`GET/HEAD /api/site-icon` 返回 PNG 或内置 SVG，设置 nosniff 与 no-store。替换时原子更新版本化 URL 与 D1 单行图标数据。

公开字段 `hasCustomIcon` 区分已上传图标与原黑色徽标。自定义图片完整替换徽标，不再套入背景容器；清除后该字段恢复为 false。

API 错误码保持稳定且与语言无关，浏览器按错误码显示本地化文案，诊断响应消息与界面翻译分开处理。语言偏好 Cookie `inkparcel_language`（`zh-CN` 或 `en`）只控制初始 HTML 语言和通用标题/描述，不参与授权。切换浏览器语言无需数据库迁移或修改站点设置。
