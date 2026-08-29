# Seedream 5.0 Pro · 火山引擎（火山方舟，官方）

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 图片 |
| 供应商 | 火山引擎 · 火山方舟（Ark），模型原厂官方接口 |
| 平台模型 ID | `doubao-seedream-5-0-pro-260628`（也可用推理接入点 Endpoint ID 调用） |
| 接口形态 | **同步**（一次 POST 直接返回图片），可选流式（本模型不支持流式） |
| 文档可见性 | 公开，无需登录即可阅读；调用需 API Key |
| 价格可见性 | 公开，无需登录 |
| 官方文档最后更新 | 2026-08-12（文档站 `UpdatedTime`） |

## 1. 接入协议

- **接口**：`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`
- **鉴权**：`Authorization: Bearer $ARK_API_KEY`（长效 API Key，在方舟控制台「API Key 管理」获取）
- **调用方式**：同步返回，无任务轮询。请求体 `Content-Type: application/json`
- **结果时效**：`response_format=url` 时返回的图片链接 **24 小时内有效**，必须及时转存

最小请求：

```bash
curl https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "doubao-seedream-5-0-pro-260628",
    "prompt": "赛博朋克风格的城市夜景，霓虹灯反射在湿润街道上",
    "size": "2K"
  }'
```

## 2. 能力清单（官方明确列出，勿遗漏）

| 能力 | 说明 | 触发方式 |
|---|---|---|
| 文生图 | 纯提示词生成单张图 | 不传 `image` |
| 单图生图 | 1 张参考图 + 提示词 | `image` 传 1 张 |
| 多图生图 | 2–10 张参考图 + 提示词，生成单张 | `image` 传数组，2–10 张 |
| 交互编辑 | 提示词中用坐标 / 框选 / 箭头指定编辑位置 | 在 `prompt` 中写 `<point>`/`<bbox>` 或上传带手绘标记的图 |
| 图层拆分 | 单图拆成 1 张底图 + 最多 16 个透明 PNG 图层，返回层序/名称/描述/边界框 | `layer_decomposition: true` + 恰好 1 张 `image` |

**Pro 明确不支持**：组图生成（`sequential_image_generation`）、联网搜索（`tools`）、流式输出（`stream`）。这三项只属于 Seedream 5.0 lite / 4.5 / 4.0。

## 3. 请求参数（Body）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必选 | — | `doubao-seedream-5-0-pro-260628`，或推理接入点 Endpoint ID |
| `prompt` | string | 图片生成场景必选；图层拆分场景可选 | — | 生成描述或拆分意图。支持中英文，Pro 额外支持俄/阿/菲/泰/土/韩/马来/西/葡/印尼/法/德/越/日语。建议中文 ≤ 300 字、英文 ≤ 600 词。图层拆分不传时模型自动识别全部主要元素 |
| `image` | string / string[] | 图片生成可选；图层拆分必选 | — | 参考图，URL 或 `data:image/<格式小写>;base64,<编码>`。Pro **最多 10 张** |
| `layer_decomposition` | boolean | 可选 | `false` | 图层拆分开关。`true` 时仅支持单张输入图；任一图层失败则整体报错，不支持部分成功 |
| `size` | string | 可选 | 生成场景 `2K`；图层拆分场景 `auto` | 见下方「size 取值」 |
| `optimize_prompt_options` | object | 可选 | `{"mode":"standard"}` | `mode`：`standard`（质量优先）/ `fast`（低时延） |
| `output_format` | string | 可选 | `jpeg` | `png` / `jpeg`。图层拆分时仅控制**底图**格式，图层恒为 PNG |
| `background` | string | 可选 | `opaque` | `opaque` / `transparent`。透明背景仅支持图生图，且只能传 **1 张本身带透明通道**的图；此时输出默认 png，若同时设 `output_format: jpeg` 会报错 |
| `response_format` | string | 可选 | `url` | `url`（24 小时有效）/ `b64_json` |
| `watermark` | boolean | 可选 | **`true`** | 是否在右下角加「AI 生成」水印。注意官方默认是 `true`，接入时通常要显式传 `false` |
| `sequential_image_generation` | string | — | — | **Pro 不支持**，仅 lite / 4.5 / 4.0 |
| `sequential_image_generation_options` | object | — | — | **Pro 不支持** |
| `stream` | boolean | — | — | **Pro 不支持** |
| `tools` | object[] | — | — | **Pro 不支持**（`web_search` 仅 lite 支持） |

### size 取值

**图片生成场景**，两种写法不可混用：

- 方式 1（推荐）：分辨率档位 `1K` / `1.5K` / `2K`，默认 `2K`；宽高比在 prompt 中用自然语言描述，由模型判断。**`1.5K` 与 `1K` 同价且效果更好**。
- 方式 2：精确像素 `宽x高`。总像素范围 `[921600 (1280×720), 4624220 (2048×2048×1.1025)]`，宽高比范围 `[1/16, 16]`；两个条件需同时满足。有效示例 `2048x1024`；无效示例 `512x512`（总像素不足）。

档位 → 常见宽高像素映射（官方给出的参考值，非穷举）：

| 分辨率 | 1:1 | 4:3 | 3:4 | 16:9 | 9:16 | 3:2 | 2:3 | 21:9 |
|---|---|---|---|---|---|---|---|---|
| 1K | 1024×1024 | 1152×864 | 864×1152 | 1424×800 | 800×1424 | 1248×832 | 832×1248 | 1568×672 |
| 1.5K | 1536×1536 | 1792×1344 | 1344×1792 | 2048×1152 | 1152×2048 | 1872×1248 | 1248×1872 | 2352×1008 |
| 2K | 2048×2048 | 2368×1776 | 1776×2368 | 2816×1584 | 1584×2816 | 2496×1664 | 1664×2496 | 3136×1344 |

**图层拆分场景**：只支持档位写法，可选 `1K` / `1.5K` / `2K` / `auto`（默认 `auto`）。底图分辨率与 `size` 一致且保持原图宽高比；各图层分辨率接近 `size`，各自保持在原图中的宽高比。`auto` 规则：原始尺寸落在 `[921600, 4624220]` 内按原尺寸输出；小于 1K 按 1K；大于 2K 按 2K。

### 输入图片限制

- 图片生成场景：格式 jpeg/png/webp/bmp/tiff/gif/heic/heif；宽高比 `[1/16, 16]`；单边 > 14 px；≤ 30 MB；总像素 `[196, 36000000]`
- 图层拆分场景：格式仅 png/jpeg；宽高比 `[1/16, 16]`；≤ 30 MB；总像素 `[262144 (512×512), 36000000]`

## 4. 响应结构

顶层：`created`（Unix 秒）、`model`、`data[]`、`error`、`tools[]`、`usage`。

`data[]` 公共字段：`url`（`response_format=url` 时）、`b64_json`（`response_format=b64_json` 时）、`size`（`<宽>x<高>`）、`output_format`。

**图层拆分场景** `data[]` 额外返回：

| 字段 | 说明 |
|---|---|
| `z_index` | 叠放顺序。底图固定 `0`，图层从 `1` 递增，越大越靠上 |
| `name` | 模型自动生成的图层名称/标签 |
| `description` | 图层的语义描述（颜色、状态、材质等） |
| `bounding_box.absolute` | `[left, top, right, bottom]` 绝对像素坐标，底图左上角为 `(0,0)`。还原：`x=left`、`y=top`、`w=right-left`、`h=bottom-top` |
| `bounding_box.normalized` | 同格式，归一化到 `[0, 1000]` 整数。还原到 `W×H` 画布：`x=left/1000×W`、`w=(right-left)/1000×W`，依此类推 |

底图覆盖整张画布，不返回 `bounding_box`。多图层按 `z_index` 从小到大叠放。

## 5. 价格（官方，人民币）

来源：火山方舟「模型价格」文档（`DocumentID=1544106`，更新于 2026-08-20）。

| 模型 | 输入图 | 输出 |
|---|---|---|
| `doubao-seedream-5-0-pro` | 首张免费，第 2 张起 **0.02 元/张** | **单图生成**：≤ 261 万像素（1.5K 及以下）**0.30 元/张**；> 261 万像素（1.5K 以上）**0.60 元/张**<br>**图层拆分**：≤ 261 万像素 **0.15 元/张**；> 261 万像素 **0.30 元/张** |

计费提醒（官方原文）：图层拆分场景，同一次请求输出的图层可能分别落在不同像素档位，**按每个图层实际像素档位单独计费**。

## 6. 适配要点

- 本项目默认**绝对不显示**的参数：随机种子 `seed`、负面提示词。官方本接口本身也没有 `seed` / 负面提示词字段。
- `watermark` 官方默认 `true`，与本项目预期相反，**必须显式传 `false`**。
- `output_format` 按项目约定默认不显示、不请求。
- 普通生成与图层拆分的返回结构不同（图层拆分返回一组图 + 层信息），不能按单图 URL 直接解析，需作为独立能力分支处理。
- 图层拆分在提交前无法知道模型最终会输出多少层，且各层可能落入不同像素档位；价格面板不能把“单层价格”冒充确定总价，图层模式应显示为暂不可估算，并在说明中保留 **0.15 / 0.30 元每输出图层**的官方单位价。
- 价格计算依赖参考图数量时，必须同时识别生成提交、画布和对话/工具面板的三套媒体字段，避免空的本地路径数组遮蔽实时图片数组。
- Pro 为单图模型，不要下发 `n`、`sequential_image_generation`、`stream`、`tools`。
- 官方限流：模型列表文档标注 Pro 的限流值为 500（单位见官方页面）。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 图片生成 API（参数、能力、响应全量） | https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh | 否（正文公开；调用需 API Key） |
| 同一文档的公开镜像 | https://www.volcengine.com/docs/82379/1541523 | 否 |
| 文档正文 JSON（含 Markdown 全文与更新时间） | https://docs.volcengine.com/api/doc/getDocDetail?LibraryID=82379&DocumentID=1541523&type=online | 否 |
| 模型价格 | https://www.volcengine.com/docs/82379/1544106 | 否 |
| 模型列表（Model ID、限流、支持能力） | https://www.volcengine.com/docs/82379/1330310 | 否 |
| Base URL 及鉴权 | https://docs.volcengine.com/docs/82379/1298459 | 否 |
| Seedream 4.0–5.0 提示词指南 | https://www.volcengine.com/docs/82379/1829186 | 否 |
| API Key 管理 | https://console.volcengine.com/ark/region:cn-beijing/apiKey | **是** |
