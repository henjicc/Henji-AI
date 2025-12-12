# Hailuo Standard 图生视频

使用 `hailuo/02-image-to-video-standard` 模型将静态图像转换为动态视频。

## 请求示例

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "hailuo/02-image-to-video-standard",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "史诗级航拍镜头：一名孤独的武士伫立在嶙峋的山峰之巅，漫天樱花花瓣随风狂舞。他身后的天空一分为二——一半白昼，一半黑夜。镜头缓缓拉远，露出这座山峰实则是沉睡巨龙蜿蜒的脊背，巨龙的身躯横跨整个地平线。远处电光闪烁，巨龙的眼眸缓缓睁开，散发着古老魔法的光芒。武士面不改色，缓缓压低斗笠，手按在了刀柄之上。",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/17585207681646umf3lz8.png",
    "end_image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1758521423357w8586uq8.png",
    "duration": "10",
    "resolution": "768P",
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
    "taskId": "task_hailuo_1765185334551"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询接口查看任务进度并获取结果。生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

## 请求参数

### 认证

所有 API 均需通过 Bearer Token 进行身份验证。

获取 API Key 步骤：
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取你的 API Key。

使用方法：
在请求头中添加以下参数：
`Authorization: Bearer YOUR_API_KEY`

注意事项：
*   请妥善保管你的 API Key，切勿泄露给他人。
*   若怀疑 API Key 已泄露，请立即在管理页面重置。

### 请求体 (application/json)

#### model

**类型**: `enum<string>`
**默认值**: `hailuo/02-image-to-video-standard`
**必需**: 是

用于生成任务的模型名称。必填字段。
*   该接口必须使用 `hailuo/02-image-to-video-standard` 模型。

可用选项：
*   `hailuo/02-image-to-video-standard`

示例：
`"hailuo/02-image-to-video-standard"`

#### callBackUrl

**类型**: `string<uri>`
**必需**: 否

接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。
*   任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果。
*   回调内容包含生成内容的 URL 及任务相关信息。
*   你的回调接口需支持接收 POST 请求及 JSON 格式的请求体。
*   也可选择调用任务详情接口，主动轮询任务状态。

示例：
`"https://your-domain.com/api/callback"`

#### input

**类型**: `object`
**必需**: 是

生成任务的输入参数。

##### input.prompt

**类型**: `string`
**必需**: 是
**最大长度**: 1500

描述待生成视频效果的文本提示词。

示例：
`"史诗级航拍镜头：一名孤独的武士伫立在嶙峋的山峰之巅，漫天樱花花瓣随风狂舞。他身后的天空一分为二——一半白昼，一半黑夜。镜头缓缓拉远，露出这座山峰实则是沉睡巨龙蜿蜒的脊背，巨龙的身躯横跨整个地平线。远处电光闪烁，巨龙的眼眸缓缓睁开，散发着古老魔法的光芒。武士面不改色，缓缓压低斗笠，手按在了刀柄之上。"`

##### input.image_url

**类型**: `string`
**必需**: 是

作为视频第一帧的图像 URL。
*   需为上传后的文件 URL，而非文件内容。
*   支持的格式：`image/jpeg`、`image/png`、`image/webp`。
*   最大文件大小：10.0MB。

示例：
`"https://file.aiquickdraw.com/custom-page/akr/section-images/17585207681646umf3lz8.png"`

##### input.end_image_url

**类型**: `string`
**必需**: 否

作为视频最后一帧的图像 URL。
*   需为上传后的文件 URL，而非文件内容。
*   支持的格式：`image/jpeg`、`image/png`、`image/webp`。
*   最大文件大小：10.0MB。

示例：
`"https://file.aiquickdraw.com/custom-page/akr/section-images/1758521423357w8586uq8.png"`

##### input.duration

**类型**: `enum<string>`
**默认值**: `10`
**必需**: 否

视频时长（单位：秒）。1080p 分辨率不支持生成 10 秒时长的视频（注：本模型枚举值无 1080p，此处为通用约束说明）。

可用选项：
*   `6`
*   `10`

示例：
`"10"`

##### input.resolution

**类型**: `enum<string>`
**默认值**: `768P`
**必需**: 否

生成视频的分辨率。

可用选项：
*   `512P`
*   `768P`

示例：
`"768P"`

##### input.prompt_optimizer

**类型**: `boolean`
**必需**: 否

是否启用模型的提示词优化功能。

示例：
`true`

## 响应参数

### code

**类型**: `enum<integer>`

响应状态码。
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

可用选项：
`200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

### msg

**类型**: `string`

响应消息，请求失败时返回错误描述。

示例：
`"success"`

### data

**类型**: `object`

#### data.taskId

**类型**: `string`

任务 ID，可用于调用任务详情接口查询任务状态。

示例：
`"task_hailuo_1765185334551"`