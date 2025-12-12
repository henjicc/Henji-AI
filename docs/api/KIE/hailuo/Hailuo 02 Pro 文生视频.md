# POST Hailuo Pro 文生视频

使用 `hailuo/02-text-to-video-pro` 模型将文本生成视频。

## 快速开始

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "hailuo/02-text-to-video-pro",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "高俯角宽景中近景跟拍镜头，以两米高度极速掠过史前蕨类植物和苔藓覆盖的地面，画面主体是一个真实的小男孩（粉色T恤、粉色短裤、白色鞋子、白色长袜），背向镜头，身体舒展，平稳向前滑翔，腾空而起，在下方的地形上投射出清晰的影子。他的腿和身体高高离开地面，双脚不着地，以超人的姿势翱翔。背景是广袤的侏罗纪山谷，遍布茂密的古老丛林植被和高大的苏铁树。远处，嶙峋的火山山脉拔地而起，一条蜿蜒的小路穿梭其间。体型庞大、行动缓慢的蜥脚类恐龙在遥远的地平线上觅食。鲜艳的蓝天上漂浮着大朵蓬松的白云。强烈的动态运动模糊效果，增添了高速飞行的逼真感和浓郁的电影级景深。写实画质——原生未修饰。",
    "prompt_optimizer": true
  }
}
'
```

**成功响应示例：**

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_hailuo_1765185319478"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询接口查看任务进度并获取结果：[Get Task Details](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

## 相关资源

* [Market Overview](/cn/market/quickstart)
* [Common API](/cn/common-api/get-account-credits)

## 请求参数说明

### Authorizations

**Authorization**

*   **类型**: `string`
*   **位置**: `header`
*   **必需**: `是`

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

**application/json**

**model**

*   **类型**: `enum<string>`
*   **必需**: `是`
*   **默认值**: `hailuo/02-text-to-video-pro`

用于生成任务的模型名称。必填字段。
*   该接口必须使用 `hailuo/02-text-to-video-pro` 模型。

**示例：**
`"hailuo/02-text-to-video-pro"`

**callBackUrl**

*   **类型**: `string<uri>`
*   **必需**: `否`

接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。
*   任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果。
*   回调内容包含生成内容的 URL 及任务相关信息。
*   你的回调接口需支持接收 POST 请求及 JSON 格式的请求体。
*   也可选择调用任务详情接口，主动轮询任务状态。

**示例：**
`"https://your-domain.com/api/callback"`

**input**

*   **类型**: `object`
*   **必需**: `是`

生成任务的输入参数。

**input.prompt**

*   **类型**: `string`
*   **必需**: `是`
*   **最大长度**: `1500`

用于视频生成的文本提示词。

**示例：**
`"高俯角宽景中近景跟拍镜头，以两米高度极速掠过史前蕨类植物和苔藓覆盖的地面，画面主体是一个真实的小男孩（粉色T恤、粉色短裤、白色鞋子、白色长袜），背向镜头，身体舒展，平稳向前滑翔，腾空而起，在下方的地形上投射出清晰的影子。他的腿和身体高高离开地面，双脚不着地，以超人的姿势翱翔。背景是广袤的侏罗纪山谷，遍布茂密的古老丛林植被和高大的苏铁树。远处，嶙峋的火山山脉拔地而起，一条蜿蜒的小路穿梭其间。体型庞大、行动缓慢的蜥脚类恐龙在遥远的地平线上觅食。鲜艳的蓝天上漂浮着大朵蓬松的白云。强烈的动态运动模糊效果，增添了高速飞行的逼真感和浓郁的电影级景深。写实画质——原生未修饰。"`

**input.prompt_optimizer**

*   **类型**: `boolean`
*   **必需**: `否`

是否启用模型的提示词优化功能。

**示例：**
`true`

## 响应说明

**请求成功**

**code**

*   **类型**: `enum<integer>`

响应状态码。
*   `200`: 成功 - 请求已处理完成
*   `401`: 未授权 - 身份验证凭据缺失或无效
*   `402`: 积分不足 - 账户余额不足以执行该操作
*   `404`: 未找到 - 请求的资源或接口不存在
*   `422`: 参数验证错误 - 请求参数未通过校验
*   `429`: 调用频率超限 - 已超出该资源的请求限制
*   `455`: 服务不可用 - 系统正在维护中
*   `500`: 服务器内部错误 - 处理请求时发生意外故障
*   `501`: 生成失败 - 内容生成任务执行失败
*   `505`: 功能禁用 - 当前请求的功能已被禁用

**msg**

*   **类型**: `string`

响应消息，请求失败时返回错误描述。

**示例：**
`"success"`

**data**

*   **类型**: `object`

**data.taskId**

*   **类型**: `string`

任务 ID，可用于调用任务详情接口查询任务状态。

**示例：**
`"task_hailuo_1765185319478"`