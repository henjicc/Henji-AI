# Nano Banana 2 · Grsai

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 图片 |
| 供应商 | Grsai（聚合中转，详见 [Grsai 基础文档](../供应商/Grsai.md)） |
| 平台模型 ID（渠道） | `nano-banana-2`、`nano-banana-2-cl`、`nano-banana-2-2k-cl`、`nano-banana-2-4k-cl` |
| 接口形态 | 提交 `POST /v1/api/generate` + 轮询 `GET /v1/api/result`（新版统一接口，`replyType` 三选一） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录（dashboard「模型列表」页） |
| 项目当前状态 | 仅完成调研文档，未接入代码 |

> Grsai 上 Nano Banana 2 家族在 dashboard 里共有 6 个平台模型名，但其中 `nano-banana-2-lite` 与 `nano-banana-fast` 是**独立产品「Nano Banana 2 Lite」的渠道**，已拆到 [Nano-Banana-2-Lite_Grsai.md](../Nano-Banana-2-Lite/Nano-Banana-2-Lite_Grsai.md)（与 APIMart / KIE 两家供应商把 Lite 当独立模型的处理方式保持一致）。本文件只覆盖 Nano Banana 2 主模型的 **4 个渠道**：官方渠道级价差可达约 **10.8 倍**（`nano-banana-2` ¥0.06 起 vs `nano-banana-2-4k-cl` 最高 ¥1.3），越贵的 `cl` 系渠道换来更高分辨率与官方公告里暗示的更好稳定性；`cl` 渠道历史上出现过两次专门针对它的调价（见第 4 节），侧面印证「cl 渠道更便宜但更容易被上游限流/降级」的说法。适配时建议做成模型内的「渠道」参数，而不是拆成 4 个模型卡片。

## 1. 请求参数（新版统一接口）

`POST /v1/api/generate`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 必填 | 四个渠道枚举之一，见下表 |
| `prompt` | string | 必填 | 提示词 |
| `images` | array\<string\> | 可选 | 参考图，base64 或 URL 混填，无需单独上传 |
| `aspectRatio` | string | 可选 | 见 1.1 |
| `imageSize` | string | 可选 | `1K` / `2K` / `4K`，具体渠道支持哪些档见第 2 节表格 |
| `replyType` | string | 可选 | `json` / `stream` / `async` |

### 1.1 `aspectRatio` 取值

通用 11 档：`auto`、`1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`、`5:4`、`4:5`、`21:9`

**Nano Banana 2 系列额外支持极端比例**：`1:4`、`4:1`、`1:8`、`8:1`（API 文档原文特别标注这四档是「nano-banana-2 系列额外支持」，未注明是否四个渠道全部适用，接入前需逐渠道实测）。

## 2. 四个渠道对照

来源：[dashboard 模型列表](https://grsai.com/zh/dashboard/models)（2026-08-26 实测，未登录可见）。价格区间由「积分消耗 × 积分单价区间」得出，下限对应 ¥999 最高档充值套餐（约 5 折），上限对应无优惠单价，详见 [Grsai 基础文档 §5.1](../供应商/Grsai.md)。

| 渠道 | 积分消耗 | 价格区间 | 支持分辨率 | 相对基准倍率 |
|---|---|---|---|---|
| `nano-banana-2` | 1200/次 | ¥0.06~¥0.12/次 | 1K / 2K / 4K | 1×（基准） |
| `nano-banana-2-cl` | 6000/次 | ¥0.3~¥0.6/次 | 1K | 5× |
| `nano-banana-2-2k-cl` | 9000/次 | ¥0.45~¥0.9/次 | 2K | 7.5× |
| `nano-banana-2-4k-cl` | 13000/次 | ¥0.65~¥1.3/次 | 4K | 10.8× |

更便宜的 Lite 定位渠道（`nano-banana-2-lite`、`nano-banana-fast`）属于独立产品「Nano Banana 2 Lite」，见 [Nano-Banana-2-Lite_Grsai.md](../Nano-Banana-2-Lite/Nano-Banana-2-Lite_Grsai.md)。

## 3. 响应

结构、状态枚举、结果链接有效期等公共部分见 [Grsai 基础文档](../供应商/Grsai.md) 第 3、7 节，四个渠道共用同一套响应格式，不在本文件重复。

## 4. 价格变动历史（公告原文摘录，供判断渠道稳定性参考）

- 2026-04-14：因 Gemini 官方缩减算力，`cl` 与 `vip` 系渠道被迫更换后端线路，成本上升，两类渠道当日集体涨价
- 2026-06-19：香蕉系列 2K/4K 分辨率一度因谷歌官方 BUG 无法出图，1K 分辨率不受影响，同日恢复
- 2026-06-24：「cl 渠道模型」分辨率与价格调整——`nano-banana-pro-cl` 支持分辨率范围收窄（详情见 [Nano Banana Pro 文档](../Nano-Banana-Pro/Nano-Banana-Pro_Grsai.md)）
- 2026-06-28：「cl 渠道模型」**二次调价**，公告原文「近期风控严峻导致成本骤升……目前仍处于亏损状态」
- 2026-07-01：谷歌官方下架 `gemini-2.5-flash-image`（香蕉 1），Grsai 下架旧版 `nano-banana`，`nano-banana-fast` 切换底层模型
- 2026-07-10 / 2026-08-11：`nano-banana-2` 与 `nano-banana-pro` 因谷歌官方策略/算法变动，各发生过一次数小时到近一天的整体维护/异常，与渠道无关，是模型家族级别的不稳定

`cl` 系渠道在半年内至少经历两次专门针对它的调价，且调价原因都指向「上游限流/成本上升」，与用户描述的「渠道便宜但不稳定」一致；主渠道（`nano-banana-2`）本身也发生过因谷歌官方变动导致的全家族级维护，说明不稳定风险不完全集中在便宜渠道上。

## 5. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。四个渠道文档都没有这两个字段。
- 四个渠道共享同一套请求/响应结构，只有 `model` 枚举值、可选分辨率档位、价格不同，适合做成一个模型内的「渠道」下拉，而不是拆成 4 张模型卡片；但当前项目的渠道文案约定（`sharedOptionText('regular' | 'official')`）只覆盖两档，这里有 4 个渠道，需要先跟用户确认渠道选项的文案与数量如何呈现，再写 schema。
- `nano-banana-2-lite`、`nano-banana-fast` 属于独立产品「Nano Banana 2 Lite」，不要并入本模型的渠道列表，适配要点见 [Nano-Banana-2-Lite_Grsai.md](../Nano-Banana-2-Lite/Nano-Banana-2-Lite_Grsai.md)。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| nano-banana 接口（新版统一生成，含全部渠道枚举与比例说明） | https://qmy27nhsd9.apifox.cn/452392911e0 | 否 |
| 异步生成结果查询接口 | https://qmy27nhsd9.apifox.cn/452409577e0 | 否 |
| Nano Banana API 旧版文档 | https://grsai.ai/zh/dashboard/documents/nano-banana | 否 |
| dashboard 模型列表（当前权威价格） | https://grsai.com/zh/dashboard/models | 否 |
| dashboard 公告（渠道调价与模型上下架历史） | https://grsai.com/zh/dashboard/announcements | 否 |
| API Key 管理 | https://grsai.ai/zh/dashboard/api-keys | **是** |
