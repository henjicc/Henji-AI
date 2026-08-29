# Seedance 2.0 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `seedance-2.0`（旧名 `seedance-2-0`） |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> 同一份 APIMart 文档同时覆盖 `seedance-2.0` / `seedance-2.0-fast` / `seedance-2.0-mini`，参数结构一致，差异集中在**分辨率上限**与**提示词长度**。本文件只讲标准版。

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/videos/generations` → `{ code: 200, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`，状态 `pending` / `processing` / `completed` / `failed`，结果在 `result.videos[]`

## 2. 能力清单

文生视频、图生视频（首帧）、**首尾帧视频**、**参考视频生视频**、**参考音频**、**有声视频**、**连续视频生成（返回尾帧）**、**联网搜索增强**、**私域虚拟人像素材（Asset URL）**。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | `seedance-2.0` |
| `prompt` | string | 条件 | — | **文生视频必填**；图生视频 / 视频参考生视频可选。限制 4000 字符，**建议 500 字符以内** |
| `duration` | integer | 可选 | `5` | **4 ~ 15 秒** |
| `size` | string | 可选 | `16:9` | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9`、**`adaptive`**（根据输入图/视频自动匹配）。宽高比须在 0.5–2.5 之间 |
| `resolution` | string | 可选 | `720p` | `480p` / `720p` / **`1080p`（仅标准版）** / **`4k`（仅标准版）** |
| `seed` | integer | 可选 | — | 随机种子。**本项目规则：绝对不显示**，不下发 |
| `generate_audio` | boolean | 可选 | **`true`** | 是否生成配套音频（有声视频） |
| `return_last_frame` | boolean | 可选 | `false` | `true` 时结果额外返回视频最后一帧的图片 URL，用于连续视频生成 |
| `tools` | array | 可选 | — | 工具列表，如 `[{"type": "web_search"}]`（联网搜索） |
| `image_urls` | string[] | 可选 | — | 图生视频参考图。普通 URL 或 `asset://asset_a`。**最多 9 张**。**与 `image_with_roles` 不能同时使用** |
| `image_with_roles` | array | 可选 | — | 带角色的图片数组，元素为 `{ url, role }`。`role` ∈ `first_frame`（首帧）/ `last_frame`（尾帧）/ `reference_image`（参考人像图，配合 Asset URL）。**与 `image_urls` 不能同时使用** |
| `video_urls` | string[] | 可选 | — | 参考视频。**最多 3 个，1.8 s < 总时长 < 15.2 s，分辨率需在 480P ~ 720P 之间**。**使用首/尾帧图片时不可用** |
| `audio_urls` | string[] | 可选 | — | 参考音频。**最多 3 个，总时长 ≤ 15 s**。**必须与参考图片或参考视频一起用**；**使用首/尾帧图片时不可用** |
| `nsfw_check` | boolean | 可选 | `false` | 见下 |

### 互斥与依赖关系（务必在 UI 层做约束）

- `image_urls` ⊗ `image_with_roles`（二选一）
- 使用 `image_with_roles` 的首/尾帧时，`video_urls` 与 `audio_urls` **都不可用**
- `audio_urls` 必须与参考图片或参考视频一起使用

### `nsfw_check` 细节

- 审核范围：文本 `prompt`、`negative_prompt`；图片 `image_urls`、`image_with_roles[].url`、`first_frame_image`、`last_frame_image`；`asset://` 图片素材会反查原始公网 URL 后审核；base64 图片转公网地址后审核
- **`video_urls`、`audio_urls` 以及视频/音频类型的私域素材不会送审**（审核模型不支持视频和音频）
- 命中审核时**同步返回 HTTP 400（`nsfw_content_detected`）**，不创建任务、不返回 `task_id`、不扣额度
- 审核服务不可用/超时/响应异常时采用 **fail-open**（继续提交生成请求），因此**不能作为绝对的内容安全保证**
- 审核调用本身不向发起视频请求的用户计费

## 4. 私域虚拟人像素材（Asset URL）

**独立端点**：`POST https://api.apimart.ai/v1/seedance2/private-avatar`

| 字段 | 类型 | 说明 |
|---|---|---|
| `group` | object | 素材组信息 `{ name, description }`。不传 `group_id` 时服务端按此自动创建 `AIGC` 类型素材组。**与 `group_id` 二选一** |
| `group_id` | string | 已有素材组 ID，传入时跳过素材组创建。**与 `group` 二选一** |
| `project_name` | string | 项目名称，默认 `default` |
| `asset_type` | string | `Image`（默认）/ `Video` / `Audio` |
| `assets` | array | 素材列表，元素为 `{ url, name }`（`url` 需公网可访问）。**单次最多 20 个** |
| `url` / `name` | string | 单素材兼容写法，与 `assets` 数组二选一 |

响应：`data.id`（本地任务 ID）、`data.object = "seedance.avatar.asset.task"`、`data.status = "processing"`、`data.progress`、`data.model`。

审核结果同样用 `GET /v1/tasks/{id}` 查询：
- 批量提交时**只要有一个素材审核失败，任务状态就是 `failed`**，但已通过的素材仍可用，出现在 `result.usable_assets`
- `result.usable_assets[].asset_url` 可直接用于视频生成
- `result.failed_assets` 中的素材需更换源文件或重新提交
- 单素材任务也会兼容返回 `result.asset_url`

审核通过后把 `asset://...` 传入视频生成接口即可；服务端识别到 `asset://` 前缀后**直接提交官方生成任务，不会再次触发素材审核**。

Asset URL 支持全部 Seedance 2.0 模型（`seedance-2.0` / `-fast` / `-mini`）。

## 5. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) → 视频标签页 `SEEDANCE-2.0`（2026-08-30 复核，1 Credit ≈ $0.1）。当前定价中心与模型页的秒价口径一致，未发现新的价格冲突。

| 规格 | 我们的价格 |
|---|---|
| 480P | 0.66 Credits/秒 ≈ **$0.066/秒** |
| 480P-input | 0.4 Credits/秒 ≈ **$0.04/秒** |
| 720P | 1.42 Credits/秒 ≈ **$0.142/秒** |
| 720P-input | 0.8584 Credits/秒 ≈ **$0.08584/秒** |
| 1080P | 3.544 Credits/秒 ≈ **$0.3544/秒** |
| 1080P-input | 2.1568 Credits/秒 ≈ **$0.21568/秒** |
| 4K | 7.22 Credits/秒 ≈ **$0.722/秒** |
| 4K-input | 4.4432 Credits/秒 ≈ **$0.44432/秒** |

`-input` 档位对应「有参考视频输入」的计费方式（单价更低，但按输入 + 输出总时长计费）。

**数字人（私域人像）另有独立价格** `SEEDANCE-2.0-FACE`：480P 0.992 Credits/秒 ≈ $0.0992/秒、480P-input 0.6 ≈ $0.06/秒、720P 2.136 ≈ $0.2136/秒、720P-input 1.288 ≈ $0.1288/秒、1080P 5 ≈ $0.5/秒、1080P-input 3 ≈ $0.3/秒。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 本接口**有 `seed`**（不下发）；`negative_prompt` 未在参数表列出，但 `nsfw_check` 的审核范围提到了它，接入时按「不注册、不下发」处理。
- **参数互斥关系是这个模型最容易踩的坑**：`image_urls` / `image_with_roles` 二选一；首尾帧模式下参考视频与参考音频全部失效。UI 必须做互斥禁用，不能只靠后端报错。
- `generate_audio` **默认 `true`**（会出有声视频），与多数模型默认关闭相反。
- `1080p` / `4k` **仅标准版支持**，Fast / Mini 传了会失败。
- 有参考视频时计费按「输入 + 输出总时长」，成本估算不能只按输出时长算。
- SDK 从 `uploadedVideoFilePaths` / `videos` / `uploadedVideos` 取非空且数量最完整的一组；空数组不遮蔽其他字段。宿主按顺序提供完整 `__videoDurationSeconds: number[]` 时求真实总和，数组不完整时改用 `__totalVideoDurationSeconds`，最后才兼容 `__firstVideoDurationSeconds × 视频数` 的旧近似估算。
- Asset URL 是一整套独立的素材上传 + 审核流程，若要做数字人必须先接 `private-avatar` 端点。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| seedance-2.0 视频生成 | https://docs.apimart.ai/cn/api-reference/videos/seedance-2-0/generation | 否 |
| 虚拟人像素材（私域 Asset） | https://docs.apimart.ai/cn/api-reference/videos/seedance-2-0/private-avatar | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（视频标签页搜 SEEDANCE-2.0 / SEEDANCE-2.0-FACE） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
