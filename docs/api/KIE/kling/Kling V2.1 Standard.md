# Kling V2.1 Standard

基于 Kling 先进 AI 标准版模型生成视频。

## 接口说明

**端点：** `POST /api/v1/jobs/createTask`

**描述：** 使用 `kling/v2-1-standard` 模型生成视频内容。

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "kling/v2-1-standard",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "以上传的图片作为视频首帧。逐步让场景动起来：蒸汽从火车中升腾并向上飘散；灯笼灯光微微闪烁；身披斗篷的人物开始缓慢移动——行走、转身、整理随身物品。漂浮的尘埃或魔法粒子在光线下显现。文字“KLING 2.1 STANDARD API — Now on Kie.ai”泛着金色光芒柔和闪烁。镜头微微前推，随后缓缓淡出至黑屏。",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1755256596169mkkwr2ag.webp",
    "duration": "5",
    "negative_prompt": "模糊、畸变、低画质",
    "cfg_scale": 0.5
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
    "taskId": "task_kling_1765187766581"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询接口查看任务进度并获取结果。

生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

## 请求参数说明

### Authorizations

**Authorization**

*   **类型:** `string`
*   **位置:** `header`
*   **必需:** 是
*   **描述:** 所有 API 均需通过 Bearer Token 进行身份验证。
    *   **获取 API Key:** 访问 [API Key 管理页面](https://kie.ai/api-key) 获取你的 API Key。
    *   **使用方法:** 在请求头中添加 `Authorization: Bearer YOUR_API_KEY`。
    *   **注意事项:** 请妥善保管你的 API Key，切勿泄露给他人。若怀疑 API Key 已泄露，请立即在管理页面重置。

### Body

**Content-Type:** `application/json`

**model**

*   **类型:** `enum<string>`
*   **必需:** 是
*   **默认值:** `kling/v2-1-standard`
*   **描述:** 用于生成任务的模型名称。该接口必须使用 `kling/v2-1-standard` 模型。
*   **可用选项:** `kling/v2-1-standard`
*   **示例:** `"kling/v2-1-standard"`

**callBackUrl**

*   **类型:** `string<uri>`
*   **必需:** 否
*   **描述:** 接收生成任务完成通知的回调 URL。生产环境建议使用。
    *   任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果。
    *   回调内容包含生成内容的 URL 及任务相关信息。
    *   你的回调接口需支持接收 POST 请求及 JSON 格式的请求体。
    *   也可选择调用任务详情接口，主动轮询任务状态。
*   **示例:** `"https://your-domain.com/api/callback"`

**input**

*   **类型:** `object`
*   **必需:** 是
*   **描述:** 生成任务的输入参数。

**input.prompt**

*   **类型:** `string`
*   **必需:** 是
*   **最大长度:** 5000
*   **描述:** 描述期望生成视频内容的文本提示词。
*   **示例:** `"以上传的图片作为视频首帧。逐步让场景动起来：蒸汽从火车中升腾并向上飘散；灯笼灯光微微闪烁；身披斗篷的人物开始缓慢移动——行走、转身、整理随身物品。漂浮的尘埃或魔法粒子在光线下显现。文字“KLING 2.1 STANDARD API — Now on Kie.ai”泛着金色光芒柔和闪烁。镜头微微前推，随后缓缓淡出至黑屏。"`

**input.image_url**

*   **类型:** `string`
*   **必需:** 是
*   **描述:** 用于生成视频的图片 URL。
    *   需为上传后的文件 URL，而非文件内容。
    *   支持的格式：`image/jpeg`、`image/png`、`image/webp`。
    *   最大文件大小：10.0MB。
*   **示例:** `"https://file.aiquickdraw.com/custom-page/akr/section-images/1755256596169mkkwr2ag.webp"`

**input.duration**

*   **类型:** `enum<string>`
*   **必需:** 否
*   **默认值:** `5`
*   **描述:** 生成视频的时长（单位：秒）。
*   **可用选项:** `5`, `10`
*   **示例:** `"5"`

**input.negative_prompt**

*   **类型:** `string`
*   **必需:** 否
*   **最大长度:** 500
*   **描述:** 生成视频中需要规避的元素描述。
*   **示例:** `"模糊、畸变、低画质"`

**input.cfg_scale**

*   **类型:** `number`
*   **必需:** 否
*   **默认值:** `0.5`
*   **描述:** CFG（无分类器引导）系数，用于控制模型贴合提示词的程度。
*   **范围:** `0 <= x <= 1`
*   **步长:** `0.1`
*   **示例:** `0.5`

## 响应参数说明

**code**

*   **类型:** `enum<integer>`
*   **描述:** 响应状态码。
*   **可用选项及含义:**
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

**msg**

*   **类型:** `string`
*   **描述:** 响应消息，请求失败时返回错误描述。
*   **示例:** `"success"`

**data**

*   **类型:** `object`
*   **描述:** 响应数据。

**data.taskId**

*   **类型:** `string`
*   **描述:** 任务 ID，可用于调用任务详情接口查询任务状态。
*   **示例:** `"task_kling_1765187766581"`