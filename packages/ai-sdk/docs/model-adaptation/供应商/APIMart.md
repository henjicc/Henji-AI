# APIMart · 供应商基础文档

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 供应商类型 | 聚合中转（非模型原厂） |
| 项目内 providerId | `apimart` |
| 主域名 | `apimart.ai`（海外主站） |
| 中国大陆友好域名 | `apib.ai` / `aiuxu.com` / `aishuch.com`（**本目录中唯一提供大陆备用线路的供应商**） |
| 鉴权 | `Authorization: Bearer <API Key>` |
| 任务模型 | 异步为主（提交拿 `task_id` → 轮询 / Webhook） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 端点

### 1.1 Base URL 与备用域名

官方文档只写了一个地址：

```
https://api.apimart.ai
```

但 APIMart 站点在登录页顶部提供了**备用访问域名**面板，原文：「网络访问受限时，请使用支持中国大陆的域名，建议收藏备用。」

| 站点域名 | 定位 | API 端点 | 上传端点 | 文档站 |
|---|---|---|---|---|
| `apimart.ai` | 海外主站 | `https://api.apimart.ai` | `https://upload.apimart.ai` | `https://docs.apimart.ai` |
| `apib.ai` | 中国大陆可用 | `https://api.apib.ai` | `https://upload.apib.ai` | `https://docs.apib.ai` |
| `aiuxu.com` | 中国大陆可用 | `https://api.aiuxu.com` | `https://upload.aiuxu.com` | `https://docs.aiuxu.com` |
| `aishuch.com` | 中国大陆可用 | `https://api.aishuch.com` | `https://upload.aishuch.com` | `https://docs.aishuch.com` |

**实测结论（2026-08-22，未登录 curl）**：四个 `api.*` 主机对 `GET /v1/models` 均返回 `401 {"error":{"message":"API key is required ...","type":"apimart_error"}}`，即**四条线路都是同一套 API，仅域名不同，路径与协议完全一致**；四个 `upload.*` 主机均返回 200。

> 适配含义：Base URL 应当**可配置或有受控备用线路**，而不是只硬编码 `api.apimart.ai`，否则大陆用户在主线路不可达时无法自救。当前代码状态见第 9 节（连通性探测 + 进程内记忆，不做地理位置判断）。
>
> 注意：生成结果 URL 与上传返回 URL 用的是**请求时那条线路的 `upload.*` 域名**，切换线路后旧结果链接是否仍可访问未验证，转存时按原域名下载。

### 1.2 API 端点一览

| 用途 | 方法与路径 | 说明 |
|---|---|---|
| 图片生成 | `POST /v1/images/generations` | 统一图片入口，模型由 body 的 `model` 决定 |
| 视频生成 | `POST /v1/videos/generations` | 统一视频入口 |
| Midjourney 专用 | `POST /v1/midjourney/{action}` | 18 个端点，见 [Midjourney_APIMart.md](../Midjourney/Midjourney_APIMart.md) |
| 查询任务 | `GET /v1/tasks/{task_id}?language=zh` | 统一任务查询 |
| MJ 风格查询 | `GET /v1/midjourney/{task_id}` | 额外返回 `buttons[].customId` |
| 上传图片 | `POST /v1/uploads/images` | multipart |
| 令牌余额 | `GET /v1/balance`（别名 `GET /balance`） | 单个 API Key 维度 |
| 用户余额 | `GET /v1/user/balance`（别名 `GET /user/balance`） | 主账号维度 |
| 模型列表 | `GET /v1/models`（带 `expand` 可返回参数 schema） | 文本模型元数据为主 |
| 文本模型定价 | `GET /api/pricing/model` | 只对 TokenPricingV2 文本模型有效，**图片/视频模型不走这个** |

## 2. 鉴权

```
Authorization: Bearer <API Key>
Content-Type: application/json
```

API Key 在 https://apimart.ai/keys 创建（**需登录**），可设置额度上限、模型权限白名单、IP 白名单。

## 3. 提交与查询

### 3.1 提交

同步返回 `task_id`，实际生成异步进行。本项目当前额外下发两个请求头（见 `providers/apimart.ts`）：

- `Idempotency-Key: <requestId>`：APIMart 支持幂等键，重放不会重复计费
- `X-APIMart-Response-Version: 2026-07-27`：锁定响应结构版本，避免上游改结构导致解析失效

> 当前公开快速开始、开发指南和 API 参考中未找到这两个 Header 的稳定契约说明。文档将它们标记为“项目已有行为”，不把它们当作新客户端必须复制的公开协议。

### 3.2 轮询

`GET /v1/tasks/{task_id}?language=zh`

```json
{
  "code": 200,
  "data": {
    "id": "task_01KA040M0HP1GJWBJYZMKX1XS1",
    "status": "completed",
    "cost": 0.15,
    "credits_cost": 1.5,
    "progress": 100,
    "result": { "images": [{ "url": ["https://upload.apimart.ai/f/image/...png"], "expires_at": 1763174708 }] },
    "created": 1763088289,
    "completed": 1763088308,
    "estimated_time": 60,
    "actual_time": 19
  }
}
```

| 字段 | 说明 |
|---|---|
| `status` | `pending` / `processing` / `completed` / `failed` / `cancelled` |
| `cost` | 本次任务扣费金额（美元） |
| `credits_cost` | 本次任务扣费积分 |
| `progress` | 0–100 |
| `estimated_time` / `actual_time` | 预计 / 实际耗时（秒） |
| `error` | 仅 `failed` 时存在，含 `code` / `message` / `type` |

**结果字段**：图片在 `data.result.images[]`，视频在 `data.result.videos[]`，音频在 `data.result.audios[]`。
**注意 `images[].url` 可能是数组**（一次出多张时），解析必须兼容 string 与 string[]。

Midjourney 有一套额外的 MJ 风格状态（`NOT_START` / `SUBMITTED` / `IN_PROGRESS` / `MODAL` / `SUCCESS` / `FAILURE`），其中 `MODAL` 是合法的非终态。

### 3.3 Webhook（可替代轮询）

提交时在 body 里加 `webhook` 字段（**基础地址**，服务端会自动拼 `/callback`）：

| 你填的 `webhook` | 实际 POST 到 |
|---|---|
| `https://your-server.com` | `https://your-server.com/callback` |
| `https://your-server.com/api` | `https://your-server.com/api/callback` |

- 推送内容与 `GET /v1/tasks/{id}` 完全一致，可复用同一套解析
- 只在终态（`completed` / `failed`）推送，处理中不推
- 未在 ~10 秒内返回 `2xx` 或返回 `5xx` → 自动重试 **3 次**，间隔约 10s / 30s / 60s；返回 `4xx` 直接放弃
- 极端情况可能重复推送，**必须按 `id` 做幂等去重**
- 地址要求：公网可访问（内网地址被拒）、标准端口（80/443）、不能指向 APIMart 自己的域名

> 桌面端没有公网回调地址，本项目用轮询，不使用 Webhook。这里记录是为了说明 `webhook` 字段存在且**不应注册为用户可见参数**。

## 4. 上传文件

`POST /v1/uploads/images`，`multipart/form-data`，字段名 `file`。

| 项目 | 值 |
|---|---|
| 支持格式 | JPEG / PNG / WebP / GIF |
| 最大体积 | 20 MB |
| 有效期 | **72 小时** |
| 返回 | `{ "url", "filename", "content_type", "bytes", "created_at" }` |
| 返回 URL 形态 | `https://upload.apimart.ai/f/image/<id>-<uuid>-<name>.jpg` |

```bash
curl -X POST https://api.apimart.ai/v1/uploads/images \
  -H "Authorization: Bearer $APIMART_KEY" \
  -F 'file=@/path/to/image.jpg'
```

错误：`400` 缺文件字段 / 格式不支持，`413` 超过 20 MB，`429` 频率限制，`500` 上传失败。

**⚠️ 文档明确写了重要变更**：「为了更好的性能和成本控制，我们不再支持在生成接口中直接传入 base64 图片数据。请使用本接口上传图片，获取 URL 后再调用生成接口。」

本项目已在公共媒体预处理层接入该接口（见第 9 节）：本地图片和 data URI 图片会先上传，再把公网 URL 交给生成接口。

**没有通用的视频/音频上传接口**：只有 Suno、Flow Music 等模型自带的专用上传端点。视频类输入只能传公网 URL。

## 5. 获取结果

- 结果 URL 由 `upload.<域名>` 提供，公开可访问，无需鉴权
- 有效期由 `result.images[].expires_at`（Unix 时间戳）给出，多数模型 24 小时，Seedream 5.0 系列 72 小时
- 无二次签名接口，**必须在有效期内转存**

## 6. 计价查询

| 方式 | 位置 | 说明 |
|---|---|---|
| 定价中心（权威） | https://apimart.ai/zh/pricing | 公开无需登录，图片/视频模型价格以此为准 |
| 任务返回值 | `data.cost`（美元）、`data.credits_cost`（积分） | **实际扣费**，最可信 |
| 文档正文价格 | 各模型 API 文档页 | **经常过期**，与定价中心冲突时以定价中心为准（例：Seedream 5.0 Pro 文档写 $0.045/$0.09，定价中心是 $0.02928/$0.05856） |
| 定价 API | `GET /api/pricing/model` | **仅文本模型**，图片/视频用不上 |

## 7. 余额查询

两个端点，返回结构几乎一致：

```bash
curl https://api.apimart.ai/v1/balance      -H "Authorization: Bearer $KEY"   # 令牌维度
curl https://api.apimart.ai/v1/user/balance -H "Authorization: Bearer $KEY"   # 用户维度
```

```json
{ "success": true, "remain_balance": 10.5, "remain_credits": 105,
  "used_balance": 2.3, "used_credits": 23, "unlimited_quota": false }
```

- 无限额度令牌：`unlimited_quota: true`，且 `remain_balance` / `remain_credits` 返回 `-1`
- 失败时仍返回 HTTP 200，靠 `success: false` + `message` 判断
- 余额单位取决于系统配置（USD 或积分）

## 8. 错误码

| HTTP | 含义 | 处理 |
|---|---|---|
| 400 | 请求参数错误 | 不重试，修参数 |
| 401 | 认证失败 | 不重试 |
| 402 | 余额不足 | 不重试，提示充值 |
| 403 | 无权限 | 不重试 |
| 429 | 频率限制 | 退避重试 |
| 500 | 服务器错误 | 退避重试 |
| 502 | 网关错误 | 退避重试 |

响应体统一为 `{"error": {"code", "message", "type"}}`，`type` 取值如 `invalid_request_error` / `authentication_error` / `payment_required` / `permission_error` / `rate_limit_error` / `server_error` / `bad_gateway`。

## 9. 本项目当前实现与差异

| 项目 | 位置 |
|---|---|
| 请求执行 | [src/providers/apimart.ts](../../../src/providers/apimart.ts) |
| 连接检测 / 余额 | [src/providers/connection.ts](../../../src/providers/connection.ts) → `GET /v1/balance` |
| 上传改写 | [src/upload/preprocess.ts](../../../src/upload/preprocess.ts) → APIMart 图片走 `uploadToApiMart` |
| 上传实现 | [src/upload/providers.ts](../../../src/upload/providers.ts) → `POST /v1/uploads/images` |
| Key / 链接配置 | [src/core/config/providers.ts](../../../../../src/core/config/providers.ts) |

已知差异：

1. Base URL 默认顺序是 `api.apimart.ai` → `api.apib.ai` → `api.aiuxu.com` → `api.aishuch.com`；仅在能证明尚未建立连接的网络故障下受控切换下一个域名，不对已建立连接的失败重放计费请求。不做地理位置判断，改用**连通性探测 + 进程内记忆**：任意一次请求成功命中某个域名后（含应用启动时的后台预热探测），该域名会被记为本次进程运行期间的优先域名，后续请求直接从它开始尝试，其余域名仍留作 fallback；缓存只在内存中，不持久化，应用重启后重新判断。实现见 [src/providers/endpoints/apimart.ts](../../../src/providers/endpoints/apimart.ts)，启动预热调用见 [electron/main/index.ts](../../../../../electron/main/index.ts)（仅在已配置 APIMart Key 时触发，不阻塞启动）
2. 图片已经接入 `/v1/uploads/images`；APIMart 没有通用视频 / 音频上传端点，公共预处理层会明确拒绝这两类本地文件并提示改用公网 URL，具体模型有专用上传协议时再单独接入
3. `extractUrls` 已处理 `images[].url` 为数组的情况（`collectDeepUrls` 深挖），无需改
4. 未使用 Webhook（桌面端合理），不需要改

## 10. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文档总索引（llms.txt） | https://docs.apimart.ai/llms.txt | 否 |
| 快速开始（Base URL、示例） | https://docs.apimart.ai/cn/quickstart | 否 |
| 开发指南（轮询、错误码） | https://docs.apimart.ai/cn/development | 否 |
| 连接与使用问题（端点地址确认） | https://docs.apimart.ai/cn/faqs/connection-usage | 否 |
| 上传图片 | https://docs.apimart.ai/cn/api-reference/uploads/images | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 任务完成回调（Webhook） | https://docs.apimart.ai/cn/api-reference/tasks/webhook | 否 |
| 查询令牌余额 | https://docs.apimart.ai/cn/api-reference/account/token-balance | 否 |
| 查询用户余额 | https://docs.apimart.ai/cn/api-reference/account/user-balance | 否 |
| 定价中心 | https://apimart.ai/zh/pricing | 否 |
| **备用访问域名面板**（`apib.ai` / `aiuxu.com` / `aishuch.com`） | https://apimart.ai/zh/login | 否（面板在登录页，但页面本身无需登录即可看到） |
| API Key 管理 | https://apimart.ai/keys | **是** |
| 控制台 | https://apimart.ai/overview | **是** |

> 文档站所有页面在 URL 末尾加 `.md` 可直接拿到原始 Markdown，例如 `https://docs.apimart.ai/cn/quickstart.md`。
