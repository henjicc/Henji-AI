# Wan 2.1 文生视频

Wan 2.1 14B 文生视频模型的加速推理，这是一套全面且开放的视频基础模型套件，推动了视频生成的边界。默认情况下，API 将生成 5 秒的视频。

本模型服务仅针对已完成 PPIO派欧云 平台企业认证的用户开放。具体请参见[实名认证](/docs/support/identity-verification)。

这是一个**异步**API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 来检索视频生成结果。

## 接口调用

**请求方法：** POST
**请求地址：** `https://api.ppinfra.com/v3/async/wan-t2v`

### 请求示例

```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/async/wan-t2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: application/json' \
  --data '
{
  "prompt": "<string>",
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

### 响应示例

```json
{
  "task_id": "<string>"
}
```

## 请求头

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 固定值：`application/json`。 |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数 | 类型 | 是否必需 | 说明与约束 |
| :--- | :--- | :--- | :--- |
| `prompt` | string | 是 | 指导生成所需的提示文本。取值范围：`[1, 2000]`。 |
| `negative_prompt` | string | 否 | 负面提示，指示模型避免生成哪些元素。取值范围：`[0, 2000]`。 |
| `width` | integer | 否 | 输出视频的宽度。枚举值：`480`、`720`、`832`、`1280`。默认：`832`。如果未指定宽度或高度，宽度和高度将被强制设置为 `832` 和 `480`。 |
| `height` | integer | 否 | 输出视频的高度。支持：<br>- (480p) 宽度为 `480` 时高度设置为 `832`<br>- (480p) 宽度为 `832` 时高度设置为 `480`<br>- (720p) 宽度为 `720` 时高度设置为 `1280`<br>- (720p) 宽度为 `1280` 时高度设置为 `720`<br>默认：`480`。如果未指定宽度或高度，宽度和高度将被强制设置为 `832` 和 `480`。 |
| `loras` | object[] | 否 | 应用于视频生成的 LoRA 模型。支持最多指定 **3 个 LoRA 模型**。 |
| `loras[].path` | string | 是 | LoRA 模型的路径。您可以指定来自 Hugging Face 的 LoRA 模型名称，例如：`Remade-AI/Cyberpunk`；或来自 Civitai 的模型下载 URL，例如：`https://civitai.com/api/download/models/1572591?type=Model&format=SafeTensor`。<br>**注意**：LoRA 模型必须与 Wan2.1 14B T2V 兼容，否则将无法工作。使用前请检查兼容性。 |
| `loras[].scale` | number | 是 | LoRA 的缩放值。值越大，LoRA 效果更明显。number(float32) 类型，取值范围：`[0, 4.0]`。 |
| `seed` | integer | 否 | 随机数种子，稳定扩散产生噪声的数字，取值范围：`[-1, 9999999999]`。默认值为 `-1`。 |
| `steps` | integer | 否 | 迭代步数，图片创建过程的迭代数，取值范围：`[1, 40]`。默认：`30`。 |
| `guidance_scale` | float | 否 | 引导缩放参数控制生成内容对提示的跟随程度。取值范围：`[0, 10]`。默认：`5.0`。 |
| `flow_shift` | float | 否 | `flow_shift` 参数主要影响视频中物体运动的速度和幅度。更高的值产生更明显和更快的运动，而较低的值使运动更慢更细微。取值范围：`[1, 10]`。默认：`5.0`。 |
| `enable_safety_checker` | boolean | 否 | 控制是否对生成的内容应用安全过滤器。启用时，它有助于从视频输出中过滤掉潜在的有害或不当内容。默认：`true`。 |
| `fast_mode` | boolean | 否 | 是否启用快速模式，将更快地生成视频但可能降低质量和价格。默认：`false`。 |

## 响应

| 参数 | 类型 | 是否必需 | 说明 |
| :--- | :--- | :--- | :--- |
| `task_id` | string | 是 | 异步任务的 `task_id`。您应该使用该 `task_id` 请求 [查询任务结果 API](/docs/models/reference-get-async-task-result) 以获取生成结果。 |

## 示例

以下是如何使用 Wan 2.1 文生视频 API 的示例。

### 步骤 1：生成视频任务

通过向 Wan 2.1 文生视频 API 发送 POST 请求生成 `task_id`。

**请求：**

```bash
curl --location 'https://api.ppinfra.com/v3/async/wan-t2v' \
--header 'Authorization: Bearer {{API Key}}' \
--header 'Content-Type: application/json' \
--data '{
    "height": 1280,
    "width": 720,
    "seed": -1,
    "prompt": "3D animation of a small, round, fluffy creature with big, expressive eyes explores a vibrant, enchanted forest. The creature, a whimsical blend of a rabbit and a squirrel, has soft blue fur and a bushy, striped tail. It hops along a sparkling stream, its eyes wide with wonder. The forest is alive with magical elements: flowers that glow and change colors, trees with leaves in shades of purple and silver, and small floating lights that resemble fireflies. The creature stops to interact playfully with a group of tiny, fairy-like beings dancing around a mushroom ring. The creature looks up in awe at a large, glowing tree that seems to be the heart of the forest."
}'
```

**响应：**

```json
{
    "task_id": "{返回的任务 ID}"
}
```

### 步骤 2：获取生成结果

使用上一步返回的 `task_id` 查询任务结果，获取输出视频。

**注意：** 2xx 范围内的 HTTP 状态码表示请求已被成功接受，而 5xx 范围内的状态码表示内部服务器错误。您可以在响应的 `videos` 字段中获取视频 URL。

**请求：**

```bash
curl --location --request GET 'https://api.ppinfra.com/v3/async/task-result?task_id={返回的任务 ID}' \
--header 'Authorization: Bearer {{API Key}}'
```

**响应：**

```json
{
    "task": {
        "task_id": "{返回的任务 ID}",
        "task_type": "WAN_TXT_TO_VIDEO",
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