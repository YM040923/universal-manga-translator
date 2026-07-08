# Release notes template

复制这份模板到 GitHub Release 描述中。普通用户主下载项是 `extension-release.zip`。

## 下载

- 主下载：`extension-release.zip`
- 校验文件：`extension-release.zip.sha256`
- 安装方式：解压 zip，然后在 Chrome 的 `chrome://extensions` 中选择“加载已解压的扩展程序”，加载解压后的文件夹。
- 不要直接把 zip 拖进 Chrome。Chrome 开发者模式需要加载解压后的目录。

## 本版本更新

-
-
-

## 升级说明

1. 下载新的 `extension-release.zip`。
2. 解压到原插件目录，覆盖旧文件。
3. 打开 `chrome://extensions`，点击插件卡片上的“重新加载”。
4. 已保存的 API Key、站点启用状态、缓存和覆盖设置会保存在浏览器扩展 `storage` 中。

## 首次使用

1. 打开漫画章节页。
2. 点击插件图标。
3. 点击“启用此网站”。
4. 打开“API 设置 / 自检”。
5. 填写 OCR API、OpenAI-compatible 翻译 API、模型和可选术语表。
6. 自检通过后开始翻译。

完整流程见 [`docs/quickstart.md`](quickstart.md)。

## 已知限制

- 插件需要用户自己提供 OCR API 和翻译 API。
- OCR 成本由用户选择的服务商决定。
- 目录页、详情页、搜索页不会作为默认翻译目标。
- 桌面端和本地后端是 Advanced / Experimental，不是普通用户默认安装路径。

## 隐私与 API Key

纯插件模式下，API Key 保存在浏览器扩展 `storage` 中。请求会发往用户当前浏览的漫画网站、用户填写的 OCR API、用户填写的 OpenAI-compatible 翻译 API。项目作者不会接收这些请求。

请不要在 issue、截图或日志里粘贴完整 API Key。详情见 [`docs/privacy-and-permissions.md`](privacy-and-permissions.md)。

## 遇到问题

- 安装、配置、自检失败：先看 [`docs/troubleshooting.md`](troubleshooting.md)。
- OCR/API 问题：使用 `OCR / API failure` issue 模板。
- 翻译质量问题：使用 `Translation quality` issue 模板。
- 网站兼容问题：使用 `Site compatibility` issue 模板。
- 气泡/UI 问题：使用 `Overlay / UI issue` issue 模板。
