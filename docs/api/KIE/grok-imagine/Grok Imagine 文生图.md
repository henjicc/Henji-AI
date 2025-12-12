# Grok Imagine 文生图

由 Grok AI 驱动的高质量照片级图像生成。

## 生成图像

使用以下 API 端点通过文本提示生成图像。

**Endpoint**
```
POST /api/v1/jobs/createTask
```

**请求示例**
```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "grok-imagine/text-to-image",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "一位女性坐在黑胶唱片机旁的电影肖像，复古客厅背景，柔和的环境照明，温暖的大地色调，怀旧的1970年代服装，沉思的情绪，柔和的胶片颗粒纹理，浅景深，复古编辑摄影风格。",
    "aspect_ratio": "3:2"
  }
}
'
```

**成功响应示例**
```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_grok_12345678"
  }
}
```

## 查询任务状态

提交任务后，使用统一的查询端点检查进度并获取结果。建议查阅 [获取任务详情](/cn/market/common/get-task-detail) 文档。

对于生产环境，建议使用 `callBackUrl` 参数接收自动通知，而不是轮询状态端点。

## 请求参数

### Authorizations

**Authorization**
*   **类型**: `string`
*   **位置**: `header`
*   **必需**: 是
*   **描述**: 所有 API 都需要通过 Bearer Token 进行身份验证。
    *   **获取 API Key**: 访问 [API Key 管理页面](https://kie.ai/api-key)。
    *   **使用方法**: 添加到请求头：`Authorization: Bearer YOUR_API_KEY`。
    *   **注意**: 请妥善保管您的 API Key，不要与他人共享。如果您怀疑 API Key 已泄露，请立即在管理页面重置。

### Body

**Content-Type**: `application/json`

**model**
*   **类型**: `enum<string>`
*   **必需**: 是
*   **默认值**: `grok-imagine/text-to-image`
*   **描述**: 用于生成的模型名称。此端点必须使用 `grok-imagine/text-to-image`。
*   **可用选项**: `grok-imagine/text-to-image`
*   **示例**: `"grok-imagine/text-to-image"`

**input**
*   **类型**: `object`
*   **必需**: 是
*   **描述**: 图像生成任务的输入参数。
    *   **input.prompt**
        *   **类型**: `string`
        *   **必需**: 是
        *   **描述**: 描述期望图像的文本提示。应该对期望的视觉元素详细具体，描述构图、风格、光线、情绪和其他视觉细节。最大长度：5000 字符。支持英文提示。
        *   **示例**: `"一位女性坐在黑胶唱片机旁的电影肖像，复古客厅背景，柔和的环境照明，温暖的大地色调，怀旧的1970年代服装，沉思的情绪，柔和的胶片颗粒纹理，浅景深，复古编辑摄影风格。"`
    *   **input.aspect_ratio**
        *   **类型**: `enum<string>`
        *   **必需**: 否
        *   **描述**: 指定生成图像的宽高比。控制输出的宽高比。
        *   **默认值**: `1:1`
        *   **可用选项**: `2:3` (竖向/垂直), `3:2` (横向/水平), `1:1` (正方形)
        *   **示例**: `"3:2"`

**callBackUrl**
*   **类型**: `string<uri>`
*   **必需**: 否
*   **描述**: 接收图像生成任务完成更新的 URL。可选但建议在生产环境中使用。当图像生成完成时，系统将向此 URL POST 任务状态和结果。回调包含生成的图像 URL 和任务信息。您的回调端点应接受包含图像结果的 JSON 负载的 POST 请求。或者，使用获取任务详情端点轮询任务状态。
*   **示例**: `"https://your-domain.com/api/callback"`

## 响应

### 请求成功

**code**
*   **类型**: `enum<integer>`
*   **描述**: 响应状态码。
*   **可用选项及含义**:
    *   `200`: 成功 - 请求已成功处理
    *   `401`: 未授权 - 身份验证凭据缺失或无效
    *   `402`: 积分不足 - 账户没有足够的积分执行操作
    *   `404`: 未找到 - 请求的资源或端点不存在
    *   `422`: 验证错误 - 请求参数未通过验证检查
    *   `429`: 速率限制 - 已超过此资源的请求限制
    *   `455`: 服务不可用 - 系统正在维护中
    *   `500`: 服务器错误 - 处理请求时发生意外错误
    *   `501`: 生成失败 - 图像生成任务失败
    *   `505`: 功能已禁用 - 请求的功能当前已禁用

**msg**
*   **类型**: `string`
*   **描述**: 响应消息，失败时为错误描述。
*   **示例**: `"success"`

**data**
*   **类型**: `object`
*   **描述**:
    *   **data.taskId**
        *   **类型**: `string`
        *   **描述**: 任务 ID，可用于获取任务详情端点查询任务状态。
        *   **示例**: `"task_grok_12345678"`