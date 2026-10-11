# t164 节拍分析与超级关键帧吸附（最小版本）

状态：最小实现与单测接线完成，两处集成门禁待总管理者处理；真实 Electron 截图由总管理者统一补拍，不登记整项验收完成。工作目录仅 `D:/VibeCode/henji-wt-batch`，不做 Git 写操作、不安装依赖、不碰主仓库开发实例与 SDK。

## 范围与设计

- 音频片段右键「分析节拍」；算法也可指定序列混音。现有混音 Worker 负责解码、源时间/变速/倒放/效果；按约一秒 PCM 分块传给节拍 Worker，收到确认后才请求下一块。Worker 只保留 FFT 窗口和紧凑的谱通量包络，不积累整段 PCM，不设片段/节拍/时长数量上限。
- 结果直接写现有 marker 的 `type: beat` 与 `strength: 0–1`，强度表示相对攻击重音，不声称识别拍号/小节强拍。普通标记保留；重复分析仅替换同来源旧节拍。标尺复用原菱形标记，命令带右端复用现有「取消动作 + 百分比」呈现，未新增面板、主按钮或常驻说明。
- 当前片段 `snapToBeat` 是持久化通用属性。超级关键帧已有分组只新增 UiSwitch「吸附到节拍」。整理在 Worker 中将候选曲线时刻吸到最近节拍；姿态值、插值、钉点和动作区间边界保留。碰撞时保留原时刻，不丢关键姿态、不跨越钉点。原稿对照不吸附；节拍或开关变化使旧候选过期。
- 分析结束一次文档事务、一步撤销。取消、无稳定节拍、原文档变化/关闭、锁定片段均不写结果。保存失败保留已生成标记，恢复只保存。
- 典型规模：数分钟音乐；没有产品上限。固定约 23ms FFT 窗口、5ms hop；PCM 内存只随一秒声道数增长，包络与最终 marker 随时长增长。不对音频采样率设产品上限；须为正整数，FFT 窗口必须小于 2^30 样本（现有基2 FFT 的有符号32位索引约束）。44.1/48kHz已有夹具，其它采样率未实际验收。实际桌面性能与音乐效果待用户试用，不把合成夹具当真实音乐成绩。

## 开源选型

查阅一手资料：

- [web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector)：公开接口主要返回 tempo/BPM 和首拍 offset，无法直接提供逐攻击重音强度；固定速度展开还会引入长段漂移。
- [Essentia RhythmExtractor2013](https://essentia.upf.edu/reference/std_RhythmExtractor2013.html)：可输出 ticks/tempo/confidence，标准接口接收完整信号且要求 44.1kHz；[Essentia.js Worker 教程](https://github.com/MTG/essentia.js/blob/master/docs/tutorials/3.%20Machine%20learning%20inference%20with%20Essentia.js.md)证明 WASM 可离线程运行，但本 worktree 不安装新依赖，本单也不新增 WASM 打包链。
- [aubiojs](https://github.com/qiuxiang/aubiojs)：公开 JS 绑定列出 pitch/tempo，[aubio 原库](https://aubio.org/doc/latest/)具有 onset，但需要进一步绑定与 WASM 接入。

本轮采用用户明确允许的 spectral flux + onset peak picking + tempo interval voting 路线，复用现有 `videoEditFft`，不新增 npm 依赖、不复制 FFT。未实跑上述第三方库，不宣称已证明其效果不达标；本选择针对最小分块接入成本。若真实音乐召回或变拍效果不达标，应优先再接 Essentia/aubio 成熟 beat tracker，不无限修补本核。

## 能力覆盖分级

按 `henji-application-capability` 七问：

1. 新增可读数据/设置：是，marker 类型/重音强度与片段吸附开关。
2. 新增业务动作/写入：是，分析并生成标记；设置走已有通用属性写入。
3. 新增长任务/取消/恢复：是，可取消；保存失败只保存；不新增付费。
4. 新增跨工程/领域引用：否，沿已有剪辑文档、序列、片段、marker 引用。
5. 新增持久化/权限副作用：是，新字段和一次文档写入，沿 `video_edit:write`。
6. 新增可导航 Surface：否，菜单动作与已有面板开关不另建页面/浮层。
7. 仅呈现变化：否。

因此为「能力增量」。仅 `analyze_video_edit_beats` 是专用算法；marker 与 `video_edit.clip.snap_to_beat` 均沿通用实体读写。UI/Pi/MCP 同一领域入口，注册包括显式文档/序列/片段目标、权限、取消、原子执行事实与保存恢复。

## 设计自查

1. 助手只凭名称和说明能否用对？能。算法说明区分显式音频片段与可听序列混音，结果读现有 marker，吸附写片段通用属性，钉点优先。
2. 能否 AI 先做、人只确认？能。自动生成节拍，动作整理先给候选，用户确认后才应用；原稿/钉点和撤销可保留校正。
3. 产物能否直接流进其他工作区？节拍是剪辑原文档中的标记，正式曲线继续走既有剪辑/导出/资产桥；不新建另一个节拍资源格式或文件搬运流程。跨域标记语义转换不在本轮范围。

## 验证

按 testing.md L2：持久字段、Worker 取消、异步文档写入与公共算法接线。用户明确要求相关目录、videoEdit/application、creativeIntent 目录零失败，分目录单 Worker 静音执行；两条 tsc、文件级 eslint 0 警告及专项门禁。初次公共测试遇到 t166 的点号能力 ID 加载失败，已由其负责人修正；本单未修改该文件。

精度夹具固定：48kHz，60/90/120/137/180 BPM，每组20个衰减90Hz鼓点，起始偏移137ms，每四拍幅度更强，PCM跨非整秒块边界。要求召回100%、误差≤1/30秒，另测44.1/48kHz反相立体声、静音、短输入。

| BPM | 参考/检测节拍 | 召回率 | 最大时刻误差 |
|---|---|---|---|
| 60 | 20/20 | 100% | 2.67ms |
| 90 | 20/20 | 100% | 4.33ms |
| 120 | 20/20 | 100% | 2.67ms |
| 137 | 20/20 | 100% | 4.97ms |
| 180 | 20/20 | 100% | 4.33ms |

合计100个参考节拍全部召回，未多报；最大4.97ms小于30fps一帧33.33ms。这里是算法时刻精度；写标记时再按序列帧率就近取整。

- `src/core/audioAnalysis` + `src/core/videoEdit/timedContent.test.ts`：2文件20测试通过，覆盖节拍核心和标记元数据的移动/拆分/复制。
- `src/core/creativeIntent`：18文件149测试通过，含吸附/钉点/碰撞与共享整理回归。
- `src/features/videoEdit/application` 首轮：79文件通过、1文件失败、1默认跳过基准（649通过、1失败、1跳过）。运行过程中更新的默认反射读取被此前进程缓存；失败的 `videoEditBeatAnalysis.test.ts` 在新进程重跑7项全过，其余已通过文件未重复运行。本轮有效覆盖650项通过，基准未启用；不把首次目录命令写成成功。
- 开关UI/正式候选应用、节拍变化拒绝、原稿对照和一步撤销包含在 `videoEditMotionDraft.test.ts` 19项通过中。
- 两条 tsc 通过；初次渲染层错误（本单测试钩子返回值/开关回调，以及并行任务测试钩子）修正后再验。
- 本单28个TS/TSX/生成器文件 eslint 0警告通过；之后改动的两份测试另精确复查通过。
- `check:persistence-compat`：41格式通过；两个受影响指纹已登记 dev-break，两个当前黄金样本已更新。
- `check:dead-code`、`check:ui-residue`、`check:surface`、`check:icons` 通过。dead-code报告已有unused/unlisted清单，非本单新增依赖，不将报告误写成eslint警告。
- `check:dependency-graph` 失败：并行 `creativeIntentExplanation.ts` 动态导入 `capabilities/applicationControlRegistry.ts` 形成值回边；不修改t167文件。
- `check:colors` 失败：未改的 `src/components/ui/styleTokens.ts:152` 使用未定义 `divide-border-dark/60`；不夹带修复。
- `check:assistant-capabilities` 按其原三子检查单Worker静音拆开：结构、1文件13项覆盖、31文件206项不变量均通过。
- `creativeIntentDomain.test.ts` + `videoEditBeatWorkerClient.test.ts`：2文件12项通过，公共原稿替身同步及Worker确认/取消/迟到错误不挂起。
- 显式本单文件 `git diff --check` 通过；未执行任何Git写操作。

## 本单文件清单

| 文件 | 本单改动 |
|---|---|
| `src/core/audioAnalysis/beatAnalysis.ts` | 新建分块谱通量、攻击检测与速度估计。 |
| `src/core/audioAnalysis/beatAnalysis.test.ts` | 固定合成精度、反相声道与异常输入夹具。 |
| `src/core/audioAnalysis/beatWorker.ts` | 新建离线程分块协议执行。 |
| `src/core/creativeIntent/beatSnap.ts` | 新建保留钉点、边界和姿态的节拍重定时。 |
| `src/core/creativeIntent/beatSnap.test.ts` | 验证最近帧、碰撞、候选过期和关闭还原。 |
| `src/core/creativeIntent/candidates.ts` | 接入吸附，并将节拍纳入候选输入身份。 |
| `src/core/videoEdit/document.ts` | 片段增加可选snapToBeat属性。 |
| `src/core/videoEdit/timedContent.ts` | 原marker增加类型和重音强度。 |
| `src/core/videoEdit/timedContent.test.ts` | 验证新marker字段跟随既有时间线编辑保留。 |
| `src/core/application-control/domains/videoEdit/videoEditBeatCapability.ts` | 新建本地算法能力声明。 |
| `src/core/application-control/domains/videoEdit/videoEditApplicationCapabilities.ts` | 仅新增节拍能力导入和目录项，与t165共享。 |
| `src/features/videoEdit/application/videoEditBeatAnalysis.ts` | 新建渲染分块、任务进度、取消与标记事务。 |
| `src/features/videoEdit/application/videoEditBeatAnalysis.test.ts` | 验证原子性、正式调用/读回、权限及保存恢复。 |
| `src/features/videoEdit/application/videoEditBeatWorkerClient.ts` | 新建Worker确认、转移、错误与释放客户端。 |
| `src/features/videoEdit/application/videoEditBeatWorkerClient.test.ts` | 验证逐块背压、取消与空闲期间Worker错误。 |
| `src/features/videoEdit/application/videoEditBeatCapability.ts` | 新建显式目标归属、保存验证和只保存恢复。 |
| `src/features/videoEdit/application/applicationDomain.ts` | 仅新增节拍处理器导入和注册分支，与t165共享。 |
| `src/features/videoEdit/application/videoEditDocumentAlgorithm.ts` | 仅将节拍纳入原子提交守卫，与t165共享。 |
| `src/features/videoEdit/application/videoEditClipProperties.ts` | 通用片段修改接收snapToBeat。 |
| `src/features/videoEdit/application/videoEditFields.ts` | 新字段名称、语义与合法默认读值。 |
| `src/features/videoEdit/application/videoEditMotionDraft.ts` | 仅输入节拍并保持原稿不吸附，与t165共享。 |
| `src/features/videoEdit/application/videoEditMotionDraft.test.ts` | 同步原稿替身并测试开关、候选与撤销。 |
| `src/features/application-control/creativeIntentDomain.test.ts` | 同步第二处原稿Worker替身。 |
| `src/features/videoEdit/engine/videoEditMotionWorker.ts` | 原稿对照整理显式关闭节拍吸附。 |
| `src/features/videoEdit/panels/VideoEditMotionControls.tsx` | 仅在已有分组增加UiSwitch，与t165共享。 |
| `src/features/videoEdit/timeline/useTimelineMenu.tsx` | 音频片段菜单增加分析节拍。 |
| `src/features/videoEdit/VideoEditApp.tsx` | 命令带右端增加现有形式的进度与取消。 |
| `scripts/generate-persistence-fixtures.ts` | 正式构造器黄金样本含节拍和片段开关。 |
| `tests/fixtures/persistence/document.video_edit/v2.json` | 更新当前剪辑黄金样本。 |
| `tests/fixtures/persistence/subtitle-manifest/v1.json` | 更新嵌入声音片段黄金样本。 |
| `src/core/persistence/schemaBaseline.json` | 仅更新两受影响格式指纹与dev-break审计。 |
| `docs/task/超级关键帧/任务/t164-beat.md` | 本单选型、设计自查、证据和交回范围。 |
| `docs/task/超级关键帧/02-实施拆分.md` | 仅更新第7节P4-1卡鼓点一行。 |
| `docs/rules/assistant-status.md` | 仅追加t164能力通路与未验边界。 |

## 待总管理者

- 本单与 t165 共同触及 `videoEditMotionDraft.ts`、应用能力注册及算法原子守卫；只改节拍输入、原稿对照和必要注册行，不碰错峰实现。
- 持久字段使 `document.video_edit` 与嵌入完整片段的 `subtitle-manifest` 指纹变化；只为这两种格式登记 dev-break，并用正式构造器更新其当前黄金样本。
- 不跑 Reality、实际 Electron、付费或 Git 写操作。真实音乐、标尺密度、开关与命令带视觉由总管理者统一验收。
