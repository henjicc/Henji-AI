# Wan 2.5 Preview · 派欧云 PPIO

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 视频 |
| 供应商 | 派欧云 PPIO |
| 平台路由 | `/v3/async/wan-2.5-t2v-preview`、`/v3/async/wan-2.5-i2v-preview` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |
| 调用前提 | ⚠️ **需要个人或企业实名认证** |

供应商公共协议见 [供应商/派欧云.md](../供应商/派欧云.md)。

## 1. 能力与价格

**按视频条数计费**：

| 分辨率 | 5 秒 | 10 秒 |
|---|---|---|
| 480P | ¥1.5 | ¥3 |
| 720P | ¥3 | ¥6 |
| 1080P | ¥5 | ¥10 |

文生视频与图生视频同价。

## 2. 请求体结构

嵌套结构 `{ "input": {...}, "parameters": {...} }`。

### `input`

| 变体 | 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|---|
| t2v | `prompt` | string | ✅ | ≤ 2000 |
| | `negative_prompt` | string | | ≤ 500 |
| | `audio_url` | string | | wav/mp3，3–30 秒，≤15MB |
| i2v | `img_url` | string | ✅ | JPEG/JPG/PNG（**不支持带透明通道**）/BMP/WEBP；宽高 [360, 2000]px；≤10MB |
| | `prompt` | string | | ≤ 2000 |
| | `negative_prompt` | string | | ≤ 500 |
| | `audio_url` | string | | 同上 |

### `parameters`

| 字段 | 类型 | 默认 | 约束 |
|---|---|---|---|
| `size` | string | `1920*1080` | **仅 t2v**；必须填具体像素，不接受档位名或比例 |
| `resolution` | string | `1080P` | **仅 i2v**；枚举 `480P` / `720P` / `1080P` |
| `duration` | integer | `5` | 枚举 `5` / `10` |
| `prompt_extend` | boolean | `true` | |
| `watermark` | boolean | `false` | |
| `audio` | boolean | `true` | **优先级：`audio_url` > `audio`** |
| `seed` | integer | — | `[0, 2147483647]` |

`size` 合法值（13 个，三档）：

- 480P：`832*480` `480*832` `624*624`
- 720P：`1280*720` `720*1280` `960*960` `1088*832` `832*1088`
- 1080P：`1920*1080` `1080*1920` `1440*1440` `1632*1248` `1248*1632`

> **官方默认是 1080P**（`size` 默认 `1920*1080`、`resolution` 默认 `1080P`）。项目当前 `wan-2.5-preview.model.ts` 的默认值是 720P（`DEFAULT_WAN25_SIZE='1280*720'`、`DEFAULT_WAN25_RESOLUTION='720P'`），比官方默认低一档。这不是错误，但用户不主动切换时看到的预估价会比官方默认低，需要确认是有意的省钱默认值还是遗漏。

## 3. 上传要求

`img_url` 与 `audio_url` 都以 `_url` 结尾 → 走 **`public-url` 模式**，需要公网 URL，本项目借用 KIE 上传服务。**未配置 KIE API Key 时图生视频不可用。**

## 4. 适配要点

- **实名认证是硬前提**，未认证用户调用会直接失败，且这个限制不体现在错误码文档里。产品侧需要有对应的错误提示引导。
- t2v 用 `size`（具体像素）、i2v 用 `resolution`（档位名），计价函数需要按当前模式读不同字段再归档。
- 计价是查表（分辨率 × 时长），不是按秒线性。
- `audio_url` 存在时会覆盖 `audio` 开关。
- 项目默认隐藏 `seed` 与负面提示词，按约定**不显示、不请求**。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 | https://ppio.com/docs/models/reference-wan-2.5-t2v-preview | 否 |
| 图生视频 | https://ppio.com/docs/models/reference-wan-2.5-i2v-preview | 否 |
| 定价页（视频 tab） | https://ppio.com/pricing | 否 |
