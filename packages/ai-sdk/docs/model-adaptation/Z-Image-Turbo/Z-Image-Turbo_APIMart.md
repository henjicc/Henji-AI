# Z-Image Turbo · APIMart

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-22 |
| 模态 | 图片 |
| 供应商 | APIMart（聚合平台） |
| 平台模型 ID | `z-image-turbo` |
| 接口形态 | **异步任务** |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录 |

| 模型名 | 说明 | 生成张数 | 计费方式 |
|---|---|---|---|
| `z-image-turbo` | 轻量快速图片生成，支持中英双语 | **固定 1 张** | 固定价格 |

## 1. 接入协议

- **Base URL**：`https://api.apimart.ai`
- **鉴权**：`Authorization: Bearer <API_KEY>`
- **提交**：`POST /v1/images/generations` → `{ code, data: [{ status: "submitted", task_id }] }`
- **查询**：`GET /v1/tasks/{task_id}`，读 `result.images`
- **结果存储**：图片已镜像到平台 CDN，文档称**长期有效**
- **计费规则**：按成功生成的图片张数计费，失败不扣费

## 2. 能力清单

仅**文生图**。APIMart 上 Z-Image-Turbo **没有参考图 / 图生图参数**。

## 3. 请求参数（Body）

| 字段 | 类型 | 必填 | 默认 | 取值与说明 |
|---|---|---|---|---|
| `model` | string | 必填 | — | `z-image-turbo` |
| `prompt` | string | 必填 | — | **最多 800 字符** |
| `size` | string | 可选 | `1:1` | 宽高比：`1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`3:2`、`2:3`（共 7 个，**没有 21:9 / 7:9 / 9:21**） |
| `resolution` | string | 可选 | `1K` | `1K` / `2K` |
| `prompt_extend` | boolean | 可选 | `false` | 智能改写提示词。开启后效果更好，**费用会增加** |
| `nsfw_check` | boolean | 可选 | `false` | `true` 时用 `omni-moderation-latest` 预审提示词与输入图 |

**不支持 `n` 参数**——固定每次 1 张。

### 尺寸对照表

| 比例 | 1K | 2K |
|---|---|---|
| 1:1 | 1024×1024 | 2048×2048 |
| 4:3 | 1152×864 | 2048×1536 |
| 3:4 | 864×1152 | 1536×2048 |
| 16:9 | 1280×720 | 2048×1152 |
| 9:16 | 720×1280 | 1152×2048 |
| 3:2 | 1248×832 | 2048×1360 |
| 2:3 | 832×1248 | 1360×2048 |

> 官方百炼是按「总像素档 + 精确 `宽*高`」控制，APIMart 换成了「比例 + 1K/2K 档位」，两边的可选集合不一样。

## 4. 响应结构

提交返回 `task_id`；轮询 `GET /v1/tasks/{task_id}`，`status=completed` 后读 `result.images[].url`（数组）。

## 5. 价格

来源：[APIMart 定价中心](https://apimart.ai/zh/pricing)（2026-08-22 读取，1 Credit ≈ $0.1）。

| 规格 | 我们的价格 | 官方价 | 节省 |
|---|---|---|---|
| 默认 | 0.1 Credits/张 ≈ **$0.01/张** | $0.0125/张 | 20% |
| `prompt_extend` | 0.2 Credits/张 ≈ **$0.02/张** | $0.025/张 | 20% |

> 与百炼官方一致：开启 `prompt_extend` 后价格翻倍。

## 6. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。APIMart 本接口两个字段都没有。
- `prompt_extend` **翻倍计费**，需谨慎默认（APIMart 默认 `false`，与百炼默认一致）。
- 固定 1 张，UI 不要出现数量选择。
- 比例集合只有 7 个，比百炼官方（11 个）少；不要把 21:9 之类的比例透出到这个供应商。
- 提示词硬上限 800 字符。

## 7. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| Z-Image-Turbo 图像生成 API | https://docs.apimart.ai/cn/api-reference/images/z-image-turbo/generation | 否 |
| 同页纯 Markdown | https://docs.apimart.ai/cn/api-reference/images/z-image-turbo/generation.md | 否 |
| 获取任务状态 | https://docs.apimart.ai/cn/api-reference/tasks/status | 否 |
| 定价中心（搜 Z-IMAGE-TURBO） | https://apimart.ai/zh/pricing | 否 |
| API Key 管理 | https://apimart.ai/keys | **是** |
