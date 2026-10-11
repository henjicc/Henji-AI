# Nano Banana 2.1 — KIE

采集日期：2026-10-12。BrowserOS neo 公开页面，只读；没有登录、读取凭据或发起生成。

## 请求与计价契约

Base URL `https://api.kie.ai`；POST `/api/v1/jobs/createTask`，Bearer鉴权；model `nano-banana-2-1`，`input` object。`prompt` 必填string，最多20000字符，超长明确报错，不截断。`image_input` 可选string[]，最多10张，jpeg/png/webp，单张30MB。`aspect_ratio` 默认auto，14种比例同APIMart；`resolution` 默认1K，1K/2K/4K；`output_format` 默认jpg，jpg/png。没有n、搜索、思考、遮罩字段，营销介绍的mask能力不能凭介绍新增请求字段。`callBackUrl` 可选但宿主不使用，复用轮询。

价格：https://kie.ai/nano-banana-2-1 ：1K/2K/4K 分别4/6/9 credits，即 $0.020/$0.030/$0.045 每张。GET `/api/v1/jobs/recordInfo?taskId=...`，HTTP200仍须检查code；成功`data.resultJson`为JSON字符串，媒体位于`resultUrls`数组。结果保留14天，宿主即时下载。

## 事件契约矩阵

| 事件/状态 | 传输形态 | 前置状态 | 字段路径与类型（必需性） | 缺省/空值语义 | 合法下一状态 | 应用输出 | 副作用与终态 | 连接生命周期 |
|---|---|---|---|---|---|---|---|---|
| 提交响应 | POST /api/v1/jobs/createTask；GET /api/v1/jobs/recordInfo?taskId=... | 未提交 | data.taskId:string（提交必需）；data.state:string（查询必需）；data.resultJson:string（成功必需，内含resultUrls:string[]） | 缺标识且缺有效媒体明确报错；不自动重提 | waiting/queuing/generating/success | pending任务标识或有效同步结果 | 保存可恢复查询的标识；仅提交一次 | 单次HTTP结束 |
| waiting | 状态查询JSON | 同一任务已提交/待处理 | data.taskId:string（提交必需）；data.state:string（查询必需）；data.resultJson:string（成功必需，内含resultUrls:string[]） | 失败时resultJson可为null或空串；成功时必须解析出非空结果 | waiting/queuing/generating/success/fail | pending，无媒体输出 | 继续同一任务查询，非终态 | 每次HTTP结束，间隔后重查 |
| queuing | 状态查询JSON | 同一任务已提交/待处理 | data.taskId:string（提交必需）；data.state:string（查询必需）；data.resultJson:string（成功必需，内含resultUrls:string[]） | 失败时resultJson可为null或空串；成功时必须解析出非空结果 | waiting/queuing/generating/success/fail | pending，无媒体输出 | 继续同一任务查询，非终态 | 每次HTTP结束，间隔后重查 |
| generating | 状态查询JSON | 同一任务已提交/待处理 | data.taskId:string（提交必需）；data.state:string（查询必需）；data.resultJson:string（成功必需，内含resultUrls:string[]） | 失败时resultJson可为null或空串；成功时必须解析出非空结果 | waiting/queuing/generating/success/fail | pending，无媒体输出 | 继续同一任务查询，非终态 | 每次HTTP结束，间隔后重查 |
| success | 状态查询JSON | 同一任务已提交/待处理 | data.taskId:string（提交必需）；data.state:string（查询必需）；data.resultJson:string（成功必需，内含resultUrls:string[]） | 失败时resultJson可为null或空串；成功时必须解析出非空结果；空成功终态是负例，不是合法成功 | 终态 | 全部结果URL，不裁剪 | 停止轮询，释放计时器/abort监听 | HTTP结束 |
| fail | 失败结果JSON/HTTP错误 | 同一任务已提交/待处理 | 错误字段文案可省略；失败状态/结果错误必须明确 | 可无媒体；错误文案缺省使用供应商失败说明 | 终态 | 统一错误，无媒体 | 停止轮询，释放计时器/abort监听 | HTTP结束 |

不变量：提交必须获得有效任务标识或同步有效结果。仅任务标识不能充当有效final；结果数量不擅自裁剪。重复待处理状态合法；乱序、终态后修改、先终态后另发结果的官方保证未说明。可凭原任务标识重新查询，不自动重提扣费请求。取消使用本地AbortSignal释放轮询与监听；除Fal官方队列取消接口外，供应商是否停止云端扣费未说明，本批不改远端取消实现。网络断开及查询超时使用已有统一错误/重试与恢复机制，不写第二套轮询或日志。

## Fixture 与验证

`tests/fixtures/nano-banana-2.1/`按页面JSON示例留存官方字面内容（URL/ID不可联网替换），字段表构造另标，负例独立标synthetic-negative。请求、枚举、数量边界、价格及四渠道全部结果/空终态/错误/取消由精确测试覆盖；断牙验证临时移除APIMart空结果拒绝不变量并确认失败后恢复。

## 选型与能力覆盖

复用现有供应商adapter、共享轮询和上传服务；无新网络库或自研协议。模型差异写catalog，中文/英文与渠道联动写presentation；现有通用模型发现与生成操作覆盖本批，属于已有能力的数据扩充，无需专用Agent工具。

## 原始链接索引

- [请求契约](https://docs.kie.ai/market/google/nanobanana-2-1.md)：无需登录。
- [轮询/队列契约](https://docs.kie.ai/market/common/get-task-detail.md)：无需登录。
- 本文内模型页/公告/价格链接：无需登录；真实生成与账单另需用户授权，未验。
