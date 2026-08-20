# Midjourney

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-21 |
| 模态 | 图片 |
| 建议拆分 | 一个 APIMart 模型；通过动作类型路由 Imagine、Blend、Describe、Upscale、Variation 等能力 |
| 项目默认隐藏 | `seed`、负面提示词；Midjourney 原生 prompt 参数中若用户主动写入则作为 prompt 文本传递 |
| 官方接口 | 本清单未提供 Midjourney 官方接口链接；仅按 APIMart API 适配 |

## 平台汇总

| 平台 | 支持情况 | 平台模型 ID / 端点 | API 文档 | 价格 | 登录/可见性 |
|---|---|---|---|---|---|
| APIMart | 支持 | `model=midjourney`；新接口 `/v1/midjourney/...` | [Midjourney API 总览](https://docs.apimart.ai/en/api-reference/images/midjourney/generation.md)、[Imagine](https://docs.apimart.ai/en/api-reference/images/midjourney/imagine.md) | 标准 Imagine `$0.04504/次`；Fast `$0.05504/次`；Turbo `$0.10/次`；视频另计 | 文档、价格页公开可见；生成需要 API Key |

## APIMart 适配

- Base URL `https://api.apimart.ai`；基础 Imagine 提交 `POST /v1/midjourney/generations`；轮询 `GET /v1/tasks/{task_id}`。使用 `Authorization: Bearer <API_KEY>`。
- APIMart 新 Midjourney 路由会自动补充 `model=midjourney`。最小文生图请求为 `prompt`；图生图可在 prompt 中携带图片 URL，具体动作接口也接受对应的图片或任务参数。
- 任务动作接口包括 Imagine、Blend、Describe、编辑、Upscale、Variation、Reroll、Zoom、Pan、Inpaint、Remix、Video 等；动作必须使用上一步任务返回的任务/图片信息。不要把这些动作误合并成普通图片生成字段。
- 成功任务按 Midjourney 文档的结果结构读取图片 URL；状态通过通用 `GET /v1/tasks/{task_id}` 查询，终态以 `completed` 或 `failed` 为准。

| 适配层字段 | 类型/取值 | 适配说明 |
|---|---|---|
| `prompt` | string | 必填；Midjourney 原生参数可作为 prompt 的一部分传递 |
| `action` | `imagine`、`blend`、`describe`、`upscale`、`variation` 等 | 由能力路由选择专属 `/v1/midjourney/...` 接口 |
| `image_urls` | URL 数组 | Blend、Describe、编辑等动作使用；以动作文档的数量限制为准 |
| `task_id` / `index` | string / integer | Upscale、Variation、Zoom、Pan 等后续动作需要前序任务上下文 |
| `seed` / 负面提示词 | — | 项目 UI 绝对不显示；不要在公共参数 schema 中注册 |

### 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)。价格页按动作/速度列出 75 个价格模式；标准、Fast、Turbo 是 Imagine 参考价，Video、720p 等动作独立计费，实际金额以对应动作的实时价格为准。

## 原始链接索引

- [APIMart Midjourney API 总览](https://docs.apimart.ai/en/api-reference/images/midjourney/generation.md)：路由、动作范围和通用协议。
- [APIMart Midjourney Imagine](https://docs.apimart.ai/en/api-reference/images/midjourney/imagine.md)：基础 Imagine 请求。
- [APIMart 定价](https://apimart.ai/zh/pricing)：按动作与速度的价格。
