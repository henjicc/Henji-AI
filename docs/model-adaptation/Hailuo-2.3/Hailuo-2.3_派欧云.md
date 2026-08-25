# MiniMax Hailuo 2.3 · 派欧云 PPIO

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 视频 |
| 供应商 | 派欧云 PPIO |
| 平台路由 | `/v3/async/minimax-hailuo-2.3-{t2v,i2v,fast-i2v}` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

供应商公共协议见 [供应商/派欧云.md](../供应商/派欧云.md)。

## 1. 能力与价格

**按视频条数计费**：

| 变体 | 路由 | 6s/768P | 10s/768P | 6s/1080P |
|---|---|---|---|---|
| 文生视频 | `/v3/async/minimax-hailuo-2.3-t2v` | ¥2 | ¥4 | ¥3.5 |
| 图生视频 | `/v3/async/minimax-hailuo-2.3-i2v` | ¥2 | ¥4 | ¥3.5 |
| **Fast** 图生视频 | `/v3/async/minimax-hailuo-2.3-fast-i2v` | ¥1.35 | ¥2.25 | ¥2.3 |

**10 秒档只支持 768P，没有 10s/1080P 组合。** Fast 模式只有图生视频，没有文生视频。

## 2. 请求参数

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `prompt` | string | ✅ | — | 1–2000，**支持运镜指令，见下** |
| `image` | string | ✅（i2v / fast-i2v） | — | 公网 URL 或 `data:image/jpeg;base64,...` |
| `duration` | integer | | `6` | 枚举 `6` / `10` |
| `resolution` | string | | `768P` | **6s 支持 `768P`/`1080P`；10s 仅 `768P`** |
| `enable_prompt_expansion` | boolean | | `true` | |
| `fast_pretreatment` | boolean | | `false` | **fast-i2v 变体没有这个字段** |
| `aigc_watermark` | boolean | | `false` | |

### 运镜指令（写在 prompt 里）

t2v 与 i2v 的 `prompt` 支持 15 种方括号运镜指令：

```
[左移] [右移] [左摇] [右摇] [推进] [拉远] [上升] [下降]
[上摇] [下摇] [变焦推近] [变焦拉远] [晃动] [跟随] [固定]
```

同一组 `[]` 内组合建议 ≤ 3 个。

> **fast-i2v 的文档里没有写运镜指令说明**，且没有 `fast_pretreatment` 字段——接入时不要假设 fast 变体与标准变体完全等价。

## 3. 上传要求

`image` 字段名不以 `_url` 结尾 → 走默认 **`data-uri` 模式**内联，**不依赖 KIE API Key**。这是 PPIO 视频模型里少见的无外部依赖的情况。

## 4. 适配要点

- `resolution` 与 `duration` 有互斥约束（10s 不能选 1080P），需要用 linkage 的 `filterOptions` + `autoSwitch` 表达，不能只在 builder 里静默回落。
- Fast 模式只在图生视频下存在，文生视频时该开关应隐藏。
- 计价维度是 `duration × resolution × 是否 fast`，三个维度都要读。
- 项目默认隐藏 `seed` 与负面提示词：本模型接口**没有**这两个字段，无需处理。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 | https://ppio.com/docs/models/reference-minimax-hailuo-2.3-t2v | 否 |
| 图生视频 | https://ppio.com/docs/models/reference-minimax-hailuo-2.3-i2v | 否 |
| Fast 图生视频 | https://ppio.com/docs/models/reference-minimax-hailuo-2.3-fast-i2v | 否 |
| 定价页（视频 tab） | https://ppio.com/pricing | 否 |
