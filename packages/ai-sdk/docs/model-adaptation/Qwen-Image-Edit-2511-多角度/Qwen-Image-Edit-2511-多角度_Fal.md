# Qwen Image Edit 2511 多角度（Fal）适配资料

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-09-10 |
| 平台 | Fal |
| API endpoint ID | `fal-ai/qwen-image-edit-2511-multiple-angles` |
| 模态 | 图片编辑；产品每个视角单图输入、单图输出 |
| 价格 | $0.035 / megapixel，现有工具每视角约 1MP 估算 |
| 登录状态 | 模型页、API 与 OpenAPI 公开；调用需要 Fal Key |
| 接入状态 | 替换本工具的 2509 版本；真实付费图像质量尚未验证 |

## 参数与产品映射

| API 字段 | 类型、默认与边界 | 产品策略 |
|---|---|---|
| image_urls | 必填 string[]，至少 1 张 | 产品限制单张；复用 Fal 上传 |
| horizontal_angle | number，默认 0，0..360；0 正面、90 右侧、180 背面、270 左侧 | 界面左转为正的 −180..180°，发送 `(-yaw + 360) % 360` |
| vertical_angle | number，默认 0，−30..90；负数仰视、正数俯视 | 直接使用度数，预览与请求同号同单位 |
| zoom | number，默认 5，0..10 | 0 全景、5 中景、10 特写 |
| image_size | 枚举或正整数 width/height 对象；不传则继承输入尺寸 | 沿用按源图匹配最近标准比例、约 1MP 的策略；不新增输出比例控件 |
| num_images | integer，默认 1，1..4 | 固定 1；多个视角分别请求、独立输出节点 |
| guidance_scale | number，默认 4.5，1..20 | 隐藏，固定 4.5 |
| num_inference_steps | integer，默认 28，1..50 | 隐藏，固定 28 |
| lora_scale | number，默认 1，0..4 | 隐藏，固定 1 |
| acceleration | none / regular，默认 regular | 固定 regular |
| enable_safety_checker | boolean，默认 true | 固定 true |
| additional_prompt | string/null，可选 | 当前节点不展示、不请求 |
| negative_prompt / seed / sync_mode / output_format | 可选；output_format 为 png/jpeg/webp | 不展示、不请求，沿用队列与服务端默认 |

2511 不支持旧版 `rotate_right_left`、`move_forward`、`wide_angle_lens`，不可继续透传。移除广角开关。拖动过程中只更新局部预览，松手才吸附近邻常用角度并提交配置。

模型根据 horizontal_angle、vertical_angle、zoom 构造 `<sks>` 视角描述提示词，再由多角度 LoRA 生成。参数表示目标视角，不保证测量级几何精度。

## 请求与异步协议

- 提交：`POST https://queue.fal.run/fal-ai/qwen-image-edit-2511-multiple-angles`，鉴权 `Authorization: Key <FAL_KEY>`。
- 复用 [Fal 公共队列契约](../供应商/Fal.md#2-队列契约)，根据响应 status_url / response_url 轮询和取结果，不复制状态机。
- 成功输出：`images[].url`、`seed`、`prompt` 必填。图片元数据可缺失或 null；url 必填。
- 空图、多图、终态错误和取消仍走现有多角度批次与 Fal provider 失败处理；不会自动补发付费请求。

| 事件 | 前置状态 → 后续状态 | 输出/边界 |
|---|---|---|
| submit | 新请求 → IN_QUEUE 或 IN_PROGRESS | request_id、status_url；记录请求归属 |
| status | 等待 → IN_QUEUE / IN_PROGRESS | 不提取最终图片；继续公共轮询 |
| status COMPLETED | 等待 → 拉取结果 | 按 response_url 取结果 |
| result | 拉取结果 → completed | images[].url；保存独立视角结果 |
| HTTP/业务失败、空结果 | 提交/等待/取结果 → failed | 公共错误映射；不静默成功 |
| cancel/超时 | 活跃 → cancelled/failed | 复用现有取消、轮询上限与资源释放 |

`packages/ai-sdk/tests/fixtures/fal-tools/qwen-image-edit-2511-multiple-angles.json` 包含 2026-09-10 原样抓取的官方 input/output schema。请求和队列响应为明确标注的字段表构造离线夹具，不代表真实付费调用。对应精确测试覆盖默认值、仰视/顶视、上传、路由、轮询和图片提取；画布策略测试覆盖左右方向与三维姿态映射。

## 原始链接索引

- [模型页与价格](https://fal.ai/models/fal-ai/qwen-image-edit-2511-multiple-angles)：公开，$0.035/MP。
- [API 字段与提示词构造说明](https://fal.ai/models/fal-ai/qwen-image-edit-2511-multiple-angles/api)：公开。
- [官方 OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/qwen-image-edit-2511-multiple-angles)：公开，范围、默认值、required/nullable；本次实际采集。
