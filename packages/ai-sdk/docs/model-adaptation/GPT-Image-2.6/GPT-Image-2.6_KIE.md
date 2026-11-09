# GPT Image 2.6 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-09 |
| 模态 | 图片；独立于 GPT Image 2.5 保留（参数集与计费方式不同） |
| 项目模型 | `kie-gpt-image-2.6`，通用标识 `gpt-image-2.6` |
| model ID | `gpt-image-2-6/{flare,sunburst,economy}-{text-to-image,image-to-image}` |
| 文档与价格 | 公开，无需登录 |
| 定价 | Flare/Sunburst 按 Token：文本输入 $4.5、缓存文本 $1.125、图片输入 $7.2、缓存图片 $1.8、图片输出 $27 每百万 Token；Economy 文生图/编辑 1K $0.025/张 |

## 请求契约

`https://api.kie.ai`，Bearer API Key；`POST /api/v1/jobs/createTask`，JSON `{model,input}`，`callBackUrl` 可选（项目轮询，不发送）。版本由用户显式选择，有无参考图自动选择文生图/编辑端点。

| input 字段 | Flare / Sunburst | Economy | 项目处理 |
|---|---|---|---|
| prompt | 必填，1–32000 字符 | 必填，1–20000 字符 | 统一提示词 |
| input_urls | 编辑必填，≤16 张，jpeg/png/webp | 编辑可选，≤16 张，单张 ≤30MB | 上传素材 |
| aspect_ratio | auto、1:1、3:2、2:3、4:3、3:4、5:4、4:5、16:9、9:16、2:1、1:2、21:9、9:21、3:1、1:3 | auto、1:1、16:9、9:16、3:2、2:3、21:9、4:3 | 智能比例本地按首图转具体值，无图 1:1；切到 Economy 时裁剪菜单并复位 |
| resolution | 1K/2K/4K，默认 1K | 无 | Economy 不发送 |
| quality | low/medium/high/xhigh/max/auto，默认 medium | 无 | 同上 |
| complexity | low/medium/high，默认 high，不单独收费 | 无 | 同上 |
| background | transparent/opaque/auto | 同左 | 展示 |
| mask_url | 编辑可选，与 markup 互斥 | 无 | 复用共享遮罩编辑器，`runtimeConstraints.mediaFields` 声明 `mask_url` |
| markup | 编辑可选透明 PNG 标注 | 无 | 不显示、不请求 |
| output_format | 文生图 png/jpeg/webp/gif/svg；编辑端点只有 png/jpeg/webp | 文生图 png/gif；编辑只有 png | 选动图 / 矢量图时发送 `gif` / `svg`；动图与矢量图都只能文生图 |
| size / frame_count / frame_duration_ms | GIF 专用：`size` 为单帧 `WxH`（省略或 auto 为 512×512），帧数 2–16（默认 9），每帧 20–2000 ms、10 的倍数（默认 200）；GIF 不用 aspect_ratio、resolution | frame_count 为字符串枚举 auto/4/9/16/25/36/64，无 size | Flare/Sunburst 按比例换算单帧后发送；Economy 不开放帧数与时长（交给 auto） |
| svg | `{ model }`，枚举 gpt-6-sol / gpt-5.6-luna / gpt-5.6-terra，省略时后端填 gpt-5.6-luna；与 GIF 字段互斥 | 无 | 选矢量图时发送 |
| output_compression | 0–100 | 无 | 不显示、不请求 |
| moderation | auto/low，默认 low | 无 | 不显示、不请求 |

Flare 与 Sunburst 同价同参；Sunburst 侧重细节与多轮编辑一致性。静态图像素映射与 2.5 相同（例如 16:9 1K 1536×864、4K 3840×2160）。

## 动图与矢量图（2026-11-09 按用户要求开放）

- 「输出类型」图片 / 动图 / 矢量图，默认图片；有参考图时只能选图片，Economy 没有矢量图。
- 动图拼图规则与 APIMart 相同（拼图每边 ≤ 3840、总像素 ≤ 8,294,400、宽高比 ≤ 3:1）：单帧按比例以 512×512 面积换算；按取整后的实际尺寸判断，拼图宽高比超限提交前报错（KIE 动图只能文生图，智能比例取 1:1）。文档对动图能否透明前后矛盾，动图与矢量图都不发送背景。
- 矢量图计费 = 出图 Token + 所选写作模型的文本 Token；估价只含出图部分。动图按整张拼图折算输出 Token 估价。

## 计价说明

Flare/Sunburst 官方只给 Token 单价，没有每张价格。项目按 2.5 同尺寸输出 Token 参考表（`shared/gptImage25Pricing.ts`，像素映射与 2.6 官方表一致）× $27/M 估算输出费，提示词与参考图输入另计；自动质量按 max 预估，标记为估算价。Economy 为固定每张价。

## 事件与失败契约

沿用 [KIE 供应商文档](../供应商/KIE.md) 第 2 节 Market 统一任务契约：提交返回 `data.taskId`，`GET /api/v1/jobs/recordInfo` 查询 `waiting/queuing/generating/success/fail`，成功结果在 `resultJson.resultUrls`。本模型未引入新的轮询或解析分支。官方请求 schema 保存在 `tests/fixtures/model-requests-2026-11/kie-gpt-image-2.6-*.json`，由 `tests/catalog/kie-grsai-2026-11.test.ts` 校验；未做付费真网验收。

## 原始链接索引

均公开，无需登录：
- [Flare 文生图](https://docs.kie.ai/market/gpt/gpt-image-2-6-flare-text-to-image.md)
- [Flare 编辑](https://docs.kie.ai/market/gpt/gpt-image-2-6-flare-image-to-image.md)
- [Sunburst 文生图](https://docs.kie.ai/market/gpt/gpt-image-2-6-sunburst-text-to-image.md)
- [Sunburst 编辑](https://docs.kie.ai/market/gpt/gpt-image-2-6-sunburst-image-to-image.md)
- [Economy 文生图](https://docs.kie.ai/market/gpt/gpt-image-2-6-economy-text-to-image.md)
- [Economy 编辑](https://docs.kie.ai/market/gpt/gpt-image-2-6-economy-image-to-image.md)
- [模型页（Token 单价说明）](https://kie.ai/gpt-image-2-6)
- [实时价格页](https://kie.ai/pricing)（2026-11-07 核对 Flare/Sunburst Token 行与 Economy 1K 行）
- [同尺寸输出 Token 参考表（2.5）](https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation.md)
