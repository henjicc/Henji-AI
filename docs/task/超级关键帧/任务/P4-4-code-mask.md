# t161：P4-4 代码参数与蒙版路径

状态：代码适配、五目录单测及专项门禁通过，待总管理者审查。代码参数、蒙版分别验收；无 Reality、开发实例、Git 写操作、SDK 修改或付费调用。总管理者负责审查、界面接线和 Git。本单不能登记整单交互验收完成。

## 设计与选型

- 复用已安装的 fit-curve 和 P1 `fitScalarCurve`，没有新增算法依赖、源码生成或源码执行。与另引入空间简化器相比，现有内核已保留 hard 事件及原生时间；适配层只将多通道结果降到共同线性基函数，并对全部原稿结点复核误差。连续分段线性差在结点取得极值，失准区间继续细分，不靠增加点数上限或放宽误差通过。
- 参数：数值、角度、颜色、点、范围、调色复用正式声明和值校验；离散参数输出 hold。custom 混合结构将连续字段共同拟合，离散字段切换设硬边界，沿原正式复合参数插值。连续源时间完全复用 `videoEditClipSourceTimeAt`（倒放采样包含 +1），NTSC、速度、修剪不自算另一套时钟。倒放离散切换增加切换前一帧，保住正式帧语义；整数帧之间仍沿原源时间hold，不宣称反向hold拥有不存在的右连续插值。
- 路径：一个闭合三次贝塞尔轮廓，显式 pointIds 对应顺序；新增正式 `pathAnimation`，源微秒可带小数，linear/hold。拒绝点数、点对应顺序、绕向变化和面积退化；孔洞须为独立 subtract 形状。三点 Gauss 精确积分三次路径有向面积，线性形变面积为二次式，检查其内部极值，不能只看端点。**这不等于完整自交检测**；有向面积保持仍可能出现局部自交，复杂拓扑需要后续加强，不宣称任意轮廓安全。
- 路径求值进入正式 Worker 预览/导出共用入口，先变形再跟踪。静态图片/图形/代码的分析时钟仍可能为0，但路径有独立的正式片段源时钟，不冻结动画。缓存按求值后几何复用，不把全部路径关键帧带入栅格缓存键。
- 原稿和候选仅当前调用内存数据，应用输出原生曲线/路径；应用走正式剪辑事务和保存链。候选以 WeakMap 保存不可被预览对象篡改的提交值，当前片段/帧率/尺寸基态不一致拒绝。旧曲线落在示范外时拒绝，要求完整选择，不默默删范围外关键帧。
- 没有新增数量上限。拟合库沿原256采样工作批检查取消；输入按单个已确认take传入，尚未接现有分页Worker录制链，大记录内存与真实手感未验。

## 覆盖分级与入口

能力增量：蒙版正式数据增加动画；原 `video_edit.effect.mask` schema、描述、通用读取/写入自动覆盖，新增公共结果测试。代码输出沿原 `code_curves`，没有新增写值工具。`prepareVideoEditCodeParameterAnimation` / `prepareVideoEditMaskPathAnimation` / `applyVideoEditPropertyAnimation` 是应用层准备与提交接口；**整理算法尚未登记为可发现公共算法，也没有接入原稿录制和候选面板**，不能声称助手能自主录制整理两类属性。总管理者需协调共用协议的所有者接线。

按 assistant-status 第零节，此次蒙版通用写入新增正式路径动画，应由总管理者在共享助手台账登记，并保留整理/录制未接通的欠账。本单未修改不在所有权内的助手台账和共享能力目录。

## 界面需求

不新增独立面板，不修改 `src/features/creativeIntent/ui/**`、讲解文件或其他任务所有文件。现有 motion/layout 候选模型只承载位姿/静态布局，无法直接展示属性/path候选；需总管理者在原入口增加参数/路径目标选项并适配现有候选呈现，不另造界面。还需把动画路径控制柄按当前源时刻求值，并将逐帧编辑写到对应路径关键帧。当前静态编辑函数对动画路径明确拒绝，避免静默只改静态 points 而画面不变。截图/播放/路径控制柄视觉一致性和录制接线未验。

## 持久化

影响 `document.video_edit` 与嵌套 clip schema 的 `subtitle-manifest`，按用户授权运行 dev-break 登记。剪辑 v2 黄金样本使用正式形状构造器/schema 增加动画路径。字幕清单正式解析再序列化与原文件相同：soundClips是声音，无合法画面蒙版，不捏造动画声音样本。保持开发期不兼容，不新增迁移。

## 设计自查

1. **助手只凭名称和说明能否用对？** 蒙版通用属性说明源微秒、闭合轮廓、点顺序、插值和拒绝条件；代码参数沿正式声明。公共整理算法尚未接线，不能说全流程已能用对。
2. **能否 AI 先做、人只确认？** 适配器先拟合并复核约束，候选应用前允许审查；无需人手删密集点。录制/候选UI和公共算法仍需接入现有入口。
3. **产物能否直接流进其他工作区？** 产物是原生参数曲线/正式蒙版，保存与预览/导出消费同一契约；媒体沿原导出流转。真实导出和跨工作区接收本单不运行，不冒充已验收。

## 检查记录

按 testing.md L2：共享 core/持久契约/多消费者变更，需要双工程类型、文件eslint与专项门禁；用户明确要求五目录零失败，分目录单worker运行。实际结果收尾回填。首轮新增Worker蒙版测试错用100px而非实际蒙版尺寸，已改为结果尺寸取样；领域测试的默认参数构造器入参、公共测试工具签名及冷缓存Worker边界替身也已修正。首次扩充描述超过公共1000字符契约，已改为单条精简说明，不放宽协议上限。

| 检查 | 结果 |
|---|---|
| `npx vitest run src/core/videoEdit --silent --maxWorkers=1 --minWorkers=1` | 69文件、517通过、0失败 |
| `src/core/creativeIntent` 同参数 | 初轮16文件137通过；末次codeParamAdapter/maskPathAdapter精确复验增加混合参数与倒放路径，共8通过，目录去重139通过、0失败 |
| `src/features/videoEdit/application` 同参数，排除已单跑的codeParameters | 77文件621通过、1项既有性能基准跳过；最后codeParameters 11通过，目录合计632通过、0失败 |
| `electron/main/services/documents` 同参数 | 12文件65通过、11项原有native测试默认跳过、0失败；没有运行原生专项 |
| `src/core/persistence` 同参数 | 1文件89通过、0失败；黄金样本/schema/包相关读写随正式目录验证 |
| 五目录去重合计 | 1442通过、12跳过、0个未解决失败；不以跳过冒充通过 |
| 共享渲染入口精确测试 | videoEditCodeSources 22、videoEditTrackResults 5、videoEditEffectMasks 2，合计29通过 |
| `npx tsc -p tsconfig.json --noEmit` | 通过，末次已包含全部代码/测试改动 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| 本任务16个TS文件 ESLint | 通过；后续改动6文件已精确补验，无裸any/新增UI控件 |
| `check:dependency-graph` | 通过，2静态SCC、0冻结跨层边、363跨feature非index边，无新基线例外 |
| `check:dead-code` | 退出0，1存量未使用文件、0存量未使用依赖；既有unlisted/unresolved仅诊断，未改基线 |
| `check:ui-residue` | 通过 |
| `check:persistence-compat` | 两格式dev-break后41格式通过 |
| `check:assistant-capabilities` | 分解为原三子门禁串行静音执行：structure通过、coverage 13通过、invariants 31文件206通过，0失败 |
| 精确文件 `git diff --check` | 通过，仅存量LF/CRLF提示；新文件另经eslint/tsc |

M01/M02与M03/M04采用确定性输入，证明稀疏拟合、停顿、硬点、参数域、源时间、倒放、修剪和拒绝条件；不是完整人类留出/性能验收。代码与蒙版应用各自有候选隔离/历史/持久断言，蒙版另有正式公共读写和保存重开。实际应用入口复查过期候选、重复提交、范围外旧曲线，静态路径编辑保护；没有扩大成全项目审计。最后路径适配器增加严格输入schema，拒绝holes/closed等未声明结构字段；对应3项精确测试与2文件eslint再次通过，双工程类型补验，未重跑已有效的其他目录。

## 实际文件范围

- `src/core/creativeIntent/propertyAdapter.ts`：共用多通道事件/钉点拟合和误差复核。
- `src/core/creativeIntent/codeParamAdapter.ts` / `.test.ts`：代码参数适配和M01/M02测试。
- `src/core/creativeIntent/maskPathAdapter.ts` / `.test.ts`：蒙版适配和M03/M04测试。
- `src/core/videoEdit/maskPathAnimation.ts` / `.test.ts`：正式schema、绕向/退化校验、源时间求值。
- `src/core/videoEdit/effectMasks.ts`：正式形状持久字段及静态编辑保护。
- `src/features/videoEdit/application/videoEditPropertyAnimation.ts`：只读候选准备、过期校验与一次提交。
- `src/features/videoEdit/application/videoEditCodeParameters.ts` / `.test.ts`：唯一参数曲线写入口、两类领域保存/撤销/公共读写测试。
- `src/features/videoEdit/application/videoEditFields.ts`：原mask字段说明增补动画契约。
- `src/features/videoEdit/engine/videoEditEffectMasks.ts` / `.test.ts`：正式预览/导出蒙版分派、静态分析时钟测试。属于渲染收口必要扩展。
- `src/features/videoEdit/engine/videoEditCodeSources.ts`：正式蒙版源时钟传递，属于渲染收口必要扩展。
- `src/features/videoEdit/engine/videoEditCodeSources.test.ts`：证明静态代码画面缓存不冻结动画蒙版。
- `src/core/persistence/schemaBaseline.json`：仅两项格式指纹和开发期登记。
- `tests/fixtures/persistence/document.video_edit/v2.json`：正式动画路径黄金样本。
- `docs/task/超级关键帧/02-实施拆分.md`：仅P4-4状态行。
- 本任务记录。
