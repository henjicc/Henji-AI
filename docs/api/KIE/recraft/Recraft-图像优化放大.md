# Recraft 图像优化

基于 Recraft 先进的 AI 放大技术，提升图像分辨率与画质。

## 使用 recraft/crisp-upscale 放大图像

**请求端点**
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
  "model": "recraft/crisp-upscale",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "image": "https://file.aiquickdraw.com/custom-page/akr/section-images/1757169577325ijj8vwvt.jpg"
  }
}
'
```

**响应示例**
```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_recraft_1765177373893"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取处理结果：[获取任务详情](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收任务完成的自动通知，而非轮询状态端点。

## 请求参数说明

### Authorizations

| 参数 | 类型 | 位置 | 必需 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| Authorization | string | header | 是 | Bearer Token 身份验证。 |

**使用方法**
在请求头中添加：
```
Authorization: Bearer YOUR_API_KEY
```

**获取 API Key**
1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

**注意事项**
* 请妥善保管您的 API Key，切勿泄露给他人。
* 若怀疑 API Key 泄露，请立即在管理页面重置。

### Body (application/json)

| 参数 | 类型 | 必需 | 说明 |
| :--- | :--- | :--- | :--- |
| model | enum<string> | 是 | 用于处理任务的模型名称。必须为 `recraft/crisp-upscale`。<br>示例：`"recraft/crisp-upscale"` |
| callBackUrl | string<uri> | 否 | 接收任务完成通知的回调 URL。建议在生产环境中使用。<br>任务处理完成后，系统会向该 URL POST 任务状态与结果。<br>示例：`"https://your-domain.com/api/callback"` |
| input | object | 是 | 图像高清放大任务的输入参数。 |
| input.image | string | 是 | 待放大的图像 URL（为上传后的文件 URL，而非文件内容）。<br>支持类型：image/jpeg、image/png、image/webp。<br>最大大小：10.0MB。<br>示例：`"https://file.aiquickdraw.com/custom-page/akr/section-images/1757169577325ijj8vwvt.jpg"` |

## 响应说明

**请求成功**

| 参数 | 类型 | 说明 |
| :--- | :--- | :--- |
| code | enum<integer> | 响应状态码。<br>可用选项：`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505` |
| msg | string | 响应消息，请求失败时为错误描述。<br>示例：`"success"` |
| data | object | 响应数据。 |
| data.taskId | string | 任务 ID，可用于调用任务详情端点查询任务状态。<br>示例：`"task_recraft_1765177373893"` |

**状态码说明**
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