# Z-Image-Turbo

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 图片 |
| 建议拆分 | 一个模型；文生图为主；不要根据 APIMart 的 `prompt_extend` 另拆模型 |
| 项目默认隐藏 | `seed`、负面提示词；`output_format` 默认不显示且不请求 |
| 官方接口 | 阿里云百炼（已核查） |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| 阿里云百炼（官方） | 支持 | `z-image-turbo` | [原始控制台链接](https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=3002354)；[公开 API 正文](https://help.aliyun.com/zh/model-studio/z-image-api-reference?mode=pure) | `prompt_extend=false` 为 `0.1 元/张`；`true` 为 `0.2 元/张` | 原始控制台链接需登录；API 正文与价格页公开可见 |
| APIMart | 支持 | `z-image-turbo` | [Z-Image-Turbo API](https://docs.apimart.ai/en/api-reference/images/z-image-turbo/generation.md) | `$0.01/张`；开启提示词改写约 `$0.02/张` | 文档、价格页公开可见；生成需要 API Key |
| KIE | 支持 | `z-image` | [KIE Z-image API](https://docs.kie.ai/cn/market/z-image/z-image.md) | `$0.004/张` | 价格与 API 文档无需登录；实际调用需要 API Key |

## 官方接口（阿里云百炼）

- 北京同步端点：`POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`。
- Header：`Content-Type: application/json`、`Authorization: Bearer $DASHSCOPE_API_KEY`。
- Body：`model=z-image-turbo`；`input.messages` 仅能有一个 `text` 对象；`parameters.size` 为 `宽*高`，默认 `1024*1536`，总像素范围约 512²–2048²。
- `parameters.prompt_extend` 默认 false；true 会增加费用并返回改写文本/推理内容。官方接口是同步返回，结果为 `output.choices[0].message.content[].image`，URL 保留约 24 小时。
- 支持中英文提示词；官方文档说明提示词不超过 800 字符。`seed` 在官方文档中存在，但项目默认不显示、不传。

### 官方价格

来源：[阿里云百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing#6713612f55h4l)。该模型只按成功输出图像计费：关闭提示词改写 `0.1 元/张`，开启提示词改写 `0.2 元/张`；北京地域免费额度为 100 张，自开通百炼、模型发布或申请通过三者较晚之日起 90 天内有效。请求失败不计费。

## APIMart 适配

- Base URL `https://api.apimart.ai`；`POST /v1/images/generations`；轮询 `GET /v1/tasks/{task_id}`。
- `model=z-image-turbo`；`prompt` 最多 800 字符；初始状态 `submitted`，终态 `completed` / `failed`，结果读取 `data.result.images[].url[]`。

| 请求字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 必填，最多 800 字符 |
| `size` | 比例 | `1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`3:2`、`2:3` |
| `resolution` | `1K` / `2K` | 推荐启用智能比例后由本地转具体像素或由 provider 转换 |
| `prompt_extend` | boolean | 默认 false；true 会增加费用，不建议默认暴露 |
| `nsfw_check` | boolean | 默认 false；内部参数，不必显示 |
| `seed` | — | 绝对不显示、不请求 |

### 价格

APIMart 价格页显示默认 `$0.01/张`，`prompt_extend` 档约 `$0.02/张`。来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。

## KIE 适配

- Base URL `https://api.kie.ai`；`POST /api/v1/jobs/createTask`，请求模型为 `z-image`。
- KIE 字段：`input.prompt`（最多 1000 字符）、`input.aspect_ratio`（`1:1`、`4:3`、`3:4`、`16:9`、`9:16`）、可选 `nsfw_checker`。
- 创建返回 `data.taskId`；查询 `GET /api/v1/jobs/recordInfo?taskId=...`；`state=success` 后解析 `resultJson.resultUrls`。
- KIE 的模型名是 `z-image`，不是 `z-image-turbo`；provider 适配时必须按平台分别配置，不要跨平台复用 model ID。
- KIE 定价页中该模型显示为 `Qwen z-image`，价格 `$0.004/张`。来源：[KIE 定价](https://kie.ai/pricing)。

## 原始链接索引

- [阿里云百炼原始控制台链接](https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=3002354)
- [阿里云百炼公开 API 正文](https://help.aliyun.com/zh/model-studio/z-image-api-reference?mode=pure)：模型 ID、同步端点、字段、结果与限制。
- [阿里云百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing#6713612f55h4l)：提示词改写开关对应价格与免费额度。
- [APIMart API](https://docs.apimart.ai/en/api-reference/images/z-image-turbo/generation.md)
- [APIMart 定价](https://apimart.ai/zh/pricing)
- [KIE Z-image API](https://docs.kie.ai/cn/market/z-image/z-image.md)
- [KIE 任务详情](https://docs.kie.ai/cn/market/common/get-task-detail.md)
- [KIE 定价](https://kie.ai/pricing)：公开可见；搜索 `z-image`。
