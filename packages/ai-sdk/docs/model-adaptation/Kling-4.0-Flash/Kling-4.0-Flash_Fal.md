# Kling 4.0 Flash · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `kling/v4/flash/{text-to-video,image-to-video,reference-to-video,video-to-video}` |
| 痕迹AI 模型 ID | `fal-ai-kling-4.0-flash`（canonical `kling-video-4.0-flash`） |
| 接口形态 | Fal 队列异步 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 与 Kling 4.0 标准版的差异

| 项目 | Flash |
|---|---|
| 分辨率 | 只有 `720p` |
| 时长 | 3–20 秒 |
| 图生视频 | 只有 `start_image_url`，**不接受尾帧和中间关键帧**，无 `aspect_ratio` |
| 参考生视频 | `prompt` 必填；`image_urls` ≤10、`video_urls` ≤5（每段 3–20 秒，与元素视频合计 ≤20 秒）、`elements` ≤7（视频元素 ≤3）；**不接受声音** |
| 视频编辑 | 端点 `kling/v4/flash/video-to-video`；源视频 3–20 秒；`video_urls` ≤4、`image_urls` ≤10、`elements` ≤7；**无 `aspect_ratio`** |
| 分镜 | **四个端点都没有 `multi_prompt`** |
| 元素结构 | `KlingV4FlashElement`：`frontal_image_url`、`reference_image_urls`（1–3）、`video_url`（3–8 秒）；**没有 `voice_id`** |

其余字段形状与标准版相同，见 [Kling-4.0_Fal.md](../Kling-4.0/Kling-4.0_Fal.md)。

## 2. 价格（模型页 pricingInfoOverride，2026-11-07 读取）

| 情形 | 单价 | 计费时长 |
|---|---|---|
| 文生 / 图生 / 只用参考图 | $0.094/秒 | 输出时长 |
| 带参考视频 / 视频编辑 | $0.063/秒 | 输出时长 + max(输入视频时长, 输出时长) |

Flash 价格原文只写“With video references”；视频元素与参考视频共用 20 秒总时长上限，标准版价格原文也把视频元素列为低价档条件，项目按同样规则把视频元素计入输入时长。

## 3. 适配要点

- 一个模型、显式 `mode`：文/图生视频（0 张图文生、1 张首帧）、参考生视频、视频编辑。
- 视频编辑不下发 `duration`（输出等于源视频长度），计费按 `源时长 + max(全部输入时长, 源时长)` 估算。
- 不下发 `resolution`（只有 720p，平台默认即是）。
- 元素（`falKling40FlashElements`）：参考生视频与视频编辑可用，值结构与映射同标准版（见 Kling-4.0_Fal.md 第 4 节）；视频元素估价用上传时读到的时长，读不到按上限 8 秒计入输入时长。
- 没有分镜参数（平台不支持 `multi_prompt`）。

## 4. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=kling/v4/flash/text-to-video | 否 |
| 图生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=kling/v4/flash/image-to-video | 否 |
| 参考生视频 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=kling/v4/flash/reference-to-video | 否 |
| 视频编辑 schema | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=kling/v4/flash/video-to-video | 否 |
| 模型页与价格 | https://fal.ai/models/kling/v4/flash/text-to-video | 否 |
| 参考生视频价格 | https://fal.ai/models/kling/v4/flash/reference-to-video | 否 |
| 视频编辑价格 | https://fal.ai/models/kling/v4/flash/video-to-video | 否 |
