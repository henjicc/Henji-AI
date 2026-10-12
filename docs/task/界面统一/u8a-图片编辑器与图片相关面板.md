# u8a：图片编辑器与图片相关面板巡检修复

## 范围与计划

| 任务 | 范围 | 状态 |
|---|---|---|
| u8a | V02、V03、V04、V10、V23、V27～V34；K05、K08 | 实现、精确检查及 44 张深浅主题截图目视完成；4 项完整巡检被现有 MCP 端口占用阻断，由总管理者审查与提交 |

基线：`D:/VibeCode/henji-wt-u7/docs/task/界面统一/u7-全局界面巡检.md` 与其 `.ui-tour/u7-global-20261013/` 截图。本 worktree 初始干净，分支 `codex/u8a`。遵守本任务禁止 Git 写操作的要求，不切换分支、不提交、不推送；不改 SDK，不启动开发实例，不调用真实生成。

## 设计决定与选型

- 表单沿用 `UiGroup labelWidth={96}` 与 `UiFormRow` 的现有上下文；成对宽高、X/Y、缩放保留 `labelColumn="auto"` 网格。动作行用空标签的同一表单行，继承控件列，不另造组件。
- 短单选沿用 `UiSegmented`；修正共享原语内嵌分段的选中皮肤为 `bg-raised + text-text1`，不覆盖调用点外观。布局方案超过五项或单项超过四字时改用现有 Dropdown，不限制候选数量。
- 滤镜列表继续用成熟开源 `react-virtuoso`，把参数作为稳定 Footer、以 context 传递当前内容，与列表共用一个滚动视口；不引入新虚拟列表、不限制滤镜数量。
- 历史记录由记录项自身画上分隔线，首条不画；沿用原有分页与虚拟化。
- 没有可编辑蒙版目标或源图层锁定时隐藏路径蒙版组；有候选而未选择时共享 Dropdown 显示“未选择”，旧目标失效后不能提交。
- 转换弹窗分别说明“仅图层内容”和“同组下方合成”，并描述变化对画面的影响；不改转换算法、落盘格式或助手能力。
- 选区浮层宽度采用现有 360 档，给标签列及预览/应用/取消动作留足空间；布局浮层采用标准 `w-96`，不新增固定几何尺寸令牌。
- 为严格选择受影响场景、避免带出 4K 和 100 层性能变体，巡检过滤增加 `--only =场景id`；原有关键词匹配保留。布局夹具缓存改到当前 worktree 的 `.ui-tour/fixtures/`，避免通过 node_modules junction 写主仓。

## 设计自查

1. **助手只凭名称和说明能否用对？** 本次只整理已有操作的视觉结构与文案，仍共用正式操作；转换确认现在明确说明前后作用方式，不新增专用 Agent 工具。
2. **能否 AI 先做、人只确认？** 保留既有布局候选、选区预览及确认流程；人可在统一选项和动作列中校正，不改变算法或增加手动步骤。
3. **产物能否直接流进其他工作区？** 保留同一图片文档与导出入口，画布、工具箱、查看器、智能对象宿主共用修复；不新增文件搬运或独立产物格式。

## 编号处理

| 编号 | 处理 | 修复与排查范围 |
|---|---|---|
| V02 | 已修 | 共享调整与滤镜面板采用单一 Virtuoso 滚动区；列表与参数不再各自滚动、覆盖 |
| V03 | 已修 | 删除路径动作进入统一控件列；同源“转为曲线”“用路径作为蒙版”动作一并对齐 |
| V04 | 已修 | 删除段落动作进入继承列宽的表单行 |
| V10 | 已修 | 无可执行蒙版目标时隐藏整组，同时检查锁定目标、锁定祖先、源图层锁定和目标失效 |
| V23 | 已修 | 所有 V3 图片宿主共用历史项分隔线，分页与虚拟滚动保留 |
| V27 | 已修 | 辉光光感与左右色光复用 UiSegmented，继承属性面板列宽 |
| V28 | 已修 | 应用强度、混合模式和标量滑杆继承统一参数列；曲线、色轮图形区域保留 |
| V29 | 已修 | 尺寸模式、锚点、保护与比例控件使用左右参数行，宽高合并成对网格 |
| V30 | 已修 | 共享旋转标量改左右参数行；X/Y 和水平/垂直缩放仍为成对网格 |
| V31 | 已修 | 颜色与输出精度下拉继承同一控件列并填满，应用动作也对齐 |
| V32 | 已修 | 布局候选合并分段，较长/较多候选切下拉；共用键盘交互 |
| V33 | 已修 | 图层内容/蒙版改有标签的整体分段，保留正式编辑目标切换 |
| V34 | 已修 | 魔棒、色彩范围、焦点及五种修改方式共用左右表单和对齐动作列 |
| K05 | 已修 | 共享 Dropdown 未选择/当前值失效显示占位；保留有效零值与自定义触发器 |
| K08 | 已修 | 双向转换分别说明内容/合成语义与可见影响，即使目标名称相同也能辨别 |

## 检查与截图

已通过的检查：

- `npx tsc -p tsconfig.json --noEmit --tsBuildInfoFile .ui-tour/u8a/renderer.tsbuildinfo`：通过；未改 core / Electron，不运行 Electron tsc。
- 改动的 17 个 TS/TSX 文件 ESLint（无 cache）：通过，包括最后修改的 VectorProperties 与 ParamField。
- 精确 Vitest：Dropdown 14、UiSegmented 1、VectorProperties 2、布局控件 10、图层变换 7、调色参数 2，共 36 项通过。均带 `--silent --cache=false`；共享 ParamField 没有独立测试，以调色参数直接消费者测试和真实控件列截图覆盖，不使用 related。
- `node --test scripts/lib/uiInspection.test.cjs`：42 项通过；三份修改的场景脚本 `node --check` 通过。
- `check:surface`、`check:colors`、`check:icons`、`check:ui-residue`：全部通过。
- Electron 轻量构建的最后一步：通过，最终日志 `.ui-tour/u8a/build-final.log`；未运行完整构建质量门禁。
- `git diff --check`：通过；两份文案 JSON 解析通过，记录中 44 个截图链接全部指向实际存在的文件。

首轮 Vitest 有 5 项失败，根因是测试环境采用英文而断言为中文；已在相关测试中固定语言为中文并通过重跑。首轮截图发现删除动作文字仍居中和应用强度数值框按内容收缩，分别改用布局容器与共享 Numeric 的弹性布局；首轮巡检随后在新启动批次被“产物比源码旧”检查中止，保留原日志 `.ui-tour/u8a/tour.log`，重打包后复验。

最终截图输出：`.ui-tour/u8a/final/graphite/`、`.ui-tour/u8a/final/paper/`；纸白选区补验位于 `.ui-tour/u8a/selection-recheck/`。巡检日志 `.ui-tour/u8a/tour-final.log` 与 `.ui-tour/u8a/selection-recheck.log`。截图实例已核对 Windows DISPLAY1 为右侧副屏，沿正式启动器默认 DIP 点 `2561,1` 启动。

最终主批次 24 个场景/主题组合中 19 项通过、5 项失败，不能称为整批通过：两主题辉光场景在恢复 MCP 时 `mcp.restore.failed`，两主题滤镜失败场景在后续配置 MCP 时 `mcp.configure.failed`，均为 `EADDRINUSE 127.0.0.1:43821`。实际占用者是主仓已经运行的后台开发实例，本任务没有结束或修改它。上述场景在失败前已获得辉光与双向转换截图，转换文案断言也已通过，UI 目视正常；后续 MCP 运行时步骤仍未通过。

另一个失败是纸白选区场景在焦点预览后出现 `Execution context was destroyed`，当次原因未定位；随后仅独立重跑该场景，未放宽断言，完整通过并得到 16 张截图。采用补跑中的 8 张受影响状态作为纸白选区最终目视证据。运行时详情见两主题的 `evidence.json` 及补跑 `evidence.json`；原始失败证据均保留。

真实截图命令：`npm run ui:tour -- --only '=u5-vector-form,=u6-vector-properties,=toolbox-image-edit-vgpu-glow,=image-edit-common-workflows-canvas,=image-edit-document-size-node,=f2-image-editor,=image-edit-layout-failure,=image-edit-layout-draft-panel,=image-edit-paint-targets,=image-edit-selection-tools,=image-edit-quick-mark-viewer,=image-edit-filter-failure' --size 1440x900 --theme-preset graphite,paper --out .ui-tour/u8a/final`。补跑：`npm run ui:tour -- --only '=image-edit-selection-tools' --size 1440x900 --theme-preset paper --out .ui-tour/u8a/selection-recheck`。

`electron:bundle` 会生成 SDK catalog 并可能构建 SDK，违反本任务禁改 SDK 的约束，因此直接执行其最后一步 `node node_modules/electron-vite/bin/electron-vite.js build`，复用已安装 SDK，产物只落当前 worktree 的 `out/`。渲染层 tsc 的增量缓存显式落 `.ui-tour/u8a/renderer.tsbuildinfo`，ESLint 不启用 cache。

### 逐张目视结果

以下 44 张截图均已打开目视，并与巡检对应基线比较；每行分别记录一个主题下的实际截图。

| 主题 | 编号 | 截图 | 目视结论 |
|---|---|---|---|
| 石墨深色 | V03、K05 | [u5-vector-form-path-rows](../../../.ui-tour/u8a/final/graphite/1440x900-u5-vector-form-path-rows.png) | 删除路径从控件列起头；蒙版目标显示“未选择”，无空白触发器。 |
| 石墨深色 | V04 | [u5-vector-form-text-rows](../../../.ui-tour/u8a/final/graphite/1440x900-u5-vector-form-text-rows.png) | 删除段落与段落下拉、数值控件同列，文字与字段无重叠。 |
| 石墨深色 | V10 | [u6-vector-properties-empty-mask-target](../../../.ui-tour/u8a/final/graphite/1440x900-u6-vector-properties-empty-mask-target.png) | 路径蒙版整组隐藏；外观参数保持可见，无整块无效控件。 |
| 石墨深色 | V27 | [toolbox-image-edit-vgpu-glow](../../../.ui-tour/u8a/final/graphite/1440x900-toolbox-image-edit-vgpu-glow.png) | 光感、左侧色光为整体等宽分段；中性选中态可辨，标签与控件列对齐。 |
| 石墨深色 | V23 | [image-edit-quick-mark-viewer-quick-history](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-quick-mark-viewer-quick-history.png) | 相邻历史记录有横向分隔线，首条上方无额外线，缩略图与文字无裁切。 |
| 石墨深色 | V28 | [image-edit-common-workflows-canvas-adjustment-0](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-common-workflows-canvas-adjustment-0.png) | 应用强度数值框填满控件列；混合模式、曝光滑杆左右排布。 |
| 石墨深色 | V02 | [image-edit-common-workflows-canvas-contrast-adjusted](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-common-workflows-canvas-contrast-adjusted.png) | 参数与列表共用一条滚动条；滚动边缘正常裁切，无曲线记录叠在曝光标签上。 |
| 石墨深色 | V29 | [image-edit-document-size-node-resample-configuration](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-document-size-node-resample-configuration.png) | 调整方式左右排布；宽高为同一紧凑网格，比例开关单独表单行，无遮挡。 |
| 石墨深色 | V30 | [f2-image-editor-smart-content-single-command](../../../.ui-tour/u8a/final/graphite/1440x900-f2-image-editor-smart-content-single-command.png) | 智能对象宿主的旋转左右排布；X/Y 与缩放仍保持成对网格。 |
| 石墨深色 | V31 | [image-edit-layout-failure-layout-save-failed](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-layout-failure-layout-save-failed.png) | 四个颜色配置下拉等宽、同列，错误反馈未遮挡参数。 |
| 石墨深色 | V32 | [image-edit-layout-draft-panel-step-03](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-layout-draft-panel-step-03.png) | 原稿、边缘对齐、等距排列合成有标签的等宽分段，无横向裁切。 |
| 石墨深色 | V33 | [image-edit-paint-targets-mask-fill](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-paint-targets-mask-fill.png) | 图层内容/蒙版为有标签的整体分段，当前蒙版目标清晰，原有绘画参数保留。 |
| 石墨深色 | V34 | [image-edit-selection-tools-wand-preview](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-selection-tools-wand-preview.png) | 颜色容差、连续区域左右排布；预览/应用/取消位于控件列，无重叠。 |
| 石墨深色 | V34 | [image-edit-selection-tools-color-range-preview](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-selection-tools-color-range-preview.png) | 颜色容差左右排布；清除取样及底部动作均进入控件列。 |
| 石墨深色 | V34 | [image-edit-selection-tools-focus-preview](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-selection-tools-focus-preview.png) | 焦点范围、去噪左右排布；动作左缘与控件列一致。 |
| 石墨深色 | V34 | [image-edit-selection-tools-modify-expand](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-selection-tools-modify-expand.png) | 扩展方式、短边比例与读数在统一控件列；三个动作未裁切。 |
| 石墨深色 | V34 | [image-edit-selection-tools-modify-contract](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-selection-tools-modify-contract.png) | 收缩方式与滑杆左右排布，动作保持统一位置。 |
| 石墨深色 | V34 | [image-edit-selection-tools-modify-smooth](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-selection-tools-modify-smooth.png) | 平滑方式与滑杆左右排布，动作保持统一位置。 |
| 石墨深色 | V34 | [image-edit-selection-tools-modify-feather](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-selection-tools-modify-feather.png) | 羽化方式与滑杆左右排布，动作保持统一位置。 |
| 石墨深色 | V34 | [image-edit-selection-tools-modify-border](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-selection-tools-modify-border.png) | 边界方式与滑杆左右排布，动作保持统一位置。 |
| 石墨深色 | K08 | [image-edit-filter-failure-conversion-confirm-content-to-composite](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-filter-failure-conversion-confirm-content-to-composite.png) | 明确展示“仅图层内容→当前图层与同组下方合成”，后果说明可读、无裁切。 |
| 石墨深色 | K08 | [image-edit-filter-failure-conversion-confirm-composite-to-content](../../../.ui-tour/u8a/final/graphite/1440x900-image-edit-filter-failure-conversion-confirm-composite-to-content.png) | 明确展示“同组下方合成→仅图层内容”，与正向转换可区分。 |
| 纸白浅色 | V03、K05 | [u5-vector-form-path-rows](../../../.ui-tour/u8a/final/paper/1440x900-u5-vector-form-path-rows.png) | 删除路径从控件列起头；蒙版目标显示“未选择”，无空白触发器。 |
| 纸白浅色 | V04 | [u5-vector-form-text-rows](../../../.ui-tour/u8a/final/paper/1440x900-u5-vector-form-text-rows.png) | 删除段落与段落下拉、数值控件同列，文字与字段无重叠。 |
| 纸白浅色 | V10 | [u6-vector-properties-empty-mask-target](../../../.ui-tour/u8a/final/paper/1440x900-u6-vector-properties-empty-mask-target.png) | 路径蒙版整组隐藏；外观参数保持可见，无整块无效控件。 |
| 纸白浅色 | V27 | [toolbox-image-edit-vgpu-glow](../../../.ui-tour/u8a/final/paper/1440x900-toolbox-image-edit-vgpu-glow.png) | 光感、左侧色光为整体等宽分段；中性选中态可辨，标签与控件列对齐。 |
| 纸白浅色 | V23 | [image-edit-quick-mark-viewer-quick-history](../../../.ui-tour/u8a/final/paper/1440x900-image-edit-quick-mark-viewer-quick-history.png) | 相邻历史记录有横向分隔线，首条上方无额外线，缩略图与文字无裁切。 |
| 纸白浅色 | V28 | [image-edit-common-workflows-canvas-adjustment-0](../../../.ui-tour/u8a/final/paper/1440x900-image-edit-common-workflows-canvas-adjustment-0.png) | 应用强度数值框填满控件列；混合模式、曝光滑杆左右排布。 |
| 纸白浅色 | V02 | [image-edit-common-workflows-canvas-contrast-adjusted](../../../.ui-tour/u8a/final/paper/1440x900-image-edit-common-workflows-canvas-contrast-adjusted.png) | 参数与列表共用一条滚动条；滚动边缘正常裁切，无曲线记录叠在曝光标签上。 |
| 纸白浅色 | V29 | [image-edit-document-size-node-resample-configuration](../../../.ui-tour/u8a/final/paper/1440x900-image-edit-document-size-node-resample-configuration.png) | 调整方式左右排布；宽高为同一紧凑网格，比例开关单独表单行，无遮挡。 |
| 纸白浅色 | V30 | [f2-image-editor-smart-content-single-command](../../../.ui-tour/u8a/final/paper/1440x900-f2-image-editor-smart-content-single-command.png) | 智能对象宿主的旋转左右排布；X/Y 与缩放仍保持成对网格。 |
| 纸白浅色 | V31 | [image-edit-layout-failure-layout-save-failed](../../../.ui-tour/u8a/final/paper/1440x900-image-edit-layout-failure-layout-save-failed.png) | 四个颜色配置下拉等宽、同列，错误反馈未遮挡参数。 |
| 纸白浅色 | V32 | [image-edit-layout-draft-panel-step-03](../../../.ui-tour/u8a/final/paper/1440x900-image-edit-layout-draft-panel-step-03.png) | 原稿、边缘对齐、等距排列合成有标签的等宽分段，无横向裁切。 |
| 纸白浅色 | V33 | [image-edit-paint-targets-mask-fill](../../../.ui-tour/u8a/final/paper/1440x900-image-edit-paint-targets-mask-fill.png) | 图层内容/蒙版为有标签的整体分段，当前蒙版目标清晰，原有绘画参数保留。 |
| 纸白浅色 | V34 | [image-edit-selection-tools-wand-preview](../../../.ui-tour/u8a/selection-recheck/1440x900-image-edit-selection-tools-wand-preview.png) | 颜色容差、连续区域左右排布；预览/应用/取消位于控件列，无重叠。 |
| 纸白浅色 | V34 | [image-edit-selection-tools-color-range-preview](../../../.ui-tour/u8a/selection-recheck/1440x900-image-edit-selection-tools-color-range-preview.png) | 颜色容差左右排布；清除取样及底部动作均进入控件列。 |
| 纸白浅色 | V34 | [image-edit-selection-tools-focus-preview](../../../.ui-tour/u8a/selection-recheck/1440x900-image-edit-selection-tools-focus-preview.png) | 焦点范围、去噪左右排布；动作左缘与控件列一致。 |
| 纸白浅色 | V34 | [image-edit-selection-tools-modify-expand](../../../.ui-tour/u8a/selection-recheck/1440x900-image-edit-selection-tools-modify-expand.png) | 扩展方式、短边比例与读数在统一控件列；三个动作未裁切。 |
| 纸白浅色 | V34 | [image-edit-selection-tools-modify-contract](../../../.ui-tour/u8a/selection-recheck/1440x900-image-edit-selection-tools-modify-contract.png) | 收缩方式与滑杆左右排布，动作保持统一位置。 |
| 纸白浅色 | V34 | [image-edit-selection-tools-modify-smooth](../../../.ui-tour/u8a/selection-recheck/1440x900-image-edit-selection-tools-modify-smooth.png) | 平滑方式与滑杆左右排布，动作保持统一位置。 |
| 纸白浅色 | V34 | [image-edit-selection-tools-modify-feather](../../../.ui-tour/u8a/selection-recheck/1440x900-image-edit-selection-tools-modify-feather.png) | 羽化方式与滑杆左右排布，动作保持统一位置。 |
| 纸白浅色 | V34 | [image-edit-selection-tools-modify-border](../../../.ui-tour/u8a/selection-recheck/1440x900-image-edit-selection-tools-modify-border.png) | 边界方式与滑杆左右排布，动作保持统一位置。 |
| 纸白浅色 | K08 | [image-edit-filter-failure-conversion-confirm-content-to-composite](../../../.ui-tour/u8a/final/paper/1440x900-image-edit-filter-failure-conversion-confirm-content-to-composite.png) | 明确展示“仅图层内容→当前图层与同组下方合成”，后果说明可读、无裁切。 |
| 纸白浅色 | K08 | [image-edit-filter-failure-conversion-confirm-composite-to-content](../../../.ui-tour/u8a/final/paper/1440x900-image-edit-filter-failure-conversion-confirm-composite-to-content.png) | 明确展示“同组下方合成→仅图层内容”，与正向转换可区分。 |

## 总管理者注意

- 共享文件 `src/components/ui/Dropdown.tsx`、`primitives.tsx`、`params/ParamField.tsx`、中英文 `ui.json` 及巡检脚本可能与其他分批任务重叠，集成时只合并本次对应改动。
- 4 项完整巡检仍被主仓开发实例占用 MCP 端口阻断；有相关界面截图与断言，不能替代未通过的后续运行时验证。纸白选区单次上下文销毁未定位，独立完整复跑已通过。
- 本批只修界面语法与可操作状态，不涉及 Electron 主进程、SDK、模型或应用能力契约；无需重启主进程。
- 用户没有指定新的共享总览文件，当前目录也没有 u8 总览；本文件仅维护 u8a 这一行，不改历史计划或其他任务的状态。

## 改动文件清单

| 文件 | 说明 |
|---|---|
| `src/components/ui/Dropdown.tsx` | 补有候选但未选择/当前值失效的占位 |
| `src/components/ui/Dropdown.test.ts` | 覆盖占位、零值、自定义触发器并固定测试语言 |
| `src/components/ui/primitives.tsx` | 统一内嵌分段的中性选中皮肤 |
| `src/components/ui/UiSegmented.test.tsx` | 在既有键盘用例中验证中性选中皮肤 |
| `src/components/ui/params/ParamField.tsx` | 共享数值框弹性填满控件列 |
| `src/features/imageEdit/v3/tools/vector/VectorProperties.tsx` | 对齐动作行、按可执行目标隐藏路径蒙版 |
| `src/features/imageEdit/v3/tools/vector/VectorProperties.test.tsx` | 覆盖目标可用、锁定与失效状态 |
| `src/features/imageEdit/v3/editor/ImageEditorEffectParametersV3.tsx` | 辉光光感与左右色光统一为分段 |
| `src/features/imageEdit/v3/editor/ImageEditorLayerTransformPropertiesV3.tsx` | 旋转单值改左右参数行 |
| `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.tsx` | 布局候选使用分段/下拉并继承表单列 |
| `src/features/imageEdit/v3/editor/ImageEditorLayoutControlsV3.test.tsx` | 采用共享分段的方向键契约并固定语言 |
| `src/features/imageEdit/v3/editor/ImageEditorPropertiesPanelV3.tsx` | 内容/蒙版编辑目标使用有标签的分段 |
| `src/features/imageEdit/v3/panels/adjustments/ImageEditorAdjustmentsPanelV3.tsx` | 单一虚拟滚动区、参数列与明确的双向转换说明 |
| `src/features/imageEdit/v3/panels/colorManagement/ColorManagementPanelV3.tsx` | 配置下拉与应用动作继承固定控件列 |
| `src/features/imageEdit/v3/panels/history/ImageEditorHistoryPanelV3.tsx` | 历史记录项绘制相邻分隔线 |
| `src/features/imageEdit/v3/tools/documentGeometry/Options.tsx` | 尺寸参数左右排布、宽高成对网格 |
| `src/features/imageEdit/v3/tools/selectionAdvanced/SelectionAdvancedOptions.tsx` | 专业选区浮层表单及动作列对齐 |
| `src/i18n/locales/zh-CN/ui.json` | 增补中文占位、动作、布局及转换语义 |
| `src/i18n/locales/en-US/ui.json` | 同步英文文案 |
| `scripts/lib/uiInspection.cjs` | 等号前缀精确选择场景 |
| `scripts/lib/uiInspection.test.cjs` | 精确过滤的回归测试 |
| `scripts/ui-tour.cjs` | 标明精确选择参数用法 |
| `scripts/lib/uiInspectionSceneSurfaceGrammar.cjs` | 验证动作左缘及无效蒙版区隐藏 |
| `scripts/lib/uiInspectionSceneImageEditFilterScopes.cjs` | 验证双向转换文案的语义差异 |
| `scripts/lib/uiInspectionSceneImageEditLayoutDraft.cjs` | 对齐方向键契约、夹具缓存移到 worktree |
| `docs/task/界面统一/u8a-图片编辑器与图片相关面板.md` | 本任务状态、设计自查、检查与截图证据 |
