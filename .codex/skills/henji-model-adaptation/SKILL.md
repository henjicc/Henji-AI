---
name: henji-model-adaptation
description: 面向 Henji-AI 的模型与供应商调研、文档整理、参数体验和适配工作流。用于“新增供应商”“给现有供应商新增模型”“模型和供应商都要新增”“核查 API/价格/平台别名”“校对参数顺序、通用交互、隐藏参数或默认请求值”这类需求；先输出确认清单，用户确认后再实施。普通模型 schema 会被标准画布节点自动读取，不因模型会出现在画布里而自动触发节点开发。
---

# Henji Model Adaptation

按最小上下文加载执行。

## 1. 识别场景并路由

- 先读取 `references/intake-checklist.md`，输出精简确认清单并等待用户确认。
- 若用户需求是“新增供应商”，读取 `references/new-provider.md`。
- 若用户需求是“现有供应商新增模型”，读取 `references/new-model-existing-provider.md`。
- 若用户需求是“新模型且未接入对应供应商”，先读取 `references/new-provider.md`，再读取 `references/new-provider-and-model.md`。

## 2. 按需补充读取

- 涉及 API/价格调研、适配清单或模型文档整理时，必须先读取 `references/source-research-workflow.md`；按用户给定的平台矩阵控制范围，并完成模型别名、动态 Tab、价格与登录状态核验后再下结论。
- 先做“同模型多端点归并判定”：
  - 若 API 文档里的多个端点共享同一个模型名称/版本，只是输入素材或子能力不同，默认按“一个模型”处理，不默认拆成多个模型文件。
  - 只有在名称/版本相同但计费、轮询契约、结果结构、核心参数集合明显不同，且无法通过 schema + `endpoints.selector` + `request.builder` 在一个模型内稳定表达时，才考虑拆分成多个模型。
- 先做“功能能力来源”判定：
  - 不要把“功能标签/筛选项”与“独立端点/独立 mode”混为一谈。
  - 某个功能（例如首尾帧）即使没有独立端点、没有显式 `mode`，只要 API 文档表明它可通过同一端点内的可选字段激活（例如第 2 张图映射为 `end_image`），也应视为该模型具备此功能。
  - 这类能力需要同时落到 3 处：
    - `meta.tags`：保证模型能被功能筛选命中；
    - `inputLimits` / `requirements`：保证输入数量与约束正确；
    - `request.builder`：把 UI/上传素材转换成 API 所需字段。
- 先做“自动切换 vs 显式 mode”判定：
  - 若路由差异仅由是否上传图片/视频、上传数量（如 0/1/2 张）决定，且用户侧不需要主动选择子能力，优先做自动切换，不新增 `mode` 参数。
  - 若路由虽然可由素材数量自动判定，但为了让用户清楚当前处于哪个子模式，允许保留一个可见的 `mode` 参数，并通过 linkage/autoSwitch 自动更新其值；这类情况按“显式展示 + 自动切换”处理，不算纯手动模式。
  - 若存在 3 种及以上子能力、允许多张参考图、同时支持视频编辑/参考生视频/延长视频等复杂分支，或不同分支的参数显隐/约束/价格差异明显，必须显式设计 `mode` 参数。
  - 若仅有“文生图 + 图像编辑”两种能力，且差异只在“有无上传图片”，默认自动切换。
  - 若仅有“文生视频 + 首帧图生视频 + 首尾帧视频”三种能力，且可由上传图片数量 0/1/2 张唯一确定，默认可采用两种方案：
    - 简单场景：纯自动切换，不暴露 `mode`；
    - 更重视用户心智可见性时：暴露 `mode`，默认显示“文/图生视频”，上传 2 张图后自动切到“首尾帧”。
  - 一旦再引入“多参考图”“视频编辑”“视频参考”这类分支，则升级为显式 `mode` 主导。
- 设计参数顺序、分组、特殊面板或“高级设置”时，读取 `references/param-order-patterns.md`；先保留跨模型通用参数的标准交互，再收纳模型特有或低频参数。
- 若实施需要新增/改造 `.tsx` 参数面板，按项目规则同时使用 `henji-ui-surface`；这仍属于共享参数呈现，不因它也会出现在画布里而自动变成画布节点任务。
- 处理“不展示参数/固定默认请求值”时，读取 `references/hidden-default-params.md`。
- 判断图片/视频/音频差异时，读取 `references/modality-differences.md`。
- 涉及比例/分辨率时，优先执行“智能比例 + 本地转具体值”的规则（见 `references/param-order-patterns.md`）。

## 3. 执行规则

- 当前 Henji-AI 生成运行时基线是 Electron + Node/TS，不再走 Tauri/Rust；所有供应商执行、上传、轮询与结果解析都以 `electron/main/services/ai-runtime/**` 为准。
- 在输出确认清单前，先自行归纳：
  - 这是“一个模型多个端点”还是“多个独立模型”；
  - 应采用“自动路由”“显式展示 + 自动切换”还是“显式 `mode`”；
  - 依据是什么（输入素材种类/数量、参数差异、价格差异、轮询契约差异）；
  - 各项“功能筛选标签”来自哪里：独立端点 / 显式 mode / 同端点内可选字段。
- 输出确认清单时，默认带上你的预判结论，用户只需要改例外项，不需要从头重复描述。
- 信息不足时，停止编码并向用户补充最小必要信息。
- 若用户未提供价格或计费规则，必须先追问价格，再继续模型实现。
- 优先复用同供应商、同模态、同模型家族的现有模型定义；仅将其作为起点，以官方 API 文档为准。
- 供应商模型文件只填写 `meta.canonicalModelId`，禁止填写 `meta.description`。适配前先检查 `src/core/modelCatalog/generationModelDescriptions.ts`：已有同一通用模型标识就直接引用；不存在就新增空描述条目，并在交付时明确告诉用户需要在该文件补充这个模型的定性描述。通用描述只写模型擅长方向或相对定位，不重复 tags 已表达的固有能力。
- 对接已接入的 provider 时，先核对该 provider 在仓库里的既有 route 写法与 runtime 约定，再决定 `endpoints` 填什么；不要只按文档标题猜路径，也不要漏掉现有 provider 统一前缀（例如部分 PPIO 路由实际要走 `/async/...`）。
- 参数展示层可以做统一交互，但最终请求参数必须转换为 API 文档要求的字段和值。
- 参数压缩不能破坏用户已经形成的跨模型心智：比例、分辨率、时长、数量、质量等高频通用参数，优先保持同模态模型已有的名称、控件类型、顶层位置和交互方式；不得仅为了“参数更少”把它们吞进供应商/模型专属高级面板。标准交互不等于统一 options/default，合法值和默认值仍以当前 API 契约为准。
- 模型特有、低频或需要强联动解释的参数才进入 `composite` / 特殊面板；面板内部仍复用现有 `Ui*`、标准参数控件、上传与排序能力，不重做比例选择器、下拉、开关或文件上传。
- 标准生成节点通过 `GenerationNodeShell -> NodeInputRows -> NodeParamRows` 自动读取模型 schema。只改模型参数定义、显隐、联动、计价或请求映射时，默认不修改 `src/features/canvas/**`，也不加载 `canvas-node-builder`。只有新增/改造节点 DOM、端口、节点注册、节点专属交互，或现有 `ParamRenderer` / `NodeParamControl` 无法共同表达新参数类型时，才进入画布节点工作流。
- 新增或调整复合/特殊参数面板时，必须确认对话/工具面板的 `ParamRenderer` 与画布的 `NodeParamControl` 都能消费同一 schema 和同一值结构；优先修正共享参数面板能力，不为画布复制一份模型专属实现。
- Henji-AI 当前产品约定：新增模型默认不暴露 `output_format` / `outputFormat`，也不向 API 传递该字段；即使文档支持，也先按“不显示且不请求”处理，除非用户后续明确推翻这条约定。
- 若参数显隐/联动/计价依赖“是否已上传图片/视频”，必须同时覆盖三种执行场景各自的运行时字段名，不能只查一个：生成提交时是 `uploadedFilePaths`/`uploadedVideoFilePaths`，画布节点实时值是 `images`/`videos`，对话/工具面板实时上传状态是 `uploadedImages`/`uploadedVideos`。只查其中一个键会导致另外两个场景判断错误（参数该隐藏没隐藏、画布里 mode 自动切换不触发、计价按错分支）。优先复用 `src/models/shared/mediaPresence.ts` 的 `hasUploadedImage`/`hasUploadedVideo`/`countUploadedImages`/`countUploadedVideos`（KIE/PPIO 模型可从同目录 `./mediaSources` 导入，已重导出），仅限 `visible.condition`/`linkage`/`pricing.calculator` 使用，不能进 `request.builder`/`endpoints.selector`（会被序列化进独立 VM，import 失效）。
- 严格走项目主链路：`GenerationService -> src/commands/aiRuntime.ts -> src/platform/* -> electron/preload/index.ts -> electron/main/ipc/ai-runtime.ts -> electron/main/services/ai-runtime/**`。
- 禁止在业务 UI 写模型/供应商硬编码分支。
- 牢记 runtime 约束：`endpoints.selector` 与 `request.builder` 会被 `scripts/generate-model-manifest.cjs` 序列化为 `selectorJs` / `builderJs`，再由 `electron/main/services/ai-runtime/js-runtime.ts` 在 Node VM 中独立执行；不能依赖模型文件顶层 helper/闭包变量，除非该 helper 已明确存在于 `JS_PRELUDE`，需要的新工具函数应内联在函数体内或同步更新 manifest/runtime 支撑。
- 若模型在 `scripts/generate-model-manifest.cjs` 有 `CUSTOM_BUILDER_OVERRIDES`，修改模型 builder 时必须同步检查 override，避免 manifest 与源码行为不一致。
- 多端点模型除“自动切路由”外，还要检查“分支参数契约”：
  - 文档只在部分端点定义的参数，应只在对应分支显示/发送；
  - 不要把分支不支持的参数继续展示在 UI 上，再靠 builder 静默忽略；
  - 文档未定义字段默认不发送。
- 无论是否多端点，都要单独检查“功能筛选一致性”：
  - `meta.tags` 是否完整覆盖模型对外宣称的能力（如 `start-end-frame`、`reference-mode`、`motion-control`）；
  - 文案、筛选标签、输入约束、builder 映射是否一致；
  - 不要出现“请求层已支持某能力，但 tags 没标，导致功能筛选缺失”的情况。
- 改动参数默认值后，必须做一次“首屏默认值一致性”检查：
  - 模型 schema 的 `default` 与 UI 首次渲染显示值必须一致；
  - 若出现“默认值回到首项”的现象，优先排查下拉组件回退策略是否错误地回退到首个 option，而不是 `param.default`；
  - 同时检查 linkage 的 `autoSwitch/reset` 是否在初始化阶段覆盖了默认值。

## 4. 完成标准

- 按 `docs/rules/testing.md` 选择最小验证：模型定义改动通常运行 manifest、model i18n 与对应参数/请求构建精确测试，不默认跑全量 lint。
- 只有改到 Electron 主进程/runtime/provider/upload 的共享契约时才追加主进程类型检查或相关 lint；先跑精确测试，影响边界不清时再升级。
- 只有需要验证完整 Electron 类型链路、产物或发布链路时，再跑 `npm run electron:build`；构建后需要验收真实桌面能力时再跑 `npm run electron:smoke`。
- 新增能力不引入跨层调用与 UI 直连模型 API。
- 新增参数满足顺序约定，并明确“显示/请求”策略。
- 需要验证运行中的 Electron 进程已加载新 manifest：重启 `npm run electron:dev`，或通过现有 manifest reload 能力确认 `resources/model-manifest.json` 已重新加载。
- 默认值改动需通过“冷启动可见验证”：重启开发进程后确认参数面板初始显示值正确（不是仅看请求 builder 兜底）。
