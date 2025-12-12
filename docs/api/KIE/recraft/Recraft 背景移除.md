# Recraft 背景移除

基于 `recraft/remove-background` 模型实现图像去背景。

## 请求示例

使用 `recraft/remove-background` 处理图像。

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "recraft/remove-background",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "image": "https://file.aiquickdraw.com/custom-page/akr/section-images/1757057285447k9qcbki1.webp"
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
    "taskId": "task_recraft_1765177006198"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取处理结果。建议参考 [获取任务详情](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收处理完成的自动通知，而非轮询状态端点。

## 相关资源

* [市场概览](/cn/market/quickstart)
* [通用 API](/cn/common-api/get-account-credits)

## 请求参数说明

### Authorizations

#### Authorization

* **类型**: `string`
* **位置**: `header`
* **必需**: 是

所有 API 都需要通过 Bearer Token 进行身份验证。

获取 API Key：
1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

使用方法：
在请求头中添加：
`Authorization: Bearer YOUR_API_KEY`

注意事项：
* 请妥善保管您的 API Key，切勿泄露给他人。
* 若怀疑 API Key 泄露，请立即在管理页面重置。

### Body

#### model

* **类型**: `enum<string>`
* **必需**: 是
* **默认值**: `recraft/remove-background`

用于处理任务的模型名称。必填字段。
* 该端点必须使用 `recraft/remove-background` 模型。

可用选项：
`recraft/remove-background`

示例：
`"recraft/remove-background"`

#### callBackUrl

* **类型**: `string<uri>`
* **必需**: 否

接收任务完成通知的回调 URL。可选配置，建议在生产环境中使用。
* 任务处理完成后，系统会向该 URL POST 任务状态与结果。
* 回调内容包含处理后的资源 URL 与任务相关信息。
* 您的回调端点需要支持接收带 JSON 负载的 POST 请求。
* 也可以选择调用任务详情端点，主动轮询任务状态。

示例：
`"https://your-domain.com/api/callback"`

#### input

* **类型**: `object`
* **必需**: 是

图像去背景任务的输入参数。

**子属性：**

##### input.image

* **类型**: `string`
* **必需**: 是

待去除背景的图像。
* 支持格式：PNG、JPG、WEBP。
* 最大 5MB，最大 1600 万像素，最大尺寸 4096px，最小尺寸 256px。
* 为上传后的文件 URL，而非文件内容。
* 支持类型：image/jpeg、image/png、image/webp。
* 最大大小：5.0MB。

示例：
`"https://file.aiquickdraw.com/custom-page/akr/section-images/1757057285447k9qcbki1.webp"`

## 响应参数说明

#### code

* **类型**: `enum<integer>`
* **必需**: 是

响应状态码。
* `200`: 成功 - 请求已处理完成
* `401`: 未授权 - 身份验证凭据缺失或无效
* `402`: 积分不足 - 账户积分不足以执行该操作
* `404`: 未找到 - 请求的资源或端点不存在
* `422`: 验证错误 - 请求参数未通过校验
* `429`: 速率限制 - 已超出该资源的请求频次限制
* `455`: 服务不可用 - 系统正在维护中
* `500`: 服务器错误 - 处理请求时发生意外故障
* `501`: 生成失败 - 内容生成任务执行失败
* `505`: 功能禁用 - 当前请求的功能暂未开放

可用选项：
`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

#### msg

* **类型**: `string`
* **必需**: 是

响应消息，请求失败时为错误描述。

示例：
`"success"`

#### data

* **类型**: `object`
* **必需**: 是

**子属性：**

##### data.taskId

* **类型**: `string`
* **必需**: 是

任务 ID，可用于调用任务详情端点查询任务状态。

示例：
`"task_recraft_1765177006198"`