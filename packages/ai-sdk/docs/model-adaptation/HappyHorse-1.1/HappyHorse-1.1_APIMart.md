# HappyHorse 1.1 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-08 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-happyhorse-1.1`（通用标识 `happyhorse-1.1`，与 `kie-happyhorse-1.1` 相同） |
| 平台模型 ID | `happyhorse-1.1`（阿里云百炼 HappyHorse 1.1） |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST /v1/videos/generations` → `data[0].task_id`
- 查询：`GET /v1/tasks/{task_id}`，完成后读 `data.result.videos[0].url[0]`

## 2. 能力（统一入口，按字段自动路由）

| 传入字段 | 模式 |
|---|---|
| 仅 `prompt` | 文生视频 |
| `prompt` + `first_frame_image` | 图生视频（以图为首帧） |
| `prompt` + `image_urls`（1–9 张） | 参考图生视频（生成全新画面） |

路由优先级 `first_frame_image` > `image_urls` > 仅 `prompt`；两个媒体字段互斥，同传返回 400 `mixed_media_not_allowed`。

## 3. 请求参数

| 字段 | 取值 | 说明 |
|---|---|---|
| `model` | `happyhorse-1.1` | 必填 |
| `prompt` | ≤ 2500 字符 | |
| `first_frame_image` | URL 或 base64 | JPEG/JPG/PNG/BMP/WEBP，短边 ≥ 300px，宽高比 1:2.5–2.5:1，≤ 10MB |
| `image_urls` | 1–9 张，URL 或 base64 | 短边推荐 ≥ 720p，短边/长边 ≥ 0.4，≤ 10MB |
| `resolution` | `720P` / `1080P` | 默认 `1080P` |
| `duration` | 3–15 任意整数 | 默认 5 |
| `size` | `16:9` / `9:16` / `1:1` / `4:3` / `3:4` | 默认 16:9；图生视频忽略 |
| `watermark` / `seed` | | 项目不显示、不请求 |
| `nsfw_check` | 默认 false | 项目固定 false |

## 4. 价格

来源：[HappyHorse 1.1 模型页](https://apimart.ai/zh/model/happyhorse-1-1)（2026-11-07 读取，黄金价 = 当前价）；定价中心起步价 `happyhorse-1.1 $0.13/秒` 一致。

| 分辨率 | 单价 |
|---|---|
| 720P | $0.13 / 秒 |
| 1080P | $0.172 / 秒 |

所有模式只按分辨率 × 秒数计费（API 文档）。

## 5. 项目适配

- 素材尺寸前置校验（2026-11-08）：`imageConstraints` 首帧短边 ≥ 300 px、宽高比 0.4–2.5；参考图只校验宽高比 0.4–2.5（短边 ≥ 720 px 是推荐值，不拦）。提交前读取素材实际宽高，不合格直接提示，不发付费请求。
- 与 `kie-happyhorse-1.1` 同结构：`role: 'mode'` 模式（文/图生视频、参考图生视频）。文/图生视频 0 张文生、1 张首帧；参考模式 1–9 张。
- 比例默认“智能”：有图按首图比例、无图回退 16:9；图生视频隐藏比例且不发送 `size`。
- 不显示、不请求：`watermark`、`seed`。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| API 文档 | https://docs.apimart.ai/cn/api-reference/videos/happyhorse-1.1/generation | 否 |
| 模型页（价格） | https://apimart.ai/zh/model/happyhorse-1-1 | 否 |
| 定价中心（起步价） | https://apimart.ai/zh/pricing | 否 |
