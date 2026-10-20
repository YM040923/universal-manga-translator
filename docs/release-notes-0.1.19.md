# 0.1.19 发布说明

## 安装

下载 `extension-release.zip`，解压到固定目录，Chrome 打开 `chrome://extensions`，开启开发者模式，点“加载已解压的扩展程序”选择解压目录。

可选校验：

```powershell
$expected = (Get-Content .\extension-release.zip.sha256 -Raw).Split(" ")[0]
$actual = (Get-FileHash .\extension-release.zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "extension-release.zip 校验失败" }
```

## 本轮变更

- OCR 与 AI 自检拆成两个独立按钮，分别只请求各自接口；自检结果统一显示在 popup 的“服务与模型”分类里，不再泄漏到其他分类。
- 后端模式下提供独立的“测试后端”按钮，不会把后端健康检查伪装成 OCR/AI 两项测试。
- 设置页改为三个并列分类界面，避免不同板块重复显示同类控件。
- 版本号从 `0.2.0` 回退到 `0.1.19`（`apps/extension/public/manifest.json`、根 `package.json`、`apps/extension/package.json` 同步）。0.2.0 的改动经回滚后大部分并未保留，不配作为一次递增；`0.1.18` 从未发布过。同时修复 `build-info.json` 里 `packageVersion` 停留在旧版本的问题（`scripts/verify-release-assets.ps1` 现在会拒绝不匹配的发布包）。
- 修复发布校验脚本：`options_ui` 指向 `settings.html` 是当前设计（`build-output.test.mjs` 已断言），此前 `verify-extension-package.ps1` 会把它误判为非法 options page 导致打包失败；现在改为校验 `options_ui.page === settings.html`、`open_in_tab === true` 且 zip 内必须包含 `settings.html` / `settings.js`。

## 主线功能

- 纯插件形态，安装即用，不依赖后端、桌面端或命令行。
- 站点按需启用，只在你启用过的主域名运行。
- 翻译本页 / 自动翻译本网站 / 框选翻译三种触发，框选优先级最高。
- 通用网络 OCR 链路：更换服务商只需改 URL 与 API Key。
- 多个 OCR Key 自动轮换，额度不足、鉴权失败、限流自动切换。
- 章节级缓存，同一章同一图不重复翻译；术语表改动使旧缓存失效。
- 覆盖气泡可调（形状、宽高比、缩放、透明度），可手动编辑，清空后自动移除。
- 图片左上角悬浮按钮以颜色表示状态，进度条可拖动。

## 兼容性

需要 Chrome 或基于 Chromium 的浏览器（Manifest V3）。翻译 API 只需兼容 OpenAI Chat Completions 的文本模型，不需要识图能力。
