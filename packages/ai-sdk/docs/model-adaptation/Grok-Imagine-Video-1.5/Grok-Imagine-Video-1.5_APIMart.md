# Grok Imagine Video 1.5 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-grok-imagine-video-1.5`（通用标识 `grok-imagine-video-1.5`） |
| 平台模型 ID | 官方：`grok-imagine-video-1.5`；Ext：`grok-imagine-1.5-video-ext` |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST /v1/videos/generations` → `data[0].task_id`
- 查询：`GET /v1/tasks/{task_id}`，每 3–5 秒；完成后读 `data.result.videos[0].url[0]`，保留 72 小时；失败不收费
- 官方视频文档提示：不要发送 `X-APIMart-Response-Version`，该头会切到 HTTP 202 新响应结构。项目 provider 统一下发该头并按锁定版本解析（见供应商文档 3.1 节），此处不做模型分支。

## 2. 能力

| 能力 | 官方 `grok-imagine-video-1.5` | Ext `grok-imagine-1.5-video-ext` |
|---|---|---|
| 文生视频 | 支持 | 支持 |
| 参考图生成视频 | `image_urls`，公开契约无固定上限 | `image_urls` ≤ 7 张 |
| 视频编辑 | 不支持（只有基础版 `grok-imagine-video` 支持） | 不支持 |
| 分辨率 | `480p` / `720p` / `1080p` | `480p` / `720p` |
| 时长 | 1–15 秒，默认 8 | 6–15 秒，默认 6 |
| 比例 | `aspect_ratio`：`1:1` `16:9` `9:16` `4:3` `3:4` `3:2` `2:3` | `size`：`16:9` `9:16` `1:1` `3:2` `2:3`；上传参考图后自动匹配参考图比例 |

## 3. 请求参数

| 字段 | 官方 | Ext |
|---|---|---|
| `model` | `grok-imagine-video-1.5` | `grok-imagine-1.5-video-ext` |
| `prompt` | 必填，去空格后非空，≤ 8000 字符 | 必填 |
| `duration` | 1–15 | 6–15，纯数字 |
| `resolution` | 480p / 720p / 1080p，默认 480p | 480p / 720p，默认 480p |
| 比例 | `aspect_ratio` | `size` |
| `image_urls` | 公网 HTTPS，无参考图时省略整个字段 | 公网 URL，≤ 7，不支持 base64 |
| `nsfw_check` | 默认 false | 默认 false |

## 4. 价格

来源：[Grok Imagine Video 1.5 模型页](https://apimart.ai/zh/model/grok-imagine-video-1-5)（2026-11-07 读取，黄金价 = 当前价）。

| 型号 | 规格 | 单价 |
|---|---|---|
| 官方 | 480P / 720P / 1080P | $0.064 / $0.112 / $0.2 每秒 |
| 官方 | 参考图片 | $0.008 / 张 |
| Ext | 480P / 720P | $0.0102 / $0.01912 每秒 |

Ext 价格表未在模型页价格区单列，取自同页常见问题“2026 年 10 月……Ext 型号为 480p 每秒 $0.0102、720p 每秒 $0.01912”；定价中心起步价 `grok-imagine-1.5-video-ext $0.0102/秒` 一致。Ext 是否对参考图另收费未见说明，项目按不另收估价。

## 5. 项目适配

- 一个产品模型：`role: 'channel'` 渠道（默认官方）；参考图 0 张为文生，1–7 张为参考图生视频（项目把官方也限制为 7 张，与 Ext 一致）。
- 切到 Ext 时联动裁剪比例与分辨率（无 1080p），时长下限改为 6 秒。
- 比例默认“智能”：按首图比例取最近支持比例，无图回退 16:9；Ext 发 `size`，官方发 `aspect_ratio`。
- `nsfw_check` 固定 false。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 官方视频模型 API 文档 | https://docs.apimart.ai/cn/api-reference/videos/grok-imagine/official | 否 |
| Ext（Grok Imagine 1.5 视频）API 文档 | https://docs.apimart.ai/cn/api-reference/videos/grok-imagine/generation | 否 |
| 模型页（价格与 Ext FAQ 价格） | https://apimart.ai/zh/model/grok-imagine-video-1-5 | 否 |
| 定价中心（起步价） | https://apimart.ai/zh/pricing | 否 |
