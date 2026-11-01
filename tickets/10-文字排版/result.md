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

## 2026-11-01 按新裁定修复后的前置门复验（未达标，停止发行推进）

**结论：未完成 ticket 10。** 最终断点 **195/200**（同环境未改 Pretext **197/200**），未达 ≥198；非 emoji、扣除 P022/P027 后 **172/179** 的误差 ≤1/64，仍有 7 例超限。按本轮“哪一步门槛不过就停在那一步”停在实验 1–3 的前置断点/几何门；不继续实验 4–8，不冻结 2.0.0，不改新建默认 API7，不改作者技能。没有自行改用 CanvasKit，也没有扩大接受差异的名单。

### 已落地修复与复验边界

- P019：tab 的八空格停靠、最小推进与字距按所在 run 字体/字号/字重计算，walker 与输出几何使用同一来源；tab/CR/LF 不参与 cmap 缺字选脸，避免 Noto Sans JP 为 tab 返回非零 glyph 后劫持停靠字体。最终作者、DOM、上游宽度均 **299.28125px**，误差 **0**。
- U017：Pretext 机会对齐完整原文字素，保留 `a🏿` 与 `👶‍🛑` 的完整边界；合并后含组合符的空白段按文字处理，防止把后续 B 当悬挂空白。固定样本断点通过，误差 **0.003257751px**，不再抛“断行只能发生在完整字素边界”。
- U009/U010：未显式支持的书写系统走基础整形并输出 `inferred-script`，不拒绝整个段落。Unicode Script 分类使用运行时 Unicode 正则；不同脚本不合并成一次猜测，Node 22 不认识的新 alias 通过特性检测跳过。本机 Bali 字形仍缺失，保留 `missing-glyph`，两例断点通过，误差分别 **0.008468628/0.008464813px**，不能解释为已支持 Bali 字形。
- Windows 候选表按 [Chromium 152 官方 font_fallback_win.cc](https://raw.githubusercontent.com/chromium/chromium/152.0.7977.167/third_party/blink/renderer/platform/fonts/win/font_fallback_win.cc) 补齐常见脚本，包括 Segoe UI Emoji/Symbol/Historic、Nirmala、各 CJK、Malgun/Javanese 等。Script 短名来自 [Unicode 17 PropertyValueAliases](https://www.unicode.org/Public/17.0.0/ucd/PropertyValueAliases.txt)，没有自写 Unicode 码点分类算法。候选表覆盖不等于完全复现 Chromium/DirectWrite 的字形级回退。
- U018/U019：emoji 呈现优先系统 emoji 脸；无整簇覆盖时保留能覆盖主体的脸，并明确报告缺字。U018 不再因组合符把整簇换成 Symbol 或首字体方框，现选 **Segoe UI Emoji**；断点通过，几何仍差 **18.424484253px**，原因和限制见下表。U019 的 VS16 选脸修复后误差 **0.005210876px**。
- 实验读取器移除“任何未知系统字体都映射到 TicketLatin/TicketCJK”的替身；用现有 `standaloneFont/parseFontFile` 提取本机真实 SFNT、识别 family aliases，缺失候选返回缺失。DOM 与未改 Pretext 共用显式候选字符串。注册 FontFace 只用于实验对照，不进入生产新排版路径。
- 实验门禁接受 P022/P027 的预期排版差异，但执行异常仍阻断；前置门失败即返回，不继续运行后面的绘制性能诊断。未修改固定 200 例、宽度、文本或误差容限。

### 固定样本最终数据与差异清单

最终报告：`D:/VibeCode/Henji-AI-t10/.tmp/text-layout-acceptance/verified-11-01-report.json`，SHA-256 **`98698df775264831e72d1d51c6728f81794d1f7f9993f0f494a8c0be6b10910d`**。固定 fixture SHA-256 仍为 **`56d23edddb7e0376639e800257c9170a321a8b88f51f0a53de1059f01596da4e`**。Electron **44.9.3** / Chromium **152.0.7977.167** / DPR **1.5** / zh-CN，独立临时 profile、随机 localhost 端口。各字体实际 family、别名、字节数与 SFNT hash 全部在报告 `environment.fonts`；逐簇作者选脸在 `cases[].selection`。未分发本机字体。

- 原始断点：**195/200**；失败 P018、P022、P027、U004、U007。扣除接受项后仍有 **3** 例失败，且低于同一环境未改 Pretext 的 **197/200**（其失败为 P018/P022/P027）。上轮上游 194/200 使用旧回退实验读取器，不能把环境变化后的 197 与它当作同条件性能提升。
- 原始几何：**186/200**；非 emoji 且扣除接受项后 **172/179**，最大有限误差 **15px**。不是把 emoji 差异加大容限后算进通过。
- W−1/64、W、W+1/64 共 **600** 条：断点 **585/600**，原始几何 **558/600**；新门槛下有 **27** 条阻断记录。固定样本及临界样本的执行异常均 **0**。

| ID | 最终差异/数据 | 裁定与原因边界 |
|---|---|---|
| P022 | 21px 软连字符应急断行，作者/上游与 DOM 行数不同 | **接受**；照 11-01 裁定保留输入和差异，不再追此极窄情形 |
| P027 | 1px 宽时作者/上游多出空白独占行 | **接受**；照裁定保留，不豁免异常 |
| P018 | 作者首行原文 end=25、135px；DOM end=23、120px；未改 Pretext end=29、135px | **阻断**；替代对象符已用 Arial 补齐，但跨 run 软连字符退回策略仍不一致；上游也不一致，精确退回策略尚未解决 |
| P011/P012/P013 | 均 **0.018230438px**，断点一致 | **阻断**；富文本跨字重及软连字符的原始 HB 推进与 DOM Range 结果仍超 1/64。量化/fragment 累计是待定位方向，尚无证据把它归为可接受 AA 误差 |
| P021 | **4.911458969px**，断点一致 | **阻断**；软连字符位于空白前，DOM 行尾可见连字符，作者/上游该行推进未计入它；不属于已接受的 P022 宽度 |
| P025 | **4.908854485px**，断点一致 | **阻断**；同上，窄行的可见连字符差异，未扩大接受名单 |
| P038 | **0.020996094px**，断点一致 | **阻断**；跨字号、字重与 tracking 的富文本推进累计仍超限，尚未完成精确量化归因 |
| U003 | **18.067707062px**，断点一致；Segoe UI Emoji 的 `❗̈` 报缺字 | 差异保留：为保留 emoji 主体而整簇留在 emoji 脸，U+0308 无覆盖；与浏览器组合符回退的推进不同 |
| U004 | **15.845703125px**，断点不一致 | **阻断**；同一 `❗̈` 的缺字推进扩大，加入空格后改变断点，不以“emoji 差异”豁免断点门槛 |
| U007 | 行数不同，几何误差记 null | **阻断**；`❗̈§` 组合，同一整簇单脸缺字推进改变断点 |
| U008 | **18.065753937px**，断点一致 | 差异保留；同上，空格改变分行但此例断点一致 |
| U009/U010 | Bali 字形缺失，但断点/几何通过；各有缺字与基础整形诊断 | 未宣称 Bali 完整支持。无可用候选时显示缺字结果，不抛错；已有字体的其他书写系统不会被并入同一次 script 猜测 |
| U018 | 作者 emoji 簇 **91.0546875px**，DOM **109.479171753px**，差 **18.424484253px**；断点一致 | 选脸已修为 Segoe UI Emoji；该非标准修饰符/音标/ZWJ 序列仍有 U+0308 缺字，整簇单脸整形与 DOM 拆分回退/序列整形不同。未取得 DOM 的逐 glyph 实际字体追踪，不能声称已定位每个 DOM glyph 的精确字体 |
| P039 | Malgun Gothic，误差 **0**，无缺字诊断 | 韩文回退样本通过 |
| U020 | SimSun-ExtB + Segoe UI Emoji，误差 **0.002609253px**，无缺字诊断 | 扩展汉字回退样本通过；不外推整个字体覆盖范围 |

### 实验 3–8 与停止点

- 实验 3：最终门禁在断点/几何阶段停止，**未完成 DOM 标点 1×/4×墨迹叠图**。诊断阶段的 `final-11-01-drawing.png` 已打开，能看到黑色轮廓文字；同阶段静态/逐字落定与录制重放差异通道均 0。该图只证明局部绘制有效，不能作为最终实验 3 达标证据。
- 实验 4：未运行真实 Worker 大字体/冷准备/首帧/内存/关闭专项。
- 实验 5：最终运行未进入性能段；早期脚本附带的 Canvas 诊断数据不是完整生产上传/合成，**不作 ≤4ms 验收**。
- 实验 6：未运行描边生长、three 挤出专项。
- 实验 7：只取得上表 Windows 固定样本的选脸与推进证据；macOS、AAT、位图/彩色格式及同快照各入口像素矩阵未验。
- 实验 8：未运行 DOM 逐格 tnum/窄列叠图。
- 不运行 Reality；未运行 `test:gpu` 全套或无关合成精度专项来替代本票失败门槛。2.0.0 冻结目录不存在，新建常量 `CODE_AUTHOR_DEFAULT_API_VERSION` 仍为 **7**。

### 验证、审查与提交边界

- 本轮改共享排版核心，按 testing.md **L2**；显式 8 文件的 `verify:changed` 通过：6 个直接消费者测试文件 **36 项**、改动文件 ESLint、renderer/electron 两套增量 tsc。Node **22.12.0** 另跑 shaping/textPlan 的 **28 项**通过，用于复验 Unicode 16 运行时导入兼容性。Node 脚本语法检查、实际 esbuild、独立 Electron 执行及 `git diff --check` 已完成；Electron 退出 **1** 是保留失败门槛，不称通过。
- `check:persistence-compat`：**64 种格式通过**。`node scripts/check-text-layout-vendor.cjs --check`：字节/许可/反向补丁及 7 模块无 Canvas 可达图通过。
- `check:assistant-capabilities`：退出 **0**；结构检查、**15 项**覆盖及 **31 文件/237 项**业务不变量通过。没有把该检查替代排版实验或 GPU 验收。
- `check:skill-sync`：**失败**，导入现有巡检依赖时找不到 `native/video-decoder/ffmpeg/ffmpeg-n9.0.2-17-g2a571b6068-win64-gpl-shared-9.0/bin/ffmpeg.exe`；本轮未改技能，也未安装 FFmpeg、修改依赖或绕过该检查。
- 独立提交前审查 **3 轮**：第 1 轮修复“空白组合符被整段标为空白”和“不同未知脚本被合并”；第 2 轮修复“Node 22 不识别 Unicode 17 正则导致模块导入失败”和“接受项的执行异常被豁免”；第 3 轮增量审查无新重要/小问题。
- 同源排查覆盖：普通/富文本/tab/最小推进/字距/控制符字体归属、正常/应急完整字素边界与固有宽度、跨未分类脚本的上下文、emoji 与 VS 选脸、字体链及别名/缺失、作者 layoutText/table 消费者、字体通道/快照准备、实验异常门禁。表中已修和仍失败项分别列出；没有宣称所有排版、所有字体或生产 GPU 路径已修好。
- 始终在 `D:/VibeCode/Henji-AI-t10` 的 `task/10-文字排版`，起点 `5e4c9bd21`；未切分支、合并、推送或拉取。node_modules 仍为原联接点，未执行 install/ci/uninstall，package/锁文件未改；未触碰 9334、界面、真实资料或 `D:/视频制作`，主工作区仅更新获准的本 result 文件。
- 最终本地提交 **`63e7bf2c5 fix(text-layout): 修正字素边界、制表位与字体回退`**，8 个代码/实验文件；代码工作区干净。result 位于获准的共享 tickets/10 目录，未混入本分支提交。**未推送、未合并**。

精确复现最终数据（保留固定 cases，不重新抽样）：

```powershell
node scripts/prepare-text-layout-acceptance.ts
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/index.html --out .tmp/text-layout-acceptance/verified-11-01-report.json
npm run verify:changed -- --level L2 --test src/core/imaging/vectorContent/shaping/shaping.test.ts --test src/core/imaging/vectorContent/shaping/textPlan.test.ts --test src/core/imaging/vectorContent/shaping/fontChannel.test.ts --test src/features/videoEdit/authorLibraries/shapedText.test.ts --test src/features/videoEdit/engine/videoEditAuthorTextResources.test.ts --test src/platform/textFontSnapshot.test.ts scripts/prepare-text-layout-acceptance.ts scripts/text-layout-acceptance-browser.ts scripts/run-text-layout-dom.cjs src/core/imaging/vectorContent/shaping/fontSession.ts src/core/imaging/vectorContent/shaping/paragraph.ts src/core/imaging/vectorContent/shaping/runs.ts src/core/imaging/vectorContent/shaping/shaping.test.ts src/core/imaging/vectorContent/shaping/textPlan.ts
```

## 2026-11-01 第二轮裁定落实：软连字符及实验1–3通过，实验4阻断

**结论：停在实验4，ticket 10 未完成。** P021/P025 可见软连字符的宽度和绘制已修复，P018 同源问题同时消除；实验1–3达到 review.md 第二轮裁定门槛。正式渲染 Worker 的两个同时存活素材仍各自复制同一字体到 HarfBuzz，违反设计§4.5和实验4“同 Worker 同字体只准备一次”。按用户指令在此停止，不修这个新阻断、不运行实验5–8、不冻结 henji-layout 2.0.0、不修改新建默认 API7或作者技能。

### 修复及实验1–3

根因在共享 `ShapedParagraph`：自动换行时尾空白前的 U+00AD 没有被识别为可见插入字形，尾空白占用宽也未包含它；原替代字符固定为 ASCII `-` 并与前文一起整形，和浏览器使用当前字体 U+2010（缺字才回退 `-`）、独立插入的字偶距语义不同。现在测量、输出 glyph、原文 cluster 与尾空白占用宽使用同一可见连字符，段尾/硬换行/未换行的软连字符仍隐藏。没有修改 vendor 或固定样本。

- 固定200例原始断点 **196/200**，未改 Pretext **197/200**。仅 P022/P027/U004/U007 不同，均属第二轮接受项；扣除全部7项接受序列后 **193/193** 一致。原始几何193/200；非 emoji、扣P022/P027后 **179/179**，最大 **0.02099609375px < 1/32px**。P018 已通过，无需追加豁免。
- 临界 W−1/64、W、W+1/64 共600例：原始断点588/600、原始几何579/600；新裁定下非豁免门槛失败 **0**，执行异常 **0**。接受名单固定为 P022/P027/U003/U004/U007/U008/U018，没有把执行异常计作接受差异。
- P018：两行原文范围[0,23]/[23,33]、宽120/45px，与DOM完全相同。P021误差 **0.013021469px**（作者23.4140625/DOM23.427083969）；P025误差 **0.010416985px**（作者14.15625/DOM14.166666985）。单独绘制原文软连字符簇，advance均 **4.8984375px**，非零像素通道分别32/40，证明可见字形实际画出。
- 中英间距：中文AI中文关闭/开启160/168px；中文 AI 中文192/192px；中文2026中文192/200px，作者与DOM一致。
- 实验3：SimHei、Noto Sans SC、Noto Sans JP × 7组配对/连续标点 × 1×/4×，共 **42组**；保留无特性/halt/chws glyph明细，DOM Range字位与advance最大差 **0.010417938px**；静态/逐字落定像素通道差全部 **0**。42组均输出DOM/HB/overlay共126张PNG，逐字符墨迹边界差最多 **1个物理像素**；目视抽查两档及三字体叠图（含连续标点），未见双边或双重挤压，该差异记为AA。自动几何与墨迹检查覆盖全部42组，目视不是逐张全查。
- 同源排查覆盖共享段落的普通/富文本、软连字符前后run、尾空白/硬换行/段尾、正常/应急折行、字距及RTL排序、作者绘制消费者；P018/P021/P025已修，固定非豁免集合未发现同类失败。未把这些结果外推为所有字体、跨平台或所有GPU功能均通过。

### 实验4数据与失败原因

独立Electron临时profile、随机HTTP端口，运行正式 `videoEditWorker` / `authorMetadata` / `authorFrame`，专项esbuild生产优化打包，共享正式作者库与HarfBuzz模块。字体通过独立MessagePort传输，生产Worker FontFace构造计数始终 **0**，都有实际GPU出帧和有效墨迹。未连接9334，未跑Reality；不是完整 electron:prod 应用发布验收。

装载子集每支5次预热、30次计量，单位ms：

| 场景 | P50 | P95 | max |
|---|---:|---:|---:|
| 独立Worker冷准备 | 452.2 | 575.2 | 581.4 |
| 独立Worker冷首帧（含准备） | 879.2 | 1178.0 | 1180.4 |
| 同Worker热准备 | 3.9 | 5.2 | 5.5 |
| 同Worker热首帧（含准备） | 10.7 | 15.0 | 16.0 |

热循环额外字体读取0。切Noto Sans JP / SimHei / SimSun-ExtB / Segoe UI Emoji首帧分别38.3/61.1/22.6/25.6ms；SimSun-ExtB已由默认链预载，切换时0读取。双Worker装载、切字体及各分支关闭断言通过，每次字体快照close恰好1次。装载子集report的gate=true仅代表这部分断言，不代表完整实验4通过。

**真正阻断：同Worker两个同时存活素材，文本、字体hash、face、轴完全相同。**

| 证据 | 第一个素材 | 第二个素材加载后 |
|---|---:|---:|
| 同key HarfBuzz Font实际对象数 | 1 | 2 |
| wasm memory字节 | 17,956,864 | 35,782,656 |
| 第二次新增字体读取 | — | 0 |
| 有效墨迹通道数 | 11,595 | 11,595 |

字体Noto Sans SC规范化SFNT **17,773,244 bytes**，hash `763146584cf0710223441356b4395e279021b0806c196614377a7a0174ae074a`；wasm增长 **17,825,792 bytes**。计数器用WeakMap识别正式TextShaper返回的Font对象，只存编号、不持有对象，且两个素材都仍存活；因此不是仅凭heap高水位猜测重复实例化。

只读定位：`src/features/videoEdit/authorLibraries/shapedText.ts:29,44,52` 的shapers以 `fonts.owner` 缓存；`videoEditAuthorTextResources.ts:26–28` 为每个素材提供各自owner；`shaping/harfbuzz.ts:29–30` 的Face/Font缓存是每个TextShaper实例私有，创建Blob会复制整个SFNT到wasm。需要按设计在同Worker、同库运行时共享字体对象并保持会话引用释放语义；本轮按停止要求不改这条路径。

关闭中迟到读取得到 `Error: 字体租约已经释放`，等待正确拒绝、快照close=1；无重复requestKey读取。关闭后wasm仍维持高水位符合设计，不把“不缩小”本身报成泄漏。最终渲染器JS heap used/total **94,124,835/98,123,219 bytes**；500ms采样的渲染器最大工作集 **633,300 KiB**，完整进程采样在report。事件循环延迟P50/P95/max为0/22.5/151.3ms，混入实验端getImageData和像素遍历，**不能据此判断主进程字体处理是否阻塞**；完整主线程预算、对象释放/GC矩阵尚未验完，实验4不能宣称全面完成。

独立Node worker_threads还运行了正式 `fonts/worker.ts → FontScanner.read → standaloneFont` 的读取/规范化，每种5预热30计量：

| 字体/格式 | 原始→规范化bytes | P50/P95/max（ms） |
|---|---:|---:|
| SimHei TTF | 9,753,388→9,753,388 | 13.18/18.19/18.38 |
| SimSun-ExtB TTF | 21,894,056→21,894,056 | 23.43/26.96/29.38 |
| Noto Sans JP OTF | 4,472,168→4,472,168 | 5.70/11.22/16.78 |
| Microsoft YaHei TTC | 19,704,352→19,583,608 | 64.72/69.92/72.96 |
| Segoe UI Emoji TTF | 2,072,388→2,072,388 | 2.41/3.64/3.94 |
| Geist WOFF2 | 29,400→65,800 | 1.85/2.28/2.39 |

未清操作系统磁盘缓存，不称冷磁盘；采用本批可取得最大完整CJK字体21.89MB，没有虚构30/60MB样本。报告保留Node进程内存。这些装载数据不替代实验5逐字帧预算、实验6描边生长/three、实验7跨平台/彩色字体、实验8表格tnum：**5–8均未运行**。

### 验证、审查与复现

- 共享排版核心变更按testing.md L2，显式9文件 `verify:changed -- --level L2` **通过**：shaping/textPlan/shapedText 3文件30测试、改动文件ESLint、renderer与Electron增量tsc。脚本Node语法、真实esbuild/Electron、git diff --check通过；lifecycle实验退出1准确保留失败门槛。
- `check:persistence-compat` **64格式通过**；`check:assistant-capabilities` 结构、15项覆盖、31文件237项不变量 **通过**；`check:skill-sync` **5技能25文件通过**；`node scripts/check-text-layout-vendor.cjs --check` 字节/许可/反向补丁/7模块零Canvas可达图 **通过**。
- 本轮实际运行实验3 Canvas和正式Worker GPU出帧；未把它们宣称为完整相关GPU验收。按实验4停止要求没有扩展运行test:gpu或实验5–8。
- 独立提交前审查 **2轮**：第1轮发现重要项“切字体分支缺少失败断言”和小问题“失败后重复close可能挂起”，均修复；第2轮增量未发现新问题。后来仅将既有SHY单测预期调整为当前字体可用的独立连字符，最终L2复验通过。
- 本轮仅9个核心/测试/实验脚本文件；未改依赖、UI、技能、持久格式或API默认值。node_modules与Claude补齐的FFmpeg联接未动。未拉取、切分支、合并或推送；主工作区仅追加本result，未触碰D:/视频制作。

证据目录 `D:/VibeCode/Henji-AI-t10/.tmp/text-layout-acceptance/`（忽略目录，不提交字体/截图/临时产物）：

| 文件 | SHA-256 |
|---|---|
| verified-second-ruling-report.json | `336cb7001275cd740e3fdfeefebee991a2289b715dee265d43d2775ca9e58269` |
| worker-full-11-01-report.json | `691c9520bbac9a585df99ef9fb070b7bb6ee0d4d91370bf2afe2ff5dd7592fb4` |
| worker-lifecycle-11-01-report.json | `679e9b9dc0d8735d8a38216b758725ff9ef2a7f4d4e5ddc99ec4a198422de74d` |
| font-io-report.json | `713980e6a7a956f3e43db5b0489230728b69015df34de0914863b430c81b4dae` |

环境Electron44.9.3/Chromium152.0.7977.167/DPR1.5；固定fixture SHA-256仍 `56d23edddb7e0376639e800257c9170a321a8b88f51f0a53de1059f01596da4e`。复现依赖本工作树既有.tmp上游Pretext与字体准备，不重新抽样，不执行npm install/ci：

```powershell
node scripts/prepare-text-layout-acceptance.ts --worker
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/index.html --out .tmp/text-layout-acceptance/verified-second-ruling-report.json
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --out .tmp/text-layout-acceptance/worker-full-11-01-report.json
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --phase lifecycle --out .tmp/text-layout-acceptance/worker-lifecycle-11-01-report.json
node scripts/text-layout-font-io-experiment.mjs
npm run verify:changed -- --level L2 --test src/core/imaging/vectorContent/shaping/shaping.test.ts --test src/core/imaging/vectorContent/shaping/textPlan.test.ts --test src/features/videoEdit/authorLibraries/shapedText.test.ts src/core/imaging/vectorContent/shaping/paragraph.ts src/core/imaging/vectorContent/shaping/shaping.test.ts scripts/prepare-text-layout-acceptance.ts scripts/text-layout-acceptance-browser.ts scripts/run-text-layout-dom.cjs scripts/text-layout-punctuation-experiment.ts scripts/text-layout-worker-experiment.ts scripts/text-layout-worker-probe.mjs scripts/text-layout-font-io-experiment.mjs
```

本轮本地提交：**4a1bd8c47 fix(text-layout): 修复行尾软连字符并补齐排版实验**。分支 task/10-文字排版，代码工作区干净；未推送、未合并。最终复核2.0.0冻结目录不存在，新建默认API仍为7。

## 2026-11-01 字体对象共享修复：实验4通过，实验5预检触发停止

**结论：停在实验5，ticket 10 未完成。** 实验4重复字体对象阻断已修复；实验5的200字、1080p、纯填充逐字位姿分支，文字CPU耗时下界P95为 **5.20ms > 4ms**。按本轮“哪一步门槛不过就停在那一步”的指令，不继续其余实验5矩阵、实验6–8，也不冻结henji-layout 2.0.0、不修改新建默认API7、不改作者技能。没有把专项预检当作完整electron:prod性能验收。

### 修复及同源排查

- `shaping/harfbuzz.ts` 的缓存从每个TextShaper独占，改为同HarfBuzz模块/wasm运行时共享：Blob按内容hash、Face按hash+face、Font按hash+face+规范化轴键缓存。Font只在创建发布前设置scale/variations；字号、features、文本不修改共享Font。每个TextShaper只取得一次自己的引用，最后一个使用者关闭时依次显式释放Font、Face、Blob，字节内存可供wasm重用。不同冻结库运行时仍分离。
- 检查范围：所有生产TextShaper创建点、作者素材owner/onClose、普通及富文本整形、轮廓/metrics/extents/ink、命名实例轴、两素材同时存活/先后关闭、关闭后重建。未发现其他发布后setScale/setVariations调用。没有修改旧冻结库、vendor、持久格式、UI或字体I/O生产路径。
- 新增1项真实缺陷回归：相同内容不同ArrayBuffer、不同字号/features复用同一Font，等价轴键复用、不同轴分离；关闭一个会话后另一个还能整形，最后关闭后原生对象ptr拒绝读取，重复dispose不重复释放，重新加载能工作。断牙临时恢复HEAD的原实现，得到“setScale预期1次、实际2次”的明确失败；随后恢复本次修复，精确测试通过。

### 实验4：真实Worker共享、释放、装载

使用既有专项启动器的独立Electron进程/profile及随机HTTP端口，生产优化esbuild产物调用正式videoEditWorker/authorMetadata/authorFrame，专用字体MessagePort。未连接9334；生产Worker的FontFace构造数始终0，实际GPU出帧有墨迹。原生对象探针仅保留WeakRef，快照区分alive/disposed/collected；GC只在专项进程启用，不修改应用配置。

- 同时存活两素材、同Noto Sans SC：Font/Face/Blob均从 **1/1/1保持1/1/1**；wasm均 **17,956,864 bytes**，第二个素材增长 **0 bytes**，重复字体读取0。规范化字体17,773,244 bytes，hash仍为`763146584cf0710223441356b4395e279021b0806c196614377a7a0174ae074a`。
- 关闭第一个素材后Font/Face/Blob仍各存活1，剩余素材继续出帧；关闭第二个后各alive=0、disposed=1。重建同字体后wasm仍17,956,864 bytes，最终关闭后各alive=0、disposed=2；强制GC后各collected=2，没有用heap高水位不下降冒充泄漏。
- 关闭中迟到读取正确拒绝“字体租约已经释放”，快照恰好关闭1次。冷/热装载、切字体和双Worker分支全部有实际GPU出帧，最终原生对象alive均0，各快照close=1。

冷/热各5次预热、30次计量，单位ms（不清OS磁盘缓存；冷指独立Worker重建，不称冷磁盘）：

| 场景 | P50 | P95 | max |
|---|---:|---:|---:|
| 独立Worker冷准备 | 824.2 | 1424.4 | 1693.7 |
| 独立Worker冷首帧含准备 | 1568.0 | 2691.7 | 3131.6 |
| 同Worker热准备 | 5.2 | 9.7 | 15.4 |
| 同Worker热首帧含准备 | 18.3 | 30.8 | 31.9 |

热循环新增字体读取0。切Noto Sans JP/SimHei/SimSun-ExtB/Segoe UI Emoji首帧分别65.6/92.9/25.0/53.4ms；SimSun-ExtB预载命中，新增读取0。渲染器JS heap used/total为69,705,984/73,614,588 bytes；500ms进程采样中渲染器最大工作集609,208 KiB。读取/规范化仍通过正式fonts/worker.ts → FontScanner.read → standaloneFont，六类真实字体大小与线程协调延迟见本节最终验证数据；没有虚构30/60MB样本。渲染器实验端getImageData混入的lag不用于证明主进程预算。

### 实验5：停止点及证据边界

Noto Sans SC，32px，文字`文字排版中文首帧ABC2026`重复后取200字；1920×1080，wrapWidth=1800，纯白填充，无描边阴影；逐字位姿为`y = sin(time + index) * 5`。各分支5次预热、30次计量，首帧另记。作者draw使用模块求值期间捕获的真实performance.now：宿主在作者函数内部固定时钟为素材时间，直接在draw内取时钟会得到0；这类探针调试零值不作为证据，最终报告已由修正探针重跑覆盖。

| 分支 / 指标（ms） | P50 | P95 | max |
|---|---:|---:|---:|
| 静态作者draw | 1.90 | 2.80 | 3.30 |
| 静态文字CPU下界 | 1.90 | 2.80 | 3.30 |
| 静态完整请求帧 | 5.20 | 7.20 | 7.90 |
| 逐字位姿作者draw | 1.70 | 2.90 | 3.70 |
| 逐字位姿栅格 | 1.10 | 2.40 | 3.10 |
| 逐字位姿上传 | 0.30 | 0.40 | 0.60 |
| **逐字位姿文字CPU下界** | **3.20** | **5.20** | **6.20** |
| 逐字位姿完整请求帧 | 9.30 | 11.90 | 12.40 |

文字CPU下界是**每帧**draw+栅格+上传之后再求P95，不是相加三个P95；不含录制比对、合成与GPU等待。固定纯轮廓路径使用正式录制/回放，各阶段没有重复计时。静态30/30帧复用纹理且栅格/上传均0；逐字位姿0/30帧复用。首帧有效墨迹通道数静态103,626、位姿106,344。

这已经触发专项停止门槛；静态CPU下界小于4ms并不证明完整文字阶段通过。没有运行旧版对照、20/1000字、4K、描边阴影、1×→8×推近和播放p90/跳帧，也没有描边生长、three挤出、完整回退/彩色格式/跨平台、表格DOM tnum数据，均不得写为完成。耗时期间本机还有其他工作树的Node/TypeScript任务，本票未结束它们；上述是本次环境的专项失败证据，不外推为独占机器或完整正式应用的最终性能。实验5的瓶颈尚未做进一步根因定位/优化。

### 实验4字体I/O补齐及复现

独立Node协调线程调用正式字体worker；事件循环直方图在5次预热结束后启用，下面全部为30次计量期间的数据。该指标证实耗时规范化被移入字体线程，不把独立Node协调线程冒充完整Electron主进程预算。

| 字体/格式 | 原始→规范化bytes | I/O P50/P95/max（ms） | 协调线程事件循环P50/P95/max（ms） |
|---|---:|---:|---:|
| SimHei TTF | 9,753,388→9,753,388 | 17.19 / 23.13 / 23.92 | 1.45 / 4.39 / 7.36 |
| SimSun-ExtB TTF | 21,894,056→21,894,056 | 35.86 / 43.26 / 49.98 | 1.38 / 2.92 / 12.44 |
| Noto Sans JP OTF | 4,472,168→4,472,168 | 7.78 / 11.60 / 11.63 | 1.46 / 3.32 / 4.80 |
| Microsoft YaHei TTC | 19,704,352→19,583,608 | 89.53 / 100.35 / 101.77 | 1.45 / 1.65 / 12.87 |
| Segoe UI Emoji TTF | 2,072,388→2,072,388 | 4.22 / 6.04 / 6.38 | 1.47 / 3.22 / 4.36 |
| Geist WOFF2 | 29,400→65,800 | 2.55 / 2.94 / 3.04 | 1.01 / 2.30 / 2.78 |

证据仍在当前任务工作树`.tmp/text-layout-acceptance/`，不提交字体、截图或临时产物。Electron44.9.3、Chromium152.0.7977.167。

| 文件 | SHA-256 |
|---|---|
| worker-lifecycle-shared-report.json | `90cd19996013f40d7a707b0733a95a6a1bf31788b53410f5c31353a0e59158d1` |
| worker-full-shared-report.json | `198f0716caa8e58d85eba1c1c3636817c0634d7e39b4b42f30bb81727becf2cd` |
| worker-frames-shared-report.json | `bb69cc6015d869e36baec763fe261f0a10b64303e5c68a66ac5630140e48519f` |
| font-io-report.json | `e658256705b83d28b5cdbf6d970fafea1a27d783bbeca6bf1aa10659e329b32a` |

复现（逐条执行，一次一个重任务；frames命令预期退出1，失败后不执行后续实验）：

```powershell
node scripts/prepare-text-layout-acceptance.ts --worker
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --phase lifecycle --out .tmp/text-layout-acceptance/worker-lifecycle-shared-report.json
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --out .tmp/text-layout-acceptance/worker-full-shared-report.json
node scripts/text-layout-font-io-experiment.mjs
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --phase frames --out .tmp/text-layout-acceptance/worker-frames-shared-report.json
```

### 本轮验证与审查

- 按testing.md L2：共享字体核心跨整形、排版和作者消费者；显式6文件`verify:changed -- --level L2`通过，精确4文件 **33测试**、改动源文件ESLint、renderer/Electron双工程增量tsc全部通过。首次renderer tsc因Node默认4GB堆上限退出134；仅在重跑命令中设`NODE_OPTIONS=--max-old-space-size=8192`后通过，没有改项目配置或隐藏失败。
- `npm run check:persistence-compat` **64格式通过**；`npm run check:assistant-capabilities` 结构、15项覆盖、31文件 **237项不变量通过**；`npm run check:skill-sync` **5技能25共享文件通过**；`node scripts/check-text-layout-vendor.cjs --check` 字节/许可/反向补丁/7模块零Canvas可达图通过。四个本次实验脚本Node语法检查、实际esbuild及`git diff --check`通过。
- 实际GPU验证为本次正式Worker实验4与实验5预检：前者通过、后者退出1准确报告5.20ms失败。按停止要求未扩展运行其他`test:gpu`、完整Reality/electron:prod或实验6–8，不能报“所有GPU测试通过”。
- 独立提交前审查 **2轮**，无重要问题；第2轮发现一个小问题“事件循环直方图含预热、与报告口径不符”，已修为第6次读取前才启用并重跑六类字体I/O，最终数据及哈希以上表为准。
- 本轮代码文件范围仅`shaping/harfbuzz.ts`、`shaping/shaping.test.ts`及`run-text-layout-dom.cjs`、`text-layout-worker-probe.mjs`、`text-layout-worker-experiment.ts`、`text-layout-font-io-experiment.mjs`。新建默认API仍7，2.0.0冻结目录不存在；技能未改，因此没有进入Claude措辞把关阶段。
- 未切分支、拉取、推送或合并；没有安装/卸载依赖，node_modules与native/video-decoder/ffmpeg仍为原联接点。未动9334开发版、UI、真实资料、D:/视频制作；主工作区仅追加获准的本result。代码提交号见下方最终记录。

```powershell
$env:NODE_OPTIONS='--max-old-space-size=8192'
npm run verify:changed -- --level L2 --test src/core/imaging/vectorContent/shaping/shaping.test.ts --test src/core/imaging/vectorContent/shaping/textPlan.test.ts --test src/features/videoEdit/authorLibraries/shapedText.test.ts --test src/features/videoEdit/engine/videoEditAuthorTextResources.test.ts src/core/imaging/vectorContent/shaping/harfbuzz.ts src/core/imaging/vectorContent/shaping/shaping.test.ts scripts/run-text-layout-dom.cjs scripts/text-layout-worker-probe.mjs scripts/text-layout-worker-experiment.ts scripts/text-layout-font-io-experiment.mjs
```

本轮本地提交：**b27441a35 fix(text-layout): 共享字体对象并释放会话引用**。仍在task/10-文字排版，代码工作区干净；未推送、未合并。ticket 10 停在实验5，不能冻结或启用新默认。

## 2026-11-01 同字重配对复测：实验 5 未达标，按门槛停止

本轮起点 `b27441a35`，本地提交 **`823943658 test(text-layout): 添加同字重逐帧配对与外观失败门禁`**。仍在 `task/10-文字排版`。只改四个专项脚本，不改生产实现、UI、默认版本或冻结库；没有推送、切分支或合并。实验 4 沿用上一轮通过证据，本轮未重跑。**实验 5 整体不通过，实验 6–8 未执行，不能冻结 2.0.0。**

### 有效配对及停止判定

复用正式 `videoEditWorker / authorMetadata / authorFrame` 的优化专项构建，独立隐藏 Electron/profile、随机 HTTP 端口，不连接 9334。旧侧原样复制冻结 `henji-layout 1.2.0` 的 mjs；新侧使用当前作者入口。两侧同一 Noto Sans SC SFNT，17,773,244 bytes，SHA-256 `763146584cf0710223441356b4395e279021b0806c196614377a7a0174ae074a`；32px、**fontWeight=100**、1920×1080、wrapWidth=1800、纯白填充。200 字来自 `文字排版中文首帧ABC2026` 重复后截取；逐字 `y=sin(time+index)*5`。

字体文件 fvar 只有 wght 轴，min/default/max=100/100/900（独立审查直接解析实际 SFNT 核实）。旧 FontFace 的 family 不再被误当 fullName 精确别名而强制400，descriptor 与作者样式均100；新 HB 读取同一字节、空轴使用默认100，字体声明也显式100。**最初 3.00/4.90ms 对 5.70/8.10ms 的配对把旧侧400与新侧100混在一起，作废，不作为通过证据。**

同一 Worker，每对时间相同；相邻样本换先后顺序，5 对预热、30 对计量，首帧另记。文字阶段逐帧计算为“录制（含作者 draw、指纹比对）+表面准备（含边界分析、栅格、上传）”，再求分位数；作者 draw/栅格/上传是内部子项，不能重复相加，也不能相加各项 P95。每帧必须恰好出现一次录制与一次表面准备，缺阶段拒收。计时仅由专项 esbuild 插桩，正式源文件不改，插入点不唯一则构建失败。该文字阶段不含后续合成/GPU等待；完整请求帧另外报告，不称为完整播放器帧率。

| 分支 / 指标（ms） | P50 | P95 | max |
|---|---:|---:|---:|
| 1.2.0 文字阶段 | 7.50 | 10.20 | 11.10 |
| **API8 文字阶段** | **3.80** | **6.50** | **6.80** |
| 1.2.0 完整请求帧 | 23.00 | 26.50 | 28.20 |
| API8 完整请求帧 | 9.70 | 12.10 | 13.70 |
| API8 作者 draw（录制内） | 2.20 | 3.60 | 3.90 |
| API8 录制整体 | 2.30 | 3.70 | 4.10 |
| API8 表面准备整体 | 1.40 | 2.50 | 3.10 |
| API8 栅格（表面准备内） | 0.90 | 1.70 | 2.00 |
| API8 上传（表面准备内） | 0.20 | 0.50 | 0.50 |

相对差为 **−3.70ms**，满足“不比1.x慢1ms以上”；但 **6.50ms > 6ms**，绝对门槛失败，专项退出1。两侧30帧纹理复用均0，首帧墨迹通道数旧126,321、新106,344。耗时主要在作者提交/录制和轮廓栅格；未用分项P95相加推断总耗时，也未把某个循环认定为已证实的单一热点。最终修正夹具的运行停在 pose，不继续静态或其余矩阵，不重跑以挑选更低结果。此前静态2.90ms仅为被替换夹具的数据，不计为最终静态验收。

### 外观失败及同源排查

在纠正字重前的矩阵运行中另发现：API8 的20/200/1000字描边+阴影首帧全部为零墨迹。最初脚本只在分辨率循环末尾退出，导致失败后仍跑了其余1080p规模和推近；这是本轮实验脚本缺陷，已按独立审查修为首次失败立即保存证据并返回，作废其空白帧的性能数据，不将其作为有效矩阵通过证据。

针对停止行为的复测 `worker-matrix-stopped-report.json` 只有6个场景：20字静态/位姿/外观各两版；旧版外观截图墨迹通道数 **41,859**，API8 **0**，在API8外观热帧计量前停止。两张截图已目视核查：旧版有白字、橙色描边，新版全黑。该复测保留当时旧400/新100的夹具，仅用于空白缺陷与停止行为，不作为性能配对；最后的同字重配对门槛失败后没有再推进矩阵。

根因已由主代理和独立审查分别核实：

- `shapedText.ts` 的外观分支调用 `drawTextAppearance`；`videoEditAuthorCanvasRecorder.ts:350–352` 将其记录为 `textAppearance` 延迟绘制操作。
- `videoEditAuthorCanvasBounds.ts:241–316` 的 switch 没有处理该操作，default直接跳过，导致仅含外观文字时 `painted/bounds=null`。
- `videoEditAuthorRuntime.ts:376–381` 将 null 解释为空内容，提前退出，未到栅格/上传；失败报告中录制182次、表面准备181次、空表面1次与这条链一致。
- 实际检查范围为外观生成、录制与回放、共享内容边界、静止层组和运动层路径。纯轮廓 fill/stroke 路径不会忽略操作，已有实帧非空；运动层按显式bounds分配，不走此空内容退出。混合外观文字与其他已知范围绘制的静止组还存在裁剪范围漏计风险（代码推断，未新增GPU场景验证）。直接回放曾通过不能覆盖正式Worker的边界裁剪。不是“外观缓存命中所以零耗时”。

按“哪一步门槛不过就停在那一步回报”保留产品根因未修复，不把本轮实验脚本修复写成产品修复。完整4K/推近密度与落定、播放跳帧/合成p90、描边生长/three挤出、回退与彩色格式、表格tnum均未验收。

### 验证、审查与证据

- 用户指定的显式4文件 `verify:changed -- --level L2` 通过：`shapedText.test.ts`、`videoEditAuthorCanvasRecorder.test.ts`、`videoEditAuthorCanvasBounds.test.ts` 共 **21测试**。本次只改脚本，入口未选择业务工程tsc；不能写成双工程类型检查通过。最后的字重夹具修正经Node语法、实际专项构建及真实Worker配对执行验证，未重复与其无关的CPU套件。
- `check:persistence-compat` **64格式通过**；`check:assistant-capabilities` 结构检查、15项覆盖、31文件 **237项不变量通过**；`check:skill-sync` **5技能25共享文件通过**；`node scripts/check-text-layout-vendor.cjs --check` 字节/许可/反向补丁/7模块零Canvas可达图通过。四脚本Node语法、实际esbuild及`git diff --check`通过。
- 相关实际GPU证据为正式Worker配对及外观失败复现：**均按失败门槛退出1**，不能报“GPU验收通过”。没有扩跑无关 `test:gpu` 或完整Reality/生产应用验收。
- 独立审查 **3轮**：首轮3项重要问题（失败未立即停止、画布扩容漏计、推近空白漏检）和1项计时覆盖小问题均修复；第二轮增量通过并确认产品空白根因；自审发现字重不匹配后，第三轮确认同SFNT同默认轴100，无新增重要问题。外观产品问题属于本轮发现的既有问题，按停止要求未修。
- 新建默认仍 `CODE_AUTHOR_DEFAULT_API_VERSION=7`；`henji-layout/2.0.0` 未冻结，技能未改，故未进入Claude新能力措辞把关。node_modules与FFmpeg联接点未删除/改动，未运行npm install/ci/uninstall；未动9334、真实资料、D:/视频制作，主工作区只追加获准的本result。

最终证据在本工作树 `.tmp/text-layout-acceptance/`，不提交字体、截图、profile或临时产物；Electron44.9.3 / Chromium152.0.7977.167：

| 文件 | SHA-256 |
|---|---|
| worker-paired-weight-matched-report.json（最终有效配对，失败） | `783bb0806363b10d7a144eee40d20d44c420de7e73b7831a2866cbf7a1d3e5e6` |
| worker-matrix-stopped-report.json（外观空白与立即停止） | `5fe4d1476962a46406a4024b666067caa6b7155516787505c671bd971934e00a` |

复现第一步（预期退出1；不执行后续矩阵）：

```powershell
node scripts/prepare-text-layout-acceptance.ts --worker
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --phase frames --out .tmp/text-layout-acceptance/worker-paired-weight-matched-report.json
```

本轮交付为可复现的配对/停止专项与失败证据，**不是ticket10完成**。本地提交 `823943658`，未push；本分支代码工作区干净。

## 2026-11-01 收尾启动：吸收 main 冲突，停止执行

- 已读取 review.md 末尾最新裁定：实验 5 判定通过，本轮没有推翻或重测该结论。
- 起点为 `task/10-文字排版` 的 `823943658b4903f1f0234b31d5bf23bc74f8c51a`，工作区干净。执行 `git merge main`，目标为 `d475ecd48d55c323c85004d822896c1a860909de`，退出码 1，共 20 个冲突文件。
- 冲突包括：持久格式登记、迁移、基线与发布承诺，剪辑/录制 descriptor，风格/模板 schema 与应用入口，作者运行时、指纹、合成器、渲染 transport，以及黄金样本生成器与四份同版本样本。任务分支的剪辑 v46、录制 v49 与 main 的既有版本发生占号冲突；风格库 v7、风格包 v10 的黄金样本也发生 add/add 冲突。后续需要保留 main 已登记历史，再顺延本票版本，不能直接选择整侧覆盖。
- 按本轮“哪一步不过就停下回报”，未解决冲突或继续产品修改、实验与冻结。已执行 `git merge --abort` 成功，HEAD 恢复上述起点，`git status --short --branch` 确认任务代码工作区干净，无遗留合并状态。
- 描边/阴影文字空白本轮尚未修复；实验 6–8 未运行；henji-layout 2.0.0 未冻结，新建默认仍 API 7，技能未修改。指定专项检查、GPU 验证与 L2 验证本轮均未运行，不能报告通过；无代码改动，未发起独立审查。
- 本轮没有新提交、推送、切分支或合并到 main；主工作区只追加本 result.md。未操作端口 9334 的开发版，未启动实验进程，未操作 D:/视频制作；node_modules 与 FFmpeg 均确认仍为指向主仓库的 Junction，未安装、卸载或删除依赖。

## 2026-11-01 文字外观边界修复与实验 6：L2 字体准备失败，停止收尾

起点仍为 `823943658`，分支 `task/10-文字排版`。实验 5 沿用 review.md 最新“配对通过”裁定。本轮没有切分支、推送或合并 main；未触碰 9334 开发实例、D:/视频制作、主工作区其他文件，未安装/卸载依赖或操作 node_modules / FFmpeg 联接点。**本轮尚未提交：L2 未通过，不能把工作区改动称为已完成提交。**

### 描边阴影空白修复与实际排查范围

`TextAppearance` 携带含描边/阴影与栅格取整留边的局部范围，录制为数值参数；共享 `authorCanvasContent` 将其经过当前仿射变换、Canvas 效果与裁剪并入内容边界。纯外观文字不再被当作空内容，混合图层也不会仅按其他图形范围裁剪。回归覆盖纯文字、混合图层、旋转缩放、滤镜与裁剪，且边界分析不得执行延迟栅格回调。

同源排查检查了外观创建、全部 `drawTextAppearance` / `TEXT_APPEARANCE_DRAW` 调用方、录制、重放、静止组合与动态层范围；冻结 1.0–1.2 未使用该内部符号。纯轮廓路径没有本次漏计操作的问题。精确测试 3 文件 **22 项通过**。未把这一结论外推为全部作者运行时已通过。

独立隐藏 Electron/profile、随机 HTTP 端口，正式 Worker 优化专项构建完成外观矩阵。20/200/1000 字 × 1080p/4K × API7/API8 共 12 个场景均有首帧墨迹；API8 热帧无整画布临时分配，专项退出 0。目视打开 API8 1080p 的 20 字截图，白色文字和橙色描边均可见。数据按同字体/同字重记录；这里是依次执行的新旧场景，不是逐帧交替配对，不能冒充负载下性能门槛裁定。

| 分辨率 | 字数 | 旧 1.2.0 文字阶段 P50/P95 ms | API8 文字阶段 P50/P95 ms | API8 首帧墨迹通道数 |
|---|---:|---:|---:|---:|
| 1920×1080 | 20 | 0.70 / 1.20 | 1.50 / 1.90 | 39,653 |
| 1920×1080 | 200 | 5.20 / 6.70 | 12.10 / 15.60 | 373,393 |
| 1920×1080 | 1000 | 22.80 / 35.10 | 64.40 / 90.40 | 1,856,599 |
| 3840×2160 | 20 | 0.90 / 1.50 | 2.50 / 3.30 | 39,653 |
| 3840×2160 | 200 | 5.80 / 8.70 | 16.30 / 20.80 | 372,981 |
| 3840×2160 | 1000 | 36.90 / 49.10 | 65.00 / 80.70 | 1,852,940 |

外观重绘明显慢于旧版，不能写“整体性能更快”。设计将外观成本单列，不套典型纯填充 200 字门槛；1000 字是压力样本，以上保留其实际超预算结果。本轮没有重做实验 5 的通过裁定。

### 实验 6：描边生长与 three 挤出

新增 `scripts/text-layout-outline-experiment.ts`，复用正式 `createShapedTextPlan` / `TextShaper` 的 HB 轮廓与已安装 three 的 `SVGLoader` / `ExtrudeGeometry`，未手写曲线离散或三角化。独立 Electron 运行，1920×1080，Noto Sans SC、48px、文件默认字重 100，文本 `OB8国文字排版` 重复截取 20/200 字；5 次预热、30 次计量。首次脚本未准备默认 sans-serif，尚未测量即抛错；已纠正实验准备后实际运行，下表只记完整有效运行。

| 字数 | 排版 ms | 几何准备 ms | 首次 GPU 绘制并等待 ms | 描边 P50/P95/max ms | three 绘制并等待 P50/P95/max ms |
|---|---:|---:|---:|---:|---:|
| 20 | 38.50 | 32.10 | 23.30 | 0.10 / 0.10 / 0.20 | 0.20 / 0.60 / 0.70 |
| 200 | 24.60 | 16.50 | 12.50 | 0.40 / 0.50 / 0.60 | 0.40 / 0.60 / 0.70 |

两规模均复用 8 个字形几何，热帧前后 GPU geometry 数 **8→8**，几何 attribute 数组 964,224 bytes；O/B/8 洞数为 1/2/2。全部几何顶点有限；挤出正面与 Path2D 填充，距轮廓至少 2px 的内部差异 **0**。25%/50%/100% 描边非零通道数：20 字 32,418/37,512/37,578，200 字 339,789/385,863/386,427。正面截图已目视核对，专项通过。AA 边缘不作 exact 比较，未验证倾斜视角；这只是轮廓消费成本与正面几何实验，不是三维字产品或完整播放器性能结论，没有与旧库不存在的轮廓接口伪造性能配对。

### 停止点、验证与审查

显式 9 文件 L2 入口（含当时尚未运行的回退探针）选取 bounds、recorder、runtime、shapedText 四个直接消费者测试：**50 项通过、8 项失败**。失败全部在 `src/features/videoEdit/engine/videoEditAuthorRuntime.test.ts`，错误为“文字排版需要宿主先准备本模块声明的字体”，涉及字素动画、动态层纹理复用两种 cacheKey、文字事实沿用、未绘制布局、flex 测量、save/restore 合并及模块常量布局。调用链为 `currentTextFontSession` → `prepareTextLayout` → `layoutText`；部分发生在绘制之前。该测试文件本轮未改，但没有运行改前基线，不能据此断言失败已证明与本次无关。

`verify:changed` 在精确 Vitest 步骤退出 1，未执行后续 ESLint/renderer tsc；**不能报告 L2 通过**。按“哪一步不过就停下回报”停止，不修掉/跳过这些失败以继续发行。`check:persistence-compat`、`check:assistant-capabilities`、`check:skill-sync`、vendor --check 和其他 GPU 测试本轮未执行。相关 GPU 证据仅上面的外观矩阵与实验 6；不是全套 GPU 门禁通过。

独立审查 2 轮：第 1 轮修复和实验 6 无重要/小问题；第 2 轮发现尚未执行的实验 7 探针可能在选脸记录为空时误判通过。停止收尾时已撤掉该未执行分支及其插桩，未把它留下或当成实验 7 证据。实验 7–8 **未运行**；2.0.0 **未冻结**，新建默认 **仍 API7**，技能 **未改**；尚未到最后合并 main 的步骤。最终保留 8 个文件的本轮改动（7 个已跟踪修改、1 个新增实验脚本），无暂存/提交。

### 可复现证据

本工作树 `.tmp/text-layout-acceptance/`，不提交字体/截图/profile：

| 文件 | SHA-256 |
|---|---|
| appearance-fixed-report.json | `98819682e5cfc8d3e9c498565c112f18d20ee84b39ad1e8f9e9633f9c5168c28` |
| outlines-report.json | `61a0ad3b4151c405b39df04d2e8e90ce4af363e25a308b55b85a01d14be99aa5` |

```powershell
node scripts/prepare-text-layout-acceptance.ts --worker
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --phase appearance --out .tmp/text-layout-acceptance/appearance-fixed-report.json
node scripts/prepare-text-layout-acceptance.ts --outlines
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/outlines.html --out .tmp/text-layout-acceptance/outlines-report.json
$env:NODE_OPTIONS='--max-old-space-size=8192'
npm run verify:changed -- --level L2 --test src/features/videoEdit/engine/videoEditAuthorCanvasBounds.test.ts --test src/features/videoEdit/engine/videoEditAuthorCanvasRecorder.test.ts --test src/features/videoEdit/engine/videoEditAuthorRuntime.test.ts --test src/features/videoEdit/authorLibraries/shapedText.test.ts src/features/videoEdit/engine/videoEditTextOutlines.ts src/features/videoEdit/authorLibraries/shapedText.ts src/features/videoEdit/engine/videoEditAuthorCanvasRecorder.ts src/features/videoEdit/engine/videoEditAuthorCanvasBounds.ts src/features/videoEdit/engine/videoEditAuthorCanvasBounds.test.ts scripts/text-layout-worker-experiment.ts scripts/prepare-text-layout-acceptance.ts scripts/text-layout-outline-experiment.ts
```

最后一条为停止后去掉已撤销探针的准确复现清单；本轮实际失败命令额外包含当时的 `scripts/text-layout-worker-probe.mjs`。移除未运行分支后只检查 `git diff --check`，没有声称 L2 已复跑。继续工作需要先处理这 8 项字体准备失败，再恢复实验 7–8和后续冻结/合并/全部门禁。

## 2026-11-01 最终完成：L2 修复、实验 7–8、冻结 2.0.0 与吸收 main

本节是本票最终状态，取代前文的停止点；保留历史失败和测量记录供追溯。按本轮授权自行修复测试、门禁与合并冲突，没有降低已定门槛或更换依赖。实验 1–5 沿用 review.md 的通过裁定，实验 6 沿用上一节已完成实测，本轮没有伪称重新执行 1–6。

### 提交与交付

- `6ae9c141f`：修复文字外观边界，并给作者运行时测试补齐正式字体准备屏障。测试使用 TextFontSession 与 AuthorTextResources 的 prepare/bind/close，模块常量初始化也绑定已准备会话；没有绕过运行时字体要求。旧位图行为测试明确引用冻结 1.2.0。
- `17e48a365`：完成实验 7–8、修正彩色字形识别，冻结 henji-layout 2.0.0，新建默认作者 API 8，并更新五份技能参考，只说明新能力怎么用。
- `9457e73d0`：合并 main `b2d1d5ce1`（包含 11、13、20），处理冲突及字体缓存原子发布问题。双亲为 `17e48a365`、`b2d1d5ce1`。
- 最终分支 `task/10-文字排版`，代码工作区干净；没有 push、切分支、合并到 main 或在主工作区提交。仅按授权追加本 result.md。未动 9334、D:/视频制作、node_modules 与 FFmpeg 联接点，未执行 npm install/ci/uninstall，未改界面。

### 实验 7：正式 Worker 字体回退与身份

源码版、冻结版以及合并后冻结版均通过。最终证据为 `.tmp/text-layout-acceptance/fallback-postmerge-report.json`：11 个场景覆盖假名、扩展汉字 U+20000/U+20001、ZWJ 女程序员、VS 爱心、旗帜、组合附加符、缺字、同名字体字节替换及可变字重 100/900。正式 authorMetadata/authorFrame 链路记录实际选脸、字节 hash、字体链与 cluster；各场景 seek `[0,7,1,9,0]` 像素一致且非空，ZWJ/VS 有彩色像素。六个正常非替换场景通过 CDP 读取实际 DOM 字体，核对 6/6 通过。

Segoe UI Emoji 的 COLRv0 基底存在 outline，单凭“有 outline”会误走黑色轮廓。共享 HarfBuzz 适配层识别 PNG、COLRv1 paint、COLRv0 layers；emoji 簇在无轮廓或彩色情形使用系统 Canvas，仍保持 HB 几何。回归覆盖“有轮廓但为彩色字形”，不以 glyph ID 存在替代实际绘制支持。

同名字体字节变化改变 hash；可变轴变化保持字体字节 hash，但改变字体链及正式 fingerprintAuthorFrame 指纹。四种身份指纹互异。缺字有诊断，字素不拆。排查覆盖选脸、HB 成形、彩色路由、模块字体准备、Worker、帧指纹和直接导出消费者；没有执行本轮全流程编码成片验收。

实际字体格式样本来自固定上游提交，下载物仅留在 .tmp，没有改变应用依赖：

- HarfBuzz `0ba555a3d4f00a5d2909b0cf8720e04b8fe83ff0`：MORXTwentyeight.ttf 的 morx 212 bytes，期望 advances `[1394,529,510,510,510]`，实测 `[638,529,556,510,674,510,510]`；kerx 样本 9f0def61bfa49ffb44ba45c8703eee567c5bb816.ttf 的 kerx 86 bytes，期望 `[560,560]`，实测 `[600,600]`。当前 tiny 构建不支持这两个样本要求的 AAT 行为，明确保留此边界。
- googlefonts/color-fonts `0046ea4c3b69e9fbbe464c2594816894e3aa5e4b` 的 twemoji_smiley-sbix.ttf：sbix 21,596 bytes，advance 1275，有 85 bytes outline，但走系统彩色 Canvas。
- googlefonts/noto-emoji `99701e07d3d1fe1bdbcdb14964547f0fd592966f` 的 2D/fonts/NotoColorEmoji.ttf：CBDT 10,636,164 bytes、CBLC 16,132 bytes，advance 2550、无 outline，走系统彩色 Canvas。两个位图样本均得到非空彩色画面（墨迹 4,172）。

验证平台是 Windows；macOS 未验。系统 emoji 的颜色、基线、墨迹和抗锯齿依平台，不保证复现自定义彩色字体原始像素。

### 实验 8：表格数字、列宽与 DOM 对照

最终 `.tmp/text-layout-acceptance/table-postmerge-report.json` 通过。Calibri 数字 0–9 advance 均为 1038/2048；Gabriola 无 tnum，数字 advances 为 `[1632,937,1345,1353,1622,1398,1642,1562,1559,1629]/4096`，发出明确诊断。正负、小数、百分比、空格千分符均记录量度；没有错误要求符号也与数字同宽。

| 场景 | 最终列宽 | 非零内容宽单元格最大 DOM 字位差 px | 溢出 |
|---|---|---:|---|
| auto，500 | 283.6689453125 / 212.3310546875 | 0.0234375 | 否 |
| narrow，120 | 164.05078125 / 139.734375 | 0.0188751220703125 | 是 |
| fixed，360 | 80 / 276 | 0.015289306640625 | 否 |
| fixed-zero，100 | 0 / 139.734375 | 不纳入零宽字位门槛 | 是 |

列框不重叠，同位数 111/999 保持稳定。真实黑字白底、红色列框截图已检查。零宽列只验证列框与溢出语义；其全部字位若强行对照 CSS，最大差为 14.927083969116211 px，不能将其归入上述 0.02344 px 结论。DOM 按同一最终列宽逐格核对，不宣称完整 CSS auto-table 列宽分配算法一致。

合并后重新生成正式 Worker 与冻结库实验入口，15 张回退截图、4 张表格截图与合并前冻结版逐字节相同（19/19）；不是仅复用旧报告。

### 冻结、技能与合并兼容

2.0.0 冻结目录包含独立 HarfBuzz index/mjs/wasm、Pretext/HarfBuzz 来源与许可、patch、声明及 text/flex/table 产物。冻结脚本按二进制保存 wasm，通过相对 external 避免第二个 wasm 实例；上游可选 EmscriptenModule 仅以临时 ambient 辅助声明构建，不改依赖、不泄漏内部类型。冻结提交后文件未再变化，提交后默认持久保护检查通过。

新建默认 `CODE_AUTHOR_DEFAULT_API_VERSION=CODE_AUTHOR_API_VERSION`，即 API 8。技能参考 author-api、author-text-motion、code-project、recipes-text-data、recipes-text 说明静态 textFonts/faces/bindings、统一几何与 table 使用，删除过时图集/逐字丢失连写描述；5 技能 25 共享文件同步通过。

合并保留 main 的效果环境、精度和导出路径，同时保留本票字体会话/API 8。冲突格式按 main 历史顺延：document.video_edit 49、document.screen_recording 52、video-style-library 8、video-style-package 11；template-library 7、code-version 9、code-asset 14、作者 API 8。main 历史黄金样本和兼容登记保持原字节，四份新版本样本由生成器重建。未标版本历史预览效果固定为合并前的 effects 1.2.0、layout 1.2.0/API 7；显式历史 effects 1.0.0 引用仍保留。

### 失败修复、同源排查与独立审查

- 初始 8 项“宿主未准备字体”失败通过正式准备屏障修复；合并后升级夹具显式按 API 6 创建，显式升级 API 8 按合法最新兼容库断言，未把合法 layout 2.0.0 升级锁死为 1.2.0。
- Windows 字体缓存 rename 实际发生 EPERM：scanner 采用已有 writeBufferAtomically，只有成功发布后才更新内存缓存；字体监听忽略该原子写入产生的 `.catalog-cache.json.<uuid>.tmp`，避免临时文件引发自激扫描。覆盖 scanner、原子文件与 watcher，共 15 项专项测试通过。正式 fonts/worker.ts 独立构建并实际启动，连续两次扫描均 1,756 字体脸、跳过 5 候选，实际读取字体 17,396,628 bytes，确认共享日志依赖可在 Worker 装载；这不是完整 Electron 发行构建。
- 高负载下 Worker 首次 import 钩子超时以降低测试并发处理，没有增加超时、删除断言或改变性能门槛；类型检查分配 8GB heap。最终 L2 明确传入 176 个现存改动文件；已删除旧 textGraphemeAtlas.ts 单列记录，由替代实现消费者测试覆盖，未把不存在的路径交给 ESLint。
- 外观边界排查包括生成、录制、回放、纯文字、混合图层、变换/滤镜/裁剪、静止组合和动态层；冻结 1.x 不使用该新内部符号，未发现同源漏计。字体排查覆盖共享发布、监听、Worker 生命周期；历史版本排查覆盖预览样片/模板及显式引用。结论不扩展为全部平台或全部产品功能已经验收。
- 本轮独立干净上下文审查四组共 9 轮（边界 2、发行 2、合并 3、字体缓存 2）。两项重要问题分别为历史 effects 错误固定 1.0、原子临时文件触发 watcher 自激，均修复并回归；测试绑定和技能描述的小问题也已处理。没有未决重要问题。

### 最终门禁与复现

全部在本任务分支串行执行，未运行全量 npm test 或完整 electron:build：

- `verify:changed -- --level L2 <本分支全部现存改动文件...>`：37 测试文件、836 项通过；改动文件 ESLint、renderer/electron 类型检查、依赖图、main imports、IPC 和持久基线通过。日志 `.tmp/t10-final-l2.log`，显式文件清单 `.tmp/t10-final-files.txt`，删除清单 `.tmp/t10-final-removed-files.txt`。
- `check:persistence-compat`：66 格式通过；提交后不设置保护 ref 覆盖，再按默认保护运行仍通过，日志 `.tmp/t10-postcommit-persistence.log`。
- `check:assistant-capabilities`：结构、15 项覆盖及 31 文件 237 项不变量通过，日志 `.tmp/t10-final-capabilities.log`。
- `check:skill-sync`：5 技能 25 文件通过，日志 `.tmp/t10-final-skills.log`。
- `node scripts/check-text-layout-vendor.cjs --check`：固定字节、许可、patch 反向还原、Pretext 7 模块无 Canvas 可达图通过，日志 `.tmp/t10-final-vendor.log`。
- 相关 GPU：ContentPrecision 10、GpuPrecision 4、PlaybackResolution 5，共 3 文件 19 项通过，日志 `.tmp/t10-final-gpu.log`。
- 实验 7–8 合并后冻结版 gate 均 true、failures 均为空，日志 `.tmp/t10-postmerge-fallback.log`、`.tmp/t10-postmerge-table.log`。未重做或降低已裁定实验 5 的负载配对标准，也不将实验 6 外观压力成本描述为整体性能更快。

```powershell
$env:NODE_OPTIONS='--max-old-space-size=8192'
$env:VITEST_MAX_THREADS='2'
$env:VITEST_MIN_THREADS='1'
$env:VITEST_MAX_FORKS='1'
$env:VITEST_MIN_FORKS='1'
$env:npm_config_script_shell=(Get-Process -Id $PID).Path
$files=@(git diff --name-only --diff-filter=ACMRT b2d1d5ce1 HEAD)
npm run verify:changed -- --level L2 --test src/features/videoEdit/engine/videoEditAuthorRuntime.test.ts --test electron/main/services/fs/atomic-file.test.ts @files
npm run check:persistence-compat
npm run check:assistant-capabilities
npm run check:skill-sync
node scripts/check-text-layout-vendor.cjs --check
npm run test:gpu -- src/features/videoEdit/engine/videoEditGpuPrecision.gpu.test.ts src/features/videoEdit/engine/videoEditContentPrecision.gpu.test.ts src/features/videoEdit/engine/videoEditPlaybackResolution.gpu.test.ts
node scripts/prepare-text-layout-font-formats.ts
node scripts/prepare-text-layout-acceptance.ts --worker --table --frozen
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --phase fallback --out .tmp/text-layout-acceptance/fallback-postmerge-report.json
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/table.html --out .tmp/text-layout-acceptance/table-postmerge-report.json
```

script_shell 仅为当前进程使用 PowerShell，避免显式文件参数超出 cmd.exe 命令长度；没有改变全局 npm 配置。

| 最终证据（相对本任务工作树） | SHA-256 |
|---|---|
| .tmp/text-layout-acceptance/fallback-postmerge-report.json | `6cdcda9c9fb28bff458dd743cbfae7d9aa0968c6758f5a070be8bc0a1bd9388f` |
| .tmp/text-layout-acceptance/table-postmerge-report.json | `2b5db0ed0813bd36aed667e532800ddd61843f3146d88267238b53f7d65d4bbe` |
| resources/video-edit-author/frozen/henji-layout/2.0.0/release.json | `8be76128a960d4cf5691b1d2a89bff9f8f971e59a5fc04667dde21fbfe74f8f5` |
| .tmp/t10-final-l2.log | `862378978220ce0929311b5b013d3ef5eb3273f6bb2a5bafad626644abf6e544` |
| .tmp/t10-final-gpu.log | `fab568f99d4d951102140bf5f844de160a88382e304233ad5f670ffb18641cd3` |

最终结论：本轮要求的修复、实验 7–8、冻结 2.0.0、默认 API 8、技能同步、吸收 main、全部指定门禁与任务分支提交均完成；未验平台、AAT 与完整编码成片边界如上，未 push。

## 综合审查修复（2026-11-01）

按 `review.md` 最后一节裁定处理 `review-combined.md` 全部 13 项及 outputKey/frameKey 两条建议。起点 `b7df3d5ca`；在 `task/10-文字排版` 合入 main `535d9bd7f`（含 19-U12/U13）。未发行 2.0.1，重新冻结尚未进入 main 的 **henji-layout 2.0.0**。

### 逐条处理与精确覆盖

| 条目 | 修复与验证 |
|---|---|
| 1 | 默认准备 400/700 × normal/italic；静态提取 text/table/flex 的字面字体、常量和对象展开，保留入口向 helper 传递的参数元数据。`params.style` 的展开与后置字重覆盖按实际顺序解析。未知组合在同族已准备字体中按 CSS 规则匹配，日志去重并进入 codeMotionReview。真实冻结运行时覆盖零声明 700、斜体、已声明族 700、展开参数再覆盖字重；另测 table 字符串行、样式继承及 helper 入口。 |
| 2 | 历史缺字段快照固定 API 7 + effects 1.3.0/layout 1.2.0；无字段且使用 effects 1.3.0 导出的迁移样本通过。历史完整迁移链保留。 |
| 3 | 平台候选表、通用族映射、同族匹配和 choose 随 `font-session.mjs` 冻结；宿主只交目录和按 ID 读取字节。冻结输入 337 项均为逻辑相对路径且摘要吻合。 |
| 4 | 准备和 choose 都按当前字素固定次序选脸。`2026 ①`、`2026 ①年` 中 ① 的字体哈希与 face 相同；额外补肤色修饰符、VS16 单独出现与混合 emoji 的等价测试。 |
| 5 | 仅需要文字的模块进入文字准备；保留跨模块参数但不把纯 helper 误当文字内容。按字素覆盖懒读候选，按内容哈希共享字节，宿主不长期保留已交付字节。纯 GPU 模块不捕获字体目录。内存配对见下表。 |
| 6 | HarfBuzz 轮廓、Path2D 分别按约 4MiB 软预算 LRU 回收；超预算后能重建同一内容，已交付轮廓仍有效。 |
| 7 | 导出捕获主进程磁盘字体快照，包含尚未读取的字体；后续安装、删除、替换不改变读回字节。henji-layout 1.x 字体集合保留，不在导出中 reset；渲染传输测试确认后续帧完成且始终使用起始目录。关闭丢弃迟到读回；退出等待尚在复制、释放的快照后才停字体线程。 |
| 8 | 新写入缺 apiVersion 的样片/库模板默认 API 8；显式 API 缺库版本取该 API 最新兼容库。助手字段描述公开 apiVersion/libraries；读历史数据和新写入不共用缺字段默认值。 |
| 9 | 可取消字体 preflight 在 RenderTransport 的 render 入队前完成，Worker 用独立准备队列；暂停、更新内容、后到帧取消旧准备，旧画面不会迟到提交。坏滤镜仍走原有可恢复失败路径。 |
| 10 | review 区分 upgradeLibraries 与 upgradeAuthorApi；技能改为新源码 API 8，并明确默认四种字形与显式字体声明语义。 |
| 11 | 冻结输入使用仓库逻辑路径，node_modules 联接不泄露物理工作树路径；没有绝对路径或 `../` 输入。 |
| 12 | 应用许可清单补 Pretext、harfbuzzjs、HarfBuzz 及完整许可文本；严格生成通过。 |
| 13 | 录屏产物创建渲染导出会话时同样传 fixedTextFonts，共用第 7 条快照与释放实现。 |
| 附加建议 | 文字身份显式进入 CodeSources outputKey；AuthorPrograms.frameKey 求值前准备实际参数字体，在同一字体上下文执行。参数字体变化会改变输出/帧键，覆盖共享指纹与渲染路径。 |

### 持久格式与 main 合并

| 格式 | 合入 main 版本 → 本分支版本 |
|---|---|
| document.video_edit | 50 → 51 |
| document.screen_recording | 53 → 54 |
| video-style-library | 8 → 9 |
| video-style-package | 11 → 12 |
| video-template-library | 6 → 7 |
| code-version | 8 → 9 |
| code-asset | 13 → 14 |
| code-author-api | 7 → 8 |

每种仅推进一次，保持 main 的音频效果/转场迁移，再追加作者版本迁移。使用正式 `generatePersistenceFixtures` 按格式生成 8 种新样本；`persistence:baseline`、`persistence:release-snapshot` 以合入的 main 为基准重新生成。main 的 **252 份历史黄金样本 Git 对象摘要全部未变**。音频迁移测试继续逐字段检查音频结果，允许后续迁移增加作者元数据；完整最终结构由黄金样本校验。

### 内存前后（同一负载）

独立 Node `--expose-gc` 进程，比较 b7df3d5ca 原字体会话与最终冻结字体会话。两侧使用相同 SFNT、相同默认四种字形和 `2026 ①年 标题排版 あいう 😀`；执行完成后 GC，测读侧持有字节、候选链实际共享 ArrayBuffer 与进程 RSS 增量。基线模拟原宿主长期字节缓存，修复侧按实际转交方式不保留。

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| 读侧长期保留 | 106,547,908 B | 0 B |
| 字体会话独立字节 | 426,191,632 B | 28,789,868 B |
| 两侧合计常驻字体字节 | 508.06 MiB | 27.46 MiB |
| 进程 RSS 增量 | 523.43 MiB | 82.31 MiB |

这是固定负载的配对测量，不代表整个应用、所有字体或峰值内存；RSS 还包含 WASM 与分配器。轮廓软预算另由驱逐后重建测试验证。原始 JSON 保存在 `.tmp/t10-review-memory-before.json`、`after.json`。

### 重冻后实验 1–3 与真实作者链路

Windows，Electron 44.9.3 / Chromium 152.0.7977.167；正式作者/Worker 模块专项构建，独立隐藏 Electron、临时 profile、随机端口，不连接 9334。

| 对照 | 最终结果 |
|---|---|
| 实验 1/2：200 例断点 | 196/200；同批上游 Pretext 197/200 |
| 实验 2：几何 | 193/200；非 emoji 且非接受项全部满足 ≤1/32px |
| 实验 2：600 临界宽度 | 588/600 断点一致；非接受项的断点/几何门禁均通过 |
| 实验 3：3 字体 × 7 标点场景 × 1x/4x | 42 组；位置/宽度最大误差 0.01041794px；逐字落定与整块绘制差异通道数全部 0 |
| 实验 3：自动间距 | 中文AI中文 160→168、中文2026中文 192→200，与 DOM 相同；已有空格的 192 保持不变 |
| 真实作者链路 | 假名、扩展汉字、emoji ZWJ/VS/旗帜、组合符、预期缺字、同名字重、可变轴共 11 场景，门禁 passed，无非预期缺字 |

断点差异仅 P022/P027/U004/U007；接受集合仍为裁定的 P022/P027/U003/U004/U007/U008/U018，没有增删接受项或放宽门槛。复测中发现 U017 的 `a🏿` 漏预热 emoji 字体，已修正 Emoji_Presentation/VS16 检测并补测试；最终恢复旧结果 **0.00325775px**，与此前已通过的 `verified-second-ruling-report.json` 比较，无新增断点或几何回退。实验 3 叠图已抽查 4x 括号和日文引号，位置一致，边缘差异属于栅格抗锯齿。

实验 4–8 沿用前次已通过的独立证据；本轮因字体选脸变动额外复跑真实 Worker 回退/格式/字重/轴链路，不把此次结果写成重新测过全部性能矩阵。macOS 实机未在本轮验证。

### 验证与审查

- `verify:changed -- --level L2`：本次显式 93 文件完整通过（28 文件 **608 测试**、ESLint、渲染层与 Electron 两套 tsc、依赖图、main imports、IPC 对账、持久基线）；随后仅补强两个现有测试文件的断言，对该增量再次运行 L2，**16 测试**及所选静态检查通过。两次合计覆盖本次 95 文件，未扫描整片脏工作区。
- 真实 GPU：ContentPrecision / GpuPrecision / PlaybackResolution，**3 文件 21 测试通过**；真实作者链路另见上节。
- `check:assistant-capabilities`：结构检查、**15 项覆盖 + 31 文件 238 项不变量通过**；`check:skill-sync`：**5 技能、25 文件通过**。
- `node scripts/check-text-layout-vendor.cjs --check`：固定字节、许可、反向补丁与 **7 模块零 Canvas 可达图通过**；`validateFrozenAuthorHistory` 以合入的 main `535d9bd7f` 为基准通过，已发布冻结目录未修改。
- `check:persistence-compat`：**66 格式通过**；正式基线/发布承诺已再生成；`git diff --check` 通过。
- `gen:licenses -- --strict`：完整生成 **1,240 组件、634 许可文本**，最终同输入复查通过；脚本仍记录原有 jsonify@0.0.1 缺许可全文，不是本次新增依赖。
- 精确验证完整日志：`.tmp/t10-review-l2-final.log`、`t10-review-test-contracts-final.log`、`t10-review-gpu-final.log`、`t10-review-capabilities-final.log`、`t10-review-skills-final.log`、`t10-review-vendor-final.log`、`t10-review-persistence-final.log`、`t10-review-licenses-strict.log`。历史兼容复现时设 `HENJI_PERSISTENCE_RELEASE_REF=535d9bd7f`，避免将任务分支尚未发布的旧冻结版本误作 main 发布基准。

三轮独立审查共发现 5 项重要问题：暂停后的迟到帧、坏滤镜预热中断、样式字符串误作正文/常量漏提取、table 字符串漏提取、helper 入口参数丢失，均已修复并经针对性测试；两项快照释放/复制与退出竞态也已修复。第三轮后的自审补查了 U017 选脸回退并修复；没有未处理的重要审查项。实际同源排查覆盖文字/table/flex 静态提取、模块入口与依赖、预览/导出/录屏、frameKey/outputKey、暂停与内容更新，以及旧样片/库模板的新写入与历史读取；未扩展成全项目审计。

node_modules、FFmpeg 保持原联接点；没有安装/卸载依赖、改 UI 或接触 D:/视频制作。许可证严格生成所需录音构建已核对源码一致后，从主工作树现有产物只读复制到本工作树 ignored target；没有修改依赖或主工作树构建。最终门禁串行执行。主工作树只追加本 result；只在 task/10-文字排版 提交，不合并到 main、不切分支、不 push。

原始证据不提交字体、截图、日志或临时构建：

| 文件 | SHA-256 |
|---|---|
| `.tmp/text-layout-acceptance/review-123-report.json` | `48a639675214df8241b21e928224db0114e53fcd8b9ce847e24183df282760de` |
| `.tmp/text-layout-acceptance/review-author-chain.json` | `7bff85bde191f01f9fac462fa379707b802e4789820d614bf7168dd78edbf0a7` |
| `.tmp/t10-review-memory-before.json` | `9aba23d01965266f91315f95f13b36998723ea00f20ee98ef62795cb161e59df` |
| `.tmp/t10-review-memory-after.json` | `2817be45c35937347b1a93ab9ec3ad354e86cc45643fb2af0cca08e08b86ca60` |


## 第二轮审查修复（2026-11-01）

**状态：未完成，不能合入 main。** A/B、D、F–K 的修复与验证已落实；C 的预检与双帧行为已修复，但扩展性能门禁仍有一项失败；最终合入 main 时发现历史样片迁移的重要兼容问题，待裁定后才能完成最终提交。没有放宽门槛或把失败记录成通过。

### 提交与合并状态

- 起点 `1d2655170`，始终在 `task/10-文字排版`。
- 已追加提交 `b45442a2e30a9d892a5c3a4b6946ef541eabb666`：修复字体快照与动态文字预检，包含第一次合入 main `c9ec3f324`。
- 验证期间 main 又合入 19-U9 调整层，随后执行 `git merge --no-commit main`，基准为 `26b5e6e01d8d1faa79cda3a4b3ea095f19c47072`。内容冲突已处理，Git 没有未解决冲突；因下述重要问题，**此次 merge 尚未提交**，其改动与新样本保留在本工作区。
- 当前整合版本：作者接口 **10**、剪辑 **53**、录制 **56**、代码版本 **11**、代码资产 **16**、风格库 **9**、模板库 **7**、风格包 **12**。各格式相对本次合入 main 只升一次。
- 正式脚本已生成 8 种格式的新样本、基线和发布承诺；main 的 **262 份历史黄金样本逐字节未变**。所有兼容/冻结历史检查固定使用上述 main 提交作基准，避免浮动 main 在检查中途前进。
- 没有 push、切换分支、合并到 main、安装/卸载依赖或改 UI。两处随 main 合入的 TSX 文件与 main 一致。本任务的 node_modules、FFmpeg 联接点保留；没有接触端口 9334、用户浏览器/账号、外部聊天服务或 D:/视频制作。主工作区仅追加本 result。

### A–K 处理

| 条目 | 本轮实现与证据 |
|---|---|
| A | 删除整目录复制、临时快照目录及释放 IPC；开始导出只固定路径/大小/修改时间清单。字体从原位置按需读取，已读字节由导出会话保留。首次读取前变化/删除、读取中变化明确失败；固定清单的未读字体和重复读取均有测试。上一轮内存表不能作为此版本的内存测量：本轮按裁定保留会话已读字节。 |
| B | 静态声明与参数实际字符串共同准备；slice、模板、数组/JSON、嵌套动态 flex 树读取参数字符，确实无法确定的动态来源准备完整默认候选。候选次序仍由冻结库决定。真实 Worker 的 ★、✓、①、韩文、扩展汉字四场景全部通过。 |
| C | 编译元数据推导需求，仅 API 10 且实际使用 layout 2 文字时预检；按文字/字体身份与目录修订去重，不重新执行作者模块。先初始化字体目录再预检；较早帧共享准备不被后帧取消，提交保持双帧顺序。行为测试通过；性能结果见下，仍有一项未达标。 |
| D | 字体服务释放纳入 bindApplicationShutdown；不再有独立快照退出监听。 |
| E | 保留固定库快照 layout 1.2.0 / effects 1.3.0，没有加入“必须等于最新库”门禁。历史 API 7 遇到新 main API 9 样片的冲突单独列为待裁定项。 |
| F | 固定快照与普通字体准备共用 resolveFont，匹配逻辑一份。 |
| G | 为本次格式迁移补齐 N → N+1 注释，顺延号与主分支迁移并存。 |
| H | 音频迁移恢复严格结构比较；允许的作者版本元数据通过显式预期构造，不使用宽泛 toMatchObject 吞掉其他差异。 |
| I | 动态且未准备的字体族按模块自身已准备默认字体回退；记录一次诊断，不借用其他模块的准备状态，不逐帧抛错。 |
| J | GPU/作者验证使用带 libraries 的真实 bundle；合并调整层时同步保留 API 参数和字体上下文。 |
| K | Pretext 指向实际 chunk-O4UYAFHA.mjs；冻结器按目标库版本更新对应登记，不误命中别的版本。 |

henji-layout **2.0.0 已重冻**：344 项输入与当前文件摘要一致，21 个产物完整校验；最后一次仅刷新迁移注释的输入摘要，运行产物字节不变。已发布冻结目录相对合入 main 未修改。

### C：配对性能与未达标项

基线源码固定 `1d2655170`；修复侧为本次合并后的实际 Transport、Worker、作者运行时与 GPU。只替换编译/I/O 边界，两侧共用相同字体。Windows，Electron 44.9.3 / Chromium 152.0.7977.167，1920×1080、200 字逐字位姿；独立隐藏 Electron、隔离 profile、随机端口。本任务内重任务串行执行，未控制机器上其他任务。

最终扩展实验对同一百帧轨迹执行四轮交替，每个模式 **400 对已完成帧**，不删除尾部样本。新文字在基线标为 API 8、修复侧按合并编号标为 API 10。单位 ms，数值为 P50 / P95：

| 工程与模式 | 修复前 | 修复后 | P95 差值 |
|---|---:|---:|---:|
| API 7 播放 | 20.0 / 24.8 | 19.9 / 24.9 | +0.1 |
| API 7 往返拖动 | 19.9 / 24.7 | 19.6 / 25.8 | **+1.1，失败** |
| 新文字播放 | 9.4 / 12.9 | 9.1 / 12.5 | -0.4 |
| 新文字往返拖动 | 9.1 / 12.9 | 9.0 / 12.5 | -0.4 |

非文字参数编辑也测量：旧工程 P95 26.6→24.6，新文字 15.1→12.5。预检消息：旧 API 从 1,252 次降到 **0**，新文字从 1,252 次降到 **1**；作者源码装载从约 402 次降到 **1**。另测每种引擎 20 个双帧在途批次：基线每批取消一帧（合计 20），修复侧 **0 帧取消**。批次完成的帧数不同，因此原始批次耗时单独保留，不用它冒充相同工作量的性能对比。

保留全部测量：合并后首次 100 对帧中旧拖动 +3.1ms、新播放 +1.3ms 失败；追加阶段记录的 100 对诊断通过；400 对扩展实验仍有上述 +1.1ms 失败。**不能挑选通过的一轮宣称 C 已验收。** 400 对旧拖动的 authorRaster P95 两侧均约 4.6ms、presentComplete 均约 17.7ms、codeReady 为 7.5→7.6ms，尚未定位出可据此修复的确定热点；不得用调参、删除样本或放宽 +1ms 掩盖失败。后续仍需定位并获得原门槛下的有效证据。

### 自动验证与实际边界

- `npm run verify:changed -- --level L2 <本次95文件>` 完整通过：**35 文件 766 测试**、ESLint、渲染层与 Electron 两套 tsc、依赖图、主进程导入、IPC 对账、持久基线。显式范围保存在 `.tmp/t10-r2-files.json`，日志 `.tmp/t10-r2-l2-complete.log`。随后只扩展专项性能脚本的样本轮数，脚本经 esbuild 构建并实际运行。
- 两套 tsc 另有独立通过记录：`.tmp/t10-r2-renderer-tsc-final.log`、`t10-r2-electron-tsc-final.log`。
- 真实 GPU：ContentPrecision / GpuPrecision / PlaybackResolution，**3 文件 26 测试通过**，含 main 调整层像素路径；日志 `.tmp/t10-r2-gpu-final.log`。
- 真实作者链路：**11 场景、4 种格式**，同名字体/字重/可变轴与回退门禁通过；动态参数/未知来源 **4 场景通过**，已目视数组 JSON 截图，无方框。macOS 实机未验；没有把 Worker 专项冒充用户工程 GUI 验收。
- `check:assistant-capabilities`：15 项覆盖 + **31 文件 238 项不变量通过**；`check:skill-sync`：**5 技能、25 文件通过**。
- `node scripts/check-text-layout-vendor.cjs --check`：固定字节、许可、反向补丁、Pretext **7 模块无 Canvas 可达图通过**；冻结历史以本次合入 main 为基准通过。
- `gen:licenses -- --strict`：**1,240 组件、634 份许可文本通过**；原有 jsonify@0.0.1 缺许可全文提示仍在，不是新增依赖。
- `check:persistence-compat`：**66 格式通过**。样本结构/摘要门禁通过不代表下述历史样片执行语义已正确。
- 源码 `git diff --check` 通过；冻结产物中的上游许可注释保持生成器原字节，不手改冻结输出以迎合空白检查。

其余日志：`.tmp/t10-r2-{capabilities,skills,persistence,vendor,frozen-history,licenses}-final.log`。同源排查覆盖字体快照首次/重复/迟到读取、预览/导出/录屏、文字/table/flex 与辅助模块、frameKey/outputKey、暂停/内容更新/字体重置和双帧队列；未扩展为全项目审计。API 9 历史调整层样片是实际发现但尚未修复的兼容缺陷。

### 独立审查与需 Claude 裁定/复核

本轮进行了两次独立只读预审：首次发现冻结许可目标匹配小问题及原有动态 flex 树同源缺口，均已修复；合并增量复审发现 **1 项重要问题，尚未处理**：

- `src/core/documents/kinds/videoEdit.ts:146` 与 `src/core/documents/kinds/screenRecording.ts:17` 复用 `styles/authorVersionMigration.ts:6`，把缺版本样片固定为 API 7。
- 本次 main 的剪辑 v52 / 录制 v55 黄金样本已包含只有 adjust 的 golden-adjust 图层；main 预览按当时默认 **API 9** 编译。迁移后 API 7 忽略 adjust，运行时会报“缺少 draw(ctx,t)”。当前新 v53/v56 样本也呈现 API 7 与调整层源码并存。现有结构比较测试不能证明这类样片仍可执行。
- 已向用户提出具体方案：把缺版本历史预览接口固定为本次合入基准 **API 9**，同时保留 E 的 layout 1.2.0 / effects 1.3.0 固定库快照，补迁移后真实调整层执行测试并重新生成样本/承诺。**尚未获答复，未擅自修改历史迁移语义。**
- 按本次“重要问题仍存在就停下重新考虑方案”和“改变设计方向才停下”的要求，最终 merge 不提交。需 Claude 裁定上述历史接口方案；C 的 400 对性能失败与阶段数据也列入复核，不能视作已达标或授权降低门槛。

没有调用 Claude 或任何外部聊天服务。待裁定后还需修复重要问题、完成 C 的原门槛验收、重跑受影响验证并提交最终 merge。工作区因此有意保留未提交整合结果，不声称干净或全部完成。

## 阻塞修复（2026-11-01，接手 Codex）

**状态：两项阻塞已按 review.md「第二轮修复后的两项阻塞裁定」修复，合入 main 完成，可交合并审查。** 由 Claude 接手中断的 Codex 任务：上一位留下的半截合并（MERGE_HEAD 26b5e6e01）与 103 个未提交文件逐个核对后保留，补完后提交；思路有偏差的地方（文字接口号写成字面量、预检排队判断、textFonts 被脚本直读）已改正。

### 提交（task/10-文字排版，未 push）

| 提交 | 内容 |
|---|---|
| `6e23409c0` | 合入 main 26b5e6e01（19-U0/U9）；文字新版作者接口顺延为 **10**；历史快照改为作者接口 **9**；文字门槛统一用 `CODE_AUTHOR_SHAPED_TEXT_MIN_API_VERSION`；技能文档接口号同步 |
| `4aea54b1c` | 旧接口逐帧零开销（阻塞 2） |
| `7d2b9def5` | 模板摘要判等补 API 9 用例（审查第 1 轮） |
| `f5b287556` | 合入 main d3f0cda99（U1/U2/U4/U14），持久格式按 main 下一号顺延 |
| `2c3022516`、`63b13bc5c` | 新旧文字接口切换中途的过期帧跳过（审查第 2、3 轮） |
| `ebd46afea`、`a6ef9c98b` | 合入 main 6791bee54（U3）、ea972d1ec（U5）；最后一步为 merge main |
| `71358ecc7` | 验收脚本经 esbuild 读取 textFonts（直读无法解析无扩展名导入） |

最终版本相对 main ea972d1ec 各升一次：剪辑 **54**、录制 **57**、风格库 **10**、风格包 **13**、本机效果库 **7**、预设包 **14**、代码版本 **11**、代码资产 **16**、作者接口 **10**、模板库 **7**。U14 让效果库与预设包携带代码快照，快照内的代码版本接受作者接口 10 后结构变化，所以这两种也随之升版并提高最低可读版本；迁移原样保留旧快照的接口与库。样本由正式生成器写出，基线与发布承诺从 main 重新登记/追加；main 的 **268** 份历史样本逐字节不变，发布承诺只增不改。henji-layout 2.0.0（未进 main）每次合并后按新输入重冻：U14 合并那次只有压缩标识符与分块名变化（chunk-KEGFWR6E，许可登记随之更新），U3/U5 两次运行产物字节不变。

### 阻塞 1：main 的 API 9 调整层样片

- 根因：`HISTORICAL_PREVIEW_AUTHOR` 的含义是“10 合并前 main 上没记版本的样片按什么编译”，原值作者接口 7，迁移后调整层被忽略、报缺少 draw。改为 **作者接口 9**，库保持合并时 main 的最新版 henji-layout 1.2.0 / henji-effects 1.3.0 / three 0.186.1 / opentype.js 2.0.0；之后合入的 U1–U5、U14 都未改作者接口、未新增库版本，已逐次核对。按 E 的裁定未加“等于最新库”门禁。
- 测试：`videoEditContentPrecision.gpu.test.ts` 用 main 的剪辑 v52、录制 v55 黄金样本（只含 adjust 的 golden-adjust 图层）迁移后真实打包、加载、渲染，断言观察到 vignette 调整层，并与按 API 9 编译的结果**逐像素一致**、有非零像素；把快照改回 7 时两例失败。

### 阻塞 2：旧 API 零开销

- 根因：文字预检与文字身份按每帧、每个代码片段求值；旧接口工程虽不发请求，仍逐帧遍历片段、建提交链，Worker 输出键还进作者运行时取文字身份，渲染、frameKey 与指纹各多等一轮已完成的 Promise。
- 修复：内容更新时判定一次工程是否引用 API ≥ 10 代码（缺失版本引用不报错，留给正式渲染）；不引用时 present 不进预检、不建提交链。Worker 按编译产物同步判断模块是否持有文字资源，旧接口不取文字身份、不等待，输出键与 main 完全相同。入口定一次是否预检，等待期间内容在新旧接口间切换则按过期帧跳过（VideoEditPreview 收到 skipped 会重新请求），一直用旧接口的工程判断不会翻转。
- 测试：API 7/8/9 播放、拖动、参数更新不调用预检、不编译元数据、不发 prepareText，切到 API 10 后才准备、切回后停止；旧接口输出键不向运行时取文字身份，新接口字体身份变化仍重画。

**配对 A/B + A/A**（最终代码 `63b13bc5c`；U5 合并只改图层效果时钟，不在被测路径上）。Windows，Electron 44.9.3 / Chromium 152.0.7977.167，1920×1080、200 字逐字位姿，隐藏 Electron、隔离 profile、随机端口（未用 9334）。四会话逐帧轮换：修复后 B、修复前 A（`1d2655170`）、同源码 A′、A″；四轮×100 帧，每模式每会话 **400 个完成帧**、不删尾部。噪声 = 三个同源码会话两两 P95 差绝对值的最大值（同样本量）；判定：B−A ≤ 噪声且 ≤ +1 ms。单位 ms，P50/P95：

| 工程 | 模式 | 修复前 A | 修复后 B | P95 差 | A/A 噪声 | 判定 |
|---|---|---:|---:|---:|---:|---|
| API 7 旧工程 | 播放 | 19.6 / 22.6 | 19.5 / 22.6 | 0.0 | 0.7 | 通过 |
| API 7 旧工程 | 来回拖动 | 19.4 / 23.0 | 19.5 / 22.4 | −0.6 | 0.4 | 通过 |
| API 7 旧工程 | 参数编辑 | 21.5 / 25.1 | 19.5 / 22.7 | −2.4 | 1.4 | 通过 |
| API 10 文字工程 | 播放 | 8.6 / 12.0 | 8.4 / 11.6 | −0.4 | 0.9 | 通过 |
| API 10 文字工程 | 来回拖动 | 8.4 / 11.5 | 8.1 / 11.5 | 0.0 | 0.3 | 通过 |
| API 10 文字工程 | 参数编辑 | 10.7 / 14.4 | 8.5 / 11.9 | −2.5 | 1.0 | 通过 |

prepareText 请求：旧工程修复前 1,252 次 → **0**；文字工程 1,252 → **1**。修复前文字工程按 API 8 标记（修复前的接口号）。双帧在途 20 批：修复前每批取消一帧（合计 20），修复后 0 帧取消，因两侧完成帧数不同，批次耗时（修复后约为两帧之和）不作性能对比。前一次在 `f5b287556` 上的同设计实验同样通过（旧工程拖动 −0.6、播放 −0.7，均在噪声内）。原始数据：`.tmp/text-layout-preflight/fix3-paired-final.json`、`fix3-paired.json`（工作树 D:/VibeCode/Henji-AI-t10）。

### 验证（均在本任务工作树，串行经排队脚本）

- `npm run verify:changed -- --level L2`（本轮 80 个文件，`--test` 补 10 个直接消费者）：**34 文件 799 测试**、ESLint、渲染层与 Electron 两套 tsc、登记格式与样本基线全部通过（`ebd46afea`；tsc 需 `--max-old-space-size=8192`，默认堆 4 GB 会 OOM）。之后的 `63b13bc5c`、U5 合并另跑两套 tsc 与 12 文件 508 项相关测试通过。
- 真实 GPU：GpuPrecision / ContentPrecision / PlaybackResolution **3 文件 31 测试通过**（含两例调整层迁移）。
- 真实作者链路（冻结 2.0.0）：fallback 阶段 **11 场景、4 种格式**、DOM 字体对照 6 项通过；动态参数 4 场景通过，★ ✓ ① 한 𠀀 经 slice / 模板 / JSON 数组 / 未知来源均无方框（已目视叠黑底截图）。
- `node scripts/check-text-layout-vendor.cjs --check` 通过（7 模块）；`check:persistence-compat` **66 种格式**通过，冻结历史以 main 为基准（`HENJI_PERSISTENCE_RELEASE_REF=main`）；`gen:licenses -- --strict` **1,240 组件、634 份许可**（jsonify@0.0.1 缺全文为原有提示）；`check:assistant-capabilities` 覆盖检查 + **31 文件 238 项**；`check:skill-sync` **5 技能、25 文件**。
- 同源排查范围：作者接口字面量（textFonts、打包、候选、模块图、模板摘要、文字资源）已全部改用常量；逐帧路径（present、预检、输出键、作者运行时 render、frameKey、指纹）已逐一去掉旧接口的等待与求值；U14 新增的代码快照位置（风格件、效果库、预设包）都显式记录 apiVersion，不会随默认接口 10 换解释版本。macOS 实机未验。

### 独立审查（3 轮，均为新上下文只读子代理）

- 第 1 轮（high）：无重要问题。小问题 3：预检排队在内容切换瞬间可能乱序 → 已修；模板摘要门槛缺 API 9 用例 → 已补（门槛退回 9 时该例失败）；历史快照为手抄常量、无门禁 → 按 E 不加门禁，每次合并人工核对（本次已核对至 ea972d1ec）。
- 第 2 轮（high）：无重要问题。小问题 2：入口定预检后文档在等待中切换会漏预检 → 已修（过期帧跳过）；从文字工程切到旧工程后第一帧要等仍在准备的旧预检帧 → 不修，只发生在切换瞬间且旧帧随后即被跳过，去掉等待要在排队里携带内容代次，复杂度不值得。
- 第 3 轮（medium）：无重要问题。小问题 1：过期判断未覆盖预检与排队等待之后 → 已修（并入提交前的代次判断）。审查确认导出、渲染缓存、多机位、跟踪取帧、候选预览、代码探测、源画面等 present 调用方均先更新内容再出画，不会收到新增的 skipped。

### 原有问题与待 Claude 复核（未在本次修改）

1. main 原有失败：`documentValidation.test.ts`（v47 原样解析遇旧轨道效果）、`scene/sceneDeclaration.test.ts`、`audio/effects/mergedEffectsMigration.test.ts`（预设包迁移结果多出 minReaderVersion）在 main 57244bb1a 上同样失败。
2. main U14 的代码快照没有进入任何黄金样本：效果库、风格库、风格包、预设包、剪辑的样本取自 audio-effect-merge 升级结果，生成器里带快照的 goldenPiece 未被使用（本分支新增的效果库 v7、预设包 v14 样本同样不含快照）。建议 main 侧补样本。
3. `previewAuthorIdentity` 把未导入的库也按“该接口最新版”计入风格样片摘要，以后发行兼容的新库版本会让已保存的 API 10 样片被误判需要重渲（本分支早先引入，不是本次）。建议摘要只纳入实际导入的库。
4. 工作树有上一位留下的 stash `t10-r2-fixes-before-main-merge-20261101`，未动。

没有 push、合并到 main、切分支、安装/卸载依赖、改 UI；没有使用用户浏览器、网页账号、外部聊天服务或端口 9334，没有接触 D:/视频制作。node_modules、FFmpeg 联接点保留。主工作区只追加本 result。

## 第三轮审查修复（2026-11-01）

**状态：重要 1、2 与小问题 1、3 已按 review.md「第三轮审查与裁定」处理；main 85e7220fe 已合入。** 小问题 2 按裁定不修。

### 提交（task/10-文字排版，未 push）

| 提交 | 内容 |
|---|---|
| `aef9dbed7` | 文字静态分析改为保守证明（新文件 `codeMaterial/textCoverage.ts`）；准备补齐 JSON、大写与“证明为空”；样片/模板摘要只计入实际导入的库；精确测试与属性测试；A/B 基线改为参数（默认 main） |
| `bdac132ca` | 合入 main 85e7220fe（19-U6 变形效果、三处原有失败测试的修复、模板登记报错修复），无冲突 |
| `114a68801` | 真实作者链路补常量拼接、常量数组模板与纯字面量模块三个场景 |

### 重要 1、2：保守原则

根因：旧实现用两个口径不同的遍历，判断“已知”时跟进模块常量、收集字符时不跟进（重要 1）；同时把宽度、id、表格选项等当成动态文字（重要 2）。重写后：

- **只进文字位置**：按排版库输入结构下行。layoutText 只看文字与富文本 runs[].text；表格只看 rows 的单元格（字符串或 `{text}`）；flex 只看 `text.content` 与 children。样式位置交给原有的字体收集，表格列、选项、尺寸、id 不参与判断。
- **判断与收集同一次求值**：`known(expr)` 一边收字符一边给出覆盖等级。可证明的写法有：字面量；模块常量与局部常量；常量数组下标与解构；模板与拼接；条件；作者参数及其 slice/substring/trim 等子串、map/join、for-of/forEach 元素；数字格式化（算术、Math、toFixed）。数字、undefined、数组逗号等非字符串转成文字时，补一组固定 ASCII 字符。
- **其余一律完整候选集**：函数返回值、未知方法（含 toLowerCase、normalize）、跨模块导入的常量；可能被改写或逃出的对象，例如 `const LINES=[]; LINES.push(...)`、导出的常量数组、传给未知函数的常量；被别名、传递或转导出的排版函数；运行时 `import(变量)`；`eval`。对象可信由只读证明决定：所有引用都只读，经过本地辅助函数形参、内置读方法与回调时继续追踪。作者参数只认宿主入口（draw/layers/frameKey）的 `params`，以及每个调用点都原样传入它的本地函数形参。
- **准备侧同源缺口一并补齐**：
  - 以 `"` 开头的参数 JSON 字符串也按解析后的字符准备；
  - allCaps/smallCaps 与 toUpperCase 让字体按大写形式选择，所以准备时加入大写形式；
  - 表格为数字列排出 0–9，因此一并收集；
  - 合并准备原来把“证明为空”的文字当成未指定，退回完整候选集，与逐资源预检不一致；现在只有 `text === undefined` 才准备完整集。
- **同源排查中修掉的实现缺陷**：下标是标识符（`params[key]`）时被当成静态键 `key`。

精确测试（`textFonts.test.ts` 新增 5 例），逐项对应 review-round3 的写法：
- `params.label+MARK`、`` `${params.label}${ICONS[0]}` ``、`params.items.map(i=>i.name).join(SEP)` 都逐字准备到 ★①✓한𠀀；
- 计算出的列宽、表格选项、flex id/宽度/选项、富文本段落与样式数值都不触发完整集；
- 局部常量、循环、回调下标、解构、辅助函数传参、百分比与 toFixed 可以证明；
- 13 种不可证明的写法与两种转导出都退回完整集；
- 纯字面量模块只准备自己的字符和大写形式。

### 属性测试（执行核对）

`src/features/videoEdit/engine/videoEditTextCoverage.test.ts`，固定种子 `0x7e47`，360 个模块，三类各 120 个：
- **组合范围**：
  - 可证明的写法：字面量、模块常量、常量数组下标、常量数组 join、局部常量、模板字符串（两段插值）、`+` 拼接、条件；
  - 加入参数：参数、参数 slice、参数数组 map/join、`Math.round` 百分比、`String(数字参数)` 拼接、toFixed；
  - 动态写法：函数返回值、运行时 push 的常量数组、运行时改写的常量对象、toLowerCase、内联数组 map；其中前两类返回 `String.fromCodePoint` 生成的源码里没有的字符。
  - 表达式最多嵌套 3 层，放进 5 种语句：layoutText；layoutTable（计算列宽和选项）；循环里的 layoutBoxes（计算 id 和宽度）；常量数组 forEach；参数行 for-of。
- **执行**：用正式的 `readStaticTextFonts` 分析源码，`AuthorTextResources.bind/prepare` 走 `prepareTextFontResources` 与 `TextFontSession`。随后真实调用作者的 draw，排版用正式的 layoutText/layoutTable/layoutBoxes（shapedText 路径）。拦截 `TextFontSession.choose` 记录实际交给字体选择的每个字素，拦截 `prepare` 记录准备集。参数实际值与声明默认值不同。
- **断言**：
  - 准备集不是完整集时，实际排版的每个字符都在准备集里。孤立代理项除外：UTF-16 slice 会切开代理对，它不是 Unicode 字符，任何字体都没有字形。
  - 纯字面量和可证明的写法从不退回完整集。
  - 动态类里至少 1/4 的模块退回完整集，同时也有被证明的组合。
- **本种子结果**：可证明 120 + 120，动态类证明 50、完整集 70，共核对 4,418 个字素。
- **额外压测**（未提交）：另 8 个种子各 900 个模块，共 7,200 个模块、约 8.9 万个字素，全部通过。压测期间暴露并修掉一处精度缺口：作者参数的派生值作为内置读方法的实参（`list.join(params.t0.slice(...))`）被误判为逃出。接收者是否为数据值按声明形态判断，避免证明 params 只读时依赖 params 自身。

### 小问题 1：摘要只算实际导入的库

`previewAuthorIdentity(code, pin)` 用 `importedAuthorLibraries` 只纳入源码实际导入的库；源码解析失败时退回已记录的固定版本。两个调用方（风格样片、代码模板）都传入源码。历史迁移样片（API 9 + 合并时的库）摘要不变，原有测试照常通过。新测试覆盖三点：
- API 10 样片只导入 henji-layout 时，身份恰为 `{10, {henji-layout: 2.0.0}}`；
- 记录里多出未导入的库，样片摘要和模板摘要都不变；
- 实际导入的库换版本，摘要仍然改变。

### 小问题 3：以 main 为基线的配对 A/B

方法沿用上轮：
- **环境**：隐藏 Electron 44.9.3，隔离 profile，随机端口（未用 9334），1920×1080，200 字逐字位姿；Transport、Worker、作者运行时与 GPU 都是正式代码，只替换编译与 I/O 边界。
- **会话轮换**：四个会话逐帧轮换，依次为分支 B、main A，以及两个同源码 A′、A″。共四轮，每轮 100 帧；每个模式每个会话 400 个完成帧，不删尾部样本。
- **判定**：噪声取三个 main 会话两两之间 P95 差的最大值；B−A 同时 ≤ 噪声且 ≤ +1 ms 才算通过。
- **两侧工程**：基线为 main `85e7220fe`（含 U6）。旧工程两侧都是 API 7 / henji-layout 1.2.0。文字工程按每侧最新的作者接口编写，同一份内容：main 为 API 9 / 1.2.0（Canvas 文字），分支为 API 10 / 2.0.0（整形文字）。
- **数据位置**：原始数据在工作树 `.tmp/text-layout-preflight/r3-main-paired.json`、`r3-main-paired-2.json`。

结果（ms，P50 / P95）：

| 工程 | 模式 | 第 1 次：main | 分支 | P95 差 | 噪声 | 第 2 次：main | 分支 | P95 差 | 噪声 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| API 7 旧工程 | 播放 | 19.0 / 21.0 | 19.0 / 21.4 | +0.4 | 0.4 | 18.7 / 21.0 | 18.9 / 21.0 | 0.0 | 0.0 |
| API 7 旧工程 | 来回拖动 | 18.6 / 21.0 | 19.0 / 21.1 | +0.1 | 0.5 | 18.6 / 20.9 | 18.5 / 20.5 | −0.4 | 0.3 |
| API 7 旧工程 | 参数编辑 | 19.0 / 21.1 | 19.0 / 21.5 | **+0.4** | 0.2 | 18.6 / 20.6 | 18.9 / 20.9 | +0.3 | 0.4 |
| 文字工程 | 播放 | 19.0 / 21.2 | 7.5 / 10.1 | −11.1 | 0.2 | 19.0 / 20.9 | 7.6 / 10.0 | −10.9 | 0.2 |
| 文字工程 | 来回拖动 | 18.9 / 21.1 | 7.4 / 10.0 | −11.1 | 0.1 | 18.9 / 21.0 | 7.1 / 10.0 | −11.0 | 0.1 |
| 文字工程 | 参数编辑 | 19.0 / 21.2 | 7.5 / 10.1 | −11.1 | 0.2 | 18.9 / 21.0 | 7.4 / 10.0 | −11.0 | 0.1 |

- **结论**：没有任何一项比 main 慢超过 1 ms，按本轮“慢超过 1 ms 且超出噪声才查根因”的标准无需修复。第 1 次旧工程参数编辑 +0.4 ms 高于 0.2 ms 的噪声，没有达到上轮“在噪声内”的要求，**不把它当作通过隐藏**。重复实验中同项 +0.3 ms，在 0.4 ms 噪声内，第 2 次全部通过。
- **定位**：在第 1 次数据里拆分这 0.4 ms：
  - 主线程侧（updateDocument、提交与往返，即总耗时减 Worker 渲染）四个会话的 P95 都是 0.50 ms；
  - Worker 内 authorRaster（3.3/3.4）与 codeReady（6.2–6.4）两侧一致；
  - 差异全部落在 GPU 呈现等待 presentComplete（15.6 对 15.2）。同源码会话 A″ 在播放、拖动中该项也到 15.7–15.8。
  - 判断为呈现抖动，不是分支代码的开销。每 100 帧一轮的 A/A 差在 −0.5～+0.8 ms 之间，计时分辨率为 0.1 ms。
- **请求计数**：
  - 旧工程分支侧 prepareText **0 次**；只在初始化时多 1 条 `textFonts.attach`，其余请求与 main 逐项相同（render 1,252、code.source 1、parameters 400）。
  - 文字工程分支侧 prepareText 1、fonts 1。同内容下，分支的整形文字比 main 的 Canvas 文字 P95 快约 11 ms。

### 合并 main 与持久版本

- 合入 main `85e7220fe`（19-U6 变形效果，documentValidation、sceneDeclaration、mergedEffectsMigration 三个原有失败用例的修复，模板登记报错修复），自动合并无冲突。
- main 这期间**没有升任何持久格式或作者接口**（U15a 尚未合进 main），也没有新增冻结库版本，所以本分支的编号不需要顺延：剪辑 54、录制 57、风格库 10、风格包 13、效果库 7、预设包 14、代码版本 11、代码资产 16、作者接口 10、模板库 7。U15a 申请的作者接口 10、剪辑 54 与本分支相同，谁先合进 main 谁占号，后合的一方顺延。
- 历史快照保持 API 9 / henji-layout 1.2.0 / henji-effects 1.3.0 / three 0.186.1 / opentype.js 2.0.0，等于合并时 main 的最新值。
- henji-layout 2.0.0 冻结核对通过（7 模块，产物不变）。

### 验证（均在本任务工作树，经排队脚本）

- **类型检查**：渲染层与 Electron 两套 tsc 通过（`--max-old-space-size=8192`）。
- **精确测试**：
  - textFonts、textFontPreparation、authorVersion、TextCoverage，加 7 个直接消费者：styleCodeSnapshot、videoEditStyles、AuthorTextResources、RenderSession、TextPreflight、AuthorBundle、shapedText；
  - 合并后再跑 main 改动重叠的测试（mergedEffectsMigration、documentValidation、sceneDeclaration、effectRegistration、videoEditStyles）：8 文件 71 项通过。
- **真实作者链路**（冻结 2.0.0，真实 Worker 与系统字体）：
  - 动态阶段 **7 场景**通过，含新增的常量拼接、常量数组模板、纯字面量模块；门禁要求这三项走逐字准备，不能退回完整集；
  - ★ ✓ ① 한 𠀀 全部有墨迹、无缺字，已目视叠黑底截图（`.tmp/text-layout-acceptance/r3-dynamic-captures/`）；
  - fallback 阶段门禁通过。
- **其他检查**：
  - `check:persistence-compat` 66 种格式通过（`HENJI_PERSISTENCE_RELEASE_REF=main`）；
  - `check:assistant-capabilities` 31 文件 238 项通过；
  - `check:skill-sync` 5 技能、25 文件通过；
  - `check-text-layout-vendor --check` 通过。
- **`verify:changed -- --level L2`**：显式传入本轮 12 个文件，并用 `--test` 指定 11 个直接消费者（自动解析相关测试超过 45 秒预算）。在合并后的 HEAD 上**通过**：11 文件 102 测试、改动文件 ESLint、渲染层与 Electron 增量类型检查。需要 `NODE_OPTIONS=--max-old-space-size=8192`，默认 4 GB 堆会在增量 tsc 中 OOM（退出码 134）。日志 `.tmp/t10-r3-l2.log`。
- **lint**：`src` 范围没有问题。专项脚本里原有的 console 与十六进制颜色两处提示不在 lint 范围内，也不是本轮引入的。

### 原有问题与说明

1. 静态分析让常见写法逐字准备，但跨模块导入的文字常量、作者自定义函数的返回值仍按保守原则预载完整默认候选集，会更慢、更占内存，画面正确。
2. 工作树里上一位留下的 stash 没有动。
