# POST Hailuo Pro 图生视频

使用 `hailuo/02-image-to-video-pro` 模型将静态图像转换为动态视频。

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "hailuo/02-image-to-video-pro",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "电影级宽幅镜头：一艘巨型星际飞船静静悬浮在土星环上空，金属船体反射着缕缕宇宙光芒。镜头缓缓推进，露出数千扇亮着灯光的舷窗，宛如一座漂浮的城市。小型战斗机穿梭于画面之中，在浩瀚宇宙里灵活机动，留下霓虹色的尾迹。推进器突然迸发能量，小行星碎片在慢镜头下四散飞溅，碰撞时闪烁着微弱的光芒，而后缓缓飘向远方。",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/17585210783150ispzfo7.png",
    "end_image_url": "",
    "prompt_optimizer": true
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
    "taskId": "task_hailuo_1765185328412"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询接口查看任务进度并获取结果。建议参考 [Get Task Details](/cn/market/common/get-task-detail)。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

## 请求参数说明

### Authorizations

**Authorization**
*   **类型**: `string`
*   **位置**: `header`
*   **必需**: 是
*   **描述**: 所有 API 均需通过 Bearer Token 进行身份验证。
    *   **获取 API Key**: 访问 [API Key 管理页面](https://kie.ai/api-key) 获取。
    *   **使用方法**: 在请求头中添加 `Authorization: Bearer YOUR_API_KEY`。
    *   **注意事项**: 请妥善保管你的 API Key，切勿泄露。若怀疑 API Key 已泄露，请立即在管理页面重置。

### Body

**Content-Type**: `application/json`

**model**
*   **类型**: `enum<string>`
*   **必需**: 是
*   **默认值**: `hailuo/02-image-to-video-pro`
*   **描述**: 用于生成任务的模型名称。该接口必须使用 `hailuo/02-image-to-video-pro` 模型。
*   **可用选项**: `hailuo/02-image-to-video-pro`
*   **示例**: `"hailuo/02-image-to-video-pro"`

**callBackUrl**
*   **类型**: `string<uri>`
*   **必需**: 否
*   **描述**: 接收生成任务完成通知的回调 URL。生产环境建议使用。
    *   任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果。
    *   回调内容包含生成内容的 URL 及任务相关信息。
    *   你的回调接口需支持接收 POST 请求及 JSON 格式的请求体。
    *   也可选择调用任务详情接口，主动轮询任务状态。
*   **示例**: `"https://your-domain.com/api/callback"`

**input**
*   **类型**: `object`
*   **必需**: 是
*   **描述**: 生成任务的输入参数。

**input.prompt**
*   **类型**: `string`
*   **必需**: 是
*   **最大长度**: 1500
*   **描述**: 描述目标视频动画效果的文本提示词。
*   **示例**: `"电影级宽幅镜头：一艘巨型星际飞船静静悬浮在土星环上空，金属船体反射着缕缕宇宙光芒。镜头缓缓推进，露出数千扇亮着灯光的舷窗，宛如一座漂浮的城市。小型战斗机穿梭于画面之中，在浩瀚宇宙里灵活机动，留下霓虹色的尾迹。推进器突然迸发能量，小行星碎片在慢镜头下四散飞溅，碰撞时闪烁着微弱的光芒，而后缓缓飘向远方。"`

**input.image_url**
*   **类型**: `string`
*   **必需**: 是
*   **描述**: 待动画化的输入图像 URL。
    *   需为上传后的文件 URL，而非文件内容。
    *   支持的格式：`image/jpeg`、`image/png`、`image/webp`。
    *   最大文件大小：10.0MB。
*   **示例**: `"https://file.aiquickdraw.com/custom-page/akr/section-images/17585210783150ispzfo7.png"`

**input.end_image_url**
*   **类型**: `string`
*   **必需**: 否
*   **描述**: 可选参数，作为视频最后一帧的图像 URL。
    *   需为上传后的文件 URL，而非文件内容。
    *   支持的格式：`image/jpeg`、`image/png`、`image/webp`。
    *   最大文件大小：10.0MB。
*   **示例**: `""`

**input.prompt_optimizer**
*   **类型**: `boolean`
*   **必需**: 否
*   **描述**: 是否启用模型的提示词优化功能。
*   **示例**: `true`

## 响应参数说明

**code**
*   **类型**: `enum<integer>`
*   **描述**: 响应状态码。
*   **可用选项及含义**:
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
*   **描述**: 响应消息，请求失败时返回错误描述。
*   **示例**: `"success"`

**data**
*   **类型**: `object`
*   **描述**: 响应数据。

**data.taskId**
*   **类型**: `string`
*   **描述**: 任务 ID，可用于调用任务详情接口查询任务状态。
*   **示例**: `"task_hailuo_1765185328412"`