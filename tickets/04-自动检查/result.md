# 04 自动检查 · 结果

状态：完成，阴影采用计划允许的“作者文档明确限制＋自动风险报告”方案。
分支：`task/04-自动检查`；基线：`0c713a395`。
本地提交：`f09cf743a5415f1bdc91c16083470f0ae4ca25cc`；未合入 main，未 push；worktree 工作区干净。

## 完成标准对照

| 项目 | 实现与证据 | 边界 |
| --- | --- | --- |
| 文字撑框 | motion 返回 text_box_overflow。录制原生 fillText/strokeText 与排版库正文墨迹，对照实际绘制矩形/圆角矩形及自身 bounds；穿过图层矩阵，跨层矩形按几何位置关联，持续至少0.3秒才报；保留原文、墨迹和框，给出序列时间与改法 | 不推断卡片语义；直接绘制、任意路径、GPU内部文字或无关联框仍需读图 |
| 口播对齐 | visual.narration 按每段字幕真实句首渲染合成帧，逐条给原文、时间和片段/作者图层/可观察文字清单；完整分页，不把有限 checkpoints 当逐句覆盖 | 不自动判断句意与图像语义；结构清单不证明遮挡后可见。图片不保存，按记录帧号和 documentVersion 使用现有 observe 读图 |
| 效果生效 | visual.effects 对已启用、amount>0 的正式画面效果分别关闭，在查询放置区间首/中/末帧作全尺寸像素比较；包括代码滤镜和WebGPU。显式 probes 对生成器数值/布尔参数按真实曲线求值，去掉副本里该参数曲线后设 offValue | 任意参数没有统一的关闭语义，不按名字猜；相同只证明所采帧无差异，有差异仍须确认是否预期。重复嵌套实体的开关影响它的全部实例 |
| 高亮连续性 | motion 返回 visibility_dip：同一稳定元素中途外接范围可见度/透明度下降后恢复；入场和末尾收起不报，带时间与原属性/源码改法 | 不认识“高亮”名字；不分析 draw 内部清屏、其他图层遮挡、任意 clip 与嵌套裁切造成的像素可见性 |
| 图层外投影 | motion 返回 shadow_outside_source；原生文字、矩形/圆角矩形与图像录制中检测源图形完全在栅格外、阴影偏移/模糊可投回的风险。作者文档明确不支持，给层内 blur 或扩大 bounds 的改法 | 现有范围推算已包括偏移和模糊，没有重复加偏移冒充修复；未承诺改变实际栅格裁切。任意 Path2D、直接绘制、GPU内部阴影仍未覆盖 |
| 时间、分页与恢复 | 新记录均有半开序列帧与 suggestion；文件身份进入渲染输入，分页不重复渲染，作品/字体/来源变化后重查；比较按开→关→开返回 effect_unchanged / effect_visible / effect_unstable | 网页画面是否就绪不由本任务保证 |

## 助手覆盖分级

按 henji-application-capability 七问判为“能力增量”：新增可查询证据，其余业务动作、持久副作用、付费/长任务、稳定引用和页面均未新增。扩展 query_video_edit_review 的既有算法声明、执行器与结果，Pi/MCP 从同一份 Zod 声明投影；没有第二份工具名单或专用 CRUD 工具。assistant-status 记录可查询证据的增量及未验收边界。

## 改动统计

21 files changed, 502 insertions(+), 25 deletions(-)。

- 公共契约、复核类型与检查点优先级：videoEditReviewCapability、review、motionStructure。
- 作者观察与几何检查：codeAuthorProgram、CanvasRecorder、AuthorRuntime、codeMotionReview、codeCanvasReview，复用 textOverflowReview 的包含判定。
- 正式离屏渲染与像素比较：videoEditVisualReview、videoEditReview、MotionReviewWorker/Client、effectPixelReview。
- 测试：4个新增/修改的精确测试文件；作者参考文档2处、助手现状索引1处。

选型：复用现有录制、正式时钟、运动 Worker、离屏池、文件身份服务和仓内已使用的 pixelmatch；不另建渲染/取帧路径，不新增依赖。框相交用成熟的分离轴判据（核对已安装 three OBB 的做法），并复用现有四边形包含检查，不引入整套3D几何对象。

## 验证

按 testing.md L2：公共输出契约与跨消费者观察数据；新增测试保护实际几何漏报、长正文边界、稳定公共调用与曲线/转场时钟，没有清单快照或版本号断言。

- `npm run verify:changed -- --level L2 <本次21文件> --test <直接消费者测试>`：通过。显式文件清单见本次提交的 `git show --name-only --format= f09cf743a`。
- 合并去重后的13份定向测试：161项通过；改动文件 ESLint、渲染层与 Electron 两套增量 tsc、依赖图、主进程传递导入全部通过。
- 直接测试：codeMotionReview、textOverflowReview、review、effectPixelReview、motionStructure；AuthorCanvasRecorder、AuthorCanvasBounds、AuthorRuntime、AuthorRuntimeResolution；MotionReviewWorkerClient、videoEditReview、videoEditSceneReview、videoEditVisualReview。
- `npm run check:assistant-capabilities`：结构检查通过；applicationControlCoverage 15项通过；31份业务不变量测试237项通过。
- `git diff --check`、暂存区核对、提交后工作区核对通过。
- 自动 related 解析触及45秒预算后改为显式测试；默认 Node 4GiB 堆不足，最终 L2 仅在本次进程设置 `NODE_OPTIONS=--max-old-space-size=12288` 后通过，未修改项目或系统设置。
- 未运行 Reality、Electron实例、真实Pi/MCP或真实片子；公共调用测试仅在像素/线程/文件边界使用替身，不能当成实际成片像素验收。

## 独立审查

两轮独立干净上下文审查。第一轮3项重要问题全部修复：居中文字横穿卡片时漏报（改用多边形相交）；长正文进入建议文字导致公共输出超限（正文保留在结构化证据，建议简短）；静态代码片段的转场余量帧参数求值失败（对齐正式 holdBeforeZero 时钟）。第二轮无新增或尚未解决的重要问题。对应回归测试通过。

偏离：当前工具未提供计划指定的 Opus high，改用独立 Codex 上下文审查；没有将其他模型冒称为 Opus。阴影使用计划内的备选方案，不登记为已修好真实投影绘制。

## 排查范围与遗留

已检查：Canvas 原生/排版库录制、同帧框关联、平面与运动图层观察、缺失图层后的恢复、父级透明度、效果链与生成器参数临时副本、嵌套/转场时钟、分页与文档失效、文件身份、输出契约和既有调用方。独立审查所列同源缺陷已修复；相关定向测试未发现额外回归。

尚未验证：真实 Electron/显卡像素、实际长片耗时、真实模型的语义看片质量、GPU内部文字与阴影、最终遮挡和跨目标高亮交接。网页取帧及播放调度完全未改，保留给并行任务。未触碰 D:\视频制作；node_modules 联接点保持原状，未删除或重装。

详情：同目录 design.md 为实现前设计决定；本文件为实际交付与证据。

## 2026-10-31 交叉审查修订

状态：已按 review.md 开头的处理范围修订，可交回合并。

本次提交：`ffc0e5e93`（`fix(video-edit): 修复自动复核误报与计算预算`），在 `task/04-自动检查` 上追加一次提交，基于 `f09cf743a`；未 push、未合入 main。

最终验证：显式20文件 L2 全部通过，15份定向测试182项、改动文件 ESLint、渲染层/Electron双工程 tsc、依赖图及主进程传递导入门禁均通过。`npm run check:assistant-capabilities` 通过：结构检查、15项覆盖测试及31份业务不变量测试237项。`git diff --check` 与暂存清单核对通过。L2 仅在当前命令进程设置 `NODE_OPTIONS=--max-old-space-size=12288`，未修改项目、系统或依赖设置。

### 条目处理

| 条目 | 处理 |
| --- | --- |
| 必须 1 | 候选框要求墨迹中心落入，且两个方向都具有实质容纳范围；下划线、单词底色、光标、小图标、进度条不再仅凭相交就冒充卡片。真实窄卡片持续撑框仍报出。 |
| 必须 2 | 不再清空 canvasReview；文字只标 retained=false，框和阴影保留绘制事实。已证明被 reset、完整 clearRect、copy 替换或不透明 destination-out 完整擦除的框排除出容器候选；局部擦除不丢失不相交框，新 copy 卡片继续有效。 |
| 必须 3 | 从保存序列的原始字幕 start 作单点投影，并核对该帧仍位于字幕可见时间范围；修正倒放等值边界。嵌套入点裁切、render-only 口述字幕裁切、变速跳过整段字幕均不补造句首，同一实例拆段去重。 |
| 必须 4 | 开始取帧前估算总帧数与总像素量，单次预算120帧、2.5亿像素；超预算明确提示缩小 from/to 或拆分 narration/effects，未开始渲染且不截断结果。同帧 E 个效果改为 E+2 次渲染，共用两次开启基线；保留开→各自关→重复开的稳定性检查。 |
| 必须 5 | visibility_dip 只报告最长1秒且中途恢复的下降段；长空窗、场景复用、正常入场和尾部收起不报。按查询序列 fps 换算。 |
| 建议 6 | 连续问题按正文、近似形状与前帧最近几何一对一匹配，不依赖 facts 下标；条件绘制、微小抖动和 draw 内 CTM 平移不会切碎持续问题，同文多处绘制仍分开。 |
| 建议 7 | 阴影颜色先经过原生 Canvas 规范化，识别无空格 rgba、透明十六进制及零 alpha 写法。坐标部分核对后保留原行为：源四边形、画布大小和阴影长度本就在栅格坐标；Canvas shadowOffset/blur 不随 CTM/fullResolution 缩放，replayAuthorCanvas 也仅在降采样时同比换算。盲乘 fullResolution 会与实际重放不符，故未按该假设修改；补2倍栅格的正反回归证据。 |
| 建议 8 | shadow_outside_source 仅对独立栅格的运动层/具有覆盖位姿的图层输出；静止层不报，并同步作者参考文档。 |
| 建议 9 | 保留逐像素敏感比较，同时返回归一化最大/平均通道差与变化像素占比，公共 schema 和 DTO 同源扩展。 |
| 建议 10 | 同一查询复用比较 Worker，只传位图，不传 composition。批量同一文档的观察帧复用文档身份，跳过重复 replaceContent；切换效果临时副本仍按正式入口失效。 |
| 建议 11 | 无代码放置的句首只列结构清单，不空渲根帧；代码观察按局部 composition 与帧去重、按文档批量运行。不同嵌套投影副本保持各自身份，不来回切根/子序列。 |
| 建议 12 | 每帧一次收集并投影兄弟 boxes，不再每元素展开 current.values()、重算全部框。候选关联仍逐文字进行。 |
| 建议 13 | offValue 证据使用校验后的实际值。静止层 text_clipped 与 text_box_overflow 重复、flat 层 layerIndex 未指定导致重复两项按 review.md 指定作为原有问题保留；本轮不扩展到去重语义重构。 |

### 验证与审查

- 为必须1、2、3、5补误报/漏报回归；另覆盖基线共享和不稳定、渲染前预算拒绝、Worker复用且不传文档、同文档批量替换、静止/运动阴影以及像素差异强度。
- 按 testing.md 的 L2（公共输出类型、跨消费者观察数据、异步 Worker 生命周期）运行显式20文件验证；文件清单即本次新增提交的文件清单，未扫描其他任务改动。直接消费者测试显式补入，合并为15份定向测试；未升级全量、Reality或构建。
- 选择复用既有 Canvas 录制/重放、四边形包含、parseColor、正式离屏池、trialVideoEditCodeFrames 和运动比较 Worker；没有新增依赖或第二条取帧路径。
- 独立 Codex 干净上下文审查共3轮：第1轮发现已擦除框误关联与 CTM 移动文字被切碎，已修；第2轮发现 copy 新框与不相交擦除漏报，已修；第3轮发现不透明 destination-out 全覆盖残留，按统一“可证明完整擦除”的判定修复并补正反测试。达到3轮后未再派第4轮，末轮后的修复由定向回归和L2验证，未声称再次独立复核无问题。
- 助手覆盖：沿既有 query_video_edit_review 的声明和领域执行器修复，Pi/MCP自动同源；无新工具、实体、页面、持久格式或付费语义。属于普通缺陷修复和性能优化，不改变“通/不通”，按 assistant-status.md 第零节无需更新台账。

### 排查范围与边界

实际检查 Canvas 录制→作者运行时观察→逐帧问题合并、共享 sourceMap 单点/区间调用方、原始/嵌套/口述字幕投影、效果及作者参数探针、比较 Worker、批量试渲染和其直接调用方；相关定向测试未发现额外回归。没有扩展成全项目审计。

未运行真实 Electron、真实 Pi/MCP、实际成片像素或长片耗时验收；预算与 E+2 次数由确定性测试证明，不冒充真实显卡性能证据。任意路径/滤镜/不确定混合的最终像素仍须读图。未改网页取帧、播放调度或界面，未修改 main 工作区；node_modules 联接点保持原状，未删除或重装。按本次明确约束不 push、不合入 main。


## 2026-10-31 第 2 轮复审修订

状态：按本轮清单完成 1 条必须改与 3 条建议的指定处理；几何候选的语义边界见下方独立审查说明。
本地提交：`1faaab575`（`fix(video-edit): 恢复倒放检查边界并修正文框关联`），基于 `ffc0e5e93`，仍在 `task/04-自动检查`；未 push、未合入 main，提交后 worktree 干净。

### 条目处理

| 条目 | 处理与证据 |
| --- | --- |
| 必须改：共享倒放单点投影回归 | `projectVideoEditSequenceMapRange` 恢复倒放 `<` 原语义；句首在 visual 中单独投影 `[start,start+1)` 并取 from。补倒放嵌套回归：片段首尾边界为50/10帧，不透明度事件为38帧，正式嵌套时钟37帧仍采样局部22、38帧采样21；原有句首定位仍通过。 |
| 建议：阴影颜色处理成本 | 仅在有 primitive 且 shadowOffset 至少一个非零时写入 measure.shadowColor 并解析透明度。补状态/路径/无偏移图形不触发规范化、实际阴影仍记录的测试；既有透明颜色、栅格尺度、混合和擦除测试通过。 |
| 建议：严重文字撑框漏报 | 候选按墨迹中心在框内、框高至少达到墨迹投影高度一半关联，宽度不设下限。补180宽正文对40宽卡片及旋转后的回归；保留原居中光标/窄底色输入并断言其按指定规则成为候选。 |
| 建议：contentAnchor 嵌套确认 | 补正放、倒放两个正式公共入口用例：声音片段带 contentAnchor，嵌套裁切将片段投影为 start=30/duration=30，裁切字幕起点变30而保留字幕原句首40不变。仅原完整句在根序列10/19帧生成句首证据，裁切后的30不伪造句首；保存文档不变，纯字幕不空渲染。未发现需要额外修改的 contentAnchor 句首偏移。 |

### 验证

按 testing.md L2 的“共享模块、跨直接消费者”条件执行，未升级全量、构建或 Reality。显式范围为本次提交中的8文件，不扫描主分支或其他任务的脏文件。

```text
npm run verify:changed -- --level L2 src/core/videoEdit/sourceMap.ts src/core/videoEdit/review.test.ts src/core/videoEdit/codeCanvasReview.ts src/core/videoEdit/codeCanvasReview.test.ts src/features/videoEdit/application/videoEditVisualReview.ts src/features/videoEdit/application/videoEditVisualReview.test.ts src/features/videoEdit/engine/videoEditAuthorCanvasRecorder.ts src/features/videoEdit/engine/videoEditAuthorCanvasRecorder.test.ts --test src/core/videoEdit/sourceMap.test.ts --test src/core/videoEdit/codeMotionReview.test.ts --test src/features/videoEdit/engine/videoEditAuthorRuntime.test.ts --test src/features/videoEdit/engine/videoEditAuthorRuntimeResolution.test.ts
```

- 上述 L2 通过：8份定向测试95项、改动文件 ESLint、渲染层与 Electron 两套增量 tsc。仅该命令进程设置 `NODE_OPTIONS=--max-old-space-size=12288`，未更改系统或项目设置。
- 审查后仅补回居中窄框测试输入和明确预期；`npm run verify:changed -- --level L1 src/core/videoEdit/codeCanvasReview.test.ts` 通过，4项测试及该文件 ESLint通过。生产代码未变，复用上述双工程类型检查证据。
- 初次定向执行因当前 Vitest 不支持 `toHaveBeenCalledExactlyOnceWith` 而失败，已换成现有支持的两条断言；修正后精确测试及L2通过，无未解决测试失败。
- 未改能力声明、schema、注册或跨域契约；沿既有 query_video_edit_review 正式领域执行器修复，使用正式公共入口测试，不增加Pi/MCP适配或重复工具。普通缺陷与性能修复不改变“通/不通”，无需更新 assistant-status。
- `git diff --check`、精确暂存清单与提交后工作区核对通过。

### 独立审查与边界

独立干净 Codex 上下文审查1轮，发现1项重要意见：取消宽度限制后，居中光标、窄底色也可能成为容器，且面积排序可能优先选中它们；共享兄弟框关联同样受影响。本轮复审明确指定“中心在框内＋高度至少一半即为候选、宽度不设下限”，此意见按该指定规则记录为保留边界，不另加相冲突的宽度限制。已保留原居中输入并直接断言新规则的候选行为，不移动输入来掩盖该现象；未声称审查无重要问题或几何结果能辨认卡片语义。

实际排查共享投影的 review 边界/效果事件、字幕/转场区间、textSafetyReview、scene placement 调用方；后两者仅使用非空区间，不受恢复的单点分支影响。并检查原始字幕与嵌套裁切、contentAnchor 片段投影、Canvas录制的状态/路径/图形指令、兄弟框关联及其 codeMotionReview 消费方。以上定向测试未发现其他同源回归。

未运行真实 Electron、Pi/MCP、成片像素或实际播放性能验收，不把减少解析调用次数等同于真实播放帧率改善。网页取帧、播放调度、界面及 main 代码未改；node_modules 仍为指向主仓库依赖的原联接点，未删除或重装。只在指定 worktree 提交代码，并按本次交付要求追加本文件；未 push。

## 真机验收（10-31，Claude）
- 《元宝搜索》342–344 秒（额度卡）复核 120 帧：返回 16 项，含字幕安全框、事件密集、代码元素动作；额度卡文字因片子用普通 fillText、未用排版库 drawText，撑框检查明确报“未覆盖”并给出升级办法，不误报。
- 720 帧（12 秒）一次复核超过助手调用时限（MCP 超时），未拿到结果；120 帧正常。遗留：大范围复核应分段或异步返回。
- 未验证：口播对齐与效果像素对比（MCP 客户端的工具定义未刷新出 visual 参数，需重连后再测）。
