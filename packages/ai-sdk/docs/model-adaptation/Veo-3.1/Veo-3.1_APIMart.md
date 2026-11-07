# Veo 3.1 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-veo-3.1`（通用标识 `veo-3.1`，与已过时的 `fal-ai-veo-3.1` 相同） |
| 平台模型 ID | Ext：`veo3.1-fast` / `veo3.1-quality` / `veo3.1-lite`（兼容别名 `-ext` 后缀）；官方：`veo3.1-fast-official` / `veo3.1-quality-official` |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST /v1/videos/generations` → `data[0].task_id`
- 查询：`GET /v1/tasks/{task_id}`，完成后读 `data.result.videos[0].url[0]`，链接有效 72 小时

## 2. 渠道与能力

| 能力 | Ext Fast | Ext Quality | Ext Lite | 官方 Fast / Quality |
|---|---|---|---|---|
| 文生视频 | 支持 | 支持 | 支持 | 支持 |
| 首帧 / 首尾帧 | `image_urls` 1–2 张，`generation_type: frame` | 同左 | **不支持图片** | `first_frame_image` / `last_frame_image` |
| 参考图生视频 | `image_urls` ≤ 3，`generation_type: reference` | **不支持** | 不支持 | 不支持 |
| 时长 | 固定 8 秒 | 固定 8 秒 | 固定 8 秒 | 4 / 6 / 8 秒 |
| 分辨率 | 720p / 1080p / 4k | 同左 | 同左 | 720p / 1080p / 4K |
| 音频开关 | 无 | 无 | 无 | `generate_audio`，默认 false |

## 3. 请求参数

### 3.1 Ext

| 字段 | 取值 | 说明 |
|---|---|---|
| `model` | `veo3.1-fast` / `veo3.1-quality` / `veo3.1-lite` | |
| `prompt` | 必填 | |
| `duration` | 固定 8 | |
| `aspect_ratio` | `16:9` / `9:16` | |
| `resolution` | `720p`（默认）/ `1080p` / `4k` | |
| `generation_type` | `frame` / `reference` | 不传按图片数自动判断；Quality 不支持 reference；Lite 不能传 |
| `image_urls` | ≤ 3，≤ 10MB，jpeg/jpg/png/webp | Lite 不能传 |
| `enable_gif` | boolean | 项目不请求 |
| `official_fallback` | boolean | 项目不请求 |
| `nsfw_check` | 默认 false | 项目固定 false |

### 3.2 官方

| 字段 | 取值 | 说明 |
|---|---|---|
| `model` | `veo3.1-fast-official` / `veo3.1-quality-official` | |
| `prompt` | 必填，建议英文 | |
| `duration` | 4 / 6 / 8，默认 8 | 纯数字 |
| `aspect_ratio` | `16:9` / `9:16` | |
| `resolution` | `720p` / `1080p` / `4K` | 注意 4K 大写 |
| `first_frame_image` / `last_frame_image` | 公网 URL | |
| `generate_audio` | boolean，默认 false | |
| `negative_prompt` / `seed` / `sample_count` / `person_generation` / `resize_mode` | | 项目不显示、不请求 |
| `enhance_prompt` | 只能 true | 项目不请求 |

## 4. 价格

来源：[Veo 3.1 模型页](https://apimart.ai/zh/model/veo-3-1)（2026-11-07 读取，黄金价 = 当前价）；定价中心起步价 `veo3.1-fast-ext $0.14/次`、`veo3.1-lite-ext $0.07/次`、`veo3.1-quality-ext $1/次`、`veo3.1-fast-official $0.064/秒`、`veo3.1-quality-official $0.16/秒` 一致。

| 型号 | 720P / 1080P | 4K |
|---|---|---|
| Ext Fast | $0.14 / 次 | $0.64 / 次 |
| Ext Quality | $1 / 次 | $1.5 / 次 |
| Ext Lite | $0.07 / 次 | $0.57 / 次 |

| 官方（每秒） | 720P | 720P+音频 | 1080P | 1080P+音频 | 4K | 4K+音频 |
|---|---|---|---|---|---|---|
| Fast | $0.064 | $0.08 | $0.08 | $0.096 | $0.2 | $0.24 |
| Quality | $0.16 | $0.32 | $0.16 | $0.32 | $0.32 | $0.48 |

## 5. 项目适配

- Fal 的 Veo 3.1 于 2026-11-17 下线，APIMart 作为替代渠道接入同一通用标识 `veo-3.1`。
- 一个产品模型：`role: 'channel'` 渠道（默认 Ext）+ `role: 'mode'` 版本（Fast / Quality / Lite；官方渠道联动隐藏 Lite，旧值回到 Fast）。
- 模式（文/图生视频、参考图生视频）只在 Ext Fast 显示；文/图生视频按图片数：0 张文生，1 张首帧，2 张首尾帧。
- 时长与音频开关只在官方渠道显示，音频默认开启。
- 不显示、不请求：`enable_gif`、`official_fallback`、`negative_prompt`、`seed`、`sample_count`、`person_generation`、`resize_mode`、`enhance_prompt`。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Ext API 文档 | https://docs.apimart.ai/cn/api-reference/videos/veo3/generation | 否 |
| 官方 API 文档 | https://docs.apimart.ai/cn/api-reference/videos/veo3/generation-official | 否 |
| 模型页（价格） | https://apimart.ai/zh/model/veo-3-1 | 否 |
| 定价中心（起步价） | https://apimart.ai/zh/pricing | 否 |
