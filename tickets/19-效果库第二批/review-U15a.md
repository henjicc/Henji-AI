# 19-U15a 合并前审查（分支 task/19-U15a-点选宿主，HEAD 390058d16，基于 main ea972d1ec）

## 重要

### 1. 剪辑、录制的最低可读版本应提高到 54 / 57（第 6 条，建议改）
- 位置：`src/core/documents/kinds/videoEdit.ts:140`（`minReaderVersion: 53`）、`src/core/documents/kinds/screenRecording.ts:12`（`minReaderVersion: 56`）
- 出错场景：v53 / v56 的旧程序打开新程序保存的工程，只要工程里有新建的代码素材（默认作者接口 v10）。
- 原因：
  - 代码版本直接嵌在剪辑内容里（`document.ts:196` 的 `codeMaterials` → `codeMaterialPersistence.ts:26` 的 `apiVersion: codeAuthorApiVersionSchema`）。旧程序的枚举只认到 9。
  - 前向兼容只放过 `unrecognized_keys`（`forwardCompat.ts:74-75`），枚举值不认识会直接抛错。所以旧程序会走“内容 schema 不匹配”，报“内容无效”，不会报 `newer-version` 的“请升级”。
  - 就算没有 v10 代码，旧程序也会把 `effects` / `addedEffects` / `edits` 当未知字段留着、照样渲染，画面里少了用户改的效果。`videoEdit.ts` 里第 26、27、28、31、37、47 版的注释都是按“旧程序会渲染出不同画面 / 判成内容无效”提高的。U9 引入 v9 时也提高了。
  - 本单自己的处理前后不一：风格库、风格包、预设包、效果库、代码版本、代码资产都以“旧程序会拒绝 v10 快照”为由提高了最低可读版本，而剪辑内容同样直接内嵌 v10 代码版本，却没有提高。
- 设计 11.5 的前提“旧程序忽略它们，其余内容含义不变”在本仓库不成立（schema 是 strict 加枚举）。建议：
  - 剪辑与录制最低可读改为 54 / 57，迁移注释补一句原因；
  - 重跑 baseline 与 release-snapshot；
  - 同步修正设计第 12 节表格里“剪辑内容、录制会话 · U15a · 不变”那一行。

### 2. 效果参数只逐项校验，组合非法的值能写进去，之后整帧渲染失败（第 1 条）
- 位置：
  - 写入：`src/core/videoEdit/authorEffects.ts:233`、`:240`，每个参数单独调用 `normalizeVideoEditBuiltinParams(id, { [key]: raw }, …)`，其余参数取默认值；
  - 读取：`authorEffects.ts:157`，把整组值再规范化一次，不捕获错误；调用点在 `:197`（代码效果叠覆盖）和 `:209`（追加效果）。
- 出错场景：调色 `color_grade` 有一条跨参数约束 `hsl_*_start ≤ hsl_*_end`（`builtinEffects.ts:127-128`），两个默认值分别是 0 和最大值。
  - 追加 `color_grade { hsl_saturation_start: 90, hsl_saturation_end: 10 }`：逐项校验都能过，读取时抛“hsl_saturation_start 不得大于 hsl_saturation_end”。
  - 代码给的 end 是 80，覆盖只写 start=90：同样会抛。
- 后果：`resolveAuthorElementEffects` 在运行时（`videoEditAuthorRuntime.ts:509/551`）和指纹路径里抛错，这个代码片段在预览和导出里都渲染失败。这既违反“写入严格”，也违反“读取容错、不让旧覆盖拖垮整帧”。
- 取证：在 scratchpad 用 tsx 直接调用，结果是 `validateAuthorElementEffectOverrides` 返回 write accepted，`resolveAuthorElementEffects` 返回 read threw。
- 建议：
  - 写入时按整组严格校验：代码效果校验 `{...state.codeValues, ...values}`，追加效果校验 `added.params`；
  - `readElementEffectParams` 的整组规范化失败时退回代码值，或把这一项标为 missing 跳过，不抛错。

## 小问题

### 3. `edits` 进入了预渲染段的键
- 位置：`src/core/videoEdit/renderCache.ts:32`（`videoEditRenderPictureClip` 没有剔除 `edits`，在 `:92-93`、`:284` 用于代码指纹和段键）。
- 出错场景：
  - 值从 A 改到 B 又改回 A：像素一样，但 `edits.at` 变了，预渲染不命中；
  - 内容相同、修改记录不同的片段副本，不能共用预渲染文件。
- 原因：`edits` 只是元数据，不影响画面。输出复用键（`videoEditCodeOutputKey.ts:76-80`）已经正确地没有包含它，预渲染这边也应剔除。

### 4. 按元素前缀过滤修改记录，元素 id 会互相误配
- 位置：`src/core/videoEdit/codeEdits.ts:42`（`codeElementEdits`）、`:48`（`dropCodeElementEdits`）
- 出错场景：元素 id 本身含冒号且是另一个 id 的前缀，例如 `a` 和 `a:b`（作者 id 是任意字符串，覆盖 schema 也不禁止冒号）。
  - 读 `a` 时会带出 `a:b` 的记录；
  - 把 `a` 的覆盖写回源码时，`a:b` 的记录也会被删掉。
- 建议：记录键里的元素 id 先编码，或改成精确解析。

### 5. 素材项和代码资产上的元素效果覆盖绕过了严格写入校验
- 位置：
  - `src/core/videoEdit/document.ts:67`：`videoEditItemSchema.elementOverrides` 现在接受 `effects` / `addedEffects`；
  - `src/core/videoEdit/projectItems.ts:67`：放进时间线时原样拷进片段；
  - `videoEditCodeService.ts:142`：代码资产导入同样会带进来。
- 出错场景：助手通过通用 `video_edit.item.element_overrides` 写入，或导入代码资产。这些入口都不调用 `validateAuthorElementEffectOverrides`。
- 后果：
  - 越界值放进片段后被静默钳制；
  - 第 2 条的组合非法值会直接让片段渲染失败；
  - 素材项这条属性的说明也没有写效果字段。
- 建议：在素材项写入口复用同一套校验，或者明确规定素材项不接受效果覆盖。

### 6. 追加效果与代码效果同 key 时，代码那一项没法再单独调整
- 位置：`src/features/videoEdit/application/videoEditCodeElementEditing.ts:138`、`:161`（`updateVideoEditCodeElementEffectAs` 与切换关键帧的写入，先按 key 找追加项）
- 出错场景：源码后来用了某个追加项已占用的 key（实现说明里承认这种情况会出现）。之后按这个 key 改值、切 fx 开关、切关键帧，全都落到追加项上，代码效果那一项只能整组写入才能改到。
- 建议：写入函数增加 `added` 区分参数，与界面用的 React key `${added}:${key}` 对应。

### 7. 调整层在当前帧没有观察时，属性组可写性判断不准
- 位置：`src/features/videoEdit/application/videoEditCodeElementReflection.ts:82`
- 出错场景：当前帧没有这个调整层的观察（`element` 为空）时，`unavailable()` 判断不出它是调整层，`properties` 显示为可写。真正写入时 `writeVideoEditCodeElementGroups` 才报“需要观察”。
- 建议：用 `program.bundle.locations` 或作者图层声明判断 `adjust`，或者在没有观察时直接返回不可写的原因。

## 原有问题
- `src/features/videoEdit/engine/videoEditAuthorModules.test.ts:97`、`:112`（第 7 条）：
  - main 上本来就失败。原断言把“可用的内置库：three@0.186.1”钉成列表第一项，但 `describeAuthorLibraries` 按 `AUTHOR_LIBRARIES` 的键顺序输出，main 上第一项是 `henji-effects`（`authorLibraries.ts:35-44`）。
  - 改后的断言是“提示列出可用库，并且包含 three@0.186.1”，它保护的就是这条提示本身，没有掩盖真实问题。这也符合 testing.md “不把登记表抄进断言”的要求，放宽合理。
  - 建议在提交正文里写明这是 main 上的原有失败。
- `videoEditContentPrecision.gpu.test.ts` 在普通模式下会打印一段 WebGPU validation 提示，main 上同样有（实现方已记录，我未复现）。

## 逐项核查结论（没问题的部分）
- **叠加顺序**：`applyAuthorElementEffectOverride` 依次做代码值 → 按 key 叠覆盖（曲线已按素材时间求值）→ 跳过 `enabled:false` → 末尾接 `addedEffects`；`pose.blur` 由运行时最后追加（`videoEditAuthorRuntime.ts:584`）。
- **风格件**只接受旋钮（写入 `:236`，读取 `:186-189`）。
- **key**：缺省规则正确；显式 key 重复报错；自动 key 让开显式 key；API ≤9 写 key 报错。
- **missing** 的覆盖原样保留，写入只校验本次改动的项。
- **缓存与确定性**：
  - 求值后的覆盖进入了输出复用键（`videoEditCodeSources.ts:462` → `videoEditCodeOutputKey.ts:80`）和两种帧指纹（`videoEditCodeFingerprint.ts:108`）；
  - 代码效果和追加效果的指纹走 `authorEffectsFingerprint(…, authorFramePosition)`，与 U5 的效果时钟一致；`key` 不进指纹，等价代码的指纹相同；
  - 修剪、变速、倒放、时间重映射统一经 `videoEditClipSourceTimeAt`（`clipSpeed.ts:126-134` 含 remap 分支）；
  - 预览和导出走同一套 `VideoEditCodeSources`。
- **edits**：
  - 底层写入函数都改成必填 actor；界面默认导出绑定 user；实体和通用片段写入按 `operationOrigin.actor` 判定，来源由主进程 `operationCoordinator.ts:297` 写入，参数无法冒充；
  - 重置会删除对应记录；改写源码不碰记录，只在“覆盖并入源码”时删掉被清除元素的记录；
  - 图片参数回填只由界面面板发起（`CodeImageGenerationPanel.tsx`），记为 user 正确；
  - 其余写入点检查后没有发现漏记（`videoEditPropertyAnimation` 目前只有测试在用；`videoEditVisualReview` 是临时合成，不落盘）。
- **助手能力**：
  - `video_edit.code_element` 三组属性加只读的 observation，走通用的 list / read / change，没有新增专用工具；
  - 读回带 key、代码值、实际值、overridden、added、enabled、missing 和 edits；
  - 调整层只放行 opacity / hidden 和效果，属性组不可写。
- **撤销**：
  - 实体写入在一次 `writeVideoEditCodeElementGroups` → `edit()` 里完成，作为一步进剪辑历史；
  - 拖动经 `updateVideoEditGesture` 合成一步；
  - 执行器另有快照撤销和补偿。
- **持久格式**：每种格式相对 main 只升了一版（剪辑 53→54、录制 56→57、作者接口 9→10、代码版本 10→11、代码资产 15→16、字幕回填 25→26、风格库 9→10、风格包 12→13、预设包 13→14、效果库 6→7），迁移逐版本登记，黄金样本齐全。只有最低可读版本那一点见第 1 条。
- **安全五条底线**：只多了主进程向渲染层透传 `operationOrigin`，来源是主进程自己的操作记录；隔离、preload 与密钥都没有受影响。

## 设计符合度
- 11.1 的宿主侧、11.2、12 节作者接口一版、裁定第 5 条（允许追加效果、允许关掉代码给的效果，人和 AI 同一组写入）都已实现。
- 偏差有两处：
  - 11.5 / 12 节“剪辑、录制最低可读不变”的前提不成立，见第 1 条；
  - 写入严格校验漏掉了跨参数约束，入口也没有全覆盖，见第 2、5 条。
- 追加项缺省 key 用 `<id>+N`、时变效果列表按帧判断 missing，这两处是设计没写到的细节，实现方的取舍合理。

## 读过 / 没读到的范围
- **读过**：
  - `authorEffects.ts`、`codeElementOverrides.ts`、`codeEdits.ts`、`authorEffectObservation.ts`、`codeAuthorProgram.ts`、`codeAuthorVersions.ts` 的 diff；
  - `videoEditAuthorRuntime.ts` 第 455-620 行；
  - `videoEditAuthorFingerprint.ts`、`videoEditAuthorBundle.ts`、`videoEditAuthorJsLocations.ts`、`videoEditCodeSources.ts`、`videoEditCodeFingerprint.ts` 的相关段落；
  - `videoEditCodeElementEditing.ts`、`videoEditCodeParameters.ts`、`videoEditCodeImages.ts`、`videoEditExecutors.ts`、`videoEditFields.ts`、`videoEditCodeElements.ts`、`videoEditCodeElementSummary.ts`、`videoEditCodeCandidates.ts` 的 diff；
  - `videoEditCodeElementReflection.ts` 全文；
  - application-control 与 Electron 透传 origin 的 diff；
  - persistence 各 diff、`releasedCompatibility.json` 的 diff、`forwardCompat.ts` 与 `renderCache.ts` 的相关段落；
  - 几个测试的 diff、作者库生成脚本、`author-api.md`。
- **运行过**：`videoEditCodeElementReflection.test.ts`（3 项通过），以及一个 tsx 探针（第 2 条的取证）。
- **没读到**：
  - GPU 精度测试的新增用例细节、`authorEffects.test.ts` 的全部用例；
  - 黄金样本内容、`schemaBaseline.json` 逐项内容、生成的 `.d.ts` 全文；
  - `.tsx` 消费方（本单没有改）、`videoEditService` 中 gesture / 历史的内部实现；
  - 缺失 LUT 时追加效果在渲染器里的行为（待确认）。

## Claude 裁定（11-01）
1. 剪辑、录制最低可读版本提高到本单的新版本号（现为 54/57；若 ticket 10 先合并占号，则顺延后的号），补迁移注释，重跑 baseline 与 release-snapshot，同步设计第 12 节那一行与 11.5 的前提说明。
2. 效果参数改为整组严格校验：写入按“代码值 + 覆盖”整组校验（含跨参数约束），读取遇组合非法退回代码值或标 missing、不抛错；小问题 5 的素材项与代码资产入口（放进时间线、导入）走同一校验。补 color_grade 起点 > 终点的用例。
3. 预渲染段键剔除 edits。4. 修改记录不按字符串前缀过滤，按结构解析键（元素 id 可含冒号）。5. 见第 2 条。6. 追加效果的 key 与代码效果冲突时拒绝（或自动换不冲突的 key，二选一写清）。7. 调整层可写性按源码声明判断，不依赖当前帧是否有观察。
原有问题：作者模块测试断言放宽合理，提交正文写明是 main 上的原有失败。
