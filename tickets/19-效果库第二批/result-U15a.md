# U15a 点选画面元素·宿主能力交付

摘要：效果稳定 key、元素覆盖 effects/addedEffects、按 key 叠加（严格写、容错读、missing）、edits 修改记录、代码元素实体三组属性已落地，人和助手走同一组写入与撤销栈。
摘要：作者接口 v10；剪辑 54、录制 57、代码版本 11、代码资产 16、字幕回填 26，以及 4 个带代码快照的风格/预设格式各升一版，剪辑与录制最低可读不变。
摘要：接手 Codex 半成品后重写叠加与写入层，三轮独立审查；剪辑/录制最低可读是否提高待 Claude 裁定；界面接入接口见末节。

状态：完成（接手 Codex），任务分支已提交并合入当时最新 main（`ea972d1ec`）；未推送、未合并到 main，工作区干净。

## 分支与提交

- 工作目录 `D:\VibeCode\Henji-AI-t19u15a`，分支 `task/19-U15a-点选宿主`。
- 提交（main 之后依次）：`bc3e90e8d` 实现（含第一轮审查修复）；`ffa7ee771` 合入 main（U2、U4、U14）并顺延版本；`3c8646004` 第二轮审查修复；`596130e75` 合入 main（U3）；`023749eb2` 第三轮审查修复；`390058d16` 合入 main（U5，`ea972d1ec`）。合并只重新生成效果登记产物、指纹改用 `authorFramePosition`。
- 接手时 Codex 留下 50 个未提交文件：效果 key、覆盖 schema、edits 差异记录、实体骨架、持久升版思路保留；叠加函数（风格件重复求值、旧模糊 ID、界面读回时间与 key 重建错误）、写入校验（追加项与代码 key 混用、无法改追加项）、隐藏元素进入观察、chain 级假 GPU 用例重写或撤掉。

## 已落地

- **效果 key**：描述可带 `key`（工厂第二参数 `{ key }`、`look(name, knobs, { key })`，生成产物已更新，henji-effects 冻结留给 U16）。缺省为效果 ID，第二个同 ID 为 `glow#2`，风格件为 `look:<名称>`；显式 key 重复报错，自动 key 遇占用顺延（旧代码 `look('A')×2 + look('A#2')` 不报错）；API ≤9 写 key 报错。
- **覆盖与叠加**（`core/videoEdit/authorEffects.ts`）：`resolveAuthorElementEffects` = 代码效果求值 → 按 key 叠值（素材时间曲线已求值）→ 跳过 `enabled:false` → 末尾接 `addedEffects`；`pose.blur` 仍由运行时最后追加。风格件只按旋钮覆盖。读取容错：越界钳制、类型不对或不属于此空间的参数丢弃、已移除或不适用于此图层的追加效果与代码里已没有的 key 记为 missing 并跳过；写入 `validateAuthorElementEffectOverrides` 按硬范围、LUT、关键帧可用性与插值严格校验，追加 key 不得与代码效果重名（已存在的追加项只改参数时不查）。作者接口 v7 之前的代码不叠加元素效果（读、写、指纹一致）。
- **同一函数**：运行时（图层与调整层）、录制与声明键两种帧指纹、输出复用键（求值后的覆盖）、渲染完成前界面即时读回（`applyAuthorElementEffectOverride` 只凭观察到的代码值）都走这一套。
- **missing**：效果 key 按当前帧代码给出的 key 判（时变效果列表在未给出的帧也显示 missing，含义是“此帧代码没有给出”）；元素只在源码图层 id 全是唯一字面量时才判删除（位置表新增 `staticLayerIds`，TS 与轻量 JS 两个解析器同口径），数据生成或隐藏的元素不凭一帧判删除。
- **edits**：片段 `edits` 记 `param:<键>`、`element:<元素>:<属性>`、`element:<元素>:effect:<key>:<参数|enabled>`、`element:<元素>:added:<key>` 的最后修改者与时间。写入点：参数/关键帧/曲线、元素变换/关键帧、元素效果、三组整体写入、片段通用 `code_parameters/code_curves/element_overrides`、媒体参数选择与生成回填；按前后差异记录，删除即删记录；重置显式删除；覆盖写回源码时删掉被清除元素的记录；源码换版不碰记录。来源：界面入口为 user，应用能力取可信宿主注入的 `operationOrigin.actor`（embedded/external→assistant；无来源的本地适配调用记 assistant），参数不能冒充。
- **读回**：取帧观察每个元素带 `effectStates`（key、id、代码值、实际值、overridden、added、enabled、missing）与元素相关 `edits`，片段带全部 `edits`。
- **实体** `video_edit.code_element`（`videoEditCodeElementReflection.ts`）：`transform`、`properties`（绑定到元素的作者参数）、`effects` 三组可写，`observation` 只读（含 visible/missing/kind/参数声明与值/求值后变换/effectStates/edits）；走 `list/read/change_application_entities`，未新增专用工具。调整层的 properties 不可写，作者接口 <7 的 effects 不可写（动态可用性给出原因）。`selected_code_element` 新增 `elementRef`。后台读写会先打开剪辑并读入代码声明，属性改字体时加载字体库。
- **撤销**：全部经 `editVideoProject` / `updateVideoEditGesture` 进同一剪辑历史；通用事务一次修改一步撤销，执行器另有快照撤销与补偿。

## 持久格式

| 格式 | main → 本单 | 最低可读 |
|---|---|---|
| document.video_edit | 53 → 54 | 53（不变） |
| document.screen_recording | 56 → 57 | 56（不变） |
| code-author-api | 9 → 10 | 10 |
| code-version | 10 → 11 | 11 |
| code-asset | 15 → 16 | 16 |
| subtitle-manifest | 25 → 26 | 25（不变） |
| video-style-library | 9 → 10 | 10 |
| video-style-package | 12 → 13 | 13 |
| video-preset-package | 13 → 14 | 14 |
| video-effect-library | 6 → 7 | 7 |

后四种是合并 U14 后才出现的连带：U14 的风格件代码快照内嵌 `codeMaterialVersionSchema`，接受作者接口 v10 后指纹变化，旧程序会拒绝 v10 快照，故与代码版本/资产同样提高最低可读。每种只升一次，逐版本迁移原样保留内容；10 份新黄金样本由正式生成器生成；基线与发布承诺以 main 为受保护基准只追加（`HENJI_PERSISTENCE_RELEASE_REF=main`，因为本分支 HEAD 的旧版本号已被 main 占用）。

## 验证

- 最终 `npm run verify:changed -- --level L2 <68 个本次文件> --test <24 个直接消费者>` 通过：29 个测试文件 656 项、改动文件 ESLint、渲染层与 Electron 两套增量 tsc、登记格式与黄金样本基线。需带 `HENJI_PERSISTENCE_RELEASE_REF=main`（发布承诺以 main 为受保护基准）与 `NODE_OPTIONS=--max-old-space-size=8192`（默认 4GB 堆跑 tsc 会 OOM）。
- 真实 GPU：`npx vitest run --mode gpu src/features/videoEdit/engine/videoEditContentPrecision.gpu.test.ts` 22 项通过，新增用例用正式作者运行时渲染“代码值 + 覆盖（改值、关掉、追加、调整层改值）”与等价代码，16 位浮点逐像素相等且与未覆盖画面不同。
- `check:author-effects`、`check:persistence-compat`（66 种格式）、`check:assistant-capabilities`（结构、15 项覆盖、31 文件 238 项不变量）、`check:skill-sync`（5 个技能、25 个共享文件）通过。
- 精确测试覆盖：key 生成、显式重复报错、自动 key 让开显式 key 与旧接口顺延；叠加顺序、enabled:false、addedEffects、读取钳制与 missing、写入越界/重名/空间错误；风格件只按旋钮；修剪、两倍速、倒放下曲线锚素材时间；界面写入记 user、一个手势一步、重置删除记录；助手经通用动词读改三组属性记 assistant、越界整组拒绝、一次修改一步撤销；可信操作来源决定 actor；元素 missing 只在静态 id 下断定；隐藏元素写回可见与空组重置；两种帧指纹含覆盖且与等价代码一致；位置表 staticLayerIds 两个解析器。
- 原有问题：`videoEditContentPrecision.gpu.test.ts` 在普通模式下会打印一段 WebGPU validation 提示（main 上同样出现，不影响结果）。

## 审查

三轮独立审查（全新上下文子代理，只给 diff、目标与规则文件）。
- 第一轮 2 重要 6 小：数据生成元素被误判删除 → 位置表 `staticLayerIds`，只在 id 全是唯一字面量时判删除；隐藏元素进入观察改变了选择/批注/复核语义 → 恢复原过滤；媒体参数写入与覆盖写回源码的记录 → 补记与清除；追加 key 撞名 → 默认 `<id>+N`、已有追加项只改参数不查重名、重置优先移除追加项；旧代码在无可见采样帧求 effects → 移回采样检查后；空属性组被拦 → 只在有值时要观察；旧接口自动 key 撞名 → 顺延。全部修复。
- 第二轮 1 重要 3 小：小问题（隐藏元素写回可见、`{ id, ...spread }` 漏判、显式 key 与前面自动 key 的顺序依赖）已修；效果级 missing 凭单帧判断是内在限制，已写清语义。重要一条见下方“需要裁定”，未改。
- 第三轮 1 重要：隐藏元素写空变换组被拒 → 改为只有写入新的几何覆盖才要求观察，已修并补测试。

需要 Claude 裁定：审查认为剪辑与录制的最低可读版本应提高到 54/57——新代码版本默认作者接口 v10，v53 的旧程序读到会因 `apiVersion` 枚举不认识而判“内容无效”（不是“请升级”），且旧程序会忽略 `effects/addedEffects` 导致画面不同；U9 对作者接口 v9 也把剪辑/录制提高到了自身。本单按设计 11.5 与派单“剪辑、录制最低可读不提高”保留 53/56，未改。若改，只需改两处 `minReaderVersion`、迁移注释，并重跑 baseline 与 release-snapshot。

## 遗留与说明

- `src/features/videoEdit/engine/videoEditAuthorModules.test.ts` 有 2 项在 main 上已失败（断言钉死了内置库提示的首项），本单在该文件新增用例时顺带把断言改为“提示列出可用库且含 three@0.186.1”，main 上的同一问题随合并修复。
- 现有 .tsx 仍调用 user 绑定的默认导出（`updateVideoEditCodeElement` 等、`setVideoEditCodeParameter` 等）；U15b 改用 `videoEditCodeElementWriter('user')` / `videoEditCodeParameterWriter('user')` 后删除这组默认导出。
- 隐藏或当前帧不可见的元素不在观察里（保持原语义）：此时变换、属性写值需要先移到可见帧取帧观察；写空组重置、片段 `element_overrides` 通用写入不受限。
- 写入元素效果需要当前帧观察（校验依赖代码给出的 key）；作者参数改动会让上一帧观察失效，直到下一次渲染。
- 需要 Claude 复核：`author-api.md` 新增的“效果身份 key（API 10）”一段措辞；作者约定（保持 id/key、读 edits）留给 U15c。

## Claude 界面接入接口（U15b）

数据（同步读，无需 await）：
- `readVideoEditCodeElementEdit(target)` → `{ element, override, values(求值后变换), parameters, time, program, clip }`；`element.author.effectStates` 是效果块的唯一数据源：`{ key, id('look' 为风格件), name?, codeValues, values, overridden[], added, enabled, missing }`，顺序即链顺序（代码项在前、追加项在后、missing 在末）。追加项与代码项可能同 key（源码后来用了同一 key），列表 React key 用 `${added}:${key}`。
- 已改标记：效果参数 `overridden.includes(param)`；整项 `added`；`enabled === false` 为 fx 关；变换字段看 `override` 是否含该键或 `override.curves[键]`；绑定参数看 `clip.edits['param:<键>']` 或与默认值比较。
- 修改记录：`element.author.edits`（元素相关）、`clip.edits`（全部）：`{ by: 'user' | 'assistant', at: 毫秒 }`，可显示“用户 10-31 14:20 手动改过”。
- missing：`videoEditCodeElementOverrideSummary(projectId, sequenceId, clipId)` → 每个有覆盖的元素 `{ elementId, missing, label, visible, fields, effects?: [{ key, missing }] }`；效果 missing 文案用“此处代码没有这个效果，改动已保留”（时变效果列表只在未给出的帧 missing）。
- 选中：`readSelectedVideoEditCodeElement(instance)`；助手上下文 `videoEditSelectedCodeElementContext` 带 `elementRef`。

写入（`videoEditCodeElementWriter('user')` 返回，全部进同一撤销栈；拖动滑块传同一个 `gesture` 即一步）：
- `updateVideoEditCodeElement(target, patch, { gesture?, time? })`、`resetVideoEditCodeElement(target)`、`toggleVideoEditCodeElementKeyframe(target, key)`、`setVideoEditCodeElementAutoKeyframes(target, enabled)`（变换，沿用）。
- `updateVideoEditCodeElementEffect(target, key, { enabled?, values?, curves? }, { gesture?, time? })`：代码项可改值与 fx 开关；追加项只改值（传 enabled 报错，关掉追加项用重置移除）；参数已有曲线时在当前素材时刻写关键帧。
- `toggleVideoEditCodeElementEffectKeyframe(target, key, param)`：没有曲线时按当前实际值建第一帧，有曲线时收回为当前实际值。
- `addVideoEditCodeElementEffect(target, { id, params, curves?, key? })` → 返回 key（缺省 `<id>+N`）：拖放追加到链末。
- `resetVideoEditCodeElementEffect(target, key)`：追加项整项移除；代码项回到代码值并重新启用。
- `writeVideoEditCodeElementGroups(target, { transform?, properties?, effects? }, gesture?)`：三组整体替换（空组即重置）。
- 绑定参数仍用 `videoEditCodeParameterWriter('user')` 的 `setVideoEditCodeParameter` / `resetVideoEditCodeParameter` / 关键帧函数。
- 可写性：效果块在作者接口 <7 不可用、调整层没有属性组，与实体 `getPropertyAvailability` 同一判断（`unavailable` 原因文案可直接显示）。
- 效果参数的定义、分组、显隐与说明用内置效果登记表（与片段效果控件同一份）；风格件项只露出 `codeValues` 里的旋钮。

## 审查修复 1（11-01，按 review-U15a.md 末节裁定）

摘要：裁定 1–7 全部修好并各补针对性测试；合入 main（ticket 10、U6、U11）后本单各格式在 main 之上再升一版，剪辑/录制最低可读等于新版本；独立审查一轮，1 条重要（导入、放进时间线的 LUT 校验过严）与 3 条小问题已修。

提交（均在 `task/19-U15a-点选宿主`，未推送、未合并到 main）：`3997cacf1` 修复；`92273d547` 合入 main 并顺延版本；`07e36e662` 独立审查意见修复，并拆出 `videoEditCodeElementWrites.ts` 消掉本分支此前引入的静态导入环（实体层与片段执行器只依赖读回/写入模块，不再经过助手交接与批注；`videoEditCodeElementEditing` 继续转出，界面导入不变）。

- **1 最低可读**：剪辑 55、录制 58 的最低可读等于自身（迁移注释写明：旧程序不认识作者接口 11 会判内容无效，且会忽略效果覆盖、画面不同）；设计 11.5 前提与第 12 节那一行已改。
- **2 整组校验**：写入按“代码值 + 覆盖”整组 `normalizeVideoEditBuiltinParams`（含调色 `hsl_*_start ≤ hsl_*_end`），静态值与每个关键帧时刻都查，缓动/贝塞尔段内再均匀取样；风格件按旋钮映射后整组解析。读取整组不合法时代码项退回代码值（`overridden: []`），追加项记 missing 跳过，不抛错（核心用例 + 真实 GPU 用例：非法组合与未覆盖画面逐像素相等）。
- **5 素材项与代码资产**：`video_edit.item.element_overrides` 写入、代码资产导入、放进时间线（`makeVideoEditItemClip`）都走 `validateCodeElementOverridesWithoutObservation`（同一校验里与观察无关的部分：作者接口版本、追加效果整组参数、关键帧；只查相对原值改动的项）。代码效果 key 及其参数没有观察无法校验，放进片段后由元素写入校验、读取容错。LUT 存在性只在主动写入素材项时检查；导入（资产不带 LUT）与放进时间线（LUT 可能事后删掉）缺 LUT 按读取容错。素材项属性说明补了效果字段。
- **3 预渲染段键**：`videoEditRenderPictureClip` 剔除 `edits`。
- **4 修改记录键**：`codeEditKey` 逐段转义 `%`/`:`，`codeEditOwner` 按段解析；`codeElementEdits`、`dropCodeElementEdits` 不再按前缀匹配（`a` 与 `a:b` 互不串）。常见名字不转义，键仍可直接读。
- **6 key 冲突（选“自动换 key”）**：源码后来用了追加项已占的 key 时，读取、渲染与写入统一把追加项换成 `<效果 ID>+N`，代码项保留原 key（`codeElementAddedEffectKeys`）；经元素写入或片段整体写入落盘新 key，原 key 下的修改记录跟着改名、作者不变。新追加的效果与代码 key 重名仍拒绝（重名豁免只给读回后的 key）。
- **7 调整层可写性**：位置表新增 `adjustLayerIds`（TS 与轻量 JS 解析器同口径，作者接口 ≥ 9 才算调整层）；`videoEditCodeElementKind` 有观察看观察、没有看源码静态声明。properties 可写性与写入一致；源码静态声明的普通图层隐藏时也能改几何，只有数据生成且当前帧没有观察的元素才要求先取帧观察。
- 原有问题：`videoEditAuthorModules.test.ts` 断言放宽是 main 上的原有失败，已写入 `3997cacf1` 正文（合并后与 main 一致）。合并时另把两处钉死“当前作者接口 = 10”的测试改为读 `CODE_AUTHOR_API_VERSION`，`authorVersion.test.ts` 的样片补固定版本用例改为指定那一步迁移前的历史样本。

### 最终版本表（相对 main `dbf86bba4`）

| 格式 | main → 本单 | 最低可读 |
|---|---|---|
| document.video_edit | 54 → 55 | 55 |
| document.screen_recording | 57 → 58 | 58 |
| code-author-api | 10 → 11（效果 key 门槛 11） | 11 |
| code-version | 11 → 12 | 12 |
| code-asset | 16 → 17 | 17 |
| subtitle-manifest | 25 → 26 | 25（只新增可选字段） |
| video-style-library | 10 → 11 | 11 |
| video-template-library | 7 → 8 | 8 |
| video-style-package | 13 → 14 | 14 |
| video-preset-package | 14 → 15 | 15 |
| video-effect-library | 7 → 8 | 8 |

模板库是合并后才出现的连带：模板代码快照内嵌作者接口枚举，接受 11 后指纹变化。每种只升一次、逐版本登记；新黄金样本由 `generate-persistence-fixtures` 生成，基线与发布承诺由正式脚本写入（`HENJI_PERSISTENCE_RELEASE_REF=main`，只追加）。

### 验证

- `verify:changed -- --level L2`（本轮 38 个文件 + 20 个直接消费者测试，620 项）通过：精确 Vitest、改动文件 ESLint、两套增量 tsc、依赖图、主进程传递导入、登记格式与黄金样本基线（`HENJI_PERSISTENCE_RELEASE_REF=main`）。
- 两套 tsc 通过；真实 GPU `videoEditContentPrecision.gpu.test.ts` 23 项通过（含新增“组合非法覆盖”）。
- `check:author-effects`、`check:persistence-compat`（66 种格式）、`check:assistant-capabilities`（238 项不变量）、`check:skill-sync` 通过。
- 新增用例：color_grade 起点 > 终点（写入拒绝、关键帧与缓动段、读取退回不抛错）；素材项写入/放进时间线/资产导入同一校验；元素 id 含冒号的记录；追加 key 冲突换名与记录跟随、重名不可绕过；预渲染段键不含 edits；未观察调整层的可写性；两个解析器的 `adjustLayerIds`。

### 审查


独立审查一轮（全新上下文，high）：重要 1 条（导入、放进时间线按目标工程 LUT 严格拒绝）已改为只在主动写入时查 LUT；小问题 3 条（重名豁免可被绕过、缓动段漏检、片段整体写入不移动记录）已修。未改、已知限制：换名依据当前帧的代码效果 key，`effects(t)` 时变时追加项的 key 可能随帧不同（经写入落盘后稳定）；组合非法退回代码值时观察里不区分“没有覆盖”与“覆盖被拒”，U15b 如需提示可再加标记。

### 原有问题（本单更早一轮引入，未改）

`src/features/videoEdit/VideoEditCodeElementEditOverlay.test.tsx:139`、`:148` 仍断言源码里不存在的 `gone` 元素 `missing: false`；U15a 早先已改为“源码图层 id 全是字面量时，不在其中即 missing”，这两处断言应改为 `missing: true`（`:148` 的 label 随之为“元素已不存在”）。该文件是 .tsx，本轮按要求未改，也未计入本轮 verify。
