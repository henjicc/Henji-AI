# POST ElevenLabs 音效 V2

使用 `elevenlabs/sound-effect-v2` 模型生成音效。

**Endpoint**

```
POST /api/v1/jobs/createTask
```

**请求示例**

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "elevenlabs/sound-effect-v2",
  "input": {},
  "callBackUrl": "https://your-domain.com/api/callback"
}
'
```

**响应示例**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "281e5b0*********************f39b9"
  }
}
```

## 查询任务状态

提交任务后，使用统一的查询端点检查进度并获取结果。对于生产环境，建议使用 `callBackUrl` 参数接收自动通知，而不是轮询状态端点。

## 请求参数

### Authorizations

| 参数名 | 类型 | 位置 | 必填 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| Authorization | string | header | required | Bearer Token 身份验证。格式：`Authorization: Bearer YOUR_API_KEY`。API Key 可在 [API Key 管理页面](https://kie.ai/api-key) 获取。 |

### Body (application/json)

| 参数名 | 类型 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- | :--- |
| model | enum<string> | required | 用于生成的模型名称。此端点必须使用 `elevenlabs/sound-effect-v2`。 | `"elevenlabs/sound-effect-v2"` |
| input | object | required | 生成任务的输入参数。 | |
| callBackUrl | string<uri> | optional | 接收生成任务完成更新的 URL。建议在生产环境中使用。 | `"https://your-domain.com/api/callback"` |

## 响应

### 请求成功

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| code | enum<integer> | 响应状态码。 |
| msg | string | 响应消息，失败时为错误描述。 |
| data | object | 响应数据。 |

#### data 对象

| 字段名 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| taskId | string | 任务 ID，可用于查询任务状态。 | `"task_elevenlabs_12345678"` |

### 状态码说明

| 状态码 | 说明 |
| :--- | :--- |
| 200 | 成功 - 请求已成功处理。 |
| 401 | 未授权 - 身份验证凭据缺失或无效。 |
| 402 | 积分不足 - 账户没有足够的积分执行操作。 |
| 404 | 未找到 - 请求的资源或端点不存在。 |
| 422 | 验证错误 - 请求参数未通过验证检查。 |
| 429 | 速率限制 - 已超过此资源的请求限制。 |
| 455 | 服务不可用 - 系统正在维护中。 |
| 500 | 服务器错误 - 处理请求时发生意外错误。 |
| 501 | 生成失败 - 内容生成任务失败。 |
| 505 | 功能已禁用 - 请求的功能当前已禁用。 |