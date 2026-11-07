# Kling 4.0 Flash · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 项目模型 | `kie-kling-4.0-flash`，通用标识 `kling-video-4.0-flash` |
| model ID | `kling-4.0/flash-keyframe-to-video`、`kling-4.0/flash-reference-to-video` |
| 文档与价格 | 公开，无需登录 |
| 定价（每秒） | 首帧/无视频参考 720p $0.085；带参考视频 720p $0.0565 |

## 与标准版的差异

请求结构与 [Kling 4.0](../Kling-4.0/Kling-4.0_KIE.md) 相同，差别：

| 项目 | Flash |
|---|---|
| resolution | 只有 720p（项目不显示分辨率，固定发送 720p） |
| duration | 3–20 秒 |
| keyframe | 只接受 `first_frame_url`；发送中间帧或尾帧会被拒绝，项目限制最多 1 张图 |
| keyframe aspect_ratio | 16:9、9:16、1:1、21:9，没有 auto；有首帧时跟随首帧（项目不发送） |
| reference | 不支持独立 `voices`；参考视频与视频主体总时长须在 2–20 秒，否则任务失败 |

elements 同样需要结构化编辑界面，本轮不显示、不请求。事件契约沿用 KIE Market 统一任务。

## 原始链接索引

均公开，无需登录：
- [Flash Keyframe To Video](https://docs.kie.ai/market/kling/v4-flash-keyframe-to-video.md)
- [Flash Reference To Video](https://docs.kie.ai/market/kling/v4-flash-reference-to-video.md)
- [模型页](https://kie.ai/kling-4-0-flash)
- [实时价格页](https://kie.ai/pricing)（2026-11-07 核对 3 行 kling 4.0 flash 价格）
