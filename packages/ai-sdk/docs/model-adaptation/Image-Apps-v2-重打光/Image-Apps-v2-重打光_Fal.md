# Image Apps v2 重打光（Fal）适配资料

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 平台 | Fal |
| 展示名 | Relighting |
| API endpoint ID | `fal-ai/image-apps-v2/relighting` |
| 模态 | 单图输入 → 单张重打光图片 |
| SDK 入口 | `@henjicc/ai-sdk/tool-models/fal/relighting` |
| 工具包 | `@henjicc/ai-sdk/tool-packs/fal-image-utility-tools` |
| 价格 | `$0.04 / image` |
| 登录状态 | 模型页、`llms.txt` 与 OpenAPI 公开；真实调用需要 Fal Key |

## 1. 能力与产品边界

该端点使用固定预设为单张图片重新设计光照，没有提示词、光源坐标、光强、色温或遮罩字段。产品不应将预设宣称为物理精确打光，也不应补造不会进入请求的提示词输入。

18 个官方光照预设是：

`natural` / `studio` / `golden_hour` / `blue_hour` / `dramatic` / `soft` / `hard` / `backlight` / `side_light` / `front_light` / `rim_light` / `sunset` / `sunrise` / `neon` / `candlelight` / `moonlight` / `spotlight` / `ambient`。

## 2. 接口与队列契约

- 鉴权：`Authorization: Key <FAL_KEY>`
- 直连：`POST https://fal.run/fal-ai/image-apps-v2/relighting`
- 队列提交：`POST https://queue.fal.run/fal-ai/image-apps-v2/relighting`
- 状态：`GET https://queue.fal.run/fal-ai/image-apps-v2/relighting/requests/{request_id}/status`
- 结果：`GET https://queue.fal.run/fal-ai/image-apps-v2/relighting/requests/{request_id}`
- 取消：`PUT https://queue.fal.run/fal-ai/image-apps-v2/relighting/requests/{request_id}/cancel`
- 结果路径：`images[].url`；`images` 必填，数组元素只有 `url` 必填

| 状态 | 字段与语义 | 客户端处理 |
|---|---|---|
| `IN_QUEUE` | `status` / `request_id` 必填；`queue_position` 可选 | 继续轮询，不产生媒体结果 |
| `IN_PROGRESS` | `status` / `request_id` 必填；`logs` / `metrics` 可选 | 继续轮询，可更新进度 |
| `COMPLETED` | 状态终态；官方状态 schema 不代表业务必然成功 | 再取结果，校验 `images[].url`；空数组或缺 URL 按契约失败处理 |

模型没有新增队列状态、回调事件或错误码。取消后是否还会看到短暂状态迁移、断线后的保留期和乱序规则，模型 OpenAPI 未说明；实现继续复用 [Fal 供应商队列契约](../供应商/Fal.md#2-队列契约)。

## 3. 请求字段

| 字段 | 类型 | 必填 | 默认 / 范围 | 产品策略 |
|---|---|---|---|---|
| `image_url` | string | 是 | 官方未给文件大小与格式上限 | 恰好 1 张已有素材，由 Fal CDN 上传后填入 |
| `lighting_style` | enum | 否 | `natural`；共18个预设 | 显示并发送 |
| `aspect_ratio` | `{ratio: enum}` | 否 | `ratio` 子字段默认 `1:1`；支持 `1:1` / `16:9` / `9:16` / `4:3` / `3:4` | 复用标准智能比例，按首图就近匹配，发送对象而非字符串 |

`aspect_ratio` 的描述是“4K 输出比例”。OpenAPI 没有给出各比例的精确像素尺寸，不应在 SDK 中自行硬编一组未经证实的 4K 宽高。

## 4. 请求与响应示例

```json
{
  "image_url": "https://v3.fal.media/files/.../source.png",
  "lighting_style": "golden_hour",
  "aspect_ratio": { "ratio": "4:3" }
}
```

```json
{
  "images": [
    { "url": "https://v3b.fal.media/files/.../relit.png" }
  ]
}
```

## 5. 计价、适配要点与未知项

- 实时 `llms.txt` 标价 `$0.04 / image`，不随已选光照预设或比例变化。
- 静态预估为 `$0.04 / 次`；最终以账户价格 API 和 billing event 为准。
- 不定义、不发送 `seed`、负面提示词、`output_format` 或任何文档未声明的字段。
- 官方未给输入分辨率、格式、大小、延迟 SLA 与结果保留期；接入前需用真实请求验证。

## 6. 原始链接索引

| 内容 | 链接 | 是否需登录 | 核查日期 |
|---|---|---|---|
| 模型页与当前价格 | https://fal.ai/models/fal-ai/image-apps-v2/relighting | 否 | 2026-08-29 |
| 实时字段、枚举、示例与价格 | https://fal.ai/models/fal-ai/image-apps-v2/relighting/llms.txt | 否 | 2026-08-29 |
| OpenAPI（对象比例、必填与响应结构） | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-apps-v2/relighting | 否 | 2026-08-29 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 | 2026-08-29 |
| Fal 价格 API | https://fal.ai/docs/platform-apis/v1/models/pricing | 否（调用需 Key） | 2026-08-29 |
