# 模型适配清单（总索引）

本目录是**痕迹AI 的模型适配唯一资料源**。适配思路已从「挑一个供应商、把它的模型尽量做全」调整为：
**先定一份常用且优秀的模型清单，再为清单里的每个模型逐一接入所有支持它的供应商。**

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模型数量 | 主清单 19（图片 10 / 视频 9）+ 供应商专属 5 |
| 模型供应商文档数量 | 69 |
| 覆盖供应商 | 火山引擎（官方）、百炼（官方）、APIMart、KIE、Fal、派欧云、魔搭、Grsai（仅完成调研文档，未接入代码） |

## 一、目录结构约定

```
docs/model-adaptation/
├── README.md                      # 本文件：总清单 + 索引
├── 文档采集手册.md                  # 如何发现 / 抓取 / 处理供应商文档（做调研前先看这份）
├── 供应商/                         # 先完成供应商公共协议，再做具体模型
│   ├── 快速适配供应商.md             # 新供应商的统一核对与落地清单
│   ├── APIMart.md
│   ├── KIE.md
│   ├── Fal.md
│   ├── 百炼.md
│   ├── 火山引擎.md
│   ├── 派欧云.md
│   └── 魔搭.md
├── <模型名>/                       # 一个模型一个文件夹
│   └── <模型名>_<供应商名>.md       # 支持该模型的每个供应商一个文件
```

- **供应商名**使用项目内统一的中文显示名（`src/i18n/locales/zh-CN/models.json` → `models.providers`）：
  派欧云 / Fal / 魔搭 / KIE / APIMart / 百炼 / 火山引擎；Grsai 尚未接入代码，未在该 JSON 里登记，文档里沿用其官方品牌拼写
- 每个供应商文件都是**自包含**的：接入协议、能力清单、请求参数、响应结构、价格、适配要点、原始链接索引，看完这一份就能完成该供应商的适配
- 每份文件都标注**信息来源链接**以及**该链接是否需要登录**

### 供应商基础文档

模型适配前先看 [快速适配供应商](供应商/快速适配供应商.md)，确认供应商公共层已经覆盖端点、鉴权、上传、任务查询、结果解析和计价。现有八家基础文档：

- [APIMart](供应商/APIMart.md)：含中国大陆备用线路与图片上传协议
- [KIE](供应商/KIE.md)：生成任务、文件上传、实际扣费与余额查询
- [Fal](供应商/Fal.md)：同步 / 队列协议、Fal CDN、官方计价 API
- [百炼](供应商/百炼.md)：地域端点、临时 OSS 上传与同步 / 异步边界
- [火山引擎](供应商/火山引擎.md)：方舟端点、图片结果与 Files API 使用边界
- [派欧云](供应商/派欧云.md)：异步任务协议、**无官方上传（借用 KIE）**、实名认证前置、在售清单极小
- [魔搭](供应商/魔搭.md)：API-Inference 统一接口、**魔粒积分计费**、仅图片、可用性判定方法
- [Grsai](供应商/Grsai.md)：聚合中转，**同一模型拆多个「渠道」**（`-cl`/`-vip`/`-vt`/`-lite` 等后缀，价差可达 10 倍以上）、无独立上传接口（图片直接 base64/URL 塞进请求体）、**仅完成本轮调研文档，尚未接入生成 runtime**

## 二、通用适配规则

1. **默认绝对不显示的参数**：随机种子 `seed`、负面提示词。
   即使供应商提供了这两个字段，也**不注册、不下发**。各文件的「适配要点」会逐一标出哪个供应商有这两个字段。
2. **`output_format` 默认不显示且不请求**，保持供应商默认值。
3. 价格以**供应商的定价页 / 模型 `llms.txt` / 任务返回的 `cost`** 为准；部分 API 文档正文中的价格已过期，出现不一致时文件内会同时列出两处并说明取舍。
4. 各供应商同名参数的**默认值、取值集合、字段名经常不一致**（例如 `adaptive` vs `auto`、整数 `5` vs 字符串 `"5"`），必须按供应商分别声明 schema，不要共用常量。

## 三、模型清单

### 图片（10）

| 模型 | 火山引擎 | 百炼 | APIMart | KIE | Fal | 派欧云 | 魔搭 | Grsai |
|---|---|---|---|---|---|---|---|---|
| [Seedream 5.0 Pro](Seedream-5.0-Pro/) | [✅ 官方](Seedream-5.0-Pro/Seedream-5.0-Pro_火山引擎.md) | — | [✅](Seedream-5.0-Pro/Seedream-5.0-Pro_APIMart.md) | [✅](Seedream-5.0-Pro/Seedream-5.0-Pro_KIE.md) | [✅](Seedream-5.0-Pro/Seedream-5.0-Pro_Fal.md) | ❌ 无 | ❌ 无 | ❌ 无 |
| [Seedream 5.0 Lite](Seedream-5.0-Lite/) | [✅ 官方](Seedream-5.0-Lite/Seedream-5.0-Lite_火山引擎.md) | — | [✅](Seedream-5.0-Lite/Seedream-5.0-Lite_APIMart.md) | [✅](Seedream-5.0-Lite/Seedream-5.0-Lite_KIE.md) | [✅](Seedream-5.0-Lite/Seedream-5.0-Lite_Fal.md) | ❌ 无 | ❌ 无 | ❌ 无 |
| [Qwen Image 3.0](Qwen-Image-3.0/) | — | [✅ 官方](Qwen-Image-3.0/Qwen-Image-3.0_百炼.md) | [✅](Qwen-Image-3.0/Qwen-Image-3.0_APIMart.md) | [✅](Qwen-Image-3.0/Qwen-Image-3.0_KIE.md) | [✅](Qwen-Image-3.0/Qwen-Image-3.0_Fal.md) | ❌ 无 | ❌ 无 | ❌ 无 |
| [Z-Image Turbo](Z-Image-Turbo/) | — | [✅ 官方](Z-Image-Turbo/Z-Image-Turbo_百炼.md) | [✅](Z-Image-Turbo/Z-Image-Turbo_APIMart.md) | [✅](Z-Image-Turbo/Z-Image-Turbo_KIE.md) | [✅](Z-Image-Turbo/Z-Image-Turbo_Fal.md) | ❌ 无 | [✅](Z-Image-Turbo/Z-Image-Turbo_魔搭.md) | ❌ 无 |
| [GPT-Image-2](GPT-Image-2/) | — | — | [✅](GPT-Image-2/GPT-Image-2_APIMart.md) | [✅](GPT-Image-2/GPT-Image-2_KIE.md) | [✅](GPT-Image-2/GPT-Image-2_Fal.md) | ❌ 无 | ❌ 无 | [✅ 调研中](GPT-Image-2/GPT-Image-2_Grsai.md) |
| [Nano Banana 2](Nano-Banana-2/) | — | — | [✅](Nano-Banana-2/Nano-Banana-2_APIMart.md) | [✅](Nano-Banana-2/Nano-Banana-2_KIE.md) | [✅](Nano-Banana-2/Nano-Banana-2_Fal.md) | ❌ 无 | ❌ 无 | [✅ 调研中](Nano-Banana-2/Nano-Banana-2_Grsai.md) |
| [Nano Banana 2 Lite](Nano-Banana-2-Lite/) | — | — | [✅](Nano-Banana-2-Lite/Nano-Banana-2-Lite_APIMart.md) | [✅](Nano-Banana-2-Lite/Nano-Banana-2-Lite_KIE.md) | ❌ 无（已探测确认，见 [Fal 文档说明](Nano-Banana-2/Nano-Banana-2_Fal.md)） | ❌ 无 | ❌ 无 | [✅ 调研中](Nano-Banana-2-Lite/Nano-Banana-2-Lite_Grsai.md) |
| [Nano Banana Pro](Nano-Banana-Pro/) | — | — | [✅](Nano-Banana-Pro/Nano-Banana-Pro_APIMart.md) | [✅](Nano-Banana-Pro/Nano-Banana-Pro_KIE.md) | [✅](Nano-Banana-Pro/Nano-Banana-Pro_Fal.md) | ❌ 无 | ❌ 无 | [✅ 调研中](Nano-Banana-Pro/Nano-Banana-Pro_Grsai.md) |
| [Midjourney](Midjourney/) | — | — | [✅](Midjourney/Midjourney_APIMart.md) | ❌ 无 | ❌ 无 | ❌ 无 | ❌ 无 | ❌ 无 |
| [Grok Imagine 2.0](Grok-Imagine-2.0/) | — | — | [✅](Grok-Imagine-2.0/Grok-Imagine-2.0_APIMart.md) | [✅](Grok-Imagine-2.0/Grok-Imagine-2.0_KIE.md) | [✅](Grok-Imagine-2.0/Grok-Imagine-2.0_Fal.md) | ❌ 无 | ❌ 无 | ❌ 无 |

「✅ 调研中」表示 Grsai 侧已完成 API/价格调研文档，但尚未接入生成 runtime 代码（见 [Grsai 基础文档](供应商/Grsai.md)）。

**Nano Banana 2 Lite 是独立模型，不是 Nano Banana 2 的分辨率/渠道选项**：代码里两者 `canonicalModelId` 不同（`nano-banana-2` vs `nano-banana-2-lite`），`generationModelDescriptions.ts` 也各自维护一条独立描述，APIMart/KIE 均已用独立 `.model.ts` 文件实现，因此本表把它列为单独一行，不再挂在 Nano Banana 2 文档里。

### 视频（9）

| 模型 | APIMart | KIE | Fal | 派欧云 | 魔搭 |
|---|---|---|---|---|---|
| [Seedance 2.0](Seedance-2.0/) | [✅](Seedance-2.0/Seedance-2.0_APIMart.md) | [✅](Seedance-2.0/Seedance-2.0_KIE.md) | [✅](Seedance-2.0/Seedance-2.0_Fal.md) | ❌ 已下架 | ❌ 无 |
| [Seedance 2.0 Fast](Seedance-2.0-Fast/) | [✅](Seedance-2.0-Fast/Seedance-2.0-Fast_APIMart.md) | [✅](Seedance-2.0-Fast/Seedance-2.0-Fast_KIE.md) | [✅](Seedance-2.0-Fast/Seedance-2.0-Fast_Fal.md) | ❌ 已下架 | ❌ 无 |
| [Seedance 2.0 Mini](Seedance-2.0-Mini/) | [✅](Seedance-2.0-Mini/Seedance-2.0-Mini_APIMart.md) | [✅](Seedance-2.0-Mini/Seedance-2.0-Mini_KIE.md) | [✅](Seedance-2.0-Mini/Seedance-2.0-Mini_Fal.md) | ❌ 已下架 | ❌ 无 |
| [Seedance 2.5](Seedance-2.5/) | [✅](Seedance-2.5/Seedance-2.5_APIMart.md) | [✅](Seedance-2.5/Seedance-2.5_KIE.md) | [✅](Seedance-2.5/Seedance-2.5_Fal.md) | ❌ 已下架 | ❌ 无 |
| [MiniMax H3](MiniMax-H3/) | [✅](MiniMax-H3/MiniMax-H3_APIMart.md) | [✅](MiniMax-H3/MiniMax-H3_KIE.md) | [✅](MiniMax-H3/MiniMax-H3_Fal.md) | ❌ 无 | ❌ 无 |
| [Kling 3.0](Kling-3.0/) | [✅](Kling-3.0/Kling-3.0_APIMart.md) | [✅](Kling-3.0/Kling-3.0_KIE.md) | [✅](Kling-3.0/Kling-3.0_Fal.md) | [✅](Kling-3.0/Kling-3.0_派欧云.md) | ❌ 无 |
| [Kling 3.0 Turbo](Kling-3.0-Turbo/) | [✅](Kling-3.0-Turbo/Kling-3.0-Turbo_APIMart.md) | [✅](Kling-3.0-Turbo/Kling-3.0-Turbo_KIE.md) | [✅](Kling-3.0-Turbo/Kling-3.0-Turbo_Fal.md) | ❌ 无 | ❌ 无 |
| [Kling 3.0 Omni](Kling-3.0-Omni/) | [✅](Kling-3.0-Omni/Kling-3.0-Omni_APIMart.md) | [✅](Kling-3.0-Omni/Kling-3.0-Omni_KIE.md) | [✅](Kling-3.0-Omni/Kling-3.0-Omni_Fal.md) | ❌ 无 | ❌ 无 |
| [Gemini Omni Flash](Gemini-Omni-Flash/) | [✅](Gemini-Omni-Flash/Gemini-Omni-Flash_APIMart.md) | [✅](Gemini-Omni-Flash/Gemini-Omni-Flash_KIE.md) | [✅](Gemini-Omni-Flash/Gemini-Omni-Flash_Fal.md) | ❌ 无 | ❌ 无 |

视频类模型在**火山引擎与百炼上未纳入本清单**：Seedance 系列的官方接口不在本次适配范围，Kling 官方接口按用户要求**仅作参考、暂不适配**（能力地图：https://www.klingai.com/document-api/guides/capability-map/video ）。

Grsai 暂未在此表出现：其站内「Veo API」旧版文档给出了 `veo3.1-fast` 视频模型的端点，但该模型**未出现在 dashboard「模型列表」的定价清单中**，可用性与计价未确认，详见 [Grsai 基础文档 §7](供应商/Grsai.md)。

### 供应商专属模型（5）

以下模型**不在主清单里**，但已在代码中适配并对用户开放，文档用于维护现有实现。它们只在单一供应商上提供，未来是否纳入主清单待定。

| 模型 | 模态 | 供应商 | 文档 |
|---|---|---|---|
| MiniMax Hailuo 2.3 | 视频 | 派欧云 | [Hailuo-2.3_派欧云.md](Hailuo-2.3/Hailuo-2.3_派欧云.md) |
| Wan 2.5 Preview | 视频 | 派欧云 | [Wan-2.5-Preview_派欧云.md](Wan-2.5-Preview/Wan-2.5-Preview_派欧云.md) |
| Wan 2.6 | 视频 | 派欧云 | [Wan-2.6_派欧云.md](Wan-2.6/Wan-2.6_派欧云.md) |
| Wan 2.7 | 视频 | 派欧云 | [Wan-2.7_派欧云.md](Wan-2.7/Wan-2.7_派欧云.md) |
| MiniMax Speech | 音频 | 派欧云 | [MiniMax-Speech_派欧云.md](MiniMax-Speech/MiniMax-Speech_派欧云.md) |

魔搭侧另有 5 个已适配的开源图像模型（`Qwen/Qwen-Image`、`Qwen/Qwen-Image-Edit-2509`、`black-forest-labs/FLUX.1-Krea-dev`、`MusePublic/majicMIX_realistic`、`MusePublic/14_ckpt_SD_XL`）。它们共用魔搭 API-Inference 的同一套端点与参数，差异只有 model ID、尺寸上限和魔粒档位，因此不单独建文件，统一记在 [供应商/魔搭.md](供应商/魔搭.md) 第 7 节。

## 四、平台模型 ID 速查

| 模型 | APIMart | KIE | Fal |
|---|---|---|---|
| Seedream 5.0 Pro | `seedream-5-0-pro` | `seedream/5-pro-text-to-image`、`5-pro-image-to-image`、`5-pro-layer-decomposition` | `bytedance/seedream/v5/pro/{text-to-image,edit}` |
| Seedream 5.0 Lite | `seedream-5-0-lite` | `seedream/5-lite-text-to-image`、`5-lite-image-to-image` | `bytedance/seedream/v5/lite/{text-to-image,edit}` |
| Qwen Image 3.0 | `qwen-image-3.0`、`qwen-image-3.0-pro` | `qwen3/{text-to-image,image-to-image}`、`qwen3-pro/text-to-image`、`qwen3/pro-image-to-image` | `alibaba/qwen-image-3/{text-to-image,edit}` |
| Z-Image Turbo | `z-image-turbo` | `z-image` | `fal-ai/z-image/turbo`、`fal-ai/z-image/turbo/image-to-image`；魔搭 `Tongyi-MAI/Z-Image-Turbo` |
| GPT-Image-2 | `gpt-image-2`（别名 `gpt-image-2-ext`）、`gpt-image-2-official` | `gpt-image-2-text-to-image`、`gpt-image-2-image-to-image` | `openai/gpt-image-2`、`openai/gpt-image-2/edit` |
| Nano Banana 2 | `gemini-3.1-flash-image-preview`(-official) | `nano-banana-2` | `fal-ai/nano-banana-2`、`fal-ai/nano-banana-2/edit` |
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image`(-ext) | `nano-banana-2-lite` | ❌ 无（已探测确认） |
| Nano Banana Pro | `gemini-3-pro-image-preview`(-official) | `nano-banana-pro` | `fal-ai/nano-banana-pro`、`fal-ai/nano-banana-pro/edit` |
| Midjourney | `midjourney`（Imagine）、`midjourney-blend`、`midjourney-edit`、`midjourney-video`（新路由均自动注入平台模型 ID） | — | — |
| Grok Imagine 2.0 | `grok-imagine-2.0-ext`、`grok-imagine-image-2.0` | `grok-imagine-image-2-0/{text-to-image,image-edit,segment-map,segment-edit}` | `xai/grok-imagine-image/v2.0/{text-to-image,edit}` |
| Seedance 2.0 | `seedance-2.0` | `bytedance/seedance-2` | `bytedance/seedance-2.0/{text-to-video,image-to-video,reference-to-video}` |
| Seedance 2.0 Fast | `seedance-2.0-fast` | `bytedance/seedance-2-fast` | `bytedance/seedance-2.0/fast/...` |
| Seedance 2.0 Mini | `seedance-2.0-mini` | `bytedance/seedance-2-mini` | `bytedance/seedance-2.0/mini/...` |
| Seedance 2.5 | `seedance-2.5` | `bytedance/seedance-2-5` | `bytedance/seedance-2.5/...` |
| MiniMax H3 | `MiniMax-H3`、`MiniMax-H3-Context-IR`、`MiniMax-H3-Regeneration` | `minimax-h3/{text-to-video,image-to-video,reference-to-video}` | `minimax/h3/{text-to-video,image-to-video,reference-to-video}` |
| Kling 3.0 | `kling-v3` | `kling-3.0/video` | `fal-ai/kling-video/v3/{pro,standard}/...`；派欧云 `/v3/async/kling-v3.0-{std,pro,4k}-{t2v,i2v}` |
| Kling 3.0 Turbo | `kling-3.0-turbo` | `kling/v3-turbo-{text,image}-to-video` | `fal-ai/kling-video/v3/turbo/{pro,standard}/...` |
| Kling 3.0 Omni | `kling-v3-omni` | `kling-3.0-omni/{text-to-video,image-to-video,reference-to-video,transformation}` | `fal-ai/kling-video/o3/{pro,standard}/...` |
| Gemini Omni Flash | `gemini-omni-flash-preview`、`Omni-Flash-Ext` | `gemini-omni-video` + `/api/v1/omni/audio/create` + `/api/v1/omni/character/create` | `google/gemini-omni-flash/{image-to-video,reference-to-video}` |

Grsai 的平台模型 ID 未并入本表：它把「渠道」直接编码进 `model` 字段（如 `nano-banana-2-cl`、`gpt-image-2-vip`），渠道数量比 APIMart/KIE/Fal 常见的 2 档更多（Nano Banana 2 主模型 4 个、Nano Banana 2 Lite 2 个、Nano Banana Pro 5 个），完整枚举见对应模型文档：[GPT-Image-2_Grsai.md](GPT-Image-2/GPT-Image-2_Grsai.md)、[Nano-Banana-2_Grsai.md](Nano-Banana-2/Nano-Banana-2_Grsai.md)、[Nano-Banana-2-Lite_Grsai.md](Nano-Banana-2-Lite/Nano-Banana-2-Lite_Grsai.md)、[Nano-Banana-Pro_Grsai.md](Nano-Banana-Pro/Nano-Banana-Pro_Grsai.md)。

## 五、供应商通用协议速查

| 供应商 | Base URL | 鉴权 | 提交 | 查询 | 结果字段 |
|---|---|---|---|---|---|
| **火山引擎** | `https://ark.cn-beijing.volces.com` | `Authorization: Bearer $ARK_API_KEY` | `POST /api/v3/images/generations`（**同步**） | — | `data[].url` / `b64_json` |
| **百炼** | `https://{WorkspaceId}.<region>.maas.aliyuncs.com` | `Authorization: Bearer sk-xxxx` | `POST /api/v1/services/aigc/multimodal-generation/generation`（同步）；异步加头 `X-DashScope-Async: enable` 并换 `image-generation/generation` | `GET /api/v1/tasks/{task_id}` | `output.choices[].message.content[].image` |
| **APIMart** | `https://api.apimart.ai`；大陆备用线路见[基础文档](供应商/APIMart.md) | `Authorization: Bearer <KEY>` | `POST /v1/images/generations`、`POST /v1/videos/generations` | `GET /v1/tasks/{task_id}` | `result.images[]` / `result.videos[]` |
| **KIE** | `https://api.kie.ai` | `Authorization: Bearer <KEY>` | `POST /api/v1/jobs/createTask` | `GET /api/v1/jobs/recordInfo?taskId=` | `JSON.parse(resultJson).resultUrls` |
| **Fal** | `https://fal.run` / `https://queue.fal.run` | `Authorization: Key $FAL_KEY` | `POST https://queue.fal.run/<endpoint-id>` | `GET .../requests/{id}/status`、`GET .../requests/{id}` | `images[]` / `video` |
| **派欧云** | `https://api.ppio.com/v3`（代码仍用旧域名 `api.ppinfra.com`，待核实） | `Authorization: Bearer <KEY>` | `POST /v3/async/<route>` | `GET /v3/async/task-result?task_id=` | `images[].image_url` / `videos[].video_url` / `audios[].audio_url`（TTL 3600s） |
| **魔搭** | `https://api-inference.modelscope.cn` | `Authorization: Bearer <TOKEN>` | `POST /v1/images/generations` + 头 `X-ModelScope-Async-Mode: true`（代码写的是 `/api/v1/jobs/createTask`，待核实） | `GET /v1/tasks/{task_id}` + 头 `X-ModelScope-Task-Type: image_generation` | `output_images[]` |
| **Grsai**（未接入代码） | `https://grsaiapi.com`（全球）/ `https://grsai.dakka.com.cn`（国内直连） | `Authorization: Bearer <API Key>` | `POST /v1/api/generate`（`replyType` 控制同步/流式/异步） | `GET /v1/api/result?id=` | `results[].url` |

任务状态枚举：
- APIMart：`pending` / `processing` / `completed` / `failed` / `cancelled`（Midjourney 另有 MJ 风格状态 `NOT_START` / `SUBMITTED` / `IN_PROGRESS` / `MODAL` / `SUCCESS` / `FAILURE`）
- KIE：`waiting` / `queuing` / `generating` / `success` / `fail`
- Fal：`IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`
- 百炼异步：`PENDING` / `RUNNING` / `SUCCEEDED` / `FAILED` / `CANCELED` / `UNKNOWN`
- 派欧云：`TASK_STATUS_QUEUED` / `TASK_STATUS_PROCESSING` / `TASK_STATUS_SUCCEED` / `TASK_STATUS_FAILED`
- 魔搭：`SUCCEED` / `FAILED`
- Grsai：`running` / `violation`（违规，独立终态）/ `succeeded` / `failed`

## 六、常用外部入口

| 用途 | 链接 | 是否需登录 |
|---|---|---|
| APIMart 文档总索引 | https://docs.apimart.ai/llms.txt | 否 |
| APIMart 定价中心 | https://apimart.ai/zh/pricing | 否 |
| KIE 文档总索引 | https://docs.kie.ai/llms.txt | 否 |
| KIE 定价页 | https://kie.ai/pricing | 否 |
| Fal 平台总览 | https://fal.ai/llms.txt | 否 |
| Fal 单模型 schema | `https://fal.ai/models/<endpoint-id>/llms.txt` | 否 |
| 火山方舟图片生成 API | https://www.volcengine.com/docs/82379/1541523 | 否 |
| 火山方舟模型价格 | https://www.volcengine.com/docs/82379/1544106 | 否 |
| 百炼模型价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| 可灵官方视频能力地图（仅参考） | https://www.klingai.com/document-api/guides/capability-map/video | 否 |
| 派欧云文档索引 | https://ppio.com/docs/llms.txt | 否 |
| 派欧云定价页 | https://ppio.com/pricing | 否 |
| 魔搭 API-Inference 文档 | https://www.modelscope.cn/docs/model-service/API-Inference/intro | 否 |
| 魔搭魔粒说明 | https://www.modelscope.cn/docs/magicube/intro | 否 |
| APIMart API Key | https://apimart.ai/keys | **是** |
| KIE API Key | https://kie.ai/api-key | **是** |
| Fal API Key | https://fal.ai/dashboard/keys | **是** |
| 火山方舟 API Key | https://console.volcengine.com/ark/region:cn-beijing/apiKey | **是** |
| 百炼 API Key | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
| Grsai 文档总索引（llms.txt） | https://qmy27nhsd9.apifox.cn/llms.txt | 否 |
| Grsai dashboard 模型列表（权威价格） | https://grsai.com/zh/dashboard/models | 否 |
| Grsai dashboard 公告（渠道调价历史） | https://grsai.com/zh/dashboard/announcements | 否 |
| Grsai API Key | https://grsai.ai/zh/dashboard/api-keys | **是** |

## 七、维护方式

- **动手前**：先读 [文档采集手册.md](文档采集手册.md)——里面是如何拿到供应商文档全量清单、避免漏掉端点的具体做法
- **新增模型**：在本文件的清单表里加一行 → 建同名文件夹 → 为每个支持它的供应商写一份 `<模型名>_<供应商名>.md`
- **更新已有模型**：直接改对应的供应商文件，并更新该文件头部的「最后更新」以及本文件的「最后更新」
- **信息来源要求**：每条参数 / 价格都要能追溯到文件末尾「原始链接索引」中的某个链接；需要登录才能看到的页面必须标注
