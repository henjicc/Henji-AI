# Gemini Omni Flash · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频（配套语音与角色能力） |
| 供应商 | KIE.ai（聚合平台） |
| 平台模型 ID / 端点 | `gemini-omni-video`（任务）、`POST /api/v1/omni/audio/create`、`POST /api/v1/omni/character/create` |
| 接口形态 | 视频走**异步任务**；语音与角色是**独立的同步创建端点** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> ⚠️ KIE 的 Gemini Omni 是**三个端点组成的一套体系**：先用 `omni/audio/create` 造语音、用 `omni/character/create` 造角色，再把拿到的 `audio_ids` / `character_ids` 喂给 `gemini-omni-video`。上一版适配只做了视频生成，**语音与角色两块完全遗漏**。

## 1. 接入协议

- **Base URL**：`https://api.kie.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **视频提交**：`POST /api/v1/jobs/createTask`，体为 `{ model: "gemini-omni-video", callBackUrl?, input }`
- **视频查询**：`GET /api/v1/jobs/recordInfo?taskId=...`，`JSON.parse(resultJson)` → `{ resultUrls: [...] }`
- **语音创建**：`POST /api/v1/omni/audio/create`
- **角色创建**：`POST /api/v1/omni/character/create`

## 2. 端点 A：`gemini-omni-video`（多模态视频生成）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `input.prompt` | string | **必填** | — | 视频提示词，最多 **20000** 字符。描述画面内容、风格、镜头语言或角色行为 |
| `input.image_urls` | array | 可选 | — | 参考图片。单个文件 ≤ **20 MB**；须公开可访问；**最多 7 张** |
| `input.audio_ids` | array | 可选 | — | 由 **`gemini-omni-audio`** 接口生成的音频 ID 数组，用于旁白 / 对白 / 配乐 / 声音参考。**最多 3 个** |
| `input.video_list` | array | 可选 | — | 视频片段数组。**最多 1 个，且占用 2 张图片额度**。每项 `{ url, start, ends }`：单个文件 ≤ **100 MB**、视频时长 ≤ **30 s**、`ends > start` 且 **`ends - start` ≤ 10 s** |
| `input.character_ids` | array | 可选 | — | 由 **`gemini-omni-character`** 接口生成的角色 ID 数组。**每个 `character_id` 占用 1 个 image slot；基础最多 7 个；若同时传 `video_list`（占 2 个 slot），`character_ids` 最多 3 个** |
| `input.duration` | string | **必填** | — | **`"4"` / `"6"` / `"8"` / `"10"`（字符串）**。**仅在无视频输入时生效**；有视频输入时输出时长由模型决定，本参数被忽略 |
| `input.aspect_ratio` | string | 可选 | — | `16:9`（横屏）/ `9:16`（竖屏） |
| `input.seed` | integer | 可选 | 自动 | `[0, 2147483647]`。**本项目规则：绝对不显示**，不下发 |
| `input.resolution` | string | 可选 | `720p` | `720p` / `1080p` / `4k` |

### image slot 计算（关键约束）

图片额度总共 **7 个 slot**，被以下三者共同占用：
- 每张 `image_urls` 图片：1 slot
- 每个 `character_ids`：1 slot
- `video_list`（最多 1 个）：**2 slot**

因此有视频输入时，`character_ids` 最多 3 个。UI 计数必须按这个规则统一算。

## 3. 端点 B：`POST /api/v1/omni/audio/create`（生语音）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `audio_id` | string | **必填** | 预设语音角色枚举（30 个，见下） |
| `name` | string | **必填** | 语音名称，最长 **210** 字符 |
| `voice_description` | string | 可选 | 语音特征描述（音色、风格、语速、情绪），最长 **20000** 字符 |
| `example_dialogue` | string | 可选 | 对话示例（如「你好,我是Adam」），最长 **120** 字符 |

### `audio_id` 预设音色全表

| ID | 描述 | ID | 描述 |
|---|---|---|---|
| `achernar` | 女声，柔和，高音调 | `laomedeia` | 女声，欢快，中高音调 |
| `achird` | 男声，友好，中音调 | `leda` | 女声，年轻，中高音调 |
| `algenib` | 男声，沙哑，低音调 | `orus` | 男声，沉稳，中低音调 |
| `algieba` | 男声，随和，中低音调 | `puck` | 男声，欢快，中音调 |
| `alnilam` | 男声，沉稳，中低音调 | `pulcherrima` | 无性别，前置感，中高音调 |
| `aoede` | 女声，轻快，中音调 | `rasalgethi` | 男声，知性，中音调 |
| `autonoe` | 女声，明亮，中音调 | `sadachbia` | 男声，生动，低音调 |
| `callirrhoe` | 女声，随和，中音调 | `sadaltager` | 男声，博学，中音调 |
| `charon` | 男声，知性，低音调 | `schedar` | 男声，平稳，中低音调 |
| `despina` | 女声，流畅，中音调 | `sulafat` | 女声，温暖，中音调 |
| `enceladus` | 男声，气声，低音调 | `umbriel` | 男声，流畅，低音调 |
| `erinome` | 女声，清晰，中音调 | `vindemiatrix` | 女声，温柔，中音调 |
| `fenrir` | 男声，活泼，偏年轻音调 | `zephyr` | 女声，明亮，中高音调 |
| `gacrux` | 女声，成熟，中音调 | `zubenelgenubi` | 男声，随性，中低音调 |
| `iapetus` | 男声，清晰，中低音调 | `kore` | 女声，干练，中音调 |

## 4. 端点 C：`POST /api/v1/omni/character/create`（生角色）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `descriptions` | string | **必填** | 角色描述：外观、身份、风格、服饰或性格设定 |
| `image_urls` | array | **必填** | 角色参考图，**仅支持 1 张**。单张 ≤ **20 MB**，须公开可访问 |
| `audio_ids` | array | 可选 | 由 `gemini-omni-audio` 生成的音频 ID，用于补充声音特征、语气或人设参考 |
| `character_name` | string | 可选 | 角色名称 |

## 5. 价格

来源：[KIE 定价页](https://kie.ai/pricing)（2026-08-22 读取，搜索 `gemini-omni`；1 Credit = $0.005）。**按次（per video）计费，不是按秒。**

| 规格 | 积分 | 我们的价格 | 官方 / Fal 参考价 | 节省 |
|---|---|---|---|---|
| 720p 4s 无视频输入 | 63 /条 | **$0.315/条** | $0.5 | 37.0% |
| 720p 6s 无视频输入 | 84 /条 | **$0.42/条** | $0.75 | 44.0% |
| 720p 8s 无视频输入 | 105 /条 | **$0.525/条** | $1 | 47.5% |
| 720p 10s 无视频输入 | 126 /条 | **$0.63/条** | $1.25 | 49.6% |
| 1080p 4s 无视频输入 | 63 /条 | **$0.315/条** | N/A | — |
| 1080p 6s 无视频输入 | 84 /条 | **$0.42/条** | N/A | — |
| 1080p 8s 无视频输入 | 105 /条 | **$0.525/条** | N/A | — |
| 1080p 10s 无视频输入 | 126 /条 | **$0.63/条** | N/A | — |
| 4k 4s 无视频输入 | 147 /条 | **$0.735/条** | N/A | — |
| 4k 6s 无视频输入 | 168 /条 | **$0.84/条** | N/A | — |
| 4k 8s 无视频输入 | 189 /条 | **$0.945/条** | N/A | — |
| 4k 10s 无视频输入 | 210 /条 | **$1.05/条** | N/A | — |
| 720p 有视频输入 | 168 /条 | **$0.84/条** | N/A | — |
| 1080p 有视频输入 | 168 /条 | **$0.84/条** | N/A | — |
| 4k 有视频输入 | 252 /条 | **$1.26/条** | N/A | — |

定价页未列出 `omni/audio/create` 与 `omni/character/create` 的价格，接入前需确认这两个端点是否单独计费。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。KIE 的 `gemini-omni-video` **有 `seed`**，必须主动不注册、不下发。
- **这是一套三端点体系**，语音与角色是可复用资产（先创建拿 ID，再在视频里引用），需要独立的资产管理交互，不能塞进单次生成的参数面板。
- **image slot 是共享额度**（图片 1 / 角色 1 / 视频 2，总计 7），前端计数必须统一。
- `duration` 是**字符串**且只有 4/6/8/10；**有视频输入时该参数静默失效**。
- **按次计费**：720p 与 1080p 同价，4k 更贵；有视频输入时价格固定且明显更高。
- `video_list` 的截取窗口 `ends - start` 必须 ≤ 10 秒。
- `resultJson` 是 JSON 字符串，必须二次 parse。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Gemini Omni 生视频 | https://docs.kie.ai/cn/market/gemini-omni-video | 否 |
| Gemini Omni Audio 生语音 | https://docs.kie.ai/cn/market/gemini-omni-audio | 否 |
| Gemini Omni Character 生角色 | https://docs.kie.ai/cn/market/gemini-omni-character | 否 |
| 获取任务详情 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 通用 API 快速入门 | https://docs.kie.ai/cn/common-api/quickstart | 否 |
| 定价页（搜 `gemini-omni`） | https://kie.ai/pricing | 否 |
| API Key 管理 | https://kie.ai/api-key | **是** |
