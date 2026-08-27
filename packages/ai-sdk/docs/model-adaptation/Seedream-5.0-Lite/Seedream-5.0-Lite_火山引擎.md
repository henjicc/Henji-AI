# Seedream 5.0 Lite · 火山引擎（火山方舟，官方）

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | 火山引擎 · 火山方舟（Ark），模型原厂官方接口 |
| 平台模型 ID | `doubao-seedream-5-0-260128`（同时支持写作 `doubao-seedream-5-0-lite-260128`） |
| 接口形态 | **同步**，可选流式（`stream: true`） |
| 文档可见性 | 公开，无需登录；调用需 API Key |
| 价格可见性 | 公开，无需登录 |
| 官方文档最后更新 | 2026-08-12 |

## 1. 接入协议

与 Seedream 5.0 Pro 共用同一个接口：

- **接口**：`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`
- **鉴权**：`Authorization: Bearer $ARK_API_KEY`
- **结果时效**：`response_format=url` 返回的链接 **24 小时内有效**

## 2. 能力清单（与 Pro 差异很大，勿混）

| 能力 | 说明 | 触发方式 |
|---|---|---|
| 文生图 | 单图 | 不传 `image`，`sequential_image_generation: disabled` |
| 单图生图 | 1 张参考图 | `image` 传 1 张 |
| 多图生图 | **2–14 张**参考图 → 单图 | `image` 传数组 |
| 文生组图 | 最多 15 张 | `sequential_image_generation: "auto"` |
| 单图生组图 | 最多 14 张 | 1 张 `image` + `auto` |
| 多图生组图 | 输入参考图数 + 生成图数 ≤ 15 | 多张 `image` + `auto` |
| 流式输出 | 每张图生成完即时返回 | `stream: true` |
| 联网搜索 | 模型自主判断是否搜索互联网内容 | `tools: [{ "type": "web_search" }]` |

**Lite 不支持**：图层拆分（`layer_decomposition`）、透明背景（`background`）——这两项是 Pro 独有。

## 3. 请求参数（Body）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必选 | — | `doubao-seedream-5-0-260128` |
| `prompt` | string | 必选 | — | 支持中英文。建议中文 ≤ 300 字、英文 ≤ 600 词 |
| `image` | string / string[] | 可选 | — | 参考图，URL 或 `data:image/<小写格式>;base64,<编码>`。Lite **最多 14 张** |
| `size` | string | 可选 | 方式 2 下为 `2048x2048` | 见下 |
| `optimize_prompt_options.mode` | string | 可选 | `standard` | `standard`；**Lite 当前不支持 `fast`** |
| `output_format` | string | 可选 | `jpeg` | `png` / `jpeg` |
| `response_format` | string | 可选 | `url` | `url`（24 小时有效）/ `b64_json` |
| `sequential_image_generation` | string | 可选 | `disabled` | `disabled` / `auto`（组图） |
| `sequential_image_generation_options.max_images` | integer | 可选 | `15` | 取值 `[1, 15]`。**输入参考图数 + 最终生成数 ≤ 15** |
| `stream` | boolean | 可选 | `false` | 流式输出 |
| `tools[].type` | string | 可选 | — | `web_search`；实际搜索次数见 `usage.tool_usage.web_search` |
| `watermark` | boolean | 可选 | **`true`** | 官方默认加「AI 生成」水印，需要关闭必须显式传 `false` |

### size 取值（两种方式不可混用）

- 方式 1：分辨率档位 `2K` / `3K` / `4K`，宽高比由 prompt 自然语言描述后模型判断。**Lite 没有 1K / 1.5K 档。**
- 方式 2：精确像素 `宽x高`，默认 `2048x2048`。总像素范围 `[3686400 (2560×1440), 16777216 (4096×4096)]`，宽高比 `[1/16, 16]`，两个条件需同时满足。有效示例 `3750x1250`；无效示例 `1500x1500`（总像素不足）。

档位 → 宽高像素映射（官方参考值）：

| 分辨率 | 1:1 | 4:3 | 3:4 | 16:9 | 9:16 | 3:2 | 2:3 | 21:9 |
|---|---|---|---|---|---|---|---|---|
| 2K | 2048×2048 | 2304×1728 | 1728×2304 | 2848×1600 | 1600×2848 | 2496×1664 | 1664×2496 | 3136×1344 |
| 3K | 3072×3072 | 3456×2592 | 2592×3456 | 4096×2304 | 2304×4096 | 3744×2496 | 2496×3744 | 4704×2016 |
| 4K | 4096×4096 | 4704×3520 | 3520×4704 | 5504×3040 | 3040×5504 | 4992×3328 | 3328×4992 | 6240×2656 |

### 输入图片限制

格式 jpeg/png/webp/bmp/tiff/gif/heic/heif；宽高比 `[1/16, 16]`；单边 > 14 px；≤ 30 MB；总像素 `[196, 36000000]`。

## 4. 响应结构

顶层 `created` / `model` / `data[]` / `error` / `tools[]` / `usage`。`data[]` 含 `url` 或 `b64_json`、`size`、`output_format`。

**组图场景**：某张图失败时该元素额外返回 `data[].error`，其他图不受影响。官方说明：若失败原因是审核不通过，会继续生成后续图片；若是内部服务异常（500），不再继续。

流式响应的事件结构见「图片生成流式响应事件」文档。

## 5. 价格（官方，人民币）

来源：火山方舟「模型价格」（更新于 2026-08-20）。

| 模型 | 输入图 | 输出 |
|---|---|---|
| `doubao-seedream-5-0-lite` | 免费 | **0.22 元/张** |

组图场景按**实际生成的图片数量**计费。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。官方接口无这两个字段。
- `watermark` 官方默认 `true`，必须显式传 `false`。
- `output_format` 默认不显示、不请求。
- Lite 的分辨率档位是 **2K/3K/4K**，与 Pro 的 1K/1.5K/2K 完全不同，比例与档位映射也不同，不能共用一套映射表。
- 组图能力会改变返回数量与计费，若产品要开放，需要在 UI 上明确「输入参考图数 + 生成数 ≤ 15」的约束。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 图片生成 API（Pro/Lite/4.5/4.0 合并文档） | https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh | 否 |
| 公开镜像 | https://www.volcengine.com/docs/82379/1541523 | 否 |
| 图片生成流式响应事件 | https://www.volcengine.com/docs/82379/1824137 | 否 |
| 模型价格 | https://www.volcengine.com/docs/82379/1544106 | 否 |
| 模型列表（Model ID / 限流 / 能力） | https://www.volcengine.com/docs/82379/1330310 | 否 |
| Seedream 图像创作教程（组图、流式示例） | https://www.volcengine.com/docs/82379/1824121 | 否 |
| API Key 管理 | https://console.volcengine.com/ark/region:cn-beijing/apiKey | **是** |
