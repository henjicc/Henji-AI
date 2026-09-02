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
npm run electron:dev -- --background  # Electron 开发模式：窗口启动后最小化，禁用后台节流并持续渲染（测试优先）
npm run electron:dev                 # 仅在必须验证启动聚焦行为时使用普通前台启动
npm run dev                    # 裸 Vite 渲染层（不含主进程能力，不能作桌面验收依据）
npm run lint                   # 渲染层 lint
npm run test                   # 全量单元测试（仅 L3 / CI；日常改动按 testing.md 跑精确或相关测试）
npm run verify:changed -- --level L1 <本次文件...>  # 显式文件清单的局部验证；禁止省略路径扫描整个脏工作区
npm run electron:bundle        # 只生成最新 SDK/manifest/seeds 与 Electron 运行产物，不跑完整质量门禁
npm run electron:build         # 完整构建：manifest/seeds + 全部静态检查 + tsc + electron-vite
npm run electron:dist          # 生成安装包
npm run electron:smoke         # 构建产物冒烟验收
npm run logs:query -- --chain <runId>   # 按运行链路查日志

# 真实环境跑助手（无窗口 Electron，复用正式助手与完整工具链，结束输出 runId）
npm run assistant:cli -- --goal "任务描述" --trace detailed
npm run assistant:live:suite -- --only camera --skip-generation
```

其余检查命令按改动类型选用，见 [docs/rules/testing.md](docs/rules/testing.md)。日常真实窗口验收需要新产物时用 `electron:bundle`；`electron:build` / `electron:dist` 仅用于构建链本身、发布或 L3，禁止因为“产物旧了”升级到完整构建。

**助手行为确实需要验证时就真跑，不要默认写成手动步骤交给用户。** `assistant:cli` 跑在真实配置环境上，完整参数见 [assistant-capability.md](docs/rules/assistant-capability.md)。两条硬约束：改过会进入运行产物的代码必须先 `electron:bundle`，否则跑的是旧产物；`--approval full_access` 会产生**真实付费与写入**，必须由用户显式确认，默认不要带。

## 全局架构边界

这些对绝大多数任务都成立，细则见 [architecture.md](docs/rules/architecture.md)：

1. **配置驱动**：可移植的模型运行时行为写在 `packages/ai-sdk/src/catalog/**/*.model.ts` 的 schema 里；痕迹AI 专属文案、联动与面板展示补丁写在 `src/models/presentation/`。需要模型特定行为时扩展 schema，不在 UI 或宿主薄壳加模型分支。
2. **生成链路固定**：`GenerationService` → `commands/aiRuntime.ts` → `platform/` → preload → `electron/main/ipc/ai-runtime.ts` → `electron/main/services/ai-runtime/` 宿主薄壳 → `@henjicc/ai-sdk` 的 client/catalog/provider/upload。Electron 侧只保留日志、落盘、取消、进度与 IPC 等宿主能力。
3. **PAL 收口**：渲染层只通过 `src/platform/*`、`src/commands/*`、领域服务访问桌面能力。主进程保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
4. **禁止跨层导入**：组件 ✗→ 主进程/provider 实现；主进程 ✗→ `components/`；模型 ✗→ `services/`/`components/`。桥梁只用 `core/`、`commands/`、`platform/`。
5. **前后端职责**：移除当前界面后仍然成立、仍需执行或可能被其他界面复用的逻辑，放后端或独立核心模块。不得因前端实现方便就把业务逻辑堆在前端。
6. **文件体积**：新文件优先 `<= 400` 行，`400~500` 可接受，`> 500` 禁止继续膨胀且修改即拆分。
7. **SDK 开发与公共消费边界**：Henji-AI 是 `@henjicc/ai-sdk` 的唯一主开发仓库与首发验证宿主，仓内通过 `packages/ai-sdk` workspace 源码开发、构建和验证；Henji-AI 之外的项目一律从公共 npm registry 安装已经发布的精确版本，禁止使用 `workspace:`、`file:`、Git URL、GitHub Packages、源码复制或其他旁路。消费方需要尚未发布的能力时，必须先回到本仓库实现并完成首发验证，经维护者对该次正式发布明确授权后发布，再升级消费项目。合并代码不等于获得发布授权。详细门槛只维护在 [文档采集手册.md](packages/ai-sdk/docs/model-adaptation/文档采集手册.md)。
8. **SDK 故障先判归属**：升级后报错先对照公共 DTO 并做同版本 SDK 最小直调；合法输入在 SDK 内失败或请求偏离官方契约才修 SDK，`null`/错类型、序列化、凭据、transport、媒体、取消和宿主生命周期问题修消费项目。`field?: T` 只允许省略或 `T`，不自动允许 `null`。完整矩阵见 [model-adaptation.md](docs/rules/model-adaptation.md#sdk-故障归属与修复位置)。

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
- 每条耗时命令执行前必须能指出 [testing.md](docs/rules/testing.md) 中的具体升级条件；“保险起见”“目录重要”“历史任务以前跑过”都不是升级条件。`docs/task/**` 中旧验收清单只记录当时证据，除非用户明确要求恢复该任务或发布验收，否则一律按当前 `testing.md` 重新裁剪
- 工作区有其他人的未提交改动时，`verify:changed` 必须显式传入本次文件；禁止用整个 `git diff`、全仓时间戳或历史任务清单替代本次影响范围
- 改代码前先确认现有实现：本项目大量能力已有唯一入口，先找再写
- 新增通用 UI 组件前，先告诉用户原因和替代方案，等确认后再创建
- 遇到与规则冲突的需求，先说明冲突点，并给出建议，最终由用户决定
- 不轻易打补丁，发现问题去找根本原因，敢于推倒重写，绝不不盲目叠加判断、复制旧逻辑修改参数等打补丁行为
- 涉及浏览器操作（调研、抓取网页、自动化）优先主动查找并使用 ego-browser skill；开发环境里没有装 ego-browser 时不强求，改用其他浏览器工具即可
- VGPU 尚属较新的图形库；涉及 VGPU API、GPU context、target、frame、effect、WGSL、资源生命周期、性能或兼容性时，只要对实现拿不准，必须优先使用官方 VGPU MCP（名称 `vgpu`）的 `docs` / `examples` 工具查证。支持 Modern MCP `2026-07-28` 自动协商的客户端使用 Hosted HTTP `https://vgpu.sh/api/mcp`；仍使用旧协议的 Codex 客户端改用官方只读 stdio `npx -y vgpu mcp`，不得反复配置已确认无法握手的 HTTP 端点。当前会话未加载 MCP 或连接失败时，立即回退查阅 [VGPU 官方文档](https://vgpu.sh/docs)、官方示例与 API Reference。实现判断一律以这些一手资料为准，不得仅凭记忆或二手文章判断

### Git 提交规范

- 标题格式：`<type>(可选范围): 中文描述`，例如 `feat(canvas): 新增视频首尾帧节点`、`fix(camera-stage): 修复视口迁移后的重复视角`
- `type` 使用：`feat` 新功能或明显增强、`fix` 缺陷修复、`perf` 性能优化、`refactor` 重构、`docs` 文档、`test` 测试、`chore`/`build`/`ci` 工程维护
- 更新日志默认关注 `feat`、`fix`、`perf`；其他类型通常不作为用户可见变化
- 标题直接说明改了什么，保持简洁、可检索；不要写成复盘、评价、过程记录或“完成某阶段”式描述，必要背景放正文
- 一个提交聚焦一个主要目的；存在破坏性变更时使用 `feat!:` / `fix!:` 并在正文说明迁移方式

### Git 多设备同步规范

- 每次开始修改前，先确认当前分支、上游分支与工作区状态；工作区干净时执行 `git pull --rebase`，确保基于远端最新提交开始工作
- 工作区存在未提交改动时，禁止为了拉取而自动 stash、覆盖、丢弃或混入他人改动；先执行 `git fetch` 判断远端差异，在不影响现有改动的安全边界完成同步
- 一组改动完成并通过匹配验证后，顺序固定为：提交本次改动 → `git pull --rebase` 再次吸收工作期间产生的远端提交 → 必要时解决冲突并重跑受影响验证 → 推送当前分支
- 每次创建 commit 后都必须立即推送到当前分支的上游；没有上游时使用 `git push -u origin <当前分支>` 建立跟踪关系。推送失败不得声称已同步，必须保留本地提交并如实报告原因
- 推送完成后检查当前分支与上游既不 ahead 也不 behind，确认本次提交已存在于远端，才算该组改动完成
- 默认禁止 `git push --force`、`git push --force-with-lease` 及任何会改写远端历史的操作；确需改写历史时必须先获得用户明确授权

## 完成标准

每次改完代码：

1. 跑完 [testing.md](docs/rules/testing.md) 中与本次改动匹配的检查，如实报告结果
2. 只有本次改变了拖拽、点击、悬浮、窗口、WebGL、IPC 或其他必须在真实容器中证明的行为，才运行项目正式 `npm run test:reality -- --build --suite ui|ui-audit`；普通 TSX、样式、文案、纯逻辑和已有精确测试覆盖的交互不自动升级。需要真实应用视觉审查时禁止使用浏览器、ego-browser 或 Chrome 代替 Electron，并由 Agent 打开实际截图目视检查。
3. **只有本次改动需要把真实应用交给用户继续查看、改变了 Electron 运行时代码，或实际运行过会中断开发实例的构建/Reality 验收时，最终回复前才检查并维护开发环境。** 分析、规则/文档、测试文件、纯 SDK、纯脚本和无需真实窗口的局部逻辑任务不启动、不重启开发环境。需要维护时只识别工作目录属于当前仓库的 `npm run electron:dev` 进程，禁止按 `node` / `Electron` 名称宽泛结束其他项目进程，并优先使用 `npm run electron:dev -- --background`：
   - 未运行：在可持续运行的终端会话中执行 `npm run electron:dev -- --background`，确认启动成功后再交付
   - 已运行且本次改动需要重启：只结束当前仓库对应的完整开发进程树，然后重新执行 `npm run electron:dev -- --background`
   - 已运行且无需重启：保持现状，不得重复启动第二个实例
   - 启动或重启失败：不得声称已完成，保留错误输出并如实报告
   - 只有触发本条时，最终回复才写实际状态：`🟢 开发环境已启动` / `🔄 开发环境已重启` / `✔️无需重启（开发环境保持运行）` / `🔴 开发环境启动失败`
4. 助手改动还要多一步：对照 [assistant-status.md](docs/rules/assistant-status.md) 第零节，判断本次是否改变了「通/不通」、增减了欠账，或**推翻了以前已确定做好的内容**——命中任一条就更新那份台账。普通缺陷修复不用动它。
