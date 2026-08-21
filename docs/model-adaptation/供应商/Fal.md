# Fal · 供应商基础文档

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 供应商类型 | 模型 API 平台 + Serverless |
| 项目内 `providerId` | `fal` |
| 直连 Base URL | `https://fal.run` |
| 队列 Base URL | `https://queue.fal.run` |
| 平台 API Base URL | `https://api.fal.ai/v1` |
| 鉴权 | `Authorization: Key <FAL_KEY>` |
| 推荐任务模式 | 生产环境使用持久化队列 |
| 文档/价格可见性 | 公开，无需登录；账户余额和用量需 Key |

## 1. 端点形式

Fal 的 endpoint ID 本身就是路由，例如 `fal-ai/flux/dev`。不要只保存市场展示名。

| 用途 | 方法与 URL |
|---|---|
| 直连同步调用 | `POST https://fal.run/<endpoint-id>` |
| 提交队列 | `POST https://queue.fal.run/<endpoint-id>` |
| 查询状态 | `GET https://queue.fal.run/<endpoint-id>/requests/<request_id>/status` |
| 获取结果 | `GET https://queue.fal.run/<endpoint-id>/requests/<request_id>` |
| 取消 | `PUT https://queue.fal.run/<endpoint-id>/requests/<request_id>/cancel` |
| 当前价格 | `GET https://api.fal.ai/v1/models/pricing?endpoint_id=...` |
| 价格预估 | `POST https://api.fal.ai/v1/models/pricing/estimate` |
| 账户账单/余额 | `GET https://api.fal.ai/v1/account/billing?expand=credits` |

## 2. 队列契约

### 2.1 提交

```bash
curl -X POST https://queue.fal.run/fal-ai/flux/dev \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cat"}'
```

官方 REST 示例直接发送模型输入对象。Henji-AI 的 provider 运行时会按当前网关契约包为 `{ "input": ... }`；新模型接入时必须用该 endpoint 的实时 `llms.txt`/OpenAPI 验证最终请求形状。

提交结果：

```json
{
  "request_id": "764cabcf-b745-4b3e-ae38-1200304cf45b",
  "response_url": "https://queue.fal.run/.../response",
  "status_url": "https://queue.fal.run/.../status",
  "cancel_url": "https://queue.fal.run/.../cancel",
  "queue_position": 0
}
```

保存 `request_id`；也可保存完整 `status_url`，避免续轮询时重建错误路由。

### 2.2 状态和结果

| 队列状态 | 含义 |
|---|---|
| `IN_QUEUE` | 已持久化，等待 runner |
| `IN_PROGRESS` | runner 正在处理 |
| `COMPLETED` | 已终止；需检查 `error` / `error_type`，并获取结果 |

队列状态与 Webhook 状态不同：Webhook 使用 `OK` / `ERROR`。桌面端默认轮询，不要把 Webhook 状态枚举混入轮询解析。

结果结构按模型变化：图片常见 `images[].url`，视频常见 `video.url`，音频常见 `audio_url` 或 `audio.url`。必须以单模型 `llms.txt` 的实时 output schema 为准。

## 3. 文件上传

Fal 模型的通用输入形式是 URL。本地文件推荐先上传到 Fal CDN：

```javascript
const url = await fal.storage.upload(file)
```

| 项目 | 说明 |
|---|---|
| CDN URL | `https://v3b.fal.media/files/...` |
| 大文件 | SDK 自动 multipart；JS 通常 90 MB 以上进入分片 |
| 文件类型 | 上传层不限制，具体模型会限制格式和大小 |
| 私有 URL | 需自带 Authorization 的 URL 不能直接作模型输入；改用预签名 URL 或 Fal CDN |
| Data URI | 部分模型接受，但不是全平台通用契约，不适合较大文件 |

Fal CDN 会根据账户的 media expiration 设置清理媒体。需要长期保存的输入/输出要及时转存。

## 4. 计价查询

Fal 是五家中价格 API 最完整的一家。

### 4.1 当前单价

```bash
curl "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux/dev" \
  -H "Authorization: Key $FAL_KEY"
```

返回 `prices[]`，关键字段为 `endpoint_id`、`unit_price`、币种和 billing unit。同一账户的专属折扣可反映在查询结果中。

### 4.2 成本预估

`POST /v1/models/pricing/estimate` 支持两种模式：

- `historical_api_price`：根据账户过往调用的历史单次成本预估。
- `unit_price`：按当前单价 × 预期 billing units 预估。

静态模型定义里的价格用于首屏快速显示；接入前必须再核对单模型 `https://fal.ai/models/<endpoint-id>/llms.txt` 或价格 API。

## 5. 余额与对账

```bash
curl "https://api.fal.ai/v1/account/billing?expand=credits" \
  -H "Authorization: Key $FAL_ADMIN_KEY"
```

返回 `credits.current_balance` 和币种。注意该端点需要 **Admin API Key**，不应假设普通模型调用 Key 一定具有账单权限。

更细对账可使用 `/v1/models/usage` 和 `/v1/models/billing-events`，其中 billing event 可按 `request_id` 查看实际 billing unit、折扣与 `cost_total`。

## 6. 项目当前实现

| 能力 | 状态 | 说明 |
|---|---|---|
| `fal.run` 直连 | 已接入 | 模型请求体含 `sync_mode: true` 时使用 |
| `queue.fal.run` 队列 | 已接入 | 默认生成路径 |
| 状态与结果 | 已接入 | 支持 `status_url` 和按 endpoint/request ID 重建 |
| 结果 URL 解析 | 已接入 | 递归收集模型结果中的 URL |
| 本地文件 | 已支持当前模型 | 当前转 Data URI；新增不接受 Data URI 或大文件模型时，先补 Fal CDN 公共上传 |
| 价格/余额 API | 尚未用于连接检测 | 文档已记录；余额需 Admin Key，优先级低 |

## 7. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| Agent 文档总索引 | https://fal.ai/llms.txt | 否 |
| 调用方式总览 | https://fal.ai/docs/documentation/model-apis/inference | 否 |
| 队列提交/查询/结果 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| Fal CDN | https://fal.ai/docs/documentation/model-apis/fal-cdn | 否 |
| 计价说明 | https://fal.ai/docs/documentation/model-apis/pricing | 否 |
| 价格 API | https://fal.ai/docs/platform-apis/v1/models/pricing | 否 |
| 成本预估 API | https://fal.ai/docs/platform-apis/v1/models/pricing/estimate | 否 |
| 账户余额 | https://fal.ai/docs/platform-apis/v1/account/billing | 否（调用需 Admin Key） |
| API Key | https://fal.ai/dashboard/keys | 是 |
