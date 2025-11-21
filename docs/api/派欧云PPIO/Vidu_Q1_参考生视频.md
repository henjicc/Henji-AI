# Vidu Q1参考生视频
## 请求示例
curl --request POST \
  --url https://api.ppinfra.com/v3/async/vidu-q1-reference2video \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "images": [
    "<string>"
  ],
  "prompt": "<string>",
  "duration": 123,
  "seed": 123,
  "aspect_ratio": "<string>",
  "resolution": "<string>",
  "movement_amplitude": "<string>",
  "bgm": true
}'
## 200响应示例
{
  "task_id": "<string>"
}


Vidu Q1参考生视频使用参考图像和文本描述生成视频。支持各种主体，如角色和物体。通过上传主体的多个视角，您可以创建保持视觉一致性的视频。

这是一个异步API，只会返回异步任务的task_id。您应该使用该task_id请求查询任务结果API检索视频生成结果。

## 请求头

**Content-Type** `string` `required`
- 示例值: `application/json`

**Authorization** `string` `required`
- Bearer 身份验证格式，例如: `Bearer {{API 密钥}}`。

## 请求体

**images** `string[]` `required`
- 模型将使用提供的图像作为参考，生成具有一致主体的视频。

图像字段要求：
- 接受1至7张图像
- 图像资源可通过URL或Base64编码提供
- 必须使用以下格式之一: PNG、JPEG、JPG、WebP
- 图像尺寸必须至少为128x128像素
- 图像宽高比必须小于1:4或4:1
- 所有图像限制为50MB
- base64解码后的长度必须小于10MB，且必须包含适当的内容类型字符串。例如: `data:image/png;base64,{base64_encode}`

**prompt** `string` `required`
- 视频生成的文本提示词，最大长度为1500个字符。

**duration** `integer`
- 视频持续时间（秒）。默认为5秒，目前仅支持5秒选项。

**seed** `integer`
- 视频生成的随机种子。
  - 默认为随机种子数值
  - 手动设置的值将覆盖默认的随机种子

**aspect_ratio** `string`
- 输出视频的宽高比。默认值: `16:9`
- 可选值: `16:9`、`9:16`、`1:1`

**resolution** `string`
- 输出视频分辨率。默认为1080p，目前仅支持1080p选项。

**movement_amplitude** `string`
- 画面中物体的运动幅度。默认值: `auto`
- 可选值: `auto`、`small`、`medium`、`large`

**bgm** `boolean`
- 是否为生成的视频添加背景音乐。默认值: `false`
- 可选值: `true`、`false`
- 当设置为true时，系统将自动添加合适的BGM。BGM无时长限制，系统会自动适配。

## 响应

**task_id** `string` `required`
- 异步任务的task_id。您应该使用该task_id请求[查询任务结果API](#)以获取生成结果