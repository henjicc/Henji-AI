💡 Ticket 10（文字排版）合并前综合审查报告

审查对象：D:\VibeCode\Henji-AI-t10，`git diff main...HEAD -- . ':!tickets'`（HEAD b7df3d5ca，已吸收 main d529d407f）。只读；只跑了 git、文件哈希核对，以及一次放在 scratchpad 里的一次性 vitest 探针（没有改仓库文件）。

## 重要

### 1. API 8 的默认字体只准备 400/normal，加粗或斜体的默认字体排版一运行就抛错，编译期也不提示
- 位置：
  - `src/core/videoEdit/codeMaterial/textFontPreparation.ts:13`：没有声明时只加 `{family:'sans-serif'}`，也就是 400/normal。
  - `src/features/videoEdit/engine/videoEditAuthorTextResources.ts:32-33`：按 family、weight、style、轴精确查链，查不到就抛错。
  - `src/features/videoEdit/authorLibraries/shapedText.ts:46`、`src/core/imaging/vectorContent/shaping/textPlan.ts:52`：每个样式（包括空行）都走这次查找；table 和 flex 也经过 `prepareTextLayout`，同样受影响。
  - `src/core/videoEdit/codeMaterial/textFonts.ts:117`：静态诊断只看 `fontFamily` 字面量，并跳过 `sans-serif`，不看 `fontWeight`/`fontStyle`。
  - 技能 `resources/assistant-skills/video-edit-code-creation/references/author-text-motion.md:17` 写的是“只用默认字体可省略声明”。
- 触发输入：新建素材（默认 API 8）写 `layoutText('标题', { fontSize: 96, fontWeight: 700 })`，并且不导出 `textFonts`。同样会出错的写法：
  - 声明了 `faces:[{family:'Noto Sans SC'}]`，却用 `{fontFamily:'Noto Sans SC', fontWeight:700}`；
  - `{ ...params.style, fontWeight: 700 }`。
- 结果：编译既不报错也不警告；运行时每帧都抛“模块 index.js 未声明并准备字体：sans-serif”，素材画不出来。已用探针复现：走正式的 `AuthorTextResources.prepare()` → `withTextFontSession` → `shapedText.layoutText`，字体用 Calibri；400 正常，700 抛出上面这条错误。
- 为什么算重要：新建素材默认就是 API 8，“正文大字用粗体”又是用户的固定偏好，这是最常见的写法。设计 §4.2 F 要求零声明时默认 layoutText 也能同步使用。
- 建议：静态提取时把 layoutText/table/flex 调用里能读出的字体、字重、字形组合并入隐式 faces，只有动态值才要求作者声明；或者让默认集同时准备默认字体的常用字重和斜体。技能说明一并改。

### 2. 历史样片快照的 henji-effects 停在 1.2.0；第二次合并吸收 ticket 12（henji-effects 1.3.0）后没有跟进
- 位置：
  - `src/core/videoEdit/codeMaterial/authorVersion.ts:10`：快照本身。
  - `src/core/videoEdit/styles/authorVersionMigration.ts:6`：以下迁移都补这份快照——风格库 7→8、模板库 6→7、风格包 10→11、剪辑 48→49、录制 51→52。
  - `src/features/videoEdit/application/videoEditStyleLibrary.ts:112/160`：每次保存样片或库模板，缺字段就钉成这份快照。
  - `src/features/videoEdit/application/videoEditTemplates.ts:165/328`：应用、更新库模板。
  - `src/features/videoEdit/application/videoEditPresetPreview.ts:88`：样片与模板预览的默认值。
- 事实：
  - main 上没记版本的样片和模板走 `codeVersionCompilation(files, {})` → `latestAuthorLibraryVersions(7)`，得到 henji-effects 1.3.0。
  - 1.3.0 由 141fb00fd 加入，新增 `shadow`/`stroke`/`lightSweep`/`dissolve` 四个导出；henji-effects 1.2.0 的 types.json 里没有这四个（已比对两份 types.json）。
  - 9457e73d0 合并时，快照从设计写的 1.0.0 改成了“合并前的 1.2”；b7df3d5ca 再次合并 main 时带进了 1.3.0，快照没有跟着改。
- 触发序列：
  - (a) 在 main 上让助手做风格样片，按技能（`author-api.md:198`：“henji-effects 1.3.0 起”）写 `import { shadow } from 'henji-effects'`，存为风格库 v7。合并后读取，迁移把它钉成 1.2.0。预览或重渲染时模块链接失败（缺导出），或者画面与已存的预览不一致；而内容摘要按“历史等价”算没有变，界面不会提示要重渲染。库模板同理。
  - (b) 合并后助手新建风格：样片字段说明（`videoEditStyleReflection.ts:64`）没提 apiVersion/libraries，保存时 `pinPreviewAuthor` 补成 API 7 + henji-effects 1.2.0，技能教的 1.3.0 工厂同样用不了。
- 建议：快照取“合并进 main 那一刻 API 7 的最新库”（现在就是 henji-effects 1.3.0），并补一个“无字段、使用 1.3.0 导出”的迁移样本。与小问题 8（新建样片的默认版本）一起定。

### 3. 选回退字体的算法和平台候选表不在冻结发行里；宿主以后改表或改算法，会悄悄改变已有 2.0.0 作品
- 位置：
  - `src/core/imaging/vectorContent/shaping/fontSession.ts:19-60`：windowsScripts、defaults、defaultTextFonts。
  - `src/core/imaging/vectorContent/shaping/fontSession.ts:109`：选脸函数 `choose`。
  - `src/features/videoEdit/engine/videoEditAuthorTextResources.ts:36`：冻结库通过这里调用宿主的 `lease.fonts.choose`。
  - `src/platform/textFontSnapshot.ts:18-27`：`sans-serif`→Arial 等通用名映射，以及同名字体挑哪一款的评分。
  - 冻结库的调用点是 `src/core/imaging/vectorContent/shaping/runs.ts:72`。冻结产物 `chunk-JOD2NPKF.mjs` 里只有 `.choose(L,E,e,O)` 这次调用，搜不到 Nirmala 等候选字体名。
- 会出问题的情形：以后任何一版改候选表、改 emoji 优先或覆盖率规则、改通用名映射或评分，所有钉住 henji-layout 2.0.0 的作品在新版应用里都会换字体、换几何。review.md 第一轮实验后的裁定本身就要求“把平台回退候选表补到与 Chromium 一致”，以后大概率还会继续调。链身份里含候选键，缓存会正确失效，但画面已经变了。
- 为什么算重要：违背设计 §4.4 的“冻结的平台候选表”、§7.3 的“平台候选表版本/内容进入身份”，以及第 13 节第 11 条“已有 2.0.0 作品不变”。
- 建议：把候选表和选脸实现放进冻结库，宿主只提供读字节的入口；或者宿主按库版本各保留一份不可变的表和选脸实现。

## 小问题

### 4. 回退链里有哪些字体、什么顺序，取决于同一模块声明里的全部文字
- 位置：`fontSession.ts:40-60`（按 text/scripts 选文字系统集合），加上 `textFontPreparation.ts:44-46`（同一模块的所有声明和参数文字合并后一起算）。
- 触发输入：同一模块的两个片段，标题分别是 `"2026 ①"` 和 `"2026 ①年"`。
  - 前者的链只有 Arial → Segoe UI Symbol → Segoe UI Historic，① 落在 Segoe UI Symbol；
  - 后者多了汉字组，① 改落在 Noto Sans SC 或 Microsoft YaHei。
- 同一个字符因为旁边多了别的字而换字体。结果确定、可缓存，但不符合 §4.4“文本/script 只决定哪些候选需要加载；候选次序先固定”。

### 5. 字体预载过多，而且每个会话存两份（实际内存待确认）
- `fontSession.ts:86-88` 对链里每个候选都读取并算 SHA-256，而不是只在用到时加载第一个能覆盖的字体。
- 零声明时 Windows 默认链包括 Arial、Noto Sans SC、Microsoft YaHei、SimSun、SimSun-ExtB/ExtG、Noto Sans JP、Meiryo、Yu Gothic、MS PGothic、Segoe UI Emoji/Symbol/Historic。按本机文件大小算，每个字重约 115 MB。
- `videoEditAuthorTextResources.ts:76` 对所有 API 8 模块都做这一步，包括根本不导入 henji-layout 的模块（例如纯 WebGPU 效果）。
- `textFontSnapshot.ts:33` 在主线程为每个快照再复制一份，一直留到会话结束；Worker 里还有一份。预览、指纹、导出、检查池、节目池每个会话各一套。
- 设计 13.9 要求“按文字实际用到的书写系统懒加载”。实验 4 记录的渲染器工作集约为 609 MB。

### 6. 字形轮廓缓存没有上限
- `harfbuzz.ts:43/62` 的轮廓 Map 和 `videoEditTextOutlines.ts:48` 的 Path2D 表跟着模块存活，只增不减。
- 文字一直在变的模块（字幕式、打字机、数据卡轮播）会攒下成千上万个中文字形。§7.3 要求轮廓按软预算或 LRU 回收。

### 7. 导出“固定字体”只对已经读过的字体成立
- 位置：`videoEditWorker.ts:322-326` 在 fixedTextFonts 时保留旧租约；但旧快照的读取在 `textFontSnapshot.ts:17/32` 一发现字体目录修订号变了就拒绝。
- 触发输入：导出进行中，用户安装或删除任意一个字体（目录修订号 +1）。之后某个片段的 API 8 模块第一次需要新的字体或文字系统 → 准备失败 → 导出中止。
- 设计要求“导出任务固定一个快照”，现在实际是“已读的固定，未读的报错”。
- 另外，录屏产物导出（`src/features/screenRecording/application/recordingProductService.ts:75`）没有传 fixedTextFonts。

### 8. 新建的样片和库模板永远不会是 API 8（待确认是否有意）
- `videoEditStyleLibrary.ts:112/160` 加 `authorVersion.ts:14-16`，把“缺字段”一律解释为 API 7 + 历史快照。
- 写入路径（助手写样片或模板实体、界面复制）都不带 apiVersion；样片字段说明也没告诉助手可以写 apiVersion/libraries。
- 即使显式给了 `apiVersion: 8` 而没给 libraries，也会被补成 henji-layout 1.2.0。
- 结果：风格样片和库模板用不上新排版，和“新建默认 API 8”不一致。设计 13.1 只说“新建的样片/模板记录实际版本”。

### 9. 等字体发生在 Worker 的渲染队列里，而且不能取消
- `videoEditAuthorRuntime.ts:211` 每帧都 `await prepareAuthorTextParameters`；`videoEditAuthorTextResources.ts:54` 调准备时没有传 AbortSignal。
- 字体消息的处理在队列外，所以没有死锁。但参数换成新字体时，这一帧会在队列里等主线程读 20 MB 级字体并算哈希，期间拖动和 seek 的后续帧都排在它后面。
- §4.3 要求 RenderTransport 在帧进入队列之前就等字体准备好。

### 10. 升级提示和技能说明没有按设计改
- `src/core/videoEdit/codeMotionReview.ts:136` 仍然只建议 `upgradeLibraries:true`；§2.4 和 13.2 要求区分两种升级。
- `resources/assistant-skills/video-edit-code-creation/references/author-api.md:188` 仍写“新源码使用作者接口 7”，和新建默认 API 8 矛盾。

### 11. 冻结清单里的来源路径带了 worktree 布局
- `resources/video-edit-author/frozen/henji-layout/2.0.0/release.json:36-148` 中有 83 条 inputs 记成了 `../Henji-AI/node_modules/...`：worktree 的 node_modules 联接到主仓库，取真实路径后跑到了仓库外面。1.2.0 记的是 `node_modules/...`。
- 这不影响 `readFrozenAuthorRelease`（它只校验 outputs），但来源记录不对；一旦进 main，冻结门禁就不允许重冻这一版。
- 建议在合并前修正冻结脚本的相对路径计算，并在任务分支上重冻（2.0.0 还没进 main）。

### 12. 应用级第三方许可清单缺 HarfBuzz、harfbuzzjs 和 Pretext
- `scripts/third-party-licenses/author-libs/components.json` 只登记了 henji-layout@1.0.0 的 Yoga、zod 等组件，没有 2.0.0 内联的 Pretext（MIT），也没有 harfbuzz/ 下的 harfbuzzjs（MIT）和 HarfBuzz（Old MIT）。
- 冻结目录里的 NOTICE.txt 和 sources/ 是齐的，但“设置 → 关于”生成的第三方清单不会列出它们。

## 原有问题

### 13. 导出途中字体库变化时，1.x 作者库和宿主文字仍会换字体
- `videoEditRenderTransport.ts:169` 对导出会话照样发送 reset，Worker 照样重载 FontFaceSet 并调用 `invalidateFontResources`。fixedTextFonts 只管新库的租约。
- 这是本票之前就有的行为，列出供知悉。

## 指定核查项结论

### 1. 确定性
- 预览、导出、指纹各用独立的 Worker 和租约。只要字体目录相同，选哪款字体、读到的字节和哈希、得到的链都相同；`choose` 只看链的顺序和整簇是否覆盖，三处排版结果一致。
- 链身份由请求键、平台、每个候选的键/哈希/face/轴组成，缺失的候选记为 null，符合复审 D。问题见重要 3、小问题 4。
- 默认字体集不是在会话开始时预载，而是在模块首次加载时准备（`prepareAuthorTextResources`），效果等价。
- fixedTextFonts 已改为选项对象：唯一的调用方是 `videoEditExport.ts:126`；其余构造（包括 VideoEditExportPreview 和录屏产物导出）都是默认 false。transport 把它带进每个 fonts 请求，Worker 只在 reset 时据此跳过换租约。预览会换租约，导出保留租约，语义正确；局限见小问题 7。

### 2. 与 ticket 15 的 outputKey 交互
**结论：按现有代码，没有找到“outputKey 不变而复用旧画面”的输入序列。** 但这份正确性靠的是“换租约必然伴随 VideoEditCodeSources 被销毁”这一隐式耦合，而不是 outputKey 本身。

- **序列 A（字体库增删）**
  1. 预览中，某 API 8 素材声明 `faces:[{family:'Foo'}]`，Foo 没装，链里 Foo 缺失、回退到 Arial；帧 F 的 outputKey=K 写进 lastOutputs。
  2. 用户导入 Foo，字体目录修订号 R→R+1 → subscribeFontLibrary → syncFonts → 发送 `fonts{reset:true}`（`videoEditRenderTransport.ts:169`）。
  3. Worker（`videoEditWorker.ts:322-326`）执行 `renderer.invalidateFontResources()`：`videoEditRenderer.ts:860` 销毁 codeSources，lastOutputs 随之丢掉；compositor 释放作者程序和模块，各模块的租约引用归零。随后 renewTextFontLease。
  4. 下一帧用新快照，Foo 命中，重新绘制，不复用旧画面。
  - `present()` 发现 fontKey 里的修订号不一致时会先等 syncFonts（`:471`），所以不会在 reset 之前就按新目录渲染。
- **序列 B（导出，fixedTextFonts）**：同序列 A，但不换租约。codeSources 照样被销毁，重建后的模块拿到同一份租约和同样的字节，输出与之前一致，不会前后混用。失败的情形见小问题 7。
- **序列 C（声明的字体内容变化）**：改 textFonts 或 layoutText 里的字体，就是改源码，`outputIdentity = codeOutputSignature(source)` 会变；参数里的字体或文字变化，则是 `plan.parameters` 变。
- **序列 D（字体文件被替换，但目录没重扫、修订号不变）**：同一会话的 TextFontSession 已缓存旧字节，前后帧一致；新会话读到新字节，哈希变，链身份随之变。lastOutputs 只在内存里，随 Worker 结束而消失，不跨会话。持久的预渲染缓存走 VideoEditCodeFingerprint，其 digest 已经并入文字身份（`videoEditCodeFingerprint.ts:129`），会正确失效。
- **序列 E（默认预载集变化）**：要么由声明文字和参数决定（已经在 outputKey 里），要么由宿主代码里的常量决定（只随应用升级变化，内存缓存不跨进程，指纹里含链身份）。

**风险（建议，不计为缺陷）：**
- 以后如果出现“换租约但不销毁 codeSources”的路径（比如只刷新字体会话），或者把复用缓存持久化，outputKey 就会命中旧画面。建议把 `prepareAuthorTextParameters` 返回的身份并入 outputKey。
- `VideoEditAuthorPrograms.frameKey`（`videoEditAuthorPrograms.ts:92-101`）既不准备本帧参数的字体，也不并入文字身份。作者若在 frameKey 里用参数字体调用 layoutText 会抛错，而指纹路径正常，两条路径表现不一致。这种写法很少见。

### 3. 旧素材不变
- 1.x 的冻结目录没有改动；API ≤7 的素材不创建文字资源（`videoEditAuthorTextResources.ts:76`）。
- compositor 改为 `ownsModule=false`，再用 `releaseAuthorCandidate` 释放模块，与原来等价；读取元数据不再创建 GPU 运行时。
- WOFF/WOFF2 现在先在字体 worker 里解成 SFNT 再交给 FontFace，字形数据与原来等价。
- 升级：`upgradeAuthorApi:true` 取 `CODE_AUTHOR_API_VERSION`，并按 API 8 选最新库；版本键含 apiVersion，所以 API ≤7 能升到 2.0.0。单用 `upgradeLibraries` 保持原 API。源码候选编辑、追加新版本、模板更新、分离都继承原 API。
- 钉住：样片、库模板、预览、模板应用都会传递版本，原生预设用生成器常量。例外是历史快照的库版本过期（重要 2）和新建样片的默认值（小问题 8）。

### 4. 持久格式
- 以下各项都逐版本登记了迁移：剪辑 48→49、录制 51→52、风格库 7→8、模板库 6→7、风格包 10→11、代码版本 8→9、代码资产 13→14、作者接口 7→8。迁移只补可选字段，不删旧字段；旧样本没动，新样本已追加。
- 这些格式的最低可读版本都提到了新版本。persistence.md 的通则是“只新增可选字段时不提高”；但这些格式会存 API 8，或改变缺字段时的解释，设计 §9.1 明确要求提高，所以提高是对的。
- 代价：风格库里的每个风格文件首次保存后最低可读版本都变成 8，旧版应用将打不开这个风格库。这是预期内的。
- `migrateVideoAuthor` 只处理 `styles[].sample`；工程模板的 body 引用的是素材版本，本来就有版本，不用补。正确。

### 5. 资源与生命周期
- HarfBuzz 的 Blob、Face、Font 按内容哈希放进模块级池并做引用计数，最后一个 TextShaper 释放时才销毁。补丁给它们加了显式 dispose，并先从 FinalizationRegistry 注销，可重复调用，不会二次释放。Buffer 每次整形后释放。
- 租约释放 → onClose → shaper.dispose → 清掉栅格和布局，这条链完整。
- 迟到的响应按 session、generation、revision 校验后丢弃；release 会拒绝还在等的请求；收到 dispose 请求时先关通道，再进队列处理。
- 字体消息的处理在渲染队列之外，未发现卡死。不足见小问题 5、6、9。

### 6. 冻结发行
- release.json 列出的 19 个 outputs 与目录里的文件逐个核对过 SHA-256，全部一致，没有多也没有少（空文件 `chunk-FW4NF3SJ.mjs` 也在清单里）。
- harfbuzz.wasm 与 vendor 里的字节相同；sources/ 带齐两份许可、来源清单和补丁。
- harfbuzzjs 的补丁只改了导入后缀，并给 `track()` 加显式释放，属于最小改动。Pretext 的补丁删掉 han-kerning 里的 Canvas 探测、固定 Blink 的行为配置，范围与 §3.3 对应。
- 不足见小问题 11、12。

### 安全
五条硬底线都没有被误伤：
- 没碰 keystore；
- preload、contextIsolation、sandbox 不变，新增的只是 Worker 内部的 MessagePort；
- 外来代码仍然先过 `assertAuthorTrust` 再执行；候选模块路径上信任上下文缺失时直接拒绝运行；
- 不涉及付费、删除和更新包。

## 设计符合度与阅读范围

**已落实：**
- 第 12 节 1–3：Pretext 窄适配并锁定版本、henji-layout 2.0.0 + API 8、去掉 prepareTextFonts 改为静态声明。
- 第 13 节：
  - 2：新建默认 API 8、`upgradeAuthorApi`；
  - 3：静态字体声明；
  - 5：整段整形、按 unsafe 切分、复用 Pretext walker；
  - 6：字形轮廓有稳定身份、带外观的字按密度缓存；
  - 7（及第 14 节）：单一几何、`ligatures` 作为作者选项、forceGraphemes 忽略并提示；
  - 8：LayoutUnit 量化；
  - 9：只把字节交给 HarfBuzz、不注册 FontFace；
  - 10：emoji 用系统绘制；
  - 11：标点分类按 HarfBuzz 字形范围；
  - 13：按内容哈希共享、显式释放，harfbuzzjs 不单独登记。
- 复审 A、B、C、D、E、G、H。

**部分落实或未落实：**
- 13.1 版本钉住：快照里的库版本过期；新建样片走历史快照（重要 2、小问题 8）。
- 13.2：codeMotionReview 和技能里的 API 版本说明没改（小问题 10）。
- 13.4 / 复审 D 的“候选次序先固定、文字只决定懒加载”和“冻结的候选表”（重要 3、小问题 4）。
- 13.9 按书写系统懒加载（小问题 5）。
- 复审 F“零声明时默认 layoutText 可同步使用”：对非 400/normal 的默认字体不成立（重要 1）。
- §4.3“进入渲染队列前等字体就绪”（小问题 9）。
- §7.3 轮廓软预算（小问题 6）。

**实际读过：**
- 设计：§2、§4、§7、§9–§14，以及 review.md。
- 排版核心 `shaping/**`：fontSession、fontContext、fontChannel、harfbuzz、textPlan、punctuation、table 全文；runs.ts 前 60 行；paragraph.ts 前 120 行。
- 作者库：shapedText、table、text、validation。
- engine 层：TextResources、TextFontChannel、Candidates、TextOutlines 全文；Determinism、CanvasRecorder、Worker、RenderTransport、CodeFingerprint、AuthorPrograms、AuthorModule、AuthorRuntime、GpuCompositor、AuthorBundle、SharedCompiler 的改动；CodeSources 的相关段落与 CodeOutputKey。
- 素材与格式：codeMaterial 的 authorVersion、textFonts、textFontPreparation、authorLibraries；codeMaterialPersistence、codeMaterialVersions、codeAsset；styles 的 schema 与迁移。
- 应用层改动：CodeProjectUpgrade、Export、PresetPreview、Templates、StyleLibrary、CodeCandidates、CodeService、AuthorInspection。
- persistence：formats、formatMigrations、releasedCompatibility、schemaVersions、两个文档类型的迁移，以及 persistence.test 的改动。
- 其他：platform/textFontSnapshot；electron 字体服务（metadata、scanner、service）的改动；冻结 2.0.0 的 release.json、NOTICE、text.mjs、table.mjs 开头，两份补丁和 source.json；冻结脚本的改动、vendor 校验脚本；技能文档的改动；第三方许可登记表。

**没读到：**
- paragraph.ts 120 行之后（unsafe 修复、标点挤压、tsume、可见连字符等断行细节）和 runs.ts 60 行之后；graphemeGeometry.ts。
- 上游 vendor 源码，实验脚本，text-layout-cases.json。
- 各测试文件（只看了 shapedText、textPlan、authorVersion、persistence 的片段）。
- schemaBaseline.json；新增黄金样本的全文（只抽查了钉住字段）。
- videoEditCodeService、StyleCapability、StyleReflection 的全文；Pi/MCP 能力投影。

**没跑：** 全量测试、Reality、GPU 测试，也没启动开发版（没碰 9334 端口）。
