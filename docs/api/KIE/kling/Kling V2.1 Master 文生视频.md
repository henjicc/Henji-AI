# Kling V2.1 Master 文生视频

基于 Kling 先进 AI 主版本模型，通过文本描述生成高质量视频。

## 接口说明

**端点：** `POST /api/v1/jobs/createTask`

**模型：** `kling/v2-1-master-text-to-video`

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "kling/v2-1-master-text-to-video",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "士兵从运输机跳下的第一人称视角——镜头因气流颠簸而晃动，氧气面罩的反光忽明忽暗——云层散开时，下方战场中防空火力与导弹尾迹交织闪动",
    "duration": "5",
    "aspect_ratio": "16:9",
    "negative_prompt": "模糊、畸变、低画质",
    "cfg_scale": 0.5
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
    "taskId": "task_kling_1765187781310"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询接口查看任务进度并获取结果。建议查阅 [任务详情接口](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

## 请求参数

### Authorizations

**Authorization** `string` (header, required)

所有 API 均需通过 Bearer Token 进行身份验证。

获取 API Key 步骤：
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取你的 API Key。

使用方法：
在请求头中添加以下参数：
`Authorization: Bearer YOUR_API_KEY`

注意事项：
*   请妥善保管你的 API Key，切勿泄露给他人。
*   若怀疑 API Key 已泄露，请立即在管理页面重置。

### Body

**Content-Type:** `application/json`

#### model

`enum<string>` (required, default: `kling/v2-1-master-text-to-video`)

用于生成任务的模型名称。必填字段。
*   该接口必须使用 `kling/v2-1-master-text-to-video` 模型。

可用选项:
*   `kling/v2-1-master-text-to-video`

示例：
```json
"kling/v2-1-master-text-to-video"
```

#### callBackUrl

`string<uri>`

接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。
*   任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果。
*   回调内容包含生成内容的 URL 及任务相关信息。
*   你的回调接口需支持接收 POST 请求及 JSON 格式的请求体。
*   也可选择调用任务详情接口，主动轮询任务状态。

示例：
```json
"https://your-domain.com/api/callback"
```

#### input

`object` (required)

生成任务的输入参数。

**input.prompt** `string` (required)

描述待生成视频内容的文本提示词（最大长度：5000 字符）。

示例：
```json
"士兵从运输机跳下的第一人称视角——镜头因气流颠簸而晃动，氧气面罩的反光忽明忽暗——云层散开时，下方战场中防空火力与导弹尾迹交织闪动"
```

**input.duration** `enum<string>` (default: `5`)

生成视频的时长（单位：秒）。

可用选项:
*   `5`
*   `10`

示例：
```json
"5"
```

**input.aspect_ratio** `enum<string>` (default: `16:9`)

生成视频画面的宽高比。

可用选项:
*   `16:9`
*   `9:16`
*   `1:1`

示例：
```json
"16:9"
```

**input.negative_prompt** `string`

生成视频中需要规避的元素（最大长度：500 字符）。

示例：
```json
"模糊、畸变、低画质"
```

**input.cfg_scale** `number` (default: `0.5`)

CFG（无分类器引导）系数，用于控制模型贴合提示词的程度（最小值：0，最大值：1，步长：0.1）。

示例：
```json
0.5
```

## 响应参数

### code

`enum<integer>`

响应状态码。
*   200: 成功 - 请求已处理完成
*   401: 未授权 - 身份验证凭据缺失或无效
*   402: 积分不足 - 账户余额不足以执行该操作
*   404: 未找到 - 请求的资源或接口不存在
*   422: 参数验证错误 - 请求参数未通过校验
*   429: 调用频率超限 - 已超出该资源的请求限制
*   455: 服务不可用 - 系统正在维护中
*   500: 服务器内部错误 - 处理请求时发生意外故障
*   501: 生成失败 - 内容生成任务执行失败
*   505: 功能禁用 - 当前请求的功能已被禁用

可用选项:
`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

### msg

`string`

响应消息，请求失败时返回错误描述。

示例：
```json
"success"
```

### data

`object`

**data.taskId** `string`

任务 ID，可用于调用任务详情接口查询任务状态。

示例：
```json
"task_kling_1765187781310"
```