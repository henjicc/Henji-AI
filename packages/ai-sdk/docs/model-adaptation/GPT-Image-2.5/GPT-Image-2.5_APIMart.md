# GPT Image 2.5 · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-09-10 |
| 模态 | 图片；不替换 GPT Image 2 |
| 官方渠道 | `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` |
| Ext渠道 | `model=gpt-image-2.5-ext`，`version=flare/sunburst` |
| 文档/价格 | 公开，无需登录；模型页与Ext Tab均已实际展开 |

## 请求与价格

Base URL `https://api.apimart.ai`；Bearer API Key；JSON `POST /v1/images/generations`。
共享 provider 已发送 `Idempotency-Key` 和 `X-APIMart-Response-Version: 2026-07-27`，无需为模型另建协议。
`prompt` 必填非空；`image_urls: string[]` 最多16张，有图即编辑；`n` 为整数1–4，默认1。
官方渠道只接受公开HTTP(S)参考图，使用官方 `POST /v1/uploads/images` 上传；Ext还接受data URL。

| 参数 | 官方渠道 | Ext渠道 |
|---|---|---|
| 版本 | 编码进model | version=flare/sunburst，默认flare |
| size | auto、1:1、3:2、2:3、4:3、3:4、5:4、4:5、16:9、9:16、2:1、1:2、21:9、9:21、3:1、1:3或像素 | auto、1:1、16:9、9:16、4:3、3:4、3:2、2:3、5:4、4:5、21:9 |
| resolution | 1k/2k/4k，默认1k；像素size时忽略 | 1K/2K/4K，默认1K |
| quality | auto/low/medium/high/xhigh/max，API默认auto | 未定义，不发送 |
| background | auto/opaque/transparent | 未定义，不发送 |
| moderation | auto/low，服务默认low | 未定义，不发送 |
| output_format | png/jpeg/webp，默认png | 未定义 |
| output_compression | 0–100，仅jpeg/webp | 未定义 |

产品一个入口，渠道先于版本；默认Ext、Flare、智能比例、1K、1张；官方质量使用medium（与平台playground初始值一致）。
智能比例本地计算，无图1:1。output_format/output_compression/moderation/seed不展示、不发送；默认PNG允许透明背景。
新版官方文档未定义mask，不沿用2的mask字段。Ext不能显示质量和背景。

Ext实时基础价两个版本相同：1K $0.0085、2K $0.014、4K $0.021/张，参考图不额外收费。
官方渠道实际公开价每百万token：文本输入$4、缓存$1、图片输入$6.4、缓存$1.6、图片输出$24。
API正文$5/$1.25/$8/$2/$30是OpenAI原价；按实时价格页20%折扣采用上述平台价，不与充值优惠混淆。
官方页面提供不同尺寸的输出token参考表；估算按size/resolution/quality/n计算输出部分，不含提示词及参考图输入；auto保守按max。
1024方图low/medium/high/xhigh/max分别196/439/1756/3122/7024输出token。
两版token单价一致不保证旧版与新版每张费用一致；官方文档说明2.5 medium/high输出token约为2同名档四分之一。

## 任务状态契约

`GET /v1/tasks/{task_id}`，同用户API Key。返回URL位于`data.result.images[].url[]`。

| 事件 | 前置 | 字段与空值语义 | 下一状态/输出 | 终态/副作用/复用 |
|---|---|---|---|---|
| HTTP202提交 | 未提交 | data.id非空string，object=generation.task，status=pending；poll_url可用 | 保存ID，pending | 独立HTTP请求 |
| HTTP200兼容提交 | 未提交 | data数组，data[0].task_id非空string、status=submitted | 保存ID，pending | 兼容旧格式 |
| pending/submitted | 提交后 | status非空；结果可未就绪 | pending | 继续轮询 |
| processing | pending | progress数值，不能代替终态 | pending | 继续轮询 |
| completed | pending | result.images须有有效URL；usage/cost可提供实际计费 | completed | 停止轮询并保存结果 |
| failed | pending | error.message说明原因 | 报错 | 停止轮询，平台退还预留资金 |
| canceled/cancelled | pending | 查询协议取消终态 | 报错 | 停止轮询 |
| HTTP400/401/402/429 | 任意请求 | error对象 | 报错 | 不盲重放生成 |

允许重复pending；官方未保证严格状态顺序及断线恢复。SDK取消/超时结束本地等待，不保证远端撤销；空成功拒绝；复用既有provider释放规则。
官方示例/字段表见 `tests/fixtures/gpt-image-2.5/`；未进行付费请求。

## 原始链接索引

以下无需登录，已实测正文：
- [官方渠道完整参数、尺寸及输出token表](https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation.md)
- [Ext完整参数与版本响应](https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5-ext/generation.md)
- [任务查询](https://docs.apimart.ai/en/api-reference/tasks/status.md)
- [模型页及两个渠道的实时价格](https://apimart.ai/zh/model/gpt-image-2-5)
- [实时定价](https://apimart.ai/zh/pricing)
- [OpenAI费用边界](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)
