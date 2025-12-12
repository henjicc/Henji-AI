# Qwen-Image 图像编辑

Qwen-Image 图像编辑是一个用于下一代图像编辑生成的20B MMDiT模型。基于20B Qwen-Image，它在保留风格的同时，提供精确的双语文本编辑（中文和英文），并支持语义和外观级别的编辑。

这是一个**异步**API，调用后只会返回异步任务的 `task_id`。您需要使用该 `task_id` 调用 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索生成结果。

## 请求示例

**请求方法：** `POST`

**请求地址：** `https://api.ppinfra.com/v3/async/qwen-image-edit`

**cURL 示例：**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/qwen-image-edit \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "image": "<string>",
  "seed": 123,
  "output_format": "<string>"
}
'
```

**响应示例：**
```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | 用于指导图像生成的文本提示。 |
| `image` | string | 是 | 用于编辑的原始图像。 |
| `seed` | integer | 否 | 用于生成的随机种子。范围：`-1` ~ `2147483647`。`-1` 表示使用随机种子。默认值为 `-1`。 |
| `output_format` | string | 否 | 输出图像的格式。枚举值：`jpeg`, `png`, `webp`。默认值为 `jpeg`。 |

## 响应参数

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的唯一标识符。用于查询 [任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |