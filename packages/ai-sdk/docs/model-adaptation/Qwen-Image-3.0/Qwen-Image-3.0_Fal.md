# Qwen Image 3.0 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `alibaba/qwen-image-3/text-to-image`、`alibaba/qwen-image-3/edit` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> Fal 上只有一个 Qwen Image 3 系列端点，未区分标准版 / Pro 版。价格档位（1K $0.04、2K $0.075）与百炼 Pro 的档位结构一致，但 Fal 未标注具体对应哪个上游 model id。

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`
- **队列**：`POST https://queue.fal.run/<endpoint-id>` → `{ request_id, status_url, response_url, cancel_url }`；`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）；`GET .../requests/{id}` 取结果
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单

| 能力 | endpoint id |
|---|---|
| 文生图 | `alibaba/qwen-image-3/text-to-image` |
| 图像编辑（1–3 张参考图） | `alibaba/qwen-image-3/edit` |

## 3. 请求参数（两个端点共有）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 支持中英文，最长 5000 字符 |
| `negative_prompt` | string | 可选 | `""` | 最长 500 字符。**本项目规则：绝对不显示**，不下发 |
| `image_size` | 枚举或对象 | 可选 | 文生图 `square_hd`；编辑**无默认**（不传时模型自动决定） | 枚举 `square_hd`、`square`、`portrait_4_3`、`portrait_16_9`、`landscape_4_3`、`landscape_16_9` 等，或 `{ width, height }`。总像素须在 512×512 ~ 2048×2048 |
| `enable_prompt_expansion` | boolean | 可选 | **`true`** | LLM 自动改写提示词 |
| `seed` | integer | 可选 | 随机 | `[0, 2147483647]`。**本项目规则：绝对不显示**，不下发 |
| `enable_safety_checker` | boolean | 可选 | `true` | 关闭需账号授权 |
| `sync_mode` | boolean | 可选 | `false` | `true` 时以 data URI 返回且不入请求历史 |
| `num_images` | integer | 可选 | `1` | 1–6 |
| `output_format` | string | 可选 | `png` | `jpeg` / `png` / **`webp`**（比其他供应商多一个 webp） |

**仅 `edit` 有：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_urls` | string[] | 必填 | **1–3 张，必填**。顺序有意义——在 prompt 中以 'image 1' / 'image 2' / 'image 3' 引用。每边 384–2048 px；单张 ≤ 10 MB；格式 JPEG、JPG、**PNG（不能带 alpha）**、WEBP |

## 4. 响应结构

```json
{ "images": [ { "url": "https://v3b.fal.media/files/b/.../xxx.png" } ], "seed": 42 }
```

`images` 与 `seed` 都是必返回字段。输出里的 `seed` 只是回传，不暴露成可编辑参数。

## 5. 价格

来源：两个端点的 `llms.txt`（2026-08-22 读取），两端点同价。

| 输出分辨率 | 单价 |
|---|---|
| 1K | **$0.04 / 张** |
| 2K | **$0.075 / 张** |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 本端点**两个字段都存在**，必须主动不注册、不下发。
- `output_format`、`sync_mode` 不展示、不请求。
- `edit` 的 `image_urls` 是**必填**（不像 Seedream 的 edit 可省），且 PNG 不允许带 alpha 通道——透明图需先合成背景。
- `edit` 的 `image_size` 没有默认值，不传就由模型决定，与文生图行为不同。
- `enable_prompt_expansion` 默认 `true`，会改变出图结果。
- SDK 固定比例覆盖通用 10 档并提供显式 `1MP` 请求档；`1MP` 文生图发送约 1024²、16 对齐的对象，编辑分支按官方契约省略 `image_size`。旧默认仍是 1K + 提示词扩写开启；需要复刻插件旧结果时 adapter 必须显式传 `falQwenImage30Resolution: '1MP'` 与 `falQwenImage30PromptExpansion: false`。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图模型页 | https://fal.ai/models/alibaba/qwen-image-3/text-to-image | 否 |
| 文生图 schema + 价格 | https://fal.ai/models/alibaba/qwen-image-3/text-to-image/llms.txt | 否 |
| 编辑模型页 | https://fal.ai/models/alibaba/qwen-image-3/edit | 否 |
| 编辑 schema + 价格 | https://fal.ai/models/alibaba/qwen-image-3/edit/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
