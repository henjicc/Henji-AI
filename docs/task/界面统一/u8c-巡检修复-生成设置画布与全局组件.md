# u8c 巡检修复——生成、设置、画布与全局组件

## 范围与约束

- 当前 worktree：`D:/VibeCode/henji-wt-u8c`，分支 `codex/u8c`；起始工作区干净。
- 来源：u7 全局巡检的本批 17 条违规和 K01/K02/K06/K07。只修相关共享实现与直接调用方。
- 未执行任何 Git 写操作，未修改 SDK 文件，未启停开发实例，未运行全量 Reality 或付费调用。
- 本目录没有指定的 u8 任务总览或 u8c 行；不创建额外总览、不改其他任务行。
- 覆盖分级 C0：仅展示、语言和巡检夹具修复，未增业务状态、操作、权限或 MCP 能力；不改变助手通路台账。

## 设计自查

1. 助手只凭名称和说明能否用对？能；原业务名称、参数及调用链保持不变，内部技能路由说明保留在技能定义，仅用户展示简化。
2. 能否 AI 先做、人只确认？能；原布局候选、生成及优化算法保持原入口，界面只修选择与确认结构，不增加从零填写流程。
3. 产物能否直接流进其他工作区？能；原发送到剪辑/画布通路保持，仅隐藏当前不可执行的上下文菜单组，目的地选择入口仍可用。

## 选型与设计决定

- 全部复用既有 React、UiFormRow、UiGroup、Dropdown、UiSegmented、UiToast 和 Virtuoso；没有新增依赖或另做控件。
- 固定列选择现有 72/96/120 档：遮罩 72、模型筛选/优化/画布钉住 96、生成参数与复杂设置 120；字段填列、固有胶囊开关从左排列。
- 分段是当前值，选中使用 bg-raised + text-text1；更多选择保留全部数据并改下拉，不设产品数量上限。
- 系统通知用消息键和参数保存，统一在 UiToast 解析；既有字符串回调用 notificationText 在发出反馈时翻译。用户文字与外部错误原文不做自动翻译。
- 技能用户用途投影与内部路由说明分开，内部技能文件及能力注册没有改动。
- 可读组件版本过滤在第三方许可显示层共享，原始许可清单与源码获取地址保留。

## 逐条处理

| 编号 | 处理 | 说明 |
|---|---|---|
| V05 | 已修 | 助手模型角色使用无背景 UiGroup + UiFormRow，详情保持按需展开。 |
| V13 | 已修 | 共享参数组浮层收为同宽标量行。 |
| V14 | 已修 | 供应商、类型、功能三组筛选改下拉行；键盘事件不会误选模型。 |
| V15 | 已修 | 遮罩绘制/擦除复用整体 UiSegmented。 |
| V16 | 已修 | 画笔大小、硬度使用同宽行，滑杆与读数同列。 |
| V17 | 已修 | 技能记录项自行绘制相邻边界，首项无上边界。 |
| V18 | 已修 | 整组不可执行时隐藏剪辑上下文项，保留发送到剪辑入口。 |
| V19 | 已修 | 优化供应商和模型改为两条统一下拉行。 |
| V20 | 已修 | 添加供应商统一标签列，说明进入标签帮助。 |
| V21 | 已修 | 主题导入导出动作对齐上方控件列。 |
| V22 | 已修 | 任务、价格、输入分组统一列宽；折叠策略用下拉。 |
| V24 | 已修 | 更多参数共用行布局，分段开关填满控件列。 |
| V25 | 已修 | 画布钉住节点使用共享面板行。 |
| V26 | 已修 | 前置条件不足时保留空态，隐藏全部不可执行动作。 |
| V35 | 已修 | 用户指令常驻提示仅保留长期偏好与工作习惯。 |
| V36 | 已修 | 图片和剪辑技能用途不再含内部路由技能名。 |
| V37 | 已修 | 关于、许可列表及详情仅显示可读版本；否则显示未标版本。 |
| K01/K02 | 已修 | 分段最多五项，中性抬起底 + 强文字；更大集合改完整下拉。 |
| K06 | 已修 | 空态场景清理隔离历史，断言存储及视图均为空；拒绝真实资料。 |
| K07 | 已修 | 共享提示显示入口解析系统消息键；直接通知调用点及样张迁入 i18n。 |

## 改动文件

共 70 个文件（包括本任务记录），逐个说明如下。

| 文件 | 说明 |
|---|---|
| `.claude/skills/henji-ui-surface/SKILL.md` | 同步 Codex 的分段、复用及通知语言规则。 |
| `.codex/skills/henji-ui-surface/SKILL.md` | 统一五项分段、中性选中、复用表与通知语言自查的规则说明。 |
| `docs/task/界面统一/u8c-巡检修复-生成设置画布与全局组件.md` | 记录本批逐条处理、设计自查、完整文件范围、检查及逐张截图结论。 |
| `scripts/lib/uiInspection.cjs` | 等待后台启动结果后划定场景日志区间，启动失败仍保留在启动日志。 |
| `scripts/lib/uiInspectionSceneCatalogGeneration.cjs` | 生成空态仅清理隔离历史并断言；关于页等待实际可用的 Electron 条目。 |
| `scripts/lib/uiInspectionSceneCatalogGeneration.test.cjs` | 验证遗留夹具历史被清空，并拒绝清理真实资料。 |
| `scripts/lib/uiInspectionSceneGeneration.cjs` | 遮罩巡检选择器同步为共享分段的 radio 角色。 |
| `scripts/lib/uiInspectionSceneImageEditLayoutDraft.cjs` | 证据输出改到 worktree 私有 .tmp，避免经 junction 写入主仓。 |
| `scripts/lib/uiInspectionSceneImageEditPaintTargets.cjs` | 共享画笔巡检选择器同步为 radio 角色。 |
| `scripts/lib/uiSurfaceGrammar.cjs` | 同步 S1 文案，并检测静态分段选项超过五项。 |
| `scripts/lib/uiSurfaceGrammar.test.cjs` | 验证五项分段与六项下拉的门禁边界。 |
| `src/components/MediaGenerator/components/ModelSelectorPanel.test.tsx` | 验证三组完整筛选及下拉 Enter 不触发模型选择。 |
| `src/components/MediaGenerator/components/ModelSelectorPanel.tsx` | 将三组筛选收为统一下拉表单行，并避免下拉快捷键误选模型。 |
| `src/components/MediaGenerator/components/ParameterPanel.tsx` | 更多参数浮层改为统一单列表单行，保留完整参数与媒体区域。 |
| `src/components/MediaGenerator/components/PromptOptimizationProfilesPanel.tsx` | 供应商、模型使用同一标签列的两条下拉行。 |
| `src/components/Settings/about/LicenseViewerDialog.tsx` | 许可列表及详情复用可读版本过滤，不再展示构建哈希。 |
| `src/components/Settings/about/thirdPartyLicenses.test.ts` | 验证发布版、四段版本、构建后缀及裸哈希的显示规则。 |
| `src/components/Settings/about/thirdPartyLicenses.ts` | 提供可读发布版本的唯一显示过滤函数。 |
| `src/components/Settings/components/SettingsDependentRows.tsx` | 新增有限的 aligned 布局选项，让生成设置从属行保持控件左缘。 |
| `src/components/Settings/components/SettingsSegmented.tsx` | 声明设置页继续重导出共享分段实现。 |
| `src/components/Settings/sections/AboutSection.tsx` | 关于页组件版本使用共享过滤，无可读版本时显示占位。 |
| `src/components/Settings/sections/AgentModelProfilesSection.test.tsx` | 详情查询改为共享分组容器，保留验证失败后的旧结果检查。 |
| `src/components/Settings/sections/AgentModelProfilesSection.tsx` | 角色配置去掉背景块，改为统一表单行并保留按需详情。 |
| `src/components/Settings/sections/AgentSkillsSection.tsx` | 技能记录之间加全宽分隔；图片、剪辑技能只展示用户用途。 |
| `src/components/Settings/sections/BottomPanelSection.tsx` | 长文本折叠策略改下拉，从属滑块对齐控件列。 |
| `src/components/Settings/sections/DisplaySection.tsx` | 价格设置从属项使用对齐布局。 |
| `src/components/Settings/sections/LlmProviderDialog.tsx` | 供应商表单统一标签列，将接入方式和协议说明移到标签帮助。 |
| `src/components/Settings/sections/PromptOptimizationSection.tsx` | 下拉填满继承的控件列。 |
| `src/components/Settings/sections/ThemeSection.tsx` | 主题导入导出动作放进同宽控件列。 |
| `src/components/Settings/tabs/WorkspaceTab.tsx` | 生成设置的任务与输入分组统一 120 档标签列。 |
| `src/components/params/ParamField.test.tsx` | 验证浮层行布局保留独立媒体区，并继承标签列宽。 |
| `src/components/params/ParamField.tsx` | 在浮层上下文中将标量标签与控件拼成共享 UiFormRow。 |
| `src/components/params/ParamGroupTrigger.tsx` | 所有参数组浮层使用统一行语法，媒体区域保持独立。 |
| `src/components/params/paramPanelRows.ts` | 集中声明参数浮层的行布局上下文。 |
| `src/components/ui/Dropdown.test.ts` | 在已有占位用例中覆盖非空集合未选中时的本地化提示。 |
| `src/components/ui/Dropdown.tsx` | 有选项但未选择时显示本地化占位。 |
| `src/components/ui/NumberInput.tsx` | 固定表单列中让外层包装也填满，消除内部宽度失效。 |
| `src/components/ui/UiSegmented.test.tsx` | 在原交互回归中覆盖中性选中与六项完整下拉。 |
| `src/components/ui/UiSegmented.tsx` | 六项及以上自动使用完整下拉，不裁剪或限制选项数量。 |
| `src/components/ui/UiToast.test.tsx` | 验证消息键随语言切换重译，用户原文保持原样。 |
| `src/components/ui/UiToast.tsx` | 统一在显示入口解析消息键，语言切换时更新已有系统提示。 |
| `src/components/ui/formRowLabel.ts` | 说明分段与胶囊开关各自的填列规则。 |
| `src/components/ui/layout.tsx` | 固定标签列的控件默认从左缘排列，保留固有开关几何。 |
| `src/components/ui/primitives.tsx` | 分段及分段开关使用中性抬起选中；分段开关填满固定控件列。 |
| `src/contexts/NotificationContext.tsx` | 全局通知保留系统消息键直到显示，不提前冻结语言。 |
| `src/features/audioEdit/AudioEditApp.tsx` | 口播成功、导出、恢复及失败兜底提示迁入通知 i18n。 |
| `src/features/cameraStage/CameraStageApp.tsx` | 镜头工作区操作失败兜底提示迁入通知 i18n。 |
| `src/features/canvas/ui/CanvasTidyPanel.tsx` | 钉住节点使用 96 档标签列的共享表单行。 |
| `src/features/devGallery/gallerySections.tsx` | 样张中的已保存、导出失败、已复制使用共享系统提示键。 |
| `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.test.tsx` | 验证无可执行动作时只保留空态，并同步保存重试断言。 |
| `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.tsx` | 前置条件不足或动作全部不可用时隐藏底部动作带，保留恢复和取消入口。 |
| `src/features/maskEditor/MaskEditorInspector.test.tsx` | 同步共享分段角色与中文初始化，保留大小和硬度交互验证。 |
| `src/features/maskEditor/MaskEditorInspector.tsx` | 绘制擦除改整体分段；大小与硬度改同宽参数行。 |
| `src/features/videoEdit/VideoEditApp.tsx` | 导入完成反馈迁入通知 i18n。 |
| `src/features/videoEdit/panels/VideoEditCanvasSendDialog.tsx` | 发送到画布及保存反馈迁入通知 i18n。 |
| `src/features/videoEdit/panels/VideoEditEffectsLibraryPanel.test.tsx` | 同步选区失败反馈的系统消息键断言。 |
| `src/features/videoEdit/panels/VideoEditEffectsLibraryPanel.tsx` | 选区不可用提示改为共享系统消息键。 |
| `src/features/videoEdit/panels/VideoEditSendMenu.test.tsx` | 验证全组不可执行时不显示菜单项，发送入口仍保留。 |
| `src/features/videoEdit/panels/videoEditSendActions.ts` | 全组不可执行时隐藏剪辑上下文项；发送反馈迁入通知 i18n。 |
| `src/i18n/locales/en-US/models.json` | 补齐模型供应商、类型筛选的中英文标签。 |
| `src/i18n/locales/en-US/settings.json` | 补齐内置技能用途、简化用户指令提示和未标版本占位。 |
| `src/i18n/locales/en-US/ui.json` | 登记通知、遮罩控件、优化筛选标签与未选择占位的中英文文案。 |
| `src/i18n/locales/zh-CN/models.json` | 补齐模型供应商、类型筛选的中英文标签。 |
| `src/i18n/locales/zh-CN/settings.json` | 补齐内置技能用途、简化用户指令提示和未标版本占位。 |
| `src/i18n/locales/zh-CN/ui.json` | 登记通知、遮罩控件、优化筛选标签与未选择占位的中英文文案。 |
| `src/i18n/notifications.ts` | 统一定义系统消息键、参数及旧字符串回调的即时翻译入口。 |
| `src/services/paidApproval.ts` | 自动批准提示保留系统消息键，并本地化预计或实际计费反馈。 |
| `src/services/paidApprovalUi.test.ts` | 同步自动批准反馈的系统消息键断言，不发起真实调用。 |
| `src/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand.ts` | 视频、复刻音频、示例音频的校验失败提示迁入通知 i18n。 |
| `src/workspaces/ToolboxWorkspace.tsx` | 最近作品打开失败提示迁入通知 i18n。 |

## 验证

- 按 testing.md L2：共享 UI 布局、选中外观、键盘及通知消息契约；只运行精确测试、渲染层 tsc 与相关静态门禁。无 core/main 修改，未跑主进程 tsc 或 main-imports。
- 精确 Vitest 26 个文件、150 条用例最终全部通过；已有失败期日志保留，以下按每个文件最后一次有效结果列出。每条缺陷最多扩展一条回归，无组件快照。

| 精确测试文件（使用 npx vitest run 显式文件 + --silent） | 用例 | 最终结果日志 |
|---|---:|---|
| `src/components/MediaGenerator/components/ModelSelectorPanel.test.tsx` | 1 通过 | `.tmp/u8c-validation/.u8c-model-test.log` |
| `src/components/MediaGenerator/components/ParameterPanel.catalog.test.tsx` | 5 通过 | `.tmp/u8c-validation/.u8c-tests.log` |
| `src/components/Settings/about/thirdPartyLicenses.test.ts` | 5 通过 | `.tmp/u8c-validation/.u8c-about-final-tests.log` |
| `src/components/Settings/sections/AboutSection.test.tsx` | 4 通过 | `.tmp/u8c-validation/.u8c-about-final-tests.log` |
| `src/components/Settings/sections/AgentModelProfilesSection.test.tsx` | 2 通过 | `.tmp/u8c-validation/.u8c-inspection-fixes-tests.log` |
| `src/components/Settings/sections/AgentSkillsSection.test.tsx` | 9 通过 | `.tmp/u8c-validation/.u8c-skills-test.log` |
| `src/components/Settings/sections/AgentUserInstructionsSection.test.tsx` | 2 通过 | `.tmp/u8c-validation/.u8c-tests.log` |
| `src/components/Settings/sections/LlmProviderDialog.test.tsx` | 10 通过 | `.tmp/u8c-validation/.u8c-tests.log` |
| `src/components/Settings/sections/ThemeSection.test.tsx` | 4 通过 | `.tmp/u8c-validation/.u8c-tests.log` |
| `src/components/params/ParamField.test.tsx` | 7 通过 | `.tmp/u8c-validation/.u8c-inspection-fixes-tests.log` |
| `src/components/ui/Dropdown.test.ts` | 13 通过 | `.tmp/u8c-validation/.u8c-lasttests.log` |
| `src/components/ui/NumberInput.test.tsx` | 11 通过 | `.tmp/u8c-validation/.u8c-inspection-fixes-tests.log` |
| `src/components/ui/UiSegmented.test.tsx` | 1 通过 | `.tmp/u8c-validation/.u8c-lasttests.log` |
| `src/components/ui/UiToast.test.tsx` | 6 通过 | `.tmp/u8c-validation/.u8c-tests.log` |
| `src/components/ui/layout.test.tsx` | 9 通过 | `.tmp/u8c-validation/.u8c-layout-final.log` |
| `src/features/audioEdit/AudioEditApp.subscription.test.tsx` | 1 通过 | `.tmp/u8c-validation/.u8c-moretests.log` |
| `src/features/cameraStage/CameraStageApp.test.tsx` | 3 通过 | `.tmp/u8c-validation/.u8c-moretests.log` |
| `src/features/devGallery/uiGalleryCoverage.test.ts` | 3 通过 | `.tmp/u8c-validation/.u8c-moretests.log` |
| `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.test.tsx` | 10 通过 | `.tmp/u8c-validation/.u8c-retests2.log` |
| `src/features/maskEditor/MaskEditorInspector.test.tsx` | 2 通过 | `.tmp/u8c-validation/.u8c-retests2.log` |
| `src/features/videoEdit/panels/VideoEditCanvasSendDialog.test.tsx` | 1 通过 | `.tmp/u8c-validation/.u8c-moretests.log` |
| `src/features/videoEdit/panels/VideoEditEffectsLibraryPanel.test.tsx` | 10 通过 | `.tmp/u8c-validation/.u8c-lasttests.log` |
| `src/features/videoEdit/panels/VideoEditSendMenu.test.tsx` | 3 通过 | `.tmp/u8c-validation/.u8c-retests.log` |
| `src/services/paidApprovalUi.test.ts` | 22 通过 | `.tmp/u8c-validation/.u8c-tests.log` |
| `src/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand.test.ts` | 2 通过 | `.tmp/u8c-validation/.u8c-moretests.log` |
| `src/workspaces/ToolboxWorkspace.test.tsx` | 4 通过 | `.tmp/u8c-validation/.u8c-moretests.log` |

| 检查 | 结果 | 证据 |
|---|---|---|
| node --test scripts/lib/uiSurfaceGrammar.test.cjs scripts/lib/uiInspectionSceneCatalogGeneration.test.cjs | 9 通过 | .tmp/u8c-validation/.u8c-node.log |
| node --test scripts/lib/uiInspection.test.cjs scripts/lib/uiInspectionSceneCatalogGeneration.test.cjs | 42 通过，与上行空态用例重复 1 条 | .tmp/u8c-validation/.u8c-inspection-node.log |
| npx tsc -p tsconfig.json --noEmit | 通过，无错误输出 | .tmp/u8c-validation/.u8c-tsc.log |
| 改动 TS/TSX 显式文件 ESLint，--report-unused-disable-directives --max-warnings 0 | 通过，无错误或告警 | .tmp/u8c-validation/.u8c-eslint.log；.u8c-about-eslint.log |
| npm run check:surface | 通过，语法错误 0、启发式告警 0 | .tmp/u8c-validation/.u8c-surface.log |
| npm run check:colors | 通过 | .tmp/u8c-validation/.u8c-colors.log |
| npm run check:icons | 通过 | .tmp/u8c-validation/.u8c-icons.log |
| npm run check:ui-residue | 通过 | .tmp/u8c-validation/.u8c-residue.log |
| npm run check:skill-sync | 通过，两份 skill 已同步 | .tmp/u8c-validation/.u8c-skill-final.log |
| git diff --check（只读） | 通过；只有现有 CRLF 配置提示 | 终端输出 |
| npx electron-vite build | 通过，最终构建后只修改规则及任务记录 | .tmp/u8c-validation/.u8c-bundle-final.log |
| npm run gen:licenses | 非严格生成成功，1093 组件/548 许可；FFmpeg 未就绪与 jsonify 缺少全文警告 | .tmp/u8c-validation/.u8c-licenses.log |
| 四批受影响 ui:tour | 最终均 0 失败；场景区间 browserErrors/logErrors 均 0 | 下述各目录 index.md/evidence.json |

- 初轮单测因测试初始化语言、查询容器及消息/角色旧断言失败；更新对应替身和断言后精确重跑通过。初轮 ui:tour 有 10 个失败：遮罩选择器旧角色、本 worktree 缺少 FFmpeg 运行文件、启动日志端口冲突与历史夹具干扰；保留在 .ui-tour/u8c-20261013 和 .tmp/u8c-validation/.u8c-tour.log，不作为最终证据。
- 真实 Electron 截图为用户明确要求，且共享布局视觉结论不能仅靠 DOM 单测证明，按 testing.md 真实样张升级条件执行。新产物直接用 npx electron-vite build；electron:bundle 的锁在 junction node_modules，并可能写 SDK，因此未使用。构建输出在本 worktree 的 out。
- 从主仓只读复制已存在的 FFmpeg current.json 与 bin 到本 worktree 的忽略目录，支持巡检历史音频波形；没有下载、安装或改变依赖。完整原生包就绪标志/许可材料仍缺，因此许可生成不包含 FFmpeg。该环境不用于媒体运行时全面验收。
- 本机系统核对 DISPLAY1 为副屏 (2560,0)，DISPLAY2 为主屏；巡检落点 (2561,1)。命令尺寸为 1440x900，实际 PNG 是 DPI 缩放后的 2160/2162x1353 像素；画布场景会按既有逻辑调整宿主尺寸。

## 截图与目视结论

- 有效截图 116 张：主矩阵 106 张中原关于页 2 张由最新补拍替换，另有 Seedance 8 张和英文 2 张。全部由正式 ui:tour 真实 Electron 捕获，无浏览器替代。
- 原始 PNG 未改动；复核时用 .tmp/u8c-review 的接触表逐张查看全部原图内容，并直接打开关键界面原图。以下每个文件均已目视检查对齐、间距、裁切及层级。
- 最新关于页明确保留 Chromium 四段发布版本，裸哈希组件显示未标版本；以前主矩阵中的关于页图片不作为该结论证据。
- 各目录 index.md 为截图索引，evidence.json 保留运行时和日志证据。场景运行区间有 GPU/CPU 回退、缩略图/预览加载及主动失败注入告警；未声称 GPU 性能或完整媒体链验收通过。

复现命令：

```powershell
npm run ui:tour -- --only generation-empty --only generation-model-panel --only generation-midjourney-settings --only generation-gpt-mask-editor --only generation-optimize-context --only 'settings-about 设置' --only settings-provider-manager --only settings-agent-skills --only settings-workspace --only settings-theme --only u6-assistant-details --only generation-review-history --only canvas-tidy --only image-edit-layout-draft-node-panel --theme-preset graphite,paper --size 1440x900 --out .ui-tour/u8c-final-20261013
npm run ui:tour -- --only selection-generation-bar-seedance --theme-preset graphite,paper --size 1440x900 --out .ui-tour/u8c-seedance-20261013
npm run ui:tour -- --only f2-paid-english --theme-preset graphite --size 1440x900 --out .ui-tour/u8c-english-20261013
npm run ui:tour -- --only 'settings-about 设置' --theme-preset graphite,paper --size 1440x900 --out .ui-tour/u8c-about-20261013
```

| 截图路径（相对本 worktree） | 逐张目视结论 |
|---|---|
| `.ui-tour/u8c-final-20261013/graphite/1440x900-canvas-tidy-01-rough.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-canvas-tidy-02-align.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-canvas-tidy-03-grid.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-canvas-tidy-03a-pin-options.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-canvas-tidy-04-pinned.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-canvas-tidy-05-applied.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-canvas-tidy-06-undo.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-canvas-tidy.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-empty.png` | 空态没有遗留失败条目，中心提示和底栏间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-gpt-mask-editor.png` | 绘制/擦除中性分段，大小和硬度同列，画面未被面板裁切。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-midjourney-settings.png` | 数值包装填满控件列，标量行左缘和宽度统一。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-model-panel.png` | 三组下拉标签齐列、触发器同宽，模型列表没有遮挡。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-optimize-context.png` | 供应商与模型两行同宽，标签与控件左缘一致。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-audio-hover.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-clear-confirm.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-clear-dialog.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-context-menu.png` | 右键菜单不再显示全组禁用的剪辑上下文项，其他动作对齐正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-date-picker.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-failed-hover.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-filter-menu.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-latest.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-more-menu.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-search-empty.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-search.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-top.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-type-hover.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-type-video.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history-video.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-generation-review-history.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-01.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-02.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-03.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-04.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-05.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-06.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-07.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-08.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-09.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-10.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-11.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel-step-12.png` | 失败状态保留结果说明，前置条件不足时没有整组不可执行动作；面板未裁切。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-image-edit-layout-draft-node-panel.png` | 失败状态保留结果说明，前置条件不足时没有整组不可执行动作；面板未裁切。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-settings-agent-skills.png` | 相邻技能记录有边界，首项无多余上边界，用途不含内部技能 id。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-settings-provider-manager.png` | 供应商字段统一列宽，说明没有另占常驻行。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-settings-theme-accent-contrast.png` | 主题动作与控件左缘齐列，分段选中与强调色主动作可区分。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-settings-theme-preset.png` | 主题动作与控件左缘齐列，分段选中与强调色主动作可区分。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-settings-theme-switched-preset.png` | 主题动作与控件左缘齐列，分段选中与强调色主动作可区分。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-settings-theme.png` | 主题动作与控件左缘齐列，分段选中与强调色主动作可区分。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-settings-workspace.png` | 任务、价格、输入控件齐列，固有开关从控件左缘排列。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-u6-assistant-details-known-usage.png` | 模型角色无背景块；展开信息及验证按钮与控件列对齐，长期指令提示简洁。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-u6-assistant-details-unknown-usage.png` | 模型角色无背景块；展开信息及验证按钮与控件列对齐，长期指令提示简洁。 |
| `.ui-tour/u8c-final-20261013/graphite/1440x900-u6-assistant-details.png` | 模型角色无背景块；展开信息及验证按钮与控件列对齐，长期指令提示简洁。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-canvas-tidy-01-rough.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-canvas-tidy-02-align.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-canvas-tidy-03-grid.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-canvas-tidy-03a-pin-options.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-canvas-tidy-04-pinned.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-canvas-tidy-05-applied.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-canvas-tidy-06-undo.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-canvas-tidy.png` | 钉住节点下拉与参数齐列，展开选项、候选/应用/撤销状态无越界。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-empty.png` | 空态没有遗留失败条目，中心提示和底栏间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-gpt-mask-editor.png` | 绘制/擦除中性分段，大小和硬度同列，画面未被面板裁切。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-midjourney-settings.png` | 数值包装填满控件列，标量行左缘和宽度统一。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-model-panel.png` | 三组下拉标签齐列、触发器同宽，模型列表没有遮挡。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-optimize-context.png` | 供应商与模型两行同宽，标签与控件左缘一致。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-audio-hover.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-clear-confirm.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-clear-dialog.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-context-menu.png` | 右键菜单不再显示全组禁用的剪辑上下文项，其他动作对齐正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-date-picker.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-failed-hover.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-filter-menu.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-latest.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-more-menu.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-search-empty.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-search.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-top.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-type-hover.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-type-video.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history-video.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-generation-review-history.png` | 历史对应过滤/悬停/清空状态无异常裁切，菜单层级和列表间距正常。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-01.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-02.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-03.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-04.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-05.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-06.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-07.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-08.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-09.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-10.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-11.png` | 该候选/钉住/应用/撤销状态面板列宽和间距正常，背景与动作层级可辨。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel-step-12.png` | 失败状态保留结果说明，前置条件不足时没有整组不可执行动作；面板未裁切。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-image-edit-layout-draft-node-panel.png` | 失败状态保留结果说明，前置条件不足时没有整组不可执行动作；面板未裁切。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-settings-agent-skills.png` | 相邻技能记录有边界，首项无多余上边界，用途不含内部技能 id。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-settings-provider-manager.png` | 供应商字段统一列宽，说明没有另占常驻行。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-settings-theme-accent-contrast.png` | 主题动作与控件左缘齐列，分段选中与强调色主动作可区分。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-settings-theme-preset.png` | 主题动作与控件左缘齐列，分段选中与强调色主动作可区分。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-settings-theme-switched-preset.png` | 主题动作与控件左缘齐列，分段选中与强调色主动作可区分。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-settings-theme.png` | 主题动作与控件左缘齐列，分段选中与强调色主动作可区分。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-settings-workspace.png` | 任务、价格、输入控件齐列，固有开关从控件左缘排列。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-u6-assistant-details-known-usage.png` | 模型角色无背景块；展开信息及验证按钮与控件列对齐，长期指令提示简洁。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-u6-assistant-details-unknown-usage.png` | 模型角色无背景块；展开信息及验证按钮与控件列对齐，长期指令提示简洁。 |
| `.ui-tour/u8c-final-20261013/paper/1440x900-u6-assistant-details.png` | 模型角色无背景块；展开信息及验证按钮与控件列对齐，长期指令提示简洁。 |
| `.ui-tour/u8c-seedance-20261013/graphite/1440x900-selection-generation-bar-seedance-bar.png` | 底栏单行和模式下拉位置正常；模式选项未裁切。 |
| `.ui-tour/u8c-seedance-20261013/graphite/1440x900-selection-generation-bar-seedance-mode-menu.png` | 底栏单行和模式下拉位置正常；模式选项未裁切。 |
| `.ui-tour/u8c-seedance-20261013/graphite/1440x900-selection-generation-bar-seedance-more-open.png` | 更多参数两行同宽且中性分段填列，无裁切。 |
| `.ui-tour/u8c-seedance-20261013/graphite/1440x900-selection-generation-bar-seedance.png` | 更多参数两行同宽且中性分段填列，无裁切。 |
| `.ui-tour/u8c-seedance-20261013/paper/1440x900-selection-generation-bar-seedance-bar.png` | 底栏单行和模式下拉位置正常；模式选项未裁切。 |
| `.ui-tour/u8c-seedance-20261013/paper/1440x900-selection-generation-bar-seedance-mode-menu.png` | 底栏单行和模式下拉位置正常；模式选项未裁切。 |
| `.ui-tour/u8c-seedance-20261013/paper/1440x900-selection-generation-bar-seedance-more-open.png` | 更多参数两行同宽且中性分段填列，无裁切。 |
| `.ui-tour/u8c-seedance-20261013/paper/1440x900-selection-generation-bar-seedance.png` | 更多参数两行同宽且中性分段填列，无裁切。 |
| `.ui-tour/u8c-english-20261013/1440x900-f2-paid-english-paid-approval-english.png` | Copied、Saved、Export failed 全英文，提示尺寸/间距正常；仅夹具确认，无真实付费。 |
| `.ui-tour/u8c-english-20261013/1440x900-f2-paid-english.png` | Copied、Saved、Export failed 全英文，提示尺寸/间距正常；仅夹具确认，无真实付费。 |
| `.ui-tour/u8c-about-20261013/graphite/1440x900-settings-about.png` | 发布版本可读，Chromium 四段版本保留，无版本组件显示未标版本，没有提交哈希。 |
| `.ui-tour/u8c-about-20261013/paper/1440x900-settings-about.png` | 发布版本可读，Chromium 四段版本保留，无版本组件显示未标版本，没有提交哈希。 |

## 风险与总管理者注意事项

- 本批 17 条违规和 K01/K02/K06/K07 已逐条处理；根因检查覆盖 UiFormRow/NumberInput/UiSegmented 的共享布局与选中、两个参数浮层入口、设置重导出、关于/许可三处版本展示、根 Toast/直接通知及相关剪辑发送调用方。没有扩成全应用文字或媒体性能审计。
- i18n 两语言 JSON、primitives/layout、参数浮层、通知入口及巡检脚本属于共享文件，合并时注意其他任务的同文件修改。新增通知消息键和布局上下文位于渲染层，无主进程重启要求。
- 系统提示已迁移到 i18n；已有 t() 字符串通知、用户自定义文字和外部/既有领域 Error.message 保持现有来源，不做猜测翻译，不宣称全部领域错误已本地化。
- 本任务执行中发生一次违反主仓禁止写入的偏差：初次运行原有画布巡检脚本，通过 junction 在 D:/VibeCode/Henji-AI/node_modules/.cache/t149-layout-canvas-panel-1440/evidence.json 写入了临时证据。发现后立即把正式脚本输出改到本 worktree 的 .tmp/ui-inspection，并用新路径完成重跑；未删除、还原或改写主仓文件。请总管理者知悉这个缓存产物。
- 主矩阵日志有 98 条告警：GPU scene CPU 回退 68、GPU 导出重试 20、图层缩略图 5、源预热 3、布局主动失败 2；场景错误项为 0。UI 正常显示不代表 GPU/媒体性能通过，本批未改动相关图形实现。
- 初次启动发现默认 MCP 端口已占用，未结束其他实例或修改用户端口配置；巡检现在等待后台启动结果再开始场景日志截取，启动日志仍保留。MCP 可用性不属于本批验收。
- 未运行全量测试、Reality、付费生成、electron:dev，未执行 Git 写操作，未修改 SDK 或重新安装依赖。许可环境的 FFmpeg/jsonify 警告仍需发布验收处理。
- 本 worktree 的 out、native FFmpeg 运行资料、.tmp 和 .ui-tour 是忽略的本机产物，不纳入提交。由总管理者负责审查、冲突集成与 Git 提交。
