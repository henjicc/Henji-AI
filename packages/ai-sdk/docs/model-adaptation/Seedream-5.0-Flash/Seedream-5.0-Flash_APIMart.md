# Seedream 5.0 Flash · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-seedream-5.0-flash`（通用标识 `seedream-5.0-flash`，与 `volcengine-seedream-5.0-flash` 相同） |
| 平台模型 ID | `seedream-5-0-flash` |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST /v1/images/generations` → `data[0].task_id`
- 查询：`GET /v1/tasks/{task_id}`，完成后读 `data.result.images[]`；链接有效 72 小时

## 2. 能力

单图模型：文生图、图生图、最多 10 张参考图融合；提示词内 `<point>` / `<bbox>` 坐标或手绘标记图做交互编辑。`n > 1`、`sequential_image_generation`、`stream`、`tools`、超过 10 张参考图直接 400。

## 3. 请求参数

| 字段 | 取值 | 说明 |
|---|---|---|
| `model` | `seedream-5-0-flash` | 必填 |
| `prompt` | string | 必填（图层拆分可省略） |
| `resolution` | `1K`（默认）/ `1.5K` / `2K` | 1.5K 与 1K 同价 |
| `size` | `auto` / `1:1` `4:3` `3:4` `16:9` `9:16` `3:2` `2:3` `2:1` `1:2` `21:9` / 精确像素 | 列表外比例返回 400；精确像素时忽略 `resolution` |
| `image_urls` | ≤ 10，公网 URL 或小写格式的 Data URI | 单张 ≤ 30 MB、宽高比 1/16–16 |
| `background` | `opaque` / `transparent` | 透明只用于恰好 1 张带透明通道输入图的图生图，且需 png；项目不请求 |
| `layer_decomposition` | boolean | 见第 4 节冲突说明；项目不接入 |
| `optimize_prompt_options` | `{ mode: "standard" }` | 项目不请求 |
| `output_format` | `jpeg` / `png` | 项目不请求 |
| `watermark` / `nsfw_check` | 默认 false | 项目不请求 |
| `n` | 只能 1 | 项目固定 1 |

1K 档像素：1:1 1024×1024、16:9 1312×736；1.5K：1:1 1536×1536、16:9 2048×1152；2K：1:1 2048×2048、16:9 2560×1440。

## 4. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) 图像区 `seedream-5-0-flash`（1 个价格档位）与 [Seedream 5.0 Flash 模型页](https://apimart.ai/zh/model/seedream-5-0-flash)（2026-11-07 读取，黄金价 = 当前价）。

| 规格 | 单价 |
|---|---|
| 1K / 1.5K / 2K | $0.01371 / 张（0.1371 Credits） |

模型页说明“所有尺寸（1K/1.5K/2K 或精确像素）统一单张价格，单价低于 Seedream 5.0 Pro”。

**文档冲突（保留不采纳）**：API 文档“计费说明”写 ≤ 2.61M 像素 $0.045 / 张、> 2.61M $0.09 / 张，并称第 2 张起参考图另计加价——这组数字与 Seedream 5.0 Pro 文档相同，定价中心与模型页都只给出统一 $0.01371，按“实时价格页优先于 API 文档正文”采用后者；参考图加价单价在定价中心没有列出，项目估价不含该项。API 文档描述了图层拆分，但模型页常见问题称“Pro 提供 Flash 不支持的图层拆分”，两处冲突且拆分无独立价格，项目暂不接入图层拆分。

## 5. 项目适配

- 参考 `apimart-seedream-5.0-lite` / `-pro` 结构，只保留比例与分辨率两个通用参数。
- 比例默认“智能”：按首图比例取最近支持比例，无图回退 `1:1`，始终发具体比例。
- 分辨率默认 1.5K（与 1K 同价、画质更好）。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| API 文档 | https://docs.apimart.ai/cn/api-reference/images/seedream-5-0-flash/generation | 否 |
| 模型页（价格、与 Pro / Lite 的区别） | https://apimart.ai/zh/model/seedream-5-0-flash | 否 |
| 定价中心 | https://apimart.ai/zh/pricing | 否 |
