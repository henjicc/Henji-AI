# FLUX 3 Image · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-flux-3-image`（通用标识 `flux-3`，与 Fal 一致） |
| 平台模型 ID | `flux-3-image`、`flux-3-image-klein` |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST /v1/images/generations` → `data[0].task_id`
- 查询：`GET /v1/tasks/{task_id}`，完成后读 `data.result.images[0].url[0]`，保留 72 小时

## 2. 能力

文生图、单图编辑、最多 10 张参考图的多图参考；提示词内可用标签 + bbox JSON（0–1000 归一化坐标）描述布局与局部编辑，不是独立参数，也没有蒙版。每次只出 1 张。Klein 是更小更快的开放权重版本。

## 3. 请求参数

| 字段 | `flux-3-image` | `flux-3-image-klein` |
|---|---|---|
| `model` | 必填 | 必填 |
| `prompt` | 必填；不支持负面提示词 | 同左 |
| `image_urls` | ≤ 10，公网 URL 或 Base64 | 同左 |
| `aspect_ratio`（或 `size`） | `21:9` `2:1` `16:9` `3:2` `7:5` `4:3` `5:4` `1:1` `4:5` `3:4` `5:7` `2:3` `9:16` `1:2` `9:21` / `auto`；不接受像素值 | 同左 |
| `resolution` | `768sq` / `1k` / `1.5k` / `2k` / `4k`，默认 `1k`，决定计费档 | 同左 |
| `safety_tolerance` | 0–4，默认 2 | 同左 |
| `grounding` | boolean，默认 true（生成前检索） | 不支持（传入 400） |
| `seed` | 不支持 | 0–4294967295 |
| `steps` | 不支持 | 1–16，默认 16，不影响价格 |
| `output_format` | 不支持 | `jpeg` / `png` |
| `n` | 只能 1 | 只能 1 |
| 报 400 | `width` `height` 像素尺寸 `guidance` `negative_prompt` `prompt_upsampling` `mask_url` | |

## 4. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing) 图像区 `flux-3-image`、`flux-3-image-klein`（2026-11-07 读取，各 6 个价格档位，黄金价 = 当前价）；[FLUX 3 Image 模型页](https://apimart.ai/zh/model/flux-3-image)说明“价格由分辨率决定，参考图不另收费”。

| 档位 | flux-3-image | flux-3-image-klein |
|---|---|---|
| 768SQ | $0.0328 | $0.0064 |
| 1K（默认） | $0.0384 | $0.0072 |
| 1.5K | $0.056 | $0.0088 |
| 2K | $0.08 | $0.0112 |
| 4K | $0.4856 | $0.0288 |

## 5. 项目适配

- 一个产品模型，`role: 'mode'` 版本（标准 / Klein），两个版本共用比例与分辨率参数。
- 比例默认“智能”：按首图比例取最近支持比例，无图回退 `1:1`；始终发具体比例，不发 `auto`。
- 不显示、不请求：`safety_tolerance`、`grounding`（用平台默认开启）、Klein 的 `seed` / `steps` / `output_format`。
- 布局 / 局部编辑通过提示词语法表达，不提供额外参数。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| FLUX 3 Image API 文档 | https://docs.apimart.ai/cn/api-reference/images/flux-3-image/generation | 否 |
| FLUX 3 Image Klein API 文档 | https://docs.apimart.ai/cn/api-reference/images/flux-3-image-klein/generation | 否 |
| 模型页 | https://apimart.ai/zh/model/flux-3-image | 否 |
| 定价中心（分档价格） | https://apimart.ai/zh/pricing | 否 |
