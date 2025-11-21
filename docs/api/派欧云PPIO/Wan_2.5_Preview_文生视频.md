# Wan 2.5 Preview 文生视频

Wan 2.5 Preview 文生视频模型支持根据文本描述生成高质量视频内容，可生成5秒或10秒的视频。新增音频能力：支持自动配音，也可自定义音频文件。


> **Warning**: 本接口支持个人认证及企业认证用户调用。请参见 实名认证，完成个人用户认证或企业用户认证，以确保可以正常使用本功能。


> **Tip**: 这是一个异步API，只会返回异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 来检索视频生成结果。


## ​
请求头


**Content-Type**: 枚举值: application/json


**Authorization**: Bearer 身份验证格式，例如：Bearer {{API 密钥}}。


## ​
请求体


**input**: 基础输入信息，如提示词等。

隐藏 字段说明

​
prompt
stringrequired
文本正向提示词。支持中英文，最长 2000 个字符，超出部分自动截断。
示例值：一只小猫在月光下奔跑。
​
negative_prompt
string
反向提示词，用于描述生成视频时需要避开的内容，可实现对画面的规避或限制。
支持中英文，最长500字符，超出部分自动截断。
示例值：低分辨率、错误、最差质量、低质量、残缺、多余的手指、比例不良等。
​
audio_url
string
用于视频生成的自定义音频文件URL。使用方法详见音频设置说明。
音频要求：
格式：wav、mp3。
时长：3~30秒。
文件大小：不超过15MB。
超长处理：若音频时长超过目标视频时长（如5秒或10秒），仅保留前5秒或前10秒，其余部分自动舍弃；若音频时长短于视频时长，超出部分为无声视频。例如音频为3秒、视频为5秒，则输出视频前3秒有声音，后2秒为静音。


**parameters**: 视频处理参数。

隐藏 字段说明

​
size
string
支持480P、720P、1080P分辨率。默认值：1920*1080（即1080P）。 size参数用于指定视频输出的分辨率，格式为宽*高。不同分辨率档位支持的具体值如下：
480P档位：可选分辨率
832*480：16:9
480*832：9:16
624*624：1:1
720P档位：可选分辨率
1280*720：16:9
720*1280：9:16
960*960：1:1
1088*832：4:3
832*1088：3:4
1080P档位：可选分辨率
1920*1080：16:9
1080*1920：9:16
1440*1440：1:1
1632*1248：4:3
1248*1632：3:4
关于 size 参数的常见误区：需填写具体分辨率（如 1280*720），不能填写比例（如 1:1）或档位名称（如 480P、720P）。
​
duration
integer
输出视频的时长，可选值：5秒、10秒。
默认值为5。
​
prompt_extend
bool
是否开启prompt智能改写。开启后，将使用大模型自动改写输入prompt，对于较短提示词提升生成效果，但处理时长会增加。
true：默认，开启智能改写
false：不改写
​
watermark
bool
是否添加水印标识，水印位于图片右下角，文案为”AI 生成”。
false：默认值，不添加水印。
true：添加水印。
​
audio
boolean
是否添加音频。
参数优先级：audio_url > audio，仅在 audio_url 为空时有效。
true：默认，自动为视频添加配音
false：不添加音频，输出为静音视频
示例值：true
​
seed
integer
随机数种子，用于控制模型生成内容的随机性。取值范围：[0, 2147483647]。
如果不填写，系统自动生成随机种子。若希望生成效果较为稳定一致，可指定相同的seed值。


## ​
返回结果


**task_id**: 异步任务的 task_id。您应该使用该 task_id 请求 查询任务结果 API 以获取生成结果

---

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/wan-2.5-t2v-preview \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '{
  "input": {
    "prompt": "<string>",
    "negative_prompt": "<string>",
    "audio_url": "<string>"
  },
  "parameters": {
    "size": "<string>",
    "duration": 123,
    "prompt_extend": true,
    "watermark": true,
    "audio": true,
    "seed": 123
  }
}'
```

## 响应示例

```json
{
  "task_id": "<string>"
}
```