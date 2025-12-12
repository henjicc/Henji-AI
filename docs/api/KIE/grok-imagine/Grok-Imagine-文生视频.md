# Grok Imagine 文生视频

由 Grok 先进 AI 模型驱动的高质量文本生成视频。

**接口地址**
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
  "model": "grok-imagine/text-to-video",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "A couple of doors open to the right one by one randomly and stay open, to show the inside, each is either a living room, or a kitchen, or a bedroom or an office, with little people living inside.",
    "aspect_ratio": "2:3",
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

提交任务后，使用统一的查询端点检查进度并获取结果。

对于生产环境，建议使用 `callBackUrl` 参数接收自动通知，而不是轮询状态端点。

## 请求参数说明

### Authorization

**类型**: string
**位置**: header
**必需**: 是

所有 API 都需要通过 Bearer Token 进行身份验证。

**获取 API Key**：
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

**使用方法**：
添加到请求头：
```
Authorization: Bearer YOUR_API_KEY
```

**注意**：
*   请妥善保管您的 API Key，不要与他人共享。
*   如果您怀疑 API Key 已泄露，请立即在管理页面重置。

### Body (application/json)

#### model

**类型**: enum<string>
**默认值**: `grok-imagine/text-to-video`
**必需**: 是

用于生成的模型名称。必填字段。
*   此端点必须使用 `grok-imagine/text-to-video`

**可用选项**:
`grok-imagine/text-to-video`

**示例**:
`"grok-imagine/text-to-video"`

#### input

**类型**: object
**必需**: 是

视频生成任务的输入参数。

**input.prompt**
*   **类型**: string
*   **必需**: 是
*   **描述**: 描述期望视频运动的文本提示。必填字段。
    *   应该对期望的视觉运动详细具体。
    *   描述运动、动作序列、摄影工作和时间安排。
    *   包含主体、环境和运动动态的细节。
    *   最大长度：5000 字符。
    *   支持英文提示。
*   **示例**: `"A couple of doors open to the right one by one randomly and stay open, to show the inside, each is either a living room, or a kitchen, or a bedroom or an office, with little people living inside."`

**input.aspect_ratio**
*   **类型**: enum<string>
*   **默认值**: `2:3`
*   **描述**: 指定生成视频的宽高比。控制输出的宽高比。
    *   `2:3`: 竖向（垂直）
    *   `3:2`: 横向（水平）
    *   `1:1`: 正方形
*   **可用选项**: `2:3`, `3:2`, `1:1`
*   **示例**: `"2:3"`

**input.mode**
*   **类型**: enum<string>
*   **默认值**: `normal`
*   **描述**: 指定影响运动风格和强度的生成模式。
    *   `fun`: 更有创意和趣味的解读。
    *   `normal`: 平衡方法，具有良好的运动质量。
    *   `spicy`: 更有活力和强烈的运动效果。
*   **可用选项**: `fun`, `normal`, `spicy`
*   **示例**: `"normal"`

#### callBackUrl

**类型**: string<uri>
**必需**: 否

接收视频生成任务完成更新的 URL。可选但建议在生产环境中使用。
*   当视频生成完成时，系统将向此 URL POST 任务状态和结果。
*   回调包含生成的视频 URL 和任务信息。
*   您的回调端点应接受包含视频结果的 JSON 负载的 POST 请求。
*   或者，使用获取任务详情端点轮询任务状态。

**示例**:
`"https://your-domain.com/api/callback"`

## 响应参数说明

### 请求成功

**code**
*   **类型**: enum<integer>
*   **描述**: 响应状态码。
    *   `200`: 成功 - 请求已成功处理。
    *   `401`: 未授权 - 身份验证凭据缺失或无效。
    *   `402`: 积分不足 - 账户没有足够的积分执行操作。
    *   `404`: 未找到 - 请求的资源或端点不存在。
    *   `422`: 验证错误 - 请求参数未通过验证检查。
    *   `429`: 速率限制 - 已超过此资源的请求限制。
    *   `455`: 服务不可用 - 系统正在维护中。
    *   `500`: 服务器错误 - 处理请求时发生意外错误。
    *   `501`: 生成失败 - 视频生成任务失败。
    *   `505`: 功能已禁用 - 请求的功能当前已禁用。
*   **可用选项**: `200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

**msg**
*   **类型**: string
*   **描述**: 响应消息，失败时为错误描述。
*   **示例**: `"success"`

**data**
*   **类型**: object

**data.taskId**
*   **类型**: string
*   **描述**: 任务 ID，可用于获取任务详情端点查询任务状态。
*   **示例**: `"task_grok_video_12345678"`