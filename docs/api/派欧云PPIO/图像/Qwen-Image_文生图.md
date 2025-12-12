# Qwen-Image 文生图

Qwen-Image 是一个20B MMDiT模型，用于下一代文本到图像生成，特别擅长创建带有本地文本的惊艳图形海报。

这是一个**异步**API，调用后会返回一个异步任务的 `task_id`。您需要使用该 `task_id` 调用 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来获取最终的生成结果。

## 请求说明

**端点**
```
POST https://api.ppinfra.com/v3/async/qwen-image-txt2img
```

**cURL 示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/qwen-image-txt2img \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "size": "<string>"
}
'
```

## 请求头

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 令牌格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | 图像生成的文本提示。 |
| `size` | string | 否 | 生成图像的像素尺寸（宽*高）。默认值为 `1024*1024`。长和宽的像素范围：256 ~ 1536。 |

## 响应参数

调用成功将返回一个包含 `task_id` 的 JSON 对象。

```json
{
  "task_id": "<string>"
}
```

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 ID。用于查询 [任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |

## 完整示例

### 步骤 1：发起文生图请求

**请求**
```bash
curl --location 'https://api.ppinfra.com/v3/async/qwen-image-txt2img' \
--header 'Authorization: Bearer {{API Key}}' \
--header 'Content-Type: application/json' \
--data '{
    "prompt": "一只安静的橘色短毛猫蜷坐在黎明时分薄雾缭绕的湖边。它卷着尾巴，静静地望着水面。柔和的晨光透过树影洒下，冷色调，宁静氛围，轻雾环绕，50mm摄影风格。",
    "size": "1024*1024"
}'
```

**响应**
```json
{
    "task_id": "{返回的任务 ID}"
}
```

### 步骤 2：使用 task_id 查询结果

使用上一步返回的 `task_id` 查询任务状态并获取生成的图片。

**请求**
```bash
curl --location --request GET 'https://api.ppinfra.com/v3/async/task-result?task_id={返回的任务 ID}' \
--header 'Authorization: Bearer {{API Key}}'
```

**响应**
状态码 `2xx` 表示请求成功，`5xx` 表示服务器内部错误。生成的图片 URL 位于响应的 `images` 字段中。

```json
{
    "extra": {
        "has_nsfw_contents": []
    },
    "task": {
        "task_id": "679c6531-a8d1-400c-8071-d58ccf074ae5",
        "task_type": "QWEN_IMAGE_TEXT_TO_IMAGE",
        "status": "TASK_STATUS_SUCCEED",
        "reason": "",
        "eta": 0,
        "progress_percent": 0
    },
    "images": [
        {
            "image_url": "https://d2p7pge43lyniu.cloudfront.net/output/86d76970-441d-4b53-af90-4ce0ae092040-u1_2943371d-2819-4f96-8941-cbd46a8056eb.jpeg",
            "image_url_ttl": "0",
            "image_type": "jpeg",
            "nsfw_detection_result": null
        }
    ],
    "videos": [],
    "audios": []
}
```

**生成图片示例**
![示例图片](https://mintcdn.com/ppinfra/pGuwYZ6NEz3RzrAp/images/qwen-txt2img-output-demo.jpeg?fit=max&auto=format&n=pGuwYZ6NEz3RzrAp&q=85&s=a01b7f06cc32dfb8da996741c120e4c4)