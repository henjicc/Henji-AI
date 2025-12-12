# POST Sora2 文生视频

基于 Sora-2-text-to-video 先进 AI 模型，通过文本描述生成高质量视频。

**请求方法：** POST  
**请求路径：** `/api/v1/jobs/createTask`

## 快速开始

使用 `sora-2-text-to-video` 模型从文本生成视频。

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "sora-2-text-to-video",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "一位教授站在气氛活跃的教室前排，满怀热情地授课。他身后的黑板上画着色彩鲜艳的粉笔示意图，他用生动的手势向学生们宣布：“Sora 2 现已在 Kie AI 上线，让创作惊艳视频变得前所未有的简单。” 学生们专注听讲，有人面带微笑，有人认真记笔记。",
    "aspect_ratio": "landscape",
    "n_frames": "10",
    "remove_watermark": true
  }
}
'
```

**响应示例：**
```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_sora-2-text-to-video_1765184035859"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 请求参数

### Authorizations

#### Authorization
* **类型：** `string`
* **位置：** `header`
* **必需：** 是

所有 API 都需要通过 Bearer Token 进行身份验证。

**获取 API Key：**
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

**使用方法：**
在请求头中添加：
```
Authorization: Bearer YOUR_API_KEY
```

**注意事项：**
*   请妥善保管您的 API Key，切勿泄露给他人。
*   若怀疑 API Key 泄露，请立即在管理页面重置。

### Body

**类型：** `application/json`

#### model
* **类型：** `enum<string>`
* **默认值：** `sora-2-text-to-video`
* **必需：** 是

用于生成任务的模型名称。该端点必须使用 `sora-2-text-to-video` 模型。

**可用选项：**
*   `sora-2-text-to-video`

**示例：**
```json
"sora-2-text-to-video"
```

#### callBackUrl
* **类型：** `string<uri>`
* **必需：** 否

接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。

*   任务生成完成后，系统会向该 URL POST 任务状态与结果。
*   回调内容包含生成视频的 URL 与任务相关信息。
*   您的回调端点需要支持接收带 JSON 负载的 POST 请求。
*   也可以选择调用任务详情端点，主动轮询任务状态。

**示例：**
```json
"https://your-domain.com/api/callback"
```

#### input
* **类型：** `object`
* **必需：** 是

生成任务的输入参数。

##### input.prompt
* **类型：** `string`
* **必需：** 是
* **最大长度：** 10000

描述期望视频运动效果的文本提示词。

**示例：**
```json
"一位教授站在气氛活跃的教室前排，满怀热情地授课。他身后的黑板上画着色彩鲜艳的粉笔示意图，他用生动的手势向学生们宣布：“Sora 2 现已在 Kie AI 上线，让创作惊艳视频变得前所未有的简单。” 学生们专注听讲，有人面带微笑，有人认真记笔记。"
```

##### input.aspect_ratio
* **类型：** `enum<string>`
* **默认值：** `landscape`
* **必需：** 否

该参数用于定义视频的画面比例。

**可用选项：**
*   `portrait`
*   `landscape`

**示例：**
```json
"landscape"
```

##### input.n_frames
* **类型：** `enum<string>`
* **默认值：** `10`
* **必需：** 否

要生成的视频帧数。

**可用选项：**
*   `10`
*   `15`

**示例：**
```json
"10"
```

##### input.remove_watermark
* **类型：** `boolean`
* **必需：** 否

启用该参数时，将移除生成视频中的水印（布尔值：true/false）。

**示例：**
```json
true
```

## 响应参数

### 请求成功

#### code
* **类型：** `enum<integer>`

响应状态码。
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

**可用选项：**
`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

#### msg
* **类型：** `string`

响应消息，请求失败时为错误描述。

**示例：**
```json
"success"
```

#### data
* **类型：** `object`

##### data.taskId
* **类型：** `string`

任务 ID，可用于调用任务详情端点查询任务状态。

**示例：**
```json
"task_sora-2-text-to-video_1765184035859"
```