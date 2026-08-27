# Flux Pro Erase · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| SDK 模型 ID | `fal-flux-pro-erase`（可选工具模型，不进入默认 99 目录） |
| Fal endpoint ID | `fal-ai/flux-pro/v1/erase` |
| API 文档 | https://fal.ai/models/fal-ai/flux-pro/v1/erase/api |
| 价格 | 首个生成 MP $0.03，后续 $0.004/MP；参考图 $0.004/MP，至少按 3 MP |
| 登录 | 文档与模型页无需登录；调用需要 Fal Key |

## 协议与字段

使用 Fal 队列公共协议：`POST https://queue.fal.run/<endpoint-id>`，随后查询服务端返回的
`status_url`，状态为 `COMPLETED` 后读取 `response_url`。认证为
`Authorization: Key <FAL_KEY>`。结果位于 `images[].url`。

| 字段 | 约束 | SDK 策略 |
|---|---|---|
| `image_url` | 必填，待处理原图 | `image-upload`，本地媒体由 Fal CDN uploader 自动上传 |
| `mask_url` | 必填，与原图同尺寸；白色擦除、黑色保留 | `image-upload`，自动上传 |
| `dilate_pixels` | 整数，默认 10 | 固定发送 10，不增加宿主控件 |
| `output_format` | `jpeg` / `png`，默认 `jpeg` | 按项目约定不显示、不发送 |
| `sync_mode` | 同步返回 data URI | 不发送，统一使用可恢复队列 |

静态价格展示采用最低约 `$0.042`（1 MP 生成 + 参考图最低 3 MP）；真实费用随输出像素增加。
该模型按需发布为完整 generation pack，统一画像派生为 `operation=image-edit`、`feature=erase`；
执行直接使用模块化生成客户端，不增加专用擦除执行内核。

## 原始链接索引

- https://fal.ai/models/fal-ai/flux-pro/v1/erase/api — endpoint、输入/输出 schema、队列调用。
- https://fal.ai/models/fal-ai/flux-pro/v1/erase — 当前模型页价格与示例结果。
- https://fal.ai/docs/documentation/model-apis/inference/queue — Fal 队列公共协议。
