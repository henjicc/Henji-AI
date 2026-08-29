# MiniMax H3 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `minimax/h3/text-to-video`、`minimax/h3/image-to-video`、`minimax/h3/reference-to-video` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`；**队列**：`POST https://queue.fal.run/<endpoint-id>`，`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）、`GET .../requests/{id}`
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单

| 能力 | endpoint id |
|---|---|
| 文生视频 | `minimax/h3/text-to-video` |
| 图生视频（首帧 / 首尾帧） | `minimax/h3/image-to-video` |
| 参考生视频（图 + 视频 + 音频） | `minimax/h3/reference-to-video` |

## 3. 请求参数

### 3.1 三个端点共有

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 必填 | — | 视频描述。`reference-to-video` 中用 **`Image 1` / `Video 1` / `Audio 1`** 按模态与顺序引用素材 |
| `duration` | integer | 可选 | `5` | **5 ~ 15**（**注意下限是 5，不是 4**；APIMart / KIE 都是 4） |
| `resolution` | string | 可选 | **`2K`** | `480P` / `768P` / `2K` / `4K`。**`480P` 与 `768P` 是原生生成；`2K` 与 `4K` 是在 768P 基础上超分** |
| `seed` | integer | 可选 | 随机 | **本项目规则：绝对不显示**，不下发 |
| `enable_prompt_expansion` | boolean | 可选 | **`true`** | 生成前用视觉语言模型扩写提示词 |
| `enable_safety_checker` | boolean | 可选 | `true` | 安全检查 |
| `prompt_expansion_mode` | string | 可选 | `balanced` | `fast`（fal 自家扩写，约 1 s）/ `quality`（**始终用 MiniMax 的 H3-Context-IR，约 30 s**）/ `balanced`（参考生视频、以及 5 秒以上的图生视频（480P 除外）用 H3-Context-IR；所有文生视频用 fal 自家扩写） |

### 3.2 仅 `text-to-video` 与 `reference-to-video`

| 字段 | 类型 | 默认 | 取值 |
|---|---|---|---|
| `aspect_ratio` | string | 文生 **`16:9`**；参考 **`adaptive`** | 文生：`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`（**无 `adaptive`**）；参考：另含 `adaptive` |

### 3.3 仅 `image-to-video`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_url` | string | 可选 | 首帧图 URL。**提供时输出比例跟随该图**；**省略时该请求按文生视频处理（默认 16:9）** |
| `end_image_url` | string | 可选 | 尾帧图 URL，用于首尾帧生成 |

> 该端点**没有 `aspect_ratio`**。

### 3.4 仅 `reference-to-video`

| 字段 | 类型 | 说明 |
|---|---|---|
| `reference_image_urls` | string[] | 主体 / 风格参考图，prompt 中以 `Image 1`、`Image 2` 引用 |
| `reference_video_urls` | string[] | 运动 / 参考视频片段，单段 2–15 s，合计 ≤ 15 s，prompt 中以 `Video 1` 引用 |
| `reference_audio_urls` | string[] | 参考音频，单段 2–15 s，合计 ≤ 15 s，prompt 中以 `Audio 1` 引用。**音频不能是唯一的参考输入，必须至少配一张参考图或一个参考视频** |

> **参考图 / 视频 / 音频合计最多 12 个文件。**

## 4. 响应结构

```json
{ "video": { "url": "https://v3b.fal.media/files/.../output.mp4" },
  "expanded_prompt": "（扩写后实际下发给模型的提示词）" }
```

`expanded_prompt` 是可选字段：当提示词扩写被关闭、扩写未改动提示词、或扩写由 MiniMax 托管 API 内部完成时为 `null`。

## 5. 价格

来源：三个端点的 `llms.txt`（2026-08-30 重新读取）。本次核价确认四档视频秒价及参考图加价规则均如下，静态估价应先按时长乘秒价，再追加超过 5 张的参考图费用。

| 分辨率 | 单价 |
|---|---|
| 480p | **$0.05 / 秒** |
| 768p | **$0.06 / 秒** |
| 2K | **$0.13 / 秒** |
| 4K | **$0.16 / 秒** |

`reference-to-video` 额外：**前 5 张参考图免费，之后每张 $0.08**；这笔参考图费用按张追加一次，不再乘视频时长。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 本端点**有 `seed`**（不下发），无负面提示词。
- **`duration` 下限是 5**（APIMart / KIE 是 4），跨供应商的时长选项要按供应商裁剪。
- **Fal 独有 `480P` 与 `4K` 档位**（APIMart / KIE 只有 768P / 2K）；且文档明确 2K/4K 是 768P 超分而非原生。
- `prompt_expansion_mode` 是 Fal 独有的封装：`quality` 相当于自动帮你调了 Context-IR，省去 APIMart 上手动两步。默认 `balanced` 会按端点与时长自动切换，行为不完全可预测——若要结果稳定应显式指定。
- `image-to-video` 的 `image_url` **是可选的**，不传会静默退化成文生视频，参数校验要覆盖。
- 比例参数只在文生视频与参考生视频显示；图生视频端点没有 `aspect_ratio`，输出比例跟随输入图。
- 三种输入形态是三个独立 endpoint，需要路由。
- 路由、请求与计价必须共用同一套图片来源解析，兼容生成提交的 `uploadedFilePaths`、画布的 `images` 与对话面板的 `uploadedImages`，并忽略空值。
- `reference-to-video` 的素材在 prompt 中用 `Image 1` / `Video 1` / `Audio 1` 引用（**注意与 Seedance 的 `@Image1` 写法不同**）。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 schema + 价格 | https://fal.ai/models/minimax/h3/text-to-video/llms.txt | 否 |
| 图生视频 schema + 价格 | https://fal.ai/models/minimax/h3/image-to-video/llms.txt | 否 |
| 参考生视频 schema + 价格 | https://fal.ai/models/minimax/h3/reference-to-video/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
