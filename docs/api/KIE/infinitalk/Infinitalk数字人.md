# Infinitalk 音频生成

基于 `infinitalk/from-audio` 模型，使用音频文件生成交互式数字人视频。

## API 调用

**请求方法**: `POST`
**端点**: `https://api.kie.ai/api/v1/jobs/createTask`

### 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "infinitalk/from-audio",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1757329269873ggqj2hz3.png",
    "audio_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1757329255705mmqwrnri.mp3",
    "prompt": "一位留着深色长发的年轻女性正在录制播客。",
    "resolution": "480p"
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
    "taskId": "task_infinitalk_1765186308151"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询接口查看任务进度并获取结果。建议参考 [Get Task Details](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

## 请求参数说明

### Authorizations

**Authorization**
*   **类型**: `string`
*   **位置**: `header`
*   **必需**: 是
*   **描述**: 所有 API 均需通过 Bearer Token 进行身份验证。
*   **获取方式**:
    1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取你的 API Key。
*   **使用方法**: 在请求头中添加 `Authorization: Bearer YOUR_API_KEY`。
*   **注意事项**:
    *   请妥善保管你的 API Key，切勿泄露给他人。
    *   若怀疑 API Key 已泄露，请立即在管理页面重置。

### Body

**Content-Type**: `application/json`

#### model
*   **类型**: `enum<string>`
*   **必需**: 是
*   **默认值**: `infinitalk/from-audio`
*   **描述**: 用于生成任务的模型名称。该接口必须使用 `infinitalk/from-audio` 模型。
*   **可用选项**: `infinitalk/from-audio`
*   **示例**: `"infinitalk/from-audio"`

#### callBackUrl
*   **类型**: `string<uri>`
*   **必需**: 否
*   **描述**: 接收生成任务完成通知的回调 URL。生产环境建议使用。
    *   任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果。
    *   回调内容包含生成内容的 URL 及任务相关信息。
    *   你的回调接口需支持接收 POST 请求及 JSON 格式的请求体。
    *   也可选择调用任务详情接口，主动轮询任务状态。
*   **示例**: `"https://your-domain.com/api/callback"`

#### input
*   **类型**: `object`
*   **必需**: 是
*   **描述**: 生成任务的输入参数。

**input.image_url**
*   **类型**: `string`
*   **必需**: 是
*   **描述**: 输入图像的 URL。若输入图像与选定的宽高比不匹配，系统会对其进行缩放并居中裁剪。
    *   需为上传后的文件 URL，而非文件内容。
    *   支持的格式：`image/jpeg`、`image/png`、`image/webp`。
    *   最大文件大小：10.0MB。
*   **示例**: `"https://file.aiquickdraw.com/custom-page/akr/section-images/1757329269873ggqj2hz3.png"`

**input.audio_url**
*   **类型**: `string`
*   **必需**: 是
*   **描述**: 音频文件的 URL。
    *   需为上传后的文件 URL，而非文件内容。
    *   支持的格式：`audio/mpeg`、`audio/wav`、`audio/x-wav`、`audio/aac`、`audio/mp4`、`audio/ogg`。
    *   最大文件大小：10.0MB。
*   **示例**: `"https://file.aiquickdraw.com/custom-page/akr/section-images/1757329255705mmqwrnri.mp3"`

**input.prompt**
*   **类型**: `string`
*   **必需**: 是
*   **最大长度**: `5000`
*   **描述**: 用于指导视频生成的文本提示词。
*   **示例**: `"一位留着深色长发的年轻女性正在录制播客。"`

**input.resolution**
*   **类型**: `enum<string>`
*   **必需**: 否
*   **默认值**: `480p`
*   **描述**: 待生成视频的分辨率。仅支持 480p 或 720p。
*   **可用选项**: `480p`, `720p`
*   **示例**: `"480p"`

**input.seed**
*   **类型**: `number`
*   **必需**: 否
*   **描述**: 用于结果可复现的随机种子值。有效范围为 10000 至 1000000。

## 响应说明

### 请求成功

**code**
*   **类型**: `enum<integer>`
*   **描述**: 响应状态码。
*   **可用选项及含义**:
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

**msg**
*   **类型**: `string`
*   **描述**: 响应消息，请求失败时返回错误描述。
*   **示例**: `"success"`

**data**
*   **类型**: `object`
*   **描述**: 响应数据。

**data.taskId**
*   **类型**: `string`
*   **描述**: 任务 ID，可用于调用任务详情接口查询任务状态。
*   **示例**: `"task_infinitalk_1765186308151"`