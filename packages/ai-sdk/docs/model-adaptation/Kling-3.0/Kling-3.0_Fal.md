# Kling 3.0 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `fal-ai/kling-video/v3/{pro,standard}/{text-to-video,image-to-video}` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`；**队列**：`POST https://queue.fal.run/<endpoint-id>`，`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）、`GET .../requests/{id}`
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单（Fal 用「档位 × 输入形态」拆端点）

| 档位 | 文生视频 | 图生视频 |
|---|---|---|
| Pro（1080P） | `fal-ai/kling-video/v3/pro/text-to-video` | `fal-ai/kling-video/v3/pro/image-to-video` |
| Standard（720P） | `fal-ai/kling-video/v3/standard/text-to-video` | `fal-ai/kling-video/v3/standard/image-to-video` |

> Fal 上 Kling v3 **没有 4K 档**（APIMart 与 KIE 有）。

## 3. 请求参数

### 3.1 `text-to-video`

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 可选 | — | **`prompt` 与 `multi_prompt` 必须二选一，不能同时给** |
| `multi_prompt` | array | 可选 | — | 多镜头分镜列表。给了就覆盖单 prompt，把视频切成多个镜头 |
| `duration` | string | 可选 | `"5"` | **字符串枚举** `"3"` ~ `"15"` |
| `generate_audio` | boolean | 可选 | **`true`** | 原生音频。**支持中英文语音输出，其他语言自动翻译成英文**；英文语音用小写字母，缩写或专有名词用大写 |
| `shot_type` | string | 可选 | `customize` | `customize` / `intelligent`（由模型自动决定分镜结构） |
| `aspect_ratio` | string | 可选 | `16:9` | `16:9`、`9:16`、`1:1` |
| `negative_prompt` | string | 可选 | **`"blur, distort, and low quality"`** | 负面提示词。**本项目规则：绝对不显示**，不下发——但注意 Fal **有非空默认值**，不下发时平台仍会用这个默认值 |
| `cfg_scale` | float | 可选 | `0.5` | 0–1，控制贴合提示词的程度 |

### 3.2 `image-to-video`

在上表基础上（**无 `aspect_ratio`**）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `start_image_url` | string | **必填** | 首帧图 URL |
| `end_image_url` | string | 可选 | 尾帧图 URL |
| `elements` | array | 可选 | 要出现在视频中的元素（角色 / 物体）。每个元素可以是**一组图片（正面图 + 参考图）或一个视频**。prompt 中用 **`@Element1`、`@Element2`** 引用 |

## 4. 响应结构

```json
{ "video": { "url": "https://v3b.fal.media/files/.../output.mp4" } }
```

## 5. 价格

来源：各端点 `llms.txt`（2026-08-22 读取）。

| 档位 | 关音频 | 开音频 | 开音频 + voice control |
|---|---|---|---|
| Pro | **$0.112 / 秒** | **$0.168 / 秒** | **$0.196 / 秒** |
| Standard | **$0.084 / 秒** | **$0.126 / 秒** | **$0.154 / 秒** |

例：Pro 5 秒、开音频 + voice control = $0.98。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 本端点**有 `negative_prompt` 且默认值非空**（`"blur, distort, and low quality"`）——不下发时它仍在生效，与「不使用负面提示词」不是一回事，需要在文档/产品上明确。
- `generate_audio` **默认 `true`**（APIMart / KIE 默认关），且有声比无声贵 50%。
- `duration` 是**字符串枚举**。
- **`prompt` 与 `multi_prompt` 互斥**，不能同时给。
- 档位通过 **endpoint 路径**选择（pro / standard），不是参数——适配层要做端点路由，且**没有 4K**。
- `image-to-video` 端点没有 `aspect_ratio`，比例由首帧图决定。
- `elements` 的引用写法是 `@Element1`（KIE / APIMart 是 `@自定义名称`），提示词模板不通用。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Pro 文生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video/llms.txt | 否 |
| Pro 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/llms.txt | 否 |
| Standard 文生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video/llms.txt | 否 |
| Standard 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
