# Kling 4.0 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 项目模型 | `kie-kling-4.0`，通用标识 `kling-video-4.0`；Flash 见 [Kling-4.0-Flash_KIE.md](../Kling-4.0-Flash/Kling-4.0-Flash_KIE.md) |
| model ID | `kling-4.0/keyframe-to-video`、`kling-4.0/reference-to-video` |
| 文档与价格 | 公开，无需登录 |
| 定价（每秒） | 关键帧/无视频参考：720p $0.1425、1080p $0.2125；带参考视频：720p $0.085、1080p $0.1275 |

## 请求契约

`POST https://api.kie.ai/api/v1/jobs/createTask`，`{model,input}`。项目用显式模式切换两个端点：文/图生视频 → keyframe，参考生视频 → reference。

### keyframe-to-video

| 字段 | 值与约束 | 项目处理 |
|---|---|---|
| prompt | 必填，≤8000；可用 `@first_frame`、`@keyframe_N`、`@last_frame` 指代已上传的帧 | 统一提示词 |
| duration | 整数 3–30，默认 5；同时限制总帧数：3s→4、4s→5…8s→9、≥9s→10 | 下拉 3–30；超出帧数在提交前报错 |
| resolution | 720p / 1080p，默认 720p | 展示 |
| aspect_ratio | auto、16:9、9:16、1:1、21:9；仅无帧时生效，有帧跟随首帧 | 智能比例：有帧不发送也不显示，无帧本地转具体值 |
| first_frame_url / keyframe_urls（≤8）/ last_frame_url | 公网图片 URL | 上传图片依次映射：第 1 张首帧，末张尾帧，中间为关键帧 |

### reference-to-video

| 字段 | 值与约束 | 项目处理 |
|---|---|---|
| image_urls | ≤10 张，边长 300–65536，宽高比 0.4–2.5；`@image_N` 指代 | 上传图片 |
| video_urls | ≤5 段，每段 2–30 秒；`@video_N` 指代 | 上传视频 |
| keep_original_sound | 仅有参考视频时生效，默认 false；无参考视频时始终生成原生音频 | 有视频时显示开关 |
| aspect_ratio | 省略时有素材用 auto，无素材 16:9 | 智能比例：有素材发 auto，无素材 16:9 |
| elements（≤7，含视频主体 ≤3）/ voices（≤3） | 主体与声音引用，名称供 `@name` 使用 | 需要结构化编辑界面，本轮不显示、不请求 |

四类素材合计 ≤15，参考视频加视频主体 ≤5。`callBackUrl` 不发送。

## 事件与失败契约

沿用 [KIE 供应商文档](../供应商/KIE.md) 第 2 节 Market 统一任务契约，未引入新轮询或解析分支。官方请求 schema 见 `tests/fixtures/model-requests-2026-11/kie-kling-4.0-*.json`，由 `tests/catalog/kie-grsai-2026-11.test.ts` 校验；未做付费真网验收。

## 原始链接索引

均公开，无需登录：
- [Keyframe To Video](https://docs.kie.ai/market/kling/v4-keyframe-to-video.md)
- [Reference To Video](https://docs.kie.ai/market/kling/v4-reference-to-video.md)
- [模型页](https://kie.ai/kling-4-0)
- [实时价格页](https://kie.ai/pricing)（2026-11-07 核对 6 行 kling 4.0 价格）
