# Seedream 5.0 Pro · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `seedream-5-0-pro`（兼容 `seedream-5.0-pro`） |
| 接口形态 | **异步任务**：提交返回 `task_id`，轮询统一任务接口 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`（在 https://apimart.ai/keys 获取）
- **提交**：`POST /v1/images/generations`
- **查询**：`GET /v1/tasks/{task_id}`，可加 `?language=zh|en|ko|ja`（默认英文）
- **轮询建议**：官方提示本模型较慢，1K 约 90 秒、2K 约 160 秒；每 5–10 秒轮询一次，客户端超时建议 **5 分钟**
- **结果存储**：输出图片已镜像到 APIMart 自有存储并返回平台 URL，但仍需业务侧及时下载持久化（响应含 `expires_at`）

提交响应：

```json
{ "code": 200, "data": [ { "status": "submitted", "task_id": "task_01K8SGYNNNVBQTXNR4MM964S7K" } ] }
```

任务查询响应（关键字段）：

| 字段 | 说明 |
|---|---|
| `id` | 任务 ID |
| `status` | `pending` / `processing` / `completed` / `failed` / `cancelled` |
| `progress` | 0–100 |
| `cost` / `credits_cost` | 本次扣费金额 / 积分 |
| `result.images[]` | 图像结果数组（视频任务为 `result.videos[]`） |
| `created` / `completed` / `estimated_time` / `actual_time` | 时间戳与耗时（秒） |
| `error.{code,message,type}` | 仅 `failed` 时存在 |

错误类型：400 `invalid_request_error`、401 `authentication_error`、402 `payment_required`、403 `permission_error`、429 `rate_limit_error`、500 `server_error`、502 `bad_gateway`。

## 2. 能力清单

| 能力 | 触发方式 |
|---|---|
| 文生图 | 只传 `prompt` |
| 单图 / 多图生图（最多 10 张参考图） | `image_urls` |
| 交互编辑（坐标 / 框选 / 手绘标记） | `prompt` 中写 `<point>x y</point>` 或 `<bbox>x1 y1 x2 y2</bbox>`（归一化到 0–1000），或上传带手绘标记的图 |
| 图层拆分（1 底图 + 最多 16 层） | `layer_decomposition: true` + 恰好 1 张 `image_urls` |
| 透明通道编辑 | `background: "transparent"` + 恰好 1 张带透明通道的输入图 + `output_format: "png"` |

**平台会直接拒绝（400，不建任务、不扣费）**：`n > 1`、`sequential_image_generation`、`stream`、`tools`、`image_urls` 超过 10 张。

## 3. 请求参数（Body）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | `seedream-5-0-pro` | `seedream-5-0-pro`（推荐），亦接受 `seedream-5.0-pro` |
| `prompt` | string | 必填 | — | 使用 `layer_decomposition: true` 时可省略。建议 ≤ 600 英文单词。除中英文外支持俄/阿/菲/泰/土/韩/马来/西/葡/印尼/法/德/越/日语的原生文字生成 |
| `resolution` | string | 可选 | `1K` | APIMart 扩展字段。`1K` / `1.5K` / `2K`（兼容小写）。**1.5K 与 1K 同价、画质更好，无特殊理由优先 1.5K**。传 3K/4K 返回 400。与档位形式的 `size` 同传时以 `size` 为准；`size` 为精确像素时本字段被忽略 |
| `size` | string | 可选 | `auto` | 三种写法，见下 |
| `image_urls` | array | 可选 | — | 参考图 URL 列表，**最多 10 张**。支持公网 `http(s)` URL 或 `data:image/<小写格式>;base64,<编码>` |
| `background` | string | 可选 | `opaque` | `opaque` / `transparent`。`transparent` 只能用于图生图，且必须恰好 1 张本身带透明通道的输入图，同时 `output_format: "png"` |
| `layer_decomposition` | boolean | 可选 | `false` | 图层拆分。开启时必须恰好 1 张 PNG/JPEG 图，总像素 `[262144, 36000000]`、≤ 30 MB；`size` 只接受 `1K`/`1.5K`/`2K`/`auto`（默认 `auto`）；`output_format` 只控制底图，图层恒为 PNG |
| `optimize_prompt_options` | object | 可选 | `{"mode":"standard"}` | 仅支持 `standard`。兼容扁平写法 `"optimize_prompt_options.mode": "standard"` |
| `output_format` | string | 可选 | `jpeg` | `jpeg` / `png`。`response_format` 与之等价，其余取值按 `jpeg` 处理 |
| `watermark` | boolean | 可选 | **`false`** | 右下角 "AI generated" 水印。注意与火山官方默认（`true`）相反 |
| `nsfw_check` | boolean | 可选 | `false` | `true` 时用 `omni-moderation-latest` 预审提示词与输入图，会增加成本与延迟 |
| `n` | integer | 可选 | `1` | **只能为 1**。需要组图请改用 `seedream-5-0-lite` |

### size 三种写法

**写法 ①：档位**——`{"size":"2K"}` 与 `{"resolution":"2K"}` 等价，宽高比交给模型判断。

**写法 ②：档位 + 宽高比**——与 `resolution` 配合。支持 `1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`3:2`、`2:3`、`2:1`、`1:2`、`21:9`、`auto`；兼容 `16x9` 小写 `x` 写法（不能有空格）。**列表外的比例（如 `9:21`）直接返回 400，不会静默回退成 1:1**。

| 分辨率 | 1:1 | 4:3 | 3:4 | 16:9 | 9:16 | 3:2 | 2:3 | 2:1 | 1:2 | 21:9 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1K | 1024×1024 | 1152×864 | 864×1152 | 1312×736 | 736×1312 | 1248×832 | 832×1248 | 1440×720 | 720×1440 | 1568×672 |
| 1.5K | 1536×1536 | 1792×1344 | 1344×1792 | 2048×1152 | 1152×2048 | 1872×1248 | 1248×1872 | 2176×1088 | 1088×2176 | 2352×1008 |
| 2K | 2048×2048 | 2304×1728 | 1728×2304 | 2560×1440 | 1440×2560 | 2496×1664 | 1664×2496 | 2880×1440 | 1440×2880 | 3024×1296 |

> 注：APIMart 的档位映射与火山官方文档的映射表在 16:9 / 4:3 等档位上数值略有差异，以调用平台的表为准。

**写法 ③：精确像素**——`宽x高`（兼容 `2048X1024` / `2048×1024`），此时 `resolution` 不参与。总像素须在 `[921600, 4624220]`，宽高比须在 `[1/16, 16]`；限制的是**乘积**不是单边（`512×512` 会 400，`2048×1024` 合法）。

### 单张参考图限制

格式 jpeg/png/webp/bmp/tiff/gif/heic/heif；宽高比 `[1/16, 16]`；单边 > 14 px；≤ 30 MB；总像素 ≤ 36,000,000。

## 4. 响应结构

普通生成，`GET /v1/tasks/{task_id}` 成功时：

```json
{
  "id": "task_01JFXYZ123456789ABCDEF",
  "status": "success",
  "progress": 100,
  "cost": 0.045,
  "result": {
    "images": [
      { "url": ["https://cdn.example.com/images/image_task_xxx_0.png"],
        "sizes": ["2048x1152"], "output_formats": ["png"], "expires_at": 1784696685 }
    ]
  }
}
```

> 注意：`url` 是**数组**，不是字符串。文档中同时出现 `status: "completed"`（任务接口定义）与 `status: "success"`（示例），解析时两者都要当作终态成功处理。

**图层拆分响应**：`url`、`sizes`、`output_formats` 与 `layers` 数组**按下标一一对应，下标 0 恒为底图**：

```json
{ "result": { "images": [{
  "url": ["...image_task_xxx_0.jpeg", "...image_task_xxx_1.png", "...image_task_xxx_2.png"],
  "sizes": ["2048x2048", "1273x265", "492x98"],
  "output_formats": ["jpeg", "png", "png"],
  "layer_decomposition": true,
  "layers": [
    { "z_index": 0, "size": "2048x2048", "output_format": "jpeg" },
    { "z_index": 1, "size": "1273x265", "output_format": "png", "name": "标题文字",
      "description": "黄色大号衬线字体的标题文字",
      "bounding_box": { "absolute": [383,120,1655,384], "normalized": [187,59,808,188] } }
  ]
}]}}
```

还原方式：按 `z_index` 从小到大叠放；`absolute` 用于还原到输出底图，`normalized`（0–1000）用于还原到任意 `W×H` 画布。

## 5. 价格

**两处来源数值不一致，两个都记录，实际以定价中心为准（定价中心可直接读到当前生效价，API 文档正文更新较慢）。**

来源 A —— [APIMart 定价中心](https://apimart.ai/zh/pricing)（2026-08-22 读取，图像标签页，1 Credit ≈ $0.1）：

| 规格 | 价格 |
|---|---|
| 默认 | 0.36 Credits/张 ≈ **$0.036/张** |
| 1K | 0.2928 Credits/张 ≈ **$0.02928/张** |
| 2K | 0.5856 Credits/张 ≈ **$0.05856/张** |
| 1K-layer（图层拆分） | 0.1464 Credits/张 ≈ **$0.01464/张** |
| 2K-layer（图层拆分） | 0.2928 Credits/张 ≈ **$0.02928/张** |

来源 B —— API 文档「计费说明」章节：

| 条件 | 单价 |
|---|---|
| 总像素 ≤ 2.61M（`resolution` 为 `1K`/`1.5K`/不传，或精确像素 ≤ 2,601,124） | $0.045/张 |
| 总像素 > 2.61M（`resolution: "2K"`，或精确像素 > 2,601,124） | $0.09/张 |

共同规则：1.5K 与 1K 同价；`size` 为精确像素时按**实际输出面积**判档，`resolution` 不影响；**第 1 张参考图免费，第 2 张起每张另计**；任务失败自动全额退款。

**图层拆分的预扣与结算**：提交时按 **17 张**保守预扣（`1K`/`1.5K` 按 1K 档，`2K` 与 `auto` 按 2K 档），账户余额必须能覆盖 17 张预扣；完成后按底图与每个实际图层的真实像素面积**逐张判档求和**结算，多扣自动退回。

## 6. 常见错误（文档明列）

| 场景 | 结果 |
|---|---|
| `resolution` 传 3K/4K | 400 |
| `size` 既非档位/`auto`，也非支持比例或合法像素 | 400 |
| 精确像素总像素越界（须在 `[921600, 4624220]`）或宽高比越界（`[1/16,16]`） | 400 |
| `n > 1` 或组图参数 | 拒绝（单图模型） |
| 参考图超过 10 张 | 拒绝 |
| 图层拆分未传图或传多张 | 必须恰好 1 张 |
| 图层拆分使用比例或精确像素 | `size` 仅支持 `1K`/`1.5K`/`2K`/`auto` |
| 透明背景用于文生图或多图 | 必须恰好 1 张带透明通道的图 |
| 透明背景 + JPEG | 须设 `output_format: "png"` |
| `stream` / `tools` | 本模型不支持，直接 400 |
| 提示词优化模式非法 | 仅支持 `standard` |

## 7. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。本接口无这两个字段。
- `output_format` 默认不显示且不请求。
- Pro 是单图模型，UI 不要出现数量选择；比例集合必须严格取平台支持列表，越界会 400 而不是回退。
- 图层拆分与普通生成的结果结构不同（多 URL + `layers` 元数据），必须作为独立能力分支，不能与普通出图混发。
- 轮询超时按 5 分钟设置，明显长于普通图片模型。

## 8. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Seedream-5.0-Pro 图像生成 API（参数、示例、图层拆分、计费、错误） | https://docs.apimart.ai/cn/api-reference/images/seedream-5-0-pro/generation | 否 |
| 同页纯 Markdown | https://docs.apimart.ai/cn/api-reference/images/seedream-5-0-pro/generation.md | 否 |
| 获取任务状态（统一轮询协议） | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| Webhook 回调 | https://docs.apimart.ai/cn/api-reference/tasks/webhook | 否 |
| 定价中心（图像标签页搜 SEEDREAM-5-0-PRO） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
| 文档总索引 | https://docs.apimart.ai/llms.txt | 否 |
