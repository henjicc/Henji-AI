# Nano Banana 2.1 — APIMart

采集日期：2026-10-12。BrowserOS neo 公开页面，只读；没有登录、读取凭据或发起生成。

## 请求与计价契约

Base URL `https://api.apimart.ai`；POST `/v1/images/generations`，Bearer 鉴权。官方 model `gemini-nano-banana-2.1`、Ext `gemini-nano-banana-2.1-ext`。`prompt` 必填 string；`size` 可选，默认 auto，支持 1:1/2:3/3:2/1:4/4:1/3:4/4:3/4:5/5:4/1:8/8:1/9:16/16:9/21:9；`resolution` 1K（默认）/2K/4K。Ext 的 1:4/4:1/1:8/8:1 仅 1K。`n` 官方整数 1–4（默认1），Ext 仅1；`image_urls` 可选 string[]，数量未声明，单张20MB，Ext总计50MB。`official_fallback` Ext可选 boolean，默认false，开启后转官方须按Token计费；本实现固定false，避免渠道切换与估价失配。`webhook` 未接入，使用正式共享轮询服务。

价格：https://apimart.ai/zh/model/nano-banana-2-1 。Ext 1K/2K/4K 为 $0.020/$0.025/$0.030 每张。官方按实际Token结算，模型卡金卡档输出图像参考 $0.02688/$0.04032/$0.09072；仅作输出估算，输入与思考另计，不能承诺按张固定价或把会员折扣推成全账号价格。每个输出都即时下载；营销页72小时与任务字段`expires_at`/接口24小时有差异，以实际有效期字段为准。

## 事件契约矩阵

| 事件/状态 | 传输形态 | 前置状态 | 字段路径与类型（必需性） | 缺省/空值语义 | 合法下一状态 | 应用输出 | 副作用与终态 | 连接生命周期 |
|---|---|---|---|---|---|---|---|---|
| 提交响应 | POST /v1/images/generations；GET /v1/tasks/{id} | 未提交 | task_id:string（提交必需）；status:string（查询必需）；result.images[].url:string[]（成功必需） | 缺标识且缺有效媒体明确报错；不自动重提 | pending/processing/completed | pending任务标识或有效同步结果 | 保存可恢复查询的标识；仅提交一次 | 单次HTTP结束 |
| pending | 状态查询JSON | 同一任务已提交/待处理 | task_id:string（提交必需）；status:string（查询必需）；result.images[].url:string[]（成功必需） | 成功结果必需；未完成可省略result，不能用缺结果判断失败 | pending/processing/completed/failed | pending，无媒体输出 | 继续同一任务查询，非终态 | 每次HTTP结束，间隔后重查 |
| processing | 状态查询JSON | 同一任务已提交/待处理 | task_id:string（提交必需）；status:string（查询必需）；result.images[].url:string[]（成功必需） | 成功结果必需；未完成可省略result，不能用缺结果判断失败 | pending/processing/completed/failed | pending，无媒体输出 | 继续同一任务查询，非终态 | 每次HTTP结束，间隔后重查 |
| completed | 状态查询JSON | 同一任务已提交/待处理 | task_id:string（提交必需）；status:string（查询必需）；result.images[].url:string[]（成功必需） | 成功结果必需；未完成可省略result，不能用缺结果判断失败；空成功终态是负例，不是合法成功 | 终态 | 全部结果URL，不裁剪 | 停止轮询，释放计时器/abort监听 | HTTP结束 |
| failed | 失败结果JSON/HTTP错误 | 同一任务已提交/待处理 | 错误字段文案可省略；失败状态/结果错误必须明确 | 可无媒体；错误文案缺省使用供应商失败说明 | 终态 | 统一错误，无媒体 | 停止轮询，释放计时器/abort监听 | HTTP结束 |

不变量：提交必须获得有效任务标识或同步有效结果。仅任务标识不能充当有效final；结果数量不擅自裁剪。重复待处理状态合法；乱序、终态后修改、先终态后另发结果的官方保证未说明。可凭原任务标识重新查询，不自动重提扣费请求。取消使用本地AbortSignal释放轮询与监听；除Fal官方队列取消接口外，供应商是否停止云端扣费未说明，本批不改远端取消实现。网络断开及查询超时使用已有统一错误/重试与恢复机制，不写第二套轮询或日志。

## Fixture 与验证

`tests/fixtures/nano-banana-2.1/`按页面JSON示例留存官方字面内容（URL/ID不可联网替换），字段表构造另标，负例独立标synthetic-negative。请求、枚举、数量边界、价格及四渠道全部结果/空终态/错误/取消由精确测试覆盖；断牙验证临时移除APIMart空结果拒绝不变量并确认失败后恢复。

## 选型与能力覆盖

复用现有供应商adapter、共享轮询和上传服务；无新网络库或自研协议。模型差异写catalog，中文/英文与渠道联动写presentation；现有通用模型发现与生成操作覆盖本批，属于已有能力的数据扩充，无需专用Agent工具。

## 原始链接索引

- [请求契约](https://docs.apimart.ai/cn/api-reference/images/gemini-nano-banana-2.1/generation.md)：无需登录。
- [轮询/队列契约](https://docs.apimart.ai/cn/api-reference/tasks/status)：无需登录。
- 本文内模型页/公告/价格链接：无需登录；真实生成与账单另需用户授权，未验。
