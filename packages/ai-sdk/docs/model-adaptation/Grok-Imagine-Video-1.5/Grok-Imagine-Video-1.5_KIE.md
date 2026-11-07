# Grok Imagine Video 1.5 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 项目模型 | `kie-grok-imagine-video-1.5`，通用标识 `grok-imagine-video-1.5` |
| model ID | `grok-imagine-video-1-5-preview`（预览版） |
| 文档与价格 | 公开，无需登录 |
| 定价（每秒） | 480p $0.012、720p $0.0225（输出始终带同步音频） |

## 请求契约

`POST https://api.kie.ai/api/v1/jobs/createTask`，`{model,input}`。

| input 字段 | 值与约束 | 项目处理 |
|---|---|---|
| prompt | ≤4096；可用 `@image1` 指代参考图 | 统一提示词，英文效果最佳 |
| image_urls | **schema 必填**，最多 1 张；jpeg/png/webp，≤20MB | 要求上传 1 张图 |
| aspect_ratio | auto（默认）、1:1、16:9、9:16、4:3、3:4、3:2、2:3 | 展示 |
| resolution | 480p（默认）、720p、1080p | 价格页只有 480p/720p，1080p 无公开价格，不开放 |
| duration | 1–15 秒，默认 8 | 数字输入 |
| first_frame_url / last_frame_url / loop_url / keyframes（≤4） | 首帧、尾帧、循环、带时间戳的中间关键帧 | 与必填的 image_urls 关系文档未说明，本轮不显示、不请求 |
| enable_audio | 文档字段写默认 true，但页面说明“音频无法关闭” | 不显示、不请求 |
| nsfw_checker | 可选 | 不发送 |

页面摘要写“文生视频任务”，但 schema 把 `image_urls` 列为必填。项目以 schema 为准，只标图生视频；若后续确认可纯文生视频，再放开图片要求并补 `text-to-video` 标签。

## 事件与失败契约

沿用 [KIE 供应商文档](../供应商/KIE.md) 第 2 节 Market 统一任务契约。官方请求 schema 见 `tests/fixtures/model-requests-2026-11/kie-grok-imagine-video-1.5.json`；未做付费真网验收。

## 原始链接索引

均公开，无需登录：
- [Grok Imagine Video 1.5 Preview](https://docs.kie.ai/market/grok-imagine/1-5-preview.md)
- [模型页](https://kie.ai/grok-imagine-video-1.5)
- [实时价格页](https://kie.ai/pricing)（2026-11-07 核对 480p/720p 两行价格）
