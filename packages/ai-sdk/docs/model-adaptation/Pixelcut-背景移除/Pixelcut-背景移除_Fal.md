# Pixelcut 背景移除（Fal）适配资料

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 平台 | Fal |
| 展示名 | Pixelcut Background Remover |
| API endpoint ID | `pixelcut/background-removal` |
| 模态 | JPEG/PNG 单图 → 透明背景 PNG |
| SDK 入口 | `@henjicc/ai-sdk/tool-models/fal/pixelcut-background-removal` |
| 工具包 | `@henjicc/ai-sdk/tool-packs/fal-image-utility-tools` |
| 价格 | `$0.016 / image` |
| 登录状态 | 模型页、`llms.txt` 与 OpenAPI 公开；真实调用需要 Fal Key |

## 1. 能力与输出模式

Pixelcut 端点支持三种 `output_format`：

- `rgba`：完整 RGBA 结果，返回 `image.url`。
- `alpha`：单独 alpha 结果，返回 `image.url`。
- `zip`：返回 `file.url`。

项目对新模型不显示、不发送 `output_format`，因此该工具使用官方默认 `rgba`，产品契约只接收透明背景图的 `image.url`。`alpha` 和 `zip` 不进入首版。

## 2. 接口与队列契约

- 鉴权：`Authorization: Key <FAL_KEY>`
- 直连：`POST https://fal.run/pixelcut/background-removal`
- 队列提交：`POST https://queue.fal.run/pixelcut/background-removal`
- 状态：`GET https://queue.fal.run/pixelcut/background-removal/requests/{request_id}/status`
- 结果：`GET https://queue.fal.run/pixelcut/background-removal/requests/{request_id}`
- 取消：`PUT https://queue.fal.run/pixelcut/background-removal/requests/{request_id}/cancel`
- 首版结果路径：`image.url`

队列状态仅有 `IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`，`status` / `request_id` 必填。结果 schema 的 `image` 和 `file` 都是可选且可空，所以 `COMPLETED` 后必须取结果并对当前 RGBA 契约严格校验非空 `image.url`；空对象不能当作成功。其余复用 [Fal 供应商队列契约](../供应商/Fal.md#2-队列契约)。

## 3. 请求字段

| 字段 | 类型 | 必填 | 默认 / 范围 | 产品策略 |
|---|---|---|---|---|
| `image_url` | string | 是 | 只明确支持 JPEG / PNG；官方未公布尺寸和文件大小上限 | 恰好 1 张已有素材，经 Fal CDN 上传；提交前校验 MIME/extension |
| `output_format` | enum | 否 | `rgba`；`rgba` / `alpha` / `zip` | 不展示、不发送，使用默认 `rgba` |
| `sync_mode` | boolean | 否 | `true` | **不展示但固定发送 `false`** |

`sync_mode` 是本批工具中必须覆盖官方默认的例外：官方说明 `true` 会返回 data URL，而 Henji-AI 的持久队列和媒体落盘需要 CDN URL。请求 builder 必须固定发送 `sync_mode: false`，不能只依赖平台默认。

## 4. 请求与响应示例

```json
{
  "image_url": "https://v3.fal.media/files/.../product.jpg",
  "sync_mode": false
}
```

```json
{
  "image": {
    "url": "https://cdn3.pixelcut.app/fal/background-remover/result.png"
  }
}
```

## 5. 计价与未知项

- 实时 `llms.txt` 标价 `$0.016 / image`，静态估价为 `$0.016 / 次`。
- 输入文档只写 JPEG / PNG，未说明是否完整保留 EXIF/色彩配置，也未给大小、尺寸、最大主体数、延迟 SLA 和 CDN 保留期。
- 付费验收要覆盖头发/半透明物体、珠宝反射、多主体、白色商品和输入 PNG 透明通道。
- 结果 URL 使用 Pixelcut CDN 而不一定是 `fal.media`，结果解析不能按域名过滤。

## 6. 原始链接索引

| 内容 | 链接 | 是否需登录 | 核查日期 |
|---|---|---|---|
| 模型页与当前价格 | https://fal.ai/models/pixelcut/background-removal | 否 | 2026-08-29 |
| 实时字段、枚举、示例与价格 | https://fal.ai/models/pixelcut/background-removal/llms.txt | 否 | 2026-08-29 |
| OpenAPI（输出可空性、必填与枚举） | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=pixelcut/background-removal | 否 | 2026-08-29 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 | 2026-08-29 |
| Fal 价格 API | https://fal.ai/docs/platform-apis/v1/models/pricing | 否（调用需 Key） | 2026-08-29 |
