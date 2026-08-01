# 架构分层与依赖边界

> 读取时机：新增模块/服务、跨层调用、不确定某段逻辑该放前端还是后端、重构目录结构时。

## 分层职责

以桌面应用而非普通网页的思维开发。判断标准：**移除当前界面后仍然成立、仍然需要执行或可能被其他界面复用的逻辑，原则上放后端或独立核心模块**。

- 前端：界面展示、用户交互、轻量状态管理、即时视觉反馈
- 后端（Electron 主进程）：核心业务逻辑、文件系统、数据库、网络请求、数据处理、复杂计算、批量任务、长耗时任务、需要系统权限的能力

不得仅因为前端实现方便，就把本属后端的业务逻辑或系统能力堆在前端。

## 目录职责

```text
electron/
├── main/              # 主进程：窗口、IPC、协议、Node/TS 后端能力
│   ├── ipc/           # ipcMain handler 注册
│   └── services/      # db / keystore / ai-runtime / llm / image / project-package / updater 等
└── preload/           # contextBridge 安全暴露 window.henjiNative

src/
├── commands/          # 前端命令桥；对外签名稳定，内部走 platform
├── platform/          # PAL 契约 + electron adapter
├── components/        # React UI 组件（展示 + 轻交互）
├── core/              # 模型定义、注册、请求构建、GenerationService
├── features/          # 领域功能（含主画布实现 features/canvas/）
├── models/            # 模型定义（*.model.ts）
├── services/          # 领域服务（数据库/上传/更新检查/预设等）
├── stores/            # Zustand 状态管理
├── hooks/             # 可复用 React 逻辑
├── utils/             # 纯工具函数
└── workspaces/        # 工作区容器

old-Henji-AI/          # 旧项目代码备份，仅供对照，不参与构建
```

路径别名：`@/` → `src/`。

## 生成链路边界（不可绕过）

模型生成主链路固定按以下路径执行：

`GenerationService`(`src/core/services/GenerationService.ts`) → `src/commands/aiRuntime.ts` → `src/platform/*` → `electron/preload/index.ts`(`window.henjiNative.ai`) → `electron/main/ipc/ai-runtime.ts` → `electron/main/services/ai-runtime/`

- **禁止**在业务组件中直接发起模型生成 API 调用（`fetch()` / `axios`）
- 所有提供商细节（鉴权、路由、请求格式、轮询、结果解析）落在 `electron/main/services/ai-runtime/**`
- `src/core/providers/` 只承载基类与兼容层（如 `ProviderFactoryRegistry`），不承担真实 provider 执行
- 非生成场景（更新检查、资源下载/转换）可在服务层封装网络请求，但禁止散落在业务 UI

## 平台抽象层（PAL）边界

- 渲染层统一通过 `src/platform/*`、`src/commands/*`、领域服务访问桌面能力
- **禁止**在业务 UI 直接 import Electron `ipcRenderer`、Node 内置模块或已移除的旧 Tauri API
- 主进程能力经 `ipcMain` + preload 白名单暴露，保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- `src/platform/adapters/electron/*` 是唯一桌面平台 adapter；新增桌面能力先扩展 PAL 契约，再由 adapter 实现

## 禁止跨层导入

- 组件不能导入 runtime/provider 实现、Electron 主进程代码或旧 adapters
- Electron 主进程不能导入 `components/`
- 模型定义（`src/models/`）不能导入 `services/` 或 `components/`
- Runtime/Provider 不能导入 UI 组件
- 层间桥梁只用 `core/`、`commands/`、`platform/`

## 内部 Application API 边界

- `src/core/application-control/` 是调用方中立的反射、观察和事务契约；禁止导入组件、Store、助手适配器或 Electron 实现。
- 正式领域服务是持久业务逻辑唯一入口；UI、助手和未来本地适配器只能委托同一服务，不得各自维护第二份 schema、校验、状态机或写入逻辑。
- `ApplicationCapabilityDefinition` 是助手能力元数据唯一来源；禁止手写第二份 Agent 工具描述、旧 `HostCommand`/`HostQuery` 执行表或跨阶段兼容执行入口。
- AI 输入必须是封闭 schema，禁止任意 Store Patch、任意脚本/代码执行和原始路径参数；复杂修改使用描述、计划、提交、验证和撤销协议。
- 公开实体、属性、语义操作、Surface、模型/媒体模态或长任务发生变化时，必须更新真实注册源并通过 `npm run check:assistant-capabilities`，不得只修改助手提示词。

## 文件体积与职责

- 新文件优先 `<= 400` 行；`400~500` 行可接受（非阻断）
- `> 500` 行允许少量存量，但**禁止继续膨胀，修改即拆分**
- 单一职责：描述一个文件/类/函数需要用到"和"时，优先拆分

## 单点落地约定（禁止同功能多份实现）

| 领域 | 唯一实现入口 |
|---|---|
| 原生 `<button>/<input>/<select>/<textarea>` | `src/components/ui/primitives.tsx` |
| 提示词编辑 | `src/components/ui/PromptEditor/` + `src/core/inputs/promptDocument/` |
| 文件上传 | `FileUploader` / `UiInput(type=file)` |
| 拖拽排序 | `src/components/ui/fileUploader/useReorderDrag.ts` |
| 画布实现 | `src/features/canvas/` |
| 颜色令牌 | `src/index.css` + `tailwind.config.js` + `src/core/theme/colorTokens.ts` |

PromptEditor 补充：媒体引用、模板变量、兼容字符串解析和模型文本输出统一走结构化文档 parser/serializer；禁止重新引入透明 textarea + 镜像高亮层，禁止在业务组件重复实现引用解析。

## 根级 Provider 挂载

全局 Provider（拖拽、全局菜单、通知）只允许在应用根层挂载一次。禁止在多个根容器重复包裹同一 Provider，避免事件重复订阅与状态分叉。

## 主题状态落地

- `settingsStore` 中的 `themeTonePreset` / `uiRadiusPreset` / `accentColor` 变更后，必须同步到 `document.documentElement`（`data-*` 或 CSS 变量）
- 禁止"有设置项但未生效"长期存在；新增主题设置须同时提交"状态 + 应用层同步器"
- 主题状态单一数据源，避免多套 store 并存且互不联动

## 类型安全

- 存量 `any` 允许逐步治理，**新增或修改代码时禁止引入新的裸 `any`**；确需新增须同处写明原因与替换计划
- 新增/修改的导出函数补齐显式返回类型

## 关键文件索引

- `electron/main/index.ts` / `window.ts` / `protocol.ts` — 主进程入口、无边框标题栏、`henji-media://` 协议
- `electron/preload/index.ts` — preload 安全桥
- `src/core/ModelRegistry.ts` / `defineModel.ts` — 模型注册中心与定义辅助
- `src/core/services/GenerationService.ts` — 前端统一生成服务入口
- `src/commands/aiRuntime.ts` — 前端 AI Runtime 命令桥
- `src/core/theme/runtimeTheme.ts` — 运行时主题应用逻辑
- `src/stores/settingsStore.ts` — 主题/界面设置状态源
- `electron-builder.yml` — 打包、资源、发布配置
