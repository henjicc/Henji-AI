# ElevenLabs 文生语音 多语言 V2

使用 `elevenlabs/text-to-speech-multilingual-v2` 模型生成语音内容。

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "elevenlabs/text-to-speech-multilingual-v2",
  "input": {},
  "callBackUrl": "https://your-domain.com/api/callback"
}
'
```

## 响应示例

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

提交任务后，使用统一的查询端点检查进度并获取结果。建议参考 **[获取任务详情](/cn/market/common/get-task-detail)** 文档。

对于生产环境，我们建议使用 `callBackUrl` 参数接收自动通知，而不是轮询状态端点。

## 请求参数

### Authorizations

**Authorization** `string` (header, required)

所有 API 都需要通过 Bearer Token 进行身份验证。

获取 API Key：
1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

使用方法：
添加到请求头：
```
Authorization: Bearer YOUR_API_KEY
```

**注意：**
* 请妥善保管您的 API Key，不要与他人共享。
* 如果您怀疑 API Key 已泄露，请立即在管理页面重置。

### Body (application/json)

**model** `enum<string>` (required)

用于生成的模型名称。必填字段。

* 此端点必须使用 `elevenlabs/text-to-speech-multilingual-v2`

可用选项：
`elevenlabs/text-to-speech-multilingual-v2`

示例：
`"elevenlabs/text-to-speech-multilingual-v2"`

**input** `object` (required)

生成任务的输入参数。

**callBackUrl** `string<uri>`

接收生成任务完成更新的 URL。可选但建议在生产环境中使用。

* 当生成完成时，系统将向此 URL POST 任务状态和结果。
* 回调包含生成的 URL 和任务信息。
* 您的回调端点应接受包含结果的 JSON 负载的 POST 请求。
* 或者，使用获取任务详情端点轮询任务状态。

示例：
`"https://your-domain.com/api/callback"`

## 响应参数

请求成功

**code** `enum<integer>`

响应状态码。

* 200: 成功 - 请求已成功处理
* 401: 未授权 - 身份验证凭据缺失或无效
* 402: 积分不足 - 账户没有足够的积分执行操作
* 404: 未找到 - 请求的资源或端点不存在
* 422: 验证错误 - 请求参数未通过验证检查
* 429: 速率限制 - 已超过此资源的请求限制
* 455: 服务不可用 - 系统正在维护中
* 500: 服务器错误 - 处理请求时发生意外错误
* 501: 生成失败 - 内容生成任务失败
* 505: 功能已禁用 - 请求的功能当前已禁用

可用选项：
`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

**msg** `string`

响应消息，失败时为错误描述。

示例：
`"success"`

**data** `object`

**data.taskId** `string`

任务 ID，可用于获取任务详情端点查询任务状态。

示例：
`"task_elevenlabs_12345678"`