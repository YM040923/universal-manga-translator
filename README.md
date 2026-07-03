# Universal Manga Translator

Universal Manga Translator 是一个面向个人和开源发布的网页漫画翻译工具。它的目标形态是：**默认只装 Chrome 插件即可使用**；如果你需要本地私有代理、更强日志、桌面启动器或本地 OCR HTTP 服务，再启用高级桌面/后端模式。

正式翻译链路：

```text
漫画图片 -> OCR API 提取文字和坐标 -> OpenAI-compatible 文本翻译 -> 插件覆盖渲染
```

翻译模型不需要识图能力；图片文字识别和坐标由 OCR API 完成。

## 快速开始：插件直连模式（推荐默认）

1. 安装依赖并构建扩展：

```powershell
pnpm install
pnpm --filter @umt/extension build
```

2. Chrome 打开 `chrome://extensions`，启用“开发者模式”，点击“加载已解压的扩展程序”，选择：

```text
F:\meihua\universal-manga-translator\apps\extension\dist
```

3. 打开漫画网站，点击浏览器右上角扩展图标：
   - 第一次进入某网站时，先点“启用此网站”；插件只会在你启用过的主域名运行。
   - 运行模式选择“插件直连”。
   - 在 popup 或后续发布 UI 中填入 OCR API URL / OCR API Keys、OpenAI-compatible Base URL / API Key / 模型。
   - 点“自检”，确认 OCR 和翻译 API 都已配置。
   - 点“翻译本页”，或开启“自动翻译本网站”。

> 安全提醒：插件直连模式会把 API Key 保存在浏览器扩展存储中。不要在不信任的浏览器配置文件里使用你的真实 key；不要把带有个人 key 的扩展数据分享给别人。

## 高级桌面/后端模式

如果你不想让插件直接访问 API，或想使用桌面控制台管理后端、日志、缓存、清理进程，可以使用高级模式：

```powershell
pnpm desktop
```

桌面控制台可以启动/停止本地后端，后端默认地址：

```text
http://127.0.0.1:47831
```

后端 `.env` 示例：

```env
TRANSLATION_PIPELINE=network-ocr-openai-compatible
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
OCR_API_URL=https://uapis.cn/api/v1/image/ocr
OCR_API_KEYS=ocr-key-a,ocr-key-b
TARGET_LANGUAGE=zh-CN
```

旧的 `VISION_PROVIDER` 只作为读取兼容，不再作为正式配置名。

## 本地 OCR HTTP

插件直连模式和高级后端模式都可以接入本地 OCR HTTP 服务：只要你的 OCR 程序暴露一个 HTTP endpoint，例如 `http://127.0.0.1:9000/ocr`，并返回可映射的 JSON 字段即可。详见 [`docs/local-ocr-http.md`](docs/local-ocr-http.md)。

通用 OCR API 的字段映射模板见 [`docs/api-templates.md`](docs/api-templates.md)。

## 常用命令

```powershell
pnpm install
pnpm doctor
pnpm build
pnpm test
pnpm desktop
```

单独构建：

```powershell
pnpm --filter @umt/shared build
pnpm --filter @umt/core build
pnpm --filter @umt/server build
pnpm --filter @umt/extension build
pnpm --filter @umt/desktop build
```

## 项目结构

```text
apps/extension  Chrome MV3 扩展，扫描漫画图、调用直连/后端链路、渲染覆盖层
apps/server     可选本地后端，提供高级缓存、配置、日志、自检
apps/desktop    Electron 桌面控制台，负责无命令行启动和管理后端
packages/core   浏览器/Node 共用 OCR、翻译、key 轮换、pipeline
packages/shared 前后端共享协议和类型
scripts         检查、构建和 QA 脚本
```

## 不要提交或分享

- `.env`
- `apps/server/data/`
- `server-runtime*.log`
- `node_modules/`
- `apps/desktop/dist-app/`

这些文件可能包含 API Key、缓存、日志或本地构建产物。

加载目录也可写作：apps/extension/dist。


## 发布与打包

发布前检查见 [`docs/release-checklist.md`](docs/release-checklist.md)。桌面安装包、portable exe 等大文件请作为 GitHub Release assets 上传，不要提交到 git。

## License

MIT
