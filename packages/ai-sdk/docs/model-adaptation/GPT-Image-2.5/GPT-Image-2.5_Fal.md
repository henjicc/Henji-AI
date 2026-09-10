# GPT Image 2.5 · Fal

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-09-10 |
| 模型路由 | `openai/gpt-image-2.5/{flare,sunburst}/{text-to-image,edit}` |
| 文档/价格 | 公开，无需登录；四份端点实时llms.txt已核对 |

## 请求与计费

`POST https://queue.fal.run/<路由>`，`Authorization: Key <key>`，JSON。
Flare/Sunburst显式选择，无图文生图、有图edit；默认Flare、智能比例、1K、high、1张、auto背景。

| 字段 | 类型 | 约束 |
|---|---|---|
| prompt | string，必填 | 生成/编辑说明 |
| image_urls | string[]，编辑必填 | 最多16张；文生图不发送 |
| mask_url | string，编辑可选 | 遮罩；复用应用内绘制/编辑和官方上传 |
| image_size | object或枚举 | {width,height}，16倍数、边≤3840、比例≤3、面积655360–8294400；文生图API默认landscape_4_3，编辑auto |
| quality | string | auto/low/medium/high/xhigh/max；API默认high |
| background | string | auto/transparent/opaque；默认auto |
| num_images | integer | 1–10，默认1（旧2为1–4） |
| output_format | string | jpeg/png/webp，默认png；产品不展示、不请求 |
| output_compression | integer | 0–100；仅jpeg/webp，产品不请求 |
| sync_mode | boolean | 默认false；产品采用队列、不请求 |

尺寸选项用合法像素明确提交；不把smart/auto直传。遮罩基于第一张参考图，通过共享派生媒体契约创建、继续编辑和源图变化失效。
token基础价与2相同：文本输入$5/M、缓存$1.25/M；图片输入$8/M、缓存$2/M、输出$30/M。Fal端点页另写文本输出$10/M，但图像模型无文本输出。
Fal公开实测1024方图low/medium/high约$0.0060/$0.0133/$0.0528（编辑单参考图约$0.0142/$0.0215/$0.0610）；不是固定每张价格。
计价仅给输出参考估算，采用APIMart公开同型号尺寸/token参考表乘Fal输出单价，明确跨来源参考而非Fal报价；输入token另计，auto按max。不沿用2旧high=$0.211。

## 队列契约

| 事件/状态 | 前置 | 字段与空值 | 下一状态/输出 | 终态/副作用/复用 |
|---|---|---|---|---|
| 提交 | 未提交 | request_id非空，status_url/response_url/cancel_url由服务返回 | 保存ID和同源URL，pending | 独立HTTP |
| IN_QUEUE | 提交后 | status必需；queue_position可选 | pending | 继续轮询 |
| IN_PROGRESS | pending | status必需；logs可为空 | pending | 继续轮询 |
| COMPLETED | pending | 状态完成仍需读取response_url | 读取images | 不把状态响应当图片 |
| 结果 | COMPLETED后 | images数组，ImageFile.url必须有效 | completed/images | 停止轮询 |
| 请求/任务错误 | 任意 | HTTP错误或错误响应 | 报错 | 停止等待 |

重复处理中事件允许；官方未保证严格顺序。取消API为PUT cancel_url；本次沿用SDK现有本地取消，不新增远端取消动作。取消/超时释放本地等待，不承诺退费。空结果拒绝；复用既有Fal同源URL校验、轮询与取消测试。
官方字面示例与字段表位于 `tests/fixtures/gpt-image-2.5/`；无付费真网证据。

## 原始链接索引

均公开无需登录：
- [Flare文生图](https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image/llms.txt)
- [Flare编辑](https://fal.ai/models/openai/gpt-image-2.5/flare/edit/llms.txt)
- [Sunburst文生图](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/llms.txt)
- [Sunburst编辑](https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit/llms.txt)
- [Fal实测价格表](https://fal.ai/gpt-image-2.5)
- [队列协议](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [同型号尺寸与输出token参考表](https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation.md)
