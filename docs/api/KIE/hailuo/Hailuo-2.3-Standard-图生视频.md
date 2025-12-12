# POST Hailuo 2.3 Standard 图生视频

基于海洛先进 AI 模型，将静态图像转换为动态视频。

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
  "model": "hailuo/2-3-image-to-video-standard",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "两名身着盔甲的中世纪骑士在日落时分展开激烈决斗，电影级光影效果。金属盔甲反射着太阳的暖金色光芒与泛光的剑刃，刀剑相撞时火花四溅。镜头动态运镜，浅景深，富有戏剧性的慢动作效果。场景设定在开阔的沙漠战场，空气中弥漫着尘土，身后是暖橙色落日，史诗级氛围拉满。盔甲纹理细节丰富，反射效果逼真，体积光效果，电影级画质。",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1761736401898mpm67du5.webp",
    "duration": "6",
    "resolution": "768P"
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
    "taskId": "task_hailuo_1765182986510"
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
*   **说明**: 所有 API 都需要通过 Bearer Token 进行身份验证。
    *   获取 API Key：访问 [API Key 管理页面](https://kie.ai/api-key)。
    *   使用方法：在请求头中添加 `Authorization: Bearer YOUR_API_KEY`。
    *   注意事项：请妥善保管您的 API Key，切勿泄露给他人。若怀疑 API Key 泄露，请立即在管理页面重置。

### Body (application/json)

**model**
*   **类型**: enum<string>
*   **必需**: 是
*   **默认值**: `hailuo/2-3-image-to-video-standard`
*   **说明**: 用于生成任务的模型名称。该端点必须使用 `hailuo/2-3-image-to-video-standard` 模型。
*   **示例**: `"hailuo/2-3-image-to-video-standard"`

**callBackUrl**
*   **类型**: string<uri>
*   **必需**: 否
*   **说明**: 接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。
    *   任务生成完成后，系统会向该 URL POST 任务状态与结果。
    *   回调内容包含生成的资源 URL 与任务相关信息。
    *   您的回调端点需要支持接收带 JSON 负载的 POST 请求。
    *   也可以选择调用任务详情端点，主动轮询任务状态。
*   **示例**: `"https://your-domain.com/api/callback"`

**input**
*   **类型**: object
*   **必需**: 是
*   **说明**: 生成任务的输入参数。

**input.prompt**
*   **类型**: string
*   **必需**: 是
*   **最大长度**: 5000
*   **说明**: 描述期望视频动画效果的文本提示词。
*   **示例**: `"两名身着盔甲的中世纪骑士在日落时分展开激烈决斗，电影级光影效果。金属盔甲反射着太阳的暖金色光芒与泛光的剑刃，刀剑相撞时火花四溅。镜头动态运镜，浅景深，富有戏剧性的慢动作效果。场景设定在开阔的沙漠战场，空气中弥漫着尘土，身后是暖橙色落日，史诗级氛围拉满。盔甲纹理细节丰富，反射效果逼真，体积光效果，电影级画质。"`

**input.image_url**
*   **类型**: string
*   **必需**: 是
*   **说明**: 用于制作动画的输入图像 URL（为上传后的文件 URL，非文件内容）。
    *   **支持的类型**: image/jpeg、image/png、image/webp
    *   **最大文件大小**: 10.0MB
*   **示例**: `"https://file.aiquickdraw.com/custom-page/akr/section-images/1761736401898mpm67du5.webp"`

**input.duration**
*   **类型**: enum<string>
*   **必需**: 否
*   **默认值**: `6`
*   **说明**: 视频时长（单位：秒）。1080P 分辨率不支持 10 秒时长的视频。
*   **可用选项**: `6`, `10`
*   **示例**: `"6"`

**input.resolution**
*   **类型**: enum<string>
*   **必需**: 否
*   **默认值**: `768P`
*   **说明**: 生成视频的分辨率。
*   **可用选项**: `768P`, `1080P`
*   **示例**: `"768P"`

## 响应说明

**code**
*   **类型**: enum<integer>
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
*   **类型**: string
*   **说明**: 响应消息，请求失败时为错误描述。
*   **示例**: `"success"`

**data**
*   **类型**: object
*   **说明**: 响应数据。

**data.taskId**
*   **类型**: string
*   **说明**: 任务 ID，可用于调用任务详情端点查询任务状态。
*   **示例**: `"task_hailuo_1765182986510"`