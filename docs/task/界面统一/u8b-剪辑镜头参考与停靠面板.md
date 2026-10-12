# u8b：剪辑、镜头参考与停靠面板巡检修复

状态：本批修复与精确检查完成，26 张真实 Electron 深浅主题截图已逐张目视；ui:tour 存在与本批无关的 MCP 端口占用错误，不能宣称整条巡检命令通过。总管理者审查并负责 Git 提交。

工作区 `D:\VibeCode\henji-wt-u8b`，分支 `codex/u8b`，开始时工作区干净。未执行 Git 写操作，未操作主仓，未安装或删除依赖，未启停 electron:dev，未跑全量 Reality 或付费请求。用户指定此独立 worktree，未切换 main。

巡检依据：`D:\VibeCode\henji-wt-u7\docs\task\界面统一\u7-全局界面巡检.md` 的 V01、V06、V07、V08、V09、V11、V12、K04；对应八张原始截图已逐张打开。未给出本任务总览路径，本目录也没有 u8b 的总览行，因此只维护本任务记录。

## 逐条处理与设计决定

| 编号 | 处理 | 根因与决定 |
|---|---|---|
| V01 | 已修，深浅截图复验通过 | 共享 DockviewHost 令当前标签在缩窄后滚入完整可见区域，边缘部分标签隐藏并由 Dockview 原生溢出菜单收纳；菜单使用自然标题宽度，点击时保留外层工作区滚动位置。卸载后不再执行排队的观察回调。不另造标签菜单、不改拖放协议。 |
| V06 | 已修，深浅截图复验通过 | 场景设置统一在 UiGroup 提供 96 标签列；所有嵌套表单行继承。共享 SliderNumberRow 中读数保留 w-16 几何槽，防止固定列上下文把读数扩到整列。其他镜头面板不强制改列宽。 |
| V07 | 已修，深浅截图复验通过 | LUT 选择补 UiFormRow 与中英文标签。共享 ParamList 使用 UiFormRow、96 标签列，数值和恢复按钮共占完整控件列；Numeric 的 NumberInput 外壳同时 flex-1，避免内部 w-full 仍按内容收缩。曲线/色轮图形保留既有绘图排布。 |
| V08 | 重试已修；不修解码链路（正式导入后读取成功） | 视频仅 hasAudio=true 且非纯画面分量时读取波形；图片、文字、无声音视频仍不请求。时间线失败显示短“重试”，悬停/读屏给出“波形未能读取 · 重试”；恢复动作位于片段选择层上方。源监视器 UiError 补重试。共享缓存只重试失败且仍有消费者的条目，同源消费者共用请求、连续点击不重复入队。原巡检同一缓存 MP4 未授权直读得到“音频素材尚未获得读取权限，请从素材库导入”，经正式 documents.importFile 导入后波形为 ready。波形实际走 FFmpeg/ffprobe 与音频 Worker，不是原生视频解码服务缺失；不改正常失败呈现，只补恢复动作。诊断在 `.tmp/u8b-native-waveform.json`。 |
| V09 | 已修，深浅截图复验通过 | 字幕与标记同一虚拟记录列表由非首项自己画全宽分隔线；上下 py-2.5 共 20px，标题14/500、元信息12，移除旧固定56高度以免新增留白被错误虚拟化。 |
| V11 | 已修，深浅截图复验通过 | TypographyPanel 统一120标签列，字体、字形、字号、字距、行距及链接样式共用；字号滑杆和 w-20 读数共占控件列。描边颜色、宽度、位置一并按同源表单行修正。 |
| V12 | 已修，深浅截图复验通过 | 新建/修改序列弹窗统一96标签列；预览独立居中放置，全部表单字段填满同一控件列，更多设置沿用相同列宽。 |
| K04 | 已修，深浅截图复验通过 | 风格预览图片固定 h-28（112 CSS px），宽面板自动紧凑并排，图片 object-contain 保持完整画幅；不修改渲染分辨率、样例数量或产品规模。两套 skill 同步补充此语法。 |

选型：复用现有 Dockview（已安装）溢出列表、UiGroup/UiFormRow、ParamList、NumberInput、Virtuoso、WaveformView 与波形数据服务；这些成熟共享入口已经满足本次呈现与恢复需求，不新增库或平行实现。

应用能力覆盖分级：布局、记录边界和样张预算属于仅呈现变化；波形重试是非权威派生缓存恢复，复用已有 PAL 音频读取，不修改工程内容、撤销、权限或费用，不新增实体、算法型能力或 MCP 工具。未改助手运行时与能力台账。

## 设计自查

1. 助手只凭名称和说明能否用对？现有剪辑片段、字幕、调色和镜头属性语义不变；用户可见标签更完整。波形重试属于派生显示缓存恢复，不开放独立业务能力。
2. 能否 AI 先做、人只确认？保留已有自动校色、风格提取和字幕流程；本次只改呈现与恢复，不新增从零调参流程。
3. 产物能否直接流进其他工作区？现有工程、媒体引用与跨工作区流转不变，没有新落盘格式或复制通道。

## 检查与截图证据

- 精确 Vitest 八文件63测试通过：waveformDataService（5）、ParamList（1）、CameraStagePanels（6）、VideoEditTypographyPanel（2）、VideoEditTimedContentPanel（13）、VideoEditSequenceDialog（13）、VideoEditTimelineMedia（6）、CodeParameterPanel（17）；文字面板与字幕列表后续改动对应两文件15测试重验通过。只新增一条波形恢复回归测试，没有组件快照。
- `npx tsc -p tsconfig.json --noEmit`：通过（`.tmp/u8b-tsc-scroll.log`）。仅改渲染层，未改 core/main，按本任务要求不跑 Electron tsc 或 main-imports。
- `npx eslint <本次修改的 TS/TSX 与 CJS>`：通过；主体清单在 `.tmp/u8b-eslint-delivery.log`，末次宿主改动在 `.tmp/u8b-eslint-scroll.log`，末次场景脚本在 `.tmp/u8b-eslint-scenes-final.log`。
- `npm run check:surface`：通过，界面语法错误与启发式告警均为0（`.tmp/u8b-surface-final.log`）。
- `npm run check:colors`：通过（`.tmp/u8b-colors-visual.log`）。
- `npm run check:icons`：通过（`.tmp/u8b-icons.log`）。
- `npm run check:ui-residue`：通过（`.tmp/u8b-ui-residue-final.log`）。
- `npm run check:skill-sync`：通过，两套 skill 一致（`.tmp/u8b-skill-sync.log`）。
- 两份 i18n JSON 解析、`git diff --check`：通过。
- `npm run electron:bundle`：通过，末次产物覆盖最终代码（`.tmp/u8b-bundle-scroll.log`）；未跑完整 build/dist。
- `npm run ui:tour -- --only super-keyframe-panel-camera,u8b-video-ui,u8b-waveform-retry --theme-preset graphite,paper --size 1440x900 --out .ui-tour/u8b-20261013`：初轮镜头参考两主题通过；剪辑夹具与定位器问题后续已修。后续目视发现的 Numeric 外壳收缩、溢出菜单窄化、片段覆盖层截获重试、切换隐藏标签带走外层滚动均已修，并在最终轮重验。
- 最终 `npm run ui:tour -- --only u8b-video-ui,u8b-waveform-retry --theme-preset graphite,paper --size 1440x900 --out .ui-tour/u8b-20261013/complete`：退出码1。四个场景的 setup/交互断言均通过、browserErrors 均为空；波形两主题完全通过。剪辑布局两主题各记录一条 `main.mcp / mcp.restore.failed / EADDRINUSE 127.0.0.1:43821`，因此各场景整体被判失败。这是隔离实例启动恢复外部连接时端口被占用，未屏蔽该错误、未改变网络/主进程配置、未结束其他实例。日志 `.tmp/u8b-tour-complete.log`，各主题 `evidence.json` 保留原错误。
- 波形场景只登记主动注入的 `audio.waveform.pyramid.failed` 为预期失败；撤销注入后自然点击重试，正式音频链路恢复，未使用强制点击或手工滚动绕过缺陷。
- `electron:bundle` 的触发条件：本次用户明确要求真实 Electron 截图，worktree 无现成运行产物；只做轻量产物构建，不升级完整质量构建。
- 官方构建中的目录生成脚本重写 SDK 自动生成文件；没有手工改 SDK，144 个文件逐一与 HEAD 比较，字节完全一致、Git 内容 diff 为空但状态标修改，完整清单在 `.tmp/u8b-sdk-generated-state.json`，交总管理者核对。按禁令未还原。截图与日志仅在忽略目录。

## 文件清单与风险



| 文件 | 改动 |
|---|---|
| `.codex/skills/henji-ui-surface/SKILL.md` | 补充 K04 参数面板样例的高度预算与宽面板排布语法。 |
| `.claude/skills/henji-ui-surface/SKILL.md` | 同步同一界面语法，避免两套技能规则分叉。 |
| `scripts/lib/uiInspectionScenes.cjs` | 登记本批两个最小巡检场景。 |
| `scripts/lib/uiInspectionSceneU8b.cjs` | 新增定向截图、控件列断言、样张尺寸断言及真实波形失败恢复场景。 |
| `src/components/DockviewHost.tsx` | 共享处理活动标签完整可见、残缺标签收纳和菜单点击的外层滚动恢复。 |
| `src/index.css` | 为共享停靠宿主登记残缺标签隐藏和溢出菜单自然宽度。 |
| `src/features/cameraStage/panels/SceneSettingsPanel.tsx` | 场景设置采用96标签列的 UiGroup。 |
| `src/features/cameraStage/panels/panelFields.tsx` | 共享滑杆读数维持固定小槽，滑杆填满剩余控件列。 |
| `src/components/typography/TypographyPanel.tsx` | 统一120标签列及字形、字号、字距、描边的表单行。 |
| `src/components/ui/params/ParamList.tsx` | 共享普通参数改为固定标签列，控件与重置共占整列。 |
| `src/components/ui/params/ParamField.tsx` | Numeric 的数值外壳可伸展，单位保持自身宽度。 |
| `src/features/videoEdit/panels/VideoEditColorGradePanel.tsx` | 输入/创意 LUT 补标签并进入标准表单行。 |
| `src/features/videoEdit/panels/VideoEditSequenceDialog.tsx` | 序列弹窗统一标签列、控件宽度并独立放置预览。 |
| `src/features/videoEdit/panels/VideoEditTimedContentPanel.tsx` | 字幕/标记记录补全宽分隔线、留白与文字层级，采用动态行高。 |
| `src/features/videoEdit/panels/VideoEditStyleKitPreview.tsx` | 样张固定112 CSS px图像高度，宽面板紧凑并排。 |
| `src/features/videoEdit/timeline/VideoEditClipWaveform.tsx` | 时间线波形失败补可点击重试并避免片段覆盖层截获。 |
| `src/features/videoEdit/panels/VideoEditSourcePanel.tsx` | 源监视器波形失败补标准 UiError 重试及用户任务语言。 |
| `src/services/waveform/waveformDataService.ts` | 只重新调度仍有消费者的失败波形，复用共享缓存并去重。 |
| `src/hooks/useWaveformData.ts` | 统一导出共享重试动作供两个入口使用。 |
| `src/services/waveform/waveformDataService.test.ts` | 新增一条失败恢复、共享消费者及重复点击回归测试。 |
| `src/features/videoEdit/timeline/VideoEditTimelineMedia.test.tsx` | 同步波形 hook 的重试替身。 |
| `src/i18n/locales/zh-CN/ui.json` | 补中文 LUT、字形描边与波形恢复文案。 |
| `src/i18n/locales/en-US/ui.json` | 同步英文表单标签与恢复文案。 |
| `docs/task/界面统一/u8b-剪辑镜头参考与停靠面板.md` | 记录逐项处置、设计自查、文件范围、检查与逐张截图结论。 |

## 真实 Electron 截图逐张目视

以下26张均通过 `view_image` 打开检查，未用浏览器替代桌面验收。窗口1440×900，系统显示缩放会令 PNG 像素尺寸大于 CSS px；样张预算按 CSS px 断言。镜头参考复用初轮有效证据，其代码之后未改；其余使用 complete 最终轮。八张 u7 原图已打开并按编号对比，同一内容用最小隔离夹具复现，未执行原场景附带的性能/导出/生命周期矩阵。

| 主题 | 编号/状态 | 截图路径 | 目视结论 |
|---|---|---|---|
| graphite | V01 | [1440x900-u8b-video-ui-annotation-tabs.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-video-ui-annotation-tabs.png) | 活动“批注”完整，无残缺边缘字；页面命令带保持可见。 |
| graphite | V01 | [1440x900-u8b-video-ui-overflow-menu.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-video-ui-overflow-menu.png) | 原生溢出菜单的中文标题横向完整，菜单未窄化为竖排。 |
| graphite | V07 | [1440x900-u8b-video-ui-color-rows.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-video-ui-color-rows.png) | LUT标签可见，数值列左右缘一致，单位与恢复按钮未挤压数值。 |
| graphite | V11 | [1440x900-u8b-video-ui-typography-rows.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-video-ui-typography-rows.png) | 字体/字形/字号/字距对齐同一列，切换隐藏标签未带走外层工作区。 |
| graphite | V09 | [1440x900-u8b-video-ui-caption-records.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-video-ui-caption-records.png) | 三条记录间全宽分隔线可见，选中与静息态边界、标题/元信息层级清楚。 |
| graphite | K04 | [1440x900-u8b-video-ui-wide-style-preview.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-video-ui-wide-style-preview.png) | 两张样例并排，图像高度保持112 CSS px，名称与应用/提取操作进入首屏。 |
| graphite | V12 | [1440x900-u8b-video-ui-sequence-dialog.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-video-ui-sequence-dialog.png) | 名称/素材箱/比例/分辨率/尺寸/帧率共用控件列，预览独立居中。 |
| graphite | 辅助终态 | [1440x900-u8b-video-ui.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-video-ui.png) | 自动截图仍呈序列弹窗关闭过渡，布局同主图；不单凭此图判定工作面或关闭完成。 |
| graphite | V08失败态 | [1440x900-u8b-waveform-retry-waveform-failed.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-waveform-retry-waveform-failed.png) | 短片段左端重试清楚可见，无内部错误详情。 |
| graphite | V08恢复态 | [1440x900-u8b-waveform-retry-waveform-recovered.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-waveform-retry-waveform-recovered.png) | 真实点击后重试消失，音频波形出现，片段仍可正常显示。 |
| graphite | V08辅助终态 | [1440x900-u8b-waveform-retry.png](../../../.ui-tour/u8b-20261013/complete/graphite/1440x900-u8b-waveform-retry.png) | 波形恢复状态保持，无残留失败动作。 |
| graphite | V06 | [1440x900-super-keyframe-panel-camera-camera.png](../../../.ui-tour/u8b-20261013/graphite/1440x900-super-keyframe-panel-camera-camera.png) | 地面样式/密度/线粗/颜色均为左右表单行，滑杆与读数未互相覆盖。 |
| graphite | V06 | [1440x900-super-keyframe-panel-camera.png](../../../.ui-tour/u8b-20261013/graphite/1440x900-super-keyframe-panel-camera.png) | 镜头参考辅助终态，场景设置列宽与控件层级保持一致。 |
| paper | V01 | [1440x900-u8b-video-ui-annotation-tabs.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-video-ui-annotation-tabs.png) | 活动“批注”完整，无残缺边缘字；页面命令带保持可见。 |
| paper | V01 | [1440x900-u8b-video-ui-overflow-menu.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-video-ui-overflow-menu.png) | 原生溢出菜单的中文标题横向完整，菜单未窄化为竖排。 |
| paper | V07 | [1440x900-u8b-video-ui-color-rows.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-video-ui-color-rows.png) | LUT标签可见，数值列左右缘一致，单位与恢复按钮未挤压数值。 |
| paper | V11 | [1440x900-u8b-video-ui-typography-rows.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-video-ui-typography-rows.png) | 字体/字形/字号/字距对齐同一列，切换隐藏标签未带走外层工作区。 |
| paper | V09 | [1440x900-u8b-video-ui-caption-records.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-video-ui-caption-records.png) | 三条记录间全宽分隔线可见，选中与静息态边界、标题/元信息层级清楚。 |
| paper | K04 | [1440x900-u8b-video-ui-wide-style-preview.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-video-ui-wide-style-preview.png) | 两张样例并排，图像高度保持112 CSS px，名称与应用/提取操作进入首屏。 |
| paper | V12 | [1440x900-u8b-video-ui-sequence-dialog.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-video-ui-sequence-dialog.png) | 名称/素材箱/比例/分辨率/尺寸/帧率共用控件列，预览独立居中。 |
| paper | 辅助终态 | [1440x900-u8b-video-ui.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-video-ui.png) | 自动截图仍呈序列弹窗关闭过渡，布局同主图；不单凭此图判定工作面或关闭完成。 |
| paper | V08失败态 | [1440x900-u8b-waveform-retry-waveform-failed.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-waveform-retry-waveform-failed.png) | 短片段左端重试清楚可见，无内部错误详情。 |
| paper | V08恢复态 | [1440x900-u8b-waveform-retry-waveform-recovered.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-waveform-retry-waveform-recovered.png) | 真实点击后重试消失，音频波形出现，片段仍可正常显示。 |
| paper | V08辅助终态 | [1440x900-u8b-waveform-retry.png](../../../.ui-tour/u8b-20261013/complete/paper/1440x900-u8b-waveform-retry.png) | 波形恢复状态保持，无残留失败动作。 |
| paper | V06 | [1440x900-super-keyframe-panel-camera-camera.png](../../../.ui-tour/u8b-20261013/paper/1440x900-super-keyframe-panel-camera-camera.png) | 地面样式/密度/线粗/颜色均为左右表单行，滑杆与读数未互相覆盖。 |
| paper | V06 | [1440x900-super-keyframe-panel-camera.png](../../../.ui-tour/u8b-20261013/paper/1440x900-super-keyframe-panel-camera.png) | 镜头参考辅助终态，场景设置列宽与控件层级保持一致。 |

原图对应关系：V01 annotation-rows；V06 camera-camera；V07 motion-candidates-bottom；V08 play-start-play-start；V09 caption-track-captions-selected；V11 layout-video-layout-default；V12 composite-contract-composite-4k-failed；K04 dock-gestures-dock-outside-float-preview，完整前图链接见 u7 原记录各行。

## 同源排查、未做与交接风险

- 已修共享 DockviewHost、ParamList/Numeric、TypographyPanel、镜头滑杆行和字幕/标记列表，避免只在截图调用点修补。检查 DockviewHost 的剪辑、镜头与图片宿主调用方；本批实机覆盖剪辑与镜头，图片宿主未单独截图，不能宣称所有停靠宿主均经实机验证。
- ParamList 普通数值/枚举/复合行采用共享列，图形色轮/曲线维持原有独立布局；额外跑直接消费 Numeric 的 CodeParameterPanel 精确测试。TypographyPanel 的文字、基本图形、字幕和代码元素共用路径已检查；本批实机截图覆盖剪辑文字，其余宿主未逐一实机截图。
- 字幕与标记共享记录边界；字幕已实机截图，标记行为由相关精确单测覆盖。波形源监视器与时间线共享恢复动作，时间线经过失败注入与真实点击；源监视器未另做实机失败截图。含声/无声筛选逻辑检查后未发现同源误请求，没有更改。
- 未执行 Git 写操作、全量测试、Reality、electron:dev、付费请求或主仓文件操作；未改主进程、core、落盘契约、MCP 能力、解码协议，未要求重启现有开发实例。没有产品数量上限。
- ui:tour 非零退出仅因两条现有 MCP 启动端口占用错误；未修该无关主进程问题，也没有把日志错误登记成预期来掩盖。总管理者若要求整条命令绿色，应在合法释放端口的环境重跑上述定向场景。
- 官方 bundle 自动生成 SDK 文件的副作用已说明：144个文件字节与HEAD相同但git状态标修改，清单 `.tmp/u8b-sdk-generated-state.json`，SDK 内容 diff 为空。禁止还原的约束下未清理这些状态；它们不属于本批拟交付内容变更，管理者提交前须核对。
- 合并时重点检查共享 `src/index.css`、两份 ui.json、两套 UI skill 和 `uiInspectionScenes.cjs`，避免与其他界面任务冲突。本 worktree 开始时干净，没有覆盖其他任务文件；此后仅本批语义范围改动。
- 截图和 `.tmp` 日志在忽略目录，不纳入产品提交；总管理者若需要异地复验应单独保留它们。没有收到总览路径/现有任务行，未自行创建总览或改其他任务记录。
