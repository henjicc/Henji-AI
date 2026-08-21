# Kling 3.0 Omni · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 视频 |
| 供应商 | fal.ai（聚合平台） |
| 平台模型 ID | `fal-ai/kling-video/o3/{pro,standard}/{text-to-video,image-to-video,reference-to-video}` |
| 接口形态 | 队列异步（推荐）或同步直连 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

> ⚠️ **命名对应关系需注意**：Fal 把这一代叫 **「Kling O3」**，而可灵官方与 APIMart / KIE 叫 **Kling 3.0 Omni**（官方标识 `kling-v3-omni`）。本项目现有代码（`src/models/fal/kling-3.0-omni.model.ts`）已按 `fal-ai/kling-video/o3/*` 映射到 Kling 3.0 Omni。Fal 文档并未明写这层对应关系，**若后续行为不符需重新核对**。

## 1. 接入协议（Fal 通用）

- **鉴权**：`Authorization: Key $FAL_KEY`
- **同步**：`POST https://fal.run/<endpoint-id>`；**队列**：`POST https://queue.fal.run/<endpoint-id>`，`GET .../requests/{id}/status`（`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`）、`GET .../requests/{id}`
- **权威 schema**：`https://fal.ai/models/<endpoint-id>/llms.txt`

## 2. 能力清单

| 档位 | 文生视频 | 图生视频 | 参考生视频 |
|---|---|---|---|
| Pro | `fal-ai/kling-video/o3/pro/text-to-video` | `fal-ai/kling-video/o3/pro/image-to-video` | `fal-ai/kling-video/o3/pro/reference-to-video` |
| Standard | `fal-ai/kling-video/o3/standard/text-to-video` | `fal-ai/kling-video/o3/standard/image-to-video` | `fal-ai/kling-video/o3/standard/reference-to-video` |

## 3. 请求参数

### 3.1 三类端点共有

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `prompt` | string | 可选 | — | **`prompt` 与 `multi_prompt` 必须二选一，不能同时给** |
| `multi_prompt` | array | 可选 | — | 多镜头分镜列表 |
| `duration` | string | 可选 | `"5"` | **字符串枚举** `"3"` ~ `"15"` |
| `generate_audio` | boolean | 可选 | **`false`** | 原生音频（**注意与非 Omni 的 `kling-video/v3` 默认 `true` 相反**） |
| `shot_type` | string | 可选 | `customize` | `customize` / `intelligent` |

### 3.2 仅 `text-to-video`

| 字段 | 默认 | 取值 |
|---|---|---|
| `aspect_ratio` | `16:9` | `16:9`、`9:16`、`1:1` |

### 3.3 仅 `image-to-video`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_url` | string | **必填** | 首帧图 URL |
| `end_image_url` | string | 可选 | 尾帧图 URL |

模型定位：给定首帧与尾帧，按文本描述的风格与场景生成两帧之间的过渡动画。

### 3.4 仅 `reference-to-video`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `start_image_url` | string | 可选 | 作为视频首帧的图片 |
| `end_image_url` | string | 可选 | 作为视频尾帧的图片 |
| `image_urls` | string[] | 可选 | 风格 / 外观参考图，prompt 中用 **`@Image1`、`@Image2`** 引用。**使用视频时，elements + 参考图合计最多 4 个** |
| `elements` | array | 可选 | 要包含的元素（角色 / 物体），prompt 中用 **`@Element1`、`@Element2`** 引用 |

## 4. 响应结构

```json
{ "video": { "url": "https://v3b.fal.media/files/.../output.mp4" } }
```

## 5. 价格

来源：各端点 `llms.txt`（2026-08-22 读取）。三类端点（文生 / 图生 / 参考生）在同一档位下同价。

| 档位 | 关音频 | 开音频 |
|---|---|---|
| Pro | **$0.112 / 秒** | **$0.14 / 秒** |
| Standard | **$0.084 / 秒** | **$0.112 / 秒** |

例：Pro 5 秒开音频 = $0.70；Standard 5 秒开音频 = $0.56。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。Fal 的 o3 端点这两个字段都没有。
- **`generate_audio` 默认 `false`**，与同平台的 `kling-video/v3`（默认 `true`）相反，两个模型不能共用默认值。
- `duration` 是**字符串枚举**。
- 档位与输入形态都通过 **endpoint 路径**选择，共 6 个端点，适配层要做路由。
- **Fal 上没有 4K 档**（APIMart / KIE 有），也没有 `video_list` 视频编辑 / transformation 能力。
- 素材引用写法是 `@Image1` / `@Element1`，与 APIMart 的 `<<<image_N>>>`、KIE 的 `@自定义名称` 都不同——提示词模板必须按供应商分开。
- 「Kling O3 = Kling 3.0 Omni」这层命名映射未见 Fal 官方文档明确背书，接入或排障时要留意。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Pro 文生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/o3/pro/text-to-video/llms.txt | 否 |
| Pro 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/o3/pro/image-to-video/llms.txt | 否 |
| Pro 参考生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video/llms.txt | 否 |
| Standard 文生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/o3/standard/text-to-video/llms.txt | 否 |
| Standard 图生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/o3/standard/image-to-video/llms.txt | 否 |
| Standard 参考生视频 schema + 价格 | https://fal.ai/models/fal-ai/kling-video/o3/standard/reference-to-video/llms.txt | 否 |
| 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 |
| 可灵官方视频能力地图（确认 `kling-v3-omni` 命名） | https://www.klingai.com/document-api/guides/capability-map/video | 否 |
| API Key 创建 | https://fal.ai/dashboard/keys | **是** |
