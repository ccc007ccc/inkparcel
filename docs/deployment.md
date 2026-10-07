# 部署指南

简体中文 | [English](en/deployment.md)

本文介绍当前单管理员 InkParcel 的部署；本地检查与尚未完成的线上验收见[验证记录](validation.md)。

## 本地环境

使用 Node.js 22.12 或更新版本，以及仓库固定的 pnpm 9.15.9。命令均在仓库根目录执行。不可变 Linux 宿主机应先进入开发容器（例如 `distrobox enter dev`），不要在宿主机安装依赖。

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate
pnpm dev
```

`setup:local` 创建被 Git 忽略、仅属主可读的 `.dev.vars`，包含独立的本地秘密值，并保留已有文件。打开 Wrangler 输出的本地地址，访问 `/admin`，使用本地 `BOOTSTRAP_TOKEN` 设置密码与新管理路径。将路径存入密码管理器；此后 `/admin` 返回 404。

本地 D1 和 R2 对象存放于被忽略的 `.wrangler/`，与 Cloudflare 线上资源分离。开发服务器应只监听回环地址：只有 `ENVIRONMENT=local` 且使用回环主机名才允许 HTTP Cookie，其他部署必须使用 HTTPS。

`pnpm dev` 构建前端、监听变更并启动 Wrangler。应用由 Wrangler 提供，路由与同源安全规则也适用于本地。`pnpm check` 运行类型检查、包测试和部署预演，不会部署服务。

## Cloudflare 资源

使用具备 Workers、D1 和 R2 的 Cloudflare 账户。开通 R2 可能需要配置账单；创建资源前检查账户套餐与费用，以下免费额度不是费用上限。

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create inkparcel
pnpm exec wrangler r2 bucket create inkparcel-files
```

编辑 [wrangler.jsonc](../wrangler.jsonc)：

- 将 D1 占位 `database_id` 替换为创建时返回的 ID。
- `database_name`、`bucket_name` 与实际资源一致，保留绑定名 `DB`、`BUCKET`、`ASSETS`。
- 保持 `ENVIRONMENT=production` 与 `run_worker_first=true`，由 Worker 路由确保未知/退役路径返回真实 404。
- R2 保持私有，不开启 `r2.dev` 公共入口，不绑定公开存储桶域名。网站自定义域名绑定 Worker，不绑定存储桶。
- 使用 R2 Standard 存储；应用不需要 S3 API 凭据、存储桶 CORS 规则或公开原文件下载入口。

默认 Worker 名为 `inkparcel`，部署独立实例时可修改。不同实例应使用独立数据库、存储桶与秘密值。个人部署配置应保留在不提交到 Git 的文件中；使用独立配置文件时，后续 Wrangler 命令均加 `--config <配置路径>`。

## 首次生产部署

生成两个相互独立的秘密值，各为 32 个随机字节的无填充 base64url。下面命令一次生成一个，请分别执行并保存在密码管理器：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

`APP_SECRET` 加密分发密钥并保护管理员验证值与会话。`BOOTSTRAP_TOKEN` 授权一次性初始化。不得复用演示/测试秘密值或将生产值提交到 Git；本地 `.dev.vars` 不是生产秘密部署机制。

```sh
pnpm exec wrangler d1 migrations apply inkparcel --remote
pnpm check
pnpm run deploy
pnpm exec wrangler secret put APP_SECRET
pnpm exec wrangler secret put BOOTSTRAP_TOKEN
```

在对应交互提示中粘贴秘密值。两个秘密配置完成前，首次部署无法完成初始化。使用 `pnpm run deploy`，因为 `pnpm deploy` 同时也是 pnpm 的另一条内置命令。

打开部署后 HTTPS Worker 地址的 `/admin`，使用生产初始化令牌完成向导，设置强密码并保存新管理地址。密码密钥在浏览器派生，较慢设备首次登录/设置可能稍需等待。重新访问 `/admin` 与 `/api/setup` 应返回 404，新管理地址要求正常认证。

完成后可执行 `pnpm exec wrangler secret delete BOOTSTRAP_TOKEN` 移除初始化令牌；数据库状态仍保证初始化关闭。不要删除或替换 `APP_SECRET`。

管理路径可以输入 `manage` 或 `/manage`：名称为 1–64 个英文字母、数字、下划线或连字符，无需包含横线，不支持多级路径。不要使用 admin、api、assets 等系统保留名称；输入框会显示要求。入口变更后请保存返回的完整管理地址。

## 自定义域名

域名所在区域需在同一 Cloudflare 账户中处于有效状态。在部署配置添加 Worker 自定义域名路由，例如：

```json
"routes": [{ "pattern": "files.example.com", "custom_domain": true }]
```

随后重新部署。Wrangler/Cloudflare 会配置对应路由与证书；确认 HTTPS 可用后，用该域名进行后台和领取操作。不要将域名绑定到 R2，也不要在开源配置中写入个人实际域名。

## 验证线上实例

创建测试密钥，上传受支持的原始 APK，明确选择可见密钥，并给一次性测试用户发码。在独立浏览器会话下载文件、尝试续传，再通过本地溯源页提取标记。验证下载后 APK 签名与证书，检查完整/范围响应的实际 `Content-Length`，并确认停用密钥阻止继续访问、历史标记仍可验证。

在宣称适用免费套餐前，使用有代表性的文件测量请求数、CPU 时间、D1 与 R2 操作量。本地测试不能证明线上 10 ms CPU 限制满足。本文说明部署者应执行的步骤，实际证据以验证记录为准。

## 免费额度边界

以下公开额度核对于 2026-10-07，部署前请确认官方最新页面与实际账户套餐。

| 服务                                                                        | 与本部署有关的包含额度                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) | 每天 100,000 次请求，每次调用 10 ms CPU                                       |
| [R2 Standard](https://developers.cloudflare.com/r2/pricing/)                | 每月 10 GB-month 存储、100 万次 A 类和 1000 万次 B 类操作；互联网出站流量免费 |
| [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/)           | 每天读取 500 万行、写入 10 万行，账户总存储 5 GB                              |

D1 [免费套餐单数据库上限](https://developers.cloudflare.com/d1/platform/limits/)为 500 MB，本应用使用一个数据库。扫描行数和索引写入均计量，包含认证、速率限制和维护查询。

一次上传消耗多次 A 类操作；一次带标记下载或续传消耗多次 B 类操作，以及 Worker/D1 请求。分片大小为 16 MiB，每次重试额外计量。严格路由策略使静态资源也先经过 Worker，不要假设页面与资源请求绕过其请求额度。R2 免费出站不代表存储、请求或其他服务不限量、不计费；项目不会自动升级套餐，也不提供账户级费用封顶。

支持的 APK 布局与格式限制见 [APK 格式](apk-format.md)，备份、升级及日常管理见[运维指南](operations.md)。
