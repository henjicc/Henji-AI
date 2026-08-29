# MiniMax Hailuo 02 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `fal-ai/minimax/hailuo-02/{standard,pro}/{text-to-video,image-to-video}`、`fal-ai/minimax/hailuo-02-fast/image-to-video` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`
- **队列提交**：`POST https://queue.fal.run/<endpoint-id>`
- **查询与结果**：`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）、`GET .../requests/{id}`
- **权威 schema 与价格**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 路由矩阵与优先级

| 输入与模式 | endpoint ID | 分辨率 | 时长 |
|---|---|---|---|
| 无图片，Standard | `fal-ai/minimax/hailuo-02/standard/text-to-video` | 端点不接收 `resolution`（按官方 `$0.045/秒` 计价） | 6 / 10 秒 |
| 无图片，Pro | `fal-ai/minimax/hailuo-02/pro/text-to-video` | 固定 1080P | 固定 6 秒 |
| 1 张图片且开启 Fast；版本选择不参与路由 | `fal-ai/minimax/hailuo-02-fast/image-to-video` | 固定 512P | 6 / 10 秒 |
| 1～2 张图片、关闭 Fast、Standard | `fal-ai/minimax/hailuo-02/standard/image-to-video` | 512P / 768P | 6 / 10 秒 |
| 1～2 张图片、关闭 Fast、Pro | `fal-ai/minimax/hailuo-02/pro/image-to-video` | 固定 1080P | 固定 6 秒 |

路由判定顺序：

1. 无图时按 Standard / Pro 选择文生视频，Fast 开关无效。
2. 恰有 1 张图且开启 Fast 时，**Fast 路由优先于版本选择**，统一进入 `hailuo-02-fast/image-to-video`。
3. 其余图生请求再按 Standard / Pro 选择 non-fast 端点；2 张图的首尾帧请求不能进入 Fast。

## 3. 请求参数

| 字段 | 类型 | 适用端点 | 说明 |
|---|---|---|---|
| `prompt` | string | 全部 | 视频描述 |
| `duration` | string / integer | Standard 与 Fast | `6` / `10`；只有 non-fast Pro 固定 6 秒且不发送该字段，单图 + Fast 即使版本值残留为 Pro 也仍发送 |
| `resolution` | string | non-fast Standard 图生视频 | `512P` / `768P`；Fast 固定 512P，Pro 固定 1080P |
| `prompt_optimizer` | boolean | 全部 | 是否优化提示词，默认开启 |
| `image_url` | string | 图生视频 | 首帧图 URL |
| `end_image_url` | string | non-fast 图生视频 | 可选尾帧图；提供后形成首尾帧生成 |

Fast 最多接受 1 张图；non-fast 图生视频最多接受首帧、尾帧共 2 张。项目默认不展示、不请求 `seed`、负面提示词和 `output_format`。

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

来源：五个实际端点的实时 `llms.txt`（2026-08-30 读取）。除 Pro 固定 6 秒外，其余按生成视频秒数计费：

| 路由 / 档位 | 单价 | 6 秒 | 10 秒 |
|---|---:|---:|---:|
| Fast 图生视频 · 固定 512P | **$0.017 / 秒** | **$0.102** | **$0.17** |
| non-fast Standard · 图生视频 512P | **$0.017 / 秒** | **$0.102** | **$0.17** |
| non-fast Standard · 文生（端点无分辨率参数）/ 图生 768P | **$0.045 / 秒** | **$0.27** | **$0.45** |
| non-fast Pro · 固定 1080P、固定 6 秒 | **$0.08 / 秒** | **$0.48 / 条** | 不支持 |

**Fast 计价同样优先于版本。** 只要实际请求满足“1 张图 + Fast”，就应按 512P `$0.017/秒` 计算，不能因为界面仍保留 Pro 值而误算成 `$0.48/条`。无图时则不能套用 Fast 价格。

## 6. 适配要点

- Fast endpoint 不带 Standard / Pro 子路径；版本值在 Fast 路由和价格中都不生效。
- Standard 文生视频端点不接收 `resolution`；即使界面参数残留为 512P，也必须按该端点的 `$0.045/秒` 计价。
- non-fast Pro 不接受时长与分辨率选择，固定 1080P、6 秒；单图 + Fast 优先后属于 Fast 路由，仍按选择发送 6 / 10 秒 `duration`。
- 图片存在性影响路由和计价，必须同时读取生成提交的 `uploadedFilePaths`、画布的 `images`、对话/工具面板的 `uploadedImages`。
- Standard 512P 与 Fast 512P 单价相同，但 endpoint、输入上限和首尾帧能力不同，不能只凭价格合并路由。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Standard 文生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/text-to-video/llms.txt | 否 |
| Standard 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/image-to-video/llms.txt | 否 |
| Pro 文生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-02/pro/text-to-video/llms.txt | 否 |
| Pro 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-02/pro/image-to-video/llms.txt | 否 |
| Fast 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/minimax/hailuo-02-fast/image-to-video/llms.txt | 否 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
