使用中文回复，每次回复开头都添加"💡"
除非用户要求，否则禁止创建文档，禁止在处理完问题后创建总结文档

> 本文件是本项目 AI 规则的唯一主要来源。`CLAUDE.md` 通过 `@AGENTS.md` 引用本文件，不重复维护同一份内容。修改规则只改这里或 `docs/rules/`。

## 规则索引：先判断领域，再按需读取

**开始工作前**：判断本次任务涉及哪些领域 → 只读相关的规则文件（涉及多个就读多个）→ 再制定计划或改代码。
**不要默认加载全部规则文件。**

| 本次任务涉及 | 动手前必读 |
|---|---|
| 新增模块/服务、跨层调用、不确定逻辑该放前端还是后端、目录重构 | [docs/rules/architecture.md](docs/rules/architecture.md) |
| 写任何 `.tsx` 界面代码、调颜色/圆角/阴影/层级/动效、"改了样式没生效" | [docs/rules/frontend-ui.md](docs/rules/frontend-ui.md) |
| 新建或改造界面/页面骨架/面板/弹窗/侧栏/设置分区、按钮层级、分隔线 | skill `henji-ui-surface` |
| 改动 `src/features/canvas/**`、节点 DOM、画布卡顿 | [docs/rules/canvas.md](docs/rules/canvas.md) |
| 新建或改造画布节点 | skill `canvas-node-builder` + 上面的 canvas.md |
| 传递图片/视频/音频 URL 或路径、接入新媒体消费方、排查 `Failed to fetch` | [docs/rules/media-url.md](docs/rules/media-url.md) |
| 新增供应商/模型、改参数 schema、改请求构建或轮询 | [docs/rules/model-adaptation.md](docs/rules/model-adaptation.md) + skill `henji-model-adaptation` |
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
npm run electron:dev           # Electron 开发模式（桌面调试用这个）
npm run dev                    # 裸 Vite 渲染层（不含主进程能力，不能作桌面验收依据）
npm run lint                   # 渲染层 lint
npm run test                   # 全量单元测试（仅 L3 / CI；日常改动按 testing.md 跑精确或相关测试）
npm run electron:build         # 完整构建：manifest/seeds + 全部静态检查 + tsc + electron-vite
npm run electron:dist          # 生成安装包
npm run electron:smoke         # 构建产物冒烟验收
npm run logs:query -- --chain <runId>   # 按运行链路查日志
```

其余检查命令按改动类型选用，见 [docs/rules/testing.md](docs/rules/testing.md)。`electron:build` / `electron:dist` 费时，不要无必要地频繁执行。

## 全局架构边界

这些对绝大多数任务都成立，细则见 [architecture.md](docs/rules/architecture.md)：

1. **配置驱动**：模型行为写在 `src/models/**.model.ts` 的 schema 里，不是代码分支。需要模型特定行为时扩展 schema。
2. **生成链路固定**：`GenerationService` → `commands/aiRuntime.ts` → `platform/` → preload → `electron/main/ipc/ai-runtime.ts` → `electron/main/services/ai-runtime/`。
3. **PAL 收口**：渲染层只通过 `src/platform/*`、`src/commands/*`、领域服务访问桌面能力。主进程保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
4. **禁止跨层导入**：组件 ✗→ 主进程/provider 实现；主进程 ✗→ `components/`；模型 ✗→ `services/`/`components/`。桥梁只用 `core/`、`commands/`、`platform/`。
5. **前后端职责**：移除当前界面后仍然成立、仍需执行或可能被其他界面复用的逻辑，放后端或独立核心模块。不得因前端实现方便就把业务逻辑堆在前端。
6. **文件体积**：新文件优先 `<= 400` 行，`400~500` 可接受，`> 500` 禁止继续膨胀且修改即拆分。

## 全局禁止事项

- 禁止在业务组件中直接调模型生成 API（`fetch()` / `axios`）
- 禁止在 UI 组件中写 `if (modelId === 'specific-model')` 这类模型特定分支
- 禁止在 `src/components/ui/primitives.tsx` 以外的地方写原生 `<button>/<input>/<select>/<textarea>`
- 禁止硬编码颜色（`#hex` / `rgba(数字…)` / `*-zinc-*`），只能改 `src/index.css`、`tailwind.config.js`、`src/components/ui/styleTokens.ts`
- 禁止新增裸 `any`（存量可留，增量为零）
- 禁止同功能多份实现（上传、拖拽排序、提示词编辑、状态块、弹窗都有唯一入口）
- 禁止为新功能另建日志文件/查看器/IPC/查询通道
- 禁止新增旧式 `HostCommand` / `HostQuery` 类 Agent 工具

## 工作原则

- 允许在完成一组相关改动、验证通过或需要保存阶段性成果时自主提交 commit；commit 信息用中文，简洁说明改动目的
- 提交前检查工作区，避免误提交无关文件、临时截图、日志、安装包或非必要生成产物
- 改代码前先确认现有实现：本项目大量能力已有唯一入口，先找再写
- 新增通用 UI 组件前，先告诉用户原因和替代方案，等确认后再创建
- 遇到与规则冲突的需求，先说明冲突点，由用户决定

## 完成标准

每次改完代码：

1. 跑完 [testing.md](docs/rules/testing.md) 中与本次改动匹配的检查，如实报告结果
2. 涉及鼠标操作（拖拽、点击、悬浮、画布交互）的验证不要自己上手，写清操作步骤和验证点交给用户
3. **必须明确告知是否需要重启 `npm run electron:dev`**，按此格式输出，不需额外解释：`✔️无需重启` / `⚠️ 需要重启`
