# Kling 3.0 Turbo · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `kling-3.0-turbo` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |
| 上游官方模型标识 | `kling-3.0-turbo`（与可灵官方能力地图一致） |

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/videos/generations` → `{ code: 200, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`

## 2. 能力清单

文生视频、图生视频（**仅首帧**）、多镜头分镜（**通过固定格式提示词表达**，不是结构化字段）。

> Turbo **没有** `mode`、`negative_prompt`、`audio`、`multi_shot` / `multi_prompt` / `element_list` 这些 `kling-v3` 的结构化字段，也**没有尾帧**。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | `kling-3.0-turbo` |
| `prompt` | string | 必填 | — | 上游限制 **≤ 3072 字符，建议 ≤ 2500 字符**。图生视频时可留空（纯按首帧图生成） |
| `first_frame_image` | string | 可选 | — | 首帧图。支持**图片 URL 或 Base64**。上游限制：`.jpg` / `.jpeg` / `.png`；**≤ 50 MB**；宽高 **≥ 300 px**；宽高比 `1:2.5` ~ `2.5:1` |
| `aspect_ratio` | string | 可选 | `16:9` | `16:9`、`9:16`、`1:1`。**仅文生视频生效；图生视频时此字段无效，比例由首帧图决定** |
| `resolution` | string | 可选 | `720p` | `720p` / `1080p`（**没有 4K**） |
| `duration` | integer | 可选 | `5` | **3–15 秒**。必须是纯数字，加引号会报错 |
| `watermark` | boolean | 可选 | — | **仅当显式传入时才下发到上游；不传则不添加水印** |
| `nsfw_check` | boolean | 可选 | `false` | 提交前内容审核 |

### 文生视频 vs 图生视频

系统按是否提供 `first_frame_image` **自动判断**，用户无需显式声明。

| 参数 | 文生视频 | 图生视频 |
|---|---|---|
| `prompt` | ✅ 必填 | ✅ 可选（留空纯按首帧图生成） |
| `first_frame_image` | ❌ 不传 | ✅ 必填 |
| `aspect_ratio` | ✅ 可选 | ❌ 无效（比例由首帧图决定） |
| `resolution` | ✅ 可选 | ✅ 可选 |
| `duration` | ✅ 可选（3–15） | ✅ 可选（3–15） |
| `watermark` | ✅ 可选 | ✅ 可选 |

## 4. 响应结构

提交返回 `{ code, data: [{ status: "submitted", task_id }] }`；轮询 `GET /v1/tasks/{task_id}`，成功后读 `result.videos[]`。

## 5. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) → 视频标签页 `KLING-3.0-TURBO`（2026-08-22，2 个档位，1 Credit ≈ $0.1）。

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 720P | 1.144 Credits/秒 ≈ **$0.1144/秒** | $0.143 | 20% |
| 1080P | 1.432 Credits/秒 ≈ **$0.1432/秒** | $0.179 | 20% |

> 注意：Turbo 的单价**高于** `kling-v3` 的 std / pro 档（$0.0672 / $0.0896），Turbo 是「更快」不是「更便宜」。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 的 Turbo 接口这两个字段都没有。
- **图生视频只有首帧，没有尾帧**；`aspect_ratio` 在图生视频下无效，UI 应禁用。
- 首帧图字段名是 `first_frame_image`（单个字符串），与 `kling-v3` 的 `image_urls`（数组）完全不同，不能共用。
- 分辨率字段名是 `resolution`（`720p` / `1080p`），而 `kling-v3` 用 `mode`（`std` / `pro` / `4k`）——同一模型家族里两套写法。
- 多镜头只能靠提示词的固定格式表达，没有结构化分镜字段。
- `watermark` 不传即不加水印。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Kling 3.0 Turbo 视频生成 | https://docs.apimart.ai/cn/api-reference/videos/kling-3.0-turbo/generation | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（视频标签页搜 KLING-3.0-TURBO） | https://apimart.ai/zh/pricing | 否 |
| 可灵官方视频能力地图（仅参考） | https://www.klingai.com/document-api/guides/capability-map/video | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
