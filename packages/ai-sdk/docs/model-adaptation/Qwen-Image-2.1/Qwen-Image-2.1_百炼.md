# Qwen Image 2.1 · 百炼（阿里云百炼，官方）

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-14 |
| 模态 | 图片 |
| 供应商 | 阿里云百炼（Model Studio / DashScope），模型原厂官方接口 |
| 平台模型 ID | `qwen-image-2.1-pro`、`qwen-image-2.1-turbo`（同一模型卡片 `bailian-qwen-image-2.1` 的两个版本） |
| 接口形态 | **同步**（推荐）与**异步**两套，共用同一请求体；另有 OpenAI 兼容同步接口 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

2.1 不是 3.0 的旧版本，而是另一条产品线：2026-09 开源权重的 7B DiT 研究分支，API 版提供 pro / turbo。相对 3.0：参考图多（10 张）、能按提示词原生输出透明图、价格低；3.0 闭源、仅 API，定位更高端。两者并存，不互相取代。

## 1. 接入协议

**必须保证模型、Endpoint URL、API Key 属于同一地域，跨地域调用会失败。** 与 Qwen Image 3.0 共用同一套端点：

- 同步（推荐）：`POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- 异步：请求头加 `X-DashScope-Async: enable`，提交 `POST .../api/v1/services/aigc/image-generation/generation` → `task_id`，查询 `GET .../api/v1/tasks/{task_id}`
- OpenAI 兼容（仅同步、非流式）：`POST .../compatible-mode/v1/images/generations`，参数平铺在请求体顶层，`size` 写 `宽x高` 或 `auto`；不使用 `/images/edits` 与 multipart

请求头：`Content-Type: application/json`、`Authorization: Bearer sk-xxxx`。

结果时效：生成图像 URL **有效期 24 小时**，格式 PNG。

## 2. 能力清单

| 能力 | 触发方式 |
|---|---|
| 文生图（T2I） | `content` 仅含 1 个 `{"text": "..."}` |
| 图生图 / 图像编辑（I2I） | `content` 含 **1–10 个** `{"image": "..."}` + 1 个 `{"text": "..."}` |
| 透明背景（RGBA） | 无独立参数；模型按提示词自动决定输出普通图还是带透明通道的图 |
| 区域编辑 | 无 mask 字段；官方宣传可在输入图上用圆圈、手绘标注指定编辑区域 |
| 提示词智能改写 | `prompt_extend` + `prompt_extend_mode` |
| 思考模式 | `enable_thinking` |
| 多图输出 | `n` 最多 6 张 |

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必选 | — | `qwen-image-2.1-pro` / `qwen-image-2.1-turbo` |
| `input.messages[0].role` | string | 必选 | — | 固定 `user`，仅单轮 |
| `input.messages[0].content[].image` | string | I2I 必选 | — | URL 或 `data:{MIME_type};base64,{data}`；**1–10 张**，按数组顺序 |
| `input.messages[0].content[].text` | string | 必选 | — | 正向提示词，只能一个 |
| `parameters.prompt_extend` | boolean | 可选 | `true` | 提示词智能改写 |
| `parameters.prompt_extend_mode` | string | 可选 | `direct` | `direct`（T2I/I2I）；`agent`（仅 T2I，I2I 传入返回 400） |
| `parameters.enable_thinking` | boolean | 可选 | `true` | 仅在 `prompt_extend=true` 时生效；Agent I2I 不支持 |
| `parameters.n` | integer | 可选 | `1` | 1–6 |
| `parameters.size` | string | 可选 | 模型按提示词推荐 | `宽*高`；像素面积 `512*512` ~ `2048*2048`，宽高比 `1:8` ~ `8:1` |
| `parameters.seed` | integer | 可选 | 随机 | `[0, 2147483647]`。**本项目规则：不显示**，不下发 |
| `parameters.watermark` | boolean | 可选 | `false` | 是否加水印 |
| `parameters.negative_prompt` | — | — | — | **2.1 不支持**（官方注明仅 3.0 系列支持） |

输入图像要求：JPG / JPEG / PNG / BMP / TIFF / WEBP / GIF；宽高 1–8000 px（建议 384–2048）；长短边比 ≤ 10:1；单张 ≤ 10 MB。

## 4. 响应结构

与 3.0 相同：成功图片在 `output.choices[].message.content[].image`；异步查询 `output.task_status` ∈ `PENDING` / `RUNNING` / `SUCCEEDED` / `FAILED` / `CANCELED` / `UNKNOWN`；失败时 `code` / `message`。

**用量字段与 3.0 不同**：2.1 返回 `usage.image_count`、`usage.width`、`usage.height`（图片计量，不是 Token），没有 3.0 的 `input_image_type` / `output_image_type` 档位。

## 5. 价格（官方，人民币）

来源：[qwen-image-2.1-pro 模型页](https://help.aliyun.com/zh/model-studio/qwen-image-2-1-pro)、[qwen-image-2.1-turbo 模型页](https://help.aliyun.com/zh/model-studio/qwen-image-2-1-turbo)（2026-11-14 读取，原价，不含限时优惠）。按生成张数计价，不按分辨率分档；两个模型页的价格表都只有“图片生成”一项，**未列输入图费用**。

| 模型 | 地域 | 单价 |
|---|---|---|
| `qwen-image-2.1-pro` | 华北 2（北京） | **0.25 元/张** |
| `qwen-image-2.1-pro` | 新加坡 | 0.283404 元/张 |
| `qwen-image-2.1-pro` | 美国（弗吉尼亚）、德国（法兰克福）、日本（东京）、中国香港 | 0.25 元/张 |
| `qwen-image-2.1-turbo` | 华北 2（北京） | **0.1 元/张** |
| `qwen-image-2.1-turbo` | 新加坡 | 0.113362 元/张 |
| `qwen-image-2.1-turbo` | 德国（法兰克福）、日本（东京）、中国香港等 | 0.1 元/张 |

限流：华北 2 pro RPM 20、turbo RPM 120。免费额度：模型页未提。

## 6. 适配要点

- catalog 用一个模型 `bailian-qwen-image-2.1`（canonical `qwen-image-2.1`）承载两个版本：顶层“版本”参数 `bailianQwenImage21Variant`（`pro` 默认 / `turbo`，`role: 'mode'`），只决定请求 `model` 字段；两个版本请求字段、参考图上限、`n` 与尺寸范围按 API 参考相同。
- 旧入口 `bailian-qwen-image-2.1-pro` 放在 `meta.aliases`，`aliasParamDefaults` 固定为 pro，`aliasParamMappings` 把旧参数 `bailianQwenImage21Pro{AspectRatio,Resolution,Count}` 迁到 `bailianQwenImage21{AspectRatio,Resolution,Count}`。
- 与 3.0 同构，差异只有：参考图上限 10 张、无 `negative_prompt`、透明背景由提示词决定、用量字段不同、单一价格。
- 本项目默认不显示 `seed`、不暴露输出格式；固定下发 `prompt_extend=true`、`prompt_extend_mode=direct`（T2I/I2I 都合法）、`enable_thinking=false`、`watermark=false`。
- `size` 由比例 + 1K/2K 本地换算为 `宽*高`，面积落在官方范围内；1K/2K 同价。
- 本地估价 = 单价 × 生成张数，pro 0.25、turbo 0.1；输入图按模型页不另计费。
- 透明输出的实际 PNG 是否带 alpha 尚未真实请求核对。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| qwen-image-2.1-pro 模型页（价格、限流、能力） | https://help.aliyun.com/zh/model-studio/qwen-image-2-1-pro | 否 |
| qwen-image-2.1-turbo 模型页 | https://help.aliyun.com/zh/model-studio/qwen-image-2-1-turbo | 否 |
| 千问-图像生成与编辑 API 参考（3.0 与 2.1 共用，参数、响应、异步） | https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference | 否 |
| 模型价格总表 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| 国际站模型页（turbo 美元价） | https://www.alibabacloud.com/help/en/model-studio/qwen-image-2-1-turbo | 否 |
| 发布博客 | https://www.alibabacloud.com/blog/qwen-image-2-1-pro-and-turbo-apis-are-live-one-7b-model-to-generate-edit-and-cut-out_603679 | 否 |
