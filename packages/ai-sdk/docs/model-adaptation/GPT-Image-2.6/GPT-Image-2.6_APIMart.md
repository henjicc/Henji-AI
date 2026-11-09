# GPT Image 2.6 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-09 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-gpt-image-2.6`（通用标识 `gpt-image-2.6`） |
| 平台模型 ID | Ext：`gpt-image-2.6-ext`（`version` 选 `flare` / `sunburst`）；官方：`gpt-image-2.6-flare`、`gpt-image-2.6-sunburst` |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- Base URL：`https://api.apimart.ai`（备用线路见 [供应商/APIMart.md](../供应商/APIMart.md)）
- 鉴权：`Authorization: Bearer <API_KEY>`
- 提交：`POST /v1/images/generations` → `data[0].task_id`
- 查询：`GET /v1/tasks/{task_id}`，完成后读 `data.result.images[].url[]`，失败读 `data.error.message`

## 2. 能力与渠道

| 渠道 | 模型 | 能力 | 计费 |
|---|---|---|---|
| Ext | `gpt-image-2.6-ext` + `version` | 文生图、最多 16 张参考图的图生图；当前只开放 `1k`；`n` 只能 1（2–4 会建任务后失败退款） | 按张 |
| 官方 | `gpt-image-2.6-flare` / `-sunburst` | 文生图、最多 16 张参考图编辑、蒙版、标注层、GIF、SVG；1k/2k/4k；`n` 1–4 | 按 token |

Flare 速度优先，Sunburst 细节与编辑一致性优先；两者价格与参数相同。

## 3. 请求参数

### 3.1 官方渠道（`gpt-image-2.6-flare` / `-sunburst`）

| 字段 | 取值 | 说明 |
|---|---|---|
| `model` | `gpt-image-2.6-flare` / `gpt-image-2.6-sunburst` | 必填 |
| `prompt` | ≤ 32,000 字符 | 必填 |
| `size` | `auto` / 15 种比例（`1:1` `3:2` `2:3` `4:3` `3:4` `5:4` `4:5` `16:9` `9:16` `2:1` `1:2` `21:9` `9:21` `3:1` `1:3`）/ 精确像素 | 默认 `auto` |
| `resolution` | `1k` / `2k` / `4k`（小写） | 默认 `1k` |
| `quality` | `low` / `medium` / `high` / `xhigh` / `max` / `auto` | 默认 `auto`，按 `max` 预扣 |
| `n` | 1–4 | |
| `output_format` | `png` / `jpeg` / `webp` / `gif` / `svg` | GIF 支持文生图与带 `image_urls` 的图生图；SVG 仅文生图。项目只在选动图 / 矢量图时发送 `gif` / `svg` |
| `output_compression` | 0–100 | 项目不显示、不请求 |
| `background` | `transparent` / `opaque` / `auto` | 透明只配 png / webp |
| `moderation` | `auto` / `low` | 默认 `low`，项目不请求 |
| `image_urls` | ≤ 16 张 | 公网 URL 或 Data URL |
| `mask_url` | 透明 PNG | 需配 `image_urls`，不能与标注层同用 |
| `markup_url` / `markup` | 透明 PNG 标注层 | 需配 `image_urls` |
| `complexity` | `low` / `medium` / `high` | 规划强度，上游默认 `high`，不单独收费，仅 2.6 支持 |
| `frame_count` / `frame_duration_ms` | GIF 专用：帧数 2–16（默认 9，APIMart 上限 16）；每帧毫秒数最小 20、按 10 ms 取整（默认 200） | 选动图时发送 |
| `size`（GIF） | 单帧像素 `WxH`，宽高为 16 的倍数，省略或 `auto` 为 512×512，不接受比例名 | 项目按比例换算后发送 |
| `svg` | `{ model, reasoning? }`：`model` 必填，选平台有文本 token 定价的模型（文档示例 `gpt-5.4-mini`、`gpt-5.6-sol`）；`reasoning.effort` 可选 | 选矢量图时发送 `{ model }` |
| `safety_identifier` | ≤ 128 字符 | 项目不请求 |

尺寸映射与 GPT Image 2.5 相同（例 `1:1`：1k 1024×1024、2k 2048×2048、4k 2880×2880）。

### 3.2 Ext 渠道（`gpt-image-2.6-ext`）

| 字段 | 取值 | 说明 |
|---|---|---|
| `model` | `gpt-image-2.6-ext` | 必填 |
| `version` | `flare` / `sunburst` | 默认 `flare` |
| `resolution` | 当前仅 `1k` | `2k` / `4k` 返回 403 `model_price_not_configured` |
| `size` / `aspect_ratio` | `auto` 或 10 种比例：`1:1` `3:2` `2:3` `4:3` `3:4` `5:4` `4:5` `16:9` `9:16` `21:9` | 不接受像素值 |
| `n` | 1 | 2–4 建任务后失败退款 |
| `quality` | `auto` / `low` / `medium` / `high` / `xhigh` / `max` | 不影响价格 |
| `complexity` | `low` / `medium` / `high` | 不影响价格 |
| `output_format` | `png` / `jpeg` / `webp` / `svg` / `gif` | 项目不请求 |
| `image_urls` | ≤ 16 张，每张 ≤ 20 MB | |
| 不生效字段 | `background` / `moderation` / `output_compression` / `seed` / `negative_prompt` / `style` | 传入不报错但无效 |
| 报 400 字段 | `width` / `height` / `markup` / `markup_url` | |

## 4. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) 与 [GPT Image 2.6 模型页](https://apimart.ai/zh/model/gpt-image-2-6)（2026-11-07 读取，黄金价 = 当前价，1 Credit ≈ $0.1）。

| 渠道 | 规格 | 单价 |
|---|---|---|
| Ext | flare@1K / sunburst@1K | $0.0085 / 张 |
| 官方 | 文本输入 / 缓存文本输入 | $4 / $1 每 1M tokens |
| 官方 | 图片输入 / 缓存图片输入 | $6.4 / $1.6 每 1M tokens |
| 官方 | 图片输出 | $24 / 1M tokens |

动图与矢量图（模型页说明）：GIF 按所有帧拼成的整张图计费，每段动图单独计费，带参考图时按每张 1536 token × 图片输入价预扣；SVG 费用 = 生成参考图费用 + 写作模型实际文本用量，结果带 `data.usage.svg_usage`。按张固定价合约账号不支持 SVG。

官方渠道输出 token：模型页说明“相较 2.5，low 输出 token 消耗为 4.2 倍，medium 为 3.3 倍，high、xhigh、max 不变”。模型页预估示例 1:1 / 1k / 低质量约 824 token ≈ $0.0198，与 2.5 表 196 token × 4.2 吻合。`auto` 按 `max` 预扣、实测通常按 `low` 结算。

## 5. 项目适配

- 一个产品模型：顶层 `role: 'channel'` 渠道（默认 Ext）+ `role: 'mode'` 版本（Flare / Sunburst）。
- 比例默认“智能”：按首图比例取最近的支持比例，无图回退 `1:1`；Ext 渠道裁剪为 10 种比例。
- 分辨率、数量、背景只在官方渠道显示；Ext 固定发 `resolution: "1k"`、`n: 1`。
- 质量、规划强度两个渠道都发送（Ext 不影响价格）。
- 估价：Ext $0.0085；官方按 2.5 尺寸 token 表 × 2.6 倍率 × $24/1M 估算输出，提示词与参考图输入另计。
- 输出类型（2026-11-09 按用户要求开放，只在官方渠道）：图片 / 动图 / 矢量图，默认图片。
  - 动图：帧数、每帧时长显示；分辨率与背景收起、不发送。单帧尺寸按比例以 512×512 面积换算，所有帧按 2–8 帧 4×2、9 帧 3×3、10–12 帧 4×3、13–16 帧 4×4 拼图，拼图每边 ≤ 3840、总像素 ≤ 8,294,400 在该面积下都满足；按取整后的实际单帧尺寸算出的拼图宽高比 > 3:1 时提交前报错，智能比例只在当前帧数拼得出的比例里选。不与蒙版、标注层、`output_compression` 同用。
  - 矢量图：只能文生图（有参考图时选项被裁掉），`n` 固定 1；显示「矢量化模型」，默认 `gpt-5.4-mini`；背景不发送。
  - 估价：动图按 1:1 1K 输出 token × 拼图像素折算再乘 2.6 倍率，并加参考图输入预扣；矢量图只估参考图出图费用，矢量化模型的文本费用不在估价内。
- 不显示、不请求：`output_compression`、`moderation`、`svg.reasoning`、`safety_identifier`、`seed`、负面提示词。
- 暂未接入：蒙版（`mask_url`）与标注层（`markup_url`）——需要派生媒体创作闭环，沿用 2.5 APIMart 的范围。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 官方渠道 API 文档 | https://docs.apimart.ai/cn/api-reference/images/gpt-image-2.6/generation | 否 |
| Ext 渠道 API 文档 | https://docs.apimart.ai/cn/api-reference/images/gpt-image-2.6-ext/generation | 否 |
| 模型页（价格、token 倍率） | https://apimart.ai/zh/model/gpt-image-2-6 | 否 |
| 定价中心 | https://apimart.ai/zh/pricing | 否 |
