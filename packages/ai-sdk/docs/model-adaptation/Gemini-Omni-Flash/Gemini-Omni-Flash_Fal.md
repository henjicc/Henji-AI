# Gemini Omni Flash · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `google/gemini-omni-flash/image-to-video`、`google/gemini-omni-flash/reference-to-video` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> **Fal 上没有 `google/gemini-omni-flash/text-to-video` 端点**（2026-08-22 实测返回 404）。纯文生视频只能走 APIMart 或 KIE。

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`；**队列**：`POST https://queue.fal.run/<endpoint-id>`，`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）、`GET .../requests/{id}`
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单

| 能力 | endpoint id |
|---|---|
| 图生视频 | `google/gemini-omni-flash/image-to-video` |
| 参考生视频（多参考图） | `google/gemini-omni-flash/reference-to-video` |

## 3. 请求参数

### 3.1 `google/gemini-omni-flash/image-to-video`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | **必填** | — | 描述图片应如何被动画化 |
| `image_url` | string | **必填** | — | 待动画化的输入图 URL |
| `aspect_ratio` | string | 可选 | `16:9` | **仅 `16:9` / `9:16`** |
| `duration` | integer | 可选 | **`8`** | **3 ~ 10 秒**（整数，注意 APIMart Ext / KIE 只允许 4/6/8/10） |

### 3.2 `google/gemini-omni-flash/reference-to-video`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | **必填** | — | 视频描述。**可用 `<IMAGE_REF_0>` 这样的标签把参考图内联绑定到角色**（见 Fal 的 Omni Flash prompt guide） |
| `image_urls` | string[] | **必填** | — | 要融入视频的参考图 URL 列表 |
| `aspect_ratio` | string | 可选 | `16:9` | `16:9` / `9:16` |
| `duration` | integer | 可选 | `8` | 3 ~ 10 秒 |

## 4. 响应结构

```json
{ "video": { "url": "https://v3b.fal.media/files/.../output.mp4" } }
```

## 5. 价格（按 token）

来源：两个端点的 `llms.txt`（2026-08-22 读取）。

| 计费项 | 单价 |
|---|---|
| 输入 token（文本 / 音频 / 视频） | **$1.875 / 1M tokens** |
| 输出 token | **$21.875 / 1M tokens** |

**720p 视频约合 $0.13 / 秒。**

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 本端点两个字段都没有。
- **Fal 没有纯文生视频端点**，产品若要文生视频必须走别的供应商。
- **`duration` 是整数且支持 3–10 的连续取值**，默认 8；而 APIMart 的 Ext 渠道与 KIE 都只允许 4/6/8/10——跨供应商的时长选项必须分别裁剪。
- `aspect_ratio` 只有横竖两种，没有 1:1。
- 参考图的角色绑定用 `<IMAGE_REF_0>` 标签，与 APIMart 官方渠道（自然语言描述）、KIE（character_ids 资产）都不同。
- 按 token 计费，成本估算不能按次或按秒简单换算。
- Fal 上没有 KIE 那套语音 / 角色资产端点。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 图生视频模型页 | https://fal.ai/models/google/gemini-omni-flash/image-to-video | 否 |
| 图生视频 schema + 价格 | https://fal.ai/models/google/gemini-omni-flash/image-to-video/llms.txt | 否 |
| 参考生视频模型页 | https://fal.ai/models/google/gemini-omni-flash/reference-to-video | 否 |
| 参考生视频 schema + 价格 | https://fal.ai/models/google/gemini-omni-flash/reference-to-video/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
