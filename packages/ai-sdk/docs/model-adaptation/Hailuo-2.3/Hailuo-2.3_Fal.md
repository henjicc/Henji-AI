# MiniMax Hailuo 2.3 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `fal-ai/minimax/hailuo-2.3/{standard,pro}/{text-to-video,image-to-video}`、`fal-ai/minimax/hailuo-2.3-fast/{standard,pro}/image-to-video` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`
- **队列提交**：`POST https://queue.fal.run/<endpoint-id>`
- **查询与结果**：`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）、`GET .../requests/{id}`
- **权威 schema 与价格**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 路由矩阵

| 输入与模式 | 档位 | endpoint ID | 时长 |
|---|---|---|---|
| 无图片；`fast` 开关无效 | Standard | `fal-ai/minimax/hailuo-2.3/standard/text-to-video` | 6 / 10 秒 |
| 无图片；`fast` 开关无效 | Pro | `fal-ai/minimax/hailuo-2.3/pro/text-to-video` | 固定 6 秒 |
| 有图片，关闭 `fast` | Standard | `fal-ai/minimax/hailuo-2.3/standard/image-to-video` | 6 / 10 秒 |
| 有图片，关闭 `fast` | Pro | `fal-ai/minimax/hailuo-2.3/pro/image-to-video` | 固定 6 秒 |
| 有图片，开启 `fast` | Standard | `fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video` | 6 / 10 秒 |
| 有图片，开启 `fast` | Pro | `fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video` | 固定 6 秒 |

**路由硬规则：没有图片时始终走 non-fast 文生视频端点。** `fast` 只存在于图生视频；不能因为界面开关为真，就把无图请求定价成 Fast，也不能拼出不存在的 Fast 文生视频路径。

## 3. 请求参数

| 字段 | 类型 | 适用端点 | 说明 |
|---|---|---|---|
| `prompt` | string | 全部 | 视频描述 |
| `duration` | string / integer | Standard | `6` / `10`；Pro 端点固定 6 秒，不发送该字段 |
| `prompt_optimizer` | boolean | 全部 | 是否优化提示词，默认开启 |
| `image_url` | string | 图生视频 | 首帧图 URL；图生视频端点必需 |

每次最多使用 1 张输入图。项目默认不展示、不请求 `seed`、负面提示词和 `output_format`。

## 4. 响应结构

```json
{
  "video": {
    "url": "https://v3b.fal.media/files/.../output.mp4"
  }
}
```

生成结果沿用 Fal 通用 `video.url` 解析、队列轮询、取消与 Fal CDN 上传链路。

## 5. 价格

来源：六个实际端点的实时 `llms.txt`（2026-08-30 读取）。Fal 按**每条生成视频**计费：

| 路由 | 6 秒 | 10 秒 |
|---|---:|---:|
| non-fast Standard · 文生 / 图生 | **$0.28 / 条** | **$0.56 / 条** |
| non-fast Pro · 文生 / 图生 | **$0.49 / 条** | 不支持 |
| Fast Standard · 仅图生 | **$0.19 / 条** | **$0.32 / 条** |
| Fast Pro · 仅图生 | **$0.33 / 条** | 不支持 |

计价必须先按“是否真的有图片”确定能否进入 Fast，再按 Standard / Pro 和时长选价。无图时即使 `fast=true`，仍使用 non-fast 的 `$0.28/$0.56` 或 `$0.49`。

## 6. 适配要点

- Fast 的正确路径是 `hailuo-2.3-fast/{standard,pro}/image-to-video`，不是 `hailuo-2.3/fast/...`。
- Standard 支持 6 / 10 秒；Pro 固定 6 秒，不能让 10 秒的界面值参与 Pro 计价。
- Fast 只有图生视频，路由与计价都必须读取三种实时图片字段：生成提交的 `uploadedFilePaths`、画布的 `images`、对话/工具面板的 `uploadedImages`。
- 模型的 Standard / Pro、Fast / non-fast 是 endpoint 级差异，不应在宿主层按模型 ID 另写请求或价格分支。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| non-fast Standard 文生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/text-to-video/llms.txt | 否 |
| non-fast Standard 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/image-to-video/llms.txt | 否 |
| non-fast Pro 文生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-2.3/pro/text-to-video/llms.txt | 否 |
| non-fast Pro 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-2.3/pro/image-to-video/llms.txt | 否 |
| Fast Standard 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video/llms.txt | 否 |
| Fast Pro 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video/llms.txt | 否 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
