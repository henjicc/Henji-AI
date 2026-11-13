# MiniMax H3 Image · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `minimax-h3-image`、`minimax-h3-image-highspeed` |
| 痕迹AI 模型 ID | `apimart-minimax-h3-image`（canonical `minimax-h3-image`）；与视频模型 MiniMax H3（`apimart-minimax-h3`）是不同模型 |
| 接口形态 | `POST https://api.apimart.ai/v1/images/generations` 异步，`GET /v1/tasks/{task_id}` 轮询，与其他 APIMart 图片模型同协议（见 `供应商/APIMart.md`） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录（仅估价） |

## 1. 能力与归并

同一端点，`model` 取 `minimax-h3-image`（标准）或 `minimax-h3-image-highspeed`（更快，图片输入输出单价 2 倍），两者参数完全相同；合为一个项目模型，用“版本”参数切换。传 `image_urls` 即为编辑（最多 16 张），否则文生图。

## 2. 请求参数（官方文档，2026-11-14 读取）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 是 | — | `minimax-h3-image` / `minimax-h3-image-highspeed` |
| `prompt` | string | 是 | — | 去首尾空白后 1–32000 字符 |
| `image_urls` | string[] | 否 | — | ≤16 张，公网 URL 或 `data:image/...;base64,`；JPG/JPEG/PNG/WebP/HEIC/HEIF，≤64MB，单边 128–8192，长短边比 ≤4 |
| `size` | string | 否 | `auto` | `auto`（模型按提示词定构图与比例）/ `X:Y`（X、Y 为 1–300 整数，比例 1:3–3:1）/ `WxH` 像素（总像素 655,360–20,000,000，比例 1:3–3:1，不能同时传 `resolution`） |
| `resolution` | enum | 否 | `4K` | `1K`（约 1MP）/ `2K`（约 4.2MP）/ `4K`（约 16MP）；**缺省为 4K** |
| `n` | integer | 否 | `1` | 1–10 |
| `prompt_optimizer` | boolean | 否 | `true` | 设为 `false` 只适用于文生图且 `size` 必须是明确比例或像素；编辑时扩写恒开，传 false 返回 400 |
| `output_format` | enum | 否 | `jpeg` | `jpeg` / `png` / `webp`；按项目约定不展示、不下发 |
| `output_compression` | integer | 否 | `95` | 0–100；不下发 |
| `watermark` | boolean | 否 | `false` | 不下发 |
| `nsfw_check` | boolean | 否 | `false` | 不下发 |

不支持（传了忽略）：`quality`、`style`、`seed`、`negative_prompt`、`background`、`mask_url`；`response_format: "b64_json"` 返回 400。

## 3. 响应结构

提交：`{code:200, data:[{status:"submitted", task_id}]}`。查询成功：`data.status = "completed"`，图片在 `data.result.images[0].url[]`（全部 n 张在同一数组），另有 `expires_at`、`revised_prompt(s)`、`cost`（实际扣费）。失败 `status: "failed"`、原因在 `error.message`，自动全额退款。官方建议每 3–5 秒轮询，单任务最长 600 秒。走 APIMart 通用解析。

## 4. 价格（模型页，2026-11-14 读取）

平台按 token 计费，页面只给单张文生图估价（图片输出 + 约 2000 输入文本 token）：

| 档 | 标准版估价（每张） | Highspeed |
|---|---|---|
| 1K / 2K | 约 $0.0189 | 约 2 倍 |
| 4K | 约 $0.0628 | 约 2 倍 |

- 参考图另按图片输入 token 计费，页面未公布单价（未查到）。项目估价未计入参考图。
- 实际扣费以任务结果 `cost` 为准；项目 pricing 用 `billingMode: 'estimated'`。

## 5. 适配要点

- 版本（标准 / Highspeed，`role: mode`）切 `model` 取值。
- 比例：智能比例本地换成具体比例（有图取首图最接近，无图 1:1），始终发明确的 `size` 比例，不发 `auto`，因此关闭扩写时满足“必须显式 size”的约束。
- 分辨率 1K / 2K / 4K，默认 2K，并且始终显式发送（平台缺省 4K，约 3 倍价）。
- 提示词扩写开关只在未上传图片时显示；关闭时发 `prompt_optimizer: false`，开启时不发（用平台默认）。
- 不接入：`output_format`、`output_compression`、`watermark`、`nsfw_check`、像素 `size`。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 标准版接口文档 | https://docs.apimart.ai/en/api-reference/images/minimax-h3-image/generation.md | 否 |
| Highspeed 接口文档 | https://docs.apimart.ai/en/api-reference/images/minimax-h3-image-highspeed/generation.md | 否 |
| 任务查询 | https://docs.apimart.ai/en/api-reference/tasks/status.md | 否 |
| 模型页与估价 | https://apimart.ai/model/minimax-h3-image | 否 |
| 文档索引 | https://docs.apimart.ai/_llms/en/api-manual.txt | 否 |
