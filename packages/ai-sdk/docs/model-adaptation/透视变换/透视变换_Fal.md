# 透视变换（Fal）适配资料

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-29 |
| 平台 | Fal |
| 展示名 | Perspective Change |
| API endpoint ID | `fal-ai/image-apps-v2/perspective` |
| 模态 | 单图输入 → 单个离散视角图 |
| 商用标记 | Fal 模型页明确标为 `Commercial use` |
| 价格 | `$0.04 / image` |
| 登录状态 | 模型页、Agent 文本与 OpenAPI 公开；真实调用需要 Fal Key |
| 接入定位 | 多角度能力的离散完整方位档；不与连续控制档混成同一结果组 |

## 1. 接口

- endpoint ID：`fal-ai/image-apps-v2/perspective`
- 输入：`image_url` 必填；`target_perspective` 可选；`aspect_ratio` 可选。
- 输出：`images[]`，首版要求恰好一张。
- 异步、上传、取消、结果解析复用 [Fal 供应商资料](../供应商/Fal.md)。

## 2. 离散视角枚举

| API 值 | 产品标签 | 精度说明 |
|---|---|---|
| `front` | 正面 | 语义预设，不是 0° 相机外参 |
| `left_side` | 左侧面 | 语义预设，不承诺精确 90° |
| `right_side` | 右侧面 | 语义预设，不承诺精确 -90° |
| `back` | 背面 | 由模型推断不可见区域 |
| `top_down` | 顶视 | 语义预设 |
| `bottom_up` | 仰视 | 语义预设 |
| `birds_eye` | 鸟瞰 | 语义预设 |
| `three_quarter_left` | 左三分之四 | 语义预设 |
| `three_quarter_right` | 右三分之四 | 语义预设 |

首版固定 1 张输入图、每个目标预设单独请求、同组不允许重复预设。默认完整方位组为正面、右侧面、背面、左侧面。该端点没有提示词、连续角度、距离或 FOV 字段，界面不得补造相关控件。

## 3. 价格与失败策略

- `$0.04 / image`；4 个方位约 `$0.16`，全部 9 个预设约 `$0.36`。
- 单次输出数量不等于 1 时视为契约失败。
- 批次失败时沿用多角度原子落图和按失败项重试策略。
- 离散档和连续档来自不同模型，不能在一个结果组混用，否则组内一致性和精度语义不可比较。

## 4. 待真实验证

- `front/side/back` 的方位遵从和人物/商品身份一致性。
- 不可见背面补全质量与文字、标志、结构漂移。
- `top_down` 与 `birds_eye` 的实际差异。
- 官方未给延迟承诺，需按 request ID 记录真实耗时。

## 5. 原始链接索引

| 内容 | 链接 | 是否需登录 | 核查日期 |
|---|---|---|---|
| 模型页、商用标记与价格 | https://fal.ai/models/fal-ai/image-apps-v2/perspective | 否 | 2026-08-29 |
| 实时 Agent 文本 | https://fal.ai/models/fal-ai/image-apps-v2/perspective/llms.txt | 否 | 2026-08-29 |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-apps-v2/perspective | 否 | 2026-08-29 |
| Fal 队列协议 | https://fal.ai/docs/documentation/model-apis/inference/queue | 否 | 2026-08-29 |
