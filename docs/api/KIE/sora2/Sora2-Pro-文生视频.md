# Sora2 Pro 文生视频

基于 Sora-2-pro-text-to-video 先进 AI 模型，通过文本描述生成高质量视频。

## 接口调用

**端点：** `POST /api/v1/jobs/createTask`

### 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "sora-2-pro-text-to-video",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "一只快乐的小狗在花园里奔跑",
    "aspect_ratio": "landscape",
    "n_frames": "10",
    "size": "high",
    "remove_watermark": true
  }
}
'
```

### 响应示例

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_sora-2-pro-text-to-video_1765183463848"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 请求参数说明

### Authorizations

**Authorization**

*   **类型**: `string`
*   **位置**: `header`
*   **必需**: `true`

所有 API 都需要通过 Bearer Token 进行身份验证。

**使用方法：**
在请求头中添加：`Authorization: Bearer YOUR_API_KEY`

**注意事项：**
*   请妥善保管您的 API Key，切勿泄露给他人。
*   若怀疑 API Key 泄露，请立即在管理页面重置。

### Body

**model**

*   **类型**: `enum<string>`
*   **必需**: `true`
*   **默认值**: `sora-2-pro-text-to-video`

用于生成任务的模型名称。必填字段。
*   该端点必须使用 `sora-2-pro-text-to-video` 模型。

**callBackUrl**

*   **类型**: `string<uri>`
*   **必需**: `false`

接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。
*   任务生成完成后，系统会向该 URL POST 任务状态与结果。
*   回调内容包含生成的资源 URL 与任务相关信息。
*   您的回调端点需要支持接收带 JSON 负载的 POST 请求。
*   也可以选择调用任务详情端点，主动轮询任务状态。

**input**

*   **类型**: `object`
*   **必需**: `true`

生成任务的输入参数。

**input.prompt**

*   **类型**: `string`
*   **必需**: `true`
*   **最大长度**: `10000`

描述期望视频运动效果的文本提示词。

**input.aspect_ratio**

*   **类型**: `enum<string>`
*   **必需**: `false`
*   **默认值**: `landscape`

该参数用于定义视频的画面比例。
可用选项：`portrait`, `landscape`

**input.n_frames**

*   **类型**: `enum<string>`
*   **必需**: `false`
*   **默认值**: `10`

要生成的视频帧数。
可用选项：`10`, `15`

**input.size**

*   **类型**: `enum<string>`
*   **必需**: `false`
*   **默认值**: `high`

生成视频的画质/尺寸等级。
可用选项：`standard`, `high`

**input.remove_watermark**

*   **类型**: `boolean`
*   **必需**: `false`

启用该参数时，将移除生成视频中的水印（布尔值：true/false）。

## 响应说明

**code**

*   **类型**: `enum<integer>`

响应状态码。
可用选项：
`200` (成功), `401` (未授权), `402` (积分不足), `404` (未找到), `422` (验证错误), `429` (速率限制), `455` (服务不可用), `500` (服务器错误), `501` (生成失败), `505` (功能禁用)

**msg**

*   **类型**: `string`

响应消息，请求失败时为错误描述。

**data**

*   **类型**: `object`

**data.taskId**

*   **类型**: `string`

任务 ID，可用于调用任务详情端点查询任务状态。