# Finegrain Eraser (Mask) · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-28 |
| SDK 模型 ID | `fal-finegrain-eraser`（可选工具模型，不进入默认 99 目录） |
| Fal endpoint ID | `fal-ai/finegrain-eraser/mask` |
| API 文档 | https://fal.ai/models/fal-ai/finegrain-eraser/mask/api |
| 价格 | Express $0.04 / Standard $0.13 / Premium $0.22 |
| 登录 | 文档与模型页无需登录；调用需要 Fal Key |

## 协议与字段

使用 Fal 队列公共协议，认证、提交、状态与结果读取同 [Fal 供应商文档](../供应商/Fal.md)。
输出位于 `image.url`。

| 字段 | 约束 | SDK 策略 |
|---|---|---|
| `image_url` | 必填，待处理原图 | `image-upload`，Fal CDN 自动上传 |
| `mask_url` | 必填；白色区域擦除 | `image-upload`，Fal CDN 自动上传 |
| `mode` | `express` / `standard` / `premium`，默认 `standard` | 保留为唯一可选参数 |
| `seed` | 可选 | 项目约定隐藏且不请求 |

Fal 另有 prompt/box 端点；本次严格适配 Photoshop 已启用的 mask 工具，不顺手扩张范围。
统一画像从本模型 schema 派生为 `operation=image-edit`、`feature=erase`，执行仍走统一 Fal 生成内核。

## 原始链接索引

- https://fal.ai/models/fal-ai/finegrain-eraser/mask/api — mask endpoint、字段、结果与队列示例。
- https://fal.ai/models/fal-ai/finegrain-eraser/mask — 当前三档价格。
- https://fal.ai/docs/documentation/model-apis/inference/queue — Fal 队列公共协议。
