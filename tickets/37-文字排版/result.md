摘要：基线 bafb1e49c 已含 3b4d1b5da 的 Pretext/HarfBuzz 实现与 henji-layout 2.0.0 冻结；本票复测并修复实验脚本，未重复发行相同库。
摘要：实验 1/2/4/5/6/7/8 已取得数字，标点及推近对照图已生成；原始断点 196/200，未达到本次 100% 要求，不能判完整任务通过。
摘要：旧冻结产物与作者公共接口未改；视觉结论待 Claude，断点目标与既定例外冲突待裁定。代码检查及提交状态见文末。

## 决定与范围

- 仅在 task/37-文字排版 工作，起点 bafb1e49c。现有 2.0.0 的 text/flex/table 已登记，最低作者接口 v10；layoutText 同步接口与 GraphemePose 已由既有实现保留。未重写整形、未更换依赖、未新增冻结版本或持久格式。
- 复用 src/core/imaging/vectorContent/shaping 的 HarfBuzz 适配、Pretext walker、标点计划、字体会话及轮廓；未修改任何冻结字节。生产可达的 Pretext 7 模块使用 HB 提供的几何，不再依赖 Canvas 测量；上游原版 Canvas 测量仅用于实验对照。
- 修复 scripts/prepare-text-layout-acceptance.ts：实验构建使用正式 computeRenderEngineVersion 提供虚拟模块；计时插入点跟随当前 exact 栅格边界。未修改三维实现。
- scripts/text-layout-acceptance-browser.ts 新增每行 width、advance sum、difference 原始数字；保留已有例外门禁，报告单列原始一致率，不将旧门禁的 passed=true 解释成本票 100% 达标。
- .codex 与 .claude 的应用能力参考同步补上作者库版本及正式作者文档链接；以后再做第 1 节纠正已实现状态。现有 resources/assistant-skills/video-edit-code-creation/references/author-text-motion.md 与 code-project.md 已说明 2.0.0，无重复文档。
- 全量 lint 的基线问题按本票“门禁失败自行修复”要求作工程修正：Windows 测试路径保留反斜杠、删除未用类型导入、将电平下限 -60 常量迁到既有纯模块并更新两个导入。没有改变界面结构、颜色、布局、计算公式或视觉行为。
- 第 15 项：本次不发行 henji-effects，模糊参数改名不重新冻结；不能改已有冻结字节。生成检查通过。另半项“样片摘要只算实际导入的库”已在基线 authorVersion.ts 实现，其相关测试通过。

选型结论：现有 Pretext + HarfBuzz 组合已支持常规标题断行、共享整形、轮廓与 tnum；实测支持继续使用既有 2.0.0。但“全部固定样本与 DOM 断点 100% 一致”当前不成立。若该条件必须恢复，需修改上游极窄行语义与簇内字体回退设计，不能以再冻结相同代码满足。按本票要求，涉及设计方向或降低门槛时先回报，故暂停新增冻结版本，等待裁定。

## 实验事实

环境：Windows，隔离隐藏 Electron 44.9.3 / Chromium 152.0.7977.167；独立 profile 和随机回环端口，未连接用户浏览器或网页账号。性能为现有正式 Worker 专项构建，非完整播放器或独占机器承诺。字体字节哈希、逐帧样本、内存采样在 JSON 内。

| 实验 | 本次数字与结论 | 原始证据 |
|---|---|---|
| 1：断行 | 固定 200 条，冻结版 196/200=98%，上游原版 Pretext 197/200=98.5%；600 条临界宽度断点 588/600。未达到原定 100% | evidence/dom.json |
| 2：行宽与 advance | 808 行中 744 行原始差为 0；64 行有行尾空白，最大绝对差 18 px。占用行宽按 Pretext 悬挂空白规则计算，原始 advance 包含悬挂部分；没有把两种口径冒称完全相等 | evidence/dom.json 中 cases[].advances |
| 3：标点 | 三字体、七组标点、1×/4×共 42 组；最大字位/宽度差 0.010417938 px，静止/逐字落定像素差 0；126 张 DOM/HB/overlay 图已存，目视待 Claude | evidence/punctuation/ |
| 4：大字体 Worker | Noto Sans SC 17,773,244 bytes；独立 Worker 准备 P50/P95 346.1/380.4 ms，首帧 518.6/565.2 ms；同 Worker 热准备 3.2/5.2 ms，首帧 10.4/12.1 ms，热循环新增字体读取 0 | evidence/worker-load.json |
| 5：逐字帧成本 | 1080p、200 字、5 次预热/30 次配对；2.0.0 作者 draw P50/P95 1.6/2.5 ms，文字阶段 2.9/3.7 ms；旧 1.2.0 文字阶段 5.2/7.1 ms。静止文字 2.0.0 为 1.7/2.9 ms，旧版约 0.1/0.3 ms；不能称所有情形更快 | evidence/frames.json |
| 5：外观与推近 | 20/200/1000 字 × 1080p/4K × 静止/逐字/描边阴影 × 两库版本完成；首帧非空、热帧检查通过。1×/2×/4×/8×两版对照已存，新版最后一次 8×落定新增分配 0；清晰度待 Claude | evidence/matrix.json、evidence/matrix-captures/ |
| 6：描边与挤出 | 20 字几何准备 23.6 ms，描边 P95 0.1 ms，three 绘制+gl.finish P95 0.4 ms；200 字准备 11.0 ms，描边 P95 0.3 ms，绘制 P95 0.4 ms。使用已有 SVGLoader/ExtrudeGeometry，未自研三角化 | evidence/outlines.json |
| 7：回退 | 11 场景通过；假名、扩展汉字、ZWJ、VS、旗帜、组合符的 DOM 实际字体检查 6/6；重复 seek 像素、缺字诊断及字体/轴身份检查通过 | evidence/fallback.json |
| 8：tnum | Calibri 数字 0–9 均为 1038/2048 em（30px 时 15.205078125px）；Gabriola 无等宽特性，差异明确诊断。表格非零内容宽最大 DOM 字位差 0.0234375 px | evidence/table.json |

实验 2 的 64 行全部带行尾空白。实现 paragraph.ts 的 width 有意排除完全悬挂部分、保留部分悬挂占用，glyph advance 保留完整字距。P014/P015 的部分悬挂还意味着“删掉全部尾空白再求和”也不等于占用宽；该差异不是浮点误差。若要求两个公开数值无条件相等，需先决定是否改变既有悬挂几何语义。

实验 7 的边界：仅 Windows。精简 HarfBuzz 对 morx/kerx 两个 AAT 样本不支持；sbix/CBDT 以系统 emoji Canvas 出彩色画面，不保证自定义彩色字体原像素。macOS 未验证。

## 断点差异与待裁定

| 样本 | 冻结版 / DOM 差别 | 来源 |
|---|---|---|
| P022 | 21px 极窄行，软连字符应急断行：冻结版 2 行，DOM 3 行 | 上游 Pretext 同类差异 |
| P027 | 1px 极窄行：冻结版保留一条空白独占行，DOM 不保留 | 上游 Pretext 同类差异 |
| U004 | emoji 后组合附加符等序列：两侧断点不同 | 既定整簇单脸与浏览器拆分字体回退语义不同 |
| U007 | 同类非标准组合序列：冻结版 4 行，DOM 3 行 | 同上 |

本分支 tickets/10-文字排版/review.md 的“第二轮实验后的裁定”曾明确接受上述差异。本票要求 100%，与该既定裁定冲突；已向用户提出选择。未擅自删样本、增加豁免、降低本票门槛，未改 vendor 或簇内回退设计。新冻结版本未发布。

## 待 Claude 目视

- 标点：evidence/punctuation/0-overlay.png 至 41-overlay.png，各有同号 -dom.png 与 -hb.png。字体、文本、倍率对应 dom.json 的 experiment3.cases 同下标；应区分字位偏移与抗锯齿差异。
- 推近：evidence/matrix-captures/zoom-7-0.png 至 zoom-7-4.png 对照 zoom-10-0.png 至 zoom-10-4.png；依次为 1×、2×、4×、8×、8×落定。
- 外观：evidence/matrix-captures/1920-20-appearance-7.png 与 -10.png；3840 同名一对。
- 轮廓、回退、表格附加图分别在 evidence/outlines-captures/、fallback-captures/、table-captures/。
- 本票未自行作“好看”“清晰度已达标”等目视结论，也未调用外部聊天服务。

## 复现与校验

已有固定 Pretext 上游 tarball 下载到 .tmp/text-layout-sources 并展开；SHA-512 与 vendor/source.json 的 npm integrity 完全一致。字体格式样本由 node scripts/prepare-text-layout-font-formats.ts 固定上游提交下载。没有 npm install，node_modules 联接点未改；FFmpeg 只在本工作树新增指向现有二进制的联接点供 skill 门禁读取。

重命令均经用户指定 heavy.sh；本票最多同时启动两条排队命令。指定脚本实际配置为 3 槽，与任务描述的全机 2 槽不一致；未修改外部排队器，不能据此保证其他会话的全机总并发。两套 tsc 使用 NODE_OPTIONS=--max-old-space-size=8192，tsbuildinfo、ESLint 缓存放本工作树 .tmp，Vitest 禁用缓存，未写主工作区 node_modules。

核心命令（前缀均为指定 heavy.sh）：

```text
node scripts/prepare-text-layout-acceptance.ts --frozen --worker --outlines --table
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/index.html --out <evidence>/dom.json
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --out <evidence>/worker-load.json
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --phase frames --out <evidence>/frames.json
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --phase matrix --out <evidence>/matrix.json
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/worker.html --phase fallback --out <evidence>/fallback.json
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/outlines.html --out <evidence>/outlines.json
node scripts/run-text-layout-dom.cjs --page .tmp/text-layout-acceptance/table.html --out <evidence>/table.json
```

检查：排版、冻结、版本精确 Vitest 8 文件 87 项通过；lint 修复的错误消息/音频电平直接消费者 2 文件 2 项通过；66 种持久格式兼容通过；作者效果生成和 vendor 字节/许可/反向补丁检查通过。最终全量 lint、渲染层与 Electron 两套 tsc、skill-sync 均通过（验证串行脚本退出 0）；未运行全量 Vitest 或完整 Electron 构建。提交号见文末。

审查：两轮干净上下文只读审查，无重要问题；第一轮指出 result.md 尚未落盘，本文件已落实。第二轮确认 lint 修复不改变界面结构、样式或计算公式。

同源排查：现有冻结登记及 1.x 读取、作者 text/flex/table 共用整形、段落行尾空白/软连字符、字体回退及身份、作者绘制和实验计时入口、样片版本摘要。已修复的仅为实验构建及 lint；断点四项为已证实的保留差异；跨平台与目视结论未验证。


## 提交

- 439554e5b — test(text-layout): 恢复冻结文字库实验并补齐数值证据；10 文件，+25/-11；含指定 Co-Authored-By。
- 依赖图门禁通过：0 静态值 SCC、0 冻结跨层边。
- 已推送 origin/task/37-文字排版，HEAD 与上游一致（ahead/behind 0/0），工作树干净；未合并、未修改 main 工作树文件（本 ticket 目录除外）。
