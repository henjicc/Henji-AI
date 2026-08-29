# Hailuo 02 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 视频 |
| 供应商 | KIE.ai |
| 平台模型 ID | `hailuo/02-text-to-video-standard`、`hailuo/02-image-to-video-standard`、`hailuo/02-text-to-video-pro`、`hailuo/02-image-to-video-pro` |
| 接口形态 | `POST /api/v1/jobs/createTask` + `GET /api/v1/jobs/recordInfo` |
| 价格可见性 | 公开，无需登录 |

## 1. 路由与规格

| 输入 | 规格 | 模型 |
|---|---|---|
| 无图 | 6/10 秒、768P | `hailuo/02-text-to-video-standard` |
| 1–2 张图 | 6/10 秒、512P/768P | `hailuo/02-image-to-video-standard` |
| 无图 | 6 秒、1080P | `hailuo/02-text-to-video-pro` |
| 1 张图 | 6 秒、1080P | `hailuo/02-image-to-video-pro` |

约束：

- 512P 价格只有图生视频 Standard 分支；文生视频 Standard 固定按 768P 计价，请求也不发送 `resolution`。
- 1080P 只有 Pro 6 秒档；不存在 `10 秒 + 1080P`。遇到历史参数组合时，运行时必须回收到 10 秒 768P，不得带着 1080P 下发或估价。
- 首尾帧仍走 Standard 图生视频端点，第二张图映射为 `end_image_url`。

## 2. 价格

KIE 公开定价使用积分，`1 Credit = $0.005`。

| 组合 | Credits | 美元价格 |
|---|---:|---:|
| Standard 文生 / 图生，6s 768P | 30 / 条 | $0.15 |
| Standard 文生 / 图生，10s 768P | 50 / 条 | $0.25 |
| Standard 图生，6s 512P | 12 / 条 | $0.06 |
| Standard 图生，10s 512P | 20 / 条 | $0.10 |
| Pro 文生 / 图生，6s 1080P | 57 / 条 | $0.285 |

SDK 应按实际路由计价：文生视频即使收到残留的 `512P` 参数，也必须按 768P 计价。

## 3. 项目策略

- 模型 schema 保留通用时长和分辨率控件，非法的 10s 1080P 会被联动回收到 768P。
- builder 和 pricing 使用同一套有效规格归一化，防止 UI、旧工程或外部 SDK 消费方绕过联动后发生低估。
- 这些价格以美元记录；人民币展示由宿主使用用户汇率换算。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| Standard 文生视频 | https://docs.kie.ai/cn/market/hailuo/02-text-to-video-standard | 否 |
| Standard 图生视频 | https://docs.kie.ai/cn/market/hailuo/02-image-to-video-standard | 否 |
| Pro 文生视频 | https://docs.kie.ai/cn/market/hailuo/02-text-to-video-pro | 否 |
| Pro 图生视频 | https://docs.kie.ai/cn/market/hailuo/02-image-to-video-pro | 否 |
| 模型专页 | https://kie.ai/hailuo-api | 否 |
| 当前定价 | https://kie.ai/pricing | 否 |
