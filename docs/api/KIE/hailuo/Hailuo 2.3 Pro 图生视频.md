# Hailuo 2.3 Pro 图生视频

基于海洛先进 AI 模型，将静态图像转换为动态视频。

## 接口调用

**请求方法**: `POST`
**接口地址**: `https://api.kie.ai/api/v1/jobs/createTask`

### 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "hailuo/2-3-image-to-video-pro",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "一位优雅的艺伎在室内表演传统日本舞蹈。她身着带有金色花卉刺绣的华贵红色和服，搭配白色腰带与白色分趾袜。手部动作柔美优雅，姿态富有表现力，衣袖自然飘拂。场景设定在日式榻榻米房间内，暖调环境光，日式纸拉门，前景垂挂着樱花枝。电影质感，柔和景深，布料纹理细节丰富，超写实风格，动作流畅自然。",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1761736831884xl56xfiw.webp",
    "duration": "6",
    "resolution": "768P"
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
    "taskId": "task_hailuo_1765182976860"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 请求参数说明

### Authorizations

| 参数名 | 位置 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `Authorization` | header | string | 是 | 所有 API 都需要通过 Bearer Token 进行身份验证。 |

**获取 API Key**：
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

**使用方法**：
在请求头中添加：
`Authorization: Bearer YOUR_API_KEY`

**注意事项**：
*   请妥善保管您的 API Key，切勿泄露给他人。
*   若怀疑 API Key 泄露，请立即在管理页面重置。

### Body

**Content-Type**: `application/json`

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `model` | enum<string> | 是 | `hailuo/2-3-image-to-video-pro` | 用于生成任务的模型名称。该端点必须使用 `hailuo/2-3-image-to-video-pro` 模型。 |
| `callBackUrl` | string<uri> | 否 | - | 接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。任务生成完成后，系统会向该 URL POST 任务状态与结果。 |
| `input` | object | 是 | - | 生成任务的输入参数。 |

**`input` 对象属性**

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | - | 描述期望视频动画效果的文本提示词（最大长度：5000 字符）。 |
| `image_url` | string | 是 | - | 用于制作动画的输入图像 URL（为上传后的文件 URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）。 |
| `duration` | enum<string> | 否 | `6` | 视频时长（单位：秒）。可用选项：`6`, `10`。**注意**：1080P 分辨率不支持 10 秒时长的视频。 |
| `resolution` | enum<string> | 否 | `768P` | 生成视频的分辨率。可用选项：`768P`, `1080P`。 |

## 响应参数说明

| 参数名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | enum<integer> | 响应状态码。 |
| `msg` | string | 响应消息，请求失败时为错误描述。 |
| `data` | object | 响应数据。 |

**`data` 对象属性**

| 参数名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `taskId` | string | 任务 ID，可用于调用任务详情端点查询任务状态。 |

**状态码 (`code`) 说明**

| 值 | 含义 |
| :--- | :--- |
| `200` | 成功 - 请求已处理完成 |
| `401` | 未授权 - 身份验证凭据缺失或无效 |
| `402` | 积分不足 - 账户积分不足以执行该操作 |
| `404` | 未找到 - 请求的资源或端点不存在 |
| `422` | 验证错误 - 请求参数未通过校验 |
| `429` | 速率限制 - 已超出该资源的请求频次限制 |
| `455` | 服务不可用 - 系统正在维护中 |
| `500` | 服务器错误 - 处理请求时发生意外故障 |
| `501` | 生成失败 - 内容生成任务执行失败 |
| `505` | 功能禁用 - 当前请求的功能暂未开放 |