---
title: "Vidu Q3 Pro 图生视频 - PPIO 派欧云文档中心"
url: "https://ppio.com/docs/models/reference-vidu-q3-pro-i2v"
captured_at: "2026-03-19T15:49:32.171Z"
---
# Vidu Q3 Pro 图生视频

## 描述
Vidu Q3 Pro 图像转视频工具可将静态图像转换为动态视频，在保持主体一致性的同时，生成自然运动与更流畅的场景动态效果。

这是一个异步 API，只会返回异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 来检索视频生成结果。

## 请求

### 请求头
- **Content-Type**  
  必填，枚举值：`application/json`

- **Authorization**  
  必填，Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`

### 请求体
| 参数 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `seed` | integer | 否 | 随机生成 | 随机种子，用于可重复生成；0 或不传则随机生成。取值范围：`[0, 2147483647]` |
| `audio` | string | 否 | - | 视频背景音乐的自定义音频 URL；支持 `mp3`、`wav`、`m4a`、`flac` 格式；最大 20MB |
| `style` | string | 否 | `"general"` | 输出视觉风格；`general` 为写实风格，`anime` 为动漫风格。可选值：`general`, `anime` |
| `images` | array | 是 | - | 参考图片 URL 数组；支持 `.jpg`、`.jpeg`、`.png`、`.webp`。每张图片大小不超过 50MB；宽高比需在 1:4 与 4:1 之间。目前只支持输入 1 张图。 |
| `is_rec` | boolean | 否 | `false` | 启用音画匹配；设为 `true` 时，音频节奏与视频动态同步 |
| `prompt` | string | 否 | - | 视频生成的运动描述；描述场景运动、动作和动态效果。长度限制：0 - 1500 |
| `wm_url` | string | 否 | - | 自定义水印图片 URL；支持 `png`、`jpeg`、`jpg`、`webp` 格式；最大 10MB |
| `duration` | integer | 否 | `5` | 视频时长（秒）。取值范围：`[1, 16]` |
| `off_peak` | boolean | 否 | `false` | 使用非高峰时段定价；设为 `true` 时，任务排队等待非高峰时段处理以降低成本 |
| `watermark` | boolean | 否 | `false` | 在输出视频上启用水印 |
| `resolution` | string | 否 | `"720p"` | 输出视频分辨率。可选值：`540p`, `720p`, `1080p` |
| `wm_position` | string | 否 | - | 水印在视频上的位置。可选值：`top-left`, `top-right`, `bottom-left`, `bottom-right` |
| `aspect_ratio` | string | 否 | `"16:9"` | 输出视频宽高比。可选值：`16:9`, `9:16`, `4:3`, `3:4`, `1:1` |

## 响应
- **task_id**  
  必填，异步任务的 `task_id`。您应该使用该 `task_id` 请求 **查询任务结果 API** 以获取生成结果。

## 示例

### cURL
```bash
curl --request POST \
  --url https://api.ppio.com/v3/async/vidu-q3-pro-i2v \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '
{
  "seed": 123,
  "audio": "<string>",
  "style": "<string>",
  "images": [
    {}
  ],
  "is_rec": true,
  "prompt": "<string>",
  "wm_url": "<string>",
  "duration": 123,
  "off_peak": true,
  "watermark": true,
  "resolution": "<string>",
  "wm_position": "<string>",
  "aspect_ratio": "<string>"
}
'
```

### 响应示例
```json
{
  "task_id": "<string>"
}
```

---
**技术支持**：此文档由 Mintlify 构建并托管，这是一个开发者文档平台。