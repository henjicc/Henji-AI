# POST Bytedance V1 Lite 图生视频

基于字节跳动先进 AI 模型，将静态图片转化为动态视频。

**请求方法：** POST
**请求路径：** `/api/v1/jobs/createTask`

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "bytedance/v1-lite-image-to-video",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "多镜头画面。一名旅人穿越无垠沙漠，走向发光的拱门。【切镜】他抵达巨大的石质门槛时，斗篷在风中翻飞。【广角镜头】他迈步穿过拱门——随即消失在一道光芒中",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/17550783375205e9woshz.png",
    "resolution": "720p",
    "duration": "5",
    "camera_fixed": false,
    "seed": -1,
    "enable_safety_checker": true,
    "end_image_url": ""
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
    "taskId": "task_bytedance_1765186743319"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询接口查看任务进度并获取结果：[Get Task Details](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

## 请求头

### Authorization

*   **类型**: `string`
*   **位置**: `header`
*   **必需**: 是

所有 API 均需通过 Bearer Token 进行身份验证。

**获取 API Key 步骤：**
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取你的 API Key。

**使用方法：**
在请求头中添加以下参数：
`Authorization: Bearer YOUR_API_KEY`

**注意事项：**
*   请妥善保管你的 API Key，切勿泄露给他人。
*   若怀疑 API Key 已泄露，请立即在管理页面重置。

## 请求体 (application/json)

### model

*   **类型**: `enum<string>`
*   **必需**: 是
*   **默认值**: `bytedance/v1-lite-image-to-video`

用于生成任务的模型名称。必填字段。
*   该接口必须使用 `bytedance/v1-lite-image-to-video` 模型。

**可用选项：**
*   `bytedance/v1-lite-image-to-video`

**示例：**
`"bytedance/v1-lite-image-to-video"`

### callBackUrl

*   **类型**: `string<uri>`
*   **必需**: 否

接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。
*   任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果。
*   回调内容包含生成内容的 URL 及任务相关信息。
*   你的回调接口需支持接收 POST 请求及 JSON 格式的请求体。
*   也可选择调用任务详情接口，主动轮询任务状态。

**示例：**
`"https://your-domain.com/api/callback"`

### input

*   **类型**: `object`
*   **必需**: 是

生成任务的输入参数。

#### input.prompt

*   **类型**: `string`
*   **必需**: 是

用于视频生成的文本提示词（最大长度：10000 字符）。

**示例：**
`"多镜头画面。一名旅人穿越无垠沙漠，走向发光的拱门。【切镜】他抵达巨大的石质门槛时，斗篷在风中翻飞。【广角镜头】他迈步穿过拱门——随即消失在一道光芒中"`

#### input.image_url

*   **类型**: `string`
*   **必需**: 是

用于生成视频的图片 URL。
*   需为上传后的文件 URL，而非文件内容。
*   支持的格式：`image/jpeg`、`image/png`、`image/webp`。
*   最大文件大小：10.0MB。

**示例：**
`"https://file.aiquickdraw.com/custom-page/akr/section-images/17550783375205e9woshz.png"`

#### input.resolution

*   **类型**: `enum<string>`
*   **必需**: 否
*   **默认值**: `720p`

视频分辨率 - 480p 生成速度更快，720p 画质更高。

**可用选项：**
*   `480p`
*   `720p`
*   `1080p`

**示例：**
`"720p"`

#### input.duration

*   **类型**: `enum<string>`
*   **必需**: 否
*   **默认值**: `5`

视频时长（单位：秒）。

**可用选项：**
*   `5`
*   `10`

**示例：**
`"5"`

#### input.camera_fixed

*   **类型**: `boolean`
*   **必需**: 否

是否固定相机位置。

**示例：**
`false`

#### input.seed

*   **类型**: `number`
*   **必需**: 否
*   **默认值**: `-1`

用于控制视频生成的随机种子值。设为 -1 时随机生成。
*   **范围**: `-1 <= x <= 2147483647`

**示例：**
`-1`

#### input.enable_safety_checker

*   **类型**: `object`

响应数据。

#### data.taskId

*   **类型**: `string`

任务 ID，可用于调用任务详情接口查询任务状态。

**示例：**
`"task_bytedance_1765186743319"`