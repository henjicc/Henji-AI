# Kling V2.5 Turbo Pro 图生视频

基于 Kling 先进 AI 模型，将静态图像转换为动态视频。

**接口地址：** `POST /api/v1/jobs/createTask`

## 快速开始

使用 `kling/v2-5-turbo-image-to-video-pro` 模型从图像生成视频。

```bash
curl --request POST \
  --url https://api.kie.ai/api/v1/jobs/createTask \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "model": "kling/v2-5-turbo-image-to-video-pro",
  "callBackUrl": "https://your-domain.com/api/callback",
  "input": {
    "prompt": "宇航员瞬间穿过散发着光芒的魔法木门完成瞬移。采用手持跟踪镜头，相机保持在宇航员斜后上方 5–10 米处，呈现流畅的第三人称追逐视角。整体画面以超写实为基底，每个场景具备独特艺术风格，场景切换时伴随明亮的传送门光晕闪帧效果，细节拉满，8K 分辨率，搭配史诗级管弦乐背景音。通过高帧率插值实现流畅的动态效果与利落的瞬间转场。特写镜头：身着白色宇航服的宇航员从脚下发光的传送门中急速坠落。\n第一次转场：乐高风格阿尔卑斯山，高饱和度日光下，雪山峰峦与山谷尽收眼底，宇航员坠落过程中，下一个传送门开启。\n第二次转场：亚马逊雨林，茂密的树冠与河流在下方延展，宇航员坠落，传送门再次开启。\n第三次转场：古埃及风格，壁画质感的吉萨金字塔，沙漠与尼罗河铺展于下，宇航员坠落，传送门开启。\n第四次转场：抽象黑白水墨风格，下方是中国长城，宇航员坠落，最后一个传送门开启。\n第五次转场：纽约夜景，写实风格的深色城市天际线，璀璨的城市灯光与帝国大厦相映，宇航员优雅悬停。全程相机保持固定距离，轻微环绕运动，流畅的第三人称跟踪视角贯穿始终。每次传送门转场均伴随锐利的闪光，凸显速度感与魔幻的旅程体验，艺术风格与场景位置的切换极具冲击力。",
    "image_url": "https://file.aiquickdraw.com/custom-page/akr/section-images/1759211376283gfcw5zcy.png",
    "tail_image_url": "",
    "duration": "5",
    "negative_prompt": "模糊、失真、画质低下",
    "cfg_scale": 0.5
  }
}
'
```

**响应示例：**
```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_kling_1765184408908"
  }
}
```

## 查询任务状态

提交任务后，可通过统一的查询端点查看任务进度并获取生成结果。生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

## 接口参数说明

### Authorizations

**Authorization** `string` (header, required)

所有 API 都需要通过 Bearer Token 进行身份验证。

**获取 API Key：**
1.  访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key。

**使用方法：**
在请求头中添加：`Authorization: Bearer YOUR_API_KEY`

**注意事项：**
*   请妥善保管您的 API Key，切勿泄露给他人。
*   若怀疑 API Key 泄露，请立即在管理页面重置。

### Body

**Content-Type:** `application/json`

#### model
`enum<string>` (required, default: `kling/v2-5-turbo-image-to-video-pro`)

用于生成任务的模型名称。必填字段。
*   该端点必须使用 `kling/v2-5-turbo-image-to-video-pro` 模型。

**可用选项：** `kling/v2-5-turbo-image-to-video-pro`

**示例：** `"kling/v2-5-turbo-image-to-video-pro"`

#### callBackUrl
`string<uri>`

接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。
*   任务生成完成后，系统会向该 URL POST 任务状态与结果。
*   回调内容包含生成视频的 URL 与任务相关信息。
*   您的回调端点需要支持接收带 JSON 负载的 POST 请求。
*   也可以选择调用任务详情端点，主动轮询任务状态。

**示例：** `"https://your-domain.com/api/callback"`

#### input
`object`

生成任务的输入参数。

##### input.prompt
`string` (required)

视频生成的文本描述（最大长度：2500 字符）。

**最大字符串长度：** `2500`

**示例：** `"宇航员瞬间穿过散发着光芒的魔法木门完成瞬移。采用手持跟踪镜头，相机保持在宇航员斜后上方 5–10 米处，呈现流畅的第三人称追逐视角。整体画面以超写实为基底，每个场景具备独特艺术风格，场景切换时伴随明亮的传送门光晕闪帧效果，细节拉满，8K 分辨率，搭配史诗级管弦乐背景音。通过高帧率插值实现流畅的动态效果与利落的瞬间转场。特写镜头：身着白色宇航服的宇航员从脚下发光的传送门中急速坠落。\n第一次转场：乐高风格阿尔卑斯山，高饱和度日光下，雪山峰峦与山谷尽收眼底，宇航员坠落过程中，下一个传送门开启。\n第二次转场：亚马逊雨林，茂密的树冠与河流在下方延展，宇航员坠落，传送门再次开启。\n第三次转场：古埃及风格，壁画质感的吉萨金字塔，沙漠与尼罗河铺展于下，宇航员坠落，传送门开启。\n第四次转场：抽象黑白水墨风格，下方是中国长城，宇航员坠落，最后一个传送门开启。\n第五次转场：纽约夜景，写实风格的深色城市天际线，璀璨的城市灯光与帝国大厦相映，宇航员优雅悬停。全程相机保持固定距离，轻微环绕运动，流畅的第三人称跟踪视角贯穿始终。每次传送门转场均伴随锐利的闪光，凸显速度感与魔幻的旅程体验，艺术风格与场景位置的切换极具冲击力。"`

##### input.image_url
`string` (required)

用于生成视频的图像 URL（为上传后的文件 URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）。

**示例：** `"https://file.aiquickdraw.com/custom-page/akr/section-images/1759211376283gfcw5zcy.png"`

##### input.tail_image_url
`string`

视频结尾帧图像 URL（为上传后的文件 URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）。

**示例：** `""`

##### input.duration
`enum<string>` (default: `5`)

生成视频的时长（单位：秒）。

**可用选项：** `5`, `10`

**示例：** `"5"`

##### input.negative_prompt
`string`

视频中需要规避的元素（最大长度：2496 字符）。

**最大字符串长度：** `2496`

**示例：** `"模糊、失真、画质低下"`

##### input.cfg_scale
`number` (default: `0.5`)

CFG（无分类器引导）系数，用于控制模型贴合提示词的程度（最小值：0，最大值：1，步长：0.1）。

**必填范围：** `0 <= x <= 1`

**示例：** `0.5`

## 响应

### 请求成功

#### code
`enum<integer>`

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

**可用选项：** `200`, `401`, `402`, `404`, `422`, `429`, `455`, `500`, `501`, `505`

#### msg
`string`

响应消息，请求失败时为错误描述。

**示例：** `"success"`

#### data
`object`

##### data.taskId
`string`

任务 ID，可用于调用任务详情端点查询任务状态。

**示例：** `"task_kling_1765184408908"`