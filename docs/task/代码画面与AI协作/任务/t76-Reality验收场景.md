# t76 代码画面与 AI 协作 Reality 场景

状态：2026-10-08 脚本与四项定向单元验证完成，待总管理者真实 Electron 验收、审查与 Git 提交。本任务没有启动 Electron、运行 Reality、调用模型或执行 Git 写操作。

## 设计自查

1. 助手只凭名称和说明能否用对？能。场景使用正式 `change_application_entities`、`read_application_entity`、`focus_application_entity`、`observe_video_edit_frame` 与 `read_application_media`，按已公开实体属性创建和读回；批注仍由用户通过，外部 Agent 只能提交处理回复。
2. 能否 AI 先做、人只确认？能。外部 MCP 连接在同一事务里增大标题字号、追加回复并转待审查；通过按钮由真实界面点击，随后验证外部连接不能代替用户通过。复制给外部 Agent 不运行内置模型。
3. 产物能否直接流进其他工作区？能。批注裁切帧返回正式资产引用并通过 `read_application_media` 读出媒体结构；本次不增加格式或搬运通道。跨工作区落位不属于这份场景的九步断言。

## 选型与范围

- 复用仓库既有 Playwright/Electron Reality 场景体系、Modern MCP 客户端、工程缓存与 documents 打开入口；不引入第二套自动化框架或依赖。夹具与 mask 一样写缓存再经正式入口打开，但默认使用本地图标图片的独立 1920×1080/30fps 工程，避免依赖先跑其他 4K/解码场景。
- 作者素材严格参考 `author-api.md`、`author-text-motion.md`、`author-shaders.md`、`examples.md`：v3、可信 aurora、group 内 plate/title、0.6 秒 expoOut、0.045 秒逐字错峰，底板读取 `ctx.style.palette.accent`。
- 单元验证用既有 esbuild 内存打包正式 TS 编译器/求值器/字体度量布局，随后经 Node 加载可信实现。作者源码只由正式封闭编译器解析与求值，不作 JavaScript 执行。没有启动 Vite 服务或 GPU。
- 本任务文件：`scripts/lib/uiInspectionSceneVideoEditCodeAi.cjs`、`scripts/lib/uiInspectionSceneVideoEditCodeAi.test.cjs`、`scripts/lib/uiInspectionScenes.cjs`、本记录、总览中的 t76 行。未改 `src/**`、`electron/**` 或 `packages/ai-sdk/**`。

## 真实运行入口与证据

由总管理者使用 `npm run test:reality -- --suite ui --only video-edit-code-ai`。默认临时 profile；不要使用真实用户资料目录。运行产物过期时由总管理者按 testing.md 决定加 `--build`。

场景声明 `writesUserData: true`，外部连接明确 `allowPaid: false`。所有步骤各自保存 evidence、成功或失败截图及中文失败原因；待审查和已选择字体状态另有中间截图。场景证据位于 `node_modules/.cache/video-edit-code-ai/evidence.json`，截图交由 Reality 的 `capture()` 统一管理。正式 runner 继续负责 console/pageerror 和结构化日志收集，场景不另读日志文件。

| 步骤 | 选择器/正式入口 | 断言与环境假设 |
|---|---|---|
| 1 工程 | `openVideoEditFile`、项目卡片、`canvas[aria-label="剪辑画面"]` | 本地图标存在；正式 documents 可用；0 帧呈现；记录实际文档/序列引用、分辨率和禁付费授权。 |
| 2 v3 | MCP 创建 code_material 与 code clip；document.program_playback | 代码画布与序列均 1920×1080、方形像素、x/y=0/scale=1。25 帧是最后字入场完成后的一帧；呈现帧、时间标尺与请求一致。 |
| 3 元素 | `[aria-label="代码元素选择层"] [data-code-element-selected="true"]`、叠层 span、`代码素材源码` textbox | 作者坐标 (960,540) 映射到 canvas DOM 中心；选中名含 title；textarea selectionStart/end 对应 title 源码。若源码已展开直接读；否则点击“查看与编辑源码”。 |
| 4 批注 | `[data-video-edit-panel="program"]` 聚焦后 C；“标注” label 旁触发器；`这里要改什么？`、`.dv-tab`“批注”、`[data-video-edit-annotation]` | C 在 program 必须是评论钉（timeline 中是剃刀）；草稿队列 1 条；点击“复制给外部 Agent”；字号112+外部回复+addressed 同事务；待审查→用户通过→resolved。再由用户重开、Agent 尝试 resolved，必须因审查权限被拒且保持 open。 |
| 5 观察 | `observe_video_edit_frame` + `read_application_media` | 同时 overlayAnnotations/cropAnnotationId，显式 annotationIds；返回已验证 asset、正尺寸和非空图片媒体块。只查结构与256字节片段，不断言像素。 |
| 6 字体 | “文字字体” button、“搜索字体” textbox、“字体列表” listbox 的第二个 option、“撤销” button | 原生 text item/clip 在140帧后创建，定位150帧避开代码背景。“黑”不足两项时分页查本机中文字体、搜索实际名称，再切中文分类。必须至少两种中文字体家族，否则明确失败。第二项悬停：新呈现+临时fontFamily变化；Esc完整样式恢复；选择后读回变更；工具栏一步撤销恢复完整样式。 |
| 7 风格 | `.dv-tab`“风格”、`[data-video-edit-style-kits]`、“选择风格” button、“科技信息” option、“应用到序列” | 25帧呈现；读回实际styleKitId与科技信息预设；代码底板使用ctx.style，应用后requestedAt增大、仍呈现25帧。选择请求变化作为判据，未作像素差比较。 |
| 8 效果 | `.dv-tab`“效果”、`[data-video-edit-effects-entry]`“镜头色差”、`[data-video-edit-effect]`、强度/方向输入 | 130帧只显示本地图片，避免生成器遮住滤镜。双击后自动打开效果控件；实际builtin.id必须shader_chromatic（“色差”是旧效果，不采用）；新呈现且仍130帧。 |
| 9 性能 | canvas dataset requestedAt/renderMs/presentedFrame、MutationObserver、PerformanceObserver longtask | 汇总每步renderMs、全部观察到的呈现样本与最大长任务；不制定未经实测的性能阈值。longtask不支持时明确失败。 |

复用现有 dock 菜单：已显示标签点击；面板关闭时经“面板”菜单重新打开。默认单窗布局；未覆盖系统浮窗。正常与失败路径均关闭测试工程、关闭 MCP 客户端并撤销连接、恢复旧停靠布局和移除观察器；清理失败保留 evidence 并使场景失败。

## 检查结果

- `node --check scripts/lib/uiInspectionSceneVideoEditCodeAi.cjs`：通过。
- `node --check scripts/lib/uiInspectionSceneVideoEditCodeAi.test.cjs`：通过。
- `node --check scripts/lib/uiInspectionScenes.cjs`：通过。
- `node --test --test-reporter=dot scripts/lib/uiInspectionSceneVideoEditCodeAi.test.cjs`：4项通过，包括不同画面尺寸坐标映射/无效输入、性能缺失值、正式v3编译求值与标题命中、唯一场景登记。
- 改动三个CJS文件 ESLint，使用 `--rule '@typescript-eslint/no-var-requires: off' --report-unused-disable-directives --max-warnings 0`：通过。默认ESLint尝试失败：CJS未设override，已有登记文件的全部require也触发no-var-requires；适配命令只关闭此不适用规则。首轮发现的finally抛错已移至finally之后。
- 单元验证初版 ViteNode 加载停滞，已停止并换成 esbuild；内存 Module.filename 遗漏及夹具text括号错误均已修正，最终四项通过。
- 仅脚本/测试/任务记录，按L1只运行上述精确检查；未运行tsc、全量测试、Reality、构建或开发环境。

## 尚未验证与交接

- 此环境按任务要求没有启动 Electron，DOM 布局命中、实际着色器呈现、字体预览、剪贴板和 MCP 权限拒绝仍须总管理者真实运行；静态/纯逻辑通过不能视为桌面验收通过。
- t70 可能改叠层/选框DOM或直接修改工具优先级。若真实运行步骤3失败，先核对叠层span、data-code-element-selected及工具模式；本任务不修改其实现。
- t73 真实付费生成、内置助手模型调用、画面像素质量、全流程性能阈值与跨工作区落位没有覆盖。场景只提供本次要求的九步证据。
- 总管理者应打开实际成功/失败截图目视核查并审阅evidence与runner日志，再记录桌面验收结果。没有运行或声称开发环境已启动/重启；Git交由总管理者处理。
