# Kling-2.6 图生视频

基于 Kling-2.6 先进 AI 模型，将图片转化为动态视频。

## 认证

所有 API 请求都需要在请求头中包含一个 Bearer Token：

```
Authorization: Bearer YOUR_API_KEY
```

获取 API 密钥：
1. 访问 [API 密钥管理页面](https://kie.ai/api-key) 以获取您的 API 密钥
2. 将其添加到请求头中：`Authorization: Bearer YOUR_API_KEY`

---

## 1. 创建生成任务

### API 信息
- **URL**: `POST https://api.kie.ai/api/v1/jobs/createTask`
- **Content-Type**: `application/json`

### 请求参数

| 参数 | 类型 | 是否必填 | 描述 |
|-----------|------|----------|-------------|
| model | string | 是 | 模型名称，格式：`kling-2.6/image-to-video` |
| input | object | 是 | 输入参数对象 |
| callBackUrl | string | 否 | 用于任务完成通知的回调 URL。如果提供了该 URL，系统将在任务完成时（无论成功还是失败）向此 URL 发送 POST 请求。如果没有提供，则不会发送回调通知。示例：`"https://your-domain.com/api/callback"` |

### 模型参数

`model` 参数指定了用于内容生成的人工智能模型。

| 属性 | 值 | 描述 |
|----------|-------|-------------|
| **Format** | `kling-2.6/image-to-video` | 该 API 的具体模型标识符 |
| **Type** | string | 必须以字符串形式传递 |
| **Required** | 是 | 所有请求都必须提供此参数 |

> **注意**：`model` 参数必须与上面显示的完全匹配。不同的模型具有不同的功能和参数要求。

### 回调 URL 参数

`callBackUrl` 参数允许您在任务完成时接收自动通知。

| 属性 | 值 | 描述 |
|----------|-------|-------------|
| **Purpose** | 任务完成通知 | 任务完成后接收实时更新 |
| **Method** | POST 请求 | 系统会向您的回调 URL 发送 POST 请求 |
| **Timing** | 任务完成时 | 无论成功还是失败都会发送通知 |
| **Content** | 查询任务 API 响应 | 回调内容结构与查询任务 API 响应相同 |
| **Parameters** | 完整的请求数据 | `param` 字段包含完整的创建任务请求参数，而不仅仅是输入部分 |
| **Optional** | 是 | 如果未提供，则不会发送回调通知 |

**重要提示：**
- 回调内容结构与查询任务 API 响应相同
- `param` 字段包含完整的创建任务请求参数，而不仅仅是输入部分
- 如果未提供 `callBackUrl`，则不会发送回调通知

### input 对象参数

#### prompt
- **类型**: `string`
- **是否必填**: 是
- **描述**: 用于生成视频的文本提示
- **最大长度**: 1000 个字符
- **默认值**: `"在一个明亮的排练室里，阳光透过窗户照进来，房间中央放置着一个立式麦克风。[校园乐队的女主唱] 站在麦克风前，闭着眼睛，其他成员站在她周围。[校园乐队的女主唱，用全音量] 带领演唱：‘我会用我全部的心和灵魂来修复你……’ 背景是无伴奏的和声，摄像机慢慢围绕乐队成员旋转。"`

#### image_urls
- **类型**: `array`
- **是否必填**: 是
- **描述**: 用于生成视频的图片的 URL
- **最大文件大小**: 10MB
- **支持的文件类型**: image/jpeg, image/png, image/webp
- **允许多个文件**: 是
- **默认值**: `["https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png"]`

#### sound
- **类型**: `boolean`
- **是否必填**: 是
- **描述**: 该参数用于指定生成的视频是否包含声音
- **默认值**: `false`

#### duration
- **类型**: `string`
- **是否必填**: 是
- **描述**: 视频的时长（以秒为单位）
- **选项**:
  - `5`: 5 秒
  - `10`: 10 秒
- **默认值**: `"5"``

### 请求示例

```json
{
  "model": "kling-2.6/image-to-video",
  "input": {
    "prompt": "在一个明亮的排练室里，阳光透过窗户照进来，房间中央放置着一个立式麦克风。[校园乐队的女主唱] 站在麦克风前，闭着眼睛，其他成员站在她周围。[校园乐队的女主唱，用全音量] 带领演唱：‘我会用我全部的心和灵魂来修复你……’ 背景是无伴奏的和声，摄像机慢慢围绕乐队成员旋转。",
    "image_urls": ["https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png"],
    "sound": false,
    "duration": "5"
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
| code | integer | 响应状态码，200 表示成功 |
| msg | string | 响应消息 |
| data.taskId | string | 用于查询任务状态的任务 ID |

---

## 2. 查询任务状态

### API 信息
- **URL**: `GET https://api.kie.ai/api/v1/jobs/recordInfo`
- **参数**: `taskId`（通过 URL 参数传递）

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
    "model": "kling-2.6/image-to-video",
    "state": "waiting",
    "param": "{\"model\":\"kling-2.6/image-to-video\",\"input\":{\"prompt\":\"In a bright rehearsal room, sunlight streams through the window, and a standing microphone is placed in the center of the room. [Campus band female lead singer] stands in front of the microphone with her eyes closed, while the other members stand around her. [Campus band female lead singer, full voice] leads: \\"I will try to fix you, with all my heart and soul...\\" The background is an a cappella harmony, and the camera slowly circles around the band members.\",\"image_urls\":[\"https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png\"],\"sound\":false,\"duration\":\"5\"}}",
    "resultJson": "{\"resultUrls\":[\"https://static.aiquickdraw.com/tools/example/1764828670530_Kbo8avhf.mp4\"]}",
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
| code | integer | 响应状态码，200 表示成功 |
| msg | string | 响应消息 |
| data.taskId | string | 任务 ID |
| data.model | string | 使用的模型名称 |
| data.state | string | 任务状态：`waiting`（等待），`success`（成功），`fail`（失败） |
| data.param | string | 任务参数（JSON 字符串） |
| data.resultJson | string | 任务结果（JSON 字符串，仅在任务成功时提供）。结构取决于输出类型：`{resultUrls: []}` 对于图片/媒体/视频，`{resultObject: {}}` 对于文本 |
| data.failCode | string | 失败代码（任务失败时提供） |
| data.failMsg | string | 失败消息（任务失败时提供） |
| data.costTime | integer | 任务持续时间（以毫秒为单位，仅在任务成功时提供） |
| data COMPLETETime | integer | 完成时间戳（仅在任务成功时提供） |
| data.createTime | integer | 创建时间戳 |

---

## 使用流程

1. **创建任务**: 调用 `POST https://api.kie.ai/api/v1/jobs/createTask` 来创建生成任务
2. **获取任务 ID**: 从响应中提取 `taskId`
3. **等待结果**:
   - 如果提供了 `callBackUrl`，则等待回调通知
   - 如果没有 `callBackUrl`，则通过调用 `GET https://api.kie.ai/api/v1/jobs/recordInfo` 来轮询状态
4. **获取结果**: 当 `state` 为 `success` 时，从 `resultJson` 中提取生成结果

## 错误代码

| 状态码 | 描述 |
|-------------|-------------|
| 200 | 请求成功 |
| 400 | 请求参数无效 |
| 401 | 认证失败，请检查 API 密钥 |
| 402 | 账户余额不足 |
| 404 | 资源未找到 |
| 422 | 参数验证失败 |
| 429 | 超过请求速率限制 |
| 500 | 内部服务器错误 |
