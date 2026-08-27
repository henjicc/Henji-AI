# Seedance 2.0 Mini · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `seedance-2.0-mini` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> APIMart 把 `seedance-2.0` / `seedance-2.0-fast` / `seedance-2.0-mini` 写在**同一份文档**里，参数结构完全一致，差异在**分辨率上限**与**提示词长度**。

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/videos/generations` → `{ code: 200, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`，状态 `pending` / `processing` / `completed` / `failed`，结果在 `result.videos[]`

## 2. 能力清单

文生视频、图生视频（首帧）、首尾帧视频、参考视频生视频、参考音频、有声视频、连续视频生成（返回尾帧）、联网搜索增强、私域虚拟人像素材（Asset URL）。**功能与标准版一致**。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | `seedance-2.0-mini` |
| `prompt` | string | 条件 | — | **文生视频必填**；图生视频 / 视频参考生视频可选。**`seedance-2.0-mini` 没有字数限制**。文档建议：中文提示词不超过 500 字、英文不超过 1000 词；字数过多易导致信息分散，模型可能忽略细节 |
| `duration` | integer | 可选 | `5` | **4 ~ 15 秒** |
| `size` | string | 可选 | `16:9` | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9`、`adaptive`。宽高比须在 0.5–2.5 之间 |
| `resolution` | string | 可选 | `720p` | **仅 `480p` / `720p`**（`1080p` 与 `4k` 只有标准版 `seedance-2.0` 支持） |
| `seed` | integer | 可选 | — | 随机种子。**本项目规则：绝对不显示**，不下发 |
| `generate_audio` | boolean | 可选 | **`true`** | 是否生成配套音频 |
| `return_last_frame` | boolean | 可选 | `false` | `true` 时额外返回尾帧图片 URL，用于连续视频生成 |
| `tools` | array | 可选 | — | 如 `[{"type": "web_search"}]`（联网搜索） |
| `image_urls` | string[] | 可选 | — | 图生视频参考图。普通 URL 或 `asset://asset_a`。**最多 9 张**。**与 `image_with_roles` 不能同时使用** |
| `image_with_roles` | array | 可选 | — | `{ url, role }`，`role` ∈ `first_frame` / `last_frame` / `reference_image`。**与 `image_urls` 不能同时使用** |
| `video_urls` | string[] | 可选 | — | 参考视频。**最多 3 个，1.8 s < 总时长 < 15.2 s，分辨率 480P ~ 720P**。**使用首/尾帧图片时不可用** |
| `audio_urls` | string[] | 可选 | — | 参考音频。**最多 3 个，总时长 ≤ 15 s**。**必须与参考图片或参考视频一起用**；**使用首/尾帧图片时不可用** |
| `nsfw_check` | boolean | 可选 | `false` | 命中时同步返回 HTTP 400（`nsfw_content_detected`），不建任务不扣费；审核不可用时 **fail-open**；`video_urls` / `audio_urls` **不送审** |

### 互斥与依赖关系（务必在 UI 层做约束）

- `image_urls` ⊗ `image_with_roles`（二选一）
- 使用 `image_with_roles` 的首/尾帧时，`video_urls` 与 `audio_urls` **都不可用**
- `audio_urls` 必须与参考图片或参考视频一起使用

## 4. 私域虚拟人像素材（Asset URL）

独立端点 `POST https://api.apimart.ai/v1/seedance2/private-avatar`，**支持全部 Seedance 2.0 模型**（含本模型）。字段与流程见 [Seedance-2.0_APIMart.md](../Seedance-2.0/Seedance-2.0_APIMart.md#4-私域虚拟人像素材asset-url)：素材组 `group` / `group_id`、`project_name`、`asset_type`（Image/Video/Audio）、`assets`（单次最多 20 个）；审核结果用 `GET /v1/tasks/{id}` 查询，通过的素材出现在 `result.usable_assets`，其 `asset_url` 可直接以 `asset://` 形式传入生成接口。

## 5. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) → 视频标签页（2026-08-22，1 Credit ≈ $0.1）。

`SEEDANCE-2.0-MINI`（4 个档位）

| 规格 | 我们的价格 |
|---|---|
| 480P | 0.1056 Credits/秒 ≈ **$0.01056/秒** |
| 480P-input | 0.064 Credits/秒 ≈ **$0.0064/秒** |
| 720P | 0.2288 Credits/秒 ≈ **$0.02288/秒** |
| 720P-input | 0.1384 Credits/秒 ≈ **$0.01384/秒** |

`-input` 档位对应「有参考视频输入」的计费方式（单价更低，但按输入 + 输出总时长计费）。

定价中心未列出 Mini 版的数字人（FACE）独立价格档位。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 本接口**有 `seed`**（不下发）。
- **参数互斥关系是这个模型最容易踩的坑**，UI 必须做互斥禁用。
- `generate_audio` **默认 `true`**。
- **`1080p` / `4k` 在本模型上不可用**，只有标准版 `seedance-2.0` 支持。
- 有参考视频时计费按「输入 + 输出总时长」。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| seedance-2.0 视频生成（三个版本共用文档） | https://docs.apimart.ai/cn/api-reference/videos/seedance-2-0/generation | 否 |
| 虚拟人像素材（私域 Asset） | https://docs.apimart.ai/cn/api-reference/videos/seedance-2-0/private-avatar | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（视频标签页） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
