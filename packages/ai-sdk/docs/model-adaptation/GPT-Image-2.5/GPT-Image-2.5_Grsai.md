# GPT Image 2.5 · Grsai

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-09-10 |
| 模型 | gpt-image-2.5 / gpt-image-2.5-flare / gpt-image-2.5-sunburst |
| 文档/价格 | 公开无需登录；模型页已核对充值档位 |
| 价格 | 600 / 2000 / 2400积分每次；基础充值档分别¥0.06 / ¥0.20 / ¥0.24 |

公告中的¥0.03 / ¥0.10 / ¥0.12基于¥999充值档每元20000积分；¥10档每元10000积分。SDK延续基础档无优惠上限口径，不能直接把公告优惠价作为所有用户价格。
2026-09-10公告将Flare/Sunburst从3000积分分别降到2000/2400。旧2标准/VIP为600/2000积分：2.5标准及Flare与旧对应渠道同价，Sunburst更贵。

## 请求

全球 `https://grsaiapi.com`，国内 `https://grsai.dakka.com.cn`；Bearer API Key。
JSON `POST /v1/api/generate`；共享provider固定`replyType=async`，查询`GET /v1/api/result?id=...`。

| 字段 | 类型 | 约束 |
|---|---|---|
| model | string，必填 | 上述三个ID |
| prompt | string，必填 | 提示词 |
| images | string[]，可选 | URL/base64；官方未给张数上限，应用保留16张本地上限，不宣称官方限制 |
| aspectRatio | string | 标准2.5仅1K，比例或1K像素；Flare/Sunburst必须像素，不能比例 |
| quality | string，可选 | 标准只auto；Flare low/medium/high；Sunburst另支持xhigh/max |
| background | string，可选 | 只有Flare/Sunburst支持transparent；关闭时省略 |
| replyType | string | json/stream/async；SDK采用async |

默认Flare、智能比例、1K、medium；版本显式选择标准/Flare/Sunburst。
标准隐藏分辨率、质量、背景；不把标准渠道映射为Flare，因为官方未确认底层型号。
无图/有图同接口自动生成/编辑。图片使用既有主进程媒体预处理，不提供URL文本框。
没有imageSize、n、output_format，不发送。参考尺寸完全采用当前Grsai字段表；1:3/3:1官方只给1K与4K，2K不展示、不静默降至1K。
Flare/Sunburst像素最大边3840、16倍数、长宽比≤3、面积655360–8294400。
文档quality总列表和逐模型说明不同，采用更具体的逐模型表；旧示例model=2却background=transparent，与字段说明冲突，原样保存但不作为2.5请求范本。

## 事件契约

| 状态 | 前置 | 字段/空值语义 | 下一状态/输出 | 终态/副作用/复用 |
|---|---|---|---|---|
| running | 提交后 | id/status必需string；results未就绪可缺失，progress可选 | pending | 独立HTTP轮询 |
| succeeded | pending | id/status必需；results[].url必须有有效值 | completed | 停止轮询 |
| failed | 任意 | id/status/error，error说明失败 | provider_task_failed | 停止轮询，返积分 |
| violation | 任意 | 同失败但独立状态 | provider_task_failed | 停止轮询，2.5返积分 |

重复running合法；官方未说明乱序、断线续接、远端取消/连接复用。SDK取消/超时停止本地计时与网络，不保证远端撤销。空终态拒绝。
官方字面响应与字段表保存至 `tests/fixtures/gpt-image-2.5/`；复用现有Grsai provider状态机测试，无付费真网证据。

## 原始链接索引

均公开无需登录：
- [生成接口：模型、质量、透明背景、完整像素表](https://qmy27nhsd9.apifox.cn/452409160e0.md)
- [轮询与错误响应](https://qmy27nhsd9.apifox.cn/452409577e0.md)
- [实时模型积分及充值档位](https://grsai.ai/zh/dashboard/models)
- [9月9日上新与9月10日降价公告](https://grsai.ai/zh/dashboard/announcements)
