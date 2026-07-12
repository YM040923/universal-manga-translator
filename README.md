# Universal Manga Translator

Universal Manga Translator 是一个网页漫画翻译工具。**主产品形态是纯插件版：用户只安装 Chrome 插件即可使用，不需要桌面端，不需要本地后端，也不需要命令行长期运行。**

翻译链路：

```text
漫画图片 -> OCR API 提取文字和坐标 -> OpenAI-compatible 文本翻译 -> 插件覆盖渲染
```

翻译模型不需要识图能力；图片文字识别和坐标由 OCR API 完成。

## 快速开始：纯插件版

更完整的普通用户安装流程见 [`docs/quickstart.md`](docs/quickstart.md)。常见错误见 [`docs/troubleshooting.md`](docs/troubleshooting.md)。

### 给普通用户安装

1. 下载发布包里的 `extension-release.zip` 和 `extension-release.zip.sha256`。
2. 解压到一个固定目录，例如：

```text
D:\Apps\UniversalMangaTranslator\extension
```

3. Chrome 打开 `chrome://extensions`。
4. 打开右上角“开发者模式”。
5. 点击“加载已解压的扩展程序”，选择刚才解压后的目录。
6. 打开漫画章节页，点击浏览器右上角插件图标。
7. 第一次进入某网站时，先点“启用此网站”；插件只会在你启用过的主域名运行。
8. 打开 API 设置页，填写：
   - OCR API URL
   - OCR API Key / 多个 OCR API Keys
   - OpenAI-compatible Base URL
   - 翻译 API Key
   - 翻译模型
   - 可选：人名 / 术语表
9. 点击“自检”。自检通过后，回到漫画页点“翻译本页”或开启“自动翻译本网站”。

可选校验命令：

```powershell
$expected = (Get-Content .\extension-release.zip.sha256 -Raw).Split(" ")[0]
$actual = (Get-FileHash .\extension-release.zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "extension-release.zip 校验失败" }
```

> 安全提醒：纯插件版会把 API Key 保存在浏览器扩展存储中。不要在不信任的浏览器配置文件里使用真实 key；不要把带有个人 key 的浏览器扩展数据分享给别人。

### 开发者本地构建插件

```powershell
pnpm install
pnpm --filter @umt/extension build
```

然后在 Chrome 的 `chrome://extensions` 中加载：

```text
apps/extension/dist
```

也可以生成给别人安装的插件 zip：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

输出文件：

```text
release/extension-release.zip
release/extension-release.zip.sha256
release/build-info.json
```

其中 `.sha256` 用于校验 zip，`build-info.json` 记录版本、commit、dirty 状态、zip 文件名、SHA256 和构建时间，方便发布后追溯。

## API 配置说明

### OCR API

OCR API 负责识别漫画图片里的文字和坐标。插件支持通用网络 OCR API，也可以填写本地 OCR HTTP 地址。

常见配置项：

```text
OCR API URL=https://example.com/ocr
OCR API Keys=key-a,key-b,key-c
```

多个 OCR API Key 会用于轮换；遇到额度不足、鉴权失败、限流等错误时会自动尝试下一个 key。

通用 OCR API 的字段映射模板见 [`docs/api-templates.md`](docs/api-templates.md)。

### 翻译 API

翻译 API 只需要文本模型，不需要识图模型。只要兼容 OpenAI Chat Completions 风格接口即可。

常见配置项：

```text
OpenAI-compatible Base URL=https://api.openai.com/v1
API Key=sk-...
Model=gpt-4.1-mini
Target Language=zh-CN
```

### 人名 / 术语表

如果某部漫画有固定人名、地名、组织名、招式名，可以在插件 API 设置里填写术语表。格式是一行一个：

```text
Clark = 克拉克
Murim = 武林
Heavenly Demon = 天魔
```

插件会把术语表作为强约束传给翻译模型，并把术语表版本加入缓存 profile。也就是说，术语表改动后，同一张图的旧翻译缓存不会继续错误覆盖新词典效果。

## 本地 OCR HTTP

纯插件版也可以接入本地 OCR HTTP 服务：只要你的 OCR 程序暴露一个 HTTP endpoint，例如：

```text
http://127.0.0.1:9000/ocr
```

并返回可映射的 JSON 字段即可。详见 [`docs/local-ocr-http.md`](docs/local-ocr-http.md)。

## 高级/实验：后端和桌面端

后端和桌面端不是普通用户的默认入口。它们只适合高级场景，例如：

- 你不想让插件直接保存 API Key
- 你想把 OCR/翻译请求集中到本地代理
- 你需要更强的本地日志和缓存
- 你要开发或调试本项目
- 未来接入本地图像处理、inpaint、批量导出等重型能力

启动桌面端：

```powershell
pnpm desktop
```

本地后端默认地址：

```text
http://127.0.0.1:47831
```

后端 `.env` 示例：

```env
TRANSLATION_PIPELINE=network-ocr-openai-compatible
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OCR_API_URL=https://example.com/ocr
OCR_API_KEYS=ocr-key-a,ocr-key-b
TARGET_LANGUAGE=zh-CN
```

旧的 `VISION_PROVIDER` 只作为读取兼容，不再作为正式配置名。

## 常用命令

普通插件开发主要用：

```powershell
pnpm install
pnpm --filter @umt/extension build
pnpm --filter @umt/extension test
pnpm package:extension
```

完整工程检查：

```powershell
pnpm doctor
pnpm typecheck
pnpm test
pnpm build
```

发布前本地总检查：

```powershell
pnpm release:check
```

高级后端/桌面端开发：

```powershell
pnpm --filter @umt/server build
pnpm --filter @umt/desktop build
pnpm desktop
```

## 项目结构

```text
apps/extension  Chrome MV3 扩展，主产品；扫描漫画图、直连 API、渲染覆盖层
packages/core   浏览器/Node 共用 OCR、翻译、key 轮换、pipeline
packages/shared 前后端共享协议和类型
apps/server     可选高级本地后端，提供本地缓存、配置、日志、自检
apps/desktop    实验性 Electron 控制台，用于管理本地后端
scripts         检查、构建、发布和 QA 脚本
```

## 不要提交或分享

- `.env`
- `apps/server/data/`
- `server-runtime*.log`
- `node_modules/`
- `apps/desktop/dist-app/`
- `release/`

这些文件可能包含 API Key、缓存、日志或本地构建产物。

## 发布与打包

发布前检查见 [`docs/release-checklist.md`](docs/release-checklist.md)。GitHub Release 文案可从 [`docs/release-notes-template.md`](docs/release-notes-template.md) 复制。普通用户发布包优先提供 `extension-release.zip`。桌面端和后端只作为 Advanced / Experimental assets，需要时再单独上传。

开发贡献说明见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 隐私、权限与反馈

插件权限、API Key 存储和请求去向见 [`docs/privacy-and-permissions.md`](docs/privacy-and-permissions.md)。提交问题时请使用 `.github/ISSUE_TEMPLATE/` 中的模板，并且不要粘贴完整 API Key。

## 产品路线

产品级优化路线见 [`docs/product-roadmap.md`](docs/product-roadmap.md)。当前主线是纯插件优先：安装配置简单、阅读页边界准确、队列和进度可靠、覆盖渲染稳定、API 自检能直接说明问题。

## License

MIT
