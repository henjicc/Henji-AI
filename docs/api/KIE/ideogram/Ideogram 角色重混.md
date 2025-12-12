# Ideogram 角色重混

基于 `ideogram/character-remix` 模型实现图像生成。

**端点**
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
  "model": "ideogram/character-remix",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "鱼眼镜头自拍照片，拍摄于夜晚的城市街道。画面为圆形，带有黑色边框，画面中人物佩戴深色墨镜、身穿黑色夹克，手持银色数码相机举到面前拍摄倒影。背景可见一排关闭的店面卷帘门，上方有红色霓虹灯光。街道空无一人、光线昏暗，路灯在人行道上投射出暖光。鱼眼效果形成弯曲的畸变视角，让街道和建筑的直线呈现弧度。画面以红色和深色调为主，营造出氛围感拉满的都市情绪。人物倒影露出深色长发，位于圆形画面正中央。背景中多扇店面卷帘门形成重复的水平线条纹理。整体构图具有电影质感，昏暗街道与上方亮灯的店面形成强烈对比。",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1755768466167d0tiuc6e.webp",
    "reference_image_urls": [
      "https://file.aiquickdraw.com/custom-page/akr/section-images/1755768479029sugx0g6f.webp"
    ],
    "rendering_speed": "BALANCED",
    "style": "AUTO",
    "expand_prompt": true,
    "image_size": "square_hd",
    "num_images": "1",
    "strength": 0.8,
    "negative_prompt": "",
    "image_urls": [],
    "reference_mask_urls": ""
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
    "taskId": "task_ideogram_1765179916266"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 请求参数说明

### Authorizations

**Authorization**
*   **类型**: `string`
*   **位置**: `header`
*   **必需**: 是
*   **说明**: 所有 API 都需要通过 Bearer Token 进行身份验证。
    *   获取 API Key：访问 [API Key 管理页面](https://kie.ai/api-key)。
    *   使用方法：在请求头中添加 `Authorization: Bearer YOUR_API_KEY`。
    *   注意事项：请妥善保管您的 API Key，切勿泄露给他人。若怀疑 API Key 泄露，请立即在管理页面重置。

### Body

**Content-Type**: `application/json`

**model**
*   **类型**: `enum<string>`
*   **必需**: 是
*   **默认值**: `ideogram/character-remix`
*   **说明**: 用于生成任务的模型名称。该端点必须使用 `ideogram/character-remix` 模型。
*   **示例**: `"ideogram/character-remix"`

**callBackUrl**
*   **类型**: `string<uri>`
*   **必需**: 否
*   **说明**: 接收生成任务完成通知的回调 URL。建议在生产环境中使用。
    *   任务生成完成后，系统会向该 URL POST 任务状态与结果。
    *   回调内容包含生成的资源 URL 与任务相关信息。
    *   您的回调端点需要支持接收带 JSON 负载的 POST 请求。
*   **示例**: `"https://your-domain.com/api/callback"`

**input**
*   **类型**: `object`
*   **必需**: 是
*   **说明**: 生成任务的输入参数。

#### input 对象属性

**prompt**
*   **类型**: `string`
*   **必需**: 是
*   **最大长度**: 5000
*   **说明**: 用于图像重混创作的文本提示词。
*   **示例**: `"鱼眼镜头自拍照片，拍摄于夜晚的城市街道..."`

**image_url**
*   **类型**: `string`
*   **必需**: 是
*   **说明**: 待重混创作的基础图像 URL。为上传后的文件 URL，非文件内容。支持类型：`image/jpeg`, `image/png`, `image/webp`。最大文件大小：10.0MB。
*   **示例**: `"https://file.aiquickdraw.com/custom-page/akr/section-images/1755768466167d0tiuc6e.webp"`

**reference_image_urls**
*   **类型**: `string<uri>[]`
*   **必需**: 是
*   **说明**: 作为人物参考的图像集合。目前仅支持 1 张图像，其余图像将被忽略。所有参考图像总大小不超过 10MB。图像格式需为 JPEG、PNG 或 WebP。
*   **示例**:
    ```json
    [
      "https://file.aiquickdraw.com/custom-page/akr/section-images/1755768479029sugx0g6f.webp"
    ]
    ```

**rendering_speed**
*   **类型**: `enum<string>`
*   **必需**: 否
*   **默认值**: `BALANCED`
*   **可用选项**: `TURBO`, `BALANCED`, `QUALITY`
*   **说明**: 渲染速度。
*   **示例**: `"BALANCED"`

**style**
*   **类型**: `enum<string>`
*   **必需**: 否
*   **默认值**: `AUTO`
*   **可用选项**: `AUTO`, `REALISTIC`, `FICTION`
*   **说明**: 生成图像的风格类型。不可与 `style_codes` 同时使用。
*   **示例**: `"AUTO"`

**expand_prompt**
*   **类型**: `boolean`
*   **必需**: 否
*   **默认值**: `true`
*   **说明**: 是否启用 MagicPrompt 功能优化生成请求。
*   **示例**: `true`

**image_size**
*   **类型**: `enum<string>`
*   **必需**: 否
*   **默认值**: `square_hd`
*   **可用选项**: `square`, `square_hd`, `portrait_4_3`, `portrait_16_9`, `landscape_4_3`, `landscape_16_9`
*   **说明**: 生成图像尺寸规格。
*   **示例**: `"square_hd"`

**num_images**
*   **类型**: `enum<string>`
*   **必需**: 否
*   **默认值**: `1`
*   **可用选项**: `1`, `2`, `3`, `4`
*   **说明**: 生成图像数量。
*   **示例**: `"1"`

**seed**
*   **类型**: `integer`
*   **必需**: 否
*   **说明**: 随机数生成器的种子值。

**strength**
*   **类型**: `number`
*   **必需**: 否
*   **默认值**: `0.8`
*   **范围**: `0.1 <= x <= 1`
*   **步长**: `0.1`
*   **说明**: 基础图像在重混创作中的影响力权重。
*   **示例**: `0.8`

**negative_prompt**
*   **类型**: `string`
*   **必需**: 否
*   **默认值**: `""`
*   **最大长度**: 500
*   **说明**: 需从生成图像中排除的内容描述。提示词中的描述优先级高于反向提示词。
*   **示例**: `""`

**image_urls**
*   **类型**: `string<uri>[]`
*   **必需**: 否
*   **说明**: 作为风格参考的图像集合。所有风格参考图像总大小不超过 10MB。图像格式需为 JPEG、PNG 或 WebP。
*   **示例**:
    ```json
    []
    ```

**reference_mask_urls**
*   **类型**: `string`
*   **必需**: 否
*   **说明**: 应用于人物参考图像的蒙版集合。目前仅支持 1 张蒙版，其余蒙版将被忽略。所有人物参考蒙版总大小不超过 10MB。蒙版格式需为 JPEG、PNG 或 WebP。
*   **示例**: `""`

## 响应说明

**code**
*   **类型**: `enum<integer>`
*   **说明**: 响应状态码。
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
*   **类型**: `string`
*   **说明**: 响应消息，请求失败时为错误描述。
*   **示例**: `"success"`

**data**
*   **类型**: `object`
*   **说明**: 响应数据。

#### data 对象属性

**taskId**
*   **类型**: `string`
*   **说明**: 任务 ID，可用于调用任务详情端点查询任务状态。
*   **示例**: `"task_ideogram_1765179916266"`