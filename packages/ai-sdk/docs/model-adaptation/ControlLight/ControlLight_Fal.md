# ControlLight（Fal）适配资料

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 平台 | Fal |
| 展示名 | ControlLight |
| API endpoint ID | `fal-ai/control-light` |
| 模态 | 单图输入 → 暗光增强图片 |
| SDK 入口 | `@henjicc/ai-sdk/tool-models/fal/control-light` |
| 工具包 | `@henjicc/ai-sdk/tool-packs/fal-image-utility-tools` |
| 价格 | `$0.03 / megapixel` |
| 登录状态 | 模型页、`llms.txt` 与 OpenAPI 公开；真实调用需要 Fal Key |

## 1. 能力与产品边界

ControlLight 是基于 FLUX.2 [klein] 9B 的 LoRA，用于抬升暗光曝光并恢复可见细节。它与“重新设计光照方向/风格”不同：核心可见控件应是 `lighting_level` 强度，产品名建议使用“暗光增强”或“低光修复”，不宣称为物理补光。

## 2. 接口与队列契约

- 鉴权：`Authorization: Key <FAL_KEY>`
- 直连：`POST https://fal.run/fal-ai/control-light`
- 队列提交：`POST https://queue.fal.run/fal-ai/control-light`
- 状态：`GET https://queue.fal.run/fal-ai/control-light/requests/{request_id}/status`
- 结果：`GET https://queue.fal.run/fal-ai/control-light/requests/{request_id}`
- 取消：`PUT https://queue.fal.run/fal-ai/control-light/requests/{request_id}/cancel`
- 结果路径：`images[].url`；`images` 必填，`seed` 在 OpenAPI 中也标为必填

队列状态仅有 `IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`，`status` 和 `request_id` 必填，日志、指标、队列位置和各 URL 可选。`COMPLETED` 后必须另取结果并校验媒体 URL；模型 OpenAPI 未定义新错误码、断线恢复或乱序规则，其余沿用 [Fal 供应商队列契约](../供应商/Fal.md#2-队列契约)。

## 3. 请求字段

| 字段 | 类型 | 必填 | 默认 / 范围 | 产品策略 |
|---|---|---|---|---|
| `image_url` | string | 是 | 官方未公布文件限制 | 恰好 1 张已有素材，由 Fal CDN 上传 |
| `lighting_level` | number | 否 | `0.75`；`0..1` | 显示并发送；0 近似不处理，1 为训练范围内最强抬升 |
| `prompt` | string | 否 | 官方内置一段保留身份、几何和自然颜色的恢复提示词 | 首版不展示、不发送，使用服务端当前默认 |
| `num_inference_steps` | integer | 否 | `4`；`4..8` | 不展示、不发送 |
| `guidance_scale` | number | 否 | `1`；`0..20` | 不展示、不发送 |
| `enable_safety_checker` | boolean | 否 | `true` | 不展示、不发送，保持官方默认 |
| `seed` | integer/null | 否 | 随机 | 不展示、不发送 |
| `sync_mode` | boolean | 否 | `false` | 不展示、不发送，使用持久队列 |
| `output_format` | enum | 否 | `png`；`jpeg` / `png` / `webp` | 按项目约定不展示、不发送 |

## 4. 示例与响应契约冲突

```json
{
  "image_url": "https://v3.fal.media/files/.../low-light.png",
  "lighting_level": 0.75
}
```

```json
{
  "images": [
    {
      "url": "https://v3b.fal.media/files/.../enhanced.png",
      "width": 768,
      "height": 1360,
      "content_type": "image/png"
    }
  ],
  "has_nsfw_concepts": [false]
}
```

OpenAPI 把 `seed` 标为必填，但同一份官方 `llms.txt` 的字面响应示例缺少 `seed`。因此解析器只应将非空 `images[].url` 作为成功必要条件，`seed` 按可选元数据读取，不得因为缺少 seed 丢弃有效图片。

## 5. 计价与未知项

- 实时 `llms.txt` 标价 `$0.03 / megapixel`，但未字面说明是输入、输出还是处理像素。
- 静态目录可保留 `$0.03/MP` 单位价；在未通过 billing event 校验前，不应把估算值表述成最终账单。
- 官方未给输入图像尺寸/格式上限、输出尺寸算法、延迟 SLA 和结果保留期。
- 真实验收需记录 0 / 0.75 / 1 三档对主体、噪点、高光溢出和计费的影响。

## 6. 原始链接索引

| 内容 | 链接 | 是否需登录 | 核查日期 |
|---|---|---|---|
| 模型页与当前价格 | https://fal.ai/models/fal-ai/control-light | 否 | 2026-08-29 |
| 实时字段、范围、示例与价格 | https://fal.ai/models/fal-ai/control-light/llms.txt | 否 | 2026-08-29 |
| OpenAPI（必填、响应与枚举） | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/control-light | 否 | 2026-08-29 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 | 2026-08-29 |
| Fal 价格 API | https://fal.ai/docs/platform-apis/v1/models/pricing | 否（调用需 Key） | 2026-08-29 |
