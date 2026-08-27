# Nano Banana Pro · Grsai

| 项目 | 内容 |
|---|---|
| 最后更新 | 2026-08-26 |
| 模态 | 图片 |
| 供应商 | Grsai（聚合中转，详见 [Grsai 基础文档](../供应商/Grsai.md)） |
| 平台模型 ID（渠道） | `nano-banana-pro`、`nano-banana-pro-vt`、`nano-banana-pro-cl`、`nano-banana-pro-vip`、`nano-banana-pro-4k-vip` |
| 接口形态 | 提交 `POST /v1/api/generate` + 轮询 `GET /v1/api/result`（新版统一接口，`replyType` 三选一） |
| 文档可见性 | 公开，无需登录 |
| 价格可见性 | 公开，无需登录（dashboard「模型列表」页） |
| 项目当前状态 | 已接入，[catalog/grsai/nano-banana-pro.model.ts](../../../src/catalog/grsai/nano-banana-pro.model.ts)，`canonicalModelId: nano-banana-pro` |

> 与 Nano Banana 2 类似，Pro 也拆成 5 个渠道，价差可达 **10 倍**（`nano-banana-pro` ¥0.09 起 vs `nano-banana-pro-4k-vip` 最高 ¥1.8）。特别之处：`nano-banana-pro` 与 `nano-banana-pro-vt` 的积分消耗、价格区间、支持分辨率**完全相同**，大概率是两条互为备份的后端线路，而不是能力差异——这点与 Nano Banana 2 的 `-lite`/`-fast` 重复现象类似。代码里没有假定二者等价并合并成一个选项，而是把 `vt` 保留为独立渠道（标签标注「备用线路」），接入前的实测仍然有价值，但即使证实等价也只是删掉一个选项，不影响其余实现。

## 1. 请求参数（新版统一接口）

`POST /v1/api/generate`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | 必填 | 五个渠道枚举之一，见下表 |
| `prompt` | string | 必填 | 提示词 |
| `images` | array\<string\> | 可选 | 参考图，base64 或 URL 混填，无需单独上传 |
| `aspectRatio` | string | 可选 | 见 1.1 |
| `imageSize` | string | 可选 | `1K` / `2K` / `4K`，具体渠道支持哪些档见第 2 节表格 |
| `replyType` | string | 可选 | `json` / `stream` / `async` |

### 1.1 `aspectRatio` 取值

通用 11 档：`auto`、`1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`、`5:4`、`4:5`、`21:9`

API 文档把「额外支持 `1:4`/`4:1`/`1:8`/`8:1`」明确标注为「nano-banana-2 系列额外支持」，字面上不包含 Pro 系列——**Pro 系列大概率不支持这四档极端比例，但文档没有反向明确写「Pro 不支持」，接入前需要实测确认**。

## 2. 五个渠道对照

来源：[dashboard 模型列表](https://grsai.com/zh/dashboard/models)（2026-08-26 实测，未登录可见）。价格区间由「积分消耗 × 积分单价区间」得出，下限对应 ¥999 最高档充值套餐（约 5 折），上限对应无优惠单价，详见 [Grsai 基础文档 §5.1](../供应商/Grsai.md)。

| 渠道 | 积分消耗 | 价格区间 | 支持分辨率 | 相对基准倍率 |
|---|---|---|---|---|
| `nano-banana-pro` | 1800/次 | ¥0.09~¥0.18/次 | 1K / 2K / 4K | 1×（基准） |
| `nano-banana-pro-vt` | 1800/次 | ¥0.09~¥0.18/次 | 1K / 2K / 4K | 1×（与基准渠道完全相同，见上方说明） |
| `nano-banana-pro-cl` | 10000/次 | ¥0.5~¥1/次 | 1K | 5.6× |
| `nano-banana-pro-vip` | 10000/次 | ¥0.5~¥1/次 | 1K / 2K | 5.6× |
| `nano-banana-pro-4k-vip` | 18000/次 | ¥0.9~¥1.8/次 | 4K | 10× |

`nano-banana-pro-cl` 与 `nano-banana-pro-vip` 积分消耗和价格区间也完全相同，唯一差异是 `vip` 多支持 2K——即「同价位下 vip 覆盖的分辨率范围更大」，`cl` 目前只保留 1K 档（2026-06-24 公告显示这是调整后的结果，此前 `cl` 支持的分辨率范围更宽，因渠道成本上升被收窄，见第 4 节历史）。

## 3. 响应

结构、状态枚举、结果链接有效期等公共部分见 [Grsai 基础文档](../供应商/Grsai.md) 第 3、8 节，五个渠道共用同一套响应格式，不在本文件重复。

## 4. 价格变动历史（公告原文摘录，供判断渠道稳定性参考）

- 2026-04-14：因 Gemini 官方缩减算力，`cl` 与 `vip` 系渠道被迫更换后端线路，成本上升，两类渠道当日集体涨价
- 2026-05-20：`nano-banana-2`、`nano-banana-pro` 因谷歌大更新算法变动导致调用失败，数小时后修复恢复
- 2026-06-19：香蕉系列 2K/4K 分辨率一度因谷歌官方 BUG 无法出图；同日 `nano-banana-pro-vip` 的 2K/4K 分辨率也单独出现过短暂下线又恢复
- 2026-06-24：「cl 渠道模型」分辨率与价格调整，公告原文点名 `nano-banana-pro-cl` 的分辨率支持范围被收窄（调整后即当前表格里的「仅 1K」）
- 2026-06-28：「cl 渠道模型」二次调价，公告原文「近期风控严峻导致成本骤升……目前仍处于亏损状态」
- 2026-07-10 / 2026-08-11：`nano-banana-pro` 与 `nano-banana-2` 因谷歌官方策略/算法变动，各发生过一次数小时到近一天的整体维护/异常，与渠道无关，是模型家族级别的不稳定

`cl` 渠道半年内经历了「分辨率被收窄」+「两次调价」，是本次调研中稳定性证据最弱的渠道；`vip` 渠道价格与 `cl` 相同但保留了更宽的分辨率范围，更贵的 `4k-vip` 与更便宜的基准渠道都发生过官方级别的整体维护，说明「贵=稳」不是绝对规律，只是 `cl` 渠道在公告里被单独点名调整的次数明显更多。

## 5. 适配要点

- 本项目默认**绝对不显示**：`seed`、负面提示词。五个渠道文档都没有这两个字段。
- 五个渠道共享同一套请求/响应结构，做成模型内的「渠道」下拉：字段名按项目约定走 `sharedFieldText('apiChannel')` 并声明 `role: 'channel'`（统一显示「渠道」），选项文案由模型自定义为「标准 / VT（备用线路）/ CL·1K / VIP / VIP·4K」——项目不约束渠道选项文案。
- 分辨率参数只在「标准/VT/VIP」三个渠道可见，且用 `filterOptions` + `autoSwitch` 联动把 VIP 渠道的可选分辨率收窄到 1K/2K（用户已经选了 4K 时切到 VIP 会自动回退到 2K）；`cl` 与 `4k-vip` 分辨率固定，不显示该控件。
- `cl` 渠道的分辨率支持范围历史上被官方收窄过一次（2026-06-24），代码按当前 dashboard 页面的「仅 1K」实现，不是假定「支持所有分辨率」；后续官方再调整需要同步改 `channelToModel` 映射表。
- Pro 系列的比例下拉只暴露 11 档基础比例，**没有**加入 `1:4`/`4:1`/`1:8`/`8:1` 四档极端比例——文档没有反向明确写「Pro 不支持」，但也没写「支持」，按不确定不暴露处理；确认支持后再补选项比确认不支持后再删选项风险更低。
- `pricing.calculator` 按渠道返回区间上限（无优惠价）：标准/VT ¥0.18，CL·1K/VIP ¥1，VIP·4K ¥1.8。

## 6. 原始链接索引

| 信息 | 链接 | 是否需登录 |
|---|---|---|
| nano-banana 接口（新版统一生成，含全部渠道枚举与比例说明） | https://qmy27nhsd9.apifox.cn/452392911e0 | 否 |
| 异步生成结果查询接口 | https://qmy27nhsd9.apifox.cn/452409577e0 | 否 |
| Nano Banana API 旧版文档 | https://grsai.ai/zh/dashboard/documents/nano-banana | 否 |
| dashboard 模型列表（当前权威价格） | https://grsai.com/zh/dashboard/models | 否 |
| dashboard 公告（渠道调价与模型上下架历史） | https://grsai.com/zh/dashboard/announcements | 否 |
| API Key 管理 | https://grsai.ai/zh/dashboard/api-keys | **是** |
