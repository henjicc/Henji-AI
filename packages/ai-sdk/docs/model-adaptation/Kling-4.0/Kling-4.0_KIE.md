# Kling 4.0 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 项目模型 | `kie-kling-4.0`，通用标识 `kling-video-4.0`；Flash 见 [Kling-4.0-Flash_KIE.md](../Kling-4.0-Flash/Kling-4.0-Flash_KIE.md) |
| model ID | `kling-4.0/keyframe-to-video`、`kling-4.0/reference-to-video` |
| 文档与价格 | 公开，无需登录 |
| 定价（每秒） | 关键帧/无视频输入：720p $0.1425、1080p $0.2125；带视频输入（参考视频或视频元素）：720p $0.085、1080p $0.1275，按 `max(2 × 输出, 输入 + 输出)` 秒计费（多段输入相加；例：10 秒输出 + 5 秒输入计 20 秒，15 秒输入计 25 秒） |

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
| elements（≤7，含视频主体 ≤3） | 每项 `name`（必填，1–20 个汉字/字母/数字/下划线，不区分大小写唯一，不能用 `image_N`、`video_N`、`keyframe_N`、`object_N`、`audio_N`、`first_frame`、`last_frame`）+ `image_urls`（2–4 张，第 1 张为主视角）或 `video_url`（3–8 秒单镜头角色视频，短边 ≥700px），二者互斥；可选 `tag`（character/animal/prop/costume/scene/effect/others，视频主体只能 character）、`description`（≤100 字符）、`voice_url`；提示词用 `@name` 引用 | “元素”面板（`kieKling40Elements`），只在参考生视频显示与发送；发 `name` + `image_urls` 或 `video_url`，`tag`、`description`、`voice_url` 不显示不发送 |
| voices（≤3） | 独立声音，`name` + `audio_url` | 不显示、不请求 |

四类素材合计 ≤15，参考视频加视频主体 ≤5，项目在提交前校验这两条及名称规则。参考视频与视频元素总时长 ≤30 秒由平台校验（元素视频时长提交前未知）。`callBackUrl` 不发送。

**没有分镜**：两个端点的 schema 都没有 `multi_prompt`（`additionalProperties: false`），分镜能力不适用。

估价：带视频输入时视频时长取宿主注入的 `__videoDurationSeconds`，未知时每段参考视频按 5 秒估；视频元素用上传时读到的时长，读不到按上限 8 秒估。

## 事件与失败契约

沿用 [KIE 供应商文档](../供应商/KIE.md) 第 2 节 Market 统一任务契约，未引入新轮询或解析分支。官方请求 schema 见 `tests/fixtures/model-requests-2026-11/kie-kling-4.0-*.json`，由 `tests/catalog/kie-grsai-2026-11.test.ts` 校验；未做付费真网验收。

## 原始链接索引

均公开，无需登录：
- [Keyframe To Video](https://docs.kie.ai/market/kling/v4-keyframe-to-video.md)
- [Reference To Video](https://docs.kie.ai/market/kling/v4-reference-to-video.md)
- [模型页](https://kie.ai/kling-4-0)
- [实时价格页](https://kie.ai/pricing)（2026-11-07 核对 6 行 kling 4.0 价格）
- 带视频输入的计费秒数规则见模型页 pricingDesc（2026-11-07 读取）
