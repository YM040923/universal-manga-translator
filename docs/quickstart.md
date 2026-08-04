# 快速开始

这份说明面向普通用户。主路径是纯 Chrome 插件：不需要桌面端，不需要本地后端，也不需要长期运行命令行。

## 1. 安装插件

1. 下载发布包里的 `extension-release.zip` 和 `extension-release.zip.sha256`。
2. 可选但推荐：在下载目录打开 PowerShell，校验 zip 没有损坏或被替换。

   ```powershell
   $expected = (Get-Content .\extension-release.zip.sha256 -Raw).Split(" ")[0]
   $actual = (Get-FileHash .\extension-release.zip -Algorithm SHA256).Hash.ToLowerInvariant()
   if ($actual -ne $expected) { throw "extension-release.zip 校验失败" }
   ```

3. 解压到一个固定目录，例如：

   ```text
   D:\Apps\UniversalMangaTranslator\extension
   ```

4. Chrome 打开 `chrome://extensions`。
5. 打开右上角“开发者模式”。
6. 点击“加载已解压的扩展程序”，选择刚才解压出来的目录。

不要直接选择 zip 文件。Chrome 开发者模式需要加载解压后的文件夹。

## 2. 启用漫画网站

1. 打开一个漫画章节阅读页。
2. 点击浏览器右上角的“漫译”插件图标。
3. 第一次在某个网站使用时，点击“启用此网站”。

插件只会在你启用过的主域名运行。目录页、搜索页、首页不会作为漫画阅读页自动翻译。

## 3. 配置 API

打开 popup 里的“API 设置 / 自检”，填写：

- OCR API URL，例如 `https://example.com/ocr` 或本地 `http://127.0.0.1:9000/ocr`
  - 远程 OCR 必须使用 `https://`。`http://` 只允许本机地址，例如 `http://127.0.0.1` 或 `http://localhost`。
- OCR API Keys，一行一个 key
- 翻译 Base URL，例如 `https://api.openai.com/v1`
- 翻译 API Key
- 翻译模型，例如 `gpt-4.1-mini`

如果你的 OCR 返回字段不是默认格式，展开“高级字段映射”，按服务商文档填写：

- `regionsPaths`
- `textPaths`
- `boxPaths`
- `confidencePaths`

## 4. 自检

点击“自检”。理想结果类似：

```text
OCR 解析正常：识别 1 行 · HELLO OCR；AI 调用正常：你好，OCR
```

如果合成测试图没有识别结果，但当前页面是已启用的漫画阅读页，自检会继续用当前页面的真实漫画图片做一次页面样本检查。成功时会显示：

```text
页面样本 OCR 正常：第 1 张，识别 7 个区域；AI 调用正常：你好，OCR
```

如果失败，先看 popup 里的“配置状态”和自检结果。常见问题见 [troubleshooting.md](troubleshooting.md)。

## 5. 翻译

- “翻译本页”：翻译当前章节页。
- “重翻本页”：只重翻当前可见页面，不会把整章重新加入队列。
- “框选翻译”：手动选中一个区域翻译，优先级高于普通翻译。
- “自动翻译本网站”：进入漫画章节页后自动翻译。第 1 张图会优先完成，后续页面并发处理。

翻译气泡可以手动编辑；把气泡文字删空会移除该气泡，并保存删除状态。

## 6. 进度、重试与缓存

- 点击翻译、重翻、暂停、清除或取消后，popup 会显示页面实际返回的“处理中 / 排队 / 完成”等队列状态，而不只显示按钮已点击。
- 图片左上角按钮的颜色表示该图片的实时状态；左键切换翻译气泡显示，右键可重翻当前图片或进入框选翻译。
- 同一章节的同一图片内容会复用完成缓存；失败和空结果不会当作成功结果永久复用。
- 框选翻译、手动编辑和删空气泡的删除状态优先于普通自动翻译，刷新页面后仍会恢复。
