# Bria Eraser · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| SDK 模型 ID | `fal-bria-eraser`（可选工具模型，不进入默认 105 目录） |
| Fal endpoint ID | `fal-ai/bria/eraser` |
| API 文档 | https://fal.ai/models/fal-ai/bria/eraser/api |
| 价格 | $0.04/次 |
| 登录 | 文档与模型页无需登录；调用需要 Fal Key |

## 协议与字段

使用 Fal 队列公共协议，认证、提交、状态与结果读取同 [Fal 供应商文档](../供应商/Fal.md)。
输出位于 `image.url`。

| 字段 | 约束 | SDK 策略 |
|---|---|---|
| `image_url` | 必填，待处理原图 | `image-upload`，Fal CDN 自动上传 |
| `mask_url` | 必填，二值遮罩 | `image-upload`，Fal CDN 自动上传 |
| `mask_type` | `manual` / `automatic`，默认 `manual` | Photoshop 遮罩来自用户选区/画笔，固定发送 `manual` |
| `preserve_alpha` | 可选 | 插件当前未使用，不发送 |
| `sync_mode` | 可选 | 不发送，统一走队列 |

该模型的统一画像由 schema 派生为图片输入、图片输出、`operation=image-edit`、`feature=erase`；
模型定义仍为 `type: image`，避免制造新的生成模态或执行协议。

## 原始链接索引

- https://fal.ai/models/fal-ai/bria/eraser/api — endpoint、字段、结果与队列示例。
- https://fal.ai/models/fal-ai/bria/eraser — 当前 $0.04/次价格。
- https://fal.ai/docs/documentation/model-apis/inference/queue — Fal 队列公共协议。
