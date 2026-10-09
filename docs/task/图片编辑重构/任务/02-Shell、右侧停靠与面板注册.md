# t119-02 Shell、右侧停靠与面板注册

状态：代码与精确测试已交付，**尚未达到完整验收**；中央集成、依赖图门禁与 Electron 视觉验收待总管理者收口。未执行 Git 写操作。

## 实现

- 范围：`v3/shell/`、`panelFramework/`、`panelEntries/shell.tsx`，旧 Shell、命令带及旧面板布局入口与直接测试。只改本任务文件，不改 SDK、其他任务代码或三份方案。
- 采用仓内已安装的 dockview-react 7.0.2（MIT）与共享 DockviewHost、dockviewHostTheme、dockviewDocking；参考 PhotoCraft `crates/ui-egui/src/dock.rs` 的标签、折叠与组内滚动行为，不移植 egui、不新增依赖、不自研拖动器。
- 真实规模：面板数量按登记扩展，无产品数量上限；图层仍用原有 Virtuoso。停靠框架不计算像素、不复制图层/工具/效果服务。
- 唯一状态源：文档与撤销仍归 controller/command bus；布局、面板显示和折叠只归 Shell 视图。存取端口只读写视图布局，不触发文档命令；跨重启持久 schema 由 18 登记后接入。
- 验证级别 L2：面板公开契约、Shell 及多个宿主改变，需要精确注册/布局/Shell 测试、类型检查与专项门禁。用户明确要求 Electron 截图矩阵，故按正式 Reality 定向场景验收，不启动开发实例。
- `ImageEditorV3` 只组装同一 Shell 的命令带、工具 rail 与 preview slot；取消旧的有/无面板两份 preview 分支。命令带注入面板菜单，条带仍为命令带 + 0/1 参数带。
- 图层/属性通过独立条目登记，仍消费原有组件与 controller；支持关闭重开、标签分组/重排、原生分隔条 resize、应用内浮动/贴回、最大化及折叠/展开。折叠使用 Dockview 组尺寸约束，展开解除约束；没有新增拖动/缩放器。
- 恢复默认只移除/重建业务面板，保留唯一 preview 实例，避免重建 GPU 租约、工具会话或文档。布局恢复拒绝未知组件、profile 越界、重复引用、混合预览标签、循环节点与系统浮窗；用户看到可恢复错误，文档不受影响。
- 面板生命周期在隐藏/关闭/折叠和切文档或 session 时释放，在文档 revision 更新时不无故重建可见订阅。jsdom 标注测试补真实 PointerEvent 的按钮/坐标/指针身份，未更改 01 的工具实现。
- 应用能力分级为**仅呈现变化**：业务数据、操作、任务、稳定引用、网络/落盘副作用、页面与 Surface 均沿既有入口；新布局仅临时视图。没有新增 MCP 工具、实体或落盘 schema，所以不运行 assistant-capabilities/persistence-compat 全仓门禁。

## 对外接口

- `panelFramework/panelRegistry.ts`：`ImageEditorPanelDefinitionV3`（id、标题 key/默认文案、order、component、defaultPlacement、onVisibilityChange），`ImageEditorPanelContextV3`（controller + visible），`ImageEditorPanelRegistryV3(entries).list(profile)`。
- `panelEntries/shell.tsx`：default export 只登记现有 layers/properties，不把未实现面板注册成空壳。Shell 收集后续独立 `panelEntries/*.{ts,tsx}` 条目；02 的 shell 条目显式导入，供当前静态残留门禁追踪。未来 glob 条目的静态扫描支持由 18 同步核对。
- `panelFramework/layout.ts`：`ImageEditorDockLayoutV3 { dock, collapsed }`、`ImageEditorLayoutStoreV3.load(profileId): unknown / save(profileId, layout): void`、内存 store 工厂、布局校验、重开与重置函数。load 读取宿主预加载快照，save 由宿主排队落盘并负责异步失败回报；默认只使用组件生命周期内的内存 store。
- `shell/ImageEditorShellV3.tsx`：controller、commandBar(panelActions)、toolRail、preview 四个 slot；可注入 registry、layoutStore 与 `onDockApiChange(api|null)`。当前 `ImageEditorV3` 未注入持久 store；完整编辑器 props/持久存储由 18 接线，不越界修改 `editor/types.ts`。
- `scripts/lib/uiInspectionSceneImageEditDocking.cjs`：`createImageEditDockingScene(context)`，需要正式 context 的 setupToolbox、clickNamedButton、seedAndOpenCanvasPanoramaProject、reopenCanvasProjectFromStorage、settlePage，返回 `image-edit-docking`。节点夹具经正式资源入库、文档 schema 保存、隔离画布测试端口与真实节点编辑入口；没有借用旧场景的 GPU 性能/旧格式迁移流程。

## 接口请求

- 18：持久布局适配、schema/基线登记与正式应用视图控制覆盖（如需对助手开放布局）。本任务不将 Dockview JSON 写入作品或另建 localStorage 格式。
- 18：中央 UI 场景 catalog 注册 `image-edit-docking` 及节点宿主扩展；本任务提供独立场景模块，不改中央 catalog。
- 18：翻译 key `imageEditor.v3.panels.menu/show/close/float/dock/defaultLayout/layoutFailed/layoutFailedMessage/saveFailed/saveFailedMessage/maximize/restoreSize`；本任务暂用 `t` 的中文 defaultValue，不改共享语言文件。
- 18：替代手写停靠后删除不在本任务所有权中的 `editor/useImageEditorDockResizeV3.ts`，同时移除它最后引用的 `editor/imageEditorPanelLayoutV3.ts`（后者归 02，但必须与前者同次删除，否则 tsc 会报悬空 import）；这两个文件已不进入正式 Shell，不保留运行兼容分支。
- 18：删除 `scripts/ui-residue.allowlist.json` 的旧 `ImageEditorFloatingPanelsV3.tsx / w-[25rem]` 登记（当前 entries[29]）。本任务不修改中央 allowlist 或用新假引用保住旧入口。
- 18：现有 `uiInspectionSceneCatalogToolbox.cjs` 的 `image-editor-v3-release` 约 566–662 行依赖旧 `data-panel-resize-axis`、`data-editor-panel-handle` 和 dock-preview；需要以新场景的 Dockview sash/tab/menu 替换该段，不复活旧 DOM。
- 18：布局加载/保存失败的正式 Electron 截图待持久布局 fixture 注入端口接入；本任务已通过真实 Shell 的错误恢复精确测试，不用造假的 DOM 错误块冒充截图。
- 01：命令带消费工具选项组件/slot；本任务保持既有 `ImageEditorToolParametersV3` 接口，工具参数行为由 01 唯一维护。
- 01：依赖图报新增静态值环 `imageEditorHostProfiles → builtInRegistry → toolEntries/legacy → ImageEditorCropParametersV3 → useImageEditorControllerV3 → imageEditorHostProfiles`；02 不修改环内文件。初次并行测试曾在登记初始化失败，01 改为 getter 后集成测试可收集；但静态值环门禁仍需 01 消除，不能更新基线放行。

## 剪辑接入说明

V0 直接复用相同 DockviewHost、主题与拖放模块；剪辑继续持有其布局和面板，不导入图片 Shell 或其内部目录。面板只消费宿主已求值的 document/view context，不读取剪辑播放头、不进行逐帧求值。未来 V1/V2 由剪辑宿主注入片段稳定引用、源时间/时间基和已求值参数；算法的 EvaluationContext 由 03/04/06/18 冻结，Shell 不创造另一时间单位、缓存或撤销栈。

## 截图清单与目视结论

**未完成视觉验收，没有截图路径或目视结论。** 2026-10-09 执行 `New-Item -ItemType Directory -Path 'D:/VibeCode/henji-codex-tasks/runs/ui-lock' -ErrorAction Stop` 返回 exit 1、`Access to the path ... is denied`。当前沙箱只允许写 `D:/VibeCode/Henji-AI`，没有取得锁；不是其他任务占锁。不绕过锁运行 Reality、不启动/重启 electron:dev，也未构建共享产物。

独立场景已提供但尚未中央注册、运行或目视：工具箱空态；工具箱及真实画布文档节点的 default、collapsed、reopened、tabs、floating、restored、resized、panels-hidden。正式矩阵为 1440×900 / 960×640 × graphite/paper。加载失败另由 18 接入存取 fixture 后补拍；不得用单测截图或工具箱代替节点宿主。

总管理者取到指定锁并注册场景后执行：

```powershell
npm run test:reality -- --suite ui --build --only image-edit-docking --size 1440x900 --size 960x640 --theme-preset graphite --theme-preset paper
```

该命令当前**未执行**；没有以 0 匹配或 DOM 断言声称视觉通过。执行者须逐张打开，检查条带/层级/对齐/裁切/文案/颜色/开合/空错误态；问题修复后复拍。结束由取锁者释放锁。

## 检查证据

- 精确 Vitest：`panelFramework/panelRegistry.test.ts` 2 项、`layout.test.ts` 4 项、`shell/ImageEditorShellV3.test.tsx` 3 项、`editor/ImageEditorV3.test.tsx` 19 项、`ImageEditorV3.annotations.test.tsx` 6 项，**5 文件 / 34 项通过**（按文件分次静音执行，复用未变的已通过结果）。真实 Dockview API 覆盖默认/标签/浮动/关闭重开/恢复/非法布局；真实 Shell 覆盖折叠约束解除、唯一 preview、错误恢复与 profile 订阅释放。
- renderer tsc：最终 `npx tsc -p tsconfig.json --noEmit` exit 0；过程中的本任务类型错误已修。并行 mask/canvas 的短暂类型错误消失后最终通过，未修改相关文件。
- Electron tsc：`npx tsc -p tsconfig.electron.json --noEmit` exit 0；本任务无 core/main 改动，没有重复已通过的主进程检查。
- 全部本次 TS/TSX 与新增 CJS 的精确 ESLint exit 0；CJS 使用与正式巡检一致的 CommonJS require，只豁免 no-var-requires。`node --check scripts/lib/uiInspectionSceneImageEditDocking.cjs` exit 0。
- `npm run check:surface`、`check:colors`、`check:icons` 均 exit 0。
- `npm run check:ui-residue` exit 1：仅剩已删除旧浮动面板的过期尺寸登记，需 18 清理中央 allowlist；初次 glob 条目被静态扫描误判后用显式 shell 条目导入修正，当前无新界面源违规。
- `npm run check:dependency-graph` exit 1：上述 01 的静态值环；初次也曾报 01 并行文件 Madge/TS 解析不一致。当前没有报告 02 的纯 core 反向依赖或跨 feature 越界，但完整门禁**未通过**。
- `npm run check:dead-code` exit 1：旧 `imageEditorPanelLayoutV3.ts` / `useImageEditorDockResizeV3.ts` 待 18 同次删除；另有 `src/features/imageMark/render/tracePenPath.ts` 的并行未引用残留，非本任务文件。脚本还报告存量 unlisted/unresolved/binary 诊断，未修改基线。
- 未跑全量、Reality、构建、开发启动、付费调用、assistant-capabilities 或 persistence-compat；后两项无本任务业务/格式增量，前两项按范围与取锁限制保留。

## 未完成项

1. 18 的持久布局/语言/中央场景/旧入口及 allowlist 清理，以及 01 静态值环修复后，重跑失败的对应门禁。
2. 指定锁路径需要可写环境；正式 Electron 的尺寸、主题、拖动命中、浮动层级、键盘可达及错误态尚无截图/目视证据，不能标任务完成。
3. 默认内存 store 不承诺跨关闭编辑器或跨重启保存布局；存取接口已冻结，18 接入正式持久视图后再验证。
4. 排查范围为 Shell 与四宿主 profile、旧布局直接消费者、根编辑器/标注集成测试及现有 release 场景选择器；未修改剪辑、canvas、maskEditor、SDK 或中央登记，不宣称其他宿主全部视觉正常。

## 设计自查

1. 助手只凭名称和说明能否用对？本任务仅换现有业务的布局，图层/参数操作仍走现有通用实体。布局是视图状态，暂不新增同义 MCP 工具；若开放布局控制，18 通过通用视图属性读写接同一布局端口。
2. 能否 AI 先做、人只确认？原主体/修补与生成服务继续在当前文档工作；Shell 不增加必须人工配置的业务步骤，默认布局开箱可用，人只按需要调整面板。
3. 产物能否直接流进其他工作区？不改变文档、资源、物化或保存契约，沿既有画布文档与剪辑链接流转；布局不混入媒体产物或作品历史。
