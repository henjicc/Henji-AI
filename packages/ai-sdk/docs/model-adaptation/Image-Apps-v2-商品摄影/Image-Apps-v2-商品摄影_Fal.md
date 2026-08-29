# Image Apps v2 商品摄影（Fal）适配资料

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 平台 | Fal |
| 展示名 | Product Photography |
| API endpoint ID | `fal-ai/image-apps-v2/product-photography` |
| 模态 | 单张商品图 → 单张影棚商品图 |
| SDK 入口 | `@henjicc/ai-sdk/tool-models/fal/product-photography` |
| 工具包 | `@henjicc/ai-sdk/tool-packs/fal-image-utility-tools` |
| 价格 | `$0.04 / image` |
| 登录状态 | 模型页、`llms.txt` 与 OpenAPI 公开；真实调用需要 Fal Key |

## 1. 能力与产品边界

该端点会为商品生成写实的影棚式背景和光照。官方 API 只接收商品图和输出比例，没有提示词、背景风格、光照风格、品牌色或生成数量字段。产品首版只能给出“自动商品摄影”能力，不应补造这些控制项。

## 2. 接口与队列契约

- 鉴权：`Authorization: Key <FAL_KEY>`
- 直连：`POST https://fal.run/fal-ai/image-apps-v2/product-photography`
- 队列提交：`POST https://queue.fal.run/fal-ai/image-apps-v2/product-photography`
- 状态：`GET https://queue.fal.run/fal-ai/image-apps-v2/product-photography/requests/{request_id}/status`
- 结果：`GET https://queue.fal.run/fal-ai/image-apps-v2/product-photography/requests/{request_id}`
- 取消：`PUT https://queue.fal.run/fal-ai/image-apps-v2/product-photography/requests/{request_id}/cancel`
- 结果路径：`images[].url`；`images` 必填

通用状态为 `IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`，`status` 和 `request_id` 必填。`COMPLETED` 是状态终态，客户端仍需取结果并确认存在非空 `images[].url`。没有模型专属错误码或新事件，其余使用 [Fal 供应商队列契约](../供应商/Fal.md#2-队列契约)。

## 3. 请求字段

| 字段 | 类型 | 必填 | 默认 / 范围 | 产品策略 |
|---|---|---|---|---|
| `product_image_url` | string | 是 | 官方未公布文件限制 | 恰好 1 张已有素材；这是特殊媒体字段，必须在 `runtimeConstraints.mediaFields` 声明为图片并由 Fal CDN 上传 |
| `aspect_ratio` | `{ratio: enum}` | 否 | `ratio` 子字段默认 `1:1`；枚举 `1:1` / `16:9` / `9:16` / `4:3` / `3:4` | 复用标准智能比例，按首图就近匹配，最终必须发送 `{ratio: '...'}` 对象 |

`aspect_ratio` 描述为“4K 输出比例”，OpenAPI 未提供精确宽高。`smart` 是本地 UI 值，不能原样发给 Fal。

## 4. 请求与响应示例

```json
{
  "product_image_url": "https://v3.fal.media/files/.../product.png",
  "aspect_ratio": { "ratio": "1:1" }
}
```

```json
{
  "images": [
    { "url": "https://v3b.fal.media/files/.../studio-product.png" }
  ]
}
```

## 5. 计价与未知项

- 实时 `llms.txt` 标价 `$0.04 / image`，静态估价为 `$0.04 / 次`。
- 官方未公布输入格式/尺寸/文件大小上限、输出的精确 4K 宽高、延迟 SLA 或背景生成的可控边界。
- 需付费验证透明背景商品、白底商品、人像穿戴商品、文字/商标保持和不同比例的主体完整性。
- 不定义、不发送 `seed`、负面提示词、`output_format` 或文档未声明的字段。

## 6. 原始链接索引

| 内容 | 链接 | 是否需登录 | 核查日期 |
|---|---|---|---|
| 模型页与当前价格 | https://fal.ai/models/fal-ai/image-apps-v2/product-photography | 否 | 2026-08-29 |
| 实时字段、示例与价格 | https://fal.ai/models/fal-ai/image-apps-v2/product-photography/llms.txt | 否 | 2026-08-29 |
| OpenAPI（对象比例、必填与响应） | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-apps-v2/product-photography | 否 | 2026-08-29 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 | 2026-08-29 |
| Fal 价格 API | https://fal.ai/docs/platform-apis/v1/models/pricing | 否（调用需 Key） | 2026-08-29 |
