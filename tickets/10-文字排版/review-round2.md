💡 Ticket 10（文字排版）合并前第二轮审查：修复增量

范围：`git diff b7df3d5ca 1d2655170`，只看 t10-fix-files.txt 和 t10-both.txt 里的持久格式部分。只读。实际运行过的只有：只读 git，冻结清单 SHA-256 核对，以及一个放在 scratchpad 里的 Node 探针（直接加载冻结的 `font-session.mjs`，读取本机 C:\Windows\Fonts）。没跑 vitest、GPU，也没启动开发版。

## 逐条结论

| 条目 | 结论 |
|---|---|
| 1 默认 400/700×正常/斜体、静态提取、同族最近匹配 | **已修好**（遗留一处待确认，见小问题 I）。预览、导出、指纹三处用同一组声明、同一参数、同一份冻结的 `matchPrepared`，结果一致。 |
| 2/8 历史快照取 effects 1.3.0；新写入记 API 8 | **已修好**。快照与 main `latestAuthorLibraryVersions(7)` 完全一致；`pinPreviewAuthor` 缺省取 API 8，显式 API 缺库时取该 API 的最新库。合并顺序有风险，见小问题 E。 |
| 3/4 候选表、通用名、评分、选脸进冻结 2.0.0 | **已修好**。`font-session.mjs` 已列进 release.json outputs，含 Nirmala、Consolas、`matchFontFace` 和 `choose`。宿主只按 `version` 动态导入冻结策略，没有不带版本的调用方。337 项 inputs 与当前源码逐个吻合，19+ 个 outputs 哈希全部一致，没有清单外文件。对静态已知文字，“字符落在固定次序里第一个覆盖它的候选”成立。动态文字不成立，见重要 B。 |
| 5 只准备文字模块、懒加载、不留第二份 | **修好但引入新问题**（重要 B）。`bundle.libraries` 只记实际解析到的库，所以纯 GPU 模块确实不取租约；主线程也不再缓存字节。但懒加载对内容未知的文字会缺字。 |
| 6 轮廓与 Path2D 按软预算 LRU | **已修好**。 |
| 7/13 导出固定字体、1.x 不 reset、录屏产物也固定 | **修好但引入新问题**（重要 A、小问题 D）。语义是对的：reset、订阅、fontKey、1.x 宿主字体都改走固定快照。代价是每次导出都整目录复制字体。 |
| 9 入队前等字体、可取消 | **修好但引入新问题**（重要 C）。 |
| 10 升级提示与技能 | **已修好**。 |
| 11 release.json 路径 | **已修好**：0 条绝对路径或 `../`。重冻带“main 已有此版本就拒绝”的保护。 |
| 12 许可清单 | **已修好**：许可文本与冻结目录 sources 内容一致。有一个极小的登记偏差，见小问题 K。 |
| 附加：outputKey 并入文字身份 | **已修好**（`videoEditCodeSources.ts:562` 的 `authorTextIdentity`）。 |
| 附加：frameKey 准备参数字体 | **已修好**（`videoEditAuthorPrograms.ts:108-110`）。 |
| 持久版本顺延 | **正确**。剪辑 50→51、录制 53→54、风格库 8→9、模板库 6→7、风格包 11→12、code-version 8→9、code-asset 13→14、作者接口 7→8：每种格式只升一次，迁移都登记在 main 版本之后，最低可读版本等于新版本（因为会写 API 8，这样提高合理）。`releasedCompatibility.json` 相对 main 只有追加，没有删改。main 的历史样本一个都没改，新样本 8 份全部是新增。注释缺口见小问题 G，测试放宽见小问题 H。 |

## 重要

### A. 每次导出都把整个系统和用户字体目录复制到临时目录（第 7、13 条的修复带进来的）
- 位置：
  - `src/features/videoEdit/engine/videoEditRenderTransport.ts:332`：fixedTextFonts 时无条件调用 `fonts.list(true)`；
  - `electron/main/services/fonts/service.ts:90`：`faces: this.faces`，即全部字体；
  - `electron/main/services/fonts/scanner.ts:65-80`：逐个文件 `copyFile`；
  - `videoEditRenderTransport.ts:163`：`applyFonts` 等这份快照，`ready` 也就跟着等。
- 触发：任何剪辑导出，或录屏产物导出（`recordingProductService.ts:75`，哪怕只是导出单帧步骤图）。文档里没有字体、没有代码也一样会复制。
- 规模：本机 `C:\Windows\Fonts` 2.9 GB，`%LOCALAPPDATA%\Microsoft\Windows\Fonts` 1.8 GB，每次导出开始前要先复制约 4.7 GB。
- 后果：
  - 导出起步慢几秒到几分钟，还持续写 SSD；
  - 字体 Worker 串行处理这次复制，期间预览的字体读取全部排在后面；
  - 临时盘空间不足、复制过程中某个字体文件签名变化（会报“字体目录在创建快照时变化”）时，`ready` 失败，整次导出失败，跟文档用不用字体无关；
  - 没有启动时清理，崩溃或退出竞态（见 D）后，GB 级的 `henji-font-snapshot-*` 会一直留在 %TEMP%。
- 原因：为了“包含尚未读取的字体”，选了复制全部文件。
- 建议：快照只记目录元数据和签名，读的时候按需复制或读取（读前核对签名，变了才回退到读时复制的副本）；或者只复制冻结策略可能用到的候选族加上文档实际引用的字体。文档没有 API 8 文字时，不取快照。

### B. 内容静态读不出的文字（打字机 `params.text.slice()`、模板字符串、数组和 JSON 数据）在 ★ ✓ ① 韩文和生僻汉字处缺字（第 5 条懒加载带进来的，同时让第 4 条的性质在动态文字上失效）
- 位置：
  - `src/core/videoEdit/codeMaterial/textFontPreparation.ts:45`：内容未知时只加样本 `Aa汉あ😀`；
  - `src/core/imaging/vectorContent/shaping/fontSession.ts:147-157`：只对这些字素逐个加载“第一个能覆盖的候选”；
  - `fontSession.ts:192`：`choose` 只在已加载的候选里，按该字素自己的次序找。
- 实测（Node 探针，冻结 font-session.mjs + 本机字体）：
  - 文字为 `['Aa汉あ😀']`（动态文字的实际准备形态）或 undefined 时，链里只有 Arial、Microsoft YaHei、Yu Gothic、Segoe UI Emoji。`★`、`✓`、`①`、`한` 全部返回 missing，也就是画成方框。
  - 同一会话里，把 `★✓①한` 放进声明文字后，它们全部 ok。
- 对比：b7df3d5ca 在内容未知时会加载全部默认候选（含 Segoe UI Symbol、Historic、SimSun-ExtB），这些符号原本能正常显示，所以这是新引入的退化。
- 另一个后果：动态文字里的 ① 能不能显示，取决于同模块别处有没有静态出现过需要 Segoe UI Symbol 的字，又回到了第 4 条要消除的“与同模块其他文字有关”。
- 技能文档只要求作者声明字体，没要求声明 text 或 scripts，作者无从规避。
- 建议：内容未知（dynamicText 或文字参数不是字符串）时，按固定次序预载默认链的全部候选，相当于回到旧行为，只限这种情况；或者至少预载 Symbol、Historic 以及常用书写系统。补一个“动态文字含 ★/①”的冻结运行时测试。

### C. 每帧多一次 Worker 往返的文字预检：会拖慢播放和拖动，参数编辑时反复导入作者模块（第 9 条的修复带进来的，性能部分待实测）
- 位置：
  - `src/features/videoEdit/engine/videoEditRenderTransport.ts:492-501`：只要文档里有代码片段或代码滤镜（**包括全部 API ≤7 的旧工程**），每次 `present` 都要先等一次 `prepareText` 回执，才发 `render`；
  - `src/features/videoEdit/engine/videoEditWorker.ts:227-229`：`renderer.document` 一变（`updateParameters` 每次都替换 document，见 `videoEditRenderer.ts:845`）就新建一个 `VideoEditCodeFingerprint`。它用新的 blob URL 重新导入、重新求值文档里全部作者模块，`videoEditCodeFingerprint.ts:51-60` 每个实例各有一份 `modules`。
- 触发：
  1. 正向播放走两帧流水（`VideoEditPreview.tsx:752`：发出一帧后马上 `wake(0)`），后一帧的 `present` 会在 `:493` 中止前一帧还没回执的预检，前一帧于是答复 skipped。Worker 忙于上一帧时，这会变成跳帧。流水线也因为每帧多了一次往返而失效；`:481` 的注释承诺“请求在调用方的同一个任务里发出”，现在不再成立。
  2. 拖动参数滑块时，每次文档更新都要重新导入全部代码模块。ES 模块记录不会随 blob URL 撤销而回收，Worker 内存会随编辑次数持续增长（待确认）。
  3. 中止不分请求类型。带 readRgb、history、requireLive 的帧被后来的帧中止时，同样只拿到 skipped（讲解录制的 history 帧是否受影响，待确认）。
- result 写明“实验 4–8 沿用前次证据”，这一改动后播放流畅和拖动跟手都没有复测。
- 建议：
  - 只在文档里含 henji-layout ≥2 的模块时才做预检；
  - 预检运行时跨文档更新复用（像 `fingerprints ??=` 那样），或者直接复用渲染器已经加载的模块，在节目渲染路径上入队前调用 `prepareAuthorTextParameters`；
  - 字体已就绪（准备缓存命中）时同步放行，不走往返；
  - 播放流水下不要用后一帧中止前一帧；
  - 改完用 `electron:prod` 实测播放与拖动。

## 小问题

### D. 字体服务退出绕开了 `bindApplicationShutdown`，有竞态
- 位置：`electron/main/ipc/fonts.ts:33-37` 自己挂了 `app.once('will-quit')`，`preventDefault` 后直接 `app.quit()`，没有进入 `electron/main/index.ts:288` 的统一退出列表。
- 竞态：统一退出先完成并在 setImmediate 里 quit 时，第二次 will-quit 上字体这个 once 监听已经移除，应用会在快照还在复制或删除时退出，留下孤儿目录（GB 级，见 A）。
- 建议：把 `disposeFonts` 放进 `bindApplicationShutdown` 的列表，并在启动时清理残留的 `henji-font-snapshot-*`。

### E. 历史快照是手写常量，与 ticket 19 的合并顺序耦合
- ticket 19 设计第 484 行写明 U16 会冻结新版 henji-effects（API 7 可用）。
- 如果 U16 先于 10 合入 main，main 上未记版本的样片会按新版解释；10 合入后却把它们钉在 1.3.0，正是重要 2 那类缺陷的翻版。
- 建议：加一个门禁，断言 `HISTORICAL_PREVIEW_AUTHOR.libraries` 等于合并基准 main 上 `latestAuthorLibraryVersions(7)`；或者在合并清单里写明这一步。

### F. 同功能两份实现
- `src/platform/fonts.ts:94` 在固定快照下复制了一遍 `resolveFont` 的匹配逻辑（`:62`）。
- 建议改成 `resolveFont(name, faces)` 一份实现，避免以后两处匹配规则分叉，导致导出和预览选的字体不一样。

### G. 迁移注释缺三处
- `src/core/persistence/formatMigrations.ts:49`（code-version 8→9）、`:53`（code-author-api 7→8）、`:60`（code-asset 13→14）新增了迁移项，但没写“N → N+1”说明。其他格式都写了。

### H. 音频迁移测试放宽了断言
- 位置：`src/core/audio/effects/mergedEffectsMigration.test.ts:26/70`，从 `toEqual` 改成了 `toMatchObject`。
- 放宽后，任何后续迁移多加的字段都会被放过，不只是作者版本字段。
- 建议：期望值改成 `migrateVideoAuthor(...)` 等组合后的结果，保留 `toEqual`。

### I. 待确认：动态字体族（`fontFamily: 变量`）没准备时仍逐帧抛错
- 位置：`videoEditAuthorTextResources.ts:43`。
- 字面上符合裁定（“在该字体族已准备的字形中取最近”），编译期也有 warning；但 CSS 的行为是回退到默认族。请 Claude 确认是否接受。

### J. 测试没有覆盖它所宣称的情形
- “纯 GPU 模块不捕获字体目录”测试（`videoEditAuthorTextResources.test.ts` 末尾）用的 bundle 没有 `libraries`，测到的只是“缺版本时直接返回”，不是真实 bundle 的形态。
- 结论本身成立，因为 `videoEditAuthorBundle.ts:80` 只记录实际导入的库。

### K. Pretext 许可登记的文件不准
- `components.json` 里 Pretext 的 `files` 写的是 `text.mjs`（145 B 的转出口），实际代码在 `chunk-HPQHEW4U.mjs`。不影响许可列出，只是来源记录不准。

## 安全
没有误伤五条硬底线：
- 新增的 `fonts:list{fixed}`、`fonts:release-snapshot`、`fonts:read{snapshotId}` 都经过 contracts → electron adapter → preload `invoke`，再到 `registerIpcHandler(..., assertTrustedApplicationSender)`；
- zod 严格校验 uuid 和 64 位十六进制 id；
- 删除路径限制在 `tmpdir()/henji-font-snapshot-*`；
- contextIsolation、sandbox、preload 唯一桥梁不变；
- 渲染层只通过 `getPlatform()` 访问，没有绕开 PAL；
- 不涉及密钥、付费、外来代码判定和更新包。

## 实际读过 / 没读到
**读过**：
- review-combined.md、review.md 裁定、result.md 的修复节；
- 修复增量中的 fontSession、fontPolicy、fontChannel、harfbuzz、textFontPreparation、textFonts、authorVersion（含测试）、authorVersionMigration；
- AuthorTextResources 全文、TextFontChannel、shapedText、TextOutlines、AuthorBundle、AuthorPrograms、CodeFingerprint、CodeSources 的改动；
- RenderTransport 和 Worker 的改动、CodeGpu 的改动；
- platform 下的 fonts、textFontSnapshot、contracts、adapter，preload，ipc/fonts，services/fonts 的 service、scanner、worker、discovery；
- codeMotionReview、textDrawObservation、recordingProductService、videoEditFonts、StyleReflection 的改动；
- 两份技能文档的改动、freeze 脚本、components.json 与许可文本；
- formats、formatMigrations、schemaVersions、两个文档 kind、templateSchemas，以及 releasedCompatibility.json 相对 main 的完整差异；
- persistence.test 与 mergedEffectsMigration.test 相对 main 的改动；
- application-shutdown.ts、VideoEditPreview 的调度片段。

**没读到**：
- 冻结 chunk 的完整内容（只核对了关键符号和哈希）；
- shaping.test、textPlan.test、RenderSession.test、TextResources.test、fontChannel.test、scanner/service 测试的全文（只看了 diff）；
- 实验脚本（scripts/text-layout-*）和 prepare-text-layout-acceptance 的改动；
- 新增黄金样本全文；schemaBaseline.json；
- `.tmp` 下的内存、验收证据 JSON（没有复算）；
- 8 种格式新样本的逐字段内容（只核对了“只追加”和 main 样本未改）。
