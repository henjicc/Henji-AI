# POST Bytedance V1 Pro 图生视频

基于字节跳动先进 AI 专业版模型，将静态图片转化为动态视频。

**端点**
```
POST /api/v1/jobs/createTask
```

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "bytedance/v1-pro-image-to-video",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "一只金毛犬在海滩的浅浪中奔跑，镜头从后方低角度贴近水面拍摄，浪花定格在瞬间，海浪和爪子带有动态模糊拖影，午后阳光在湿漉漉的毛发上闪烁，阴天背景下云层富有戏剧性",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1755179021328w1nhip18.webp",
    "resolution": "720p",
    "duration": "5",
    "camera_fixed": false,
    "seed": -1,
    "enable_safety_checker": true
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
    "taskId": "task_bytedance_1765186750343"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询接口查看任务进度并获取结果。请参考 [Get Task Details](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

## 相关资源

* [Market Overview](/cn/market/quickstart)
* [Common API](/cn/common-api/get-account-credits)

## 授权

### Authorization

**类型**: `string`  
**位置**: `header`  
**必需**: `是`

所有 API 均需通过 Bearer Token 进行身份验证。

**获取 API Key 步骤**：
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取你的 API Key。

**使用方法**：
在请求头中添加以下参数：
```
Authorization: Bearer YOUR_API_KEY
```

**注意事项**：
*   请妥善保管你的 API Key，切勿泄露给他人。
*   若怀疑 API Key 已泄露，请立即在管理页面重置。

## 请求体 (application/json)

### model

**类型**: `enum<string>`  
**默认值**: `bytedance/v1-pro-image-to-video`  
**必需**: `是`

用于生成任务的模型名称。必填字段。
*   该接口必须使用 `bytedance/v1-pro-image-to-video` 模型。

**可用选项**:
`bytedance/v1-pro-image-to-video`

**示例**:
```json
"bytedance/v1-pro-image-to-video"
```

### callBackUrl

**类型**: `string<uri>`  
**必需**: `否`

接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。
*   任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果。
*   回调内容包含生成内容的 URL 及任务相关信息。
*   你的回调接口需支持接收 POST 请求及 JSON 格式的请求体。
*   也可选择调用任务详情接口，主动轮询任务状态。

**示例**:
```json
"https://your-domain.com/api/callback"
```

### input

**类型**: `object`  
**必需**: `是`

生成任务的输入参数。

#### input.prompt

**类型**: `string`  
**必需**: `是`

用于视频生成的文本提示词（最大长度：10000 字符）。

**最大长度**: `10000`

**示例**:
```json
"一只金毛犬在海滩的浅浪中奔跑，镜头从后方低角度贴近水面拍摄，浪花定格在瞬间，海浪和爪子带有动态模糊拖影，午后阳光在湿漉漉的毛发上闪烁，阴天背景下云层富有戏剧性"
```

#### input.image_url

**类型**: `string`  
**必需**: `是`

用于生成视频的图片 URL。
*   需为上传后的文件 URL，而非文件内容。
*   支持的格式：image/jpeg、image/png、image/webp。
*   最大文件大小：10.0MB。

**示例**:
```json
"https://file.aiquickdraw.com/custom-page/akr/section-images/1755179021328w1nhip18.webp"
```

#### input.resolution

**类型**: `enum<string>`  
**默认值**: `720p`  
**必需**: `否`

视频分辨率。
*   `480p`: 生成速度更快。
*   `720p`: 兼顾速度与画质。
*   `1080p`: 画质更高。

**可用选项**:
`480p`, `720p`, `1080p`

**示例**:
```json
"720p"
```

#### input.duration

**类型**: `enum<string>`  
**默认值**: `5`  
**必需**: `否`

视频时长（单位：秒）。

**可用选项**:
`5`, `10`

**示例**:
```json
"5"
```

#### input.camera_fixed

**类型**: `boolean`  
**必需**: `否`

是否固定相机位置。

**示例**:
```json
false
```

#### input.seed

**类型**: `number`  
**默认值**: `-1`  
**必需**: `否`

用于控制视频生成的随机种子值。设为 -1 时随机生成。
*   **最小值**: `-1`
*   **最大值**: `2147483647`
*   **步长**: `1`
*   **范围**: `-1 <= x <= 2147483647`

**示例**:
```json
-1
```

#### input.enable_safety_checker

**类型**: `boolean`  
**必需**: `否`

安全校验开关。
*   Playground 环境下安全校验始终启用。
*   仅可通过 API 将该参数设为 `false` 以关闭安全校验。

**示例**:
```json
true
```

## 响应

### 请求成功

#### code

**类型**: `enum<integer>`  
**必需**: `是`

响应状态码。
*   `200`: 成功 - 请求已处理完成。
*   `401`: 未授权 - 身份验证凭据缺失或无效。
*   `402`: 积分不足 - 账户余额不足以执行该操作。
*   `404`: 未找到 - 请求的资源或接口不存在。
*   `422`: 参数验证错误 - 请求参数未通过校验。
*   `429`: 调用频率超限 - 已超出该资源的请求限制。
*   `455`: 服务不可用 - 系统正在维护中。
*   `500`: 服务器内部错误 - 处理请求时发生意外故障。
*   `501`: 生成失败 - 内容生成任务执行失败。
*   `505`: 功能禁用 - 当前请求的功能已被禁用。

**可用选项**:
`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

#### msg

**类型**: `string`  
**必需**: `是`

响应消息，请求失败时返回错误描述。

**示例**:
```json
"success"
```

#### data

**类型**: `object`  
**必需**: `是`

##### data.taskId

**类型**: `string`  
**必需**: `是`

任务 ID，可用于调用任务详情接口查询任务状态。

**示例**:
```json
"task_bytedance_1765186750343"
```