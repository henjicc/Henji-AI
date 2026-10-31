摘要：本轮已提交 WOFF/SFNT、多字体 run、API8 持久迁移、编译期字体诊断及稳定轮廓身份；独立字体端口与快照租约也已提交。任务要求的非 GPU 范围仍未全部完成。
摘要：新建默认仍 API7；henji-layout 2.0.0 未注册默认、未冻结。未运行 Electron、Reality 或 GPU；未改依赖、UI、主分支，也未推送。
摘要：最新进度以“依赖就绪后的续做”为准；后面的 826ee2701 记录保留为历史证据。

# 本轮交付

## 2026-10-31 依赖就绪后的续做

- 起点 `1ac3bc861`，继续在 `task/10-文字排版`；fontverter 2.0.0 来自已合并的管理者依赖提交。本轮未安装依赖、未修改 package/锁文件或联接点。
- 已提交 `cedfa8efe feat(fonts): 在字体线程规范化 WOFF 与 WOFF2`：在现有字体 CPU worker 中完整转为 SFNT；TTC/dfont 沿原提取入口；规范化后复核文件状态，拒收读取期间变化的文件。11 项字体 Node 测试及 L2 通过，覆盖真实 WOFF2 的字形、轴、cmap、轮廓与 WOFF 全表往返。独立审查 1 轮，无重要问题。
- 已提交 `83f1ef252 feat(text-layout): 接入多字体整形段与原文字素映射`：回退链真正参与字体 run 选择，按字体/书写系统/整形样式分段，颜色不拆整形；原文字素映射保留 CRLF、大小写展开、小型大写与上下标。修复日语长音符归属及跨字体 Tab 身份，移除平方级扫描。19 项整形 CPU 测试及 L2 通过；审查 2 轮，重要问题已修复。
- 已提交 `8331ab0e8 feat(text-layout): 固定作者版本并支持显式升级 API 8`：八类格式逐版本迁移与新黄金样本；历史预览 API7/库快照；样片、模板应用/更新/收录/分离传播；共享源码追加与历史候选编辑沿用原 API/库；显式 upgradeAuthorApi 与 upgradeLibraries 分离并返回实际版本；一次撤销恢复。默认新建仍 API7，2.0.0 未注册为默认或冻结。
- 持久块当前证据：357 项精确 CPU 测试通过，64 种格式兼容通过；check:assistant-capabilities 全门禁通过（31 项业务不变量文件、237 项测试；另含注册覆盖检查）。独立审查 3 轮，重要问题（旧模板误带未使用的新库、分离漏传版本、历史候选继承错误）均修复；历史摘要兼容与类型检查 API 一致性一并修正。最终 L2 双工程类型、依赖图与主进程边界检查均通过。
- 已提交 `3831aaa15 feat(text-layout): 接入编译期字体声明与诊断`：API8 编译可达模块并携带静态资源元数据，非法动态声明定位报错，未知绑定默认值/缺声明只诊断；保留纯 JS 原生模块图与动态相对 import 行为。284 项 CPU 测试及 L2 通过。审查 2 轮，修复动态 import 语义与漏报非法导出；两处原测试只钉死库错误消息的列表顺序，改为断言实际模块错误。
- 已提交 `c10fa005a perf(text-layout): 缓存字体轮廓并稳定录制身份`：CPU 核心缓存不可变 SVG/内容身份，绘制层复用内部 Path2D，录制与指纹按稳定身份比较并保留实际回放对象。50 项 CPU 测试及 L2 通过，审查 2 轮未发现重要问题；仍未接通作者 drawText，不能据此声称绘制/性能已验收。
- 已提交 `dea2ad98c feat(text-layout): 接入独立字体通道与快照租约`：RenderTransport 创建专用 MessagePort，Worker 在渲染 queue 前接收；快照字节常驻、传输用副本、取消/释放拒收迟到结果、目录变化拒绝混入新字节；命名字体实例轴进入整形、标点和轮廓身份。91 项 Node/CPU 测试及 L2（双 tsc、依赖图、主进程边界、IPC 对账）全部通过。审查 2 轮，修复命名实例标点缓存遗漏与关闭服务端导致等待不结束的问题；顺序断言漏检也已补齐。
- 第 1 项仍需：参数绑定/默认参数、首次出帧完整屏障、wasm 初始化、revision 切换与各入口缓存失效；完整 tsume、行尾溢出、fit/justify/truncation 等。第 4 项正式作者入口与外观缓存尚未完成，不能把 CPU 基础当作正式排版引擎交付。
- 收尾复核：`npm run check:persistence-compat` 64 种格式通过；`node scripts/check-text-layout-vendor.cjs --check` 通过。完整能力门禁沿用本轮 API 块的有效通过证据，之后的编译/轮廓/字体通道改动未更改能力契约。没有冻结新库，未运行冻结生成器。
- 同源排查实际范围：字体规范化/TTC/WOFF/WOFF2、字体链/命名实例轴/标点与轮廓身份、端口关闭/取消/迟到响应、编译 JS/TS 与动态 import、八类迁移及样片/模板/包传播、共享源码/历史候选升级。以上已修复项有 CPU 证据；正式作者入口、首帧及像素/性能尚未验证。
- 尚未启动 Electron/开发版、Reality、GPU 测试或窗口实验；既有待显卡命令仍见下文。没有推送、切分支、合并或修改 UI。记录位于获准共享 tickets/10 目录，不进入任务分支代码提交。代码工作区干净，HEAD 为 `dea2ad98c`。


## 2026-10-31 续做：依赖硬约束暂停

- 本次目标为继续下一步第 1、2、4 项的非显卡部分。起始与结束均为 `task/10-文字排版` / `826ee2701`，代码工作区干净，无上游分支；未切换、合并、拉取或推送。
- 用户硬约束为“需要改 package.json/锁文件就停下在 result 说明”。在实现前检查第 1 项字体字节通道时发现：`electron/main/services/fonts/metadata.ts::standaloneFont` 对 WOFF/WOFF2 原样返回压缩内容；当前 `fontkit@2.0.4` 能解码，但公开编码接口是 `createSubset().encode()`，不提供本设计要求的保留完整字体表的 SFNT 转换入口。design §4.4 明确禁止用 subset 丢表，也禁止手写解压。
- `package.json`、`package-lock.json` 未声明 `fontverter`、`wawoff2`、`woff2sfnt-sfnt2woff`；在当前任务目录使用 Node `createRequire().resolve()` 核对，三者均为 `MODULE_NOT_FOUND`。设计候选 `fontverter@2.0.0` 的[官方说明](https://github.com/papandreou/fontverter)确认它通过后两者在 SFNT/WOFF/WOFF2 之间转换。接入这条方案需要新增正式依赖及锁文件记录，故按用户要求暂停；未通过临时安装或新 vendoring 绕过停止条件。
- 完成一次只读 Node/CPU 探针：把现有 `@fontsource-variable/geist/files/geist-latin-wght-normal.woff2` 字节交给本票固定的 HarfBuzz，整形 `Hello` 返回 glyph IDs `[0,0,0,0,0]`、advances `[500,500,500,500,500]`，证实不能直接用压缩字节替代规范化 SFNT。探针显式释放 Buffer/Font/Face/Blob，未创建测试文件、窗口或 GPU 上下文。
- 恢复前置条件：由管理者在允许修改依赖的阶段准备并锁定转换依赖、同步到任务分支；本任务不修改共享 node_modules。随后先在已有字体 CPU worker 接 SFNT 转换，验证完整表、轴、轮廓和哈希，再继续第 1 项其余部分、第 2 项、第 4 项 CPU 接线。独立的多 run 排版及版本工作本身不依赖该新增包，但本轮遵守“就停下”的要求，未继续实施。
- 本次仅更新获准的本文件；无代码块完成、无新增提交。未改能力、生成器、持久格式或默认 API；`henji-layout@2.0.0` 未登记为默认、未冻结。未运行 L2、持久兼容或能力门禁，不能把上一轮通过证据算成本次实现完成；纯记录更新按 testing.md 的 L0 核对路径与引用，独立代码审查 0 轮（无代码 diff）。
- 剩余范围仍为下文第 1、2、4 项；第 3 项仍待显卡。待显卡首条命令仍为 `node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-dom/index.html --out .tmp/text-layout-dom/dom.json`，其覆盖限制见原记录；本次未新增宿主实验脚本。未启动 Electron/开发版、Reality、test:gpu 或 GPU 程序。
- 已核对 `node_modules` 仍为指向 `D:/VibeCode/Henji-AI/node_modules` 的 Junction；未运行 install/ci/uninstall 或写依赖目录的命令，未访问 `D:/视频制作`，主工作区仅改获准的本结果文件。

工作树：`D:/VibeCode/Henji-AI-t10`；分支：`task/10-文字排版`。本地提交号见本文末尾。未推送、未合并、未切换分支。

## 设计裁定

`design.md` 正文落实 A/B 单一几何、默认关闭可选连字、API 8 忽略 forceGraphemes 并诊断，以及分组报告 DOM 连字样本；C 将 ligatures 限于作者 layoutText 选项；D 用完整有序候选链和每项内容哈希/缺失事实确定身份；E 独立字体相关标点计划；F 零声明默认字体集和字面字体诊断；G 复用 Pretext walker；H 原生预设预览使用生成器常量，不增加 previewAuthor 持久格式。第 12–14 节历史裁定保留，明确 A–H 优先。

设计与本结果保存在获准修改的共享 tickets/10 目录，位于当前 worktree 之外，不包含在当前分支代码提交中。

## 已实现

- `resources/video-edit-author/vendor/`：npm pack 获取的 Pretext 1.0.0、harfbuzzjs 1.6.4 源码子集与 wasm；包含来源、npm integrity、上游提交、逐文件 SHA-256、许可证、独立可逆补丁。Pretext 生产导入图没有 Canvas 度量；保留断行分析与 walker，标点静态规则接 HarfBuzz 字形范围。harfbuzzjs 增加显式、幂等释放，避免终结器重复释放。不把它登记成可由作者单独选择的新公共库。
- `src/core/imaging/vectorContent/shaping/`：整段 HarfBuzz 整形、glyph/cluster/advance/outline、轴与特性身份、unsafe 边界按实际行片段重整形；Pretext walker 注入宽度，安全区间使用标量前缀和，避免保存大量候选前缀字形。实现基本 LayoutUnit 比较、中英间距、制表位、尾空格悬挂及独立标点计划。
- 单一不可变几何：默认关闭 liga/clig，显式 ligatures 开启；共享簇的位姿/选择只由首字素决定，不产生半个连字；forceGraphemes 不参与新几何。
- 字体会话基础：有序完整候选链、字体字节 SHA-256、缺失项、Win/mac 默认拉丁/汉字/假名/emoji 候选、会话常驻、共享加载、取消单个等待者、关闭后拒收迟到结果、整簇试整形选脸。字体读取由注入的 FontReader 提供，尚未连接真实宿主。
- `src/core/videoEdit/codeMaterial/textFonts.ts`：不执行作者代码的静态字体声明解析，支持模块常量/导出别名、as const、satisfies；API 8 的字面 fontFamily 缺声明和 forceGraphemes 诊断。读取器尚未接入正式编译入口。
- 简单字符串表格：列 min/max、固定/弹性列、窄列 overflow、数字右对齐、tnum 测量和无等宽数字诊断；尚未提供最终 henji-layout/table 作者模块和完整富文本单元格。
- CPU 实验准备及独立 Electron 对照启动脚本：生成 200 个默认无连字样本、2 个开连字样本和表格 CPU 数据。启动脚本使用隔离临时 profile，只在显卡恢复后执行。

## 验证证据

在本机字体上运行 19 项测试，全部通过、无跳过；主要字体 Calibri，复核补充微软雅黑。覆盖字偶距、unsafe 双侧/阿拉伯上下文切片、ligatures owner、Unicode 字素、1000 字候选内存路径、中英间距与 tab 顺序、完整/部分悬挂尾空格、字体/轴/特性缓存身份、字体会话取消与缺失、表格数字与溢出、静态声明诊断。

```powershell
node scripts/check-text-layout-vendor.cjs --check
npm run check:persistence-compat
$env:NODE_OPTIONS='--max-old-space-size=8192'
npm run verify:changed -- --level L2 --test src/core/imaging/vectorContent/shaping/shaping.test.ts --test src/core/videoEdit/codeMaterial/textFonts.test.ts src/core/imaging/vectorContent/shaping/harfbuzz.ts src/core/imaging/vectorContent/shaping/punctuation.ts src/core/imaging/vectorContent/shaping/paragraph.ts src/core/imaging/vectorContent/shaping/table.ts src/core/imaging/vectorContent/shaping/fontSession.ts src/core/imaging/vectorContent/shaping/graphemeGeometry.ts src/core/imaging/vectorContent/shaping/shaping.test.ts src/core/videoEdit/codeMaterial/textFonts.ts src/core/videoEdit/codeMaterial/textFonts.test.ts scripts/check-text-layout-vendor.cjs scripts/text-layout-dom-experiments.ts scripts/run-text-layout-dom.cjs .gitattributes
node scripts/text-layout-dom-experiments.ts --prepare --font C:/Windows/Fonts/simhei.ttf --out .tmp/text-layout-dom
node --check scripts/run-text-layout-dom.cjs
```

- 依赖校验通过：文件/许可/补丁哈希一致，逆向应用补丁后与上游原始文件逐字节一致；生产可达 Pretext 7 个模块无 Canvas 测量。
- `check:persistence-compat`：64 项格式通过。这只证明现有格式未受改动，不代表 API 8 迁移已经完成。
- L2：19 项精确测试、改动文件 ESLint、渲染层和 Electron 增量 tsc、依赖图、主进程导入边界均通过。
- CPU 准备生成 202 例，HarfBuzz 15.0.0，SimHei 字体哈希 `aa4560dd8fe5645745fed3ffa301c3ca4d6c03cbd738145b613303961ba733b8`，这批样本无缺字；表格列宽为 224/252、无诊断。这里没有 DOM 比较结果，也不据此宣称 200/200 或 1/64 几何门槛达标。
- 未改助手能力，未运行 `check:assistant-capabilities`；未修改现有生成器，不涉及其 `--check`。新增依赖校验脚本已按 `--check` 执行。

## 审查与同源排查

按 L2 要求使用干净上下文独立审查，共 3 轮。重要问题均修复：长词应急断行宽度增量、tab 的最终几何、候选前缀保存完整字形导致的内存增长、tab 与中英间距叠加；同时修复完整及部分悬挂尾空格。最终增量复核未发现有证据的新问题，并用真实字体复验。

排查范围覆盖新段落 walker 的正常/应急/不安全切行、表格调用方、tab/尾空格/中英间距状态组合、字体会话关闭与取消、单一几何的簇选择及新实验脚本。既有冻结库未变；正式 layoutText/drawText 与宿主尚未接入，不能宣称这些入口已经修好或验收通过。

## 尚未完成与下一步

最新状态：本轮完成六个可独立回滚的提交，但**尚未满足本任务完整完成标准**。下列第 1、4 项仍有可在显卡暂停期间继续完成的代码，不是被显卡禁令阻塞。

1. **CPU 核心与宿主剩余接线**：多字体/script run、回退选脸、CRLF/大小写/上下标映射、WOFF/SFNT、编译诊断、独立字体端口已提交。仍需让 `text/scripts/bindings` 与本次有效参数实际驱动准备；在元数据、样片、预览、导出、复核、指纹入口完成统一的字体/wasm ready 屏障；在确定性模块求值之外初始化 wasm；接 revision 新快照的原子切换、旧租约释放及模块/布局/指纹/预渲染完整资源身份失效。当前端口只提供租约，作者入口尚未消费它。仍缺完整 tsume、行尾标点溢出、soft hyphen、fit/justify/truncation 等作者语义。
2. **API8 与持久化**：八类升级、逐版本迁移、黄金样本、历史 API7/库快照、样片/模板/包传播、显式 API 与库升级区分、撤销、原生预设历史常量、升级能力及技能说明已提交并验证。完整新作者引擎的类型/示例/技能、table 入口及冻结资源生成支持，须随第 4 项接线继续补齐；不能把 API8 契约登记等同于 henji-layout 2.0.0 已交付。新建默认继续 API7，2.0.0 不设默认、不冻结。
3. **显卡恢复后的实验**：已有基础命令见下方，当前未执行。它只覆盖实验 1/2/3 的基础 DOM 断点/几何对照；仍缺上游原版 Pretext 三方比较、完整临界集合及正式 Reality 接线。实验 4–7 的装载/绘制/性能/跨平台回退、实验 8 的 DOM 逐格表格脚本仍未齐备，不能称“脚本全部准备完成”。Node 端口与快照测试证明资源消息不依赖渲染队列，但不能替代真实 Worker/GPU 首帧实验。
4. **正式作者库**：稳定轮廓身份和录制/指纹比较已接线，普通 Path2D 保持不可比较；仍需接通 layoutText/drawText/GraphemePose/table，生成同一 HB 几何的实际绘制事实及外观缓存。当前 `TextShaper.outlineShape` 与绘制层路径工厂还不是正式作者 drawText 的执行链。真实窗口、像素及性能尚无结论，完成全部门槛后才冻结 2.0.0。

待显卡命令（仅登记，未运行）：

```powershell
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-dom/index.html --out .tmp/text-layout-dom/dom.json
```

CPU 准备数据可用 `node scripts/text-layout-dom-experiments.ts --prepare --font C:/Windows/Fonts/simhei.ttf --out .tmp/text-layout-dom` 重建；它不是完整宿主实验 4–8。后续正式 Reality 命令须在对应套件真正接入后再记录，当前不写不存在的可执行命令。

未运行 Electron、开发版、Reality、GPU 测试或任何 `*.gpu.test.ts`。未运行 npm install/ci/uninstall，未改 package.json/锁文件；node_modules 仍为指向主仓库的原联接点。未改界面，未访问 D:/视频制作，未修改主工作区其他位置。

## 本地提交

历史基础：`826ee2701`。本轮六个提交依次为：

- `cedfa8efe` — WOFF/WOFF2 完整 SFNT 规范化。
- `83f1ef252` — 多字体/书写系统 run 与原文字素映射。
- `8331ab0e8` — API8 版本钉住、升级与持久迁移。
- `3831aaa15` — 编译期字体声明与诊断。
- `c10fa005a` — 稳定字体轮廓与录制身份。
- `dea2ad98c` — 独立字体通道与快照租约。

提交后工作区干净，仍在 `task/10-文字排版`；按本次指令未推送。

## 2026-10-31 显卡恢复后的续作（进行中）

- 已提交 `4d12e174a`：正式模块求值前的字体声明/参数准备、共享字体租约、CPU 元数据入口、内容身份缓存、同步/异步作者上下文。元数据、样片、预览、指纹已沿共享入口接线；导出显式固定文字字体快照，离屏预览在字体更新时重开快照。
- 验证：显式文件 L2 首轮 486 测试通过；增量 L2 74 测试通过；最后并发上下文修复的 8 测试通过。渲染层与 Electron 类型、依赖图、主进程边界通过。`check:persistence-compat` 64 格式、`check:assistant-capabilities`（15 覆盖 + 237 不变量测试）、`node scripts/check-text-layout-vendor.cjs --check` 通过。技能未改。
- 独立审查三轮：修复异步 GPU await 丢失上下文、无 surface 预览继续使用旧字体快照、同 owner 并发实例串用参数；最终增量无新增重要问题。另有参数准备纯函数的一次独立审查未发现问题。
- 此块尚不代表完整首帧验收：正式 HB 作者模块及 wasm 冻结资源未接入，字体脚本按需装载、预渲染失效完整性、排版语义、绘制/外观缓存与实验 1–8 仍在继续。尚未运行本轮 GPU/DOM 实验，不能给出 200/200、1/64 或 4ms 结论。
- 保持 API7 默认，未冻结 2.0.0；未推送、未切分支，未动 9334 开发版、依赖联接点与主工作区其他路径。
- 第二块已提交 `698e0f761`：簇间 tracking/数字 kerning、tsume、软连字符实际断行替换、字体 halt 行尾挤压、按文字/脚本的回退准备、不可变候选快照。显式范围 L2 26 测试、两套类型与依赖/主进程边界通过。独立审查两轮，RTL 字距、软连字符间距和 Common 标点回退三项重要问题均修复，最终复核通过。fit/justify/截断正在作者计划层继续实现，尚不宣称 CPU 剩余项全部完成。


## 2026-11-01 最新交付：停在第 3 步，门槛未过

**本节覆盖上方历史进度。未冻结 henji-layout 2.0.0，新建素材仍默认 API7；没有推送、合并、切分支。任务尚未全量完成，实验 1–8 不能写成全部通过。**

### 本轮提交与实现边界

1. `4d12e174a`：字体首次准备屏障、参数绑定与同步/异步作者作用域、固定导出快照。细节和验证见上一节。
2. `698e0f761`：CPU tracking/kerning/tsume、软连字符与行尾 halt、按脚本准备及不可变字体链。实验进一步暴露的语义缺口见下文，不能据此称 CPU 全语义完成。
3. `d19276aef`：源码作者入口 layoutText/drawText/GraphemePose/table 接通同一 HB 几何；fit 复用既有求解、表格复用列宽分配；按内容身份录制轮廓与外观，真实重放阶段按密度分档栅格，字体会话关闭释放资源。实际文字观察含变换后墨迹、正文覆盖、截断及缺字诊断。旧 1.x 冻结字节与回归保留。这里是**待发行源码候选**，没有把它注册成可用 2.0.0 冻结包；冻结生成器的 table/wasm/类型支持及新技能说明仍随门槛通过后的发行步骤完成。
4. `5e4c9bd21`：固定样本和隔离 Electron 三方对照、临界宽度、外观缓存/像素及部分绘制性能诊断。未修改 package.json、锁文件、node_modules；联接点仍指向主仓库。没有触碰 9334、用户资料、主工作区其他位置或 D:/视频制作；没有 Reality、界面修改。

### 实验环境与样本

- Electron **44.9.3** / Chromium **152.0.7977.167**；Windows，DPR **1.5**，locale zh-CN。隔离 profile `.tmp/text-layout-acceptance/electron-profile`、随机 localhost 端口。实际作者源码经 esbuild 打包，仅本实验页注册 FontFace 作 DOM 对照；不是完整应用生产 Worker/上传/合成验收。
- 固定 R20/P40/U20/H120；H 为独立自有 120例。来源为仓内配方、Pretext v1.0.0 官方 harness 和 Unicode17.0.0。样本文件 `scripts/fixtures/text-layout-cases.json`，SHA-256 `56d23edddb7e0376639e800257c9170a321a8b88f51f0a53de1059f01596da4e`。
- 首轮抽样误纳混合 bidi，Unicode 抽样只命中控制符邻接；按设计修正归类，原始首轮样本/报告保存在 `.tmp/text-layout-acceptance/first-cases.json` / `first-report.json`，固定 fixture 另保留8个 bidi 及10个控制符附加样本（附加组本次未完整重跑）。没有按成败过滤；补齐组合符、RI、emoji ZWJ、VS、自有包句中的扩展汉字。P组保留上游 accepted 对应输入。
- 先前简单 202 例诊断为202通过（其中普通200+开连字2），它不是本固定集合，也不是发布依据。
- 最终报告 `.tmp/text-layout-acceptance/report.json`，SHA-256 `e063535be4d639dd50b3b59d2ff912823bd657f356aea8bd3afa1e45661a02a2`；已打开检查 `.tmp/text-layout-acceptance/drawing.png`，可见黑色轮廓文字，非白字白底的空图。

| 字体/字重 | 实际字节数 | SHA-256 |
|---|---:|---|
| simhei.ttf / 400 | 9,753,388 | `aa4560dd8fe5645745fed3ffa301c3ca4d6c03cbd738145b613303961ba733b8` |
| calibri.ttf / 400 | 1,648,120 | `198e8dac512206f27c9bdbfeb3d5b3e55a33de9dcf58d801823ef8c5ef5a76dc` |
| calibrib.ttf / 700 | 1,613,668 | `4d5c56c07c41315022cd5a24966ade3983ceebce8bc81524e56e4632dd3f242f` |
| seguiemj.ttf / 400 | 2,072,388 | `7c0244dd8eeb7c6bdecdfc3f9e59833527fc18a66d0295ce47339069692a2b4f` |

这些是本机字体，只记录身份，没有提交或分发字体字节。DOM 显式声明同字节 family 链、关闭可选连字与中英自动间距、关闭字体合成。复杂整簇回退与浏览器拆分回退仍会产生实际差异，不包装成完全一致。

### 门槛和失败原因

- **断点 190/200，未达到200/200**；未修改 Pretext 对同批 DOM 为194/200。失败ID：P018、P022、P027、U003、U004、U007、U008、U009、U010、U017。
- **可见推进几何182/200在1/64以内，未过**；最大有限差30.520828px（U018 emoji/组合簇），非 emoji 还有 P019 富文本 tab **14.46875px**。占用宽度单列，未把包含尾空白的宽度当可见文字宽度；上游字段明确叫 occupiedWidth。
- 600个 W−1/64、W、W+1/64 临界记录齐全：断点570/600，几何546/600；错误记录也保留，不漏掉抛错样本。
- P022：Calibri16、`AA\u00ad B`、宽21.317708333px，作者/上游首行均为`AA`；DOM分为`A`、`A-`，然后`B`。这是应急断行与软连字符可见替换的真实差异，已排除 Range 把上一行连字符算到下一字的测量错误。
- P027：`AA B`、宽1px，作者/上游多出空白独占行，DOM没有该行。两个案例均牵涉 Pretext walker 的行边策略，不能只改字体或容差掩盖。
- P019：跨字号/字重 run 的 tab 停靠，作者313.75、DOM/上游299.28125；属于本适配语义缺口，不归咎于上游。
- U009/U010（Balinese）遇到尚无显式 script 支持而拒绝；U017 的 emoji修饰符/ZWJ组合触发“断行只能发生在完整字素边界”。U003/004/007/008等整簇覆盖缺失与 DOM fallback 不同。缺字诊断还包括 P018替代对象符、P039韩文、U018组合emoji、U020扩展汉字；未把有glyph或断点相同当作完整支持。
- 中英间距独立3例：中文AI中文160→168、中文 AI 中文192→192、中文2026中文192→200；HB与DOM一致，CSS.supports为true。这仅证明这3例。

**停止依据**：design.md 第12节第1条要求“实验1–3失败且需要更深改造时停下回报，再评估CanvasKit”。已证实上游也存在的窄宽/空白行策略差异，继续改变 walker 超出当前三处窄接缝的可行性假设；因此本轮保留数据并停止发行推进。未自行换成CanvasKit，也未通过降低门槛、删除失败样本、改默认值继续发布。

### 实验1–8实际覆盖（不以部分结果代替完整验收）

| 实验 | 本次结果及未完成部分 |
|---|---|
| 1 断行 | 固定200例三方源码/DOM对照已跑，未过；完整生产Worker取帧链未跑。 |
| 2 几何 | 200例可见推进、600临界及3组autospace已跑，未过；完整多平台/所有字体与轴矩阵未跑。 |
| 3 标点墨迹 | 源码实际绘制和静态/逐字落定像素一致；没有完成DOM标点1×/4×叠图，AA与墨迹定位验收未通过也未宣称通过。 |
| 4 大字体/首帧 | 记录上述实际字体字节，端口/租约/取消的CPU测试通过；大字体30/60MB、真实Worker首帧、并发/内存/关闭专项未运行。 |
| 5 绘制 | 20/200/1000字1080p逐字位姿部分诊断、外观缓存密度1/2/4/8已跑；完整生产上传/合成、整帧/掉帧/p90、4K及旧新版对比未完成。 |
| 6 轮廓消费 | 未运行three SVGLoader/ExtrudeGeometry的描边生长和挤出绘制；不能报告通过。 |
| 7 回退 | Windows固定字体集已有缺字/整簇回退差异；macOS、AAT、各彩色格式及预览/导出同快照像素矩阵未验。emoji形状/基线/AA一致性未验，不称跨平台一致。 |
| 8 表格 | 源码table与CPU tnum/列宽直接测试通过，实验页生成表格计划；DOM逐格与窄列叠图未完成。 |

实验5每项5次预热、30次计量；下表单位ms，格式P50/P95/max。仅包括作者录制、Canvas重放和小读回刷新，**没有上传/合成且不是正式生产构建**，不能作为4ms门槛验收。典型200字纯填充本诊断P95 **5.30ms**，正式全阶段门槛仍未验证，不能标通过。

| 字数/外观 | 作者提交 | 重放与刷新 | 两者合计 |
|---|---:|---:|---:|
| 20 / 纯填充 | 0.30/0.60/0.60 | 1.00/1.30/1.40 | 1.30/1.90/1.90 |
| 20 / 描边阴影 | 0.70/1.20/4.10 | 1.40/1.80/2.30 | 2.10/2.90/5.90 |
| 200 / 纯填充 | 1.50/2.80/6.20 | 2.10/3.20/3.40 | 3.60/5.30/8.80 |
| 200 / 描边阴影 | 4.40/7.50/7.90 | 11.00/13.90/15.90 | 16.00/21.30/23.40 |
| 1000 / 纯填充 | 8.50/11.60/59.90 | 10.60/17.00/17.60 | 19.40/25.10/71.30 |
| 1000 / 描边阴影 | 29.80/39.90/45.40 | 55.80/71.80/88.10 | 86.50/110.00/126.50 |

外观缓存：3字描边阴影样本，1/2/4/8每档首次按簇创建局部栅格，同档第二帧**零**新OffscreenCanvas；本样本最大离屏1225×1103，未建1920×1080整帧临时画布。直接绘制/录制重放差异通道0（22420个非零通道），静态/逐字落定差异0（5607个非零通道），可比较录制为true。超过2048分块边界的真实像素/压力样本仍未覆盖，不能据这3字推断全部外观尺寸。

### 验证、审查和复现

- 作者块完整L2：199测试（含旧冻结1.2.0的11项真实Canvas像素）、ESLint、renderer/electron tsc、依赖图、main导入边界通过；第三轮修复空段落与底板后增量L2 5测试与同样静态项通过。没有重复跑全量测试/Reality。
- 实验块显式5文件L2：23直接消费者测试通过；Node语法检查、实际esbuild与Electron执行完成。Electron实验退出1是保留门槛失败，不视作验收成功。
- 本轮已运行vendor --check，依赖字节/许可/反向补丁及7个模块零Canvas可达图通过；check:persistence-compat64格式通过。check:assistant-capabilities末次复验状态见本节末尾。技能未修改，check:skill-sync不适用。
- 作者块独立审查3轮：修复maxWidth误换行、RTL owner/推进、富文本非空/空行/空段落样式丢失、底板重叠、跨tile采样及外观合成观察。第3轮余项按源段落样式权威统一修正后精确验证通过，没有第4轮重复审查。实验块2轮：修复SHY Range归行、尾空白口径、失败门禁和Unicode覆盖；第2轮小问题（异常重复计数、上游width标注）也已处理。
- 同源检查范围：作者普通/富文本、fit/截断、RTL簇、表格调用方、录制/重放/指纹、字体会话释放、旧冻结库；已修复的源码问题与上述实验暴露的未修复断行/回退/tab问题分开。完整应用GPU/跨平台未验证。

复现当前固定集合无需重生成case文件；上游未修改Pretext解包仅在本工作树.tmp，禁止npm install/ci：

```powershell
Invoke-WebRequest -Uri https://registry.npmjs.org/@chenglou/pretext/-/pretext-1.0.0.tgz -OutFile .tmp/text-layout-sources/pretext.tgz
tar -xzf .tmp/text-layout-sources/pretext.tgz -C .tmp/text-layout-sources
node scripts/prepare-text-layout-acceptance.ts
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/index.html --out .tmp/text-layout-acceptance/report.json --screenshot .tmp/text-layout-acceptance/drawing.png
```

后续先决定是否继续扩展Pretext适配或按裁定评估CanvasKit，再处理失败根因并重跑1–3；之后补齐4–8完整生产实验。所有门槛通过后才完成冻结资源生成、2.0.0登记、新建默认API8和新能力用法技能同步。当前未改这些默认/发行状态。

末次共享检查：`check:assistant-capabilities` 退出0，结构/15项覆盖与237项不变量通过；`check:persistence-compat` 64格式通过。未修改技能。上游未修改Pretext tarball的SHA-512已与登记source.json完整一致。最终本工作树干净，HEAD `5e4c9bd21`，仍在 `task/10-文字排版`，未推送。
