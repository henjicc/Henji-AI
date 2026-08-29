# Topaz 图片放大（Fal）

## 定位

- 端点：`topaz/upscale/image/precision`、`topaz/upscale/image/creative`、`topaz/upscale/image/generative`。
- 类型：单图输入、单图输出的专业放大工具。
- 产品边界：精确模式偏忠实放大；创意和生成模式会推断或重建细节，界面不得宣传为“无损”。
- 官方资料核查日期：2026-08-29；文档公开，无需登录，真实调用需要 Fal API Key。

## 公共协议

| 项目 | 契约 |
|---|---|
| Base URL | 队列提交 `https://queue.fal.run/<endpoint-id>` |
| 鉴权 | `Authorization: Key <FAL_KEY>` |
| 提交 | `POST /<endpoint-id>`，请求体直接发送模型输入对象 |
| 查询 | `GET /<endpoint-id>/requests/<request_id>/status` |
| 结果 | `GET /<endpoint-id>/requests/<request_id>` |
| 取消 | `PUT /<endpoint-id>/requests/<request_id>/cancel` |
| 状态 | `IN_QUEUE` → `IN_PROGRESS` → `COMPLETED`；完成后仍需检查错误字段 |
| 输出 | `image: File`，SDK 复用 Fal 通用 URL 提取与下载链路 |

## 模式与字段

| 模式 | 子模型 | 应用开放字段 | 隐藏或固定字段 |
|---|---|---|---|
| Precision | Standard V2、High Fidelity V3/V2、Low Resolution V2、CGI、Text Refine | 模型、2×/4×、人脸增强 | `crop_to_fill=false`；不发送 `output_format`、subject detection、sharpen、denoise 等高级字段 |
| Creative | Bloom 2、Bloom、Bloom Realism | 模型、2×/4×；Bloom 2 额外开放 creativity 1～9 与颜色保留 | Bloom 2 的 autoprompt 使用 Topaz 默认；不发送 `output_format` |
| Generative | Wonder 3.5/3/2、Wonder、Recover 3、Standard MAX、Recovery V2/Recovery | 模型、2×/4×、人脸增强；Wonder 3/3.5 开放重建强度 | 不发送 `output_format`、seed、prompt；Redefine 因依赖提示词引导而暂不开放 |

应用默认使用 Precision / High Fidelity V3 / 2×，人脸增强默认关闭。启用人脸增强时固定下发
`face_enhancement_creativity=0` 与 `face_enhancement_strength=0.8`，优先降低人物身份漂移。

## 请求示例

```json
{
  "image_url": "https://example.com/source.jpg",
  "model": "High Fidelity V3",
  "upscale_factor": 2,
  "crop_to_fill": false,
  "face_enhancement": false
}
```

Bloom 2 会按需追加：

```json
{
  "creativity": 4,
  "color_preservation": true
}
```

## 价格

Fal 以实际输出像素按“每开始一档”计费，应用在上传前根据源图尺寸与倍率计算预计输出 MP：

| 模式/子模型 | 官方单价 |
|---|---|
| Precision | 每开始 24 输出 MP `$0.08` |
| Creative | 每开始 2 输出 MP `$0.08` |
| Generative · Wonder 3.5 / Wonder 3 | 每开始 8 输出 MP `$0.08` |
| Generative · 其他已开放子模型 | 每开始 4 输出 MP `$0.08` |

Topaz 主入口在画布侧限制预计输出不超过 48MP，超过时在上传和创建付费任务前阻止。输入文件沿用应用
20MiB 安全上限。透明图片改用独立的 Topaz Transparent 或 Bria 模型。

## 适配与验证

- SDK canonical ID：`topaz-image-upscale`；应用模型 ID：`fal-ai-topaz-image-upscale`。
- 模式通过端点选择器路由，不在宿主或画布 UI 里按模型 ID 拼请求。
- 输出 MP 由画布预检写入 `__upscaleOutputMegapixels`，仅用于本地估价，不发送给 Fal。
- 已完成端点、请求构建、非法参数回落、单图限制和四种计价档位的离线契约测试；未执行真实付费生成。

## 一手资料

| 信息 | 链接 | 登录 |
|---|---|---|
| Precision API | https://fal.ai/models/topaz/upscale/image/precision/api | 否 |
| Creative API | https://fal.ai/models/topaz/upscale/image/creative/api | 否 |
| Generative API | https://fal.ai/models/topaz/upscale/image/generative/api | 否 |
| Precision OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=topaz/upscale/image/precision | 否 |
| Creative OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=topaz/upscale/image/creative | 否 |
| Generative OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=topaz/upscale/image/generative | 否 |
| API Key | https://fal.ai/dashboard/keys | 是 |
