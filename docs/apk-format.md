# APK 标记格式

简体中文 | [English](en/apk-format.md)

本文定义 `@inkparcel/marking` v0.1 的二进制契约；已测试的签名组合与部署验收见[验证记录](validation.md)。

## 支持的布局

处理器接受单磁盘 ZIP32 APK，必须已有 v2 签名条目（`0x7109871a`）。附加 v3（`0xf05368c0`）和 v3.1（`0x1b93ad61`）条目逐字节保留。拒绝仅 v3、仅 v1、分卷 ZIP 和 ZIP64。文件可大于 2 GiB，但不能超过 4 GiB 减 1 字节；改写后的目录偏移也必须在 ZIP32 范围内。

`inspectApk` 检查 EOCD 结尾/注释、磁盘和目录字段、目录位置与头部、签名块魔数与一致的大小、每个条目边界，并要求存在 v2 条目。这是有界结构检查，**不等于** APK 密码学签名验证、解压或逐一验证 ZIP 条目与内部签名记录。上传信任边界是提供原文件的管理员；仅存在可识别签名 ID 不代表签名有效。发布样本独立使用 Android `apksigner` 验证原文件及个性化输出。

解析器每次最多读取 64 KiB，整个签名块最多 16 MiB、4096 个条目，标记大小为 1 字节至 16 KiB。这些是为约束内存与解析成本设置的应用限制，并非 Android 格式限制。长度按无符号小端整数解析；64 位字段转换为 JavaScript 数值前必须检查。

入库前还调用 `assertApkMarkable`：解析一次、拒绝现有 InkParcel 标记，并检查 1 字节到 16 KiB 的**所有**标记大小均符合条目、块大小和输出偏移限制。该操作不读取完整载荷，也不分配假想输出。检查最大长度及比它少 1 字节的长度，是因为恰好页对齐的块不需填充，而略短标记可能额外需要一页和一个条目。结构有效的原文件仍可能因已有 4096 个条目或接近 4 GiB 而无法通过容量检查。

## 写入标记

InkParcel 使用 APK 签名块独立外层条目 ID `0x49504b31`（`IPK1`），值为语义不透明的认证封装。这是项目自选 ID，不是 Android 分配的签名方案。认证和用户映射属于应用层，二进制包无法访问秘密值或领取者 ID。

变换保留签名块之前的全部字节、所有现有非填充条目的原始顺序，以及中央目录。追加一个 InkParcel 条目，重建外层块大小，并更新 EOCD 中央目录偏移。未知的重复 ID 保持为独立条目；已知签名 ID、InkParcel 条目或 verity 填充条目出现重复时拒绝，避免歧义。拒绝对已有标记的原文件再次写入。

verity 填充条目（`0x42726577`）用零字节重新生成。现有 4096 字节对齐的块容量足够时复用，否则扩展到对齐大小；存在填充条目时至少为它保留 12 字节。签名块起始偏移不变，从而保留原本符合 APK verity 要求的对齐关系。处理器不会修复原本无效的签名或对齐。

APK v2/v3 系列内容摘要排除可变的外层签名块条目，并规范化 EOCD 偏移；Android 忽略未知外层 ID，因此无需发布者 APK 签名私钥即可执行变换。独立的 v4 `.idsig` 覆盖全部 APK 字节，个性化后会失效。InkParcel 分发普通 APK，不复用 `.idsig`，也不提供增量安装包。

## 规范化指纹版本 1

对以下规范化 APK 计算 SHA-256，并输出小写十六进制：

1. 保留 APK 签名块之前的每个字节。
2. 移除签名块中的 InkParcel 和 verity 填充条目。
3. 保留其余条目的全部字节与顺序，包括完整 v2/v3 系列签名、证书数据和所有未知条目。
4. 重算两个外层签名块大小字段，保留标准魔数。
5. 逐字节保留中央目录。
6. 保留 EOCD 与注释，仅修改中央目录偏移，使其紧接规范化签名块。

规范化表示仅用于哈希，不承诺可安装；它有意移除 verity 填充。原始 APK 与带标记 APK 指纹相同。修改领取标记或填充不改变指纹，修改载荷、保留的元数据或签名身份则会改变。该指纹不是仅针对 ZIP 内容的哈希，不保证重新构建或重签后的等效应用指纹相等。未来变更规范化算法必须使用新的处理器/指纹版本，不得悄悄重释存储中的旧指纹。

`fingerprintApk` 使用 `@noble/hashes` 增量计算虚拟文件哈希，可选进度回调返回已处理规范化字节数及总数。浏览器在上传和溯源时计算，大文件指纹不得在 Worker 请求中计算。

## 流与溯源

`ByteSource` 描述不可变字节，提供精确长度的有界读取和范围流。`blobSource` 使用浏览器 `Blob.slice` 实现，Worker 提供绑定不可变对象的 R2 适配器。`mark` 返回稳定的虚拟文件，将未改变的原文件范围与替换字节片段交织，不保存或缓冲完整个性化文件。

`MarkedFile.stream({offset,length})` 的偏移以**个性化文件**为准，支持跨越替换边界的范围。同一数据源与标记产生相同字节和长度；无效范围被拒绝，源截断、超量流字节与读取失败会向上传播，取消传递给活跃源流。HTTP 范围解析、授权、HEAD、ETag 与签发生命周期由 Worker 负责。

浏览器 `extract` 只读取有界尾部/签名块数据，返回独立复制的标记或 `null`，不上传文件。本地指纹需要读取全部规范化字节，但不缓冲完整文件。应用分别显示标记真实性、内容指纹匹配及签发元数据。有效标记对应签发记录，但可能被移除或复制，不能证明谁泄露文件。见[产品契约](SPEC.md#标记与-apk-契约)。

## 格式注册

`formatFor(filename)` 返回注册的 `id`、`version`、`extensions`、`mediaType`、`handler`、`fingerprint` 和 `assertMarkable`。`supportedExtensions` 提供带前导点的扩展名供文件选择器使用，`handlerFor` 保留为 `.handler` 的兼容简写。

APK 描述符为 `id: apk`、`version: apk-v1`、扩展名 `.apk`；版本标识持久化的标记/指纹契约。标记处理器仍仅有 `mark` 和 `extract` 两个函数；预检与指纹属于外围格式适配器，不参与认证封装生成。

新格式提供适配器，并在 `packages/marking/src/registry.ts` 添加一个注册项。上传、下载和浏览器溯源消费描述符，不按 APK 名称分支，也不硬编码媒体类型。

## 参考资料

- [Android v2 格式与完整性保护内容](https://source.android.com/docs/security/features/apksigning/v2)
- [Android v3 格式](https://source.android.com/docs/security/features/apksigning/v3)
- [Android v3.1 签名块](https://source.android.com/docs/security/features/apksigning/v3-1)
- [Android v4 与 `.idsig`](https://source.android.com/docs/security/features/apksigning/v4)
- [AOSP 签名块与 ZIP64 检查](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/util/apk/ApkSigningBlockUtils.java)
- [AOSP apksig verity 填充](https://android.googlesource.com/platform/tools/apksig/+/master/src/main/java/com/android/apksig/internal/apk/ApkSigningBlockUtils.java)
