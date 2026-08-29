# Ideogram 图片放大（Fal）

## 契约

| 项目 | 内容 |
|---|---|
| endpoint ID | `fal-ai/ideogram/upscale` |
| 输入 | `image_url`，应用严格要求 1 张图片 |
| 输出 | `images: File[]`，最高约 2× |
| 应用参数 | resemblance 1～100、detail 1～100，默认均为 50 |
| 隐藏字段 | prompt、expand_prompt、seed、sync_mode |
| 价格 | `$0.06/张` |
| 资料核查 | 2026-08-29；公开，无需登录 |

## 请求示例

```json
{
  "image_url": "https://example.com/source.jpg",
  "resemblance": 50,
  "detail": 50
}
```

## 队列与适配

使用 `Authorization: Key <FAL_KEY>` 调用 `https://queue.fal.run`，状态为 `IN_QUEUE`、
`IN_PROGRESS`、`COMPLETED`，结果沿用 Fal 通用递归 URL 提取。canonical ID 为 `ideogram-upscale`，
应用模型 ID 为 `fal-ai-ideogram-upscale`。

画布按固定 2× 预估尺寸；默认输出路径不承诺保留 alpha，透明源图会在上传前提示改用专用模型。当前不开放
提示词，以保持“高清放大”工具的单图、无提示词交互。已完成端点、范围钳制、固定价与预检离线测试；
未执行真实付费生成。

## 一手资料

| 信息 | 链接 | 登录 |
|---|---|---|
| API 文档 | https://fal.ai/models/fal-ai/ideogram/upscale/api | 否 |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ideogram/upscale | 否 |
| API Key | https://fal.ai/dashboard/keys | 是 |
