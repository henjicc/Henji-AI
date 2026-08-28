使用中文回复，每次回复开头都添加"💡"
除非用户要求，否则禁止创建文档，禁止在处理完问题后创建总结文档

> 本文件是本项目 AI 规则的唯一主要来源。`CLAUDE.md` 通过 `@AGENTS.md` 引用本文件，不重复维护同一份内容。修改规则只改这里或 `docs/rules/`。

## 规则索引：先判断领域，再按需读取

**开始工作前**：判断本次任务涉及哪些领域 → 只读相关的规则文件（涉及多个就读多个）→ 再制定计划或改代码。
**不要默认加载全部规则文件。**

| 本次任务涉及 | 动手前必读 |
|---|---|
| **智能助手的任何改动**（能力、运行时、提示词、验证、排障、路线判断） | [docs/rules/assistant-goal.md](docs/rules/assistant-goal.md) + [docs/rules/assistant-status.md](docs/rules/assistant-status.md) |
| 新增模块/服务、跨层调用、不确定逻辑该放前端还是后端、目录重构 | [docs/rules/architecture.md](docs/rules/architecture.md) |
| 写任何 `.tsx` 界面代码、调颜色/圆角/阴影/层级/动效、"改了样式没生效" | [docs/rules/frontend-ui.md](docs/rules/frontend-ui.md) |
| 新建或改造界面/页面骨架/面板/弹窗/侧栏/设置分区、按钮层级、分隔线 | skill `henji-ui-surface` |
| 改动 `src/features/canvas/**`、节点 DOM、画布卡顿 | [docs/rules/canvas.md](docs/rules/canvas.md) |
| 新建或改造画布节点 | skill `canvas-node-builder` + 上面的 canvas.md |
| 传递图片/视频/音频 URL 或路径、接入新媒体消费方、排查 `Failed to fetch` | [docs/rules/media-url.md](docs/rules/media-url.md) |
| 新增供应商/模型、改参数 schema、改请求构建/轮询/流式协议、核对 API/价格、发布 SDK | [docs/rules/model-adaptation.md](docs/rules/model-adaptation.md) + [packages/ai-sdk/docs/model-adaptation/README.md](packages/ai-sdk/docs/model-adaptation/README.md)（资料总索引）+ [文档采集手册.md](packages/ai-sdk/docs/model-adaptation/文档采集手册.md)（官方资料、事件契约与 SDK 首发唯一详细规范）+ skill `henji-model-adaptation` |
| 新增/改造工作区、页面、浮层、工具箱工具、设置项、用户可查询数据、业务操作、权限、宿主上下文 | [docs/rules/assistant-capability.md](docs/rules/assistant-capability.md) + skill `henji-application-capability` |
| 涉及网络请求、文件读写、长耗时任务、导入导出、状态流转、用户可见失败 | [docs/rules/logging.md](docs/rules/logging.md) |
| 改动 `electron/main/**` 或 `electron/preload/**`、加 IPC、打包配置、自动更新 | [docs/rules/electron-desktop.md](docs/rules/electron-desktop.md) |
| **准备收尾任何改动前** | [docs/rules/testing.md](docs/rules/testing.md) |

**skill 在两个工具下的读法不同**（内容相同，两份需同步维护）：

- Codex：直接读文件 `.codex/skills/<skill 名>/SKILL.md`
- Claude Code：用 Skill 工具调用 `<skill 名>`（文件位于 `.claude/skills/<skill 名>/SKILL.md`）

## 项目定位

Henji-AI（痕迹AI）是 **Electron + React + TypeScript** 桌面应用，聚合多个 AI 提供商（PPIO、Fal、ModelScope、KIE）生成图像、视频和音频。

技术栈：Electron 42 / React 18 / Vite 4 + electron-vite / Tailwind CSS / SQLite（better-sqlite3）/ i18next / electron-builder + electron-updater。包管理器用 **npm**。路径别名 `@/` → `src/`。

## 常用命令

```bash
npm install                    # 安装依赖
npm run electron:dev -- --background  # Electron 开发模式：窗口完整显示与渲染，但启动时不抢焦点（测试优先）
npm run electron:dev                 # 仅在必须验证启动聚焦行为时使用普通前台启动
npm run dev                    # 裸 Vite 渲染层（不含主进程能力，不能作桌面验收依据）
npm run lint                   # 渲染层 lint
npm run test                   # 全量单元测试（仅 L3 / CI；日常改动按 testing.md 跑精确或相关测试）
npm run electron:build         # 完整构建：manifest/seeds + 全部静态检查 + tsc + electron-vite
npm run electron:dist          # 生成安装包
npm run electron:smoke         # 构建产物冒烟验收
npm run logs:query -- --chain <runId>   # 按运行链路查日志

# 真实环境跑助手（无窗口 Electron，复用正式助手与完整工具链，结束输出 runId）
npm run assistant:cli -- --goal "任务描述" --trace detailed
npm run assistant:live:suite -- --only camera --skip-generation
```

其余检查命令按改动类型选用，见 [docs/rules/testing.md](docs/rules/testing.md)。`electron:build` / `electron:dist` 费时，不要无必要地频繁执行。

**助手行为要验证就真跑，不要默认写成手动步骤交给用户。** `assistant:cli` 跑在真实配置环境上，完整参数见 [assistant-capability.md](docs/rules/assistant-capability.md)。两条硬约束：改过 `electron/main/**` 必须先 `electron:build`，否则跑的是旧产物；`--approval full_access` 会产生**真实付费与写入**，必须由用户显式确认，默认不要带。

## 全局架构边界

这些对绝大多数任务都成立，细则见 [architecture.md](docs/rules/architecture.md)：

1. **配置驱动**：可移植的模型运行时行为写在 `packages/ai-sdk/src/catalog/**/*.model.ts` 的 schema 里；痕迹AI 专属文案、联动与面板展示补丁写在 `src/models/presentation/`。需要模型特定行为时扩展 schema，不在 UI 或宿主薄壳加模型分支。
2. **生成链路固定**：`GenerationService` → `commands/aiRuntime.ts` → `platform/` → preload → `electron/main/ipc/ai-runtime.ts` → `electron/main/services/ai-runtime/` 宿主薄壳 → `@henjicc/ai-sdk` 的 client/catalog/provider/upload。Electron 侧只保留日志、落盘、取消、进度与 IPC 等宿主能力。
3. **PAL 收口**：渲染层只通过 `src/platform/*`、`src/commands/*`、领域服务访问桌面能力。主进程保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
4. **禁止跨层导入**：组件 ✗→ 主进程/provider 实现；主进程 ✗→ `components/`；模型 ✗→ `services/`/`components/`。桥梁只用 `core/`、`commands/`、`platform/`。
5. **前后端职责**：移除当前界面后仍然成立、仍需执行或可能被其他界面复用的逻辑，放后端或独立核心模块。不得因前端实现方便就把业务逻辑堆在前端。
6. **文件体积**：新文件优先 `<= 400` 行，`400~500` 可接受，`> 500` 禁止继续膨胀且修改即拆分。
7. **SDK 首发验证宿主**：Henji-AI 是 `@henjicc/ai-sdk` 的主开发仓库与首发验证宿主；官方资料、SDK 实现和完整验证必须先在本项目闭环，再发布版本供其他项目精确锁定。禁止先在消费项目猜协议、写第二套实现，再反向回填 SDK。详细门槛只维护在 [文档采集手册.md](packages/ai-sdk/docs/model-adaptation/文档采集手册.md)。

## 全局禁止事项

- 禁止在业务组件中直接调模型生成 API（`fetch()` / `axios`）
- 禁止在 UI 组件中写 `if (modelId === 'specific-model')` 这类模型特定分支
- 禁止在参数面板中提供图片、视频、音频、PDF 等媒体/文件 URL 的手动输入框；即使供应商字段名是 `*_url`，也必须呈现为上传按钮或对应上传组件，由主进程调用当前供应商的官方文件上传服务并自动回填请求 URL
- 禁止在 `src/components/ui/primitives.tsx` 以外的地方写原生 `<button>/<input>/<select>/<textarea>`
- 禁止硬编码颜色（`#hex` / `rgba(数字…)` / `*-zinc-*`），只能改 `src/index.css`、`tailwind.config.js`、`src/components/ui/styleTokens.ts`
- 禁止新增裸 `any`（存量可留，增量为零）
- 禁止同功能多份实现（上传、拖拽排序、提示词编辑、状态块、弹窗都有唯一入口）
- 禁止为新功能另建日志文件/查看器/IPC/查询通道
- 禁止新增旧式 `HostCommand` / `HostQuery` 类 Agent 工具
- 禁止为「设置某个值」「增删一条记录」这类动作手写专用 Agent 能力：注册实体属性后走通用动词（读/改/增删），专用能力只留给无法用属性写入表达的算法型操作

## 工作原则

- 以“可独立验证、可独立回滚的一组完整改动”为提交单位。功能、缺陷修复或重构达到明确完成边界，并按 [testing.md](docs/rules/testing.md) 完成匹配验证后，应及时自主提交，不得无故把多个已完成事项长期堆在工作区
- 不为每次小编辑创建碎片提交：同一目的仍在连续修改、实现尚未闭环或验证未通过时继续完成；需要切换任务、保存可靠阶段成果或开始高风险尝试前，可以提交已验证的阶段成果
- 测试随完成边界执行：改动进入可验证状态就运行最小匹配验证，失败先修复再提交；提交前检查工作区，避免混入无关文件、临时截图、日志、安装包或非必要生成产物
- 改代码前先确认现有实现：本项目大量能力已有唯一入口，先找再写
- 新增通用 UI 组件前，先告诉用户原因和替代方案，等确认后再创建
- 遇到与规则冲突的需求，先说明冲突点，并给出建议，最终由用户决定
- 不轻易打补丁，发现问题去找根本原因，敢于推倒重写，绝不不盲目叠加判断、复制旧逻辑修改参数等打补丁行为
- 涉及浏览器操作（调研、抓取网页、自动化）优先主动查找并使用 ego-browser skill；开发环境里没有装 ego-browser 时不强求，改用其他浏览器工具即可
- VGPU 尚属较新的图形库；涉及 VGPU API、GPU context、target、frame、effect、WGSL、资源生命周期、性能或兼容性时，只要对实现拿不准，必须主动查阅 [VGPU 官方文档](https://vgpu.sh/docs)、官方示例与 API Reference，以一手资料为准，不得仅凭记忆或二手文章判断

### Git 提交规范

- 标题格式：`<type>(可选范围): 中文描述`，例如 `feat(canvas): 新增视频首尾帧节点`、`fix(camera-stage): 修复视口迁移后的重复视角`
- `type` 使用：`feat` 新功能或明显增强、`fix` 缺陷修复、`perf` 性能优化、`refactor` 重构、`docs` 文档、`test` 测试、`chore`/`build`/`ci` 工程维护
- 更新日志默认关注 `feat`、`fix`、`perf`；其他类型通常不作为用户可见变化
- 标题直接说明改了什么，保持简洁、可检索；不要写成复盘、评价、过程记录或“完成某阶段”式描述，必要背景放正文
- 一个提交聚焦一个主要目的；存在破坏性变更时使用 `feat!:` / `fix!:` 并在正文说明迁移方式

## 完成标准

每次改完代码：

1. 跑完 [testing.md](docs/rules/testing.md) 中与本次改动匹配的检查，如实报告结果
2. 不要人工接管用户鼠标做验收；拖拽、点击、悬浮、画布交互优先通过项目正式 `npm run test:reality -- --suite ui|ui-audit` 自动化执行。只有正式场景尚未覆盖或必须由用户作主观判断时，才写清操作步骤和验证点交给用户。真实应用视觉审查禁止使用浏览器、ego-browser 或 Chrome 工具代替 Electron；必须使用真实 Electron 窗口、项目正式场景和实际截图，并由 Agent 打开截图目视检查。
3. **最终回复前必须检查本项目开发环境是否正在运行**，只识别工作目录属于当前仓库的 `npm run electron:dev` 进程，禁止按 `node` / `Electron` 名称宽泛结束其他项目进程。测试、助手验证与 Agent 收尾启动一律优先使用 `npm run electron:dev -- --background`：该模式仍创建、显示并持续渲染真实窗口，只是不在首次显示时抢占用户焦点；只有必须验证启动聚焦行为或用户明确要求时，才使用普通前台启动：
   - 未运行：在可持续运行的终端会话中执行 `npm run electron:dev -- --background`，确认启动成功后再交付
   - 已运行且本次改动需要重启：只结束当前仓库对应的完整开发进程树，然后重新执行 `npm run electron:dev -- --background`
   - 已运行且无需重启：保持现状，不得重复启动第二个实例
   - 启动或重启失败：不得声称已完成，保留错误输出并如实报告
   - 最终回复明确写出实际状态：`🟢 开发环境已启动` / `🔄 开发环境已重启` / `✔️无需重启（开发环境保持运行）` / `🔴 开发环境启动失败`
4. 助手改动还要多一步：对照 [assistant-status.md](docs/rules/assistant-status.md) 第零节，判断本次是否改变了「通/不通」、增减了欠账，或**推翻了以前已确定做好的内容**——命中任一条就更新那份台账。普通缺陷修复不用动它。
