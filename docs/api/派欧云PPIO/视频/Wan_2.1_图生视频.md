# Wan 2.1 图生视频

Wan 2.1 14B 图生视频模型提供加速推理服务，是一套全面且开放的视频基础模型套件。默认生成 5 秒的视频。

> **注意**：本模型服务仅对已完成 PPIO 派欧云平台企业认证的用户开放。详情请参见[实名认证](/docs/support/identity-verification)。

这是一个**异步** API，调用后会返回一个异步任务的 `task_id`。您需要使用此 `task_id` 调用 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来获取视频生成结果。

## 请求示例

**请求**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/wan-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
  "image_url": "<string>",
  "negative_prompt": "<string>",
  "width": 123,
  "height": 123,
  "loras": [
    {
      "path": "<string>",
      "scale": 123
    }
  ],
  "seed": 123,
  "steps": 123,
  "guidance_scale": 123,
  "flow_shift": 123,
  "enable_safety_checker": true,
  "fast_mode": true
}
'
```

**响应**
```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 必须为 `application/json`。 |
| `Authorization` | string | 是 | Bearer 令牌格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 是否必需 | 描述与约束 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | 指导生成的提示文本。长度范围：`[1, 2000]`。 |
| `image_url` | string | 是 | 用于视频生成的图像 URL。 |
| `negative_prompt` | string | 否 | 负面提示，指示模型避免生成哪些元素。长度范围：`[0, 2000]`。 |
| `width` | integer | 否 | 输出视频的宽度。枚举值：`480`, `720`, `832`, `1280`。默认值：`832`。<br>如果未指定宽度或高度，两者将被强制设置为 `832` 和 `480`。 |
| `height` | integer | 否 | 输出视频的高度。默认值：`480`。<br>支持以下组合：<br>- 宽度 `480`，高度 `832` (480p)<br>- 宽度 `832`，高度 `480` (480p)<br>- 宽度 `720`，高度 `1280` (720p)<br>- 宽度 `1280`，高度 `720` (720p)<br>如果未指定宽度或高度，两者将被强制设置为 `832` 和 `480`。<br>**注意**：输出视频将保持输入图像的宽高比，`宽度 x 高度` 设置仅决定输出视频的清晰度（例如，720p 比 480p 更清晰）。 |
| `loras` | object[] | 否 | 应用于视频生成的 LoRA 模型。最多可指定 **3 个** LoRA 模型。 |
| `loras[].path` | string | 是 | LoRA 模型的路径。可以是 Hugging Face 的模型名称（如 `Remade-AI/Painting`）或 Civitai 的模型下载 URL（如 `https://civitai.com/api/download/models/1513385?type=Model&format=SafeTensor`）。<br>**注意**：LoRA 模型必须与 Wan2.1 14B I2V 兼容，否则将无法工作。 |
| `loras[].scale` | number | 是 | LoRA 的缩放值。值越大，LoRA 效果越明显。类型：`float32`，取值范围：`[0, 4.0]`。 |
| `seed` | integer | 否 | 随机数种子，用于稳定扩散产生噪声。取值范围：`[-1, 9999999999]`。默认值：`-1`。 |
| `steps` | integer | 否 | 迭代步数，即图片创建过程的迭代次数。取值范围：`[1, 40]`。默认值：`30`。 |
| `guidance_scale` | float | 否 | 引导缩放参数，控制生成内容对提示的跟随程度。取值范围：`[0, 10]`。默认值：`5.0`。 |
| `flow_shift` | float | 否 | 主要影响视频中物体运动的速度和幅度。值越高，运动越明显、越快；值越低，运动越慢、越细微。取值范围：`[1, 10]`。默认值：`5.0`。 |
| `enable_safety_checker` | boolean | 否 | 控制是否对生成的内容应用安全过滤器。启用后有助于过滤掉潜在的有害或不当内容。默认值：`true`。 |
| `fast_mode` | boolean | 否 | 是否启用快速模式。启用后将更快生成视频，但可能降低质量和价格。默认值：`false`。 |

## 响应

| 参数 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 ID。用于请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |

## 完整示例

### 1. 生成任务 ID
向 API 发送 POST 请求以启动视频生成任务。

**请求**
```bash
curl --location 'https://api.ppinfra.com/v3/async/wan-i2v' \
--header 'Authorization: Bearer {{API Key}}' \
--header 'Content-Type: application/json' \
--data '{
    "image_url": "https://pub-f964a1c641c04024bce400ad128c8cd6.r2.dev/wan-i2v-input-image.jpg",
    "height": 1280,
    "width": 720,
    "steps": 25,
    "seed": -1,
    "prompt": "A cute panda is walking in the grassland slowly."
}'
```

**响应**
```json
{
    "task_id": "{返回的任务 ID}"
}
```

### 2. 获取输出视频
使用上一步返回的 `task_id` 查询任务结果。

**请求**
```bash
curl --location --request GET 'https://api.ppinfra.com/v3/async/task-result?task_id={返回的任务 ID}' \
--header 'Authorization: Bearer {{API Key}}'
```

**响应**
```json
{
    "task": {
        "task_id": "{返回的任务 ID}",
        "task_type": "WAN_IMG_TO_VIDEO",
        "status": "TASK_STATUS_SUCCEED",
        "reason": "",
        "eta": 0,
        "progress_percent": 100
    },
    "images": [],
    "videos": [
        {
            "video_url": "{生成视频的 URL}",
            "video_url_ttl": "3600",
            "video_type": "mp4"
        }
    ]
}
```

**视频文件**
示例视频：[https://pub-f964a1c641c04024bce400ad128c8cd6.r2.dev/wan-i2v-demo.mp4](https://pub-f964a1c641c04024bce400ad128c8cd6.r2.dev/wan-i2v-demo.mp4)

---
[Wan 2.1 文生视频](/docs/models/reference-wan2.1-t2v) | [Wan 2.2 文生视频](/docs/models/reference-wan2.2-t2v)