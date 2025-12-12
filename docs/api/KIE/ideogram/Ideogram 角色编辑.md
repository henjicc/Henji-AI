# Ideogram 角色编辑

基于 `ideogram/character-edit` 模型实现图像生成。

## 请求

**Endpoint**
```
POST /api/v1/jobs/createTask
```

**cURL 示例**
```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "ideogram/character-edit",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "造型惊艳，头部微微低垂，面带微笑向前看\n",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/17557680349256sa0lk53.webp",
    "mask_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1755768046014ftgvma28.webp",
    "reference_image_urls": [
      "https://file.aiquickdraw.com/custom-page/akr/section-images/1755768064644jodsmfhq.webp"
    ],
    "rendering_speed": "BALANCED",
    "style": "AUTO",
    "expand_prompt": true,
    "num_images": "1"
  }
}
'
```

**请求成功响应示例**
```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_ideogram_1765179908063"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。详情请参阅 [Get Task Details](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 相关资源

* [Market Overview](/cn/market/quickstart)
* [Common API](/cn/common-api/get-account-credits)

## 请求头

### Authorization

**类型**: `string`
**位置**: `header`
**必需**: 是

所有 API 都需要通过 Bearer Token 进行身份验证。

**获取 API Key**:
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

**使用方法**:
在请求头中添加：
```
Authorization: Bearer YOUR_API_KEY
```

**注意事项**:
*   请妥善保管您的 API Key，切勿泄露给他人。
*   若怀疑 API Key 泄露，请立即在管理页面重置。

## 请求体 (application/json)

### model

**类型**: `enum<string>`
**默认值**: `ideogram/character-edit`
**必需**: 是

用于生成任务的模型名称。该端点必须使用 `ideogram/character-edit` 模型。

**可用选项**:
*   `ideogram/character-edit`

**示例**:
```json
"ideogram/character-edit"
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

用于填充图像蒙版区域的文本提示词。

**最大长度**: 5000 字符

**示例**:
```json
"造型惊艳，头部微微低垂，面带微笑向前看\n"
```

#### input.image_url

**类型**: `string`
**必需**: 是

用于生成图像的基础图像 URL。尺寸需与蒙版图像匹配。

*   为上传后的文件 URL，非文件内容。
*   支持的类型：`image/jpeg`、`image/png`、`image/webp`。
*   最大文件大小：10.0MB。

**示例**:
```json
"https://file.aiquickdraw.com/custom-page/akr/section-images/17557680349256sa0lk53.webp"
```

#### input.mask_url

**类型**: `string`
**必需**: 是

用于图像修复的蒙版 URL。尺寸需与基础图像匹配。

*   为上传后的文件 URL，非文件内容。
*   支持的类型：`image/jpeg`、`image/png`、`image/webp`。
*   最大文件大小：10.0MB。

**示例**:
```json
"https://file.aiquickdraw.com/custom-page/akr/section-images/1755768046014ftgvma28.webp"
```

#### input.reference_image_urls

**类型**: `string<uri>[]`
**必需**: 是

作为人物参考的图像集合。目前仅支持 1 张图像，其余图像将被忽略。

*   所有参考图像总大小不超过 10MB。
*   图像格式需为 JPEG、PNG 或 WebP。
*   为上传后的文件 URL，非文件内容。
*   支持的类型：`image/jpeg`、`image/png`、`image/webp`。
*   最大文件大小：10.0MB。

**示例**:
```json
[
  "https://file.aiquickdraw.com/custom-page/akr/section-images/1755768064644jodsmfhq.webp"
]
```

#### input.rendering_speed

**类型**: `enum<string>`
**默认值**: `BALANCED`
**必需**: 否

渲染速度。

**可用选项**:
*   `TURBO`
*   `BALANCED`
*   `QUALITY`

**示例**:
```json
"BALANCED"
```

#### input.style

**类型**: `enum<string>`
**默认值**: `AUTO`
**必需**: 否

生成图像的风格类型。不可与 `style_codes` 同时使用。

**可用选项**:
*   `AUTO`
*   `REALISTIC`
*   `FICTION`

**示例**:
```json
"AUTO"
```

#### input.expand_prompt

**类型**: `boolean`
**必需**: 否

是否启用 MagicPrompt 功能优化生成请求。

**默认值**: `true`

**示例**:
```json
true
```

#### input.num_images

**类型**: `enum<string>`
**默认值**: `1`
**必需**: 否

生成图像数量。

**可用选项**:
*   `1`
*   `2`
*   `3`
*   `4`

**示例**:
```json
"1"
```

#### input.seed

**类型**: `integer`
**必需**: 否

随机数生成器的种子值。

## 响应

### 请求成功

#### code

**类型**: `enum<integer>`
**必需**: 是

响应状态码。

**可用选项及含义**:
*   `200`: 成功 - 请求已处理完成
*   `401`: 未授权 - 身份验证凭据缺失或无效
*   `402`: 积分不足 - 账户积分不足以执行该操作
*   `404`: 未找到 - 请求的资源或端点不存在
*   `422`: 验证错误 - 请求参数未通过校验
*   `429`: 速率限制 - 已超出该资源的请求频次限制
*   `455`: 服务不可用 - 系统正在维护中
*   `500`: 服务器错误 - 处理请求时发生意外故障
*   `501`: 生成失败 - 内容生成任务执行失败
*   `505`: 功能禁用 - 当前请求的功能暂未开放

#### msg

**类型**: `string`
**必需**: 是

响应消息，请求失败时为错误描述。

**示例**:
```json
"success"
```

#### data

**类型**: `object`
**必需**: 是

##### data.taskId

**类型**: `string`
**必需**: 是

任务 ID，可用于调用任务详情端点查询任务状态。

**示例**:
```json
"task_ideogram_1765179908063"
```