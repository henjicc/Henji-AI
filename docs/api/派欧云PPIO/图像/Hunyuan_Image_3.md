# Hunyuan Image 3

Hunyuan Image 3 是一款先进的文生图模型。只需提供文字描述，即可生成高质量、富有情感和故事性的图片，助力您的创意表达与艺术创作。

本接口支持个人认证及企业认证用户调用。请参见 [实名认证](/docs/support/identity-verification)，完成个人用户认证或企业用户认证，以确保可以正常使用本功能。

这是一个**异步**API，只会返回异步任务的 task\_id。您应该使用该 task\_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索生成结果。

## 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/hunyuan-image-3 \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "size": "<string>",
  "seed": 123
}
'
```

## 响应示例

```json
{
  "task_id": "<string>"
}
```

## 请求头

### Content-Type
*   **类型**: string
*   **必需**: 是
*   **枚举值**: `application/json`

### Authorization
*   **类型**: string
*   **必需**: 是
*   **说明**: Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。

## 请求体

### prompt
*   **类型**: string
*   **必需**: 是
*   **说明**: 正向提示词，用于指导图片生成内容。

### size
*   **类型**: string
*   **必需**: 否
*   **说明**: 生成图片的尺寸，像素为宽\*高。每个维度范围 [256 ~ 1536]。
*   **默认值**: `1024*1024`

### seed
*   **类型**: integer
*   **必需**: 否
*   **说明**: 随机种子。取值为 -1 时表示随机种子。
*   **取值范围**: [-1 ~ 2147483647]
*   **默认值**: `-1`

## 返回结果

### task_id
*   **类型**: string
*   **必需**: 是
*   **说明**: 异步任务的 task\_id。您应该使用该 task\_id 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。