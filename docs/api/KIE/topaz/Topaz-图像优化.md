# TopazAI 图像增强与放大

基于 Topaz 先进的 AI 放大技术，提升图像分辨率与画质。

**API 端点**
```
POST /api/v1/jobs/createTask
```

## 快速开始

使用 `topaz/image-upscale` 模型进行图像放大。

**请求示例**
```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "topaz/image-upscale",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "image_url": "https://static.aiquickdraw.com/tools/example/1762752805607_mErUj1KR.png",
    "upscale_factor": "2"
  }
}
'
```

**响应示例**
```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_topaz_1765176093786"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取处理结果。建议参考 [获取任务详情](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收任务完成的自动通知，而非轮询状态端点。

## 请求参数说明

### 身份验证 (Authorization)

所有 API 都需要通过 Bearer Token 进行身份验证。

*   **位置**: `header`
*   **类型**: `string`
*   **必需**: 是
*   **说明**: 在请求头中添加 `Authorization: Bearer YOUR_API_KEY`。API Key 可在 [API Key 管理页面](https://kie.ai/api-key) 获取。请妥善保管，切勿泄露。

### 请求体 (Body)

**Content-Type**: `application/json`

| 参数 | 类型 | 必需 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `model` | `enum<string>` | 是 | `topaz/image-upscale` | 用于处理任务的模型名称。**必须**为 `topaz/image-upscale`。 |
| `callBackUrl` | `string<uri>` | 否 | - | 接收任务完成通知的回调 URL。任务处理完成后，系统会向该 URL POST 任务状态与结果。建议在生产环境中使用。 |
| `input` | `object` | 是 | - | 图像放大任务的输入参数。 |

#### `input` 对象属性

| 参数 | 类型 | 必需 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `image_url` | `string` | 是 | - | 待放大图像的 URL。必须是已上传文件的 URL，支持 `image/jpeg`、`image/png`、`image/webp` 格式，最大 10.0MB。 |
| `upscale_factor` | `enum<string>` | 是 | `2` | 图像放大倍数。例如 `2` 表示将宽度和高度都放大至原来的 2 倍。可选值：`1`, `2`, `4`, `8`。 |

## 响应说明

### 成功响应

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | `enum<integer>` | 响应状态码。成功时为 `200`。 |
| `msg` | `string` | 响应消息，成功时为 `"success"`。 |
| `data` | `object` | 响应数据对象。 |

#### `data` 对象属性

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `taskId` | `string` | 任务 ID，可用于调用任务详情端点查询任务状态。 |

### 状态码说明

| 状态码 | 含义 |
| :--- | :--- |
| `200` | 成功 - 请求已处理完成 |
| `401` | 未授权 - 身份验证凭据缺失或无效 |
| `402` | 积分不足 - 账户积分不足以执行该操作 |
| `404` | 未找到 - 请求的资源或端点不存在 |
| `422` | 验证错误 - 请求参数未通过校验 |
| `429` | 速率限制 - 已超出该资源的请求频次限制 |
| `455` | 服务不可用 - 系统正在维护中 |
| `500` | 服务器错误 - 处理请求时发生意外故障 |
| `501` | 生成失败 - 内容生成任务执行失败 |
| `505` | 功能禁用 - 当前请求的功能暂未开放 |