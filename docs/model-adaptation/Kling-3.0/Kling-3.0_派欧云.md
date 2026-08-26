# Kling 3.0 · 派欧云 PPIO

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 视频 |
| 供应商 | 派欧云 PPIO（聚合平台） |
| 平台路由 | `/v3/async/kling-v3.0-{std,pro,4k}-{t2v,i2v}` + `/v3/async/kling-v3.0-motion-control` |
| 接口形态 | **异步任务**：提交返回 `task_id`，轮询统一任务接口 |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

供应商公共协议（Base URL、鉴权、轮询、结果解析、上传限制）见 [供应商/派欧云.md](../供应商/派欧云.md)。

## 1. 能力与路由（共 7 条）

| 变体 | 路由 | 静音单价 | 有音频单价 |
|---|---|---|---|
| Standard 文生视频 | `/v3/async/kling-v3.0-std-t2v` | ¥0.60/秒 | ¥0.90/秒 |
| Standard 图生视频 | `/v3/async/kling-v3.0-std-i2v` | ¥0.60/秒 | ¥0.90/秒 |
| Pro 文生视频 | `/v3/async/kling-v3.0-pro-t2v` | ¥0.80/秒 | ¥1.20/秒 |
| Pro 图生视频 | `/v3/async/kling-v3.0-pro-i2v` | ¥0.80/秒 | ¥1.20/秒 |
| 4K 文生视频 | `/v3/async/kling-v3.0-4k-t2v` | ¥3.00/秒 | ¥4.50/秒 |
| 4K 图生视频 | `/v3/async/kling-v3.0-4k-i2v` | ¥3.00/秒 | ¥4.50/秒 |
| 动作控制 | `/v3/async/kling-v3.0-motion-control` | Standard ¥0.90/秒 | Professional ¥1.20/秒 |

### 项目适配状态：7 条路由全部覆盖

`src/models/ppio/kling-3.0.model.ts` 的 `endpoints.selector` 用模板拼路由——按分辨率档位映射 `std`/`pro`/`4k`，按是否上传图片映射 `t2v`/`i2v`，动作控制单独返回固定路由。源码里只有两条字面量路由字符串，容易被 grep 误判为"只接了 2 条"，实际七条都能命中。

`src/models/ppio/kling-3.0.test.ts` 直接跑 manifest 里序列化后的 `selectorJs`，逐条断言 7 种组合的落点。

## 2. 计价（重要）

**按秒计费，且 `sound` 字段直接决定单价档位**——SKU 计价表达式为 `has(body.sound) && body.sound == true`。开启音频比静音**贵 50%**，不是加价项而是换档。

> 代码此前把 4K 写成 ¥2.94/¥4.41、动作控制写成 ¥0.9135/¥1.218，与定价页的 ¥3.0/¥4.5 与 ¥0.9/¥1.2 不符，已修正。Standard 与 Pro 两档原本就是对的。
>
> 动作控制在 `character_orientation=video` 时输出时长跟随参考视频（最长 30 秒），提交前无法得知，计价只能按当前时长参数估算。

计价函数必须同时读取「档位（std/pro/4k）」和「`sound`」两个维度，缺一个就会算错。

动作控制的档位由 `model_name` 字段决定（`kling-v3-0-std` / `kling-v3-0-pro`），与 t2v/i2v 的路由分档方式不同。

## 3. 请求参数

### 文生视频（std / pro / 4k 基本一致）

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `prompt` | string | ✅ | — | 0–2500 字符；Pro/4K 与 `multi_prompt` 互斥 |
| `duration` | integer | | `5` | std 为枚举 `3..15`；pro/4k 为范围 `[3,15]` |
| `cfg_scale` | number | | `0.5` | `[0, 1]` |
| `aspect_ratio` | string | | `16:9` | `16:9` / `9:16` / `1:1` |
| `sound` | boolean | | `false` | **影响单价档位** |
| `negative_prompt` | string | | — | ≤ 2500 |
| `multi_prompt` | string[] | | — | 仅 Pro t2v；多镜头，与 `prompt` 互斥 |

### 图生视频（std / pro / 4k）

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `image` | string | ✅ | — | jpg/jpeg/png，≤10MB，宽高均 ≥300px，宽高比 1:2.5 ~ 2.5:1 |
| `prompt` | string | ✅ | — | ≤ 2500 |
| `duration` | integer | | `5` | 同 t2v |
| `cfg_scale` | number | | `0.5` | `[0, 1]` |
| `sound` | boolean | | `false` | **影响单价档位** |
| `negative_prompt` | string | | — | ≤ 2500 |
| `end_image` | string | | — | 尾帧，约束同 `image`，**与 `multi_prompt` 互斥** |
| `multi_prompt` | — | | — | **类型按档位不同，见下** |

**i2v 没有 `aspect_ratio` 字段**（比例由输入图决定）。

#### `multi_prompt` 在 i2v 各档位类型不一致

| 档位 | 类型 |
|---|---|
| std-i2v、4k-i2v | **object[]**：`{ prompt: string 必填, duration: integer 默认 5, 范围 [3,15] }` |
| pro-i2v | **string[]** |

同一个字段名在同一模型的不同档位下结构不同，builder 必须按档位分支处理。

### 动作控制

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `image` | string | ✅ | — | ≤10MB，宽高 ≥300px |
| `video` | string | ✅ | — | mp4/mov，≤10MB，3–30 秒 |
| `model_name` | string | ✅ | `kling-v3-0-std` | `kling-v3-0-std` / `kling-v3-0-pro`，**决定单价** |
| `character_orientation` | string | ✅ | — | `image`（输出固定 5 秒）/ `video`（时长同参考视频，最长 30 秒） |
| `prompt` | string | | — | ≤ 2500 |
| `negative_prompt` | string | | — | ≤ 2500 |
| `keep_original_sound` | boolean | | `true` | |

## 4. 上传要求

动作控制的 `video` 字段是视频素材 → 按 [供应商/派欧云.md](../供应商/派欧云.md) 第 2 节的规则走 **`public-url` 模式**，需要公网 URL，本项目借用 KIE 上传服务。**用户未配置 KIE API Key 时该功能不可用。**

i2v 的 `image` 与 `end_image` 字段名不以 `_url` 结尾，按默认 `data-uri` 模式内联，不依赖 KIE。但 `ppio-media.ts` 里对 `/async/kling-v3.0-4k-i2v` 和 `/async/kling-v3.0-motion-control` 的 `image` 字段有 `public-url` 白名单覆盖——接入 4K i2v 时需要注意这个例外。

## 5. 适配要点

- 三个档位（std/pro/4k）+ 两种输入（t2v/i2v）建议按项目规范合并为**一个产品入口**，用顶层参数切换档位，由是否上传图片自动路由 t2v/i2v；动作控制因为输入素材、参数集合和输出约束都明显不同，可以保留为独立 mode。
- `sound` 必须暴露给用户并接入计价，不能当成隐藏默认值——它是 50% 的价格差。
- `duration` 在 std 是枚举、在 pro/4k 是范围，UI 上统一成同一个控件时要注意合法值集合按档位变化。
- 项目默认隐藏 `seed` 与负面提示词：本模型有 `negative_prompt`，按约定**不显示、不请求**。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Standard 文生视频 | https://ppio.com/docs/models/reference-kling-v3.0-std-t2v | 否 |
| Standard 图生视频 | https://ppio.com/docs/models/reference-kling-v3.0-std-i2v | 否 |
| Pro 文生视频 | https://ppio.com/docs/models/reference-kling-v3.0-pro-t2v | 否 |
| Pro 图生视频 | https://ppio.com/docs/models/reference-kling-v3.0-pro-i2v | 否 |
| 4K 文生视频 | https://ppio.com/docs/models/reference-kling-v3.0-4k-t2v | 否 |
| 4K 图生视频 | https://ppio.com/docs/models/reference-kling-v3.0-4k-i2v | 否 |
| 动作控制 | https://ppio.com/docs/models/reference-kling-v3.0-motion-control | 否 |
| 定价页（视频 tab 搜 Kling 3.0） | https://ppio.com/pricing | 否 |
