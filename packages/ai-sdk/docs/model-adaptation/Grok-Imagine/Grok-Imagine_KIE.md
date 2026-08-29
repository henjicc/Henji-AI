# Grok Imagine · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 图片 |
| 供应商 | KIE.ai |
| 平台模型 ID | `grok-imagine/text-to-image`、`grok-imagine/image-to-image` |
| 接口形态 | `POST /api/v1/jobs/createTask` + `GET /api/v1/jobs/recordInfo` |
| 价格可见性 | 公开，无需登录 |

## 1. 模式

- 文生图使用 `grok-imagine/text-to-image`，`enable_pro=false` 是 Standard，`enable_pro=true` 是 Quality。
- 图生图使用 `grok-imagine/image-to-image`，输入 1 张图片。

## 2. 价格与输出单位

KIE 定价使用 `1 Credit = $0.005`。

| 模式 | Credits | 总价 | 计价输出单位 |
|---|---:|---:|---|
| Standard 文生图 | 4 / 次 | $0.02 / 次 | 2 张图 |
| Quality 文生图 | 5 / 次 | $0.025 / 次 | **4 张图** |
| 图生图 | 4 / 张 | $0.02 / 张 | 1 张图 |

SDK calculator 返回的是整次请求价格：Quality 仍是 `$0.025`，但说明必须写明该次输出 4 张，不能写成 2 张。

## 3. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| Grok Imagine 文生图 | https://docs.kie.ai/cn/market/grok-imagine/text-to-image | 否 |
| Grok Imagine 图生图 | https://docs.kie.ai/cn/market/grok-imagine/image-to-image | 否 |
| 模型专页 | https://kie.ai/grok-imagine | 否 |
| 当前定价 | https://kie.ai/pricing | 否 |
