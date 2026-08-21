# Kling 3.0 Omni · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID | `kling-3.0-omni/text-to-video`、`kling-3.0-omni/image-to-video`、`kling-3.0-omni/reference-to-video`、`kling-3.0-omni/transformation` |
| 接口形态 | **异步任务**（`createTask` + `recordInfo`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录（**定价页未单列 Omni 条目，见第 5 节**） |

> KIE 上 Kling 3.0 Omni 有 **4 个端点**，其中 `transformation`（视频转换 / 编辑）是上一版适配遗漏的能力。

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /api/v1/jobs/createTask`，体为 `{ model, callBackUrl?, input }`
- **查询**：`GET /api/v1/jobs/recordInfo?taskId=...`
- **结果**：`JSON.parse(resultJson)` → `{ resultUrls: ["https://....mp4"] }`

## 2. 能力清单

| 能力 | model |
|---|---|
| 文生视频 | `kling-3.0-omni/text-to-video` |
| 图生视频（单张首帧） | `kling-3.0-omni/image-to-video` |
| 参考生视频（参考图 / 参考视频 / 主体） | `kling-3.0-omni/reference-to-video` |
| **视频转换 / 编辑** | `kling-3.0-omni/transformation` |

## 3. 请求参数

### 3.1 通用字段（四个端点共有或大部分共有）

| 字段 | 类型 | 默认 | 取值与说明 |
|---|---|---|---|
| `input.prompt` | string | — | 去首尾空白后不能为空，**最长 3072 字符** |
| `input.duration` | integer | `5` | 枚举 3–15 秒 |
| `input.resolution` | string | `720p` | `720p` / `1080p` / **`4k`** |
| `input.aspect_ratio` | string | 视端点而定 | `16:9`、`9:16`、`1:1`、`auto`（各端点可选集合不同，见下） |
| `input.audio` | boolean | `false` | 是否开启音频。**建议显式传入** |
| `input.customize_multi_shots` | boolean | 文生 `true` | 是否开启**自定义**多镜头。**建议显式指定** |
| `input.prefer_multi_shots` | boolean | — | 是否开启**智能分镜**。**与 `customize_multi_shots` 互斥**：两者可以同时为 `false`，但**不能同时为 `true`** |
| `input.multi_prompt` | array | `[]` | 自定义分镜列表，**最多 6 个**。`customize_multi_shots=true` 时必填且不能为空；为 `false` 时**必须为空数组或省略** |
| `input.elements` | array | `[]` | 一次性主体素材列表，见下 |

`multi_prompt` 元素：`prompt`（1–512 字符，必填）、`duration`（**1–15 秒**，必填）。

### 3.2 `elements`（主体素材）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 必填 | 主体名称，**同一请求内唯一**，prompt 中用 `@名称` 引用 |
| `description` | string | 必填 | 主体素材的文本描述 |
| `element_input_urls` | array | 必填 | **多图主体传 2–4 张图片；视频角色主体恰好传 1 个视频；图片和视频不能混传**。支持 HTTP / HTTPS / OSS |
| `element_input_audio_urls` | array | 可选 | 主体音频素材。可读到时长时**必须为 5–30 秒** |
| `start_time` | integer | 可选（默认 `0`） | 视频角色主体截取开始时间（毫秒），仅传视频时生效 |
| `end_time` | integer | 可选（默认 `8000`） | 截取结束时间（毫秒），须大于 `start_time`，**截取时长必须为 3000–8000 ms** |

**主体数量限制（文生 / 参考端点）**：仅多图主体时最多 **7 个**主体；仅视频角色主体时不超过 **3 个**；两者同时存在时视频角色主体 ≤ 3、多图主体 ≤ 4。
**图生视频端点**的 `elements` 上限是 **3 个**。

### 3.3 `kling-3.0-omni/text-to-video`

`aspect_ratio` 可选 `16:9`（默认）、`9:16`、`1:1`。`customize_multi_shots` **默认 `true`**。

### 3.4 `kling-3.0-omni/image-to-video`（`input` 为 `oneOf`，此处为「单张首帧」形态）

| 字段 | 必填 | 说明 |
|---|---|---|
| `prompt` | **必填** | ≤ 3072 字符 |
| `image_urls` | **必填** | 首帧图片，**必须且只能传 1 张**。HTTP / HTTPS / OSS；JPG / JPEG / PNG；**≤ 50 MB**；宽高均 ≥ 300 px；宽高比 0.4–2.5 |
| `aspect_ratio` | 可选，默认 **`auto`** | `16:9` / `9:16` / `1:1` / `auto`。**只有开启 `customize_multi_shots` 时才可以选 16:9 / 9:16 / 1:1，其余情况为 `auto`** |

### 3.5 `kling-3.0-omni/reference-to-video`（`input` 为 `oneOf`）

**形态 A「无视频输入」**（必填 `prompt` + `image_urls`）

| 字段 | 说明 |
|---|---|
| `image_urls` | 参考图片数组，**最多 7 张**。图片数量上限与主体数量/类型相关：无参考视频 + 仅多图主体时，**参考图片与多图主体数量之和 ≤ 7**；无参考视频 + 同时有视频角色主体和多图主体时，**参考图片与多图主体数量之和 ≤ 4**。JPG / JPEG / PNG；≤ 50 MB；宽高 ≥ 300 px；宽高比 0.4–2.5 |
| `aspect_ratio` | `16:9`（默认）/ `9:16` / `1:1` |
| `audio` | 无视频输入时支持 `true` / `false` |

**形态 B「仅视频输入」**（必填 `prompt`、`video_urls`、`aspect_ratio`、`audio`）

| 字段 | 说明 |
|---|---|
| `video_urls` | **必须且只能传 1 个视频**。MP4 / MOV；**≤ 200 MB**；时长 **3–15.5 秒**；宽高 **700–4553 px**；总像素 **≤ 8,294,400**；宽高比 **0.4–2**；帧率 **24–60 fps** |

### 3.6 `kling-3.0-omni/transformation`（视频转换 / 编辑）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `prompt` | string | 可选 | — | ≤ 3072 字符 |
| `video_urls` | array | 可选 | — | **必须且只能 1 个视频**。规格同上（MP4/MOV、≤200 MB、3–15.5 s、700–4553 px、总像素 ≤ 8,294,400、宽高比 0.4–2、24–60 fps） |
| `image_urls` | array | 可选 | — | **最多 4 张**。上限与主体数量/类型有关：仅有多图主体时**参考图片与多图主体数量之和 ≤ 4**；**不同时支持视频角色主体与多图主体或参考图片**。JPG / JPEG / PNG；≤ 50 MB；宽高 ≥ 300 px；宽高比 0.4–2.5 |
| `duration` | string | 可选 | — | **视频加图片时可保留该字段配置**（纯视频输入时时长跟随源视频） |
| `resolution` | string | 可选 | `720p` | `720p` / `1080p` / `4k` |
| `aspect_ratio` | string | 可选 | `16:9` | **仅视频输入时只能为 `auto`；视频加图片时支持 `16:9` / `9:16` / `1:1`，不支持 `auto`** |
| `audio` | boolean | 可选 | — | 是否开启音频 |
| `elements` | array | 可选 | `[]` | 同上 |

## 4. 响应结构

`state=success` 后 `JSON.parse(resultJson)` → `{ "resultUrls": ["https://....mp4"] }`。

## 5. 价格

⚠️ **KIE 定价页（2026-08-22 读取，搜索 `kling` / `omni`）未单独列出 `kling-3.0-omni` 的价格条目**，只有 `Kling 3.0`、`kling 3.0 turbo`、`kling 3.0 motion control` 三组。

接入前需要向 KIE 确认 Omni 的计费口径，或先跑一次任务从 `creditsConsumed` 反推。可作为参考的同代价格（`Kling 3.0`，1 Credit = $0.005）：

| 规格 | 积分 | 我们的价格 |
|---|---|---|
| 720P 无声 / 有声 | 14 / 20 每秒 | $0.07 / $0.1 每秒 |
| 1080P 无声 / 有声 | 18 / 27 每秒 | $0.09 / $0.135 每秒 |
| 4K 无声 / 有声 | 67 / 67 每秒 | $0.335 / $0.335 每秒 |

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 本组接口都没有这两个字段。
- **4 个端点的 `aspect_ratio` 规则各不相同**，尤其 `image-to-video`「只有开启自定义多镜头才能选具体比例」和 `transformation`「纯视频输入只能 `auto`、视频+图片不支持 `auto`」——UI 必须按端点与输入组合联动。
- `customize_multi_shots` 与 `prefer_multi_shots` **不能同时为 `true`**。
- `customize_multi_shots=false` 时 `multi_prompt` **必须是空数组或不传**，传了会报错。
- `elements` 的主体数量上限是**动态的**（取决于是否有参考视频、主体类型），需要在前端做组合校验。
- 视频角色主体的截取窗口必须是 3000–8000 ms。
- **Omni 在 KIE 定价页没有独立条目**，成本核算需先实测。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Kling 3.0 Omni 文生视频 | https://docs.kie.ai/cn/market/kling/v3-omni-text-to-video | 否 |
| Kling 3.0 Omni 图生视频 | https://docs.kie.ai/cn/market/kling/v3-omni-image-to-video | 否 |
| Kling 3.0 Omni Reference-To-Video | https://docs.kie.ai/cn/market/kling/v3-omni-reference-to-video | 否 |
| Kling 3.0 Omni Transformation | https://docs.kie.ai/cn/market/kling/v3-omni-transformation | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `kling`；**Omni 无独立条目**） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
