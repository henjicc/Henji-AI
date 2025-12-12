# Grok Imagine 图像优化

使用先进的AI放大技术提升图像分辨率和质量，由Grok驱动。

## 接口信息

**请求方法**：POST
**接口地址**：`https://api.kie.ai/api/v1/jobs/createTask`

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "grok-imagine/upscale",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "task_id": "task_grok_12345678"
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

## 任务ID来源

`task_id` 参数应从之前生成的图像任务中获取。您可以放大使用以下方式创建的图像：

**如何获取任务ID：**

1.  使用[文本生成图像API](/cn/market/grok-imagine/text-to-image)生成图像。
2.  从API响应中提取 `taskId`。
3.  将该 `taskId` 作为放大请求中的 `task_id` 参数使用。

> 注意：只能放大由Kie AI模型生成的图像。不支持外部图像。

## 查询任务状态

提交放大任务后，使用统一的查询端点检查进度并获取结果。

对于生产环境，我们建议使用 `callBackUrl` 参数接收自动通知，而不是轮询状态端点。

## 请求参数说明

### Authorizations

**Authorization**
*   **类型**: `string`
*   **位置**: `header`
*   **必需**: 是
*   **说明**: 所有 API 都需要通过 Bearer Token 进行身份验证。
    *   获取 API Key：访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。
    *   使用方法：添加到请求头：`Authorization: Bearer YOUR_API_KEY`
    *   注意：请妥善保管您的 API Key，不要与他人共享。如果您怀疑 API Key 已泄露，请立即在管理页面重置。

### Body

**Content-Type**: `application/json`

**model**
*   **类型**: `enum<string>`
*   **必需**: 是
*   **默认值**: `grok-imagine/upscale`
*   **说明**: 用于生成的模型名称。此端点必须使用 `grok-imagine/upscale`。
*   **可用选项**: `grok-imagine/upscale`
*   **示例**: `"grok-imagine/upscale"`

**input**
*   **类型**: `object`
*   **必需**: 是
*   **说明**: 图像放大任务的输入参数。

    **input.task_id**
    *   **类型**: `string`
    *   **必需**: 是
    *   **说明**: 之前成功的图像生成任务的任务 ID。
        *   必须来自 Kie AI 图像生成模型（例如 `grok-imagine/text-to-image`）。
        *   原始图像生成必须成功完成。
        *   仅支持 Kie AI 生成的任务 ID。
    *   **最大长度**: 100 字符
    *   **示例**: `"task_grok_12345678"`

**callBackUrl**
*   **类型**: `string<uri>`
*   **必需**: 否
*   **说明**: 接收图像放大任务完成更新的 URL。可选但建议在生产环境中使用。
    *   当图像放大完成时，系统将向此 URL POST 任务状态和结果。
    *   回调包含生成的放大图像 URL 和任务信息。
    *   您的回调端点应接受包含图像结果的 JSON 负载的 POST 请求。
    *   或者，使用获取任务详情端点轮询任务状态。
*   **示例**: `"https://your-domain.com/api/callback"`

## 响应参数说明

**code**
*   **类型**: `enum<integer>`
*   **说明**: 响应状态码。
*   **可用选项及含义**:
    *   `200`: 成功 - 请求已成功处理。
    *   `401`: 未授权 - 身份验证凭据缺失或无效。
    *   `402`: 积分不足 - 账户没有足够的积分执行操作。
    *   `404`: 未找到 - 请求的资源或端点不存在。
    *   `422`: 验证错误 - 请求参数未通过验证检查。
    *   `429`: 速率限制 - 已超过此资源的请求限制。
    *   `455`: 服务不可用 - 系统正在维护中。
    *   `500`: 服务器错误 - 处理请求时发生意外错误。
    *   `501`: 生成失败 - 图像放大任务失败。
    *   `505`: 功能已禁用 - 请求的功能当前已禁用。

**msg**
*   **类型**: `string`
*   **说明**: 响应消息，失败时为错误描述。
*   **示例**: `"success"`

**data**
*   **类型**: `object`
*   **说明**: 响应数据。

    **data.taskId**
    *   **类型**: `string`
    *   **说明**: 任务 ID，可用于获取任务详情端点查询任务状态。
    *   **示例**: `"task_grok_upscale_12345678"`