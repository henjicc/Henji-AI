# Qwen Image 3.0 · 百炼（阿里云百炼，官方）

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 图片 |
| 供应商 | 阿里云百炼（Model Studio / DashScope），模型原厂官方接口 |
| 平台模型 ID | `qwen-image-3.0`（标准）、`qwen-image-3.0-pro`（Pro） |
| 接口形态 | **同步**（推荐）与**异步**两套，共用同一请求体 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

## 1. 接入协议

**必须保证模型、Endpoint URL、API Key 属于同一地域，跨地域调用会失败。**

百炼已推出业务空间专属域名，`{WorkspaceId}` 为业务空间 ID（在百炼控制台业务空间详情页查看）。旧域名 `https://dashscope.aliyuncs.com` / `https://dashscope-intl.aliyuncs.com` 仍可用。

### 同步调用（推荐）

`POST https://{WorkspaceId}.<region>.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`

| 地域 | `<region>` |
|---|---|
| 华北 2（北京） | `cn-beijing` |
| 新加坡 | `ap-southeast-1` |
| 德国（法兰克福） | `eu-central-1` |
| 日本（东京） | `ap-northeast-1` |

### 异步调用

请求头加 `X-DashScope-Async: enable`，**且换用不同的提交地址**（不要沿用同步地址）：

- 提交：`POST https://{WorkspaceId}.<region>.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation` → 返回 `task_id`
- 查询：`GET https://{WorkspaceId}.<region>.maas.aliyuncs.com/api/v1/tasks/{task_id}`
- `task_id` 查询有效期 24 小时；必须用提交时的**同地域、同业务空间、同 API Key** 查询

### 请求头

- `Content-Type: application/json`
- `Authorization: Bearer sk-xxxx`（百炼 API Key）

### 结果时效

生成图像 URL **有效期 24 小时**，格式为 PNG，必须及时转存。

## 2. 能力清单

| 能力 | 触发方式 |
|---|---|
| 文生图（T2I） | `content` 仅含 1 个 `{"text": "..."}` |
| 图生图 / 图像编辑（I2I） | `content` 含 **1–3 个** `{"image": "..."}` + 1 个 `{"text": "..."}` |
| 提示词智能改写（DPE / APE） | `prompt_extend` + `prompt_extend_mode` |
| 思考模式 | `enable_thinking` |
| 多图输出 | `n` 最多 6 张 |

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必选 | — | `qwen-image-3.0-pro` 或 `qwen-image-3.0` |
| `input.messages[0].role` | string | 必选 | — | 固定 `user`，**仅支持单轮**，数组有且只有 1 个对象 |
| `input.messages[0].content[].image` | string | I2I 必选 | — | 输入图 URL 或 `data:{MIME_type};base64,{data}`。**I2I 支持 1–3 张**，按数组顺序定义图像顺序 |
| `input.messages[0].content[].text` | string | 必选 | — | 正向提示词。支持中英文，推荐 ≤ 4500 Token。**只能传一个 `text`，不传或传多个会报错** |
| `parameters.prompt_extend` | boolean | 可选 | **`true`**（建议开启） | 提示词智能改写 |
| `parameters.prompt_extend_mode` | string | 可选 | `direct` | `direct`（DPE，T2I/I2I 都支持）；`agent`（APE，**仅 T2I**，I2I 传 `agent` 返回 400） |
| `parameters.enable_thinking` | boolean | 可选 | `true` | 思考模式，提升质量但增加耗时。**仅在 `prompt_extend=true` 时生效**；适用于 Direct T2I / Direct I2I / Agent T2I，Agent I2I 暂不支持 |
| `parameters.n` | integer | 可选 | `1` | 1–6 张 |
| `parameters.size` | string | 可选 | 模型自动推荐 | `宽*高`（注意是 `*` 不是 `x`）。T2I / I2I 均为：像素面积 `512*512` ~ `2048*2048`，宽高比 `1:8` ~ `8:1` |
| `parameters.negative_prompt` | string | 可选 | — | 反向提示词。**本项目规则：绝对不显示**，不下发 |
| `parameters.seed` | integer | 可选 | 随机 | `[0, 2147483647]`。**本项目规则：绝对不显示**，不下发 |
| `parameters.watermark` | boolean | 可选 | `false` | 是否加水印 |

输入图像要求：格式 JPG / JPEG / PNG / BMP / TIFF / WEBP / GIF；建议宽高均在 384–2048 px；单张 ≤ 10 MB。

## 4. 响应结构

**同步成功**：

```json
{
  "output": { "rewrite_status": "not_use", "choices": [ { "finish_reason": "stop",
    "message": { "role": "assistant", "content": [ { "image": "https://dashscope-result-...png?Expires=..." } ] } } ] },
  "usage": { "output_height": 1024, "output_width": 1024, "input_image_count": 0,
             "input_image_type": "qima_input_1k", "output_image_count": 1, "output_image_type": "qima_output_1k" },
  "request_id": "..."
}
```

**异步查询**：`output.task_status` ∈ `PENDING` / `RUNNING` / `SUCCEEDED` / `FAILED` / `CANCELED` / `UNKNOWN`；成功时同样在 `output.choices[].message.content[].image` 里；失败时 `output.code` / `output.message`。同时返回 `submit_time` / `scheduled_time` / `end_time`。

**计量档位**（决定价格）：`input_image_type` / `output_image_type` 按**输出分辨率像素面积**判断——面积 ≤ 2,250,000 记为 `..._1k`，> 2,250,000 记为 `..._2k`。

**失败**：顶层 `code` / `message`（如 `InvalidApiKey`）。

## 5. 价格（官方，人民币）

来源：[百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)（2026-08-30 读取）。

**华北 2（北京）**

| 模型 | 输出分辨率 | 输入单价 | 输出单价 | 免费额度 |
|---|---|---|---|---|
| `qwen-image-3.0-pro` | 1k | 0.02 元/张 | **0.25 元/张** | 输入输出共 10 张 |
| `qwen-image-3.0-pro` | 2k | 0.02 元/张 | **0.5 元/张** | 同上 |
| `qwen-image-3.0` | 1k | 0.02 元/张 | **0.18 元/张** | 输入输出共 10 张 |
| `qwen-image-3.0` | 2k | 0.02 元/张 | **0.18 元/张** | 同上 |

**新加坡（国际）**

| 模型 | 分辨率 | 输入单价 | 输出单价 |
|---|---|---|---|
| `qwen-image-3.0-pro` | 1k | 0.022483 元/张 | 0.299768 元/张 |
| `qwen-image-3.0-pro` | 2k | 0.022483 元/张 | 0.562065 元/张 |
| `qwen-image-3.0` | 1k / 2k | 0.022483 元/张 | 0.224826 元/张 |

德国（法兰克福）、日本（东京）与北京同价。免费额度有效期为开通百炼 / 模型发布 / 申请通过之日起 90 天内（以较晚者为准），且**仅华北 2（北京）地域有免费额度**。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词 `negative_prompt`。这两个字段官方**确实存在**，适配时必须主动不注册、不下发。
- `prompt_extend` 官方默认 `true`，会改变出图效果与耗时；`enable_thinking` 默认 `true` 也会显著增加耗时。是否暴露给用户需产品决定，但默认值要与官方保持一致或显式覆盖。
- `size` 分隔符是 `*` 不是 `x`，与火山、APIMart 的写法不同。
- I2I 最多 3 张参考图，比 Seedream 系列少得多。
- `qwen-image-3.0` 的 1k / 2k 同价，`qwen-image-3.0-pro` 的 2k 是 1k 的两倍价。
- 当前 catalog 使用华北 2（北京）端点与人民币价格；新加坡价格仅用于区域资料记录，不参与北京端点的本地估价。
- 输入图计费数量必须同时识别生成提交、画布和对话/工具面板的三套媒体字段，避免空的本地路径数组遮蔽实时图片数组而漏算输入费。
- 同步接口足够用，异步接口地址与同步不同，接错会 404。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 千问-图像生成与编辑 3.0 API 参考（参数、响应、异步、SDK） | https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference | 否 |
| 同页文档 ID 入口（用户清单给出的链接） | https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=3047054 | **是**（控制台）；同内容公开页见上一行 |
| 模型价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| 模型列表（各地域支持情况） | https://help.aliyun.com/zh/model-studio/models | 否 |
| API Key 获取 | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
