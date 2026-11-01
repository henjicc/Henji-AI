💡 Ticket 10（文字排版）合并前第三轮审查：第二轮之后的修复增量

范围：worktree D:\VibeCode\Henji-AI-t10，HEAD a6ef9c98b。本票在 1d2655170 之后的自有提交：b45442a2e（第二轮修复，同时合入 main c9ec3f324）、4aea54b1c、7d2b9def5、2c3022516、63b13bc5c、71358ecc7；另有合并提交 6e23409c0、f5b287556、ebd46afea、a6ef9c98b，其中只看持久版本顺延的部分。合入 main 带来的改动不审。

只读。实际运行的只有这些：
- 只读 git；
- 两个放在 scratchpad 的 vite-node 探针，直接调用 worktree 里的 `readStaticTextFonts` 和 `resolveTextFontPreparation`；
- 一个精确 vitest：textFontPreparation.test，4 项通过；
- 读取 `.tmp/text-layout-preflight/fix3-paired-final.json`。

没跑 GPU，没启动开发版。

## 逐条结论

| 条目 | 结论 |
|---|---|
| A 导出不再复制字体目录 | **已修好**。导出时 `captureSnapshot` 只返回一份清单：路径、索引、大小与修改时间。字体按需从原位置读，读前和读后各核对一次签名；没读之前文件变了或被删，都报“字体在导出期间被修改”。会话缓存挂在 `readFixedFontPayload` 的 WeakMap 上。临时目录、`releaseSnapshot` IPC、will-quit 监听都已删干净，全仓 grep 没有残留。`disposeFonts` 已进 `bindApplicationShutdown`。IPC 的 strict schema 与 `FontFaceInfo` 字段逐一对得上。 |
| B 参数文字按实际字符准备 | **修好但留有缺口**（重要 1），并**引入新问题**（重要 2）。审查要求的三种写法（`params.text.slice`、模板字符串、`JSON.parse(...).map().join`）都正确：探针确认 slice 情形拿到的是参数的完整默认值“★①한𠀀”，没有退回完整候选集。真正的动态数据会预载完整默认候选，而且 `defaultTextFonts` 的 `all` 现在包含全部书写系统。`order` 只取决于字素本身，所以“字符落在固定次序里第一个覆盖它的候选”这一条成立。 |
| C 只对新版文字模块预检，旧 API 零开销 | **行为已修好**。性能证据的基线有问题，见小问题 3（待确认）。<br>- `needsVideoEditTextPreflight` 只在内容更新时判断一次。旧 API 不建提交链、不进预检。Worker 端 `authorBundleShapesText` 同步跳过，输出键与 main 相同。Worker 不再随每次文档更新重建 `VideoEditCodeFingerprint`。<br>- 预检按“修订号 + 准备声明”去重，较早帧的预检不会被后来的帧中止。证据里修复后取消数为 0，`prepareText` 旧工程 0 次、文字工程 1 次。<br>- 2c3022516 和 63b13bc5c 补了切换期间的过期帧判断，逻辑正确。 |
| D 退出绕开统一退出列表 | **已修好**。快照目录已经不存在，无须再做启动清理。 |
| E 历史快照常量 | 按裁定不修。快照已改为作者接口 9，库为 henji-layout 1.2.0、henji-effects 1.3.0、three 0.186.1、opentype.js 2.0.0。已核对 ea972d1ec 的 `codeAuthorVersions` 和 `authorLibraries` 完全一致。main 之后只多了 d6ba6f99f 一个文档提交。 |
| F 两份匹配实现 | **已修好**：`resolveFont(name, faces)` 只留一份实现。 |
| G 迁移注释 | **已修好**。新增的 10 处迁移都写了 N → N+1。 |
| H 迁移测试放宽 | **已修好**。恢复 `toEqual`，期望值显式组合 `migrateVideoAuthor`、`migrateRecordingAuthor`、`migrateStyleAuthor`、`migrateStylePackageAuthor`。 |
| I 变量字体族未准备时逐帧抛错 | **已修好**：回退到默认字体，只记一次诊断。 |
| J 测试用的 bundle 不真实 | **已修好**：测试 bundle 带 `libraries`，其中纯 GPU 用例带 three。 |
| K Pretext 许可登记 | **已修好**：`components.json` 指向 chunk-KEGFWR6E.mjs，该文件里确实有 Pretext 和 Intl.Segmenter。chunk-FW4NF3SJ.mjs 是 0 字节，但已登记在 release.json，被 text.mjs 和 flex-runtime.mjs 引用，属于 esbuild 的空公共块，不算问题。 |
| 阻塞 1：API 9 调整层样片 | **已修好**。`HISTORICAL_PREVIEW_AUTHOR.apiVersion = 9`。GPU 用例用 main 的 v52、v55 黄金样本做迁移，断言迁移后为 API 9、观察到 vignette 调整层、有非零像素。<br>备注：基线和结果两次渲染都强制 `apiVersion` 为 9，并且走同一个 `resolvePreviewAuthor`，所以“逐像素不变”是构造出来的。真正起保护作用的是 `after.apiVersion === 9` 和“adjust 可执行”这两条断言。足够用，但不是独立对照。 |
| 阻塞 2：旧 API 拖动 P95 | **代码层面已修好**：逐帧路径不预检、不往返、不额外求值，有精确测试覆盖。性能数据的问题见小问题 3。 |
| 持久版本顺延 | **正确**。<br>- 版本号：剪辑 53→54、录制 56→57、风格库 9→10、风格包 12→13、代码版本 10→11、代码资产 15→16、作者接口 9→10、模板库 6→7、效果库 6→7、预设包 13→14。每种只升一次，迁移都登记在 main 版本之后。<br>- 最低可读版本都随之提高。模板库从 3 直接跳到 7，理由是模板可以带 API 10 代码，成立。<br>- `releasedCompatibility.json` 按结构逐键比较：0 删改，只有 30 条追加（versions、readers、samples 各 10）。<br>- `tests/fixtures` 相对 main 只有新增，没有修改或删除。 |
| 自报问题：样片摘要把未导入的库也算进去 | **成立**，见小问题 1。 |

## 重要

### 1. 和参数拼接的模块常量里的字面量没有被准备，会画成方框（B 的缺口）
- 位置：`src/core/videoEdit/codeMaterial/textFonts.ts:129`（`inputs`）和 `:136`（`knownText`）。
- 触发输入（探针实测）：
  - 模块级 `const MARK = '★①'`，调用 `layoutText(params.label + MARK)`；
  - 模块级 `const ICONS = ['✓','한']`，调用 `` layoutText(`${params.label}${ICONS[0]}`) ``；
  - 同类写法还有 `params.items.map(i => i.name).join(SEP)`，其中 `SEP` 是模块常量。
- 结果：
  - 前两例 `dynamicText` 都没有置位，准备文字只有 `["A"]` 或 `["","A"]`；★、①、✓、한 都不在里面，也不会退回完整候选集；
  - 运行时 `choose` 只在已加载的候选里找，按第二轮的探针，这类字符返回 missing，也就是方框。运行时这一步是推断；准备集缺字已经实测。
- 原因：两个遍历器的解析口径不一样。
  - `knownText` 会经 `resolve()` 跟进模块常量，于是判定为“已知文字”；
  - `inputs` 只遍历原始表达式，不跟进常量，所以常量里的字面量没有收集进去。
  - 第二轮时同一写法会走“仅样本”路径，同样缺字，所以这不是本轮新引入的问题，而是 B 的修复没有覆盖到。
- 建议：把分类和收集合成一个遍历：在 `knownText` 走到字面量时，把字面量（含 resolve 之后的）推进 `declaration.text`；或者让 `inputs` 也经过 `resolve`。补上面三种写法的测试。

### 2. 非文字的布局值被当成动态文字，整套默认候选被预载（b45442a2e 引入）
- 位置：
  - `textFonts.ts:178`：tree、row 等角色里，任何非字面量的值都调用 `collectDynamicText`；
  - `:212`：除字体键以外的所有键都按 tree 递归；
  - `:219`：`layoutTable` 的全部参数（包括第二个参数，即排版选项）都按 tree 扫描。
- 触发输入（探针实测）：
  - 表格选项 `layoutTable({...rows:[{a:'收入'}]}, { width: ctx.width - 240 })`，得到 `dyn: true`；改成 `width: 800` 则不置位；
  - 列宽 `columns: [{ key: 'a', width: ctx.width / 2 }]`，得到 `dyn: true`；
  - flex 节点 `id: 'r' + i`，得到 `dyn: true`。
  - 第二轮时（1d2655170）同样的代码不会置位：那时 tree 里的非对象值直接忽略，只有 rows、row 才算动态。
- 后果：
  - 文字本来全是字面量的模块，被迫为默认 4 个字形（400/700 × 正常/斜体）各预载完整默认候选；
  - 本机这批候选（雅黑、宋体、SimSun-ExtB、正黑、细明、Yu Gothic、MS Gothic、Malgun 等）常规体约 150 MB 量级，四个字形合计粗估 270 MB 级字节要进 Worker；
  - 这正是第一轮第 5 条（预载过多）的回退，也不符合 B 裁定“只有既非字面量也非参数的动态数据才退回完整集”。尺寸、列宽、id 都不是文字数据。
  - 只影响性能和内存，不影响正确性。
- 建议：
  - 只在承载文字的位置调用 `collectDynamicText`：text、cell、`text/content/title/label` 键，以及 children、rows 这类容器本身是非字面量时；
  - 对 `width`、`id`、选项对象之类的数值或标识位置，直接忽略；
  - `layoutTable` 的第二个参数不按 tree 扫描；
  - 补“计算出的宽度和 id 不触发完整候选”的测试。

> 两条都只在 `readStaticTextFonts` 的一个静态分析函数里，修复是局部的，不涉及方案层面。不过这是第 3 轮，按规则请主代理判断：修完这两处再合并，还是先告诉用户。

## 小问题

### 1. 样片和模板摘要把没导入的库按“该接口最新版”算进身份（自报问题，成立）
- 位置：`src/core/videoEdit/codeMaterial/authorVersion.ts:19` 与 `:28`；调用方是 `styleSchemas.ts:90/98`。
- 原因：`resolvePreviewAuthor` 在显式 apiVersion 时取 `{...latestAuthorLibraryVersions(api), ...pin.libraries}`，而 `pinPreviewAuthor` 只记录实际导入的库。于是 API 10 样片的摘要里包含 three、opentype.js、henji-effects 的“当前最新版”。
- 影响：以后只要发行一个兼容接口 10 的新库版本，所有 API ≥10 的风格样片都会被判为 stale（`videoEditStyleLibrary.ts:125/189`）。模板下次保存时也会因为摘要变化而升版本（`:163-164`）。
  - ticket 19 的 U16 计划冻结新版 henji-effects，所以合并后很快就会触发一次。
  - 后果只是误报“需要重渲”和版本号白升，不丢数据。
- 建议合并前修：摘要只纳入 `importedAuthorLibraries` 的结果。发布后再改摘要公式，本身会让所有样片 stale 一次。

### 2. 旧 API 的 present 与 main 仍有一处行为差异
- 位置：`videoEditRenderTransport.ts:512/521`。
- 差异：`contentEpoch` 判断对所有工程都生效。旧 API 帧如果要等 `syncFonts`（拖动跨片段时字体范围变化），等待期间又来了 `updateDocument`（拖参数），这一帧会返回 skipped；main 会照常出画。
- 影响：调用方会重新请求，影响很小。内部第 3 轮审查已确认其他 present 调用方都先更新内容再出画。这里记下，供“旧接口与 main 等价”的结论参考。

### 3. 待确认：C 和阻塞 2 的配对 A/B 以含回归的 1d2655170 为基线
- 证据：`fix3-paired-final.json` 里 before 侧以及 A/A 的 control-a、control-b（都用 before 源码）的计数显示，旧 API 工程每轮有 `prepareText` 1,252 次、`code.source` 402 次。也就是说，基线本身就带着第二轮 C 指出的逐帧往返和重复装载。
- 推论：B−A ≤ 噪声只能说明修复后不比带回归的版本慢，不能直接证明与 main 等价。同一组数据里，A 多出 1,252 次往返，P95 却和 B 相同，说明这套测量对一次 Worker 往返不敏感。
- 已有的保障：旧 API “零开销”有代码结构和精确测试支撑（不调 prepare、不发 prepareText、输出键不取文字身份），实际风险低。
- 需要 Claude 判断：是否要求以 main（ea972d1ec）为基线补一组旧 API 的 A/B。

## 安全
没有误伤五条硬底线：
- 新的 `fonts:read{source}` 由渲染层回传文件路径，主进程按这个路径读取。仍然经过 contracts、adapter、preload、`registerIpcHandler` 和 `assertTrustedApplicationSender`，也有 strict zod 校验；
- 没有新增绕过 preload 的通道；
- 按规则，“限制放得太开”不报。

## 实际读过 / 没读到
**读过**：
- 第二轮报告 review-round2.md、review.md 两节裁定、result.md 两节修复记录；
- 6 个自有提交的 diff，以及 4 个合并提交的提交信息；
- 字体相关：electron fonts 的 ipc、service、scanner、worker 和测试的增量，preload，platform 下的 fonts、textFontSnapshot、contracts、adapter，`core/fonts/catalog`；
- 静态分析与字体会话：textFonts.ts 全部静态分析部分，textFontPreparation.ts，fontSession.ts 的候选、defaultTextFonts、prepareDeclaration、order；
- 渲染链路：RenderTransport 的字体与 present 全段，TextPreflight 全文，videoEditWorker 相对 main 的完整差异，AuthorTextResources、Programs、Runtime、CodeFingerprint、CodeOutputKey、CodeSources 的增量；
- 持久化：formats、formatMigrations、schemaVersions、versionedJson、两个文档 kind、authorVersionMigration、authorVersion、styleSchemas 摘要，`releasedCompatibility.json` 结构比较，fixtures 的 name-status；
- 测试：mergedEffectsMigration、effectRegistrationMigration 两个测试的增量，ContentPrecision GPU 用例与 videoEditStyles 用例的增量；
- 许可与冻结：components.json，冻结目录的文件列表与块引用；
- 性能证据 JSON 的 gate、rows、requests、skipped 字段。

**没读到**：
- 冻结产物 chunk 的完整内容；
- henji-layout 2.0.0 重冻后 release.json 的逐项哈希（没有复算）；
- scripts/text-layout-* 实验脚本的全文和 experiment.mjs 的测量细节（只看了 side 与 apiVersion 的分配）；
- 新增黄金样本的逐字段内容，schemaBaseline.json；
- 技能文档改动的全文；
- shaping、textPlan、RenderSession 等测试的全文（只看了与本轮相关的用例）；
- 没有在真实字体环境里跑重要 1 的运行时方框（准备集缺字已实测，方框是推断）；
- 没有测量重要 2 的实际 Worker 内存（体积是按本机字体文件大小估的）。
