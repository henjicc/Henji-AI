# Z-Image Turbo · 百炼（阿里云百炼，官方）

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | 阿里云百炼（Model Studio / DashScope），模型原厂官方接口 |
| 平台模型 ID | `z-image-turbo` |
| 接口形态 | **HTTP 同步调用** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

模型定位：轻量级**文生图**模型，快速出图，支持中英文字渲染，灵活适配多种分辨率与宽高比。

| 模型 | 简介 | 输出图像规格 |
|---|---|---|
| `z-image-turbo` | 轻量模型，快速生图 | 分辨率：总像素 `[512*512, 2048*2048]`；格式 **PNG**；**张数固定 1 张** |

## 1. 接入协议

`POST https://{WorkspaceId}.<region>.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`

| 地域 | `<region>` |
|---|---|
| 华北 2（北京） | `cn-beijing` |
| 新加坡 | `ap-southeast-1` |

旧域名 `https://dashscope.aliyuncs.com` / `https://dashscope-intl.aliyuncs.com` 仍可用。`{WorkspaceId}` 在百炼控制台业务空间详情页查看。

请求头：`Content-Type: application/json`、`Authorization: Bearer sk-xxxx`。

**结果时效**：图像 URL **仅保留 24 小时**，超时自动清除。

## 2. 能力清单

仅**文生图**一种能力。`content` 数组**必须且只能包含 1 个 `text` 对象**，不传或传多个会报错。**当前仅支持单轮对话**（`messages` 只能一组 role/content）。

Z-Image 在百炼官方**没有图生图 / 图像编辑端点**。

## 3. 请求参数

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必选 | — | 必须为 `z-image-turbo` |
| `input.messages[0].role` | string | 必选 | — | 固定 `user` |
| `input.messages[0].content[0].text` | string | 必选 | — | 正向提示词。支持中英文，**长度不超过 800 个字符**（每个汉字、字母、数字或符号计 1 个字符），超出自动截断 |
| `parameters.size` | string | 可选 | `1024*1536` | 格式 `宽*高`。总像素须在 `[512*512, 2048*2048]`；**推荐总像素在 `[1024*1024, 1536*1536]` 之间效果更佳** |
| `parameters.prompt_extend` | bool | 可选 | `false` | 智能提示词改写。**直接影响费用：`true` 的价格是 `false` 的 2 倍**。开启后额外返回改写后的提示词与思考过程，并增加响应时间 |
| `parameters.seed` | integer | 可选 | 随机 | `[0, 2147483647]`。**本项目规则：绝对不显示**，不下发 |

### 官方推荐分辨率（按总像素档）

**总像素 1024×1024 档**：1:1 `1024*1024`；2:3 `832*1248`；3:2 `1248*832`；3:4 `864*1152`；4:3 `1152*864`；7:9 `896*1152`；9:7 `1152*896`；9:16 `720*1280`；9:21 `576*1344`；16:9 `1280*720`；21:9 `1344*576`

**总像素 1280×1280 档**：1:1 `1280*1280`；2:3 `1024*1536`；3:2 `1536*1024`；3:4 `1104*1472`；4:3 `1472*1104`；7:9 `1120*1440`；9:7 `1440*1120`；9:16 `864*1536`；9:21 `720*1680`；16:9 `1536*864`；21:9 `1680*720`

**总像素 1536×1536 档**：1:1 `1536*1536`；2:3 `1248*1872`；3:2 `1872*1248`；3:4 `1296*1728`；4:3 `1728*1296`；7:9 `1344*1728`；9:7 `1728*1344`；9:16 `1152*2048`；9:21 `864*2016`；16:9 `2048*1152`；21:9 `2016*864`

> 官方给出 **11 种比例**（含 7:9、9:7、9:21），比任何聚合平台都多。

## 4. 响应结构

```json
{
  "output": { "choices": [ { "finish_reason": "stop", "message": {
    "content": [ { "image": "https://dashscope-result-bj...png?Expires=..." },
                 { "text": "（prompt_extend=false 时为原提示词；true 时为改写后提示词）" } ],
    "reasoning_content": "", "role": "assistant" } } ] },
  "usage": { "height": 1440, "image_count": 1, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "width": 1120 },
  "request_id": "..."
}
```

| 字段 | 说明 |
|---|---|
| `output.choices[].message.content[].image` | 生成图像 URL，**PNG**，24 小时有效 |
| `output.choices[].message.content[].text` | `prompt_extend=false` 时为输入提示词；`true` 时为改写后提示词 |
| `output.choices[].message.reasoning_content` | 思考过程，**仅 `prompt_extend=true` 时返回** |
| `usage.width` / `usage.height` | 输出图宽高 |
| `usage.image_count` | 固定为 1 |
| `usage.input_tokens` / `output_tokens` / `total_tokens` | `prompt_extend=false` 时固定为 0 |
| `usage.output_tokens_details.reasoning_tokens` | 仅 `prompt_extend=true` 时返回 |

**失败**：返回 `request_id`、`code`、`message`，例如 `{"code":"InvalidParameter","message":"num_images_per_prompt must be 1"}`。内容审核不通过会报 `IPInfringementSuspect` 或 `DataInspectionFailed`。

## 5. 价格（官方，人民币）

来源：[百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)（2026-08-22 读取）。

**华北 2（北京）**

| 模型 | 单价 | 免费额度 |
|---|---|---|
| `z-image-turbo` | `prompt_extend=false`：**0.1 元/张**<br>`prompt_extend=true`：**0.2 元/张** | 100 张 |

**新加坡（国际）**

| 模型 | 单价 |
|---|---|
| `z-image-turbo` | `false`：0.110089 元/张；`true`：0.220177 元/张 |

按**成功生成的图像张数**计费；调用失败或处理错误不产生费用，也不消耗免费额度。免费额度有效期为开通百炼 / 模型发布 / 申请通过之日起 90 天内（以较晚者为准）。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。官方有 `seed`（不下发），无负面提示词字段。
- `prompt_extend` **直接翻倍计费**，若要暴露给用户必须在 UI 上说明，或固定为 `false`。
- `size` 分隔符是 `*` 不是 `x`。
- 固定出 1 张，UI 不要出现数量选择。
- 输出固定 PNG，无 `output_format`。
- 提示词硬上限 800 字符且**超出静默截断**，前端应做长度提示。
- 官方仅文生图，本模型如果要在项目里支持图生图，只能走 Fal 的 `image-to-image` 端点。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Z-Image API 参考（参数、响应、限制、计费） | https://help.aliyun.com/zh/model-studio/z-image-api-reference | 否 |
| 用户清单给出的控制台入口（同内容） | https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=3002354 | **是**（控制台）；公开页见上一行 |
| 模型价格 | https://help.aliyun.com/zh/model-studio/model-pricing | 否 |
| 各地域支持的模型列表 | https://help.aliyun.com/zh/model-studio/models | 否 |
| API Key 获取 | https://bailian.console.aliyun.com/?apiKey=1#/api-key | **是** |
