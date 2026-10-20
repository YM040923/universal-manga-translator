# Contributing

Universal Manga Translator 当前产品方向是纯插件优先。普通用户应该只需要安装 Chrome 插件，并配置自己的 OCR / 翻译 API；桌面端和本地后端只作为高级或实验入口。

## 开发环境

```powershell
pnpm install
```

常用检查：

```powershell
pnpm verify:secrets
pnpm typecheck
pnpm test
powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

`pnpm verify:secrets` 扫描 git 跟踪的文本文件，命中疑似密钥时让 CI 直接失败；报告里只会显示打码后的值。测试夹具里的假密钥请用能看出是占位符的写法（例如 `example-...`），确实需要放行某个明显伪造值时在该行加 `scan-secrets:ignore` 注释。发现安全问题请按 [SECURITY.md](SECURITY.md) 私密报告，版本变更记录写入 [CHANGELOG.md](CHANGELOG.md)。

发布前本地总检查：

```powershell
pnpm release:check
```

生成的发布资产在：

```text
release/extension-release.zip
release/extension-release.zip.sha256
release/build-info.json
```

发布 GitHub Release 时，三个文件都应上传：zip 是主安装包，`.sha256` 用于校验，`build-info.json` 用于追溯版本、commit 和构建状态。

## 本地加载插件

```powershell
pnpm --filter @umt/extension build
```

然后在 Chrome 打开 `chrome://extensions`，加载：

```text
apps/extension/dist
```

## 代码方向

- 保持纯插件路径是主产品路径。
- 不要把桌面端或后端变成普通用户必需组件。
- 不要新增没有真实行为或没有测试覆盖的按钮。
- OCR、翻译、缓存、队列、覆盖层、popup 控件的行为改动必须有测试。
- 公开示例只能使用通用占位符，例如 `https://example.com/ocr` 和 `sk-...`。

## 不要提交

不要提交这些文件或内容：

- `.env`
- `release/`
- `apps/server/data/`
- `server-runtime*.log`
- `node_modules/`
- 真实 API Key
- 真实用户日志中未打码的 API Key

## 提交 issue

请使用 `.github/ISSUE_TEMPLATE/` 中的模板，并且不要粘贴完整 API Key。OCR/API、翻译质量、网站兼容、覆盖气泡/UI 问题分别有不同模板。

## 发布前

发布前按 [`docs/release-checklist.md`](docs/release-checklist.md) 检查。GitHub Release 文案可以从 [`docs/release-notes-template.md`](docs/release-notes-template.md) 复制。
