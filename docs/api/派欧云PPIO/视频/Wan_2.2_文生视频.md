# Wan 2.2 文生视频

Wan 2.2（万相 2.2）专业版文生视频模型，能够根据文本描述生成高质量的视频内容。相比前代模型，在画面细节表现、运动稳定性等方面均有显著提升，可生成固定时长为 5 秒的视频。

本模型服务仅针对已完成 PPIO派欧云 平台企业认证的用户开放。具体请参见[实名认证](/docs/support/identity-verification)。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 请求示例

**请求方法**: `POST`
**请求地址**: `https://api.ppinfra.com/v3/async/wan-2.2-t2v`

**cURL 示例**:
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/wan-2.2-t2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "input": {
    "prompt": "<string>",
    "negative_prompt": "<string>"
  },
  "parameters": {
    "size": "<string>",
    "prompt_extend": true,
    "seed": 123,
    "watermark": true
  }
}
'
```

**响应示例**:
```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 固定为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

### `input` 对象
输入的基本信息，如提示词等。

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | 文本提示词。支持中英文，长度不超过800个字符，每个汉字/字母占一个字符，超过部分会自动截断。<br>**示例值**：`一只小猫在月光下奔跑`。 |
| `negative_prompt` | string | 否 | 反向提示词，用来描述不希望在视频画面中看到的内容，可以对视频画面进行限制。支持中英文，长度不超过500个字符，超过部分会自动截断。<br>**示例值**：`低分辨率、错误、最差质量、低质量、残缺、多余的手指、比例不良等`。 |

### `parameters` 对象
视频处理参数。

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `size` | string | 是 | 用于指定视频分辨率，格式为`宽*高`。<br><br>**480P档位**：<br>- `832*480`：16:9<br>- `480*832`：9:16<br>- `624*624`：1:1<br><br>**1080P档位**：<br>- `1920*1080`：16:9<br>- `1080*1920`：9:16<br>- `1440*1440`：1:1<br>- `1632*1248`：4:3<br>- `1248*1632`：3:4<br><br>**注意**：`size` 须设置为目标分辨率的具体数值（如 `1280*720`），而不是宽高比（如 `1:1`）或分辨率档位名称（如 `480P` 或 `720P`）。 |
| `prompt_extend` | bool | 否 | 是否开启prompt智能改写。开启后使用大模型对输入prompt进行智能改写。对于较短的prompt生成效果提升明显，但会增加耗时。<br>- `true`：默认值，开启智能改写。<br>- `false`：不开启智能改写。 |
| `seed` | integer | 否 | 随机数种子，用于控制模型生成内容的随机性。取值范围为 `[0, 2147483647]`。如果不提供，则算法自动生成一个随机数作为种子。如果希望生成内容保持相对稳定，可以使用相同的seed参数值。 |
| `watermark` | bool | 否 | 是否添加水印标识，水印位于图片右下角，文案为“AI生成”。<br>- `false`：默认值，不添加水印。<br>- `true`：添加水印。 |

## 响应

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |

---
[Wan 2.1 图生视频](/docs/models/reference-wan2.1-i2v) | [Wan 2.2 图生视频](/docs/models/reference-wan2.2-i2v)