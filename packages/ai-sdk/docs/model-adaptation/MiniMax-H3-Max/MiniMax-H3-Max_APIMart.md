# MiniMax H3 Max · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-08 |
| 模态 | 视频 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-minimax-h3-max`（通用标识 `minimax-h3-max`） |
| 平台模型 ID | `MiniMax-H3-Max`（大小写不敏感） |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST /v1/videos/generations` → `data[0].task_id`；请求体 ≤ 64 MB
- 查询：`GET /v1/tasks/{task_id}`，每 5–10 秒，建议超时 15 分钟
- 组合违规（首尾帧与参考素材混用、只传参考音频等）同步返回 400，不建任务、不扣费

## 2. 与 MiniMax-H3 的差异

| 能力 | `MiniMax-H3` | `MiniMax-H3-Max` |
|---|---|---|
| 分辨率 | 2K / 768P | 480P / 768P / 1080P，默认 768P |
| 时长 | 4–15 秒 | 5–15 秒 |
| 首帧 / 尾帧 / 首尾帧 | 支持 | 支持 |
| 中间帧 | 支持 | 不支持 |
| 多模态参考 | 图、视频、音频 | 图（≤ 9）、视频（≤ 3，单段 2–15 秒，总 ≤ 15 秒）、音频（同上，需搭配图或视频） |
| 输入图片费用 | 5 张以内免费 | 2 张以内免费 |
| Regeneration 源任务 | 可以 | 不可以 |

## 3. 请求参数

| 字段 | 取值 | 说明 |
|---|---|---|
| `model` | `MiniMax-H3-Max` | 必填 |
| `prompt` | ≤ 7000 字符 | 任何场景必填 |
| `duration` | 5–15 | 默认 5，不支持 4 |
| `resolution` | `480P` / `768P` / `1080P` | 2K / 1440P / 2048P 返回 400 |
| `aspect_ratio`（或 `size` / `ratio`） | `21:9` `16:9` `4:3` `1:1` `3:4` `9:16`；参考模式另有 `adaptive` | 文生不传或 adaptive 回落 16:9；图生被忽略；参考模式默认 adaptive |
| `first_frame_image` / `last_frame_image` / `image_with_roles` | 公网 URL | 首尾帧各 ≤ 1，可单独传尾帧 |
| `image_urls` | ≤ 9 | 一律作为参考图 |
| `video_urls` / `video_url` | ≤ 3 段 | 提交时读取时长计费，读不到返回 400 |
| `audio_urls` / `audio_url` | ≤ 3 段 | 不能单独使用 |
| `watermark`（`aigc_watermark`） | 默认 false | 1080P 时必须省略；项目不请求 |
| `webhook` | | 项目不请求 |

图片：JPG/JPEG/PNG/WEBP/HEIC/HEIF，≤ 30 MB，宽高 256–5760 px，宽高比 0.4–2.5。视频：MP4/MOV，H.264/H.265，≤ 50 MB，23.976–60 fps。音频：WAV/MP3，≤ 15 MB。

## 4. 价格

来源：[MiniMax H3 Max 模型页](https://apimart.ai/zh/model/minimax-h3-max)（2026-11-07 读取，黄金价 = 当前价）；定价中心起步价 `MiniMax-H3-Max $0.0377/秒` 一致。

| 项目 | 单价 |
|---|---|
| 480P / 768P / 1080P 生成 | $0.03768 / $0.05712 / $0.128 每秒 |
| 参考图片（首尾帧与参考图合计，前 2 张免费） | $0.05712 / 张 |
| 参考视频（按源视频时长）480P / 768P / 1080P | $0.04232 / $0.11088 / $0.11936 每秒 |
| 参考音频 | 免费 |

总费用 = 生成单价 × 时长 + 超额图片单价 × max(0, 输入图片张数 − 2) + 参考视频单价 × 参考视频总时长（API 文档计费说明）。

## 5. 项目适配

- 新建独立模型而不并入 `apimart-minimax-h3`：项目对极速 / Turbo / Fast 档一贯单独建模（Kling 3.0 Turbo、Seedance 2.0 Fast），且两者分辨率、时长、帧控制、免费图片数与参考视频计价都不同，合并会让一个模型同时维护两套互斥的分辨率与计价表。
- `role: 'mode'` 模式：文/图生视频（0 张文生，1 张首帧，2 张首尾帧）与参考生视频。
- 比例默认“智能”：文生发 16:9，图生不发，参考模式发 `adaptive`。
- 不显示、不请求：`watermark`、`webhook`。

- 界面与请求一致（2026-11-08“所选即所发”离线检查）：首帧 / 首尾帧时不发送比例（由图片决定），非参考模式带图时隐藏比例参数。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| API 文档 | https://docs.apimart.ai/cn/api-reference/videos/minimax-h3/max | 否 |
| 模型页（价格） | https://apimart.ai/zh/model/minimax-h3-max | 否 |
| 定价中心（起步价） | https://apimart.ai/zh/pricing | 否 |
