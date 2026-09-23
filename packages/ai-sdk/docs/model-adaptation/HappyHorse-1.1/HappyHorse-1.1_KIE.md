# HappyHorse 1.1 · KIE

核对日期：2026-09-24；公开页面，无需登录；未执行付费生成。

官方接口：[文生视频](https://docs.kie.ai/38309290e0.md)、[图生视频](https://docs.kie.ai/38308980e0.md)、[参考图视频](https://docs.kie.ai/38309489e0.md)。价格来自 [官方模型页](https://kie.ai/happyhorse-1-1) 的三个模式页：均为 720p 22.5 credits/s（$0.1125/s）、1080p 29 credits/s（$0.145/s），不计充值赠送。

统一使用 `POST https://api.kie.ai/api/v1/jobs/createTask`，Bearer 认证；`model` 分别是 `happyhorse-1-1/text-to-video`、`image-to-video`、`reference-to-video`。共享任务查询 `GET /api/v1/jobs/recordInfo?taskId=...`，不用回调接收服务。

| 模式 | input 必填与约束 | 禁止混入的字段 |
|---|---|---|
| 文生 | prompt；resolution 720p/1080p，duration 整数 3–15 默认 5；aspect_ratio 默认 16:9 | image_urls、reference_image |
| 图生 | image_urls 数组，恰好 1 张；prompt 可省略；resolution、duration 同上 | aspect_ratio、reference_image |
| 参考 | reference_image 1–9 张，prompt；resolution、duration、aspect_ratio 同文生 | image_urls |

比例：16:9、9:16、1:1、4:3、3:4、4:5、5:4、9:21、21:9。参考图顺序对应提示词 `[Image 1]` 等编号。图生图像为 JPG/PNG/WEBP、≤20 MB、宽高均≥300、比例 0.4–2.5；参考图最短边≥400、≤20 MB。文件经官方 KIE 上传入口回填，界面不提供 URL 输入框。

文生 prompt 的 schema `maxLength=4999` 与说明 5000 有冲突，SDK 采用较严格 4999；图生/参考上限 5000，超限报错，不截断。中文长度建议≤2500；素材像素/内容最终由服务端校验。界面一个模型、标准/参考两个模式，标准按是否有图片选择文生或图生。

| 事件/响应 | 类型与可空性 | 行为 |
|---|---|---|
| 创建成功 | code:number=200，data.taskId:string | 返回 pending；缺 ID 且无产物拒绝 |
| 查询等待 | data.state:string=waiting/queuing/generating | 有界轮询，不重复创建 |
| 查询成功 | state=success，resultJson:string 内含 resultUrls:string[]；failCode/failMsg 可为 null | 返回产物；缺 URL 报错 |
| 查询失败 | state=fail，failCode/failMsg:string；resultJson 可空或省略 | 失败终止 |
| 查询错误、超时、取消 | 非 200 / 超预算 / AbortSignal | 沿共享 KIE/polling 收口，不误判成功、不付费重放 |

字面请求、创建响应及成功/失败回调示例保存在 `tests/fixtures/kie/happyhorse-1.1-*.json`；回调只作为结果字段样本，不代表 SDK 接收回调。正常请求、边界、价格与共享轮询负例由目录测试和既有 provider/polling 测试验证。
