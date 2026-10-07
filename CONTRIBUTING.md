# 参与 InkParcel 开发

简体中文 | [English](docs/en/CONTRIBUTING.md)

欢迎提交问题修复和范围明确的文件处理器。修改契约前，请阅读[产品规格](docs/SPEC.md)与 [API 契约](docs/API.md)。

使用 Node.js 22.12 或更新版本，以及 `package.json` 中固定的 pnpm 版本。

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:migrate
pnpm dev
```

在不可变 SteamOS 工作站上，请在名为 `dev` 的 Distrobox 容器内执行命令；其他受支持的开发环境可直接执行。

提交前运行 `pnpm typecheck`、受影响包的测试与 `pnpm build`。二进制标记修改还需要真实签名验证：

```sh
# 需要 Java、Python 3、Android SDK build-tools 和 platform，并设置 ANDROID_HOME。
pnpm fixtures
pnpm test:apk
```

浏览器回归测试使用 `target/` 下隔离的本地 D1/R2 状态：

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

每个拉取请求应聚焦具体变更，说明用户可见的结果并附验证证据。不要包含真实分发的 APK、分发凭据、领取者信息或第三方签名私钥。生成的测试密钥和二进制样本必须保持在 Git 忽略目录中。

安全问题请按照[安全政策](SECURITY.md)私下报告，不要在公开 Issue 中披露利用细节。所有贡献均采用 Apache-2.0 许可证。
