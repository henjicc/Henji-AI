# Sora2 Pro 图生视频

基于 Sora-2-pro-image-to-video 先进 AI 模型，将静态图像转换为动态视频。

## 接口说明

**端点：** `POST /api/v1/jobs/createTask`

**模型：** `sora-2-pro-image-to-video`

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "sora-2-pro-image-to-video",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "",
    "image_urls": [],
    "aspect_ratio": "landscape",
    "n_frames": "10",
    "size": "standard",
    "remove_watermark": true
  }
}
'
```

## 响应示例

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_sora-2-pro-image-to-video_1765183474472"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 授权说明

所有 API 都需要通过 Bearer Token 进行身份验证。

**获取 API Key：**
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

**使用方法：**
在请求头中添加：`Authorization: Bearer YOUR_API_KEY`

**注意事项：**
*   请妥善保管您的 API Key，切勿泄露给他人。
*   若怀疑 API Key 泄露，请立即在管理页面重置。

## 请求体参数

**Content-Type:** `application/json`

| 参数 | 类型 | 必填 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `model` | `enum<string>` | 是 | `sora-2-pro-image-to-video` | 用于生成任务的模型名称。该端点必须使用 `sora-2-pro-image-to-video` 模型。<br>**示例：** `"sora-2-pro-image-to-video"` |
| `callBackUrl` | `string<uri>` | 否 | - | 接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。<br>任务生成完成后，系统会向该 URL POST 任务状态与结果。您的回调端点需要支持接收带 JSON 负载的 POST 请求。<br>**示例：** `"https://your-domain.com/api/callback"` |
| `input` | `object` | 是 | - | 生成任务的输入参数。 |

### input 对象参数

| 参数 | 类型 | 必填 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| `input.prompt` | `string` | 是 | - | 描述期望视频运动效果的文本提示词。<br>**最大长度：** 10000 字符。<br>**示例：** `""` |
| `input.image_urls` | `string<uri>[]` | 是 | - | 作为视频首帧的图像 URL。必须可公开访问（为上传后的文件 URL，非文件内容）。<br>**支持类型：** image/jpeg、image/png、image/webp。<br>**最大文件大小：** 10.0MB。<br>**最大数组长度：** 1。<br>**示例：** `[]` |
| `input.aspect_ratio` | `enum<string>` | 否 | `landscape` | 定义视频的画面比例。<br>**可用选项：** `portrait`, `landscape`<br>**示例：** `"landscape"` |
| `input.n_frames` | `enum<string>` | 否 | `10` | 要生成的视频帧数。<br>**可用选项：** `10`, `15`<br>**示例：** `"10"` |
| `input.size` | `enum<string>` | 否 | `standard` | 生成视频的画质/尺寸等级。<br>**可用选项：** `standard`, `high`<br>**示例：** `"standard"` |
| `input.remove_watermark` | `boolean` | 否 | - | 启用该参数时，将移除生成视频中的水印。<br>**示例：** `true` |

## 响应参数

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| `code` | `enum<integer>` | 响应状态码。<br>**可用选项：** `200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`<br>**说明：** <br>• 200: 成功 - 请求已处理完成<br>• 401: 未授权 - 身份验证凭据缺失或无效<br>• 402: 积分不足 - 账户积分不足以执行该操作<br>• 404: 未找到 - 请求的资源或端点不存在<br>• 422: 验证错误 - 请求参数未通过校验<br>• 429: 速率限制 - 已超出该资源的请求频次限制<br>• 455: 服务不可用 - 系统正在维护中<br>• 500: 服务器错误 - 处理请求时发生意外故障<br>• 501: 生成失败 - 内容生成任务执行失败<br>• 505: 功能禁用 - 当前请求的功能暂未开放 |
| `msg` | `string` | 响应消息，请求失败时为错误描述。<br>**示例：** `"success"` |
| `data` | `object` | 响应数据对象。 |

### data 对象参数

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| `data.taskId` | `string` | 任务 ID，可用于调用任务详情端点查询任务状态。<br>**示例：** `"task_sora-2-pro-image-to-video_1765183474472"` |