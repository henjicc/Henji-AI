# Wan 2.7 · 派欧云 PPIO

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-30 |
| 模态 | 视频 |
| 供应商 | 派欧云 PPIO |
| 平台路由 | `/v3/async/wan2.7-{t2v,i2v,r2v,videoedit}` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

供应商公共协议见 [供应商/派欧云.md](../供应商/派欧云.md)。

## 1. 能力与价格

| 变体 | 路由 | 价格 |
|---|---|---|
| 文生视频 | `/v3/async/wan2.7-t2v` | 720P ¥0.60/秒；1080P ¥1.00/秒 |
| 图生视频 | `/v3/async/wan2.7-i2v` | 同上 |
| 参考生视频 | `/v3/async/wan2.7-r2v` | 同上 |
| 视频编辑 | `/v3/async/wan2.7-videoedit` | 同上 |

**Wan 2.7 全系按秒计费**，与 Wan 2.5 / 2.6 的按视频条数计费不同。输出默认含音频。

## 2. 请求体结构（与 2.5 / 2.6 不同）

Wan 2.7 是**扁平结构**，没有 `{input, parameters}` 嵌套。Wan 2.5 与 2.6 是嵌套结构。**同家族不同版本不能共用 builder。**

### 文生视频 `wan2.7-t2v`

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `prompt` | string | ✅ | — | 0–1500 |
| `duration` | integer | | `5` | `[2, 15]` |
| `size` | string | | `1920*1080` | 具体像素值，10 个枚举（720P/1080P 两档） |
| `audio_url` | string | | — | wav/mp3，3–30 秒，≤15MB；不传则自动生成配乐/音效 |
| `negative_prompt` | string | | — | 0–500 |
| `seed` | integer | | — | `[0, 2147483647]` |
| `watermark` | boolean | | `false` | |
| `prompt_extend` | boolean | | `true` | |

`size` 枚举：720P `1280*720` `720*1280` `960*960` `1088*832` `832*1088`；1080P `1920*1080` `1080*1920` `1440*1440` `1632*1248` `1248*1632`

### 图生视频 `wan2.7-i2v`

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `image_url` | string | ✅※ | — | 与 `first_clip_url` **二选一至少一个**；[240, 8000]px，宽高比 1:8 ~ 8:1，≤20MB |
| `first_clip_url` | string | ※ | — | 视频续写用，mp4/mov 2–10 秒，[240, 4096]px，≤100MB |
| `last_frame_url` | string | | — | 尾帧 |
| `driving_audio_url` | string | | — | 驱动音频，2–30 秒 ≤15MB，做口型同步 |
| `prompt` | string | | — | 0–**5000**（比 t2v 宽松得多） |
| `duration` | integer | | `5` | `[2, 15]` |
| `resolution` | string | | `1080P` | `720P` / `1080P` |
| `negative_prompt` | string | | — | 0–500 |
| `seed` / `watermark` / `prompt_extend` | | | | 同 t2v |

**注意 i2v 用 `resolution` 而不是 `size`**，这是 Wan 家族的通用规律（t2v 用具体像素的 `size`，i2v 用档位名的 `resolution`）。

### 参考生视频 `wan2.7-r2v`

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `media` | **object[]** | ✅ | — | 长度 1–5，见下 |
| `prompt` | string | ✅ | — | 0–1500，用 `character1` / `character2` 引用角色 |
| `duration` | integer | | `5` | `[2, 10]` |
| `size` | string | | `1920*1080` | 同 t2v |
| `audio` | boolean | | `true` | **影响费用** |
| `shot_type` | string | | `single` | `single` / `multi` |
| `negative_prompt` / `seed` / `watermark` | | | | |

`media` 每一项：

```json
{
  "url": "...",
  "type": "reference_image | reference_video | first_frame",
  "reference_voice": "可选，音色克隆音频 MP3/WAV/FLAC 3-30s"
}
```

数量约束：图片 0–5 个、视频 0–3 个、**总数 ≤ 5**。

### 视频编辑 `wan2.7-videoedit`

| 字段 | 类型 | 必填 | 默认 | 约束 |
|---|---|---|---|---|
| `video_url` | string | ✅ | — | mp4/mov，2–10 秒，[240, 4096]px，≤100MB |
| `prompt` | string | | — | 0–5000，编辑指令 |
| `duration` | integer | | `0` | **`0` = 沿用原视频时长**；范围 `[0, 10]`。此时估价读取宿主探测出的输入视频真实时长。 |
| `resolution` | string | | `1080P` | `720P` / `1080P` |
| `ratio` | string | | — | `16:9` / `9:16` / `1:1` / `4:3` / `3:4`；不传则近似原比例 |
| `audio_setting` | string | | `auto` | `auto` / `origin` |
| `reference_image_url` / `_2` / `_3` | string | | — | 最多 3 张，[240, 8000]px ≤20MB |
| `negative_prompt` / `seed` / `watermark` / `prompt_extend` | | | | |

## 3. 上传要求

本模型几乎所有媒体字段都以 `_url` 结尾（`image_url`、`video_url`、`audio_url`、`first_clip_url`、`last_frame_url`、`driving_audio_url`、`reference_image_url`），r2v 的 `media[].url` 与 `media[].reference_voice` 也在白名单里 → **全部走 `public-url` 模式**，需要公网 URL。

本项目借用 KIE 上传服务实现，因此 **Wan 2.7 的全部图生/参考生/视频编辑能力都依赖用户配置 KIE API Key**，只配 PPIO Key 会直接失败。这是 Wan 2.7 相比其他 PPIO 模型最重的前置依赖。

`upload.ts` 里有针对 `/async/wan2.7-r2v` 的专门预处理（`preprocessPpioWan27ReferenceMediaObject`），按 `media[].type` 判断素材类型再上传。

## 4. 适配要点

- 四个变体的参数集合差异很大（`media` 数组 vs 扁平 URL 字段、`duration` 上限 15/10/10、`size` vs `resolution` vs `ratio`），建议用显式 `mode` 参数而不是自动路由。
- `prompt` 长度上限在四个变体里是 1500 / 5000 / 1500 / 5000，不统一。
- r2v 的 `audio` 字段影响费用，必须接入计价。
- `videoedit` 的 `duration=0` 是有意义的默认值（沿用原时长），不能当成「未设置」处理。SDK 估价优先读取 `__videoDurationSeconds`，其次读取 `__totalVideoDurationSeconds`，并兼容旧字段 `__firstVideoDurationSeconds`；这些仅是运行时计价字段，不进入供应商请求。视频元数据不可读时才使用 5 秒兜底估计。
- 项目默认隐藏 `seed` 与负面提示词，按约定**不显示、不请求**。

## 5. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| 文生视频 | https://ppio.com/docs/models/reference-wan2.7-t2v | 否 |
| 图生视频 | https://ppio.com/docs/models/reference-wan2.7-i2v | 否 |
| 参考生视频 | https://ppio.com/docs/models/reference-wan2.7-r2v | 否 |
| 视频编辑 | https://ppio.com/docs/models/reference-wan2.7-videoedit | 否 |
| 定价页（视频 tab） | https://ppio.com/pricing | 否 |
