# Topaz 透明图放大（Fal）

## 契约

| 项目 | 内容 |
|---|---|
| endpoint ID | `topaz/upscale/image/transparent` |
| 输入 | `image_url`，应用严格要求 1 张图片 |
| 输出 | 固定 4×、固定 PNG，保留 alpha 通道；`image: File` |
| 参数 | 无用户参数；官方 `output_format` 固定为 PNG，应用不重复下发 |
| 价格 | 每开始 24 输出 MP `$0.08`，按实际固定 4× 输出尺寸估价 |
| 资料核查 | 2026-08-29；公开，无需登录 |

## 队列与鉴权

使用 `Authorization: Key <FAL_KEY>` 调用 `https://queue.fal.run`：提交后轮询
`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`，再从结果中的 `image.url` 获取输出；取消使用 endpoint 与
`request_id` 组成的 `/cancel` 地址。复用 SDK 现有 Fal 上传、轮询、取消和结果解析，不新增协议分支。

## 适配决策

- canonical ID：`topaz-transparent-upscale`；应用模型 ID：`fal-ai-topaz-transparent-upscale`。
- 该模型独立于 Topaz 主入口，避免把固定 4× 和透明语义伪装成普通倍率选项。
- `pricing.mediaContext` 声明固定 4× 的输出面积换算，宿主共享价格层读取源图尺寸后按输出 MP 阶梯估价；媒体指标不可用时不显示伪造兜底价。
- 画布预检允许透明源图，并按相同的 4× 规则复核输出尺寸与价格；输入文件沿用 20MiB 安全上限。
- 已完成端点、请求体、固定倍率、alpha 预检与像素阶梯计价的离线测试；未执行真实付费生成。

## 一手资料

| 信息 | 链接 | 登录 |
|---|---|---|
| API 文档 | https://fal.ai/models/topaz/upscale/image/transparent/api | 否 |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=topaz/upscale/image/transparent | 否 |
| API Key | https://fal.ai/dashboard/keys | 是 |
