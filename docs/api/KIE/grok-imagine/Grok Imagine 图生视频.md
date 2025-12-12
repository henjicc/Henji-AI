# Grok Imagine 图生视频

将静态图像转换为动态视频，由 Grok 先进 AI 模型驱动。

**接口**
```
POST /api/v1/jobs/createTask
```

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "grok-imagine/image-to-video",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "image_urls": [
      "https://file.aiquickdraw.com/custom-page/akr/section-images/1762247692373tw5di116.png"
    ],
    "prompt": "POV hand comes into frame handing the girl a cup of take away coffee, the girl steps out of the screen looking tired, then takes it and she says happily: \"thanks! Back to work\" she exits the frame and walks right to a different part of the office.",
    "mode": "normal"
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
    "taskId": "281e5b0*********************f39b9"
  }
}
```

## 查询任务状态

提交任务后，使用统一的查询端点检查进度并获取结果：[获取任务详情](/cn/market/common/get-task-detail)。

对于生产环境，建议使用 `callBackUrl` 参数接收自动通知，而不是轮询状态端点。

## 请求参数说明

### 认证

**Authorization** `string` `header` `required`

所有 API 都需要通过 Bearer Token 进行身份验证。

获取 API Key：
1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

使用方法：
添加到请求头：`Authorization: Bearer YOUR_API_KEY`

注意：
* 请妥善保管您的 API Key，不要与他人共享。
* 如果您怀疑 API Key 已泄露，请立即在管理页面重置。

### 请求体 (application/json)

**model** `enum<string>` `required`

用于生成的模型名称。必填字段。
* 此端点必须使用 `grok-imagine/image-to-video`

可用选项：`grok-imagine/image-to-video`

示例：`"grok-imagine/image-to-video"`

**input** `object` `required`

视频生成任务的输入参数。

**input.prompt** `string` `required`

描述期望视频运动的文本提示。必填字段。
* 应该对期望的视觉运动详细具体。
* 描述运动、动作序列、摄影工作和时间安排。
* 包含主体、环境和运动动态的细节。
* 最大长度：5000 字符。
* 支持英文提示。

示例：`"POV hand comes into frame handing the girl a cup of take away coffee, the girl steps out of the screen looking tired, then takes it and she says happily: \"thanks! Back to work\" she exits the frame and walks right to a different part of the office."`

**input.image_urls** `string<uri>[]`

提供一个外部图像 URL 作为视频生成的参考。仅支持一个图像，不要与 task_id 同时使用。
* 支持 JPEG、PNG、WEBP 格式。
* 每张图像最大文件大小：10MB。
* 使用外部图像时 Spicy 模式不可用。
* 数组应包含一个 URL。

最大数组长度：`1`

示例：
```json
[
  "https://file.aiquickdraw.com/custom-page/akr/section-images/1762247692373tw5di116.png"
]
```

**input.task_id** `string`

之前生成的 Grok 图像的任务 ID。与 index 配合使用选择特定图像，不要与 image_urls 同时使用。
* 使用 grok-imagine/text-to-image 生成的任务 ID。
* 支持所有模式，包括 Spicy。
* 最大长度：100 字符。

最大字符串长度：`100`

示例：`"task_grok_12345678"`

**input.index** `integer` `default:0`

使用 task_id 时，指定使用哪个图像（Grok 每次生成 6 张图像）。仅与 task_id 配合使用。
* 基于 0 的索引 (0-5)。
* 如果提供了 image_urls 则忽略此参数。
* 默认值：0。

必填范围：`0 <= x <= 5`

示例：`0`

**input.mode** `enum<string>` `default:normal`

指定影响运动风格和强度的生成模式。注意：外部图像输入不支持 Spicy 模式。
* `fun`: 更有创意和趣味的解读。
* `normal`: 平衡方法，具有良好的运动质量。
* `spicy`: 更有活力和强烈的运动效果（外部图像不可用）。

可用选项：`fun`, `normal`, `spicy`

示例：`"normal"`

**callBackUrl** `string<uri>`

接收视频生成任务完成更新的 URL。可选但建议在生产环境中使用。
* 当视频生成完成时，系统将向此 URL POST 任务状态和结果。
* 回调包含生成的视频 URL 和任务信息。
* 您的回调端点应接受包含视频结果的 JSON 负载的 POST 请求。
* 或者，使用获取任务详情端点轮询任务状态。

示例：`"https://your-domain.com/api/callback"`

## 响应说明

**code** `enum<integer>`

响应状态码。
* `200`: 成功 - 请求已成功处理。
* `401`: 未授权 - 身份验证凭据缺失或无效。
* `402`: 积分不足 - 账户没有足够的积分执行操作。
* `404`: 未找到 - 请求的资源或端点不存在。
* `422`: 验证错误 - 请求参数未通过验证检查。
* `429`: 速率限制 - 已超过此资源的请求限制。
* `455`: 服务不可用 - 系统正在维护中。
* `500`: 服务器错误 - 处理请求时发生意外错误。
* `501`: 生成失败 - 视频生成任务失败。
* `505`: 功能已禁用 - 请求的功能当前已禁用。

可用选项：`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

**msg** `string`

响应消息，失败时为错误描述。

示例：`"success"`

**data** `object`

**data.taskId** `string`

任务 ID，可用于获取任务详情端点查询任务状态。

示例：`"task_grok_video_12345678"`

## 相关资源

* [市场概览](/cn/market/quickstart)
* [通用API](/cn/common-api/get-account-credits)