# Seedream 5.0 Pro · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `seedream/5-pro-text-to-image`、`seedream/5-pro-image-to-image`、`seedream/5-pro-layer-decomposition` |
| 接口形态 | **异步任务**：统一 `createTask` 提交，统一 `recordInfo` 查询 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录（定价页可搜索） |

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`（在 https://kie.ai/api-key 获取）
- **提交**：`POST /api/v1/jobs/createTask`，请求体 `{ "model": ..., "callBackUrl": ..., "input": { ... } }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=<taskId>`
- **回调**：生产环境建议用 `callBackUrl` 而非轮询；回调签名校验见 Webhook 校验指南
- **账户积分**：`GET /api/v1/chat/credit`
- **下载链接**：`GET /api/v1/common/download-url`

任务查询返回（`data` 对象）：

| 字段 | 说明 |
|---|---|
| `taskId` | 任务 ID |
| `model` | 本次使用的模型 |
| `state` | `waiting` / `queuing` / `generating` / `success` / `fail` |
| `param` | 创建任务时的原始请求参数（**JSON 字符串**） |
| `resultJson` | 结果（**JSON 字符串，需再 parse**）。图像/视频为 `{resultUrls: []}`；文本型为 `{resultObject: {}}` |
| `failCode` / `failMsg` | 失败码与失败信息，成功时为空字符串 |
| `costTime` | 处理耗时（毫秒） |
| `completeTime` / `createTime` / `updateTime` | Unix 毫秒时间戳 |
| `creditsConsumed` | 本次消耗积分 |

> `progress` 字段只有 sora2 / sora2 pro 会返回，Seedream 不返回进度。

## 2. 能力清单（KIE 把每种能力拆成独立 model，不能漏）

| 能力 | model |
|---|---|
| 文生图 | `seedream/5-pro-text-to-image` |
| 图片编辑（1–10 张参考图） | `seedream/5-pro-image-to-image` |
| 图层拆分 | `seedream/5-pro-layer-decomposition` |

## 3. 请求参数

### 3.1 `seedream/5-pro-text-to-image`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | 必填 | — | 3–5000 字符 |
| `input.aspect_ratio` | string | 必填 | `1:1` | `1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`2:3`、`3:2`、`21:9` |
| `input.quality` | string | 必填 | `basic` | `basic` = 1K，`high` = 2K |
| `input.output_format` | string | 可选 | `png` | `png` / `jpeg` |
| `input.nsfw_checker` | boolean | 可选 | `false` | 设为 `false` 关闭内容过滤，结果由模型直接返回；平台声明不保证全部过滤 |

### 3.2 `seedream/5-pro-image-to-image`

同上，另加：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `input.image_urls` | array | 必填 | **最多 10 张**。传上传后的文件 URL（不是文件内容）。支持 image/jpeg、image/png、image/webp；单张 ≤ 30 MB |

`prompt` 为 3–5000 字符；`quality` 同为 `basic`(1K) / `high`(2K)。

### 3.3 `seedream/5-pro-layer-decomposition`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.image_url` | string | 必填 | — | **单张**源图。支持 PNG、JPEG、WebP、BMP、TIFF、GIF；**不支持 HEIC、HEIF**；≤ 30 MB；总像素 262,144–36,000,000；宽高比 1:16–16:1 |
| `input.prompt` | string | 可选 | — | 0–5000 字符。不传时模型自动识别主要元素；支持 `<bbox>x1 y1 x2 y2</bbox>` 精确指定，推荐 **0–1000 归一化坐标** |
| `input.size` | string | 可选 | `auto` | `auto` / `1K` / `1.5K` / `2K`。底图保持输入图宽高比，各图层保持对应元素在原图中的宽高比 |
| `input.output_format` | string | 可选 | **`jpeg`** | 仅控制**底图**格式；所有拆分图层固定输出 PNG |

> 注意：图层拆分端点的 `output_format` 默认是 `jpeg`，与另两个端点（默认 `png`）不同。

## 4. 响应结构

**普通生成**：`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://..."] }`。

**图层拆分**：`resultJson` 结构不同，**不能按普通单图 URL 解析**：

```json
{
  "resultObject": {
    "layers_data": [
      { "z_index": 0, "size": "1080x1080", "output_format": "jpeg", "url": "https://.../xxx.jpeg" },
      { "z_index": 1, "size": "1179x245", "output_format": "png",
        "bounding_box": { "absolute": [202,63,872,202], "normalized": [187,58,806,186] },
        "name": "Seedream标题文字",
        "description": "提取黄色的Seedream标题文字，只保留文字本体……",
        "url": "https://.../yyy.png" }
    ]
  },
  "resultUrls": ["https://.../xxx.jpeg", "https://.../yyy.png", "..."]
}
```

`z_index=0` 为底图；图层按 `z_index` 从小到大叠放；`normalized` 为 0–1000 归一化坐标。

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `seedream`；1 Credit = $0.005）。

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 |
|---|---|---|---|
| 文生图 1K | 7 /张 | **$0.035/张** | $0.045 |
| 文生图 2K | 14 /张 | **$0.07/张** | $0.09 |
| 图片编辑 1K | 7 /张 | **$0.035/张** | $0.045 |
| 图片编辑 2K | 14 /张 | **$0.07/张** | $0.09 |
| 图层拆分 1K | 7 /张 | **$0.035/张** | $0.0675 |
| 图层拆分 1.5K | 7 /张 | **$0.035/张** | $0.0675 |
| 图层拆分 2K | 14 /张 | **$0.07/张** | $0.135 |
| 输入图（首张免费） | 0.5 /张 | **$0.0025/张** | $0.003 |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。本接口无这两个字段。
- `output_format` 默认不显示且不请求；注意三个端点默认值不一致。
- KIE 按能力拆 model，适配时应在同一个「模型」下按有无参考图/是否图层拆分路由到三个 model ID。
- `resultJson` 是 JSON 字符串，必须二次 parse；图层拆分要读 `resultObject.layers_data` 而不是只取 `resultUrls[0]`。
- `nsfw_checker` 默认 `false`（即不过滤），如需内容安全应显式打开。
- KIE 的 `quality` 只有 `basic`(1K) / `high`(2K)，**没有 1.5K 档**；1.5K 只在图层拆分的 `size` 中出现。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Seedream 5.0 Pro 文生图 | https://docs.kie.ai/cn/market/seedream/5-pro-text-to-image | 否 |
| Seedream 5.0 Pro 图片编辑 | https://docs.kie.ai/cn/market/seedream/5-pro-image-to-image | 否 |
| Seedream 5.0 Pro 图层分离 | https://docs.kie.ai/41313512e0（英文路径：https://docs.kie.ai/market/seedream/5-pro-layer-decomposition） | 否 |
| 获取任务详情（统一轮询协议） | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门（Base URL / 鉴权 / 积分） | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| Webhook 校验指南 | https://docs.kie.ai/cn/common-api/webhook-verification | 否 |
| 文件上传（获取可用的 image_urls） | https://docs.kie.ai/cn/file-upload-api/upload-file-url | 否 |
| 定价页（搜 `seedream`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
| 文档总索引 | https://docs.kie.ai/llms.txt | 否 |
