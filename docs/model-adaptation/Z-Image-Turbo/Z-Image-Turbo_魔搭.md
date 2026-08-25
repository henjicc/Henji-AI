# Z-Image Turbo · 魔搭 ModelScope

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 图片（文生图） |
| 供应商 | 魔搭 ModelScope（开源模型托管平台） |
| 平台模型 ID | `Tongyi-MAI/Z-Image-Turbo` |
| 接口形态 | **异步任务**：提交返回 `task_id`，轮询统一任务接口 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |
| 计费 | **1 魔粒/次**（主流模型档），不是货币 |

供应商公共协议（Base URL、鉴权、轮询、结果解析、魔粒计费、可用性判定）见 [供应商/魔搭.md](../供应商/魔搭.md)。

## 1. 能力

| 能力 | 支持 |
|---|---|
| 文生图 | ✅ |
| 图片编辑 | ❌ 本模型不接受 `image_url` |
| 多图输出 | ❌ 一次一张，接口无数量参数 |

## 2. 请求

```
POST https://api-inference.modelscope.cn/v1/images/generations
Authorization: Bearer <MODELSCOPE_TOKEN>
X-ModelScope-Async-Mode: true
```

```json
{
  "model": "Tongyi-MAI/Z-Image-Turbo",
  "prompt": "...",
  "size": "1024x1024"
}
```

参数集合与魔搭其他图像模型完全一致（见 [供应商/魔搭.md](../供应商/魔搭.md) 第 4 节），本模型的差异只有两点：

| 项 | 值 |
|---|---|
| `size` 范围 | **[512×512, 2048×2048]** —— 下限是 512，不是魔搭通用的 64 |
| 魔粒档位 | standard，1 魔粒/次 |

> 已修正：builder 通过 `sizeBounds: { min: 512, max: 2048 }` 下发本模型的边界，通用兜底路径不再可能算出低于 512 的边长。此前 `utils.ts` 对所有模型统一用 `[64, 2048]`。

## 3. 响应

轮询 `GET /v1/tasks/<task_id>`（头 `X-ModelScope-Task-Type: image_generation`）：

```json
{
  "task_status": "SUCCEED",
  "output_images": ["https://..."]
}
```

`task_status` 为 `FAILED` 时任务失败。系统原因导致的失败**全额返还魔粒**。

## 4. 可用性说明

`Tongyi-MAI/Z-Image-Turbo` 在魔搭网页上属于 AIGC 专区 checkpoint，模型页右侧渲染的是「一键生成」面板而不是标准的「推理 API-Inference」板块，**容易被误判为不支持 API 调用**。

实际通过权威接口确认支持：

```
GET https://www.modelscope.cn/api/v1/inference/list_model_providers?ModelId=Tongyi-MAI/Z-Image-Turbo
```

返回的 `Providers` 数组含 standard 档位与魔粒消耗。

## 5. 同一模型的其他供应商

Z-Image Turbo 在本项目还接入了 APIMart、KIE、Fal、百炼。魔搭版是**开源权重自托管推理**，与其他四家的商业 API 版本在以下方面不同：

- 计费是魔粒积分而非货币，日常免费额度约 250 次/天
- 官方明确不保障 SLA、不适合高并发
- 需要绑定阿里云账号并实名认证

适合作为**免费额度补充**或离线场景，不适合作为主力生产通道。

## 6. 适配要点

- 项目默认隐藏的 `seed` 与负面提示词：魔搭两个字段都提供，按约定**不显示、不请求**。
- 尺寸下限 512 必须生效，不能落到魔搭通用下限 64。
- 计价展示不能写成人民币，应体现「1 魔粒/次」。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 模型页 | https://www.modelscope.cn/models/Tongyi-MAI/Z-Image-Turbo | 否 |
| API-Inference 介绍与参数表 | https://www.modelscope.cn/docs/model-service/API-Inference/intro | 否 |
| 可用性判定接口 | https://www.modelscope.cn/api/v1/inference/list_model_providers?ModelId=Tongyi-MAI/Z-Image-Turbo | 否 |
| 魔粒说明 | https://www.modelscope.cn/docs/magicube/intro | 否 |
