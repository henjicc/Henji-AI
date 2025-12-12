# Sora2 水印移除

使用 `sora-watermark-remover` 模型进行视频去水印处理。

## API 调用

**端点：** `POST /api/v1/jobs/createTask`

**请求示例：**

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "sora-watermark-remover",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "video_url": "https://sora.chatgpt.com/p/s_68e83bd7eee88191be79d2ba7158516f"
  }
}
'
```

**成功响应示例：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_sora-watermark-remover_1765183831860"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。建议查阅 [获取任务详情](/cn/market/common/get-task-detail) 文档。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 相关资源

* [Market 概览](/cn/market/quickstart)
* [通用 API](/cn/common-api/get-account-credits)

## 请求参数说明

### Authorizations

**Authorization**
*   **类型：** `string`
*   **位置：** `header`
*   **必需：** 是
*   **描述：** 所有 API 都需要通过 Bearer Token 进行身份验证。
    *   **获取 API Key：** 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。
    *   **使用方法：** 在请求头中添加：`Authorization: Bearer YOUR_API_KEY`
    *   **注意事项：** 请妥善保管您的 API Key，切勿泄露给他人。若怀疑 API Key 泄露，请立即在管理页面重置。

### Body

**Content-Type:** `application/json`

**model**
*   **类型：** `enum<string>`
*   **默认值：** `sora-watermark-remover`
*   **必需：** 是
*   **描述：** 用于处理任务的模型名称。该端点必须使用 `sora-watermark-remover` 模型。
*   **可用选项：** `sora-watermark-remover`
*   **示例：** `"sora-watermark-remover"`

**callBackUrl**
*   **类型：** `string<uri>`
*   **必需：** 否
*   **描述：** 接收去水印任务完成通知的回调 URL。可选配置，建议在生产环境中使用。
    *   任务处理完成后，系统会向该 URL POST 任务状态与结果。
    *   回调内容包含处理后视频的 URL 与任务相关信息。
    *   您的回调端点需要支持接收带 JSON 负载的 POST 请求。
    *   也可以选择调用任务详情端点，主动轮询任务状态。
*   **示例：** `"https://your-domain.com/api/callback"`

**input**
*   **类型：** `object`
*   **描述：** 去水印任务的输入参数。
    *   **input.video_url**
        *   **类型：** `string`
        *   **必需：** 是
        *   **描述：** 输入 Sora 2 生成的视频 URL — 必须是 OpenAI 提供的可公开访问链接（以 sora.chatgpt.com 开头）。
        *   **最大长度：** `500`
        *   **示例：** `"https://sora.chatgpt.com/p/s_68e83bd7eee88191be79d2ba7158516f"`

## 响应说明

**请求成功**

**code**
*   **类型：** `enum<integer>`
*   **描述：** 响应状态码。
    *   `200`: 成功 - 请求已处理完成
    *   `401`: 未授权 - 身份验证凭据缺失或无效
    *   `402`: 积分不足 - 账户积分不足以执行该操作
    *   `404`: 未找到 - 请求的资源或端点不存在
    *   `422`: 验证错误 - 请求参数未通过校验
    *   `429`: 速率限制 - 已超出该资源的请求频次限制
    *   `455`: 服务不可用 - 系统正在维护中
    *   `500`: 服务器错误 - 处理请求时发生意外故障
    *   `501`: 生成失败 - 内容生成任务执行失败
    *   `505`: 功能禁用 - 当前请求的功能暂未开放
*   **可用选项：** `200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

**msg**
*   **类型：** `string`
*   **描述：** 响应消息，请求失败时为错误描述。
*   **示例：** `"success"`

**data**
*   **类型：** `object`
    *   **data.taskId**
        *   **类型：** `string`
        *   **描述：** 任务 ID，可用于调用任务详情端点查询去水印任务状态。
        *   **示例：** `"task_sora-watermark-remover_1765183831860"`