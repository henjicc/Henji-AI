# Image Apps v2 扩图（Fal）适配资料

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 平台 | Fal |
| 展示名 | Image Outpaint |
| API endpoint ID | `fal-ai/image-apps-v2/outpaint` |
| 模态 | 单图输入 → 单张扩图结果 |
| SDK 入口 | `@henjicc/ai-sdk/tool-models/fal/outpaint` |
| 工具包 | `@henjicc/ai-sdk/tool-packs/fal-image-utility-tools` |
| 价格 | `$0.035 / megapixel` |
| 登录状态 | 模型页、`llms.txt` 与 OpenAPI 公开；真实调用需要 Fal Key |

## 1. 能力与语义

该端点支持两种可以叠加的扩图控制：

- `expand_left/right/top/bottom`：在四边增加 `0..700` 像素的黑色待生成区域。
- `zoom_out_percentage`：把原图缩小 `0..90%`，用黑色边缘填满原始画布，再生成新区域。

官方将 `zoom_out_percentage` 称为可选能力，但 schema 默认值是 `20`。首版应把它作为可见数值并显式发送，避免 UI 显示值与服务端实际缩放不一致。

## 2. 接口与队列契约

- 鉴权：`Authorization: Key <FAL_KEY>`
- 直连：`POST https://fal.run/fal-ai/image-apps-v2/outpaint`
- 队列提交：`POST https://queue.fal.run/fal-ai/image-apps-v2/outpaint`
- 状态：`GET https://queue.fal.run/fal-ai/image-apps-v2/outpaint/requests/{request_id}/status`
- 结果：`GET https://queue.fal.run/fal-ai/image-apps-v2/outpaint/requests/{request_id}`
- 取消：`PUT https://queue.fal.run/fal-ai/image-apps-v2/outpaint/requests/{request_id}/cancel`
- 结果路径：`images[].url`；`images` 和 `seed` 在 OpenAPI 中必填

队列仅使用 `IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`，`status` / `request_id` 必填。`COMPLETED` 后再取结果，且只有非空 `images[].url` 才算有效结果。模型没有新增状态或错误码，断线、取消和资源释放沿用 [Fal 供应商队列契约](../供应商/Fal.md#2-队列契约)。

## 3. 请求字段

| 字段 | 类型 | 必填 | 默认 / 范围 | 产品策略 |
|---|---|---|---|---|
| `image_url` | string | 是 | 官方未公布格式与尺寸限制 | 恰好 1 张已有素材，经 Fal CDN 上传 |
| `expand_left` | integer | 否 | `0`；`0..700` | 显示并发送 |
| `expand_right` | integer | 否 | `0`；`0..700` | 显示并发送 |
| `expand_top` | integer | 否 | `0`；`0..700` | 显示并发送 |
| `expand_bottom` | integer | 否 | `0`；`0..700` | 显示并发送 |
| `zoom_out_percentage` | number | 否 | `20`；`0..90` | 显示并显式发送 |
| `prompt` | string | 否 | `""`；最长 500 字符 | 复用工具的提示词输入；空值不发送 |
| `num_images` | integer | 否 | `1`；`1..4` | 首版固定 1，不展示、不发送 |
| `enable_safety_checker` | boolean | 否 | `true` | 不展示、不发送 |
| `seed` | integer/null | 否 | 随机 | 不展示、不发送 |
| `sync_mode` | boolean | 否 | `false` | 不展示、不发送 |
| `output_format` | enum | 否 | `png`；`png` / `jpeg` / `jpg` / `webp` | 按项目约定不展示、不发送 |

产品在提交前应拒绝“四边均为 0 且缩放为 0”的明显无操作组合，避免付费生成近似原图。这是产品校验，不是官方 API 硬限制。

## 4. 请求与响应示例

```json
{
  "image_url": "https://v3.fal.media/files/.../source.png",
  "expand_left": 200,
  "expand_right": 200,
  "expand_top": 0,
  "expand_bottom": 0,
  "zoom_out_percentage": 20,
  "prompt": "continue the sunset landscape naturally"
}
```

```json
{
  "images": [
    { "url": "https://v3b.fal.media/files/.../outpainted.png" }
  ],
  "seed": 123456
}
```

## 5. 计价与未知项

- 实时 `llms.txt` 标价 `$0.035 / megapixel`。文本未明确这是输入、输出还是处理像素；由于四边扩展会改变面积，静态首屏只应显示单位价或明确标注“估算”。
- 最终成本需使用 Fal pricing API / billing event 的实际 billing units 对账。
- 官方未给输入尺寸/格式上限、扩展后的最大总尺寸、延迟 SLA 和无操作组合的服务端行为。
- 付费验证要覆盖单边、非对称多边、纯缩放以及扩展+缩放叠加四类请求。

## 6. 原始链接索引

| 内容 | 链接 | 是否需登录 | 核查日期 |
|---|---|---|---|
| 模型页与当前价格 | https://fal.ai/models/fal-ai/image-apps-v2/outpaint | 否 | 2026-08-29 |
| 实时字段、范围、示例与价格 | https://fal.ai/models/fal-ai/image-apps-v2/outpaint/llms.txt | 否 | 2026-08-29 |
| OpenAPI（完整范围、必填与响应） | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-apps-v2/outpaint | 否 | 2026-08-29 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 | 2026-08-29 |
| Fal 价格 API | https://fal.ai/docs/platform-apis/v1/models/pricing | 否（调用需 Key） | 2026-08-29 |
