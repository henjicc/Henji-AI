摘要：design.md 正文已落实复审 A–H；本轮实现并提交纯 CPU 排版基础，ticket 10 的所要求范围尚未全部完成。
摘要：19 项 CPU 测试、L2 局部验证、64 项持久格式兼容门禁及冻结依赖校验通过；API 8、持久迁移和正式宿主接线尚未实施。
摘要：显卡恢复后运行 `node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-dom/index.html --out .tmp/text-layout-dom/dom.json`，验证实验 1/2/3 的基础对照；实验 4–8 的完整宿主脚本仍待补齐，当前未运行任何 Electron/DOM/GPU 实验。

# 本轮交付

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

本轮停在已验证的 CPU 基础边界，尚不满足用户要求的完整范围。下面前两项仍可在显卡暂停期间继续实现，并非被显卡禁令阻塞：

1. **CPU 核心补齐与宿主集成**：富文本/多字体与书写系统 run、回退链进入实际段落、scripts/text/bindings 对宿主字体准备的实际作用、WOFF/SFNT 规范化、正式编译诊断接线、各渲染入口首次出帧屏障、独立于渲染 queue 的字体通道、字体 revision 失效和租约生命周期。当前段落只覆盖单字体基础样式；soft hyphen 明确拒绝，尚缺行尾标点溢出协议、完整 tsume/上下标/小型大写、fit/justify/truncation 等作者语义。CRLF 需要调用方规范化。
2. **API 8 与版本持久化**：实施 design §9.1 的 8 类格式升级、逐版本迁移与真实读写黄金样本；实现固定历史 API7/库快照、风格样片/模板/包的版本传播、升级操作与撤销、原生预设生成器常量；再更新能力投影/技能和相应检查。当前没有改变任何 schema、格式登记、发布快照或默认 API，不把未完成引擎设为默认。
3. **显卡恢复后的实验**：先运行本文首部的 Electron 命令。当前脚本仅是实验 1/2/3 的基础 DOM 断点/几何对照；尚缺上游原版 Pretext 三方比较、完整临界集合和正式 Reality 接线。实验 4–7 的装载/绘制/性能/跨平台回退，以及实验 8 的 DOM 逐格表格脚本尚未完整实现，不能直接按已准备完毕处理。实验 2/8 当前只有 CPU 子集证据。
4. **正式作者库交付**：接通 layoutText/drawText/GraphemePose 和 table 作者入口、实际绘制观察、稳定轮廓身份与外观缓存；完成全部门槛后才冻结 henji-layout 2.0.0。真实窗口/GPU/性能尚无结论；不能用 Node 数据替代正式产物验收。

未运行 Electron、开发版、Reality、GPU 测试或任何 `*.gpu.test.ts`。未运行 npm install/ci/uninstall，未改 package.json/锁文件；node_modules 仍为指向主仓库的原联接点。未改界面，未访问 D:/视频制作，未修改主工作区其他位置。

## 本地提交

`826ee2701` — `feat(text-layout): 新增纯 CPU 整形与表格基础`。

提交后工作区干净，仍在 `task/10-文字排版`；按本次指令未推送。
