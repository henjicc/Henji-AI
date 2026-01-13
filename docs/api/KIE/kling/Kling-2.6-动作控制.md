# 运动控制 API 文档

> 使用运动控制模型生成内容

## 概述

本文档描述了如何使用运动控制模型进行内容生成。该过程包含两个步骤：
1. 创建一个生成任务
2. 查询任务状态和结果

## 认证

所有 API 请求都需要在请求头中包含一个 Bearer Token：

```
Authorization: Bearer YOUR_API_KEY
```

获取 API Key：
1. 访问 [API Key 管理页面](https://kie.ai/api-key) 以获取您的 API Key
2. 将其添加到请求头中：`Authorization: Bearer YOUR_API_KEY`

---

## 1. 创建生成任务

### API 信息
- **URL**: `POST https://api.kie.ai/api/v1/jobs/createTask`
- **Content-Type**: `application/json`

### 请求参数

| 参数 | 类型 | 是否必需 | 描述 |
|-----------|------|----------|-------------|
| model | string | 是 | 模型名称，格式：`kling-2.6/motion-control` |
| input | object | 是 | 输入参数对象 |
| useCallbackUrl | string | 否 | 用于任务完成通知的回调 URL。如果提供了此 URL，系统将在任务完成时（无论成功还是失败）向该 URL 发送 POST 请求。如果没有提供，则不会发送回调通知。示例：`"https://your-domain.com/api/callback"` |

### 模型参数

`model` 参数指定了用于内容生成的 AI 模型。

| 属性 | 值 | 描述 |
|----------|-------|-------------|
| **Format** | `kling-2.6/motion-control` | 该 API 的确切模型标识符 |
| **Type** | string | 必须以字符串形式传递 |
| **必需** | 是 | 所有请求都必须提供此参数 |

> **注意**：`model` 参数必须与上面显示的完全匹配。不同的模型具有不同的功能和参数要求。

### 回调 URL 参数

`callBackUrl` 参数允许您在任务完成后接收自动通知。

| 属性 | 值 | 描述 |
|----------|-------|-------------|
| **用途** | 任务完成通知 | 任务完成后接收实时更新 |
| **方法** | POST 请求 | 系统会向您的回调 URL 发送 POST 请求 |
| **时间** | 任务完成时 | 无论成功还是失败都会发送通知 |
| **内容** | 查询任务 API 响应 | 回调内容结构与查询任务 API 响应相同 |
| **参数** | 完整的请求数据 | `param` 字段包含完整的创建任务请求参数，而不仅仅是输入部分 |
| **可选** | 是 | 如果不提供，则不会发送回调通知 |

**重要说明：**
- 回调内容结构与查询任务 API 响应相同
- `param` 字段包含完整的创建任务请求参数，而不仅仅是输入部分
- 如果未提供 `callBackUrl`，则不会发送回调通知

### input 对象参数

#### prompt
- **类型**: `string`
- **必需**: 否
- **描述**: 所需输出的文本描述。最大长度为 2500 个字符。
- **最大长度**: 2500 个字符
- **默认值**: `"The cartoon character is dancing."`

#### input_urls
- **类型**: `array`
- **必需**: 是
- **描述**: 请提供上传文件的 URL，一个包含单个图像 URL 的数组。照片必须清晰显示主题的头部、肩膀和躯干。
- **最大文件大小**: 10MB
- **支持的文件类型**: image/jpeg, image/png, image/webp
- **允许多个文件**: 是
- **默认值**: `["https://static.aiquickdraw.com/tools/example/1767694885407_pObJoMcy.png"]`

#### video_urls
- **类型**: `array`
- **必需**: 是
- **描述**: 请提供上传文件的 URL，一个包含单个视频 URL 的数组。视频的时长必须在 3 到 30 秒之间，并且视频必须清晰显示主题的头部、肩膀和躯干。视频的最低宽度和高度必须为 720 像素，仅支持 jpeg/jpg/png 图像格式。
- **最大文件大小**: 100MB
- **支持的文件类型**: video/mp4, video/quicktime, video/x-matroska
- **允许多个文件**: 是
- **默认值**: `["https://static.aiquickdraw.com/tools/example/1767525918769_QyvTNib2.mp4"]`

#### character_orientation
- **类型**: `string`
- **必需**: 是
- **描述**: 生成视频中角色的方向。'image': 与图片中人物的方向相同（最多 10 秒的视频）。'video': 与视频中角色的方向一致（最多 30 秒的视频）。
- **选项**:
  - `image`: 图像
  - `video`: 视频
- **默认值**: `"video"`

#### mode
- **类型**: `string`
- **必需**: 是
- **描述**: 输出分辨率模式。使用 'std' 表示 720p，'pro' 表示 1080p。
- **选项**:
  - `720p**: 720p
  - `1080p**: 1080p
- **默认值**: `"720p"`')

### 请求示例

```json
{
  "model": "kling-2.6/motion-control",
  "input": {
    "prompt": "The cartoon character is dancing.",
    "input_urls": ["https://static.aiquickdraw.com/tools/example/1767694885407_pObJoMcy.png"],
    "video_urls": ["https://static.aiquickdraw.com/tools/example/1767525918769_QyvTNib2.mp4"],
    "character_orientation": "video",
    "mode": "720p"
  }
}
```

### 响应示例

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "281e5b0*********************f39b9"
  }
}
```

### 响应参数

| 参数 | 类型 | 描述 |
|-----------|------|-------------|
| code | integer | 响应状态代码，200 表示成功 |
| msg | string | 响应消息 |
| data.taskId | string | 用于查询任务状态的任务 ID |

---

## 2. 查询任务状态

### API 信息
- **URL**: `GET https://api.kie.ai/api/v1/jobs/recordInfo`
- **参数**: `taskId` （通过 URL 参数传递）

### 请求示例
```
GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=281e5b0*********************f39b9
```

### 响应示例

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "281e5b0*********************f39b9",
    "model": "kling-2.6/motion-control",
    "state": "waiting",
    "param": "{\"model\":\"kling-2.6/motion-control\",\"input\":{\"prompt\":\"The cartoon character is dancing.\",\"input_urls\":[\"https://static.aiquickdraw.com/tools/example/1767694885407_pObJoMcy.png\"],\"video_urls\":[\"https://static.aiquickdraw.com/tools/example/1767525918769_QyvTNib2.mp4\"],\"character_orientation\":\"video\",\"mode\":\"720p\"}}",
    "resultJson": "{\"resultUrls\":[\"https://static.aiquickdraw.com/tools/example/1767525938144_1MAbktBM.mp4\"]",
    "failCode": null,
    "failMsg": null,
    "costTime": null,
    "completeTime": null,
    "createTime": 1757584164490
  }
}
```

### 响应参数

| 参数 | 类型 | 描述 |
|-----------|------|-------------|
| code | integer | 响应状态代码，200 表示成功 |
| msg | string | 响应消息 |
| data.taskId | string | 任务 ID |
| data.model | string | 使用的模型名称 |
| data.state | string | 任务状态：`waiting`(等待)，`success`(成功)，`fail`(失败) |
| data.param | string | 任务参数（JSON 字符串） |
| data.resultJson | string | 任务结果（JSON 字符串，任务成功时可用）。结构取决于输出媒体类型：`{resultUrls: []}` 对于图像/媒体/视频，`{resultObject: {}}` 对于文本 |
| data.failCode | string | 失败代码（任务失败时可用） |
| data.failMsg | string | 失败消息（任务失败时可用） |
| data.costTime | integer | 任务持续时间（以毫秒为单位，任务成功时可用） |
| data-completeTime | integer | 完成时间戳（任务成功时可用） |
| data.createTime | integer | 创建时间戳 |

---

## 使用流程

1. **创建任务**: 调用 `POST https://api.kie.ai/api/v1/jobs/createTask` 来创建一个生成任务
2. **获取任务 ID**: 从响应中提取 `taskId`
3. **等待结果**：
   - 如果提供了 `callBackUrl`，则等待回调通知
   - 如果没有 `callBackUrl`，则通过调用 `GET https://api.kie.ai/api/v1/jobs/recordInfo` 来轮询状态
4. **获取结果**: 当 `state` 为 `success` 时，从 `resultJson` 中提取生成结果

## 错误代码

| 状态代码 | 描述 |
|-------------|-------------|
| 200 | 请求成功 |
| 400 | 参数无效 |
| 401 | 认证失败，请检查 API Key |
| 402 | 账户余额不足 |
| 404 | 资源未找到 |
| 422 | 参数验证失败 |
| 429 | 请求速率限制超出 |
| 500 | 内部服务器错误 |
```