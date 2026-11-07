# Wan 3.0 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 项目模型 | `kie-wan-3.0`，通用标识 `wan-3.0`；Prime 见 [Wan-3.0-Prime_KIE.md](../Wan-3.0-Prime/Wan-3.0-Prime_KIE.md) |
| model ID | `wan/3-0-video` |
| 文档与价格 | 公开，无需登录 |
| 定价（每秒，按输出时长） | 480p $0.04、720p $0.08、1080p $0.16 |

## 请求契约

`POST https://api.kie.ai/api/v1/jobs/createTask`，`{model,input}`，单一端点。项目用显式模式区分“首尾帧”和“全能参考”，因为两组字段官方规定互斥。

| input 字段 | 值与约束 | 项目处理 |
|---|---|---|
| prompt | ≤20000；文生视频必填，其他模式建议填；参考模式用 Image1/Video1/Audio1 指代 | 有内容才发送 |
| first_frame_url / last_frame_url | 各 1 张；JPEG/PNG(不含透明)/BMP/WEBP；与 reference_* 互斥 | 文/图生视频模式：第 1 张首帧、第 2 张尾帧 |
| reference_image_urls | ≤10 张 | 参考模式 |
| reference_video_urls | ≤5 段，每段 1–15 秒、合计 ≤15 秒；mp4/mov，≤100MB；参考视频时长 + duration ≤ 30 | 参考模式（时长组合由服务端校验） |
| reference_audio_urls | ≤5 段，每段 1–15 秒、合计 ≤15 秒；wav/mp3，≤15MB；可单独作为输入 | 参考模式 |
| reference_file_urls / reference_link_urls | 文档或网页生成视频 | 本轮不显示、不请求 |
| resolution | 480P / 720P / 1080P，默认 1080P | 界面小写，请求转大写；应用默认 720p |
| aspect_ratio | adaptive（默认）、16:9、4:3、1:1、3:4、9:16 | 直接展示 adaptive |
| duration | 无视频输入 2–30，默认 5；`-1` 为模型自定时长 | 下拉 2–30；`-1` 无法预估价格，不开放 |
| audio | 是否带音轨，默认 true | 开关 |
| seed / nsfw_checker | 可选 | 不显示、不请求 |

## 事件与失败契约

沿用 [KIE 供应商文档](../供应商/KIE.md) 第 2 节 Market 统一任务契约，未引入新轮询或解析分支。官方请求 schema 见 `tests/fixtures/model-requests-2026-11/kie-wan-3.0.json`；未做付费真网验收。

## 原始链接索引

均公开，无需登录：
- [Wan 3.0 Video](https://docs.kie.ai/market/wan/3-0-video.md)
- [模型页](https://kie.ai/wan3.0-video)
- [实时价格页](https://kie.ai/pricing)（2026-11-07 核对 3 行 wan 3.0 video 价格）
