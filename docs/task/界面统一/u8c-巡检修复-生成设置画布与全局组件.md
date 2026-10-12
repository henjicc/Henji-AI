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

## 2026-10-13 合并 main（本轮补记）

- 合并来源：`main` 的 `291a29d684ae328f085d7191502f22feeaaf448f`；本轮起点 `b2db5fba0`，worktree 干净。按本任务特许只在 `codex/u8c` 执行 merge、精确 add 和 merge commit；禁止 push/rebase/切换分支。
- 本轮属于展示契约 C0，没有新增业务能力、数量上限、依赖或 SDK 修改。没有启停 electron:dev，也没有运行 Reality 或真实付费调用。
- 没有指定 u8 总览中的对应行；只补记本 u8c 记录，不修改其他任务记录。

### 冲突逐项取舍

1. 两份 SKILL.md：保留 u8b 的样张有限高度预算和 u8c 的通知 i18n、中性分段/五项规则；过时的 2~4 标题统一为 2~5。两份逐字一致。
2. 随手摆巡检：保留 main 的 radio 与 Home/ArrowRight 焦点契约；路径选 u8c 的 `.tmp/ui-inspection`，避免 node_modules junction 写入主工作区。
3. Dropdown：采用 main 更完整的失效值/空白占位判断（保留有效零值与自定义面板），同时保留 u8c 新增未选择文案键；空选项禁用和 a78e3a855 的打开态复位保护不变。
4. ImageEditorLayoutControlsV3：外层采用 main 的 UiGroup，共享表单列；短单选 ≤5 项用中性 UiSegmented，长文案或更多项用完整 Dropdown；保留 u8c 空态、忙碌时动作带条件和取消/保存重试流程。
5. 两份 ui.json：保留双方新增键；main 已删除的 beforeScope/afterScope 继续由方向明确的新文案替代，不恢复旧字段。JSON 合法，中英文各 1450 个叶键。
- 额外集成修正：Dropdown 测试重复 import、UiSegmented 重复断言去重；双段开关测试同步中性规则；补登生成空态 Node 测试归属。

### 本轮设计自查与选型

1. 助手只凭名称和说明能否用对？能；原参数与操作名称、应用/撤销契约保持，合并没有增加新工具。
2. 能否 AI 先做、人只确认？能；保留既有整理候选、预览与应用，人用分段或完整下拉校正。
3. 产物能否直接流进其他工作区？能；既有图片文档、画布宿主与跨工作区发送契约保持。
- 复用既有 React、UiGroup、UiFormRow、UiSegmented、Dropdown 和 Virtuoso，不新增第三方依赖或平行实现。

### 本轮验证

- `npx vitest run src/components/ui src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.test.tsx --silent`：33 文件 282 项，首轮仅旧双段开关外观断言失败；同步规则后精确重跑该文件 13 项通过。UiSegmented 去重后精确重跑 1 项通过；其余首轮通过证据复用。
- `npx tsc -p tsconfig.json --noEmit`：通过。本轮无 core/主进程源码手工改动，未追加 Electron tsc。
- 本轮手工处理的 Dropdown、Dropdown.test、布局控件、primitives.selection.test、UiSegmented.test 的 ESLint：通过，0 告警。
- `npm run check:surface:strict`：通过，0 错误、0 告警。
- `npm run check:skill-sync`：通过，5 个 skill、25 个共享文件一致。
- `npm run test:validation-tools`：首轮拒绝漏登记的生成空态测试；补登记后 332 项通过、0 失败。
- i18n 核查：JSON.parse 与相对共同祖先的双方新增键集合校验通过；首次全量旧键对比识别 main 有意替换的滤镜键，核对调用方后按语义保留删除。
- 新 Electron 产物：`node node_modules/electron-vite/bin/electron-vite.js build` 通过。标准 bundle 的目录生成与 SDK 构建步骤会写 packages/ai-sdk，因此按本轮禁改 SDK 约束复用现有 SDK 产物，只执行既有 Electron main/preload/renderer 构建步骤；不是完整 electron:build。
- `npm run ui:tour -- --only =image-edit-layout-draft-panel,=image-edit-layout-failure --size 1440x900 --theme-preset graphite --display-point 2561,1 --out .ui-tour/u8c-main-merge-20261013`：2 场景通过、0 失败，共产出 18 张过程截图，隔离临时数据。Windows 系统查询确认 DISPLAY1 右侧副屏、DISPLAY2 主屏。
- 运行时证据：两场景均无非预期 browser/log error；布局存取失败告警及随手摆不支持蒙版的优化失败属于场景故障夹具。另有 GPU Scene 未准备完成导致 CPU 后备告警 35 条，以及 fast_proxy 并发触顶导致源预热/图层缩略图各 1 条告警；这些媒体运行链路未在本轮修改，未另行复现或修复，不能将本轮结论理解成无告警验收。
- `git diff --cached --check`：通过；SDK 目录 staged/unstaged 均无改动。

### 本轮关键截图目视（各场景一张）

| 文件 | 目视结论 |
|---|---|
| `.ui-tour/u8c-main-merge-20261013/1440x900-image-edit-layout-draft-panel-step-03.png` | 原稿/边缘对齐/等距排列为中性选中整体分段，标签、滑杆、动作未裁切，主动作唯一。 |
| `.ui-tour/u8c-main-merge-20261013/1440x900-image-edit-layout-failure-layout-save-failed.png` | 保存失败与恢复入口清楚，颜色四个下拉同列等宽，提示没有遮挡参数。 |
- 两张由 Agent 打开实际 Electron capturePage 图片检查；其余过程截图保留为场景证据，未声称逐张目视。

### 本轮完整文件清单

合并相对 u8c 起点共 51 个文件；其中 12 个由本轮手工解决/补记，其余直接继承 main 的既有提交。

| 文件 | 本轮说明 |
|---|---|
| `.claude/skills/henji-ui-surface/SKILL.md` | 合并样张高度预算与五项分段、中性选中、通知语言规则，与 Codex 逐字同步。 |
| `.codex/skills/henji-ui-surface/SKILL.md` | 保留双方新增规则，冲突标题统一为 2~5 项并去重。 |
| `docs/task/界面统一/u7-全局界面巡检.md` | 继承 main 已提交的对应任务巡检记录，本轮未手工修改。 |
| `docs/task/界面统一/u8a-图片编辑器与图片相关面板.md` | 继承 main 已提交的对应任务巡检记录，本轮未手工修改。 |
| `docs/task/界面统一/u8b-剪辑镜头参考与停靠面板.md` | 继承 main 已提交的对应任务巡检记录，本轮未手工修改。 |
| `scripts/lib/uiInspection.cjs` | 继承 main 的精确场景过滤，并保留 u8c 启动后日志划界。 |
| `scripts/lib/uiInspection.test.cjs` | 继承 main 精确场景过滤测试。 |
| `scripts/lib/uiInspectionSceneImageEditFilterScopes.cjs` | 继承 main 双向滤镜转换语义断言。 |
| `scripts/lib/uiInspectionSceneImageEditLayoutDraft.cjs` | 保留 main 的 radio/方向键巡检与 u8c 的 worktree 私有 .tmp 证据目录。 |
| `scripts/lib/uiInspectionSceneSurfaceGrammar.cjs` | 继承 main 的动作列、分段和参数列巡检。 |
| `scripts/lib/uiInspectionSceneU8b.cjs` | 继承 main 新增剪辑相关巡检场景。 |
| `scripts/lib/uiInspectionScenes.cjs` | 继承 main 的 u8b 场景登记。 |
| `scripts/node-test-suites.json` | 补登 u8c 生成空态 Node 测试，修复验证工具的归属缺失。 |
| `scripts/ui-tour.cjs` | 继承 main 精确场景过滤的命令说明。 |
| `src/components/DockviewHost.tsx` | 继承 main 停靠标签不裁切的共享修复。 |
| `src/components/typography/TypographyPanel.tsx` | 继承 main 字体、描边等参数控件列对齐。 |
| `src/components/ui/Dropdown.test.ts` | 保留双方占位测试，清除自动合并产生的重复 i18n import。 |
| `src/components/ui/Dropdown.tsx` | 保留空选项禁用、失效值未选择占位及仅打开/关闭动画中复位的行为。 |
| `src/components/ui/UiSegmented.test.tsx` | 保留双方中性选中与完整下拉的断言，去除重复 bg-raised 断言。 |
| `src/components/ui/params/ParamField.tsx` | 继承 main 数值输入填满控件列的修复。 |
| `src/components/ui/params/ParamList.tsx` | 继承 main 的统一参数行布局。 |
| `src/components/ui/primitives.selection.test.tsx` | 双段开关断言同步中性抬起底和强文字，保留交互、几何与动画检查。 |
| `src/features/cameraStage/panels/SceneSettingsPanel.tsx` | 继承 main 的镜头场景参数列对齐。 |
| `src/features/cameraStage/panels/panelFields.tsx` | 继承 main 镜头参数的统一行原件。 |
| `src/features/imageEdit/v3/editor/ImageEditorEffectParametersV3.tsx` | 继承 main 的图片编辑参数行、动作列与选项控件修复，本轮未手工修改。 |
| `src/features/imageEdit/v3/editor/ImageEditorLayerTransformPropertiesV3.tsx` | 继承 main 的图片编辑参数行、动作列与选项控件修复，本轮未手工修改。 |
| `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.test.tsx` | 自动合并 main 的中文初始化和方向键与 u8c 空态/保存重试回归。 |
| `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.tsx` | 保留共享分组和分段/下拉候选，同时保留 u8c 空态和忙碌时隐藏不可执行动作的条件。 |
| `src/features/imageEdit/v3/editor/ImageEditorPropertiesPanelV3.tsx` | 继承 main 的图片编辑参数行、动作列与选项控件修复，本轮未手工修改。 |
| `src/features/imageEdit/v3/editor/ImageEditorV3.test.tsx` | 继承 main 图片编辑器交互断言更新。 |
| `src/features/imageEdit/v3/panels/adjustments/ImageEditorAdjustmentsPanelV3.tsx` | 继承 main 的图片编辑参数行、动作列与选项控件修复，本轮未手工修改。 |
| `src/features/imageEdit/v3/panels/colorManagement/ColorManagementPanelV3.tsx` | 继承 main 的图片编辑参数行、动作列与选项控件修复，本轮未手工修改。 |
| `src/features/imageEdit/v3/panels/history/ImageEditorHistoryPanelV3.tsx` | 继承 main 的图片编辑参数行、动作列与选项控件修复，本轮未手工修改。 |
| `src/features/imageEdit/v3/tools/documentGeometry/Options.tsx` | 继承 main 的图片编辑参数行、动作列与选项控件修复，本轮未手工修改。 |
| `src/features/imageEdit/v3/tools/selectionAdvanced/SelectionAdvancedOptions.tsx` | 继承 main 的图片编辑参数行、动作列与选项控件修复，本轮未手工修改。 |
| `src/features/imageEdit/v3/tools/vector/VectorProperties.test.tsx` | 继承 main 矢量面板中文文案与操作断言。 |
| `src/features/imageEdit/v3/tools/vector/VectorProperties.tsx` | 继承 main 的图片编辑参数行、动作列与选项控件修复，本轮未手工修改。 |
| `src/features/videoEdit/panels/VideoEditColorGradePanel.tsx` | 继承 main 的剪辑参数列、字幕记录或样张布局修复，本轮未手工修改。 |
| `src/features/videoEdit/panels/VideoEditSequenceDialog.tsx` | 继承 main 的剪辑参数列、字幕记录或样张布局修复，本轮未手工修改。 |
| `src/features/videoEdit/panels/VideoEditSourcePanel.tsx` | 继承 main 的剪辑参数列、字幕记录或样张布局修复，本轮未手工修改。 |
| `src/features/videoEdit/panels/VideoEditStyleKitPreview.tsx` | 继承 main 的剪辑参数列、字幕记录或样张布局修复，本轮未手工修改。 |
| `src/features/videoEdit/panels/VideoEditTimedContentPanel.tsx` | 继承 main 的剪辑参数列、字幕记录或样张布局修复，本轮未手工修改。 |
| `src/features/videoEdit/timeline/VideoEditClipWaveform.tsx` | 继承 main 片段波形失败及重试呈现。 |
| `src/features/videoEdit/timeline/VideoEditTimelineMedia.test.tsx` | 继承 main 波形读取替身补齐。 |
| `src/hooks/useWaveformData.ts` | 继承 main 波形重试接口。 |
| `src/i18n/locales/en-US/ui.json` | 保留双方英文新增键与 main 的滤镜转换文案替换，JSON 合法。 |
| `src/i18n/locales/zh-CN/ui.json` | 保留双方中文新增键与 main 的滤镜转换文案替换，JSON 合法。 |
| `src/index.css` | 继承 main 停靠标签尺寸及样张布局样式。 |
| `src/services/waveform/waveformDataService.test.ts` | 继承 main 波形失败后显式重试回归。 |
| `src/services/waveform/waveformDataService.ts` | 继承 main 波形缓存错误状态重试。 |
| `docs/task/界面统一/u8c-巡检修复-生成设置画布与全局组件.md` | 追加本轮语义合并取舍、全部文件清单、验证证据及截图核对。 |

### 未扩大验证的范围

- 已核对共享 Dropdown 的空选项、未选中/失效值、有效零值、自定义面板与禁用状态切换；布局测试覆盖 full/canvas-edit 两宿主及 quick/mask 无入口、原稿对照、焦点、取消和保存重试。
- 只复跑指定两个深色真实巡检；未扩大到浅色、全部页面、全部单测或新 SDK 产物验证。没有要求用户继续看实际开发窗口，不维护 electron:dev。最终提交不推送，交总管理者审查与后续集成。
