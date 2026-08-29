# Image Apps v2 照片修复（Fal）适配资料

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 平台 | Fal |
| 展示名 | Photo Restoration |
| API endpoint ID | `fal-ai/image-apps-v2/photo-restoration` |
| 模态 | 单张旧照片 → 单张修复图片 |
| SDK 入口 | `@henjicc/ai-sdk/tool-models/fal/photo-restoration` |
| 工具包 | `@henjicc/ai-sdk/tool-packs/fal-image-utility-tools` |
| 价格 | `$0.04 / image` |
| 登录状态 | 模型页、`llms.txt` 与 OpenAPI 公开；真实调用需要 Fal Key |

## 1. 能力与边界

官方提供三个可独立开关的修复能力：提升清晰度、修复颜色、消除划痕。端点不接收提示词或修复强度，也没有人脸保真程度、上色风格等控件。

## 2. 接口与队列契约

- 鉴权：`Authorization: Key <FAL_KEY>`
- 直连：`POST https://fal.run/fal-ai/image-apps-v2/photo-restoration`
- 队列提交：`POST https://queue.fal.run/fal-ai/image-apps-v2/photo-restoration`
- 状态：`GET https://queue.fal.run/fal-ai/image-apps-v2/photo-restoration/requests/{request_id}/status`
- 结果：`GET https://queue.fal.run/fal-ai/image-apps-v2/photo-restoration/requests/{request_id}`
- 取消：`PUT https://queue.fal.run/fal-ai/image-apps-v2/photo-restoration/requests/{request_id}/cancel`
- 结果路径：`images[].url`；`images` 必填

通用队列状态为 `IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`，`status` / `request_id` 必填。`COMPLETED` 后必须另取结果并校验 `images[].url`；没有模型专属状态或错误码，其余复用 [Fal 供应商队列契约](../供应商/Fal.md#2-队列契约)。

## 3. 请求字段

| 字段 | 类型 | 必填 | 默认 / 范围 | 产品策略 |
|---|---|---|---|---|
| `image_url` | string | 是 | 官方未公布文件限制 | 恰好 1 张已有素材，经 Fal CDN 上传 |
| `enhance_resolution` | boolean | 否 | `true` | 显示并发送 |
| `fix_colors` | boolean | 否 | `true` | 显示并发送 |
| `remove_scratches` | boolean | 否 | `true` | 显示并发送 |
| `aspect_ratio` | `{ratio: enum}` | 否 | 见下方冲突说明；枚举 `1:1` / `16:9` / `9:16` / `4:3` / `3:4` | 复用标准智能比例，按首图就近匹配，显式发送 `{ratio: '...'}` 对象 |

### 比例默认值冲突

- `aspect_ratio` 字段描述写“default: 4:3 for classic photos”。
- 同一份 OpenAPI 的 `AspectRatio.ratio` schema 默认值却是 `1:1`。

两处官方资料自相矛盾，不使用供应商隐式默认。SDK 应始终把本地 `smart` 按输入图比例转成具体枚举，再发送对象。

三个修复开关全为 `false` 时，官方没有说明服务端行为。产品应在提交前要求至少一项为 `true`，避免支付一次无操作请求；这是产品保守校验，不是官方 API 硬限制。

## 4. 请求与响应示例

```json
{
  "image_url": "https://v3.fal.media/files/.../old-photo.png",
  "enhance_resolution": true,
  "fix_colors": true,
  "remove_scratches": true,
  "aspect_ratio": { "ratio": "4:3" }
}
```

```json
{
  "images": [
    { "url": "https://v3b.fal.media/files/.../restored.png" }
  ]
}
```

## 5. 计价与未知项

- 实时 `llms.txt` 标价 `$0.04 / image`，三个开关不改变单价。
- 静态估价为 `$0.04 / 次`；最终以账户价格和 billing event 为准。
- 官方未给输入格式/尺寸/文件大小上限、精确 4K 输出宽高、延迟 SLA 和人脸/文字保真承诺。
- 付费验收要分别测试黑白上色、褪色修复、划痕消除、低清放大以及三项叠加。
- 该 API 没有 `seed`、负面提示词或 `output_format` 字段，不得发送。

## 6. 原始链接索引

| 内容 | 链接 | 是否需登录 | 核查日期 |
|---|---|---|---|
| 模型页与当前价格 | https://fal.ai/models/fal-ai/image-apps-v2/photo-restoration | 否 | 2026-08-29 |
| 实时字段、默认、示例与价格 | https://fal.ai/models/fal-ai/image-apps-v2/photo-restoration/llms.txt | 否 | 2026-08-29 |
| OpenAPI（对象比例、冲突默认值、必填与响应） | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-apps-v2/photo-restoration | 否 | 2026-08-29 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 | 2026-08-29 |
| Fal 价格 API | https://fal.ai/docs/platform-apis/v1/models/pricing | 否（调用需 Key） | 2026-08-29 |
