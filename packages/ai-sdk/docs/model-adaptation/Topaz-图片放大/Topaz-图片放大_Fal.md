# Topaz 图片放大（Fal）

## 定位

- 端点：`fal-ai/topaz/upscale/image`
- 类型：单图输入、单图输出的真实放大工具，不接收提示词。
- 首版产品目标：提高像素尺寸并尽量保持输入内容；不把生成式重绘宣传为“无损高清”。
- 官方资料核查日期：2026-08-29。

## 官方契约

| 项目 | 官方契约 | 首版采用 |
|---|---|---|
| 输入 | `image_url`，必填 | 画布连线或标准图片上传，严格 1 张 |
| 放大倍率 | `upscale_factor`，浮点数 1～4 | 只开放 2×、4× |
| 精度模型 | Standard V2、High Fidelity V2、Low Resolution V2、CGI、Text Refine | 全部开放，默认 High Fidelity V2 |
| 生成式模型 | Wonder 3、Wonder、Standard MAX、Redefine、Recovery | 不开放，避免把重绘能力冒充忠实放大 |
| 人脸增强 | `face_enhancement`，附带 creativity / strength | 可选，默认关闭；启用时 creativity 固定 0、strength 固定 0.8 |
| 裁切 | `crop_to_fill` | 固定 false，不改变构图 |
| 输出 | `image: File`；默认 JPEG | 不显式发送 `output_format`；透明输入首版在提交前拒绝 |
| 队列 | 标准 Fal queue：IN_QUEUE / IN_PROGRESS / COMPLETED，可取消 | 复用已有 Fal 队列、轮询、取消和文件上传链路 |

## 价格与产品上限

- 官方阶梯：输出不超过 24MP 为 `$0.08`，不超过 48MP 为 `$0.16`，不超过 96MP 为 `$0.32`；官方页面列出的最高档可到 512MP、`$1.36`。
- 首版只允许输出不超过 48MP，因此提交前可以给出确定的 `$0.08` 或 `$0.16` 估价；超过 48MP 直接阻止，不进入上传和付费队列。
- 输入文件首版限制 20MiB，这是痕迹AI现有图片上传安全上限，不是 Fal 官方限制。

## 请求示例

```json
{
  "image_url": "https://example.com/source.jpg",
  "model": "High Fidelity V2",
  "upscale_factor": 2,
  "crop_to_fill": false,
  "subject_detection": "All",
  "face_enhancement": false
}
```

启用人脸增强时追加：

```json
{
  "face_enhancement": true,
  "face_enhancement_creativity": 0,
  "face_enhancement_strength": 0.8
}
```

## 兼容与降级边界

- `Low Resolution V2`、`Text Refine` 与人脸增强可能推断或重建细节，界面说明必须避免“无损”措辞。
- 官方默认输出 JPEG，透明输入若继续提交会丢失透明通道，所以首版明确拒绝；后续只有官方格式契约与真实回归验证完成后才能放开。
- 本地 Real-ESRGAN（BSD-3-Clause）保留为未来离线回退候选；首版不内置约 49MiB 的旧版 ncnn/Vulkan 运行时，也不把 Sharp 插值称作 AI 超分。

## 一手资料

- Fal 模型文档：<https://fal.ai/models/fal-ai/topaz/upscale/image/api>
- Fal OpenAPI：<https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/topaz/upscale/image>
- Real-ESRGAN 官方仓库：<https://github.com/xinntao/Real-ESRGAN>
- Real-ESRGAN BSD-3-Clause 许可证：<https://raw.githubusercontent.com/xinntao/Real-ESRGAN/master/LICENSE>
