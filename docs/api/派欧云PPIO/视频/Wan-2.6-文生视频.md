# Wan 2.6 文生视频
wan2.6-t2v
Wan 2.6 文生视频
```
curl --request POST \
  --url https://api.ppio.com/v3/async/wan2.6-t2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '
{
  "input": {
    "prompt": "<string>",
    "audio_url": "<string>",
    "negative_prompt": "<string>"
  },
  "parameters": {
    "seed": 123,
    "size": "<string>",
    "audio": true,
    "duration": 123,
    "shot_type": "<string>",
    "watermark": true,
    "prompt_extend": true
  }
}
'
```

```
{
  "task_id": "<string>"
}
```

基于 AI 的文生视频服务，支持通过文本提示生成高质量视频内容，提供专业的视频生成能力：开箱即用的 REST 推理 API，最佳性能，无冷启动，价格实惠。
这是一个**异步** API，只会返回异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](https://ppio.com/docs/models/reference-get-async-task-result) 来检索视频生成结果。

请求头

Content-Type
string
必填
枚举值: `application/json`

Authorization
string
必填
Bearer 身份验证格式，例如：Bearer {{API 密钥}}。

请求体

input
object
必填
隐藏 properties

prompt
string
必填
文本提示词，用来描述生成视频中期望包含的元素和视觉特点。支持中英文，每个汉字/字母占一个字符，超过部分会自动截断。长度限制：0 - 2000

audio_url
string
音频文件URL，模型将使用该音频生成视频。支持HTTP或HTTPS协议。音频限制：格式为wav、mp3；时长3～30s；文件大小不超过15MB。超限处理：若音频长度超过duration值（5秒或10秒），自动截取前5秒或10秒，其余部分丢弃。若音频长度不足视频时长，超出音频长度部分为无声视频。例如，音频为3秒，视频时长为5秒，输出视频前3秒有声，后2秒无声。

negative_prompt
string
反向提示词，用来描述不希望在视频画面中看到的内容，可以对视频画面进行限制。支持中英文，长度不超过500个字符，超过部分会自动截断。长度限制：0 - 500

parameters
object
隐藏 properties

seed
integer
随机数种子。取值范围为[0, 2147483647]。未指定时，系统自动生成随机种子。若需提升生成结果的可复现性，建议固定seed值。请注意，由于模型生成具有概率性，即使使用相同seed，也不能保证每次生成结果完全一致。取值范围：[0, 2147483647]

size
string
默认值:"1920*1080"
指定生成视频的分辨率，格式为宽 _高。支持720P档位（1280_ 720/720 _1280/960_ 960/1088 _832/832_ 1088）、1080P档位（1920 _1080/1080_ 1920/1440 _1440/1632_ 1248/1248*1632）。可选值：`1280*720`, `720*1280`, `960*960`, `1088*832`, `832*1088`, `1920*1080`, `1080*1920`, `1440*1440`, `1632*1248`, `1248*1632`

audio
boolean
默认值:true
是否添加音频。参数优先级：audio_url > audio，仅在audio_url为空时生效。true：默认值，自动为视频添加音频；false：不添加音频，输出无声视频。

duration
integer
默认值:5
生成视频的时长，单位为秒。可选值为5、10、15，默认值为5。duration直接影响费用，费用=单价（基于分辨率）×时长（秒），请在调用前确认模型价格。可选值：`5`, `10`, `15`

shot_type
string
默认值:"multi"
视频生成模式。single：单镜头生成；multi：多镜头生成。可选值：`single`, `multi`

watermark
boolean
默认值:false
是否添加水印标识，水印位于视频右下角，文案固定为”AI 生成”。false：默认值，不添加水印；true：添加水印。

prompt_extend
boolean
默认值:true
是否开启prompt智能改写。开启后使用大模型对输入prompt进行智能改写。对于较短的prompt生成效果提升明显，但会增加耗时。true：默认值，开启智能改写；false：不开启智能改写。

响应

task_id
string
必填
异步任务的 task_id。您应该使用该 task_id 请求 [查询任务结果 API](https://ppio.com/docs/models/reference-get-async-task-result) 以获取生成结果