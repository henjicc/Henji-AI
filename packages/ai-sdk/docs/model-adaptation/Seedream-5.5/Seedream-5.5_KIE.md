# Seedream 5.5 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| 模态 | 图片 |
| 供应商 | KIE（聚合平台） |
| 平台模型 ID | `seedream/5-5-text-to-image`、`seedream/5-5-image-to-image`、`seedream/5-5-layer-decomposition` |
| 痕迹AI 模型 ID | `kie-seedream-5.5`（canonical `seedream-5.5`） |
| 接口形态 | `POST https://api.kie.ai/api/v1/jobs/createTask` 异步，Get Task Details 轮询，与其他 KIE Market 模型同协议（见 `供应商/KIE.md`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 能力与归并

| 能力 | KIE model | 痕迹AI 入口 |
|---|---|---|
| 文生图 | `seedream/5-5-text-to-image` | 模式“生成 / 编辑”，未上传图片 |
| 图生图 / 多图参考（1–10 张） | `seedream/5-5-image-to-image` | 模式“生成 / 编辑”，上传图片后自动切换 |
| 图层拆分（底图 + 各层） | `seedream/5-5-layer-decomposition` | 模式“图层拆分”，必须且只能 1 张图 |

三个 model 同一模型版本，合为一个项目模型；生成与编辑按是否上传图片自动切换，图层拆分为显式模式（输入、参数与结果结构都不同）。

## 2. 请求参数（官方 OpenAPI，2026-11-14 读取）

### 文生图 `input`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | 5–5000 字符 |
| `aspect_ratio` | enum | 是 | — | `1:1` `4:3` `3:4` `16:9` `9:16` `2:3` `3:2` `21:9` |
| `size` | enum | 否 | `2K` | `1K` `1.5K` `2K`，影响价格 |
| `output_format` | enum | 否 | `png` | `png` / `jpeg`；按项目约定不展示、不下发 |
| `background` | enum | 否 | `auto` | `auto` / `transparent` / `opaque`；`transparent` 需 png |
| `nsfw_checker` | boolean | 否 | `false` | 不展示、不下发 |

### 图生图 `input`

同文生图，另加 `image_urls`（必填，1–10 张公网 URL，JPEG/PNG/WEBP，每张 ≤10MB，每张单独计费）；`aspect_ratio` 可选，额外有 `auto`（默认，模型决定）。

### 图层拆分 `input`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `image_url` | string | 是 | — | 1 张公网 URL，JPEG/PNG/WEBP，≤10MB |
| `prompt` | string | 否 | — | 0–2000 字符；空则自动识别主要元素；可用 `<bbox>x1 y1 x2 y2</bbox>`（0–1000 归一化）标位置 |
| `size` | enum | 否 | `auto` | `auto`（保持原图尺寸，低于 1K 提到 1K、高于 2K 降到 2K，按 2K 计价）/ `1K` / `1.5K` / `2K` |
| `output_format` | enum | 否 | `png` | 只控制底图；不下发 |
| `max_images` | integer | 否 | `30` | 2–100，含底图；按实际返回张数计费 |
| `text_recognition` | boolean | 否 | `false` | 识别图层文字；不下发 |
| `nsfw_checker` | boolean | 否 | `false` | 不下发 |

## 3. 响应结构

Get Task Details 的 `data.resultJson` 是 JSON 字符串：生成/编辑为 `{resultUrls:[...]}`；图层拆分为 `{resultObject:{layers_data:[...]}, resultUrls:[...]}`，两个数组同序。`layers_data[]` 每项 `z_index`（0 为底图，底图没有 bounding_box/name/description）、`size`（`WxH`）、`output_format`、`url`、`bounding_box.absolute/normalized`、`name`、`description`。结构与 5.0 Pro 一致，由 `structured-output/seedream-layer-stack.ts` 的 KIE 分支解析（fixture `tests/fixtures/structured-output/seedream55-kie-layers.json`）。

## 4. 价格（kie.ai/pricing，2026-11-14 读取；1 credit = $0.005）

| 项 | credits | USD |
|---|---|---|
| 输出 1K / 1.5K（每张） | 3.6 | $0.018 |
| 输出 2K（每张；图层拆分 `auto` 同价） | 6.3 | $0.0315 |
| 输入图（每张，图生图与图层拆分共用条目） | 1.44 | $0.0072 |

- 生成/编辑每次出 1 张：费用 = 输出档位价 + 输入图张数 × $0.0072。
- 图层拆分：输入图费 + 实际返回张数（底图 + 各层）× 档位价。提交前不知道返回几张，项目内估价返回不可估算（与 Fal 版同做法）。
- 页面称比官方低 10%，无限时价标记。

## 5. 适配要点

- 比例：智能比例本地换成具体比例（有图取首图最接近，无图 1:1）；文生图端点比例必填且没有 `auto`。
- 分辨率 1K / 1.5K / 2K，默认 2K（官方默认）。
- 背景（自动 / 不透明 / 透明）只在生成/编辑模式显示与发送；不发 `output_format`，依赖官方默认 png 保证透明可用。
- 图层拆分固定发 `max_images: 17`：项目图层结果契约只认底图加 16 层，官方默认 30 张会让超出的结果整份作废。
- 不接入：`output_format`、`nsfw_checker`、`text_recognition`、`callBackUrl`。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图接口 | https://docs.kie.ai/market/seedream/5-5-text-to-image.md | 否 |
| 图生图接口 | https://docs.kie.ai/market/seedream/5-5-image-to-image.md | 否 |
| 图层拆分接口与响应示例 | https://docs.kie.ai/market/seedream/5-5-layer-decomposition.md | 否 |
| 价格（`__NEXT_DATA__` 内 creditPrice/usdPrice） | https://kie.ai/pricing | 否 |
| 模型介绍与计费说明 | https://kie.ai/seedream-5-5 | 否 |
| 文档索引 | https://docs.kie.ai/llms.txt | 否 |
