# Ideogram 角色图像生成

基于 `ideogram/character` 模型实现图像生成。

**请求端点**
```
POST /api/v1/jobs/createTask
```

## 使用示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "ideogram/character",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "将上传肖像中的这位女性（身着休闲白衬衫）置于宁静的花园场景中。画面需呈现生机盎然的绿植与缤纷花卉，柔和的阳光透过枝叶洒落。她坐在木质长椅上，手持书本，浅笑嫣然。背景被葱郁的绿植填满，营造出静谧祥和的氛围。午后的金色光线勾勒出她的脸庞，在地面投下柔和的阴影，为整个画面增添悠然、沉思的意境。",
    "reference_image_urls": [
      "https://file.aiquickdraw.com/custom-page/akr/section-images/1755767145415pvz49dpi.webp"
    ],
    "rendering_speed": "BALANCED",
    "style": "AUTO",
    "expand_prompt": true,
    "num_images": "1",
    "image_size": "square_hd",
    "negative_prompt": ""
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
    "taskId": "task_ideogram_1765179922911"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 请求参数说明

### Authorizations

**Authorization**
*   **类型**: string
*   **位置**: header
*   **必需**: 是
*   **描述**: 所有 API 都需要通过 Bearer Token 进行身份验证。
    *   **获取 API Key**：访问 [API Key 管理页面](https://kie.ai/api-key) 获取。
    *   **使用方法**：在请求头中添加 `Authorization: Bearer YOUR_API_KEY`。
    *   **注意事项**：请妥善保管您的 API Key，切勿泄露给他人。若怀疑 API Key 泄露，请立即在管理页面重置。

### Body

**Content-Type**: `application/json`

**model**
*   **类型**: enum<string>
*   **必需**: 是
*   **默认值**: `ideogram/character`
*   **描述**: 用于生成任务的模型名称。该端点必须使用 `ideogram/character` 模型。
*   **可用选项**: `ideogram/character`
*   **示例**: `"ideogram/character"`

**callBackUrl**
*   **类型**: string<uri>
*   **必需**: 否
*   **描述**: 接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。
    *   任务生成完成后，系统会向该 URL POST 任务状态与结果。
    *   回调内容包含生成的资源 URL 与任务相关信息。
    *   您的回调端点需要支持接收带 JSON 负载的 POST 请求。
    *   也可以选择调用任务详情端点，主动轮询任务状态。
*   **示例**: `"https://your-domain.com/api/callback"`

**input**
*   **类型**: object
*   **描述**: 生成任务的输入参数。

**input.prompt**
*   **类型**: string
*   **必需**: 是
*   **最大长度**: 5000
*   **描述**: 用于填充图像蒙版区域的文本提示词。
*   **示例**: `"将上传肖像中的这位女性（身着休闲白衬衫）置于宁静的花园场景中。画面需呈现生机盎然的绿植与缤纷花卉，柔和的阳光透过枝叶洒落。她坐在木质长椅上，手持书本，浅笑嫣然。背景被葱郁的绿植填满，营造出静谧祥和的氛围。午后的金色光线勾勒出她的脸庞，在地面投下柔和的阴影，为整个画面增添悠然、沉思的意境。"`

**input.reference_image_urls**
*   **类型**: string<uri>[]
*   **必需**: 是
*   **描述**: 作为人物参考的图像集合。目前仅支持 1 张图像，其余图像将被忽略。（所有参考图像总大小不超过 10MB）。图像格式需为 JPEG、PNG 或 WebP（为上传后的文件 URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）。
*   **示例**:
    ```json
    [
      "https://file.aiquickdraw.com/custom-page/akr/section-images/1755767145415pvz49dpi.webp"
    ]
    ```

**input.rendering_speed**
*   **类型**: enum<string>
*   **必需**: 否
*   **默认值**: `BALANCED`
*   **描述**: 渲染速度。
*   **可用选项**: `TURBO`, `BALANCED`, `QUALITY`
*   **示例**: `"BALANCED"`

**input.style**
*   **类型**: enum<string>
*   **必需**: 否
*   **默认值**: `AUTO`
*   **描述**: 生成图像的风格类型。不可与 `style_codes` 同时使用。
*   **可用选项**: `AUTO`, `REALISTIC`, `FICTION`
*   **示例**: `"AUTO"`

**input.expand_prompt**
*   **类型**: boolean
*   **必需**: 否
*   **默认值**: `true`
*   **描述**: 是否启用 MagicPrompt 功能优化生成请求。
*   **示例**: `true`

**input.num_images**
*   **类型**: enum<string>
*   **必需**: 否
*   **默认值**: `1`
*   **描述**: 生成图像数量。
*   **可用选项**: `1`, `2`, `3`, `4`
*   **示例**: `"1"`

**input.image_size**
*   **类型**: enum<string>
*   **必需**: 否
*   **默认值**: `square_hd`
*   **描述**: 生成图像的分辨率规格。
*   **可用选项**: `square`, `square_hd`, `portrait_4_3`, `portrait_16_9`, `landscape_4_3`, `landscape_16_9`
*   **示例**: `"square_hd"`

**input.seed**
*   **类型**: integer
*   **必需**: 否
*   **描述**: 随机数生成器的种子值。

**input.negative_prompt**
*   **类型**: string
*   **必需**: 否
*   **默认值**: `""`
*   **最大长度**: 5000
*   **描述**: 需从生成图像中排除的内容描述。提示词中的描述优先级高于反向提示词。
*   **示例**: `""`

## 响应参数说明

**code**
*   **类型**: enum<integer>
*   **描述**: 响应状态码。
*   **可用选项及含义**:
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

**msg**
*   **类型**: string
*   **描述**: 响应消息，请求失败时为错误描述。
*   **示例**: `"success"`

**data**
*   **类型**: object
*   **描述**: 响应数据。

**data.taskId**
*   **类型**: string
*   **描述**: 任务 ID，可用于调用任务详情端点查询任务状态。
*   **示例**: `"task_ideogram_1765179922911"`