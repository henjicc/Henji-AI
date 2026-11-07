# GPT Image 2.6 · Grsai

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-07 |
| 项目模型 | `grsai-gpt-image-2.6`，通用标识 `gpt-image-2.6` |
| 平台 model | `gpt-image-2.6`（标准渠道） |
| 文档与价格 | 公开，无需登录 |
| 定价 | 每次 600 积分；基础充值档约 ¥0.06，高额充值档低至 ¥0.03（模型列表页按“积分/20000”给出参考价 ¥0.03） |

## 请求契约

沿用 [Grsai 供应商文档](../供应商/Grsai.md) 的 `POST /v1/api/generate` 与 `GET /v1/api/result` 异步轮询，provider 在发送边界统一补 `replyType: "async"`。

| 字段 | 值与约束 | 项目处理 |
|---|---|---|
| model | `gpt-image-2.6` | 固定 |
| prompt | 必填 | 统一提示词 |
| images | base64 或 URL，官方未写数量上限 | 本地图内联 base64 |
| aspectRatio | 比例格式或 1K 像素值；比例表与 gpt-image-2 相同：1:1、16:9、9:16、4:3、3:4、3:2、2:3、5:4、4:5、21:9、9:21、1:2、2:1 | 智能比例本地转具体值 |
| quality | 标准渠道只支持 auto | 不显示、不请求 |

模型列表页写“可生成 GIF 图，支持 1K”，但接口文档未给出 GIF 请求字段，按产品约定不开放输出格式。

文档的模型枚举还列出 `gpt-image-2.6-flare`、`gpt-image-2.6-sunburst`，但 2026-11-07 模型列表页没有这两个渠道的价格，未接入。

## 原始链接索引

均公开，无需登录：
- [GPT Image 系列接口](https://qmy27nhsd9.apifox.cn/452409160e0.md)
- [模型列表与价格](https://grsai.com/zh/dashboard/models)
- [充值档位](https://grsai.com/zh/dashboard/billing)
