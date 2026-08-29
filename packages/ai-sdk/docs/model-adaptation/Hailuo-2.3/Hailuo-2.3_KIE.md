# Hailuo 2.3 · KIE

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 图生视频 |
| 供应商 | KIE.ai |
| 平台模型 ID | `hailuo/2-3-image-to-video-standard`、`hailuo/2-3-image-to-video-pro` |
| 接口形态 | `POST /api/v1/jobs/createTask` + `GET /api/v1/jobs/recordInfo` |
| 价格可见性 | 公开，无需登录 |

## 1. 请求和合法组合

两个端点都要求 1 张输入图片，提交字段为 `prompt`、`image_url`、`duration`、`resolution`。

| 模式 | 6s 768P | 10s 768P | 6s 1080P | 10s 1080P |
|---|---|---|---|---|
| Standard | 支持 | 支持 | 支持 | **不支持** |
| Pro | 支持 | 支持 | 支持 | **不支持** |

`10 秒 + 1080P` 不是 KIE 公开的价格/请求组合。生成页联动会将它回收到 10 秒 768P，SDK builder 和 pricing 也必须做相同归一化。

## 2. 价格

KIE 定价页的精确积分换算为 `1 Credit = $0.005`。

| 模式 | 组合 | Credits | 美元价格 |
|---|---|---:|---:|
| Standard | 6s 768P | 30 / 条 | $0.15 |
| Standard | 10s 768P | 50 / 条 | $0.25 |
| Standard | 6s 1080P | 50 / 条 | $0.25 |
| Pro | 6s 768P | 45 / 条 | $0.225 |
| Pro | 10s 768P | 90 / 条 | $0.45 |
| Pro | 6s 1080P | 80 / 条 | $0.40 |

模型营销专页将部分精确价格显示为 `$0.26 / $0.22 / $0.39`，与同页 Credits 和当前定价数据不一致。SDK 以当前定价表的 Credits 及其精确美元值为准。

## 3. 项目策略

- 价格表只保留六个官方合法 key，不得把未知 key fallback 到 Standard 6s 768P。
- 对残留的 `10s + 1080P` 参数，builder 和 pricing 统一回收到 `10s + 768P`。
- 这些价格以美元记录；人民币展示由宿主使用用户汇率换算。

## 4. 原始链接索引

| 信息 | 链接 | 登录 |
|---|---|---|
| Standard 图生视频 | https://docs.kie.ai/cn/market/hailuo/2-3-image-to-video-standard | 否 |
| Pro 图生视频 | https://docs.kie.ai/cn/market/hailuo/2-3-image-to-video-pro | 否 |
| 模型专页 | https://kie.ai/hailuo-2-3 | 否 |
| 当前定价 | https://kie.ai/pricing | 否 |
