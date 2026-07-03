# 本地 OCR HTTP 接入说明

Universal Manga Translator 不在插件里直接运行重型 OCR 模型。原因是浏览器扩展不适合打包大型模型、GPU/CPU 推理依赖和 Python 环境。推荐做法是：你可以把任意本地 OCR 程序封装成 HTTP 服务，然后在插件直连模式或高级后端模式里填写它的 URL。

## 最小 endpoint 约定

示例 URL：

```text
http://127.0.0.1:9000/ocr
```

插件/后端会用 `multipart/form-data` 调用该 URL，输入模式二选一：

- `image_base64`：字段名默认 `image_base64`，值为图片 base64 字符串。
- `file`：字段名默认 `file`，值为图片文件 Blob。

服务返回 JSON。只要能通过路径映射解析出文字和坐标即可。

## 推荐返回格式

```json
{
  "words_result": [
    {
      "words": "HELLO",
      "location": { "left": 10, "top": 20, "width": 120, "height": 40 },
      "score": 0.98
    }
  ]
}
```

对应映射：

```text
regionsPaths = words_result
textPaths = words
boxPaths = location
confidencePaths = score
```

也支持 polygon / bbox，例如：

```json
{
  "data": {
    "regions": [
      { "text": "HELLO", "box": [[10,20],[130,20],[130,60],[10,60]], "confidence": 0.98 }
    ]
  }
}
```

对应映射：

```text
regionsPaths = data.regions
textPaths = text
boxPaths = box
confidencePaths = confidence
```

## 本地服务注意事项

1. 插件直连模式可直接填写 `http://127.0.0.1:xxxx/ocr`。如果浏览器或系统拦截跨域请求，扩展会优先通过 background 代理发起请求。
2. 服务应尽量返回原图坐标系中的位置，不要返回缩放后的坐标；否则覆盖气泡会偏移。
3. 空结果不要伪造成成功区域；插件不会缓存 empty OCR，避免一次识别失败污染整章缓存。
4. 如果你使用 GPU OCR，建议自己在本地服务里做队列和并发限制。
