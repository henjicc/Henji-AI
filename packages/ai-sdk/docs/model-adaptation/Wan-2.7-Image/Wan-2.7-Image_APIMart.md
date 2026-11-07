# Wan 2.7 Image · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-11-08 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 项目模型 ID | `apimart-wan-2.7-image`（通用标识 `wan-2.7-image`；仓库内其他供应商暂无此模型） |
| 供应商展示名 | wan2.7-image / wan2.7-image-pro（模型页 `/zh/model/wan-2-7-image`、`/zh/model/wan-2-7-image-pro`） |
| 平台模型 ID | `wan2.7-image`（标准版）、`wan2.7-image-pro`（Pro） |
| 接口形态 | 异步任务 |
| 文档 / 价格可见性 | 公开，无需登录 |

## 1. 接入协议

- 提交：`POST https://api.apimart.ai/v1/images/generations`，`Authorization: Bearer <key>`。
- 提交响应（官方示例）：`{"code":"success","data":[{"task_id":"task_01HX...","status":"processing"}]}`，取 `data[0].task_id`。
- 查询：`GET /v1/tasks/{task_id}`，轮询到 `status == completed`；结果在 `data.result.images[].url[]`（APIMart 公共协议，见 `供应商/APIMart.md`）。
- 错误：400 参数无效、401 鉴权失败、402 余额不足、429 频率限制、500 服务端错误，错误体 `{error:{code,message,type}}`。

## 2. 能力

文生图、图像编辑（传 `image_urls` 自动进入编辑模式）、多图参考（≤ 9 张）、组图（`enable_sequential`，一次生成风格一致的一组图）、交互式框选编辑（`bbox_list`）。

| 版本 | 文生图最高分辨率 | 编辑 / 组图最高分辨率 |
|---|---|---|
| `wan2.7-image-pro` | 4K | 2K |
| `wan2.7-image` | 2K | 2K |

## 3. 请求参数

| 字段 | 类型 / 取值 | 说明 |
|---|---|---|
| `model` | 必填，`wan2.7-image` / `wan2.7-image-pro` | |
| `prompt` | string，≤ 5000 字符 | 文生图必填；编辑模式可选 |
| `image_urls` | string[]，≤ 9 张 | HTTP(S) 或 `data:image/...;base64`；JPEG/PNG/WEBP/BMP，边长 240–8000 px，宽高比 1:8–8:1，单张 ≤ 20MB；传图后输出比例跟随**最后一张**输入图，编辑模式最高 2K |
| `n` | integer，默认 1 | 非组图 1–4；组图 1–12；按成功张数计费，提交时按 `n` 预扣 |
| `size` | string | 档位 `1K`/`2K`(默认)/`4K`，或比例 `1:1` `16:9` `9:16` `4:3` `3:4` `3:2` `2:3`（按 2K 换算），或像素 `1024x1024` |
| `resolution` | `1K` / `2K` / `4K` | 可与 `size`（比例）配合；4K 仅 Pro 非组图文生图；像素范围标准版与 Pro 编辑/组图 768²–2048²，Pro 文生图 768²–4096² |
| `enable_sequential` | boolean，默认 false | 组图模式；开启后 `thinking_mode`、`color_palette` 不生效，Pro 组图最高 2K |
| `thinking_mode` | boolean，默认 true | 仅非组图且无输入图时生效 |
| `negative_prompt` | string | |
| `watermark` | boolean，默认 false | 右下角“AI 生成”水印 |
| `seed` | 0–2147483647 | |
| `bbox_list` | `[[[x1,y1,x2,y2],...],...]` | 外层长度等于 `image_urls`；无框选的图传 `[]`；每张最多 2 个框，原图绝对像素 |
| `color_palette` | `[{hex,ratio}]`，3–10 项 | 仅非组图；ratio 之和须为 100.00% |
| `nsfw_check` | boolean，默认 false | APIMart provider 统一强制 `false` |

## 4. 价格

来源：模型页价格表（2026-11-07 读取，“黄金价 = 当前价格”）；定价中心图像区同值。

| 平台模型 ID | 当前价（黄金） | 铂金 | 钻石 | 官方价 |
|---|---|---|---|---|
| `wan2.7-image` | **$0.0216 / 张** | $0.0205 | $0.0194 | $0.027 |
| `wan2.7-image-pro` | **$0.0544 / 张** | $0.0517 | $0.049 | $0.068 |

- 按成功生成张数 × 单价计费，输入图不计费，与分辨率、比例无关；失败不扣费。
- **冲突记录**：API 文档正文写 `¥0.20 / 张`、`¥0.50 / 张`（人民币标注），与模型页美元价不一致；按「模型专属页 > 实时价格页 > API 文档正文」取模型页美元价。

## 5. 项目适配

- 一个产品模型：版本（标准 / Pro）`role: 'mode'`，两版共用比例、分辨率、数量与组图参数。
- 比例默认“智能”：无图时发具体比例（智能回退 `1:1`）到 `size`；有图时不发比例（平台跟随最后一张图）。分辨率发 `resolution`。
- 4K 只在 Pro + 非组图 + 无输入图时可选（展示联动裁剪菜单并重置；builder 同时拒绝非法组合）。
- 数量非组图 1–4、组图 1–12；关闭组图时数量超过 4 自动回到 4。
- 不显示、不请求：`seed`、`negative_prompt`、`watermark`（平台默认 false）、`thinking_mode`（用平台默认 true）、`nsfw_check`（provider 强制 false）。
- 暂不接：`bbox_list` 框选编辑（需要应用内派生媒体编辑器）、`color_palette`。

- 界面与请求一致（2026-11-08“所选即所发”离线检查）：有输入图时平台按最后一张图定比例、不发送 size，比例参数在带图时隐藏。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| API 文档（中文） | https://docs.apimart.ai/cn/api-reference/images/wan2.7-image/generation | 否 |
| API 文档（英文） | https://docs.apimart.ai/en/api-reference/images/wan2.7-image/generation | 否 |
| 任务查询 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 标准版模型页（价格表） | https://apimart.ai/zh/model/wan-2-7-image | 否 |
| Pro 模型页（价格表） | https://apimart.ai/zh/model/wan-2-7-image-pro | 否 |
| 定价中心 | https://apimart.ai/zh/pricing | 否 |
