# POST Kling V1 Avatar Standard

基于 Kling 先进 AI 模型生成数字人视频。

## 接口说明

**端点**: `POST /api/v1/jobs/createTask`

**功能**: 使用 `kling/v1-avatar-standard` 模型生成 AI 数字人内容。

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "kling/v1-avatar-standard",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/17579268936223zs9l3dt.png",
    "audio_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/17579258340109gghun47.mp3",
    "prompt": ""
  }
}
'
```

## 成功响应示例

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_kling_1765185996677"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询接口查看任务进度并获取结果。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

## 授权

### Authorization

*   **位置**: `header`
*   **类型**: `string`
*   **必需**: 是

所有 API 均需通过 Bearer Token 进行身份验证。

**获取 API Key 步骤**:
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取你的 API Key。

**使用方法**:
在请求头中添加以下参数：
```
Authorization: Bearer YOUR_API_KEY
```

**注意事项**:
*   请妥善保管你的 API Key，切勿泄露给他人。
*   若怀疑 API Key 已泄露，请立即在管理页面重置。

## 请求体 (application/json)

### model

*   **类型**: `enum<string>`
*   **必需**: 是
*   **默认值**: `kling/v1-avatar-standard`

用于生成任务的模型名称。必填字段。

*   该接口必须使用 `kling/v1-avatar-standard` 模型。

**可用选项**:
*   `kling/v1-avatar-standard`

**示例**:
```json
"kling/v1-avatar-standard"
```

### callBackUrl

*   **类型**: `string<uri>`
*   **必需**: 否

接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。

*   任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果。
*   回调内容包含生成内容的 URL 及任务相关信息。
*   你的回调接口需支持接收 POST 请求及 JSON 格式的请求体。
*   也可选择调用任务详情接口，主动轮询任务状态。

**示例**:
```json
"https://your-domain.com/api/callback"
```

### input

*   **类型**: `object`
*   **必需**: 是

生成任务的输入参数。

#### input.image_url

*   **类型**: `string`
*   **必需**: 是

用作数字人形象的图像 URL。
*   需为上传后的文件 URL，而非文件内容。
*   支持的格式：`image/jpeg`, `image/png`, `image/webp`。
*   最大文件大小：10.0MB。

**示例**:
```json
"https://file.aiquickdraw.com/custom-page/akr/section-images/17579268936223zs9l3dt.png"
```

#### input.audio_url

*   **类型**: `string`
*   **必需**: 是

音频文件的 URL。
*   需为上传后的文件 URL，而非文件内容。
*   支持的格式：`audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/aac`, `audio/mp4`, `audio/ogg`。
*   最大文件大小：10.0MB。

**示例**:
```json
"https://file.aiquickdraw.com/custom-page/akr/section-images/17579258340109gghun47.mp3"
```

#### input.prompt

*   **类型**: `string`
*   **必需**: 是
*   **最大长度**: 5000 字符

用于视频生成的提示词。

**示例**:
```json
""
```

## 响应

### 请求成功

#### code

*   **类型**: `enum<integer>`

响应状态码。
*   `200`: 成功 - 请求已处理完成。
*   `401`: 未授权 - 身份验证凭据缺失或无效。
*   `402`: 积分不足 - 账户余额不足以执行该操作。
*   `404`: 未找到 - 请求的资源或接口不存在。
*   `422`: 参数验证错误 - 请求参数未通过校验。
*   `429`: 调用频率超限 - 已超出该资源的请求限制。
*   `455`: 服务不可用 - 系统正在维护中。
*   `500`: 服务器内部错误 - 处理请求时发生意外故障。
*   `501`: 生成失败 - 内容生成任务执行失败。
*   `505`: 功能禁用 - 当前请求的功能已被禁用。

**可用选项**:
`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

#### msg

*   **类型**: `string`

响应消息，请求失败时返回错误描述。

**示例**:
```json
"success"
```

#### data

*   **类型**: `object`

##### data.taskId

*   **类型**: `string`

任务 ID，可用于调用任务详情接口查询任务状态。

**示例**:
```json
"task_kling_1765185996677"
```