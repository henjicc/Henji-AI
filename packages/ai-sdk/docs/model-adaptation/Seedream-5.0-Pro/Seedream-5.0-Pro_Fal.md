# Seedream 5.0 Pro · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| 模态 | 图片 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `bytedance/seedream/v5/pro/text-to-image`、`bytedance/seedream/v5/pro/edit` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录（每个模型都有 `llms.txt` 实时 schema） |
| 价格可见性 | 公开，无需登录（写在模型 `llms.txt` 与定价页） |

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`（在 https://fal.ai/dashboard/keys 创建）
- **同步调用**：`POST https://fal.run/<endpoint-id>`
- **队列提交**：`POST https://queue.fal.run/<endpoint-id>`，返回 `{ request_id, status_url, response_url, cancel_url }`
- **查询状态**：`GET https://queue.fal.run/<app>/requests/{request_id}/status`，`status` 取值 `IN_QUEUE`（含 `queue_position`）/ `IN_PROGRESS` / `COMPLETED`
- **取结果**：`GET https://queue.fal.run/<app>/requests/{request_id}`
- **取消**：`PUT .../requests/{request_id}/cancel`
- **Webhook**：提交时加 `?fal_webhook=<url>`
- **计费**：按输出计费，从预付余额扣除；**服务端错误与排队时间不计费**
- **上传输入文件**：fal CDN（见 https://fal.ai/docs/documentation/model-apis/fal-cdn）
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`（实时生成，不会与线上端点漂移）；OpenAPI：`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint-id>`

## 2. 能力清单

| 能力 | endpoint id |
|---|---|
| 文生图 | `bytedance/seedream/v5/pro/text-to-image` |
| 图像编辑 / 多参考图（最多 10 张） | `bytedance/seedream/v5/pro/edit` |

> Fal 上 Seedream 5.0 Pro **没有独立的图层拆分端点**；`edit` 的模型简介提到具备 layer separation 能力，但输入 schema 中没有对应开关。需要图层拆分请走火山引擎官方或 APIMart / KIE。

## 3. 请求参数

### 3.1 `bytedance/seedream/v5/pro/text-to-image`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 生成描述 |
| `image_size` | 枚举或对象 | 可选 | `auto_2K` | 枚举：`square_hd`、`square`、`portrait_4_3`、`portrait_16_9`、`landscape_4_3`、`landscape_16_9`、`auto_1K`、`auto_2K`；或对象 `{ width, height }`（单边 ≤ 14142）。总像素须在 `[1048576 (1024×1024), 4194304 (2048×2048)]`，宽高比在 `[1/16, 16]` |
| `num_images` | integer | 可选 | `1` | 1–6，独立跑多次生成 |
| `output_format` | string | 可选 | `jpeg` | `jpeg` / `png` |
| `sync_mode` | boolean | 可选 | `false` | `true` 时结果以 data URI 返回，且不进入请求历史 |
| `enable_safety_checker` | boolean | 可选 | `true` | 关闭需账号授权；未授权的请求一律走安全检查 |

### 3.2 `bytedance/seedream/v5/pro/edit`

字段同上，另加：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_urls` | string[] | 必填 | 参考图 URL 列表。**最多 10 张；超出时只取最后 10 张**（不报错，静默截断） |

## 4. 响应结构

```json
{ "images": [ { "url": "https://v3b.fal.media/files/b/.../xxx.png" } ] }
```

`images` 为必返回字段，元素为 `Image` 对象（含 `url`，通常还有宽高、content_type）。

## 5. 价格

来源：两个端点各自的 `llms.txt`（2026-08-22 读取），Fal 标注为 tentative pricing。

**文生图**

| 输出图面积 | 单价 |
|---|---|
| ≤ 1536×1536 | **$0.0675/张** |
| 1536×1536 ~ 2048×2048 | **$0.135/张** |

**图像编辑**：在上面基础上叠加输入图费用——**第 1 张输入图免费，之后每张 +$0.0045**，且这笔加价是**按每张输出图**计算：
`单价 = 基础价 + $0.0045 × 额外输入图数量`（每张输出图）。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。本端点无这两个字段。
- `output_format`、`sync_mode` 按项目约定不展示、不请求。
- 画布比例映射：智能比例走 `auto_1K` / `auto_2K`；固定比例应换算成满足面积与宽高比约束的 `{width, height}`，不要依赖 `square_hd` 这类语义枚举（覆盖不到 21:9 等比例）。
- SDK 固定比例覆盖 `1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9`；另提供显式 `1MP` 请求档，把所选比例换算为约 1024²、16 对齐的对象。默认仍是 0.1.5 的 `2K`，不会改变既有宿主。
- `image_urls` 超过 10 张会被**静默截断**为最后 10 张，UI 层需自行限制数量，否则用户以为传上去了。
- Fal 定价标注为 tentative，接入前应重新读一次 `llms.txt`。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图模型页 | https://fal.ai/models/bytedance/seedream/v5/pro/text-to-image | 否 |
| 文生图 schema + 价格（权威） | https://fal.ai/models/bytedance/seedream/v5/pro/text-to-image/llms.txt | 否 |
| 文生图 OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedream/v5/pro/text-to-image | 否 |
| 编辑模型页 | https://fal.ai/models/bytedance/seedream/v5/pro/edit | 否 |
| 编辑 schema + 价格（权威） | https://fal.ai/models/bytedance/seedream/v5/pro/edit/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| 鉴权 | https://fal.ai/docs/documentation/setting-up/authentication | 否 |
| 计费说明 | https://fal.ai/docs/documentation/model-apis/pricing | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
