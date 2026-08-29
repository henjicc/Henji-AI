# 全景节点修正：GPT Image 2 渠道契约审计交接

## 1. 审计边界与结论

- 审计日期：2026-08-29
- 审计范围：GPT Image 2 的四个现有接入（APIMart、KIE、Fal、Grsai），包括仓库内官方资料、SDK schema、请求构建、计价、展示补丁，以及画布全景能力的参数映射与提交前收口。
- 本次仅做静态审计和非付费测试，没有修改业务代码，也没有发起真实生成。
- 资料口径：依照项目规则，以 `packages/ai-sdk/docs/model-adaptation/` 中已经归档的一手资料为当前唯一模型事实来源；本次没有用网页二手信息覆盖仓库事实。

核心结论：全景节点应继续复用 `GenerationNodeShell`，把 **2:1、单张输出、最多一张参考图和等距柱状投影提示词**设为不可修改的固定契约；把 **渠道、分辨率、质量**改为 schema 驱动的可见参数，其中不支持质量的渠道不显示质量项。当前代码已经有“全景能力策略 + 版本化提示词 + 提交前参数覆盖”的预置机制，但它把 `2K` 和 `medium` 也设成了每次提交强制覆盖值，所以尚不能直接开放分辨率和质量。

## 2. 当前真实实现

### 2.1 模型与资料位置

| 渠道 | SDK 运行时定义 | 仓库内一手资料 | 展示补丁 |
|---|---|---|---|
| APIMart EXT / 官方 | `packages/ai-sdk/src/catalog/apimart/gpt-image-2.model.ts` | `packages/ai-sdk/docs/model-adaptation/GPT-Image-2/GPT-Image-2_APIMart.md` | `src/models/presentation/apimart/part-1.ts` |
| KIE | `packages/ai-sdk/src/catalog/kie/gpt-image-2.model.ts` | `packages/ai-sdk/docs/model-adaptation/GPT-Image-2/GPT-Image-2_KIE.md` | `src/models/presentation/kie/part-1.ts` |
| Fal | `packages/ai-sdk/src/catalog/fal/gpt-image-2.model.ts`、`packages/ai-sdk/src/catalog/fal/imageSizing.ts` | `packages/ai-sdk/docs/model-adaptation/GPT-Image-2/GPT-Image-2_Fal.md` | `src/models/presentation/fal/part-1.ts` |
| Grsai 标准 / VIP | `packages/ai-sdk/src/catalog/grsai/gpt-image-2.model.ts` | `packages/ai-sdk/docs/model-adaptation/GPT-Image-2/GPT-Image-2_Grsai.md` | `src/models/presentation/grsai.ts` |

四个模型都归一到 `canonicalModelId: 'gpt-image-2'`。APIMart 与 Grsai 在单一模型 schema 内提供渠道参数，展示层已经把它们声明为 `role: 'channel'`；KIE 和 Fal 是独立供应商模型，没有内部渠道参数。

### 2.2 全景预置和覆盖链路

当前已有真实可用的全景预置机制，但名称不是 `PanoramaPreset`：

1. `src/features/canvas/capabilities/panoramaPolicy.ts`
   - `PANORAMA_MODEL_POLICY` 限定 GPT Image 2 家族、已验证供应商/渠道和固定语义。
   - `PANORAMA_PROMPT_POLICY` 保存文字生成/参考图生成的版本化隐藏提示词与固定语义快照。
2. `src/features/canvas/capabilities/modelCompatibility.ts`
   - `mapCanvasCapabilityModelParams` 把 2:1、2K、medium、单张等跨供应商语义映射成模型真实参数；找不到精确合法值时返回不可用原因。
3. `src/features/canvas/capabilities/generationPreparation.ts`
   - `prepareCanvasCapabilityGeneration` 在连线参数已经合并后再次映射固定语义，因此当前 2:1 等约束不能被连线或旧数据覆盖。
   - 同时写入 `generationFixedSemanticParams`、实际模型、映射参数和提示词模板版本，便于结果追踪。
4. `src/features/canvas/nodes/shared/GenerationNodeShell.tsx`
   - 节点创建、模型切换、提交前校验都走上述统一准备函数。
5. `src/features/canvas/domain/nodeMigrations.ts`
   - 保存重开时会重新规范化全景参数和固定语义。

当前缺口：`PANORAMA_MODEL_POLICY.semanticRequirements` 把 `resolution: '2K'`、`quality: 'medium'` 与真正不可变的 2:1 混在同一层；提交时会覆盖用户保存的分辨率/质量。`PANORAMA_PROMPT_POLICY.visibleParameterKeys` 目前只有 `prompt`，因此 schema 参数行全部隐藏。换言之，现有机制适合“固定 2K/medium 的首版”，还没有“固定比例 + 可编辑分辨率/质量”的默认值与固定值分层。

## 3. 各渠道原生契约矩阵

以下“原生支持”指仓库内一手资料和当前请求构建共同确认；没有精确像素资料时不推测。

| 渠道 | 2:1 可选规格 | 质量参数 | 请求映射 | 当前价格显示 | 全景节点注意点 |
|---|---|---|---|---|---|
| APIMart EXT | 1K：`2048×1024` 或平台历史变体 `1774×887`；2K：`2688×1344`；4K：`3840×1920` | 不支持 | `size: '2:1'`、`resolution: '1k'/'2k'/'4k'`、固定 `n: 1` | 1K `$0.0085`、2K `$0.014`、4K `$0.021`/张 | 显示渠道与分辨率；必须隐藏质量、背景、蒙版和数量 |
| APIMart 官方 | 1K：`2048×1024`；2K：`2688×1344`；4K：`3840×1920` | `auto/low/medium/high` | `model: 'gpt-image-2-official'`，比例与分辨率同上，并下发 `quality` | 按 token；现有估算不含输入 token，1K 表再按 2K×4、4K×8估算 | 显示渠道、分辨率、质量；全景仍固定单张，隐藏背景、蒙版和数量 |
| KIE | 1K / 2K / 4K 的 2:1 均在现有文生图与图生图约束内；资料没有给三档精确像素 | 不支持 | `input.aspect_ratio: '2:1'`、大写 `input.resolution`；有参考图时自动切换 image-to-image 模型 | `$0.03/$0.05/$0.08`/张 | 只显示分辨率；不得虚构质量或精确像素 |
| Fal | 当前 SDK：`provider`、`1MP`、`2K`；2:1 下 `provider` 与 `1MP` 都会经通用 1MP 算法得到约 `1456×736`，并非严格 2:1；`2K` 明确为 `2688×1344` | `auto/low/medium/high` | `image_size` 为预设或宽高对象，`quality` 独立下发；当前兼容字段名 `falGptImage2Resolution` 实际表达质量 | 1K 方图参考：low `$0.006`、medium `$0.053`、high `$0.211`，auto 按 high 保守估算 | 若产品承诺“固定 2:1”，首版只应允许已精确映射的 `2K`；Fal 原生自定义尺寸边界允许 `3840×1920`，但当前 SDK 没开放 4K，不应只在 UI 伪造 |
| Grsai 标准 | 仅 1K；2:1 对应 `1792×896` | 新统一接口不支持 | `model: 'gpt-image-2'`、`aspectRatio: '2:1'` | 上限 `¥0.06`/次，优惠低至 `¥0.03` | 当前全景策略排除标准渠道，因为旧契约固定 2K；如开放，分辨率必须被条件限制为 1K |
| Grsai VIP | 1K：`1536×768`；2K：`3072×1536`；4K：`3840×1920` | 新统一接口不支持；旧接口的 quality 不能移植 | `model: 'gpt-image-2-vip'`，把 2:1 与分辨率映射为具体像素字符串 | 上限 `¥0.2`/次，优惠低至 `¥0.1`，当前资料称各分辨率同价 | 显示渠道与分辨率，隐藏质量；当前策略只允许 VIP |

### 3.1 价格边界

- APIMart EXT、KIE、Grsai 当前可按 schema 给出确定档位或上限价。
- APIMart 官方按 token 计费，现有计算器明确只是“不含输入 token”的估算，不能在全景节点写成最终单张价格。
- Fal 当前计算器只按 1024 方图参考成本与质量计价，没有把 `image_size`/像素数计入估算；用于 2:1、2K 时只能标记为参考估算。这是价格展示精度缺口，不影响请求字段正确性。

## 4. 推荐的全景节点参数契约

### 4.1 用户看见什么

节点仍使用 `PanoramaGenerationNode` + `GenerationNodeShell`，不增加第二套全景参数组件。除标准媒体输入、提示词、模型选择和生成动作外，只投影以下 schema 参数：

- 渠道：只有模型真实存在渠道参数时显示；若能力只允许一个渠道，可显示为锁定状态或省略，不得提供随后会被静默改写的选项。
- 分辨率：显示该渠道在固定 2:1 下经过验证的合法档位。
- 质量：只有 APIMart 官方与 Fal 显示；APIMart EXT、KIE、Grsai 不显示。
- 比例、输出数量、背景、蒙版和其他模型参数均不显示。比例始终固定 2:1，输出始终固定一张。

### 4.2 固定值、默认值和可编辑值必须分层

建议把能力策略拆成三种语义：

| 层级 | 全景值 | 生效时机 |
|---|---|---|
| 固定约束 | 2:1、输出 1 张、参考图 0～1 张、等距柱状投影、360°×180° | 创建、迁移、模型切换、每次提交都校验/覆盖 |
| 默认值 | 2K、medium（仅渠道支持时） | 新建节点或切换到不兼容模型时填写，不覆盖已保存的合法用户选择 |
| 可编辑投影 | channel、resolution、quality | 由 schema 能力决定是否显示、显示哪些合法选项，保存重开保持 |

`PANORAMA_PROMPT_POLICY.fixedSemanticParams` 也应去掉“固定 2K/medium”的表述，并升级契约版本；否则结果元数据会把用户选择错误记录成固定值。

### 4.3 无模型/供应商特例的实现方式

1. 在 SDK 的跨供应商同义参数上补稳定语义键：
   - 分辨率/尺寸：`transferKey: 'image-output-resolution'`。
   - 质量：`transferKey: 'image-output-quality'`。
   - 渠道继续使用已有 `role: 'channel'`。
2. 在通用能力投影契约中增加 `visibleParameterRoles: ['channel']`，并使用已经存在的 `visibleParameterTransferKeys` 投影分辨率和质量；不要在 `PanoramaGenerationNode.tsx` 或参数组件里判断 `modelId/providerId`。
3. 由 `allowedProviderConfigurations` 声明渠道白名单，并让通用参数行依据该配置过滤/禁用选项。当前 `mapChannel` 只会在提交时把非法渠道悄悄改为首个合法渠道：如果直接显示 Grsai 的 `standard`，用户选 standard 后会被静默改成 VIP，这是不可接受的。
4. 渠道与分辨率存在联动时，用通用的声明式合法组合描述，而不是 UI 分支。例如 Grsai standard 只能选 1K，VIP 可选 1K/2K/4K；不允许“用户选 4K，运行时偷偷降为 1K”。
5. 各供应商真正不同的字段名、大小写、像素表和端点继续留在各自 SDK request builder。画布只处理 `2:1`、分辨率、质量等统一语义。
6. 价格仍由模型 schema 的 `pricing.calculator` 提供，节点不维护价格表。Fal 若要提供可信 2:1 成本，应先完善 SDK 的像素相关估算或显式展示“参考估算”。

### 4.4 首次修正的保守范围

- 保持当前已验证供应商集合：APIMart EXT/官方、KIE、Fal、Grsai VIP。
- APIMart：EXT 显示分辨率，官方显示分辨率与质量；渠道切换后参数行随 schema 条件变化。
- KIE：显示 1K/2K/4K，不显示质量。
- Fal：若严格坚持 2:1，首版只显示已精确映射的 2K；不要把当前约 `1456×736` 的 1MP 结果称为严格 2:1。若要开放 Fal 4K，应先在 SDK 增加官方边界支持、请求和价格说明。
- Grsai：首版仍只允许 VIP，并显示 1K/2K/4K，不显示质量。若未来开放 standard，需要先加入“渠道条件下的可选分辨率”通用契约。

## 5. 建议修改位置

以下仅为后续实现指引，本次没有修改：

| 位置 | 建议改动 |
|---|---|
| 四个 `packages/ai-sdk/src/catalog/*/gpt-image-2.model.ts` | 为真正同义的分辨率/质量参数补 `transferKey`；Fal 继续保留兼容参数 ID，只改语义声明；必要时补精确 2:1 尺寸档 |
| `src/features/canvas/capabilities/types.ts` | 为能力策略补“默认语义”和按 role/transferKey 的可见投影；若开放多渠道不同规格，补声明式合法组合类型 |
| `src/features/canvas/capabilities/panoramaPolicy.ts` | 只把比例、数量、参考图限制留在 fixed；把 2K/medium 改为默认；声明 channel/resolution/quality 投影 |
| `src/features/canvas/capabilities/modelCompatibility.ts` | 按 transferKey 做通用默认映射、合法值归一化与渠道选项过滤，避免依赖参数 ID/中文名正则 |
| `src/features/canvas/capabilities/generationPreparation.ts` | 保证固定约束最后应用，但合法用户分辨率/质量不被覆盖；结果元数据区分 fixed/default/selected |
| `src/features/canvas/nodes/shared/GenerationNodeShell.tsx` 及标准参数行 | 读取能力投影，不添加 GPT Image 2、provider 或 panorama 特例 |
| `src/features/canvas/domain/nodeMigrations.ts` | 从现有全景契约迁移到新版本，保留合法的用户分辨率/质量，非法值显式回退 |

`src/features/canvas/nodes/PanoramaGenerationNode.tsx` 应保持薄壳，不应承担渠道选项、分辨率表、质量显隐或请求转换。

## 6. 测试建议

### 6.1 SDK 精确契约

- APIMart：覆盖 EXT/官方 × 1K/2K/4K；断言固定 `size: '2:1'`、EXT 不发送 quality 且固定一张、官方正确发送 quality；核对两类计价说明。
- KIE：文字/参考图两种端点分别覆盖 2:1 × 1K/2K/4K，断言分辨率大写、没有 quality，价格分别为 `$0.03/$0.05/$0.08`。
- Fal：断言 2K 映射为 `2688×1344`，质量独立下发；若保留 1MP 选项，测试必须揭示其当前为 `1456×736` 而非严格 2:1；只有补齐官方资料、schema 与 builder 后才能增加 4K。
- Grsai：断言 standard 的 1K 2:1 比例字符串、VIP 三档具体像素值；新统一端点不得发送 quality；核对价格上限显示。

### 6.2 展示与通用能力层

- 验证 APIMart/Grsai 渠道参数都带 `role: 'channel'`，四渠道同义分辨率/质量都带稳定 transferKey。
- 验证全景参数投影只出现渠道、分辨率、真实支持的质量；比例、数量、背景、蒙版不出现。
- 验证 APIMart EXT、KIE、Grsai 不会显示或下发伪造的质量值。
- 验证用户选择的合法分辨率/质量在提交、保存重开和模型切换后保留；2:1 与单张输出即使被连线或旧数据覆盖，也在提交前恢复固定值。
- 验证模型切换只迁移 transferKey 语义；目标渠道不支持时给出明确回退原因，不静默降级。
- 验证 Grsai standard 不能搭配 2K/4K，且被能力策略排除时 UI 不出现可选 standard。
- 补全景契约旧版本到新版本的迁移测试，确认结果元数据不再把用户选择误记为 fixed。

### 6.3 正式 Electron 场景

- 在 1440×900 与 960×640 下打开全景节点，切换 APIMart EXT/官方、KIE、Fal、Grsai VIP，检查参数行显隐、选项过滤、保存重开和窄屏可达性。
- 使用 fixture/请求构建替身验证最终参数，不点击真实生成，不消耗额度。

## 7. 本次验证

已执行零付费定向回归：

```text
npx vitest run \
  packages/ai-sdk/tests/catalog/apimart-images.test.ts \
  packages/ai-sdk/tests/catalog/kie-images.test.ts \
  packages/ai-sdk/tests/catalog/fal-targets.test.ts \
  packages/ai-sdk/tests/catalog/grsai.test.ts \
  src/features/canvas/capabilities/modelCompatibility.test.ts \
  src/features/canvas/capabilities/generationPreparation.test.ts \
  src/features/canvas/domain/panoramaNode.test.ts
```

- 结果：7 个测试文件、143 项测试全部通过。
- 本次只新增此交接文件；未修改模型、画布、展示层或运行时代码。
- 未触发任何付费生成。尺寸与画质结论仍需后续真实付费质量测试才能评价模型效果，但不影响本次静态契约结论。

## 8. 后续执行顺序

1. 先在 SDK schema 补 transferKey 与精确契约测试。
2. 再扩展通用能力投影、默认值/固定值分层和渠道条件选项过滤。
3. 升级全景策略与迁移，保持节点薄壳。
4. 跑定向单测、构建和双尺寸 Electron 非付费场景。
5. 最后再单独安排有额度保护的真实生成质量与账单验证。
