# Midjourney · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片（另含图生视频） |
| 供应商 | APIMart（聚合平台）——本清单中 **Midjourney 唯一可用供应商** |
| 平台模型 ID | `midjourney`（新路由 `/v1/midjourney/...` 会自动注入 `model=midjourney`，请求体无需再传 `model`） |
| 接口形态 | **异步任务**：提交返回 `task_id`，轮询查询 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录（**75 个价格档位**） |

> ⚠️ **本模型能力面极大**：18 个端点、17 种 action、完整的「四宫格 → 选图 → 二次操作」工作流。
> 当前代码已覆盖可独立发起的图片 / 视频生成入口；依赖父任务结果卡片的连续操作，以及返回文本的 Describe，按第 20 节的架构边界处理。下方第 3 节仍保留平台完整能力清单，后续扩展时逐条对照。

> **Henji 产品呈现**：平台的 Imagine、Edit、Blend 仍按各自端点和请求契约执行，但图片功能在产品中合并为一个“Midjourney”模型，通过顶层“模式”切换；通用比例、速度、质量、数量保持标准顶层控件，MJ 专属低频项收进单行“MJ 设置”特殊面板。Midjourney 视频因输出模态不同继续作为独立模型。

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **默认入口**：`POST /v1/midjourney/generations`（等同 `imagine`）
- **查询**（两个接口，返回结构不同）：
  - `GET /v1/tasks/{task_id}` —— **统一任务接口**，状态为 `pending` / `processing` / `completed` / `failed`，结果在 `result.images[].url`
  - `GET /v1/midjourney/{task_id}` —— **MJ 风格接口**，返回 `grid_image_url`、`image_urls`、`buttons`。**需要读 `buttons[].customId` 做二次操作时必须用这个**
- **轮询节奏**：3–5 秒一次。查询接口不单独计费，但不要无 sleep 死循环
- **任务保留**：默认 **3 天**，过后查询返回 404，但**生成的图片 / 视频 URL 仍可访问**
- **权限**：普通用户只能查自己的任务，查他人任务返回 403

### 端到端流程

```
① POST /v1/midjourney/generations   提交 Imagine
② GET  /v1/tasks/{task_id}          轮询直到 completed
③ GET  /v1/midjourney/{task_id}     需要按钮时读取 buttons
④ 二次操作：/upscale /variation /reroll /zoom /pan /inpaint …
⑤ /inpaint 进入 MODAL 后 → /modal 提交 mask + prompt
```

## 2. 任务状态（MJ 风格）

| status | 含义 | 终态 |
|---|---|---|
| `NOT_START` | 已建行，系统未确认（瞬时态） | 否 |
| `SUBMITTED` | 系统接受，排队中 | 否 |
| `IN_PROGRESS` | 系统处理中 | 否 |
| `MODAL` | **等待调 `/modal` 补参**（局部重绘中间态，不是错误） | 否 |
| `SUCCESS` | 完成 | ✓ |
| `FAILURE` | 失败 → **自动退款**（`quota` 归 0，`fail_reason` 含原因） | ✓ |

`grid_image_url` 是四宫格合成大图；`image_urls` 是裁剪后的 4 张单图 URL 数组。

## 3. 完整能力清单（17 个 action / 18 个端点）

| 能力 | 端点 | action | 必填 |
|---|---|---|---|
| 文生图 / 垫图（默认入口） | `POST /v1/midjourney/generations` | `IMAGINE` | `prompt` |
| 文生图（显式入口） | `POST /v1/midjourney/generations/imagine` | `IMAGINE` | `prompt` |
| 多图融合 | `POST /v1/midjourney/generations/blend` | `BLEND` | `image_urls`（2–4 张） |
| 图生文（反推 prompt） | `POST /v1/midjourney/generations/describe` | `DESCRIBE` | `image_urls`（1 张） |
| 图片编辑（整图改写） | `POST /v1/midjourney/generations/edits` | `EDITS` | `prompt` + `image_urls` |
| 放大选图 U1–U4 | `POST /v1/midjourney/generations/upscale` | `UPSCALE` | `task_id` + (`index` 或 `custom_id`) |
| 弱变体 V1–V4 | `POST /v1/midjourney/generations/variation` | `VARIATION` | `task_id` + (`index` 或 `custom_id`) |
| 强变体 | `POST /v1/midjourney/generations/high-variation` | `HIGH_VARIATION` | `task_id` + (`index` 或 `custom_id`) |
| 微调变体（同弱变体，独立计费 key） | `POST /v1/midjourney/generations/low-variation` | `LOW_VARIATION` | `task_id` + (`index` 或 `custom_id`) |
| 重新生成（整网格重抽） | `POST /v1/midjourney/generations/reroll` | `REROLL` | `task_id` |
| 缩放扩展（Zoom Out） | `POST /v1/midjourney/generations/zoom` | `ZOOM` | `task_id` |
| 平移扩展（接图 / 全景） | `POST /v1/midjourney/generations/pan` | `PAN` | `task_id` + (`direction` 或 `custom_id`) |
| 局部重绘入口 | `POST /v1/midjourney/generations/inpaint` | `INPAINT` | `task_id` |
| 局部重绘补参 | `POST /v1/midjourney/generations/modal` | `MODAL` | `task_id` |
| 重塑（强） | `POST /v1/midjourney/generations/remix-strong` | `REMIX_STRONG` | `task_id` + `index` |
| 重塑（弱） | `POST /v1/midjourney/generations/remix-subtle` | `REMIX_SUBTLE` | `task_id` + `index` |
| 图生视频 | `POST /v1/midjourney/generations/video` | `VIDEO` | `image_urls` 或 `task_id` |
| 任务查询 | `GET /v1/tasks/{task_id}` · `GET /v1/midjourney/{task_id}` | — | — |

> 定价页还有 `shorten` 的价格档位，但文档站未提供 shorten 端点页面，接入前需向平台确认。

---

## 4. Imagine（`/generations`、`/generations/imagine`）

### 4.1 基础字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 是 | 提示词，支持原生 MJ 参数（如 `--ar 16:9 --v 6.1`） |
| `speed` | string | 否 | `relax`（默认）/ `fast` / `turbo` |
| `image_urls` | string[] | 否 | 垫图 URL（图生图场景），支持 URL 或 base64 |
| `metadata` | object | 否 | 自定义元数据，随任务保存，便于业务侧追踪 |
| `nsfw_check` | boolean | 否 | 默认 `false`。`true` 时用 `omni-moderation-latest` 预审提示词与输入图 |

### 4.2 结构化 MJ 参数（可写在 body，也可写在 prompt；**body 优先级高于 prompt**）

| 字段 | 类型 | 等价 MJ 参数 | 说明 |
|---|---|---|---|
| `size` | string | `--ar` | 宽高比，如 `"16:9"`、`"1:1"`、`"9:16"` |
| `quality` | string | `--q` | `"0.25"` / `"0.5"` / `"1"` / `"2"` |
| `style` | string | `--style` | 风格，如 `"raw"` |
| `version` | string | `--v` | 版本号。与 `niji: true` 搭配 `"7"` / `"6"` 时归一化为 Niji 版本 |
| `seed` | int | `--seed` | 随机种子。**本项目规则：绝对不显示**，不下发 |
| `negative_prompt` | string | `--no` | 负面提示词。**本项目规则：绝对不显示**，不下发 |
| `stylize` | int | `--s` | 风格化强度 0–1000 |
| `chaos` | int | `--c` | 混乱度 0–100 |
| `weird` | int | `--w` | 怪异度 0–3000 |
| `tile` | bool | `--tile` | 平铺模式 |
| `niji` | bool | `--niji` | Niji 开关。推荐 `niji: true` + `version: "7"` / `"6"` |
| `iw` | float | `--iw` | 图片权重 0–3（垫图时使用，默认 1；>1 更贴原图，<1 更自由） |
| `cw` | int | `--cw` | 角色权重 0–100 |
| `sw` | int | `--sw` | 风格权重 0–1000 |
| `cref` | string | `--cref` | 角色参考图 URL |
| `sref` | string | `--sref` | 风格参考图 URL |
| `dref` | string | `--dref` | 深度参考图 URL |
| `dw` | float | `--dw` | 深度权重 0–100 |
| `repeat` | int | `--repeat` | 重复生成次数 2–40 |
| `raw` | bool | `--raw` | 原始风格（v5.1+） |
| `draft` | bool | `--draft` | 草图模式（v7+） |
| `hd` | bool | `--hd` | HD 高清（**仅 v8.1 / v8.2**；未传 `version` 时后端自动补 `--v 8.1`） |
| `stop` | int | `--stop` | 提前停止 10–100（**仅 v5–6.1 / niji 5–6**） |
| `extra` | string | 任意 `--xxx` | 逃生口，原样追加到 prompt 末尾 |

**线上已验证可用版本**：`8.2`、`8.1`、`7`、`6.1`、`5.2`、`5.1`、`niji 7`、`niji 6`。

---

## 5. Blend（多图融合）

**完全靠图融合，不支持 `prompt`。**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_urls` | string[] | 是 | **2–4 张**，后端自动转 base64；单图 ≤ 12 MiB。少于 2 或多于 4 返回 400 |
| `dimensions` | string | 否 | 三档比例 `SQUARE`(1:1，默认) / `PORTRAIT`(2:3) / `LANDSCAPE`(3:2)；传了 `size` 时被覆盖 |
| `size` | string | 否 | 自由比例，任意 `w:h`（如 `16:9`、`21:9`），**优先级高于 `dimensions`** |
| `speed` | string | 否 | `relax`（默认）/ `fast` / `turbo` |
| `metadata` | object | 否 | 自定义元数据 |

比例优先级：`size` > `dimensions` > 默认 `SQUARE`。blend **没有独立版本参数**。

## 6. Describe（图生文）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_urls` | string[] | 是 | 单张图（数组形式，多传只取第一张）；单图 ≤ 12 MiB |
| `speed` | string | 否 | `relax` / `fast` / `turbo` |
| `metadata` | object | 否 | — |

**结果不在 `image_urls`**：文字结果在查询结果的 `prompt` / `description` 字段，**不返回 `image_urls` / `grid_image_url`**。反推为 4 段带编号建议，用 `\n` 分隔、数字 emoji `1️⃣2️⃣3️⃣4️⃣` 前缀。通常 1–3 s 返回，但**仍走标准异步流，必须轮询**。describe 为独立处理通道，不占用普通生图并发额度。缺图或单图超 12 MiB 返回 400。

## 7. Edits（图片编辑）

基于已有图 + prompt **改写整张图**（背景替换、风格迁移、内容修改）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | 是 | 编辑指令 |
| `image_urls` | string[] | 是 | 待编辑图；单图 ≤ 12 MiB |
| `speed` | string | 否 | `relax` / `fast` / `turbo` |
| `metadata` | object | 否 | — |

结构化参数与 Imagine 完全一致（body 优先，拼到 prompt 末尾并覆盖同名手写 flag）。

## 8. Upscale（放大选图 U1–U4）

| 字段 | 类型 | 说明 |
|---|---|---|
| `task_id` | string | 父任务 ID（须为 imagine / variation / reroll 等 **SUCCESS** 任务） |
| `index` | int | 选第几张（U1–U4），`1`–`4`；与 `custom_id` 二选一 |
| `custom_id` | string | 直接传按钮 ID；**两者都传时 `custom_id` 优先** |
| `speed` | string | `relax` / `fast` / `turbo`（本地合成，实际无影响） |
| `metadata` | object | — |

**行为**：从父任务已有 4 张图里截取，**本地合成、通常毫秒级 SUCCESS**，`image_urls` 只有 1 个元素。父任务非 SUCCESS 返回 400（`task is not in SUCCESS state`）；`index` 越界返回 400。

**HD upscale**：普通 upscale 只是截取；如果后续要对单图做 zoom / inpaint 等精细操作，文档建议改用 **HD upscale**（执行真实放大，输出 **2x 高清单图**，约 60–120 s），产出的单图能更稳定地支持后续操作。

## 9. Variation / High Variation / Low Variation

| 端点 | 力度 | 父任务 |
|---|---|---|
| `/variation` | 弱变体（varySubtle，等价 V1–V4） | imagine 四宫格 |
| `/high-variation` | **强变体**（varyStrong，对应 Vary (Strong)），偏离原图更多 | 通常为 Upscale 后的单图任务 |
| `/low-variation` | 弱变体，**与 Variation 行为完全一致**，仅计费 key 不同 | 通常为 Upscale 后的单图任务 |

三者参数相同：`task_id`（须 SUCCESS）、`index`（`1`–`4`）或 `custom_id`（二选一）、`speed`、`metadata`、`nsfw_check`。

Variation 成功后返回**新的四宫格** `grid_image_url` + 4 张 `image_urls`。来源任务的 `version` / `niji` 会自动继承（影响计费 fallback）。新接入推荐直接用 `/variation`，不用 `/low-variation`。

## 10. Reroll（重新生成）

基于父任务 prompt 重新抽 4 张图（等价 🔄 按钮），**整网格重抽，无需 `index`**。

| 字段 | 说明 |
|---|---|
| `task_id` | 原任务 ID |
| `custom_id` | 可选，直接指定 reroll 按钮 ID |
| `speed` / `metadata` / `nsfw_check` | 同上 |

## 11. Zoom（缩放扩展 / Outpaint）

对**已 upscale 的单图**执行 Zoom Out：原图保留，向外补背景。

| 字段 | 说明 |
|---|---|
| `task_id` | 须为 Upscale 后的单图任务 |
| `zoom_ratio` | 决定档位：**< 2 → `Zoom Out 1.5x`（Outpaint）；未传或 ≥ 2 → `Zoom Out 2x`（CustomZoom）**，两者均直接出图 |
| `index` | 可选，选父任务第几张（`1`–`4`，默认 `1`）；单图通常不用动 |
| `custom_id` | 可选，直接指定 Zoom 按钮 ID |
| `speed` / `metadata` / `nsfw_check` | 同上 |

## 12. Pan（平移扩展 / 拼全景）

对已 upscale 的单图向指定方向「接图」扩展，可连续 pan 拼全景。**仅 v6 / v6.1 / v7 / v8.1 / v8.2 / niji6 支持。**

| 字段 | 说明 |
|---|---|
| `task_id` | 须为 Upscale 后的单图任务 |
| `direction` | `left` / `right` / `up` / `down` |
| `custom_id` | 可选，指定后不必再传 `direction` |
| `index` | 可选（`1`–`4`），backend 自动转 0-based |
| `speed` / `metadata` / `nsfw_check` | 同上 |

## 13. Inpaint + Modal（局部重绘，两步）

### 13.1 `/inpaint`

等价 `Vary (Region)`。**父任务必须是 SUCCESS 的 upscale 单图；四宫格直接 inpaint 会报错，需先 upscale。**

| 字段 | 说明 |
|---|---|
| `task_id` | 原任务 ID（一般为 Upscale 后的单图任务） |
| `custom_id` | 可选，直接指定 `Vary (Region)` 按钮 ID |
| `index` | 可选（`1`–`4`，默认 `1`） |
| `speed` / `metadata` / `nsfw_check` | 同上 |

提交成功后返回 `status: "modal"`——**这是合法非终态，不是错误**。

### 13.2 `/modal`

| 字段 | 说明 |
|---|---|
| `task_id` | **inpaint 步骤返回的本地任务 ID**（须为 MODAL 状态） |
| `prompt` | 局部重绘提示词；留空则继承父任务 prompt |
| `mask_url` | 遮罩图 URL 或 base64。**局部重绘时必填**；不传则走「外扩」模式 |
| `speed` / `metadata` / `nsfw_check` | 同上 |

**mask 要求**：PNG 透明背景（也支持 `data:image/png;base64,...`）；建议与父图同分辨率（系统也会自动 resize）；**透明区域 = 要重绘的位置，白色区域 = 保留原图**；单图 ≤ 12 MiB；URL 必须公网可达（私网会被 SSRF 拦截）。

> ⚠️ 进入 MODAL 后 **30 分钟内必须调 `/modal`**，否则后台自动 CANCEL + 退款。

## 14. Remix（重塑，仅 v8.1 / v8.2）

v8 操作面板**移除了 U1–U4 / zoom / outpaint / inpaint**。对应替代：变化 → Variation / High Variation；重塑 → 本接口；重新生成 → Reroll。

| 端点 | op | 改动幅度 |
|---|---|---|
| `/remix-strong` | `remixStrong` | 大幅改动，构图 / 风格都可能变（类似 High Variation） |
| `/remix-subtle` | `remixSubtle` | 小幅改动，保持主体 / 色调（类似 Variation） |

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task_id` | string | 是 | 父任务（**v8.1 / v8.2 imagine SUCCESS**）。v7 / v6 父图请改用 Variation / High Variation |
| `index` | int | 是 | 选父图第几张（`1`–`4`） |
| `prompt` | string | 否 | 重塑用的新 prompt；空则继承父图 prompt |
| `speed` | string | 否 | `relax`（默认）/ `fast` / `turbo` |

## 15. Video（图生视频）

**固定 FAST 模式，无 speed 维度；不支持纯文生视频（t2v），必须给首帧。时长固定约 5 秒。**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `image_urls` | string[] | △ | — | 起始帧（1 张，≤ 12 MiB）；与 `task_id` 二选一 |
| `task_id` | string | △ | — | 复用已有 imagine SUCCESS；与 `image_urls` 二选一 |
| `prompt` | string | 否 | 继承父任务 | 视频提示词；为空时必须有 `task_id` |
| `index` | int | 否 | — | 从 imagine 4 张图选哪张作首帧（**`0`–`3`**，注意是 0-based，与其他端点的 1-based 不同），配合 `task_id` |
| `video_type` | string | 否 | `vid_1.1_i2v_480` | 见下表 |
| `animate_mode` | string | 否 | `manual` | `manual` / `auto`；**`auto` 必须给 `task_id` + `index`** |
| `motion` | string | 否 | `high` | `low` / `high`，运动幅度，**不影响计费** |
| `batch_size` | int | 否 | `1` | 必须 `1` / `2` / `4`，其他值视为 1。**计费 × N** |
| `end_url` | string | 否 | — | 结束帧；设了后 `video_type` 自动升级为 `start_end_*` |

### `video_type` 合法值

| 值 | 分辨率 | 模式 | 命中价格 |
|---|---|---|---|
| `vid_1.1_i2v_480` | 480p | 基础 i2v（默认） | `midjourney@video` |
| `vid_1.1_i2v_720` | 720p | 基础 i2v | `midjourney@video-720p` |
| `vid_1.1_i2v_start_end_480` | 480p | 起止帧（传 `end_url` 时自动升级） | `midjourney@video` |
| `vid_1.1_i2v_start_end_720` | 720p | 起止帧（传 `end_url` 时自动升级） | `midjourney@video-720p` |

**不接受带 `extend` 的取值。** 计费提醒：出片只要 1 段就用 `batch_size=1`，不要默认开 4（成本翻 N 倍）。

## 16. 错误码与重试策略

| code | 含义 | 重试策略 |
|---|---|---|
| `1` / `200` | 成功 | — |
| `4` VALIDATION_ERROR | 参数错 | ❌ 不要重试，修正参数 |
| `3` NOT_FOUND | 无可用实例 / task_id 不存在 | 实例不可用可稍后重试；task_id 不存在不要重试 |
| `9` FAILURE | 服务拒绝 / 内部错误 | ⏳ 指数退避（1s, 4s, 16s） |
| `21` MODAL | 非终态 | ✅ 继续调 `/modal` |
| `24` BANNED_PROMPT | 敏感词 | ❌ 不要重试，改 prompt；**已自动退款** |
| `429` | 限流 | ⏳ 指数退避 + jitter |
| `5xx` / 网络错 | 服务端 / 网络 | ⏳ 指数退避，网络错可立即重试 1 次 |

通用 HTTP 错误：400 `invalid_request_error`、401 `authentication_error`、402 `payment_required`、404 `not_found`、429 `rate_limit_error`。

## 17. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) → `MIDJOURNEY (midjourney)`（2026-08-22 读取，**75 个价格档位**，1 Credit ≈ $0.1）。

计费 key 形如 `midjourney@<action>[-version][-speed]`。

**基础价（relax / 未传 speed，不追加 speed 后缀）**

| 动作 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认 / `imagine` / `imagine-niji6` / `imagine-niji7` / `imagine-v5.1` / `imagine-v5.2` / `imagine-v6.1` / `imagine-v7` / `imagine-v8.1` / `imagine-v8.2` | 0.4504 Credits/次 ≈ **$0.04504/次** | $0.0563 | 20% |
| `blend` / `describe` / `edits` / `high_variation` / `low_variation` / `inpaint` / `modal` / `pan` / `remix_strong` / `remix_subtle` / `reroll` / `shorten` / `upscale` / `variation` / `zoom` | 0.5504 Credits/次 ≈ **$0.05504/次** | $0.0688 | 20% |

**Fast 档**：所有动作 0.5504 Credits/次 ≈ **$0.05504/次**（imagine 从 0.4504 涨到 0.5504）。

**Turbo 档**：所有动作 1 Credits/次 ≈ **$0.1/次**（官方价 $0.125，节省 20%）。

**视频**

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| `video`（480p） | 2 Credits/次 ≈ **$0.2/次** | $0.25 | 20% |
| `video-720p` | 4 Credits/次 ≈ **$0.4/次** | $0.5 | 20% |

视频实扣 = 单价 × `batch_size`。

## 18. 接入注意（文档「最佳实践」要点）

- **垫图**：用户上传的图先存自己的 OSS / CDN 再传 URL，不要直接传 base64（浪费带宽）；第三方 URL 可能过期，先转存；压缩到 < 5 MiB（平台上限 12 MiB）；PNG / JPG / WebP 均可，推荐高质量 JPG；分辨率 1024–2048 px 足够。
- **prompt 设计**：主体在前，结构化参数显式给出（body 字段比依赖默认值更可控），避免抽象词与引号。
- **并发**：平台对每分钟提交数有上限，超出 429；任务长时间停在 `SUBMITTED` 通常是排队中。
- **监控参考阈值**：近 1h SUCCESS 率 > 95%；平均完成耗时 < 90 s；MODAL 停留任务数接近 0；`code=24` 比例 < 5%。
- **长时间 `NOT_START`**：平台会自动超时退款，无需手动处理。

## 19. 适配要点（对本项目）

- 本项目默认**绝对不显示**：`seed`、负面提示词。Midjourney 的 body 中**这两个字段都存在**（`seed` → `--seed`、`negative_prompt` → `--no`），必须主动不注册、不下发；同时要注意用户可能在 prompt 里手写 `--seed` / `--no`，这属于用户自己写的 prompt 文本，按原样传递。
- **不要把这 17 个 action 压缩成一个「图片生成」模型**。至少要区分：一次性生成类（imagine / blend / describe / edits / video）与依赖父任务的二次操作类（upscale / variation / high-variation / low-variation / reroll / zoom / pan / inpaint+modal / remix）。后者必须持有前序任务的 `task_id`（部分还需 `index` 或 `custom_id`），产品上需要「结果卡片 → 继续操作」的交互载体。
- **两个查询接口不等价**：要做二次操作就必须用 `/v1/midjourney/{task_id}` 拿 `buttons[].customId`。
- **index 基准不统一**：绝大多数端点 `index` 是 `1`–`4`，但 `/video` 的 `index` 是 `0`–`3`。
- **MODAL 是合法非终态**，状态机不能把它当失败；且有 30 分钟超时。
- **v8 与 v6/v7 的可用操作不同**：v8.1/8.2 没有 U1–U4 / zoom / outpaint / inpaint，只有 Variation / Remix / Reroll。UI 需按父任务版本裁剪可用操作。
- `speed` 直接决定价格档位（relax / fast / turbo 三档差 2 倍以上），必须让用户可见或固定为一档。
- `batch_size` 在视频端点上直接乘倍计费，默认必须是 1。

## 20. 当前代码覆盖与架构边界

本轮适配后的生成模型定义如下：

| 项目模型 ID | 平台入口 | 当前覆盖 |
|---|---|---|
| `midjourney` | `/v1/midjourney/generations` | Imagine、垫图、版本 / Niji、速度、比例、质量、风格化、参考图权重、重复生成等结构化参数 |
| `midjourney-blend` | `/v1/midjourney/generations/blend` | 2–4 图融合、比例、速度 |
| `midjourney-edit` | `/v1/midjourney/generations/edits` | 图片编辑及与 Imagine 一致的结构化参数 |
| `midjourney-video` | `/v1/midjourney/generations/video` | 上传首帧或复用 `task_id`、任务图索引、首尾帧、自动 / 手动动画、运动幅度、批量数 |

以下能力不是遗漏的请求字段，而是当前通用生成模型抽象无法安全表达的不同产品流程，因此没有伪装成普通模型：

- `describe` 返回文本，不返回媒体 URL；需要先增加文本结果类型及其展示 / 持久化链路。
- `upscale`、`variation`、`high-variation`、`low-variation`、`reroll`、`zoom`、`pan`、`remix-*` 依赖父任务、按钮 `customId` 和版本限制；应作为生成结果卡片上的后续动作接入。
- `inpaint` → `modal` 是带 30 分钟时限的两阶段状态机；必须先让运行时正确保存并恢复 `MODAL` 中间态，再接遮罩编辑界面。

因此，当前代码层面的独立生成入口已经闭环；上述连续操作应在新增「结果后续操作」应用能力时统一实现，不能继续堆进模型 schema。

## 21. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Midjourney API 总览（路由表、流程图、错误） | https://docs.apimart.ai/cn/api-reference/images/midjourney/generation | 否 |
| Imagine | https://docs.apimart.ai/cn/api-reference/images/midjourney/imagine | 否 |
| Blend | https://docs.apimart.ai/cn/api-reference/images/midjourney/blend | 否 |
| Describe | https://docs.apimart.ai/cn/api-reference/images/midjourney/describe | 否 |
| Edits | https://docs.apimart.ai/cn/api-reference/images/midjourney/edits | 否 |
| Upscale | https://docs.apimart.ai/cn/api-reference/images/midjourney/upscale | 否 |
| Variation | https://docs.apimart.ai/cn/api-reference/images/midjourney/variation | 否 |
| High Variation | https://docs.apimart.ai/cn/api-reference/images/midjourney/high-variation | 否 |
| Low Variation | https://docs.apimart.ai/cn/api-reference/images/midjourney/low-variation | 否 |
| Reroll | https://docs.apimart.ai/cn/api-reference/images/midjourney/reroll | 否 |
| Zoom | https://docs.apimart.ai/cn/api-reference/images/midjourney/zoom | 否 |
| Pan | https://docs.apimart.ai/cn/api-reference/images/midjourney/pan | 否 |
| Inpaint | https://docs.apimart.ai/cn/api-reference/images/midjourney/inpaint | 否 |
| Modal | https://docs.apimart.ai/cn/api-reference/images/midjourney/modal | 否 |
| Remix | https://docs.apimart.ai/cn/api-reference/images/midjourney/remix | 否 |
| Video | https://docs.apimart.ai/cn/api-reference/images/midjourney/video | 否 |
| 任务查询 | https://docs.apimart.ai/cn/api-reference/images/midjourney/query | 否 |
| 最佳实践（轮询 / 重试 / 排错） | https://docs.apimart.ai/cn/api-reference/images/midjourney/best-practices | 否 |
| 端到端工作流 | https://docs.apimart.ai/cn/api-reference/images/midjourney/workflow | 否 |
| 定价中心（搜 MIDJOURNEY，75 个档位） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
