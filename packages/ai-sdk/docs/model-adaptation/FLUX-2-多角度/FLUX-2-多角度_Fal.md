# FLUX 2 多角度（Fal）适配资料

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 平台 | Fal |
| 展示名 | Flux 2 Lora Gallery / Multiple Angles |
| API endpoint ID | `fal-ai/flux-2-lora-gallery/multiple-angles` |
| 模态 | 图片数组输入 → 指定镜头角度的图片 |
| SDK 入口 | `@henjicc/ai-sdk/tool-models/fal/flux-2-multiple-angles` |
| 工具包 | `@henjicc/ai-sdk/tool-packs/fal-multi-angle-tools` |
| 价格 | `$0.021 / processed megapixel` |
| 登录状态 | 模型页、`llms.txt` 与 OpenAPI 公开；真实调用需要 Fal Key |

> 模型用度数表达水平和垂直控制，但没有输出相机内参、外参或误差。产品可称“镜头角度”或“模型控制角”，不能称测量级姿态。

## 1. 角度语义

| 字段 | 官方语义 |
|---|---|
| `horizontal_angle` | `0°` 正面，`90°` 右侧，`180°` 背面，`270°` 左侧，`360°` 回到正面 |
| `vertical_angle` | `0°` 平视，`30°` 高机位，`60°` 高角度俯拍 |
| `zoom` | `0` 远景，`5` 中景，`10` 近景 |

该端点没有请求 `prompt`：官方说明提示词由滑块数值自动组装。正式 UI 不应展示一个不会进入请求的提示词框。

## 2. 接口与队列契约

- 鉴权：`Authorization: Key <FAL_KEY>`
- 直连：`POST https://fal.run/fal-ai/flux-2-lora-gallery/multiple-angles`
- 队列提交：`POST https://queue.fal.run/fal-ai/flux-2-lora-gallery/multiple-angles`
- 状态：`GET https://queue.fal.run/fal-ai/flux-2-lora-gallery/multiple-angles/requests/{request_id}/status`
- 结果：`GET https://queue.fal.run/fal-ai/flux-2-lora-gallery/multiple-angles/requests/{request_id}`
- 取消：`PUT https://queue.fal.run/fal-ai/flux-2-lora-gallery/multiple-angles/requests/{request_id}/cancel`
- 结果路径：`images[].url`；OpenAPI 还把 `seed` 和服务端组装的 `prompt` 标为必填

通用状态为 `IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`，`status` / `request_id` 必填。`COMPLETED` 后再获取结果并严格校验 `images[].url`；模型没有新增状态或错误码，其余复用 [Fal 供应商队列契约](../供应商/Fal.md#2-队列契约)。

## 3. 请求字段

| 字段 | 类型 | 必填 | 默认 / 范围 | 产品策略 |
|---|---|---|---|---|
| `image_urls` | `string[]` | 是 | **官方未给 `minItems` / `maxItems`** | 首版保守限制恰好 1 张；这是产品约束，不冒充官方限制；由 Fal CDN 上传 |
| `horizontal_angle` | number | 否 | `0`；`0..360` | 显示并发送 |
| `vertical_angle` | number | 否 | `0`；`0..60` | 显示并发送 |
| `zoom` | number | 否 | `5`；`0..10` | 显示并发送 |
| `image_size` | 对象 / enum / null | 否 | 枚举见下 | 首版按输入比例选约 1MP 标准档，显式发送，限制波动与费用 |
| `guidance_scale` | number | 否 | `2.5`；`0..20` | 不展示、不发送 |
| `num_inference_steps` | integer | 否 | `40`；`4..50` | 不展示、不发送 |
| `acceleration` | enum | 否 | `regular`；`none` / `regular` | 不展示、不发送 |
| `enable_safety_checker` | boolean | 否 | `true` | 不展示、不发送 |
| `num_images` | integer | 否 | `1`；`1..4` | 首版一个目标角度对应一张，固定 1，不展示、不发送 |
| `lora_scale` | number | 否 | `1`；`0..2` | 不展示、不发送 |
| `seed` | integer/null | 否 | 随机 | 不展示、不发送 |
| `sync_mode` | boolean | 否 | `false` | 不展示、不发送 |
| `output_format` | enum | 否 | `png`；`png` / `jpeg` / `webp` | 按项目约定不展示、不发送 |

`image_size` 可以是 `{width, height}`（宽高为正整数，单边最大 `14142`，子字段默认 `512`），或以下枚举：

`square_hd` / `square` / `portrait_4_3` / `portrait_16_9` / `landscape_4_3` / `landscape_16_9`。

## 4. 请求与响应示例

```json
{
  "image_urls": ["https://v3.fal.media/files/.../object.png"],
  "horizontal_angle": 90,
  "vertical_angle": 30,
  "zoom": 5,
  "image_size": "square_hd"
}
```

```json
{
  "images": [
    { "url": "https://v3b.fal.media/files/.../angle.png" }
  ],
  "prompt": "<server-generated prompt>"
}
```

OpenAPI 把 `seed` 标为必填，但同一份官方 `llms.txt` 的字面响应示例缺少 `seed`。解析器只应把非空 `images[].url` 当作成功必要条件，`seed` / `prompt` 按可选元数据处理。

## 5. 多角度组与计价

- 每个目标角度使用一次独立 Fal 请求，选择顺序在请求前固定，不从结果文件名推断。
- 实时 `llms.txt` 标价 `$0.021 / processed megapixel`。首版固定约 1MP 时，单角度静态预算约 `$0.021`；4 角度约 `$0.084`。
- “processed megapixel”的精确取整和输入/输出基准未在 `llms.txt` 展开，最终以 pricing API / billing event 为准。
- 多次独立生成不保证身份、文字、不可见结构或背景一致；批次失败和按失败项重试策略应与现有多角度工具保持一致。

## 6. 待真实验证

- 人物、商品、建筑在 `0/90/180/270/360°` 的方位遵从和回环误差。
- `vertical_angle` 只有正值，是否无法表达仰拍。
- `zoom` 是改变景别还是同时改变主体几何。
- 官方未给输入数量、文件限制、延迟 SLA 和一致性承诺。

## 7. 原始链接索引

| 内容 | 链接 | 是否需登录 | 核查日期 |
|---|---|---|---|
| 模型页与当前价格 | https://fal.ai/models/fal-ai/flux-2-lora-gallery/multiple-angles | 否 | 2026-08-29 |
| 实时字段、范围、示例与价格 | https://fal.ai/models/fal-ai/flux-2-lora-gallery/multiple-angles/llms.txt | 否 | 2026-08-29 |
| OpenAPI（完整尺寸枚举、范围、必填与响应） | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-2-lora-gallery/multiple-angles | 否 | 2026-08-29 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 | 2026-08-29 |
| Fal 价格 API | https://fal.ai/docs/platform-apis/v1/models/pricing | 否（调用需 Key） | 2026-08-29 |
