# Seedream 5.5 · 火山引擎（火山方舟，官方）

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| 模态 | 图片 |
| 供应商 | 火山引擎 · 火山方舟（Ark），模型原厂官方接口 |
| 平台模型 ID | `doubao-seedream-5-5-261028`（定价页与模型详情写作 `doubao-seedream-5-5`；第三方聚合名 `doubao-seedream-5.5` 不是方舟 ID） |
| 痕迹AI 模型 ID | `volcengine-seedream-5.5`（canonical `seedream-5.5`） |
| 接口形态 | **同步**（一次 POST 直接返回图片），无轮询、无流式 |
| 文档可见性 | 公开，无需登录；调用需 API Key |
| 价格可见性 | 公开，无需登录 |
| 官方文档最后更新 | 2026-11-13（图片生成 API 文档） |

## 1. 接入协议

与 Seedream 5.0 Pro 相同：

- **接口**：`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`
- **鉴权**：`Authorization: Bearer $ARK_API_KEY`
- **结果时效**：`response_format=url` 时链接 **24 小时内有效**
- 限流：模型列表页写 500（IPM）；图层拆分按 `max_images` 预扣

## 2. 能力清单

| 能力 | 触发方式 |
|---|---|
| 文生图 | 不传 `image` |
| 单图 / 多图生图 | `image` 传 1 张或 2–10 张 |
| 原生透明背景（RGBA） | `background: "transparent"`，**文生图也可用**（5.0 Pro 只支持图生图且要带透明通道的输入） |
| 图层拆分 | `layer_decomposition: true` + 恰好 1 张 `image`；1 张底图 + 最多 99 层，可选富文本 OCR |
| 多轮编辑 | 把上一轮结果作为 `image` 继续请求 |

**不支持**：组图（`sequential_image_generation`）、联网搜索（`tools`）、流式（`stream`）。官方 API 文档对 5.5 未列坐标 / 框选 / 箭头交互编辑（5.0 Pro / Flash 有），与官方博客“精准编辑局部区域”的说法有出入，以 API 文档为准。

## 3. 请求参数（与 5.0 Pro 的差异加粗）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必选 | — | `doubao-seedream-5-5-261028` |
| `prompt` | string | 生成必选；图层拆分可选 | — | 图层拆分为空时自动识别主要元素，支持 `<bbox>` |
| `image` | string / string[] | 生成可选；图层拆分必选 | — | 生成最多 **10** 张：jpeg/png/webp/bmp/tiff/gif/heic/heif，比例 [1/16, 16]，≤ 30 MB，总像素 [196, 36M]。图层拆分仅 1 张 png/jpeg，总像素 [262144, 36M] |
| `size` | string | 可选 | 生成 `2K`；图层拆分 `auto` | 生成：`1K` / `1.5K` / `2K` 或 `宽x高`（总像素 [921600, 4624220]，比例 [1/16, 16]）；图层拆分：`1K` / `1.5K` / `2K` / `auto` |
| `background` | string | 可选 | **`auto`** | **`auto` / `transparent` / `opaque`**；图层拆分不得传；`auto` 且 `output_format=jpeg` 时无 alpha |
| `output_format` | string | 可选 | **`png`** | `png` / `jpeg`；图层拆分只控制底图 |
| `layer_decomposition` | boolean | 可选 | `false` | 图层拆分开关 |
| **`layer_decomposition_options`** | object | 可选 | — | **`max_images`**：含底图的最大张数，默认 **30**（范围按文档 2–100）；**`text_recognition`**：bool，默认 `false`，为 `true` 时在 `data[].text_recognition` 返回富文本 OCR |
| `optimize_prompt_options` | object | 可选 | `{"mode":"standard"}` | 5.5 只有 `standard`（Pro 另有 `fast`） |
| `response_format` | string | 可选 | `url` | `url` / `b64_json` |
| `watermark` | boolean | 可选 | **`true`** | 必须显式传 `false` |
| **`safety_identifier`** | string | 可选 | — | 终端用户标识，≤ 64 字符 |

## 4. 响应结构

`created` / `model` / `data[]` / `usage` / `error`。

- `data[]` 公共：`url` 或 `b64_json`、`size`、`output_format`、**`background`**（实际透明类型，可能与请求不同）。
- 图层拆分另有 `z_index`（底图 0）、`name`、`description`、`bounding_box.absolute` / `normalized`、**`text_recognition`**（5.5 新增）。
- `usage`：`generated_images`、`output_tokens`、**`input_images`**（5.5 新增）。

## 5. 价格（官方，人民币）

来源：火山方舟「模型价格」（DocumentID=1544106，Markdown 版 `https://docs.volcengine.com/docs/zh/ark/model-pricing.md`，2026-11-14 读取）。

| 模型 | 输入图 | 输出图（P = 单张输出图总像素） |
|---|---|---|
| `doubao-seedream-5-5` | **0.05 元/张**（无首张免费） | P ≤ 2.61M：**0.13 元/张**；2.61M < P ≤ 4.63M：**0.23 元/张** |

- 公式：单次费用 = Σ 输入图 × 0.05 + Σ 每张输出图对应档位单价。未成功输出（审核拦截等）不计费。
- 档位按像素判断，不按档名：本项目 1K、1.5K 各比例换算后都 ≤ 2.61M（0.13），2K 各比例都 > 2.61M（0.23）。
- **图层拆分**：5.5 这一行没有单独的图层拆分价（0.15 / 0.30 只属于 5.0 Pro 行）。页面只写“Seedream 5.5 / 5.0 pro 图层拆分场景，单次请求中的每个图层可能归属不同分辨率档位，按实际生成情况计费”。**推断**：底图与每个图层按上表输出价（0.13 / 0.23）逐张计，另加 1 张输入图 0.05；待真实账单核对。

## 6. 适配要点

- 与 Seedream 5.0 Pro / Flash 共用工厂 `catalog/volcengine/seedream.ts`（`edition: '5.5'`），参数结构一致：模式（生成·编辑 / 图层拆分，`role: 'mode'`）、比例、分辨率（1K / 1.5K / 2K）、图层分辨率（auto / 1K / 1.5K / 2K）、背景。
- 背景三档 `auto`（默认，与官方一致）/ `transparent` / `opaque`，只在生成模式显示和发送；图层拆分不发 `background`。
- 生成模式由比例 + 档位本地换算为 `宽x高`（16 对齐），落在官方像素范围内；参考图从 `uploadedFilePaths` / `images` / `uploadedImages` 三种字段读取，最多 10 张。
- 图层拆分固定发 `layer_decomposition_options.max_images = 17`：项目的图层结果契约只接收底图加 16 层，官方默认 30 会让超出部分使整份结果作废。`text_recognition` 暂不暴露、不发送（结果解析尚未消费 OCR 字段）。
- `watermark` 固定 `false`；`output_format`、`optimize_prompt_options`、`safety_identifier` 不显示不发送（`output_format` 用官方默认 png，透明背景可用）。
- 本地估价：生成 / 编辑 = 按实际换算像素取 0.13 或 0.23 + 输入图数 × 0.05；图层拆分层数与每层档位由模型决定，提交前返回“暂不可估算”，与 5.0 Pro 一致。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 图片生成 API（参数、能力、响应） | https://docs.volcengine.com/docs/82379/1541523 | 否 |
| 文档正文 JSON | https://docs.volcengine.com/api/doc/getDocDetail?LibraryID=82379&DocumentID=1541523&type=online | 否 |
| 模型价格 | https://docs.volcengine.com/docs/82379/1544106 | 否 |
| 模型价格 Markdown 版（表格不错位） | https://docs.volcengine.com/docs/zh/ark/model-pricing.md | 否 |
| 模型列表（Model ID、限流） | https://docs.volcengine.com/docs/82379/1330310 | 否 |
| 官方发布博客（能力，无价格 / API） | https://seed.bytedance.com/zh/blog/生成更真实-百轮编辑更稳定-seedream-5-5-发布 | 否 |
