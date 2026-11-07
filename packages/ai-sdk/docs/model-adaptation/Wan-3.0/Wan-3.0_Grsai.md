# Wan 3.0 · Grsai

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-08 |
| 项目模型 | `grsai-wan-3.0`，通用标识 `wan-3.0`（Grsai 第一个视频模型） |
| 平台 model | `wan-3.0`，模型列表标注“官方直连” |
| 文档与价格 | 公开，无需登录 |
| 定价（按秒） | 480p 3300、720p 6600、1080p 13200 积分/秒；基础充值档（1 积分 ≈ ¥0.0001）为 ¥0.33/¥0.66/¥1.32 每秒，模型列表按“积分/20000”给出的高额档参考价为 ¥0.165/¥0.33/¥0.66 |

## 请求契约

沿用 [Grsai 供应商文档](../供应商/Grsai.md) 的 `POST /v1/api/generate` + `GET /v1/api/result` 异步轮询（结果同在 `results[].url`），provider 发送边界统一补 `replyType: "async"`。

| 字段 | 值与约束 | 项目处理 |
|---|---|---|
| model | `wan-3.0`，必填 | 固定 |
| prompt | 必填 | 统一提示词 |
| aspectRatio | 必填：16:9、9:16、21:9、4:3、1:1、3:4 | 智能比例本地转具体值 |
| resolution | 必填：480p / 720p / 1080p | 展示，默认 720p |
| duration | 必填：文档写 2–30 秒，接口实际要求大于 2 秒（2026-11-08 实调 2 秒返回 “duration must be greater than 2 seconds”） | 下拉 3–30 |
| images | 参考图，base64 或 URL，≤10 张；与首尾帧互斥 | 参考模式 |
| audios | 参考音频，base64 或 URL，≤5 段、每段 ≤15 秒；与首尾帧互斥 | 参考模式 |
| firstFrame / lastFrame | 首帧、尾帧图片；与 images、audios 互斥 | 文/图生视频模式 |
| seed | 可选 | 不显示、不请求 |

模型列表说明“参考视频正在兼容中”，接口也没有参考视频字段，本轮不开放视频输入。

## 原始链接索引

均公开，无需登录：
- [wan-video 接口](https://qmy27nhsd9.apifox.cn/531060669e0.md)
- [异步生成结果查询接口](https://qmy27nhsd9.apifox.cn/452409577e0)
- [模型列表与价格](https://grsai.com/zh/dashboard/models)
- [充值档位](https://grsai.com/zh/dashboard/billing)
