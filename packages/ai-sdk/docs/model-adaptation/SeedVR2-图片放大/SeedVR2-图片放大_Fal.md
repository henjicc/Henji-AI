# SeedVR2 图片放大（Fal）

## 契约

| 项目 | 内容 |
|---|---|
| endpoint ID | `fal-ai/seedvr/upscale/image` |
| 输入 | `image_url`，应用严格要求 1 张图片 |
| 官方模式 | `factor` 或 `target`；应用只开放 factor 模式 |
| 应用参数 | 2×/4×、`noise_scale` 0～1（默认 0.1） |
| 隐藏字段 | `seed`、`output_format`、`sync_mode`、target resolution |
| 输出 | `image: File` |
| 价格 | Fal 标价 `$0.001/MP` |
| 资料核查 | 2026-08-29；公开，无需登录 |

官方价格只标明 megapixels billing unit，没有在公开页明确它指输入还是输出。应用采用“预计输出 MP ×
$0.001”的保守展示口径，并在价格文案中明确这是估价；实际账单仍以 Fal billing event 为准。

## 请求示例

```json
{
  "image_url": "https://example.com/source.jpg",
  "upscale_mode": "factor",
  "upscale_factor": 4,
  "noise_scale": 0.1
}
```

## 队列与适配

使用 `Authorization: Key <FAL_KEY>` 调用 `https://queue.fal.run`，状态为 `IN_QUEUE`、
`IN_PROGRESS`、`COMPLETED`。canonical ID 为 `seedvr2-image-upscale`，应用模型 ID 为
`fal-ai-seedvr2-image-upscale`。默认 JPG 输出不保证 alpha，因此画布预检会提示透明图改用专用模型。
已完成端点、字段钳制、单图限制、2×/4×预检和输出 MP 估价的离线测试；未执行真实付费生成。

## 一手资料

| 信息 | 链接 | 登录 |
|---|---|---|
| API 文档 | https://fal.ai/models/fal-ai/seedvr/upscale/image/api | 否 |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/seedvr/upscale/image | 否 |
| API Key | https://fal.ai/dashboard/keys | 是 |
