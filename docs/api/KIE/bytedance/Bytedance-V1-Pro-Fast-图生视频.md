# Bytedance V1 Pro Fast 图生视频

基于字节跳动先进 AI 模型，将静态图像转换为动态视频。

## 接口说明

**端点**
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
  "model": "bytedance/v1-pro-fast-image-to-video",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "电影质感的特写镜头序列：阳光洒落的窗边，质朴木桌上摆放着一只精致的陶瓷咖啡杯与杯碟，滚烫浓郁的意式浓缩咖啡从上方以纤细的金色水流缓缓注入杯中，分阶段逐步填满：空杯飘着淡淡蒸汽→1/4杯盛着深色油脂→半杯咖啡旋动、蒸汽升腾→3/4杯接近杯沿→满杯恰好未溢出，表面油亮且有柔和的焦外高光；超写实风格，暖调黄金时刻光线，浅景深，照片级真实感，纹理细节丰富，蒸汽轻扬，氛围静谧且具吸引力 --ar 16:9 --q 2 --style raw",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1762340693669m6sey187.webp",
    "resolution": "720p",
    "duration": "5"
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
    "taskId": "task_bytedance_1765182752206"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 授权说明

### Authorization

**类型**: `string`
**位置**: `header`
**必需**: 是

所有 API 都需要通过 Bearer Token 进行身份验证。

**获取 API Key**：
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

**使用方法**：
在请求头中添加：
```
Authorization: Bearer YOUR_API_KEY
```

**注意事项**：
*   请妥善保管您的 API Key，切勿泄露给他人。
*   若怀疑 API Key 泄露，请立即在管理页面重置。

## 请求体参数

**Content-Type**: `application/json`

### model

**类型**: `enum<string>`
**默认值**: `bytedance/v1-pro-fast-image-to-video`
**必需**: 是

用于生成任务的模型名称。该端点必须使用 `bytedance/v1-pro-fast-image-to-video` 模型。

**可用选项**:
`bytedance/v1-pro-fast-image-to-video`

**示例**:
```json
"bytedance/v1-pro-fast-image-to-video"
```

### callBackUrl

**类型**: `string<uri>`
**必需**: 否

接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。

*   任务生成完成后，系统会向该 URL POST 任务状态与结果。
*   回调内容包含生成的资源 URL 与任务相关信息。
*   您的回调端点需要支持接收带 JSON 负载的 POST 请求。
*   也可以选择调用任务详情端点，主动轮询任务状态。

**示例**:
```json
"https://your-domain.com/api/callback"
```

### input

**类型**: `object`
**必需**: 是

生成任务的输入参数。

#### input.prompt

**类型**: `string`
**必需**: 是
**最大长度**: 10000

用于生成视频的文本提示词。

**示例**:
```json
"电影质感的特写镜头序列：阳光洒落的窗边，质朴木桌上摆放着一只精致的陶瓷咖啡杯与杯碟，滚烫浓郁的意式浓缩咖啡从上方以纤细的金色水流缓缓注入杯中，分阶段逐步填满：空杯飘着淡淡蒸汽→1/4杯盛着深色油脂→半杯咖啡旋动、蒸汽升腾→3/4杯接近杯沿→满杯恰好未溢出，表面油亮且有柔和的焦外高光；超写实风格，暖调黄金时刻光线，浅景深，照片级真实感，纹理细节丰富，蒸汽轻扬，氛围静谧且具吸引力 --ar 16:9 --q 2 --style raw"
```

#### input.image_url

**类型**: `string`
**必需**: 是

用于生成视频的图像 URL。
*   为上传后的文件 URL，非文件内容。
*   支持的类型：`image/jpeg`、`image/png`、`image/webp`。
*   最大文件大小：10.0MB。

**示例**:
```json
"https://file.aiquickdraw.com/custom-page/akr/section-images/1762340693669m6sey187.webp"
```

#### input.resolution

**类型**: `enum<string>`
**默认值**: `720p`
**必需**: 否

视频分辨率。480p 生成速度更快，720p 兼顾速度与画质，1080p 画质更高（当前仅开放720p/1080p）。

**可用选项**:
`720p`, `1080p`

**示例**:
```json
"720p"
```

#### input.duration

**类型**: `enum<string>`
**默认值**: `5`
**必需**: 否

视频时长（单位：秒）。

**可用选项**:
`5`, `10`

**示例**:
```json
"5"
```

## 响应说明

### code

**类型**: `enum<integer>`
**必需**: 是

响应状态码。
*   200: 成功 - 请求已处理完成
*   401: 未授权 - 身份验证凭据缺失或无效
*   402: 积分不足 - 账户积分不足以执行该操作
*   404: 未找到 - 请求的资源或端点不存在
*   422: 验证错误 - 请求参数未通过校验
*   429: 速率限制 - 已超出该资源的请求频次限制
*   455: 服务不可用 - 系统正在维护中
*   500: 服务器错误 - 处理请求时发生意外故障
*   501: 生成失败 - 内容生成任务执行失败
*   505: 功能禁用 - 当前请求的功能暂未开放

**可用选项**:
`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

### msg

**类型**: `string`
**必需**: 是

响应消息，请求失败时为错误描述。

**示例**:
```json
"success"
```

### data

**类型**: `object`
**必需**: 是

#### data.taskId

**类型**: `string`
**必需**: 是

任务 ID，可用于调用任务详情端点查询任务状态。

**示例**:
```json
"task_bytedance_1765182752206"
```