# 19-U14 合并前审查（task/19-U14-代码滤镜入库 @ 271a64842）

审查对象：`git diff main...HEAD -- . ':!tickets'`（merge-base d529d407f），3 个提交。只读；未运行测试、GPU、开发版。

## 重要

### 1. 助手经 creation_items 把代码风格件加到“还没有这份代码”的工程时，回执声明不符，整步失败
- 位置：`src/features/videoEdit/application/videoEditExecutors.ts:366`（新增的 `video_edit.effect` 级联声明）对照同文件 `:136-138`（`cascades()` 里代码版本回执）。
- 触发：`create_items` 的 `video_edit.effect`，definition_id 为 `style-member:…`，目标工程里没有可复用的相同源码，`materializeVideoEditStylePiece` 新建了代码定义与版本。
- 原因：回执的 declarationId 由 `` `video_edit.code_${entityType.split('.').at(-1)}_${effect}` `` 拼出，`video_edit.code_version` 得到 `video_edit.code_code_version_create`；而新加的声明写的是 `video_edit.code_version_create`。`executionSupport.ts:85-93` 按 declarationId 严格比对，会抛 `UNDECLARED_CASCADE_EFFECT:video_edit.code_code_version_create`，然后补偿回滚。撤销方向（`restore` → `..._delete`）也一样。补偿只回滚文档，已经由 `prepareCodeVersionPublication` 写到工程代码存储里的文件留成孤儿：抛错发生在 `apply()` 的 try 之外，`discardVideoEditCodeFiles` 走不到。
- 测试为什么没发现：`videoEditCodeService.test.ts` 里通用创建那一步发生在界面入口已经导入过同一份代码之后（断言 `codeMaterials` 长度为 1，属于复用），没有覆盖“新建定义”的情况。这条结论来自读代码，没有实际跑过。
- 建议：声明改用同一套命名 `video_edit.code_code_version_${effect}`（与 `video_edit.code_material` 集合的声明保持一致），并补一条“目标工程无同源代码”的通用创建用例。

### 2. 整体改写定义时，调用方可以去掉代码快照的外来来源（洗成本机）（待确认严重程度）
- 位置：`src/features/videoEdit/application/videoEditStylePieceDefinition.ts:11-24`（`codeSnapshots` 原样取自输入），`videoEditEffectPresetReflection.ts:113-118`（修改路径）；同类：`videoEditStyleReflection.ts:59`（`video_edit.style.effect_presets` 写入器直接 `videoEditStyleSchema.parse`）。
- 触发：读到一个外来风格件的 definition（快照 `version.foreign` 有值），助手调旋钮或改名后整份写回，但漏写或去掉了 `version.foreign`。schema 里 foreign 是可选字段，写回能通过，之后应用和预览都按本机代码执行，不再询问。
- 原因：外来标记应当只由导入边界产生，写入路径不该让调用方决定。安全分级第 3 条也规定“助手不能替用户选择”。旋钮和名称只能通过整份 definition 改写，所以“读回 → 整体写回”就是正常使用路径，丢字段的风险是现实的。
- 建议：写入时按源码摘要沿用草稿（或库内任一同内容快照）原有的 `foreign`，或者拒绝去掉已有 foreign 的写入。新成员一律走 `{ref}`，由宿主生成快照。

## 小问题

1. **导入带代码风格件的风格包后，风格被误标为“预览待更新”**：`src/core/videoEdit/styles/styleSchemas.ts:76-78` 的内容摘要把 `effectPresets` 整体算进去，包括快照里的 `version.foreign`；`videoEditStylePackages.ts:57` 导入时补上 foreign，`videoEditStyleLibrary.ts:123` 算出的摘要就和包里不一致，`stale=true`。来源标记不应计入内容摘要，风格本身的 `foreign` 也没有计入。
2. **外部文档导入改成严格解析风格件**：`electron/main/services/documents/foreign-content.ts:14` 对每个风格件调用 `markVideoEditStylePieceForeign`，它会做 `videoEditEffectPresetSchema.parse`（严格模式加完整 superRefine）。在 `forward`（高版本、仍可读）文档里，如果风格件带未知字段，整个导入会失败；原来的实现只做结构标记，不解析。（待确认 `decodeDocumentContent` 对高版本内容是否已经剥离未知字段。）建议像 `codeMaterials` 一样只浅改 `codeSnapshots[*].version.foreign`。
3. **最低可读版本改用了常量**：`src/core/persistence/formats.ts:186,190,198` 写成 `minReaderVersion: VIDEO_EDIT_STYLE_LIBRARY_VERSION / _STYLE_PACKAGE_VERSION / _PRESET_PACKAGE_VERSION`。以后哪怕只加可选字段，也会跟着自动提高，违反 persistence.md 的“只新增可选字段不提高最低可读版本”。main 上写的是字面量 8/11/12，合并时应改为顺延后的字面量。
4. **旧保存入口没删干净**：`videoEditEffectPresets.ts:82-88` 的 `savePreset` 在生产代码里已经没有调用方（只剩测试在用），错误文案“代码滤镜请保存为代码素材”也与新语义矛盾。保存现在有两份实现（`savePreset` / `saveVideoEditStylePieceFromEffects`）。另外 `videoEditStyleCode.ts:442` 的保存借用了 `restoreLibrary`，日志事件记为 `effect_library.restore.*`，排障时会被误读为恢复操作。
5. **外来风格件的预览在用户拒绝后不能恢复**：`VideoEditPresetPlayer.tsx:40` 只订阅 `source.trustContext`，而 effect 类 source 没有这个字段。用户选了“不运行”之后，在预设详情里点“运行”，信任状态变了，但预览不会重建。另外，效果面板悬停提示里的预览、预设面板的格子在首次挂载或悬停时就会弹出外来代码询问。这和现有模板格子的做法一致（待确认是否接受）。
6. **库存储容量**：本机效果库在 localStorage 里，现在会存完整源码闭包和片子数据，容易碰到配额。失败时会报错并保留旧库，不会损坏数据，但与“容量不设硬上限”的方向不一致（待确认）。
7. **列表重算开销**：`VideoEditEffectsLibraryPanel.tsx:56` 的 `useMemo` 依赖 `instance.document`，每次编辑都会对全部风格件（含完整源码）做一次 `structuredClone`，preset 对象身份也跟着变；注释里“同一修订内保持同一份数据”只对效果库修订成立。另外，工程关闭后如果还有一次渲染，`listVideoEditStylePieces` 里的 `requireVideoEditInstance` 会在渲染中抛错（待确认）。
8. **重构时丢了一条安全顺序注释**：原 `videoEditCodeAssets.ts` 里“This check must precede inspectVideoEditMedia, which may authorize a path”这条约束，移到 `videoEditCodeMedia.ts:566` 后注释没了，代码顺序还在。
9. **台账与事实不符**：`docs/rules/assistant-status.md:6` 写着“界面……本轮不改 TSX”，但后两个提交已经改了 TSX。另外 `videoEditEffectPresets.ts:1070` 用了内联 `import('@/core/videoEdit/document')` 类型，可以改成顶部导入。

## 原有问题（非本单引入）

- `repository.ts:196` / `package-service.ts:550` 只对 `video_edit` 类文档打外来标记；录制会话文档嵌入了剪辑内容（含代码定义和风格件），外部导入时不会被标记（待确认录制会话是否走外部导入入口）。
- 两个入口对“没有可用片段”的处理不同：双击给短通知，拖放走 onError。

## 核查结论（按重点）

1. **外来代码**：分享风格包、剪辑预设包、外部文档与工程导入都覆盖了快照来源；编译前 `ensureCodeContentTrust` 先询问，读声明（`compileVideoEditCode`）、试渲染、预览都在询问之后；本机保存不打标记；复用时 `jsonEqual(candidate.foreign, version.foreign)` 保证来源不会被洗掉。缺口见重要 2、小问题 1、2、5。
2. **快照与导入**：所有源码都有 SHA-256 校验、能重建固定依赖闭包、复用身份含作者 API、库版本与来源；失败时整组不发布，并补偿写入的源码文件；界面入口一步撤销。媒体与片子数据依赖都能重映射。助手入口失败见重要 1。
3. **旋钮映射**：number/angle 按声明硬范围校验；只移除被映射参数的曲线，其他参数与曲线保留。
4. **助手能力**：沿用通用 create/change，没有新增工具；读回不含界面可见的内部 ID（`style-member:` 是不透明令牌）。风格包成员写入不支持 `{ref}`，只能手写快照（与界面同样没有入口，可接受，但相关的洗白风险见重要 2）。
5. **界面**：双击、Enter、拖放、预设面板都走 `applyVideoEditStylePiece`；按“全局 / 风格名”分组；同时订阅效果库修订与剪辑领域修订；进行中不重复应用；失败走 onError；预览复用 `VideoEditPresetPlayer`。没有原生控件、硬编码颜色和 emoji。旧同步入口只剩 `savePreset`（小问题 4）。
6. **持久格式**：每种格式只升一版（剪辑内容 49、录制会话 52、效果库 4、风格库 8、风格包 11、预设包 12），迁移按原样逐版本写，黄金样本与发布承诺只增不改。**合并时需要顺延**（main 已到剪辑内容 50、录制会话 53、效果库 5、预设包 12、风格库 8、风格包 11）：剪辑内容 → 51（min 51）、录制会话 → 54（min 54）、效果库 → 6、剪辑预设包 → 13、风格库 → 9、风格分享包 → 12。六份黄金样本文件名、`releasedCompatibility.json`、`schemaBaseline.json` 都要重新生成，`formatMigrations.ts` 里的迁移键要接到 main 的新版本之后。

## 设计符合度

第 10 节的六条大体都实现了。偏差：最后一条“同时接上 ticket 13 交回的 `StylePicture`、模板预览接线”没有做（提交说明的理由是“效果面板只需风格件预览”），需要 Claude 确认是否另开单。第 12 节的格式清单与本单一致。第 13 节“风格件 | 全局 / 当前风格包”已实现（分组只在存在风格成员时出现）。

## 读过的范围

完整读过 diff 里的非样本文件；对照读了 `executionSupport.ts` 级联校验、`contentTrust.ts`、`compileVideoEditCode`、`codeMaterialSource`、`VideoEditPresetPlayer`、`videoEditPresetPreview.ts`、`editComposite`、`videoEditStyleLibrary.saveStyle`、风格内容摘要、`foreign-content` 调用方，以及 main 上各格式的现行版本。没有读：黄金样本 JSON 的内容、`schemaBaseline.json` 的细节、规则文件全文（只按任务说明里的要点核对）、`VideoEditPresetsPanel` 的应用进行中保护。所有结论都来自读代码，没有运行任何测试。

## Claude 裁定（11-01）
全部处理：
1. 级联回执 id 拼写不一致 → 声明与回执用同一个构造函数生成（不两处拼字符串），补“目标工程里没有这份代码”的助手通用创建用例；源码写入放进补偿范围，失败不留孤儿文件。
2. 整体改写定义可去掉外来标记 → 宿主不信任调用方给的 `version.foreign`：按源码摘要沿用已有标记（已有外来的保持外来），调用方不得直接写入新的原始快照，新成员只能用 `{ref}` 由宿主生成快照；风格包成员写入同样支持 `{ref}`。补测试：漏写 foreign 的整份写回仍是外来、执行前仍询问。
3. 内容摘要排除来源标记（外来/本机），导入后不误标“预览待更新”。
4. 外部文档导入的风格件解析恢复前向兼容（未知字段保留，按 persistence.md 第 3 条），不整体失败。
5. formats.ts 最低可读版本按 main 惯例写顺延后的字面量。
6. 删掉无人调用的 savePreset 与过时文案；保存用正式保存操作，日志记“保存”。
7. 外来风格件选“不运行”后在预设详情点“运行”要重建预览（只改 .tsx 里的这处逻辑，不改外观）。
8. 本机效果库存在 localStorage，存完整源码会撞配额（违反“容量不设硬上限”）→ 代码快照的源码内容放进现有内容寻址的代码存储（磁盘），效果库只存摘要与引用；读取、导出分享包、导入时按摘要取回；按 persistence.md 迁移（与第 10 条同一次升版）。
9. 每次编辑不再克隆全部风格件源码，只复制改动项。10. 补回丢失的安全顺序注释。11. assistant-status.md 按实际（改了 TSX 的两处）更新。
原有问题：外部导入时录制会话里嵌入的代码也要打外来标记（安全分级第 3 条同源缺陷，一并修，补测试）；双击与拖放在“没有可用片段”时统一用同一种提示。
设计第 10 节 StylePicture：ticket 13 合并时模板预览已接上，效果面板用 VideoEditPresetPlayer，不存在重复实现，视为完成，不另开单。
持久版本：合并前 `git merge main`，按 main 当时下一号顺延（现在 main：剪辑 51、录制 54、本机效果库 5、预设包 12、风格库 8、风格包 11），每种只升一次。
