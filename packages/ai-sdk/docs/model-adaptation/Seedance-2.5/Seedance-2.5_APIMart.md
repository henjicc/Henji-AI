# Seedance 2.5 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `seedance-2.5` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

**相对 2.0 的主要变化**：时长上限 15 s → **30 s**；参考素材 9 图 + 3 视频 + 3 音频 → **30 图 + 10 视频 + 10 音频**；支持**纯音频参考**；新增 **mov** 输出。**分辨率只支持 480p / 720p / 1080p——2.0 的 4k 在 2.5 不可用。**

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/videos/generations` → `{ code: 200, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`

## 2. 能力清单

文生视频、多模态参考生视频、**视频编辑**、**视频延长**、首帧 / 首尾帧、纯音频参考、联网搜索、连续生成（返回尾帧）、私域素材库。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | 固定 `seedance-2.5` |
| `prompt` | string | 必填 | — | 可用 **`@图片1` / `@视频1` / `@音频1`** 指代参考素材（下标从 1 起，对应数组顺序）。示例：`"全程使用@视频1的第一视角构图，@音频1作为背景音乐，首帧为@图片1"` |
| `resolution` | string | 可选 | `720p` | **仅** `480p` / `720p` / `1080p`。传 `2k` / `4k` 同步返回 **400** |
| `size` | string | 可选 | **`adaptive`** | 也接受字段名 `aspect_ratio`。`16:9`、`4:3`、`1:1`、`3:4`、`9:16`、`21:9`、`adaptive` |
| `duration` | integer | 可选 | `5` | `4` ~ `30`，或 **`-1`**（模型自动选择时长；提交时按 30 秒上限预扣，完成后多退少补）。未传按 5 秒生成与计费 |
| `generate_audio` | boolean | 可选 | **`true`** | 也接受字段名 `audio` |
| `watermark` | boolean | 可选 | `false` | 「AI 生成」水印 |
| `seed` | integer | 可选 | — | 随机种子。**本项目规则：绝对不显示**，不下发 |
| `output_format` | string | 可选 | `mp4` | `mp4` / **`mov`**（更高色彩精度，推荐用于编辑 / 延长场景） |
| `omni_reference_task_type` | string | 可选 | `auto` | `auto` / `reference` / `edit` / `extend`，见第 4 节 |
| `image_urls` | string[] | 可选 | — | 参考图，一律作为 `reference_image`。**最多 30 张**。普通 URL 或 `asset://cm9xxxxxxxx`。首帧 / 尾帧请用 `image_with_roles` |
| `image_with_roles` | array | 可选 | — | `{ url, role }`，`role` ∈ `first_frame`（1 张）/ `last_frame`（1 张，通常与首帧配合）/ `reference_image`（合计最多 30 张）。**若同时存在 `video_urls` / `audio_urls`，`first_frame` / `last_frame` 会自动转为 `reference_image`** |
| `video_urls` | string[] | 可选 | — | 参考视频，见「参考视频规格」 |
| `audio_urls` | string[] | 可选 | — | 参考音频。**最多 10 段；总时长 ≤ 30 s（单段 2~30 s）**。**2.5 支持纯音频参考**（可不配图/视频） |
| `return_last_frame` | boolean | 可选 | `false` | 成功后额外返回尾帧图片 |
| `tools` | array | 可选 | — | 如 `[{"type": "web_search"}]` |
| `nsfw_check` | boolean | 可选 | `false` | 命中同步 400（`nsfw_content_detected`），不建任务不扣费；审核不可用时 **fail-open**；`video_urls` / `audio_urls` 不送审 |

### 素材要求

| 素材 | 限制 |
|---|---|
| 图片 | ≤ 30 张；jpeg / png / webp / bmp / tiff / gif / heic / heif；宽高比 [0.4, 2.5]；边长 [300, 6000] px；单张 < 30 MB |
| 音频 | ≤ 10 段；wav / mp3；单段 [2, 30] s 且**总时长 ≤ 30 s**；单个 ≤ 15 MB |

### 参考视频规格

- 传入方式：视频 URL 或 `asset://...`
- 格式：`mp4`、`mov`
- 分辨率：`480p`、`720p`、`1080p`
- 时长：单个 [2, 30] s；**最多 10 个**；**总时长 ≤ 30 s**
- 尺寸：宽高比 [0.4, 2.5]；边长 [300, 6000] px；总像素 **[409600 (640×640), 8295044 (3326×2494)]**
- 大小：单个 ≤ **200 MB**
- 帧率：[24, 60]

| 封装格式 | 视频编码 | 音频编码 |
|---|---|---|
| `mp4` | H.264 / H.265 | AAC / MP3 |
| `mov` | H.264 / H.265 | AAC / MP3 |

## 4. 任务类型与硬性限制（**最容易踩坑的地方**）

系统会按参考素材与**提示词意图**判定任务类型。后三种对 `size` / `duration` 有硬性限制，**违反会在任务开始后异步失败**（如 `InvalidParameter.TaskTypeConstraint`）：

| 任务类型 | 触发条件 | 限制 |
|---|---|---|
| 文生视频 | 仅文本 | 无 |
| 参考生视频 | 参考素材 + 普通描述提示词 | 无。**避免**在提示词中出现「编辑 / 延长 / 续写 / 删除 / 替换」等词，防止误判 |
| 视频编辑 | 参考素材 + 提示词含「编辑视频 / 增加 / 删除 / 修改 / 替换」等 | `size` 仅 `adaptive`；`duration` 仅 `-1`；待编辑视频须 4~30 s |
| 视频延长 | 参考素材 + 提示词含「向前 / 向后延长 / 延续 / 续写」 | `size` 仅 `adaptive` |
| 首帧 / 首尾帧 | `image_with_roles` 使用 `first_frame` / `last_frame` | `size` 仅 `adaptive`（提交阶段也会同步校验） |

### 用 `omni_reference_task_type` 把异步报错变成同步报错

| 取值 | 含义 | 提交时校验的限制 |
|---|---|---|
| `auto`（默认） | 模型自行判定 | 无（不合格改为**异步**失败） |
| `reference` | 参考生视频 | 无（`size` / `duration` 不受限） |
| `edit` | 视频编辑 | `video_urls` 至少 1 个；`size` 只能 `adaptive`（或不传）；`duration` 只能 `-1`（或不传）；源视频须 4~30 s |
| `extend` | 视频延长 | `video_urls` 至少 1 个；`size` 只能 `adaptive`（或不传） |

必须知道的点：

- **`edit` 不传 `duration` 时平台自动按 `-1` 处理**。平台对「未传 duration」默认下发 5 秒，而 `edit` 上游强制 `-1`，两者相撞会直接失败，所以平台帮你归一成 `-1`。代价是**预扣按 30 秒上限收押金**，完成后按实际用量退差。想要更小的预扣就别用 `edit`，改用默认 `auto`。
- **`edit` 显式传 `duration` 只能是 `-1`**，传别的值直接 400。
- ⚠️ **指定了也仍可能异步报错 `InvalidParameter.TaskTypeMismatch`**：上游会再结合提示词判一次任务类型，不一致就拒。所以提示词仍要按对应类型的写法来写。
- Seedance 2.5 的**全部渠道行为一致**，不会出现「换个渠道结果不一样」。

## 5. 素材库（`asset://`）

**推荐入库**的场景：
1. **真人人脸素材必须走素材库**——直接传 URL 会被内容审核拦截
2. 素材会复用多次——入库一次，之后免重复审核
3. URL 是带签名的临时链接——入库时平台会固化素材
4. 入库素材**自动同步到全部可用渠道**

素材库与 2.0 家族**共用**，`asset://` 对两代通用。

**上传**：`POST /v1/seedance2/private-avatar/assets`

| 字段 | 必填 | 说明 |
|---|---|---|
| `model` | ❌ | 素材要配合使用的模型（默认 2.0）。**决定时长限制档位；2.5 请传 `seedance-2.5`**（2.0 无法使用超过 15 s 的素材） |
| `group` | ❌ | 素材组；不传自动创建 |
| `asset_type` | ✅ | `Image` / `Video` / `Audio` |
| `assets[].url` | ✅ | 素材公网 URL |
| `assets[].name` | ❌ | 素材名 |

**素材限制（提交时同步校验，违规立即 400 并标明第几个素材违反哪条）**：

| 素材 | 限制 |
|---|---|
| 图片 | jpeg / png / webp / bmp / tiff / gif / heic / heif；边长 [300, 6000] px；宽高比 [0.4, 2.5]；单张 < 30 MB |
| 视频 | mp4 / mov；单个 ≤ 200 MB；时长**按 model 分档**：2.0 家族 [2, 15] s，**2.5 [2, 30] s** |
| 音频 | wav / mp3；单个 ≤ 15 MB；时长分档同视频 |

**管理接口**（**全部免计费**，仅 Token 鉴权与限流，不产生消费记录）：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/v1/seedance2/private-avatar/assets` | 素材列表 |
| `GET` | `/v1/seedance2/private-avatar/assets/{asset_id}` | 单个素材详情（含审核状态） |
| `PATCH` | `/v1/seedance2/private-avatar/assets/{asset_id}` | 更新素材信息 |
| `DELETE` | `/v1/seedance2/private-avatar/assets/{asset_id}` | 删除素材 |
| `POST` / `GET` / `PATCH` / `DELETE` | `/v1/seedance2/private-avatar/groups[/{id}]` | 素材组管理 |

审核耗时：图片通常数秒；视频与真人素材可能数分钟。部分失败不返回具体原因（常见为素材抓取瞬时失败），平台已自动重试一次，仍失败请更换素材 URL。

## 6. 完成态响应字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `data.id` | string | 任务 ID |
| `data.status` | string | 完成态恒为 `completed` |
| `data.progress` | int | 完成态恒为 `100` |
| `data.created` / `data.completed` | int | 提交 / 完成时间（Unix 秒） |
| `data.actual_time` | int | 实际耗时（秒） |
| `data.estimated_time` | int | 平台预估耗时（秒，参考值） |
| `data.cost` | float | **本单实扣金额（美元）**，已含折扣 |
| `data.credits_cost` | float | 实扣积分 = `cost × 10` |
| `data.usage.completion_tokens` | int | 本单消耗 token 数。核账：`cost = completion_tokens ÷ 10⁶ × token 单价 × 折扣` |
| `data.result.videos[].url` | **string[]** | 视频地址。**注意是数组，取 `url[0]`**。返回**平台转存后的长期地址** |
| `data.result.videos[].expires_at` | int | 链接过期时间戳（转存地址长期有效，此字段为兼容保留） |
| `data.result.videos[].last_frame_url` | string | 尾帧图片（**仅 `return_last_frame=true` 时有**） |

失败任务（`status=failed`）：`cost` 恒为 `0`（预扣已全额退款），错误原因在 `data.error.message`。`usage` 在完成后的最初几秒可能尚未出现（结算落库有秒级延迟），再查一次即可。

## 7. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) → 视频标签页 `SEEDANCE-2.5`（2026-08-30 复核，仍标注为**预估价格**，1 Credit ≈ $0.1）。当前定价中心与模型页的秒价口径一致；唯一保留边界是供应商仍把 2.5 标为预估价，后续可能调整。

**按秒**

| 规格 | 我们的价格 |
|---|---|
| 480P | 0.9608 Credits/秒 ≈ **$0.09608/秒** |
| 480P-input（有参考视频：(参考视频时长 + 生成视频时长) × 当前价格） | 0.576 Credits/秒 ≈ **$0.0576/秒** |
| 720P | 2.16 Credits/秒 ≈ **$0.216/秒** |
| 720P-input | 1.296 Credits/秒 ≈ **$0.1296/秒** |
| 1080P | 3.8488 Credits/秒 ≈ **$0.38488/秒** |
| 1080P-input | 2.2992 Credits/秒 ≈ **$0.22992/秒** |

**按 token**

| 计费项 | 我们的价格 |
|---|---|
| `token`（480p / 720p，无参考视频） | 100 Credits/1M ≈ **$10 / 1M tokens** |
| `token-input`（480p / 720p，有参考视频） | 60 Credits/1M ≈ **$6 / 1M tokens** |
| `token-1080P`（1080p，无参考视频） | 79.2 Credits/1M ≈ **$7.92 / 1M tokens** |
| `token-1080P-input`（1080p，有参考视频） | 47.3144 Credits/1M ≈ **$4.73144 / 1M tokens** |

计费规则（文档）：按 **秒 × 分辨率档** 计费；**有参考视频输入时计费秒数 = 输入视频总时长（≤30 s）+ 输出时长**，走带输入参考的优惠档单价；`duration = -1` 提交时按 30 秒上限预扣，完成后按实际产出多退少补；未传 `duration` 按 5 秒；**任务失败或内容审核拦截全额退款**。

## 8. 常见错误

| 现象 | 原因 |
|---|---|
| 400 `resolution` 不支持 | 传了 `2k` / `4k` |
| 400 `This model only supports duration 4-30 seconds, or -1` | `duration` 不在允许范围 |
| 400 `first_frame/last_frame tasks only support ratio=adaptive` | 首尾帧任务指定了具体宽高比 |
| 任务异步失败（编辑 / 延长类提示） | 提示词被判定为编辑 / 延长，但 `size` / `duration` 不满足对应限制 |
| 任务异步失败 `SensitiveContentDetected` | 素材或产物触发内容审核 |

## 9. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 本接口**有 `seed`**（不下发）。
- `output_format` 默认不显示、不请求（但编辑 / 延长场景推荐 `mov`，若产品做这两类能力需要例外考虑）。
- **提示词内容会改变任务类型判定**，进而触发 `size` / `duration` 的硬限制——这是与其他视频模型完全不同的行为，UI 必须在选择「编辑 / 延长」类玩法时同步锁定 `size=adaptive`、`duration=-1`。
- `data.result.videos[].url` 是**数组**，取 `url[0]`。
- 参考素材上限比 2.0 大一个量级（30 图 / 10 视频 / 10 音频），上传组件的上限要按模型区分。
- `duration=-1` 会按 30 秒预扣押金，余额预检要按上限算。
- 真人素材必须走素材库，直接传 URL 会被审核拦截。
- SDK 从 `uploadedVideoFilePaths` / `videos` / `uploadedVideos` 取非空且数量最完整的一组；空数组不遮蔽其他字段。宿主按顺序提供完整 `__videoDurationSeconds: number[]` 时求真实总和，数组不完整时改用 `__totalVideoDurationSeconds`，最后才兼容 `__firstVideoDurationSeconds × 视频数` 的旧近似估算。2.5 的参考视频真实总时长上限为 30 秒。

## 10. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| seedance-2.5 视频生成 | https://docs.apimart.ai/cn/api-reference/videos/seedance-2-5/generation | 否 |
| 虚拟人像素材 / 素材库（与 2.0 共用） | https://docs.apimart.ai/cn/api-reference/videos/seedance-2-0/private-avatar | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（视频标签页搜 SEEDANCE-2.5） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
