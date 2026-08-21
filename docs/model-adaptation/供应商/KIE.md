# KIE · 供应商基础文档

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 供应商类型 | 聚合中转（非模型原厂） |
| 项目内 `providerId` | `kie` |
| 生成 Base URL | `https://api.kie.ai` |
| 上传 Base URL | `https://kieai.redpandaai.co` |
| 鉴权 | `Authorization: Bearer <API Key>` |
| 任务模式 | Market 模型统一异步任务 |
| 文档/价格可见性 | 公开，无需登录；API Key 和账单需登录 |

## 1. 基础端点

| 用途 | 方法与路径 | 说明 |
|---|---|---|
| 创建 Market 任务 | `POST /api/v1/jobs/createTask` | body 为 `model` + `input`，可选 `callBackUrl` |
| 查询 Market 任务 | `GET /api/v1/jobs/recordInfo?taskId=...` | 所有 Market 模型的统一查询入口 |
| 查询剩余积分 | `GET /api/v1/chat/credit` | 返回 `data` 整数积分 |
| 换取生成文件下载链 | `POST /api/v1/common/download-url` | 仅接受 KIE 生成文件 URL |
| 文件流上传 | `POST https://kieai.redpandaai.co/api/file-stream-upload` | multipart，适合本地文件 |
| URL 转存 | `POST https://kieai.redpandaai.co/api/file-url-upload` | JSON，从远程 URL 下载并转存 |
| Base64 上传 | `POST https://kieai.redpandaai.co/api/file-base64-upload` | JSON，适合小文件 |

KIE 还有 Suno、4o Image、Runway 等历史/专用 API。新的 Market 模型优先使用统一 `jobs` 契约；只有官方文档明确不走 Market 时才新增专用分支。

## 2. 提交和查询

### 2.1 创建任务

```json
{
  "model": "<market-model-id>",
  "callBackUrl": "https://your-server.example/callback",
  "input": { "prompt": "..." }
}
```

成功时返回 `data.taskId`。`callBackUrl` 为可选项；桌面端没有稳定公网回调地址，Henji-AI 使用轮询。

### 2.2 轮询

`GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=<taskId>`

| 字段 | 含义 |
|---|---|
| `data.state` | `waiting` / `queuing` / `generating` / `success` / `fail` |
| `data.resultJson` | 成功后的 JSON 字符串，必须再次解析 |
| `data.failCode` / `data.failMsg` | 失败码和可见原因 |
| `data.progress` | 部分模型返回进度 |
| `data.creditsConsumed` | 该任务实际消耗的积分 |

最常见的成功结果：

```json
{
  "data": {
    "state": "success",
    "resultJson": "{\"resultUrls\":[\"https://...\"]}",
    "creditsConsumed": 50
  }
}
```

`resultJson` 不只有 `resultUrls`；个别模型返回 `images`、`videos`、`resultObject`、`firstFrameUrl` 或 `lastFrameUrl`。公共运行时已覆盖这些媒体 URL 形态，模型文档仍必须记录例外结构。

## 3. 文件上传

### 3.1 本地文件

```bash
curl -X POST https://kieai.redpandaai.co/api/file-stream-upload \
  -H "Authorization: Bearer $KIE_KEY" \
  -F "uploadPath=henji-uploads" \
  -F "fileName=reference.png" \
  -F "file=@/path/reference.png"
```

返回值历史上出现过两种字段，适配时兼容：

- `data.fileUrl`
- `data.downloadUrl`

项目上传时不主动指定远端 `fileName`，由 KIE 生成唯一文件名，避免同名覆盖后的 CDN 缓存短暂返回旧内容。

### 3.2 有效期冲突

KIE 官方快速开始和页面提醒写“24 小时后删除”，文件流 OpenAPI 的描述/示例又出现“3 天”。在官方消除冲突前，项目以 **24 小时** 作为保守上限，以实际返回 `expiresAt` 为准。

## 4. 获取和保存结果

- `resultJson.resultUrls[]` 通常可直接下载。
- 如果生成 URL 是 KIE 内部临时地址，可调用 `POST /api/v1/common/download-url` 换取下载链。
- 该换链接口不接受外部 URL，传入非 KIE 文件会返回 `422`。
- 媒体结果必须及时转存，不把供应商临时 URL 当永久资产。

## 5. 计价和余额

| 来源 | 用途 |
|---|---|
| `https://kie.ai/pricing` | 当前公开价格；按模型、模式、分辨率、时长等分行 |
| 模型 API 文档 | 请求 schema 和模型级计费描述 |
| `data.creditsConsumed` | 已完成任务的实际积分消耗，对账优先级最高 |
| `GET /api/v1/chat/credit` | 当前剩余积分，返回 `{ code, msg, data }` |

定价页的 `/client/v1/model-pricing/*` 是站点内部数据源，并非公开开发者稳定契约，项目不直接依赖。

## 6. 项目当前实现

| 能力 | 状态 | 位置 |
|---|---|---|
| Market 任务提交 | 已接入 | `providers/kie.ts` |
| 统一轮询 | 已接入 | `providers/kie.ts` |
| `resultJson` 解析 | 已接入 | `providers/kie.ts` |
| 文件流上传 | 已接入 | `upload-providers.ts` |
| 余额/连接检测 | 已接入 | `provider-connection.ts` |
| 换取下载链 | 未作为通用必经步骤 | 只在结果 URL 确实不可直下时再接入 |

## 7. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| 文档总索引 | https://docs.kie.ai/llms.txt | 否 |
| Market 统一任务查询 | https://docs.kie.ai/cn/market/common/get-task-detail | 否 |
| 文件上传快速开始 | https://docs.kie.ai/cn/file-upload-api/quickstart | 否 |
| 文件流上传 | https://docs.kie.ai/cn/file-upload-api/upload-file-stream | 否 |
| 获取剩余积分 | https://docs.kie.ai/cn/common-api/get-account-credits | 否 |
| 换取生成文件下载链 | https://docs.kie.ai/cn/common-api/download-url | 否 |
| 定价页 | https://kie.ai/pricing | 否 |
| API Key | https://kie.ai/api-key | 是 |
