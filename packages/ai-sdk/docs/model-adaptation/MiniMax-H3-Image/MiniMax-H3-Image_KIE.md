# MiniMax H3 Image · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| 模态 | 图片 |
| 供应商 | KIE（聚合平台） |
| 平台模型 ID | `minimax-h3/text-to-image`、`minimax-h3/image-edit` |
| 痕迹AI 模型 ID | `kie-minimax-h3-image`（canonical `minimax-h3-image`）；与视频模型 MiniMax H3（`kie-minimax-h3`）是不同模型 |
| 接口形态 | `POST https://api.kie.ai/api/v1/jobs/createTask` 异步，Get Task Details 轮询，与其他 KIE Market 模型同协议（见 `供应商/KIE.md`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 能力与归并

| 能力 | KIE model |
|---|---|
| 文生图 | `minimax-h3/text-to-image` |
| 编辑 / 多图参考（1–16 张） | `minimax-h3/image-edit` |

两个 model 字段相同（编辑多 `image_urls`），合为一个项目模型，按是否上传图片自动切换。KIE 没有 Highspeed 版。

## 2. 请求参数（官方 OpenAPI，2026-11-14 读取）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | 1–5000 字符；编辑时用 `<Picture 1>`、`<Picture 2>`… 按 `image_urls` 顺序指代 |
| `image_urls` | string[] | 编辑必填 | — | 1–16 张公网 `http(s)` URL，每张 ≤20MB、≤64MP，JPG/PNG/WEBP/HEIC/BMP（透明背景填白） |
| `aspect_ratio` | enum | 否 | `auto` | `auto` `1:1` `5:4` `4:3` `3:2` `16:9` `21:9` `4:5` `3:4` `2:3` `9:16`；文生图 `auto` 由扩写器选比例（关扩写时退回 1:1），编辑 `auto` 跟随第一张参考图（1:3–3:1 任意比例） |
| `resolution` | enum | 否 | `2K` | `1K`（约 1MP）/ `2K`（约 4MP）/ `4K`（约 16MP） |
| `width` / `height` | integer | 否 | — | 1–8192，必须成对，总像素 655,360–20,000,000、比例 1:3–3:1；与 `resolution` / `aspect_ratio` 互斥，不接入 |
| `seed` | integer | 否 | 随机 | 0–2147483647；按项目约定不展示、不下发 |
| `expand_prompt` | boolean | 否 | `true` | 先把提示词扩写为详细英文描述；两个 model 都可关 |
| `output_format` | enum | 否 | `png` | `png` / `jpeg`；按项目约定不展示、不下发 |
| `nsfw_checker` | boolean | 否 | `false` | 不展示、不下发 |

每次只出 1 张。

## 3. 响应结构

Get Task Details 的 `data.resultJson` 为 JSON 字符串 `{resultUrls:[...]}`，走 KIE 通用解析。结果链接约 14 天有效。

## 4. 价格（kie.ai/pricing，2026-11-14 读取；1 credit = $0.005）

| 项 | credits | USD |
|---|---|---|
| 1K / 2K 输出（≤4.5MP，每张） | 1.8 | $0.009 |
| 4K 输出（每张） | 5.5 | $0.0275 |
| 编辑参考图（每张，含第一张） | 0.5 | $0.0025 |

费用 = 档位价 + 参考图张数 × $0.0025。档位由 `resolution` 决定，与 `auto` 选出的比例无关；自定义宽高按总像素归档（≤1.2MP→1K，≤4.5MP→2K，更大→4K，未接入）。

## 5. 适配要点

- 比例：智能比例在编辑时发官方 `auto`（跟随第一张参考图的任意比例），文生图发 `1:1`；其余比例照发。
- 分辨率 1K / 2K / 4K，默认 2K；参数命名与 Fal 版一致（比例、分辨率、提示词扩写）。KIE 没有出图数量与 Highspeed，不显示这两项。
- 提示词扩写开关两种模式都显示与下发（KIE 编辑端点也可关，与 Fal 不同）。
- 不接入：`width`/`height`、`seed`、`output_format`、`nsfw_checker`、`callBackUrl`。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生图接口 | https://docs.kie.ai/market/minimax-h3/text-to-image.md | 否 |
| 编辑接口 | https://docs.kie.ai/market/minimax-h3/image-edit.md | 否 |
| 价格（`__NEXT_DATA__` 内 creditPrice/usdPrice） | https://kie.ai/pricing | 否 |
| 模型介绍页 | https://kie.ai/minimax-h3-image | 否 |
| 文档索引 | https://docs.kie.ai/llms.txt | 否 |
