# Nano Banana 2.1 — Fal

采集日期：2026-10-12。BrowserOS neo 公开页面，只读；没有登录、读取凭据或发起生成。

## 请求与计价契约

Base URL `https://queue.fal.run`，POST `/google/nano-banana-2.1`（生成）或 `/google/nano-banana-2.1/edit`（编辑），`Authorization: Key ...`。编辑官方schema：https://fal.ai/models/google/nano-banana-2.1/edit/llms.txt 。`prompt`必填string；`num_images`整数1–4、默认1；`aspect_ratio`默认auto，14种比例同APIMart；`resolution`默认1K，1K/2K/4K；`output_format`png（默认）/jpeg/webp；`safety_tolerance`字符串1–6、默认4（本实现省略使用默认）；`sync_mode`默认false（省略，使用queue）；`system_prompt`可选string默认空；`limit_generations`默认true；`enable_web_search`默认false；`thinking_level`minimal/medium（默认）/high，不能发送off。

编辑额外接受`image_urls` string[]，官方未给数量上限；有`video_url`或`pdf_url`时可以不传图。视频单份15MB、PDF单份15MB；PDF走file-upload与官方供应商上传，不提供URL输入框。没有audio_url。无素材走生成；图片、视频或PDF任一种即编辑。

价格与官方折算：https://fal.ai/models/google/nano-banana-2.1 。每百万输入文本/图片Token $1.764，文字/思考输出$8.823，图像输出$35.294；图像输出约1120/1680/3780Token。官方代表性成本（100Token短提示词、medium思考）1K/2K/4K约$0.040/$0.059/$0.134；两张1K参考图增加约$0.004。calculator用该官方代表值及每参考图约$0.002，不作为固定单张账单。搜索、思考没有固定附加费，只改变实际Token。视频/PDF、长提示词、搜索与high思考可能超出代表估价，实际usage为准。

## 事件契约矩阵

| 事件/状态 | 传输形态 | 前置状态 | 字段路径与类型（必需性） | 缺省/空值语义 | 合法下一状态 | 应用输出 | 副作用与终态 | 连接生命周期 |
|---|---|---|---|---|---|---|---|---|
| 提交响应 | POST queue端点；GET status_url；完成后GET response_url | 未提交 | request_id或status_url:string（提交至少其一）；status:string（查询必需）；images[].url:string（成功结果必需） | 缺标识且缺有效媒体明确报错；不自动重提 | IN_QUEUE/IN_PROGRESS/COMPLETED | pending任务标识或有效同步结果 | 保存可恢复查询的标识；仅提交一次 | 单次HTTP结束 |
| IN_QUEUE | 状态查询JSON | 同一任务已提交/待处理 | request_id或status_url:string（提交至少其一）；status:string（查询必需）；images[].url:string（成功结果必需） | 状态完成不等于有效图像；需要额外结果请求。FAILED/ERROR只属共享parser防御分支，官方队列文档未列为状态 | IN_QUEUE/IN_PROGRESS/COMPLETED/COMPLETED后结果错误/HTTP错误 | pending，无媒体输出 | 继续同一任务查询，非终态 | 每次HTTP结束，间隔后重查 |
| IN_PROGRESS | 状态查询JSON | 同一任务已提交/待处理 | request_id或status_url:string（提交至少其一）；status:string（查询必需）；images[].url:string（成功结果必需） | 状态完成不等于有效图像；需要额外结果请求。FAILED/ERROR只属共享parser防御分支，官方队列文档未列为状态 | IN_QUEUE/IN_PROGRESS/COMPLETED/COMPLETED后结果错误/HTTP错误 | pending，无媒体输出 | 继续同一任务查询，非终态 | 每次HTTP结束，间隔后重查 |
| COMPLETED | 状态查询JSON与额外结果JSON | 同一任务已提交/待处理 | request_id或status_url:string（提交至少其一）；status:string（查询必需）；images[].url:string（成功结果必需） | 状态完成不等于有效图像；需要额外结果请求。FAILED/ERROR只属共享parser防御分支，官方队列文档未列为状态；空成功终态是负例，不是合法成功 | 终态 | 全部结果URL，不裁剪 | 停止轮询，释放计时器/abort监听 | HTTP结束 |
| COMPLETED后结果错误/HTTP错误 | 失败结果JSON/HTTP错误 | 同一任务已提交/待处理 | 错误字段文案可省略；失败状态/结果错误必须明确 | 可无媒体；错误文案缺省使用供应商失败说明 | 终态 | 统一错误，无媒体 | 停止轮询，释放计时器/abort监听 | HTTP结束 |

不变量：提交必须获得有效任务标识或同步有效结果。仅任务标识不能充当有效final；结果数量不擅自裁剪。重复待处理状态合法；乱序、终态后修改、先终态后另发结果的官方保证未说明。Fal COMPLETED需另取结果，不把状态请求自身当图像。可凭原任务标识重新查询，不自动重提扣费请求。取消使用本地AbortSignal释放轮询与监听；除Fal官方队列取消接口外，供应商是否停止云端扣费未说明，本批不改远端取消实现。网络断开及查询超时使用已有统一错误/重试与恢复机制，不写第二套轮询或日志。

## Fixture 与验证

`tests/fixtures/nano-banana-2.1/`按页面JSON示例留存官方字面内容（URL/ID不可联网替换），字段表构造另标，负例独立标synthetic-negative。请求、枚举、数量边界、价格及四渠道全部结果/空终态/错误/取消由精确测试覆盖；断牙验证临时移除APIMart空结果拒绝不变量并确认失败后恢复。

## 选型与能力覆盖

复用现有供应商adapter、共享轮询和上传服务；无新网络库或自研协议。模型差异写catalog，中文/英文与渠道联动写presentation；现有通用模型发现与生成操作覆盖本批，属于已有能力的数据扩充，无需专用Agent工具。

## 原始链接索引

- [请求契约](https://fal.ai/models/google/nano-banana-2.1/llms.txt)：无需登录。
- [轮询/队列契约](https://fal.ai/docs/documentation/model-apis/inference/queue)：无需登录。
- 本文内模型页/公告/价格链接：无需登录；真实生成与账单另需用户授权，未验。
