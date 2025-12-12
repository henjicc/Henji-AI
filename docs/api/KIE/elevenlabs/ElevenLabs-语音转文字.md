# ElevenLabs 语音转文字

使用 `elevenlabs/speech-to-text` 模型将语音转换为文字。

## 请求示例

**端点**
```
POST /api/v1/jobs/createTask
```

**cURL 示例**
```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "elevenlabs/speech-to-text",
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

**Authorization**
*   **类型**: `string`
*   **位置**: `header`
*   **必需**: 是
*   **描述**: 所有 API 都需要通过 Bearer Token 进行身份验证。
    *   获取 API Key：访问 [API Key 管理页面](https://kie.ai/api-key)。
    *   使用方法：添加到请求头：`Authorization: Bearer YOUR_API_KEY`
    *   注意：请妥善保管您的 API Key，不要与他人共享。如果您怀疑 API Key 已泄露，请立即在管理页面重置。

### Body

**Content-Type**: `application/json`

**model**
*   **类型**: `enum<string>`
*   **必需**: 是
*   **默认值**: `elevenlabs/speech-to-text`
*   **描述**: 用于生成的模型名称。此端点必须使用 `elevenlabs/speech-to-text`。
*   **示例**: `"elevenlabs/speech-to-text"`

**input**
*   **类型**: `object`
*   **必需**: 是
*   **描述**: 生成任务的输入参数。

**callBackUrl**
*   **类型**: `string<uri>`
*   **必需**: 否
*   **描述**: 接收生成任务完成更新的 URL。可选但建议在生产环境中使用。
    *   当生成完成时，系统将向此 URL POST 任务状态和结果。
    *   回调包含生成的 URL 和任务信息。
    *   您的回调端点应接受包含结果的 JSON 负载的 POST 请求。
    *   或者，使用获取任务详情端点轮询任务状态。
*   **示例**: `"https://your-domain.com/api/callback"`

## 响应

### 请求成功

**code**
*   **类型**: `enum<integer>`
*   **描述**: 响应状态码。
    *   `200`: 成功 - 请求已成功处理
    *   `401`: 未授权 - 身份验证凭据缺失或无效
    *   `402`: 积分不足 - 账户没有足够的积分执行操作
    *   `404`: 未找到 - 请求的资源或端点不存在
    *   `422`: 验证错误 - 请求参数未通过验证检查
    *   `429`: 速率限制 - 已超过此资源的请求限制
    *   `455`: 服务不可用 - 系统正在维护中
    *   `500`: 服务器错误 - 处理请求时发生意外错误
    *   `501`: 生成失败 - 内容生成任务失败
    *   `505`: 功能已禁用 - 请求的功能当前已禁用

**msg**
*   **类型**: `string`
*   **描述**: 响应消息，失败时为错误描述。
*   **示例**: `"success"`

**data**
*   **类型**: `object`

**data.taskId**
*   **类型**: `string`
*   **描述**: 任务 ID，可用于获取任务详情端点查询任务状态。
*   **示例**: `"task_elevenlabs_12345678"`