# Bria 创意放大（Fal）

## 契约

| 项目 | 内容 |
|---|---|
| endpoint ID | `bria/upscale/creative` |
| 输入 | `image_url`；Fal 有示例默认图，应用仍严格要求用户提供 1 张源图 |
| 输出 | `image: Image`，约 2×，最高 10MP |
| 参数 | `preserve_alpha`，默认 true |
| 隐藏字段 | `seed`、`sync_mode` |
| 价格 | `$0.04/张` |
| 资料核查 | 2026-08-29；公开，无需登录 |

## 队列与适配

使用 `Authorization: Key <FAL_KEY>` 调用 `https://queue.fal.run`，复用标准 Fal
`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED` 队列、取消和 URL 提取。canonical ID 为
`bria-creative-upscale`，应用模型 ID 为 `fal-ai-bria-creative-upscale`。

画布按固定 2× 预估尺寸，在上传前阻止超过 10MP 的输出；透明源图允许提交并默认保留 alpha。该模型属于
创意增强，可能生成新纹理，界面不使用“无损”措辞。已完成端点、请求、固定价、alpha 和输出上限的离线测试；
未执行真实付费生成。

## 一手资料

| 信息 | 链接 | 登录 |
|---|---|---|
| API 文档 | https://fal.ai/models/bria/upscale/creative/api | 否 |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bria/upscale/creative | 否 |
| API Key | https://fal.ai/dashboard/keys | 是 |
