# Wan 2.6 · 派欧云 PPIO

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 视频 |
| 供应商 | 派欧云 PPIO |
| 平台路由 | `/v3/async/wan2.6-{t2v,i2v,v2v}` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

供应商公共协议见 [供应商/派欧云.md](../供应商/派欧云.md)。

## 1. 能力与价格

**按视频条数计费**（不是按秒），查表如下：

| 变体 | 路由 | 720P | 1080P |
|---|---|---|---|
| 文生视频 | `/v3/async/wan2.6-t2v` | 5s ¥3 / 10s ¥6 / 15s ¥9 | 5s ¥5 / 10s ¥10 / 15s ¥15 |
| 图生视频 | `/v3/async/wan2.6-i2v` | 同上 | 同上 |
| 参考生视频 | `/v3/async/wan2.6-v2v` | 5s ¥3 / 10s ¥6 | 5s ¥5 / 10s ¥10 |

**v2v 只支持 5s 和 10s，没有 15s 档。**

## 2. 请求体结构

Wan 2.6 是**嵌套结构** `{ "input": {...}, "parameters": {...} }`，与 Wan 2.5 相同，与 Wan 2.7 的扁平结构不同。

### `input`

| 变体 | 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|---|
| t2v | `prompt` | string | ✅ | 0–2000 |
| | `audio_url` | string | | |
| | `negative_prompt` | string | | 0–500 |
| i2v | `img_url` | string | ✅ | URL 或 base64 `data:{MIME};base64,{data}`；[360, 2000]px，≤10MB |
| | `prompt` | string | | 0–2000 |
| | `template` | string | | 视频特效模板名 |
| | `audio_url` | string | | |
| | `negative_prompt` | string | | 0–500 |
| v2v | `prompt` | string | ✅ | 0–1500，用 `character1` / `character2` 引用角色 |
| | `reference_urls` | string[] | ✅ | 长度 1–5；图 0–5 张 + 视频 0–3 个，总数 ≤5；视频 1–30 秒 ≤100MB，图 [240, 8000]px ≤20MB |
| | `negative_prompt` | string | | 0–500 |

### `parameters`

| 字段 | 类型 | 默认 | 约束 |
|---|---|---|---|
| `size` | string | `1920*1080` | **仅 t2v 与 v2v**；具体像素值，10 个枚举（720P/1080P 两档） |
| `resolution` | string | `1080P` | **仅 i2v**；枚举 `720P` / `1080P` |
| `duration` | integer | `5` | t2v/i2v 枚举 `5/10/15`；**v2v 只有 `5/10`** |
| `audio` | boolean | `true` | |
| `shot_type` | string | — | 枚举 `single` / `multi`；**t2v/i2v 默认 `multi`，v2v 默认 `single`** |
| `prompt_extend` | boolean | `true` | |
| `watermark` | boolean | `false` | |
| `seed` | integer | — | `[0, 2147483647]` |

`size` 枚举：720P `1280*720` `720*1280` `960*960` `1088*832` `832*1088`；1080P `1920*1080` `1080*1920` `1440*1440` `1632*1248` `1248*1632`

> **t2v/v2v 用 `size`、i2v 用 `resolution`** 是 Wan 家族的通用规律，三个版本都一样，最容易踩坑的地方。

## 3. 上传要求

`img_url`、`audio_url`、`reference_urls` 都以 `_url` / `_urls` 结尾 → 走 **`public-url` 模式**，需要公网 URL，本项目借用 KIE 上传服务。**未配置 KIE API Key 时图生视频与参考生视频不可用。**

文档同时说明 `img_url` 接受 base64 data URL，但本项目的 `ppio-media.ts` 按字段名后缀判定为 `public-url`，不会走内联路径。

## 4. 适配要点

- `shot_type` 的默认值按变体不同（t2v/i2v 是 `multi`，v2v 是 `single`），不能写成统一默认值。
- `duration` 合法集合按变体不同（v2v 无 15s），UI 需按当前模式过滤选项。
- 计价是查表（分辨率 × 时长），不是线性按秒，与 Wan 2.7 完全不同。
- 项目默认隐藏 `seed` 与负面提示词，按约定**不显示、不请求**。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 | https://ppio.com/docs/models/reference-wan2.6-t2v | 否 |
| 图生视频 | https://ppio.com/docs/models/reference-wan2.6-i2v | 否 |
| 参考生视频 | https://ppio.com/docs/models/reference-wan2.6-v2v | 否 |
| 定价页（视频 tab） | https://ppio.com/pricing | 否 |
