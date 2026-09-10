# GPT Image 2.5 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-09-10 |
| 模态 | 图片；独立于 GPT Image 2 保留 |
| model ID | `gpt-image-2-5-{flare,sunburst}-{text-to-image,image-to-image}` |
| 文档与价格 | 公开，无需登录；已实际展开模型页四个型号 |
| 定价 | 两个版本、文生图/编辑均为 1K $0.03、2K $0.05、4K $0.08/张；不计充值赠送 |

## 请求契约

`https://api.kie.ai`，Bearer API Key；`POST /api/v1/jobs/createTask`，JSON `{model,input}`。
`input.prompt` 必填，1–20000 字符；编辑分支额外必填 `input.input_urls: string[]`，最多16张。
模型页限制参考图 JPEG/PNG/WebP/JPG，单文件30MB。媒体沿用 KIE 官方上传与 SDK 预处理。

| input 字段 | 类型 | 值与约束 |
|---|---|---|
| aspect_ratio | string | auto、1:1、3:2、2:3、4:3、3:4、16:9、9:16、21:9、27:16、16:27、9:8、8:9 |
| resolution | string | 1K、2K、4K；27:16、16:27、9:8、8:9 仅1K |
| background | string | transparent、opaque、auto |

版本显式选择 Flare/Sunburst；无图/有图自动选择文生图/编辑。应用默认 Flare、智能比例、1K、auto 背景。
智能比例在本地按首图匹配合法比例，无图1:1；高分辨率时排除仅1K的比例。
没有 quality、n、mask、output_format 字段，不从 OpenAI 或旧模型补入。
`callBackUrl` 可选，项目使用轮询而不发送回调。

## 事件与失败契约

提交成功 `{code:200,msg:"success",data:{taskId}}`；`GET /api/v1/jobs/recordInfo?taskId=...` 查询。

| 事件/状态 | 前置 | 字段与空值语义 | 下一状态/输出 | 终态与副作用/复用 |
|---|---|---|---|---|
| 提交 | 未提交 | data.taskId 必需非空 string | 保存taskId，pending | 开始轮询，HTTP独立请求 |
| waiting | 提交后 | data.state string；未完成不得依赖resultJson | pending | 继续轮询 |
| queuing | 提交后 | 同上 | pending | 继续轮询 |
| generating | 提交后 | 同上 | pending | 继续轮询 |
| success | pending | resultJson 为JSON字符串，图像结果在resultUrls数组；必须有有效URL | completed/images | 停止轮询 |
| fail | pending | failCode/failMsg 提供原因 | provider_task_failed | 停止轮询 |
| HTTP/API错误 | 任意请求 | 401/402/422/429等，以供应商错误为准 | 报错 | 不冒充成功 |

官方没有明确保证状态严格有序、连接复用、断线恢复或远端取消。SDK允许重复处理中状态；取消/超时停止本地轮询并释放计时器，不保证撤销计费。空成功结果拒绝。复用既有 KIE provider 与轮询测试。
查询文档的字面“成功”示例矛盾：`data.state=success` 却带 `code=505`。fixture 原样保留并验证不会返回成功；合成正例仅改为 `code=200`，明确不属于官方原样或真网日志。

官方字段表与字面示例保存在 `tests/fixtures/gpt-image-2.5/`，合成负例单独标记；本次不代表付费真网验收。

## 原始链接索引

均已公开访问，无需登录：
- [Flare 文生图](https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-text-to-image.md)
- [Flare 编辑](https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-image-to-image.md)
- [Sunburst 文生图](https://docs.kie.ai/market/gpt/gpt-image-2-5-sunburst-text-to-image.md)
- [Sunburst 编辑](https://docs.kie.ai/market/gpt/gpt-image-2-5-sunburst-image-to-image.md)
- [查询协议](https://docs.kie.ai/market/common/get-task-detail.md)
- [模型页及实时价格](https://kie.ai/gpt-image-2-5)
