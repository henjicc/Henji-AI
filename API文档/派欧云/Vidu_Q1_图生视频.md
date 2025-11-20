# Vidu Q1 图生视频

Vidu Q1 图生视频将静态图像转换为动态视频，融入创意故事叙述和动画效果。


> **Tip**: 这是一个异步API，只会返回异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 来检索视频生成结果。


## ​
请求头


**Content-Type**: 枚举值: application/json


**Authorization**: Bearer 身份验证格式，例如：Bearer {{API 密钥}}。


## ​
请求体


**images**: 用作生成视频起始帧的图像。
图像字段要求：
仅接受 1 张图像
支持公共 URL 或 Base64 格式
支持格式：png、jpeg、jpg、webp
图像宽高比必须小于 1:4 或 4:1
所有图像限制为 50MB
base64 解码后的长度必须小于 10MB，且必须包含适当的内容类型字符串。例如：
data:image/png;base64,{base64_encode}


**prompt**: 视频生成的文本提示词，最大长度为 1500 个字符。


**duration**: 视频持续时间（秒）。默认为 5 秒，目前仅支持 5 秒选项。


**seed**: 视频生成的随机种子。
默认为随机种子数值
手动设置的值将覆盖默认的随机种子


**resolution**: 输出视频分辨率。默认为 1080p，目前仅支持 1080p 选项。


**movement_amplitude**: 画面中物体的运动幅度。默认值：auto
可选值：auto、small、medium、large


**bgm**: 是否为生成的视频添加背景音乐。默认值：false
可选值：true、false
当设置为 true 时，系统将自动添加合适的 BGM。BGM 无时长限制，系统会自动适配。


## ​
响应


**task_id**: 异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 以获取生成结果

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/vidu-q1-img2video \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "images": [
    "<string>"
  ],
  "prompt": "<string>",
  "duration": 123,
  "seed": 123,
  "resolution": "<string>",
  "movement_amplitude": "<string>",
  "bgm": true
}'
```

## 响应示例

```json
{
  "task_id": "<string>"
}
```