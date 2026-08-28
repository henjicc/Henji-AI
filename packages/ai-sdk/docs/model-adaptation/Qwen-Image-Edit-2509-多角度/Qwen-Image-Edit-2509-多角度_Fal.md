# Qwen Image Edit 2509 多角度（Fal）适配资料

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 平台 | Fal |
| 展示名 | Qwen Image Edit 2509 Lora Gallery / Multiple Angles |
| API endpoint ID | `fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles` |
| 模态 | 单图输入 → 单角度编辑图 |
| 商用标记 | Fal 模型页明确标为 `Commercial use` |
| 价格 | `$0.035 / megapixel` |
| 登录状态 | 模型页、Agent 文本与 OpenAPI 公开；真实调用需要 Fal Key |
| 接入状态 | 已完成静态契约，待任务 4.4 实现与真实付费质量验证 |

> 本端点虽然用“角度”和“度数”描述部分输入，但没有输出相机内参、外参或几何误差。产品侧只能称为“模型控制角”，不能称为测量级相机姿态。

## 1. 接口与异步协议

- 直连：`POST https://fal.run/fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles`
- 队列提交：`POST https://queue.fal.run/fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles`
- 鉴权：`Authorization: Key <FAL_KEY>`
- 生产模式：复用 Fal 供应商公共队列、轮询、取消、结果解析和 Fal CDN 上传，不新增协议实现。
- 结果路径：`images[].url`；同时返回 `seed`。

队列事件契约、官方 fixture 与现有 parser 边界沿用 [Fal 供应商资料](../供应商/Fal.md#2-队列契约)。本模型没有新增状态或响应协议；任务 4.4 只需补请求构建与模型精确测试，不应复制 Fal 队列状态机。

## 2. 请求字段

| 字段 | 类型 | 必填 | 默认 | 范围/枚举 | 产品策略 |
|---|---|---|---|---|---|
| `image_urls` | `string[]` | 是 | — | 官方未给最大数量 | 产品固定 1 张输入图，由 Fal 官方上传链路生成 URL |
| `image_size` | 尺寸枚举或 `{width,height}` | 否 | 保留最终输入图尺寸 | `square_hd`、`square`、`portrait_4_3`、`portrait_16_9`、`landscape_4_3`、`landscape_16_9` 或正整数尺寸 | 首版根据输入比例映射到约 1MP 的标准档，限制费用，不直接沿用超大输入尺寸 |
| `guidance_scale` | number | 否 | `1` | `0..20` | 隐藏，固定 `1` |
| `num_inference_steps` | integer | 否 | `6` | `2..50` | 隐藏，固定 `6` |
| `acceleration` | string | 否 | `regular` | `none` / `regular` | 隐藏，固定 `regular` |
| `negative_prompt` | string | 否 | 单个空格 | — | 不显示、不请求 |
| `seed` | integer/null | 否 | — | — | 不显示、不请求 |
| `sync_mode` | boolean | 否 | `false` | — | 不显示、不请求，沿用队列 |
| `enable_safety_checker` | boolean | 否 | `true` | — | 隐藏，固定 `true` |
| `output_format` | string | 否 | `png` | `png` / `jpeg` / `webp` | 不显示、不请求，沿用项目约定 |
| `num_images` | integer | 否 | `1` | `1..4` | 隐藏，固定 `1`；多角度由多个不同控制参数请求组成，不能用同角度变体冒充多视角 |
| `rotate_right_left` | number | 否 | `0` | `-90..90` 度；正值向左、负值向右 | 作为水平“模型控制角”展示并发送 |
| `move_forward` | number | 否 | `0` | `0..10` | 作为近摄程度；不能表达后退或远景 |
| `vertical_angle` | number | 否 | `0` | `-1..1`；`-1` 鸟瞰、`1` 仰视 | 使用语义刻度，不显示为度数 |
| `wide_angle_lens` | boolean | 否 | `false` | — | 作为广角开关；不能冒充远距离 |
| `lora_scale` | number | 否 | `1.25` | `0..4` | 隐藏，固定 `1.25` |

### 产品输入顺序

1. 输入图片（固定 1 张）
2. 控制档：连续镜头
3. 视角集合（默认 4，首版 `1..6`）
4. 水平模型控制角
5. 俯拍/仰拍
6. 近摄程度
7. 广角开关

本端点**没有提示词字段**。首版正式界面不得展示一个不会进入请求的提示词输入；数据结构可为未来其它控制档保留可选字段，但当前档必须标为不可用并不持久化无效输入。

## 3. 首版请求映射

每个选择的目标视角产生一次独立 Fal 请求：

```json
{
  "image_urls": ["<Fal CDN URL>"],
  "image_size": "landscape_4_3",
  "guidance_scale": 1,
  "num_inference_steps": 6,
  "acceleration": "regular",
  "enable_safety_checker": true,
  "num_images": 1,
  "rotate_right_left": -45,
  "move_forward": 0,
  "vertical_angle": 0,
  "wide_angle_lens": false,
  "lora_scale": 1.25
}
```

`image_size` 根据第一张输入图比例选最接近的标准档：方形、4:3、16:9 及其竖向版本。生成结果的实际像素数必须用于最终费用记录；静态估价按不超过约 1MP/张计算。

## 4. 输出与失败边界

- 单次请求期望 `images.length === 1`；零张或多张都视为该视角契约不符，不静默截断。
- 一组多角度结果按用户选择顺序保存，标签来自请求前的相机控制数据，不从文件名或结果顺序重新推断。
- 多角度批次可并发最多 2 个请求；所有视角完成后才交给画布多结果事务落图。
- 某个视角失败时不提交半成品结果组；节点保留每个视角的状态和已完成 URL，以便只重试失败项，避免重复付费。
- 模型没有物理几何保证；输出标签要同时保存 `controlPrecision: learned-native`。

## 5. 价格与预算

- 官方标价：`$0.035 / megapixel`。
- 首版固定约 1MP：单视角预算上限按 `$0.035` 估算。
- 默认 4 视角：约 `$0.14`；首版最大 6 视角：约 `$0.21`。
- 最终账单可能受实际输出像素和账户价格影响，真实调用后应按 Fal billing event / request ID 对账。
- 官方未给延迟承诺；真实验收需记录每个 request ID 的排队、生成和总耗时。

## 6. 待真实验证

- 水平角度数值与视觉角度的误差分布，尤其是人物、非对称商品和建筑。
- 多次独立请求的身份、服装、纹理、文字、背景与几何一致性。
- `vertical_angle` 的有效分辨率与极值稳定性。
- `move_forward` 是否会改变主体身份或仅改变构图。
- 标准尺寸映射的真实像素与计费单位。
- 取消、单项重试和已完成 URL 的有效期。

## 7. 原始链接索引

| 内容 | 链接 | 是否需登录 | 核查日期 |
|---|---|---|---|
| 模型页、商用标记与价格 | https://fal.ai/models/fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles | 否 | 2026-08-29 |
| 实时 Agent 文本（字段、价格、示例） | https://fal.ai/models/fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles/llms.txt | 否 | 2026-08-29 |
| OpenAPI（完整枚举、范围、必填与响应） | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles | 否 | 2026-08-29 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 | 2026-08-29 |
| Fal 价格 API | https://fal.ai/docs/platform-apis/v1/models/pricing | 否 | 2026-08-29 |
