# Topaz 视频优化

基于 Topaz 先进 AI 超分技术，提升视频分辨率与画质。

## 接口说明

**端点：** `POST /api/v1/jobs/createTask`

**功能：** 使用 `topaz/video-upscale` 模型对视频进行超分放大。

### 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "topaz/video-upscale",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "video_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1758166466095hvbwkrpw.mp4",
    "upscale_factor": "2"
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
    "taskId": "task_topaz_1765185786549"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询接口查看任务进度并获取结果。

生产环境中，建议使用 `callBackUrl` 参数接收处理完成的自动通知，而非轮询状态接口。

## 授权说明

所有 API 均需通过 Bearer Token 进行身份验证。

**获取 API Key 步骤：**
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取你的 API Key。

**使用方法：**
在请求头中添加以下参数：
`Authorization: Bearer YOUR_API_KEY`

**注意事项：**
*   请妥善保管你的 API Key，切勿泄露给他人。
*   若怀疑 API Key 已泄露，请立即在管理页面重置。

## 请求体参数

**Content-Type:** `application/json`

### model

**类型:** `enum<string>`
**默认值:** `topaz/video-upscale`
**必需:** 是

用于处理任务的模型名称。

*   该接口必须使用 `topaz/video-upscale` 模型。

**可用选项：**
*   `topaz/video-upscale`

**示例：**
```json
"topaz/video-upscale"
```

### callBackUrl

**类型:** `string<uri>`
**必需:** 否

接收处理任务完成通知的回调 URL。可选配置，生产环境建议使用。

*   任务处理完成后，系统会向该 URL 以 POST 方式推送任务状态和结果。
*   回调内容包含处理后内容的 URL 及任务相关信息。
*   你的回调接口需支持接收 POST 请求及 JSON 格式的请求体。
*   也可选择调用任务详情接口，主动轮询任务状态。

**示例：**
```json
"https://your-domain.com/api/callback"
```

### input

**类型:** `object`
**必需:** 是

处理任务的输入参数。

#### input.video_url

**类型:** `string`
**必需:** 是

待超分放大的视频 URL。
*   需为上传后的文件 URL，而非文件内容。
*   支持的格式：`video/mp4`、`video/quicktime`、`video/x-matroska`。
*   最大文件大小：10.0MB。

**示例：**
```json
"https://file.aiquickdraw.com/custom-page/akr/section-images/1758166466095hvbwkrpw.mp4"
```

#### input.upscale_factor

**类型:** `enum<string>`
**默认值:** `2`
**必需:** 否

视频超分放大倍数（例如：2.0 表示将视频宽度和高度放大至原尺寸的 2 倍）。

**可用选项：**
*   `1`
*   `2`
*   `4`

**示例：**
```json
"2"
```

## 响应说明

### 请求成功

#### code

**类型:** `enum<integer>`
**描述:** 响应状态码。

**可用选项及含义：**
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

#### msg

**类型:** `string`
**描述:** 响应消息，请求失败时返回错误描述。

**示例：**
```json
"success"
```

#### data

**类型:** `object`

##### data.taskId

**类型:** `string`
**描述:** 任务 ID，可用于调用任务详情接口查询任务状态。

**示例：**
```json
"task_topaz_1765185786549"
```