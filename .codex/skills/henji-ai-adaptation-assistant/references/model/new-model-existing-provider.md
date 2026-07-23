# 场景 B：现有供应商新增模型

仅在供应商已接入 runtime 时走本流程。

## 1) 选参考模型（先复用再改）

优先选择“同供应商 + 同模态 + 同家族版本”文件做起点。

推荐参考：

- PPIO 图片：`src/models/ppio/seedream-5.0-lite.model.ts`、`src/models/ppio/seedream-4.5.model.ts`
- PPIO 视频：`src/models/ppio/wan-2.7.model.ts`、`src/models/ppio/vidu-q3.model.ts`、`src/models/ppio/kling-o1.model.ts`
- PPIO 音频：`src/models/ppio/minimax-speech.model.ts`
- FAL 图片：`src/models/fal/nano-banana-pro.model.ts`、`src/models/fal/z-image-turbo.model.ts`
- FAL 视频：`src/models/fal/kling-video-v2.6-pro.model.ts`、`src/models/fal/kling-video-o1.model.ts`
- KIE 图片：`src/models/kie/gpt-image-2.model.ts`、`src/models/kie/nano-banana-pro.model.ts`
- KIE 视频：`src/models/kie/kling-v2-6.model.ts`
- ModelScope 图片：`src/models/modelscope/qwen-image.model.ts`

## 2) 新建模型定义

- 新建 `src/models/{provider}/{model-name}.model.ts`
- 使用 `defineModel()`，补齐：
  - `meta.id/canonicalModelId/provider/type/i18nScope/name/tags`
  - `params/linkages/endpoints/request/pricing`
- 供应商模型文件禁止填写 `meta.description`。先检查 `src/core/modelCatalog/generationModelDescriptions.ts`：已有 `canonicalModelId` 就直接引用；没有就新增空描述条目，并在交付时告诉用户在该文件补充定性描述。
- 文件名必须以 `.model.ts` 结尾。
- `meta.tags` 不是装饰信息，而是功能筛选数据源；凡是产品要支持筛选的能力，都必须在适配时显式核对是否已写入 tags。

### 2.1) 先判断要不要“一个模型多端点”

- 同一模型名称/版本命中多个 API 端点时，先不要急着拆文件。
- 按下面顺序判断：
  1. 若只是输入素材不同导致端点不同，且本质上仍是同一个模型版本，优先合并到一个模型。
  2. 若能用上传素材数量/类型唯一推断路由，优先自动切换，不新增 `mode`。
  3. 若虽然可以自动推断，但需要把“当前处于哪个模式”明确展示给用户，可以保留 `mode` 并通过 autoSwitch 自动改值。
  4. 若存在多个复杂子能力，无法仅靠素材数量唯一判定，或分支间参数/价格/轮询契约差异明显，新增 `mode`。
  5. 只有在一个模型文件内会导致 schema 难以维护、builder 难以收敛、用户心智明显混乱时，才拆成多个模型。
- 典型判定：
  - 图片：`无图=文生图，有图=图像编辑` -> 一个模型，自动切换。
  - 视频：`0张图=文生视频，1张图=首帧，2张图=首尾帧` -> 一个模型；可纯自动切换，也可保留 `mode` 并在 2 张图时自动切到 `首尾帧`。
  - 视频：再加 `多参考图` / `视频编辑` / `视频参考` -> 一个模型，但应显式 `mode`。
  - 注意：`首尾帧` 不一定意味着独立端点或独立 `mode`。若文档是在同一个 i2v 端点中通过第二张图/`end_image`/`last_image` 之类字段启用该能力，仍应视为模型支持 `start-end-frame`，并补齐 tags、输入约束与 builder 映射。

## 3) 参数设计

- 顺序规则见 `param-order-patterns.md`。
- 先通过 schema 表达模式差异，不在 UI 里写 `if (modelId===...)`。
- 若某参数只被部分端点支持，优先用 `visible` / linkage / requirements 把它限制在对应分支，而不是“全局展示 + builder 静默丢弃”。
- 若某能力来自同端点内的可选字段，而不是独立端点：
  - 仍要把该能力反映到 `meta.tags`；
  - 仍要通过 `inputLimits` / `requirements` 明确素材数量；
  - 不要求一定暴露 `mode`，但不能因为“没有独立路由”就漏掉功能声明。
- 若参数显隐/计价/联动依赖"是否已上传图片或视频"，注意同一件事在三种执行场景下活在三个不同运行时字段下：生成提交时是 `uploadedFilePaths`/`uploadedVideoFilePaths`，画布节点实时值是 `images`/`videos`，对话/工具面板实时上传状态是 `uploadedImages`/`uploadedVideos`。`visible.condition`、`linkage.condition`、`pricing.calculator` 这类直接读取活参数的函数会在三种场景下都被调用到，只查其中一个键会导致另外两个场景判断错误（典型表现：某个参数该隐藏却没隐藏、画布里模式自动切换完全不触发、计价该按"有视频"算却按"无视频"算）。**不要自己手写三键判断**，优先复用 `src/models/shared/mediaPresence.ts` 导出的 `hasUploadedImage`/`hasUploadedVideo`/`countUploadedImages`/`countUploadedVideos`（KIE/PPIO 模型可以直接从同目录下的 `./mediaSources` 导入，它们已重导出这几个函数）。注意这几个函数只用于 `visible.condition`/`linkage`/`pricing.calculator`，**不能在 `request.builder`/`endpoints.selector` 里使用**（会被序列化进独立 VM，import 失效）。
- `output_format` / `outputFormat` 按当前产品约定一律不新增到 `params`；即使 API 文档支持，也默认不展示。
- 需要媒体输入约束时优先用：
  - `inputLimits`
  - `requirements`
- 处理隐藏/固定参数时，遵循 `hidden-default-params.md`。
- 涉及比例/分辨率时，默认接入“智能比例”面板：
  - 默认 `smart`
  - 有图按首图匹配最近支持比例
  - 无图回退 `1:1`
  - 发送请求前转成具体比例值，不直传 `auto/smart`
- 设计 `mode` 时补充约束：
  - `mode` 只在确有必要时出现，不把“可由素材数量自动判定”的简单分支硬做成下拉。
  - `mode` 一旦出现，必须同步补 `inputLimits`、`requirements`、参数 `visible`/linkage。
  - 自动切换与显式 `mode` 可以混用，但要保证规则稳定且用户可理解，例如：
    - 默认 `text-image-to-video`
    - 上传 2 张图自动切到 `start-end-frame`
    - 复杂分支如 `video-edit` 仍由用户手动选
  - 若采用“显式展示 + 自动切换”：
    - `mode` 的首要作用是状态可见，不要求用户每次手动改；
    - 素材变化后要自动同步 `mode` 值，避免界面显示和真实请求路由不一致；
    - 自动切换规则必须可逆，例如删除第 2 张图后从 `start-end-frame` 回退到 `text-image-to-video`。

## 4) 请求构建

- 在 `request.builder` 内只处理模型请求映射。
- 以 API 文档为准，不盲拷旧模型字段。
- 不要把全局 prompt 再定义为模型 params（项目已有统一 prompt 输入）。
- PPIO / KIE 多媒体源码层可参考 `src/models/ppio/mediaSources.ts`、`src/models/kie/mediaSources.ts`（取实际上传素材路径，如 `resolveKieImageSources`）；"是否已上传图片/视频"这类布尔/计数判断见 `src/models/shared/mediaPresence.ts`（`hasUploadedImage`/`hasUploadedVideo`/`countUploadedImages`/`countUploadedVideos`，跨 provider 通用）。但进入 manifest 后的 `request.builder` / `endpoints.selector` 必须自包含，不能直接依赖这些顶层 helper，除非对应 helper 已存在于 Electron runtime 的 `JS_PRELUDE`。
- 先确认 `endpoints` 里的 route 是否符合该 provider 在仓库中的既有写法；不要只照着接口文档里的标题或相对路径手填，尤其要检查是否存在统一前缀（例如 `/async`）。
- builder 必须“自包含”：只使用函数体内可访问的变量/函数，或使用 `electron/main/services/ai-runtime/js-runtime.ts` 的 `JS_PRELUDE` 已提供 helper。不要依赖模型文件顶层 helper（Electron 主进程 Node VM 执行 manifest 中的 `builderJs` 时会 `ReferenceError`）。
- 比例字段必须发送最终具体值（如 `16:9`），不发送 `smart/auto`。
- UI 层的复合参数/特殊组合，必须在 builder 转成 API 要求字段后再发送。
- 禁止把 UI 值未经转换直接透传给 API。
- `output_format` / `outputFormat` 按当前产品约定一律不发送；新增模型不要因为参考旧实现或接口文档存在该字段而补传。
- 多端点 builder 必须按端点分支只发送该分支文档定义的字段；例如图片编辑未定义 `aspect_ratio` / `output_format` 时，就不要因为文生图分支支持而一并透传。
- 单端点多能力 builder 也要检查：
  - 是否已正确发送触发该能力的可选字段（如 `end_image` / `last_image`）；
  - 是否因为只关注 route 而遗漏能力字段；
  - 是否同步补齐了与该能力对应的 `meta.tags`。
- 多端点模型必须同时检查：
  - `endpoints.selector` 是否完整覆盖所有路由分支；
  - builder 是否按分支输出不同字段；
  - pricing 是否能反映不同 mode/素材组合；
  - 若 provider runtime 对返回结构/轮询状态有差异，是否需要同步改 Electron provider。
- 若该模型在 `scripts/generate-model-manifest.cjs` 有 `CUSTOM_BUILDER_OVERRIDES`，需要同步更新 override。
- 若该模型新增或依赖 `runtimeConstraints`，检查生成后的 `resources/model-manifest.json` 是否包含约束，并确认 `electron/main/services/ai-runtime/request-normalizer.ts` 支持对应约束类型。

## 5) i18n 与文案

- 在 `src/i18n/locales/zh-CN/models-{provider}.json` 新增 `defs.{modelId}`。
- 在 `src/i18n/locales/en-US/models-{provider}.json` 同步新增。
- 若用了 shared helper，确保 key 存在并能通过 i18n 检查。
- 供应商 i18n 中不新增模型描述；通用模型描述只在 `src/core/modelCatalog/generationModelDescriptions.ts` 维护一次。
- 通用描述只用于表达模型擅长方向或相对定位，功能能力仍以 tags、输入约束、参数 schema 和 builder 为准。

## 6) 价格（必须确认）

- `pricing` 不能拍脑袋填写。
- 若用户没给价格，先追问后再编码。
- 追问至少包含：
  - 固定价还是计算价
  - 与分辨率/时长/数量是否有关
  - 价格文案如何展示
- 拿不到价格时，不提交最终模型定义。

## 7) 何时需要改 Electron provider

默认不改。仅当出现以下情况才改：

- 该模型返回结构与当前 provider 提取逻辑不兼容
- 轮询状态字段/状态值不同
- 鉴权、路由、method 有 provider 级新规则

## 8) 验证

- `npm run gen:model-manifest`
- `npm run check:model-i18n`
- `npm run lint`
- 若修改 Electron runtime/provider/upload：`npx tsc -p tsconfig.electron.json --noEmit` 与 `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`
- 推荐 `npm run electron:dev` 验证真实提交与回包；若需完整产物链路，再跑 `npm run electron:build`。
- 若本地已有运行中的 Electron 进程，改完后需重启或触发 manifest reload，确认 runtime 使用最新 `resources/model-manifest.json`。
- 若出现“UI 仍显示旧参数”或“请求仍打到旧路由”，先排查是否是运行中的 Electron / dev 进程未重载最新 manifest，而不是直接怀疑 builder。
