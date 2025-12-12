# Sora2 图生视频

基于 Sora-2-image-to-video 先进 AI 模型，将静态图像转换为动态视频。

## 快速开始

使用 `sora-2-image-to-video` 模型从图像生成视频。

### 请求示例

**Endpoint:**
```
POST /api/v1/jobs/createTask
```

**cURL 示例:**
```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "sora-2-image-to-video",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "一位黏土动画风格的指挥家饱含激情地指挥着黏土动画管弦乐队，整个乐团齐声欢快地合唱：“Sora 2 现已在 Kie AI 上线。”",
    "image_urls": [
      "https://file.aiquickdraw.com/custom-page/akr/section-images/17594315607644506ltpf.jpg"
    ],
    "aspect_ratio": "landscape",
    "n_frames": "10",
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
    "taskId": "task_sora-2-image-to-video_1765184045509"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。详情请参考 [Get Task Details](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 接口规范

### 认证 (Authorization)

所有 API 都需要通过 Bearer Token 进行身份验证。

**Header:**
```
Authorization: Bearer YOUR_API_KEY
```

**获取 API Key：**
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

**注意事项：**
*   请妥善保管您的 API Key，切勿泄露给他人。
*   若怀疑 API Key 泄露，请立即在管理页面重置。

### 请求体 (Body)

**Content-Type:** `application/json`

| 参数 | 类型 | 必填 | 默认值 | 描述 | 示例 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **model** | `enum<string>` | 是 | `sora-2-image-to-video` | 用于生成任务的模型名称。该端点必须使用 `sora-2-image-to-video` 模型。 | `"sora-2-image-to-video"` |
| **callBackUrl** | `string<uri>` | 否 | - | 接收生成任务完成通知的回调 URL。建议在生产环境中使用。<br>• 任务生成完成后，系统会向该 URL POST 任务状态与结果。<br>• 回调内容包含生成视频的 URL 与任务相关信息。<br>• 您的回调端点需要支持接收带 JSON 负载的 POST 请求。 | `"https://your-domain.com/api/callback"` |
| **input** | `object` | 是 | - | 生成任务的输入参数。 | - |
| **input.prompt** | `string` | 是 | - | 描述期望视频运动效果的文本提示词。<br>**最大长度：** `10000` 字符。 | `"一位黏土动画风格的指挥家饱含激情地指挥着黏土动画管弦乐队..."` |
| **input.image_urls** | `string<uri>[]` | 是 | - | 作为视频首帧的图像 URL。<br>• 必须可公开访问。<br>• 为上传后的文件 URL，非文件内容。<br>• 支持类型：`image/jpeg`, `image/png`, `image/webp`。<br>• 最大文件大小：`10.0MB`。<br>**最大数组长度：** `1` | `["https://file.aiquickdraw.com/.../image.jpg"]` |
| **input.aspect_ratio** | `enum<string>` | 否 | `landscape` | 定义视频的画面比例。<br>可用选项：`portrait`, `landscape` | `"landscape"` |
| **input.n_frames** | `enum<string>` | 否 | `10` | 要生成的视频帧数。<br>可用选项：`10`, `15` | `"10"` |
| **input.remove_watermark** | `boolean` | 否 | - | 启用该参数时，将移除生成视频中的水印。 | `true` |

### 响应 (Response)

**请求成功示例：**
```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_sora-2-image-to-video_1765184045509"
  }
}
```

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| **code** | `enum<integer>` | 响应状态码。<br>可用选项：`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505` |
| **msg** | `string` | 响应消息，请求失败时为错误描述。 |
| **data** | `object` | 响应数据。 |
| **data.taskId** | `string` | 任务 ID，可用于调用任务详情端点查询任务状态。 |

**状态码说明：**
*   **200:** 成功 - 请求已处理完成。
*   **401:** 未授权 - 身份验证凭据缺失或无效。
*   **402:** 积分不足 - 账户积分不足以执行该操作。
*   **404:** 未找到 - 请求的资源或端点不存在。
*   **422:** 验证错误 - 请求参数未通过校验。
*   **429:** 速率限制 - 已超出该资源的请求频次限制。
*   **455:** 服务不可用 - 系统正在维护中。
*   **500:** 服务器错误 - 处理请求时发生意外故障。
*   **501:** 生成失败 - 内容生成任务执行失败。
*   **505:** 功能禁用 - 当前请求的功能暂未开放。