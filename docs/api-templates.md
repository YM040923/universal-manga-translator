# OCR API 映射模板

通用 OCR 链路只假设一件事：API 能接收图片并返回“文字 + 坐标”的 JSON。不同服务字段名不同，所以用路径配置适配。

## 基础字段

- OCR API URL：例如 `https://example.com/ocr` 或 `http://127.0.0.1:9000/ocr`
- OCR API Keys：支持多个 key，逗号或多行保存；遇到额度/认证/限流错误会自动轮换。
- inputMode：`image_base64` 或 `file`
- imageField：图片字段名，常见为 `image_base64`、`image`、`file`
- staticFields：额外固定表单字段，例如 `{ "language": "en" }`

## 响应路径

- `regionsPaths`：区域数组所在路径。
- `textPaths`：每个区域中文字字段路径。
- `boxPaths`：每个区域中坐标字段路径。
- `confidencePaths`：置信度字段路径。

路径支持点号和数组下标，例如：

```text
data.result
result.items
pages.0.blocks
```

## 模板 A：类百度格式

响应：

```json
{
  "words_result": [
    { "words": "HELLO", "location": { "left": 10, "top": 20, "width": 120, "height": 40 }, "score": 0.98 }
  ]
}
```

配置：

```text
inputMode=image_base64
imageField=image_base64
regionsPaths=words_result
textPaths=words
boxPaths=location
confidencePaths=score
```

## 模板 B：通用 data.regions 格式

响应：

```json
{
  "data": {
    "regions": [
      { "text": "HELLO", "bbox": [10, 20, 130, 60], "confidence": 0.98 }
    ]
  }
}
```

配置：

```text
inputMode=image_base64
imageField=image_base64
regionsPaths=data.regions
textPaths=text
boxPaths=bbox
confidencePaths=confidence
```

## 模板 C：本地 file 上传

如果本地 OCR 服务只接受文件：

```text
OCR API URL=http://127.0.0.1:9000/ocr
inputMode=file
imageField=file
regionsPaths=words_result,data.regions,result
textPaths=words,text,content
boxPaths=location,box,bbox
confidencePaths=score,confidence
```

## 费用优化建议

1. 优先开启整章缓存：同一网站、同一漫画章节、同一图片、同一 OCR profile 已成功翻译后不会重复 OCR。
2. 重翻当前页会复用 OCR cache，只重新请求文本翻译，减少 OCR 消耗。
3. 不缓存 empty OCR，避免网络抖动导致后续永远空白。
4. OCR key 池按额度/限流错误自动轮换；不要把多个无效 key 混在一起长期使用。
