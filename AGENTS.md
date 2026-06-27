使用中文回复，每次回复开头都添加"💡"
除非用户要求，否则禁止创建文档，禁止在处理完问题后创建总结文档

## 协作约定

- 允许 Codex 在完成一组相关改动、验证通过或需要保存阶段性成果时自主提交 commit
- commit 信息使用中文，简洁说明本次改动目的
- 提交前优先检查工作区，避免把无关文件、临时截图、日志、安装包或自动生成但非必要的产物误提交
- 当前分支基线是 Electron 迁移分支；如需回看旧 Tauri 实现，只作对照，不在新功能里继续扩展 Tauri 路径

## 项目概述

Henji-AI（痕迹AI）是基于 **Electron + React + TypeScript** 的桌面应用，聚合多个 AI 提供商（PPIO、Fal、ModelScope、KIE）生成图像、视频和音频。

当前迁移状态：

- Electron 主壳、preload 安全 IPC、Node/TS 主进程能力已经成为开发基线
- Tauri/Rust 旧壳仍保留在仓库中，主要用于历史对照、回滚和 4.3 最终清理前的兜底
- `src-tauri/resources/model-manifest.json` 与 `src-tauri/resources/progress-seeds.json` 仍是生成产物的当前落点，并会被 Electron 打包复制到 `resources/`；目录名属于迁移残留，后续 4.3 可再重命名/收口
- 证书、公证、真实 GitHub Release 发布凭据、macOS 真机验收属于发布前收尾项；没有凭据或设备时不阻塞日常 Electron 开发

## 常用命令

```bash
npm install                    # 安装依赖
npm run dev                    # 运行裸 Vite 渲染层调试（不含 Electron 主进程能力）
npm run electron:dev           # 运行 Electron 开发模式（推荐桌面端调试）
npm run electron:build         # Electron 构建（manifest/seeds + 校验 + tsc + electron-vite）
npm run electron:pack          # 生成未安装目录包
npm run electron:dist          # 生成安装包/分发产物
npm run electron:publish       # 构建并发布到 electron-builder 配置的发布通道
npm run electron:smoke         # Electron 构建产物冒烟验收
npm run electron:canvas-stress # Electron 画布压测
npm run electron:dpi-check     # Electron DPI/分辨率检查
npm run electron:updater-e2e   # 本地模拟 updater 端到端
npm run gen:model-manifest     # 生成模型清单到 src-tauri/resources/model-manifest.json
npm run check:colors           # 颜色规范检查
npm run check:model-i18n       # 模型 i18n key 校验
npm run lint                   # 前端 lint
```

**旧 Tauri 命令仅用于回退/对照**：

```bash
npm run tauri:dev
npm run tauri:build
npm run tauri:dev:mac
npm run tauri:build:mac
```

在 Windows 下裸跑旧 Tauri/Rust 命令仍需 VS Build Tools 开发者命令环境与 `CC=cl.exe`/`CXX=cl.exe`。除非任务明确要求回归旧壳，不要优先使用 Tauri 命令做最终验收。

**注意**: 项目使用 `@/` 作为 `src/` 的路径别名。

## Electron 调试与验收注意

- 桌面能力验收优先看真实 Electron 窗口，不要把裸浏览器 Vite 页面当作最终依据
- 自定义标题栏、窗口控制、preload bridge、SQLite、safeStorage、媒体协议、自动更新、原生拖拽/剪贴板都依赖 Electron 容器
- Electron 自动化脚本会通过 CDP/Playwright 启动构建产物；如需临时手动调试，可优先复用 `scripts/lib/electronLaunch.cjs` 中的启动方式
- `electron-builder.yml` 当前配置 Windows NSIS/MSI、macOS DMG、GitHub Releases 发布通道、`better-sqlite3`/`sharp` 原生模块 unpack 与 manifest/seeds 资源分发
- 当前无代码签名证书时安装包会是未签名状态，这是已知发布限制，不属于功能阻塞

## Manifest / Seeds 注意

- `src-tauri/resources/model-manifest.json` 与 `src-tauri/resources/progress-seeds.json` 是自动生成产物，不是手写主源
- 它们会在 `npm run gen:model-manifest`、`npm run dev`、`npm run electron:dev`、`npm run electron:build`、`npm run electron:dist` 等脚本链路中刷新
- 单纯“退出并重新打开应用”不会重新生成 manifest；修改模型定义、请求构建或运行时约束后，必须重新跑上述脚本之一
- Electron 主进程会在开发态读取仓库内生成产物，在打包态读取随包 `resources/` 副本

## 核心架构原则

**关键：解耦是本项目架构的基础，始终优先考虑关注点分离。迁移只替换桌面外壳与后端能力实现，不改变业务分层。**

### 1. 配置驱动架构（最重要）

所有模型特定行为必须在配置中定义，而非代码：

- UI 渲染由 `src/models/{provider}/*.model.ts` 中的参数 schema 驱动
- 使用 `defineModel()` 定义模型，自动注册到 `ModelRegistry`
- **禁止**在 UI 组件中写 `if (modelId === 'specific-model')`
- **禁止**在通用组件中硬编码模型特定逻辑
- 需要模型特定行为时，扩展模型定义 schema

### 2. 生成链路边界（Electron 基线）

模型生成主链路按以下路径执行：

- 前端：`GenerationService`（`src/core/services/GenerationService.ts`）
- 前端命令桥：`src/commands/aiRuntime.ts`
- 平台抽象层：`src/platform/*`
- Electron preload：`electron/preload/index.ts` 暴露 `window.henjiNative.ai`
- Electron 主进程：`electron/main/ipc/ai-runtime.ts`
- 后端执行：`electron/main/services/ai-runtime/`（Node/TS providers + 上传 + 轮询 + trace + 进度学习）

约束：

- **禁止**在业务组件中直接发起模型生成 API 调用
- `src/core/providers/` 当前主要承载基类与兼容层（如 `ProviderFactoryRegistry`），不承担真实 provider 执行
- 所有模型生成相关的提供商细节（鉴权、路由、请求格式、轮询、结果解析）应落在 Electron 主进程 `electron/main/services/ai-runtime/**`
- 非模型生成场景（如更新检查、资源下载/转换）允许在服务层封装网络请求，但禁止散落在业务 UI
- 旧 Rust `src-tauri/src/ai_runtime/` 只作对照与待清理资产，不再作为新能力落点

### 3. 平台抽象层（PAL）边界

- 渲染层运行时代码统一通过 `src/platform/*`、`src/commands/*`、领域服务访问桌面能力
- **禁止**在业务 UI 新增对 `@tauri-apps/*`、Electron `ipcRenderer`、Node 内置模块的直接 import
- Electron 主进程能力经 `ipcMain` + preload 白名单暴露，保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- `src/platform/adapters/tauri/*` 是旧壳兼容层；新增能力优先实现 Electron adapter，Tauri adapter 不再扩展，除非是为删除/迁移做最小调整

### 4. 严格解耦与体积治理

- **层级分离**: 组件不包含业务编排，业务层不直接实现 provider 协议，Runtime/Provider 不包含 UI 逻辑
- **文件体积策略**:
  - 新文件优先控制在 `<= 400` 行
  - `400~500` 行可接受（非阻断）
  - `> 500` 行允许少量存量存在，但应遵循“禁止继续膨胀 + 修改即拆分”
- **单一职责**: 每个文件/类/函数只做一件事，如果描述时需要用到“和”，优先拆分
- **禁止跨层导入**:
  - 组件不能导入 runtime/provider 实现、Electron 主进程代码或旧 adapters
  - Electron 主进程不能导入 `components/`
  - 模型定义不能导入 `services/` 或 `components/`
  - 使用 `core/`、`commands/`、`platform/` 作为层间桥梁

### 5. UI Primitive 单点落地

- **统一入口**：业务组件（`components/`、`features/`、`workspaces/`）只消费 `@/components/ui` 导出的 `Ui*` 组件
- **原生标签落点**：`<button>/<input>/<select>/<textarea>` 只允许在 `src/components/ui/primitives.tsx` 中实现
- **禁止回退**：禁止在业务组件重新引入原生控件并单独写一套样式
- **通用优先**：能复用现有通用组件时，优先复用现成的 `Ui*`、`Dropdown`、`PanelTrigger` 等组件
- **新增门槛**：只有在现有通用组件确实覆盖不了需求时，才考虑新增组件；动手前先告诉用户原因和替代方案，等用户确认后再创建
- **样式令牌规则**：通用视觉 token 在 `src/components/ui/styleTokens.ts` 维护，业务组件不直接复制 token 字符串
- **颜色令牌规则**：颜色值统一由 `src/index.css`（CSS 变量）+ `tailwind.config.js`（语义色映射）+ `src/core/theme/colorTokens.ts`（TS 常量）提供
- **颜色使用规则**：业务组件优先使用语义类（如 `bg-app`/`text-text-dark`/`border-border-dark`）与 `styleTokens`
- **颜色查改入口**：调色只允许在 `src/index.css`、`tailwind.config.js`、`src/components/ui/styleTokens.ts` 三处改动
- **新增交互控件时**：优先扩展 `Ui*`（如 `UiButton`/`UiInput`/`UiOptionButton`），再由业务层复用

### 6. 画布模块拆分约定

- `src/features/canvas/Canvas.tsx` 只保留编排与接线，不承载复杂业务实现
- 画布行为优先放入 hooks：
  - `src/features/canvas/hooks/useCanvasDuplication.ts`
  - `src/features/canvas/hooks/useCanvasNodeMenu.ts`
  - `src/features/canvas/hooks/useCanvasShortcuts.ts`
- 画布 UI 叠层与展示优先抽离到 `src/features/canvas/ui/`
- 通用计算与连接预览逻辑放在 `src/features/canvas/canvasUtils.ts`

### 7. 主题与运行时样式落地约定

- `settingsStore` 中的 `themeTonePreset` / `uiRadiusPreset` / `accentColor` 变更后，必须同步到 `document.documentElement`（`data-*` 或 CSS 变量）
- 禁止“有设置项但未生效”的状态长期存在；新增主题设置时需同时提交“状态 + 应用层同步器”
- 主题状态必须单一数据源，避免多套 store 并存且互不联动

### 8. 根级 Provider 挂载约定

- 全局 Provider（如拖拽、全局菜单、通知）只允许在应用根层挂载一次
- 禁止在多个根容器重复包裹同一 Provider，避免事件重复订阅与状态分叉

## 目录结构

```text
electron/
├── main/              # Electron 主进程：窗口、IPC、协议、Node/TS 后端能力
│   ├── ipc/           # ipcMain handler 注册
│   └── services/      # db / keystore / ai-runtime / llm / image / project-package / updater 等
└── preload/           # contextBridge 安全暴露 window.henjiNative

src/
├── commands/          # 前端命令桥；对外签名稳定，内部走 platform
├── platform/          # PAL 契约 + electron/tauri adapters
├── components/        # React UI 组件（展示 + 轻交互）
├── core/              # 模型定义、注册、请求构建、GenerationService、兼容层
├── features/          # 领域功能（含主画布实现）
├── models/            # 模型定义（*.model.ts）
├── services/          # 领域服务（数据库/上传/更新检查/预设等）
├── stores/            # Zustand 状态管理
├── hooks/             # 可复用 React 逻辑
├── utils/             # 纯工具函数
└── workspaces/        # 工作区容器

src-tauri/             # 旧 Tauri/Rust 实现与当前 manifest/seeds 生成产物落点，待 4.3 清理
old-Henji-AI/          # 旧项目代码备份（仅供对照）
```

## Electron 迁移状态（重要）

已完成/基本完成：

- ✅ Electron 工程骨架、窗口/标题栏、preload 安全 IPC
- ✅ 渲染层经 PAL 收口，业务代码不再直接依赖 Tauri invoke
- ✅ SQLite（better-sqlite3）、safeStorage 密钥、系统文件/对话框/外链/日志
- ✅ `henji-media://` 媒体协议与 Range 支持
- ✅ AI Runtime、LLM 流式 Runtime、图片处理、剪贴板/拖拽、项目包导入导出
- ✅ electron-builder 打包、electron-updater 主链路、本机安装器与本地 updater E2E
- ✅ Electron smoke、画布压测、DPI 自动化检查

仍未做或可后置：

- 4.3：删除 `src-tauri/`、Tauri 依赖/脚本、Tauri PAL adapter，并重命名 manifest/seeds 资源落点
- macOS 真实设备上的 DMG、safeStorage、拖拽/剪贴板、透明窗口验收
- Windows/macOS 代码签名与 macOS notarization（需要证书/Apple 账号）
- 真实 GitHub Release 发布凭据下的线上自动更新
- 用真实用户旧数据/API key/历史项目包做最终手动回归
- 图像水印/分镜文字与旧 Rust 输出的像素级基线对比（功能 smoke 已过，像素级比较可后置）

## 关键约束（不可违反）

### 解耦约束

1. **文件体积治理（放宽）**
   - `<= 400` 行仍为优先目标
   - `400~500` 行可接受
   - `> 500` 行允许少量存量，但禁止继续膨胀，且修改时优先拆分

2. **禁止跨层导入**
   - 组件不能导入 Electron 主进程、Runtime Provider 实现或旧 adapters
   - Runtime/Provider 不能导入 UI 组件
   - 模型不能导入 `services/` 或 `components/`

3. **禁止在业务 UI 直接走模型 API**
   - 模型生成主链路必须通过 `GenerationService + src/commands/aiRuntime.ts + src/platform + electron/main/services/ai-runtime`
   - 业务组件禁止散落 `fetch()` / `axios` 调用模型生成接口

4. **禁止模型特定 UI 逻辑**
   - UI 必须由模型 schema 驱动
   - 禁止在组件中写 `if (modelId === 'specific-model')`
   - 需要模型特定行为时，扩展 schema

### 类型安全约束

5. **`any` 治理：增量零新增**
   - 存量 `any` 允许逐步治理
   - 新增或修改代码时禁止引入新的裸 `any`
   - 若确需新增，必须同处写明原因与替换计划

6. **导出函数显式返回类型**
   - 新增/修改的导出函数应补齐显式返回类型

### 配置与一致性约束

7. **配置优于代码**
   - 使用模型定义，而不是 if-else 或 switch 硬编码模型行为
   - 如果你在添加基于 modelId 的分支，先考虑扩展 schema

8. **UI 一致性约束**
   - 对话模式、画布模式、工具模式复用同一套 `Ui*` primitives
   - 禁止同功能多份实现

9. **ReferenceTextarea 规范**
   - @引用标记插入/删除/空格归一化统一走 `src/core/inputs/referenceTokens.ts`
   - 高亮渲染统一走 `src/components/ui/referenceTextareaUtils.tsx`
   - 禁止在业务组件重复实现 @引用解析和高亮

10. **文件上传控件规范**
   - 上传能力统一复用 `FileUploader` / `UiInput(type=file)`
   - 拖拽排序统一复用 `src/components/ui/fileUploader/useReorderDrag.ts`
   - 禁止在业务组件重复实现上传/排序基础交互

11. **颜色硬编码约束**
   - UI 代码禁止直接写十六进制颜色或 `rgb/rgba` 字面量
   - 颜色应沉淀到 `src/index.css`、`tailwind.config.js`、`src/core/theme/colorTokens.ts`
   - 图像处理/画布像素算法可例外，但应优先复用 token

12. **画布实现单源约束**
   - `src/features/canvas/` 为当前主实现目录
   - `src/workspaces/canvas/` 视为历史/过渡目录，除迁移与删除外不新增功能
   - 新画布能力必须落在 `src/features/canvas/`

## 添加新模型

### 步骤 1: 创建模型文件

在 `src/models/{provider}/{model-name}.model.ts` 中：

```typescript
import { defineModel } from '@/core'

export const myModel = defineModel({
  meta: {
    id: 'unique-model-id',
    provider: 'provider-name',
    type: 'video', // 'image' | 'video' | 'audio'
    name: { zh: '中文名', en: 'English Name' },
    tags: ['text-to-video'],
    polling: { interval: 3000, maxAttempts: 120 }
  },
  params: [
    {
      id: 'prompt',
      type: 'text',
      order: 1,
      name: { zh: '提示词', en: 'Prompt' },
      default: '',
      required: true
    }
  ],
  linkages: [],
  endpoints: {
    selector: (params) => '/api/endpoint'
  },
  request: {
    builder: (params) => ({
      prompt: params.prompt
    })
  }
})
```

### 步骤 2: 验证

```bash
npm run gen:model-manifest
npm run check:model-i18n
npm run electron:build
npm run electron:dev
```

## 参数类型（以 `src/core/types/ComponentTypes.ts` 为准）

- `text`: 单行文本输入
- `textarea`: 多行文本输入
- `number`: 数字输入
- `dropdown`: 下拉选择
- `switch`: 布尔开关
- `radio`: 单选按钮组
- `panel`: 参数分组面板
- `composite`: 自定义复合面板
- `image-upload`: 图片上传
- `video-upload`: 视频上传
- `resolution`: 分辨率选择器
- `aspect-ratio`: 宽高比选择器

## 联动系统

联动定义参数交互，执行优先级：
1. `reset` - 重置为默认值
2. `filterOptions` - 过滤选项
3. `filterRange` - 调整范围
4. `setValue` - 设置值
5. `autoSwitch` - 条件切换
6. `disable` - 禁用参数
7. `hide` - 隐藏参数
8. `custom` - 自定义逻辑

## 调试工具（开发模式）

浏览器控制台：

```javascript
window.__MODEL_REGISTRY__      // 查看所有注册的模型
window.__listModels()          // 表格格式列出模型
window.__getModelStats()       // 显示注册表统计
window.__reloadModels()        // 重新加载所有模型
```

Electron preload：

```javascript
window.henjiNative             // Electron 安全桥，包含 db/ai/image/media/updater 等白名单能力
```

## 重构后回归检查

每次涉及 UI / 画布 / 模型参数 / Electron 主进程能力重构后，优先执行快速检查，`npm run electron:build` 只在需要验证完整类型链路、最终产物或发布前再跑：

```bash
npm run gen:model-manifest
npm run check:colors
npm run check:model-i18n
npm run lint
npx tsc -p tsconfig.electron.json --noEmit
npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0
npm run electron:smoke
```

`npm run electron:build` / `npm run electron:dist` 较费时间，不要无必要地频繁执行。

```powershell
# 原生控件检查（命中应仅在 primitives.tsx）
$files = Get-ChildItem src -Recurse -Include *.tsx
$matches = $files | Select-String -Pattern '<button','<input','<select','<textarea' -CaseSensitive
$matches | Where-Object { $_.Path -notlike '*src\components\ui\primitives.tsx' }

# 颜色硬编码检查
Get-ChildItem src -Recurse -Include *.ts,*.tsx | Select-String -Pattern '#[0-9a-fA-F]{3,8}|rgba?\('

# any 增量检查
Get-ChildItem src -Recurse -Include *.ts,*.tsx,electron\*.ts | Select-String -Pattern '\bany\b'

# 文件行数治理检查（重点关注 > 500）
powershell -Command "$files = Get-ChildItem -Path src,electron -Recurse -Include *.ts,*.tsx; foreach ($f in $files) { $count = (Get-Content $f.FullName).Count; if ($count -gt 500) { Write-Output \"$($f.FullName)`t$count\" } }"
```

期望结果：

- 快速检查优先通过；`npm run electron:build` 仅在确有需要时执行
- 原生控件命中仅存在于 `src/components/ui/primitives.tsx`
- 新增改动不引入新的颜色硬编码
- 不新增 `any`（允许存量，禁止增量）
- 新文件尽量 `<= 400` 行；`400~500` 可接受；`> 500` 需有拆分计划并避免继续增长

## 常见问题

**模型未显示：**
- 检查文件命名：必须以 `.model.ts` 结尾
- 检查文件位置：必须在 `src/models/` 中
- 先跑 `npm run gen:model-manifest` 和 `npm run lint`
- 需要确认 Electron 运行产物时，再跑 `npm run electron:build` / `npm run electron:smoke`

**联动不工作：**
- 验证 `trigger` 和 `target` 参数 ID
- 检查 `condition` 函数逻辑

**请求格式错误：**
- 在模型 `request.builder()` 中增加最小日志定位
- 对照 `src-tauri/resources/model-manifest.json` 检查输出 builder 结果
- Electron 运行时错误优先看 `electron/main/services/ai-runtime/trace.ts` 相关 trace 与主进程日志

**Electron 安装包未签名：**
- 当前无签名证书时这是预期状态
- 等 Windows 证书、Apple Developer 账号/公证条件具备后，再在 `electron-builder.yml` 增加签名配置并做 4.2 真实发布验收

## 技术栈

- **桌面框架**: Electron 42 + Electron 主进程 Node/TS
- **前端**: React 18 + TypeScript
- **构建工具**: Vite 4 + electron-vite
- **打包/更新**: electron-builder + electron-updater
- **样式**: Tailwind CSS
- **数据库**: SQLite（Electron 下 `better-sqlite3`）
- **国际化**: i18next
- **旧壳**: Tauri 2.0 / Rust 保留至 4.3 清理

## 重要文件

- `electron/main/index.ts` - Electron 主进程入口
- `electron/main/window.ts` - Electron 窗口与无边框标题栏行为
- `electron/main/protocol.ts` - `henji-media://` 媒体协议
- `electron/main/ipc/` - Electron IPC handler
- `electron/main/services/` - Electron Node/TS 后端能力
- `electron/preload/index.ts` - preload 安全桥
- `electron-builder.yml` - Electron 打包、资源、发布配置
- `src/platform/` - 平台抽象层（PAL）
- `src/core/ModelRegistry.ts` - 模型注册中心
- `src/core/defineModel.ts` - 模型定义辅助函数
- `src/core/services/GenerationService.ts` - 前端统一生成服务入口
- `src/commands/aiRuntime.ts` - 前端 AI Runtime 命令桥
- `src/components/ui/primitives.tsx` - UI primitives 唯一原生标签落点
- `src/components/ui/styleTokens.ts` - UI 视觉 token
- `src/core/theme/colorTokens.ts` - 主题与画布颜色常量
- `src/core/theme/runtimeTheme.ts` - 运行时主题应用逻辑
- `src/stores/settingsStore.ts` - 主题/界面设置状态源
- `src/components/ui/ReferenceTextarea.tsx` - 引用输入核心组件
- `src/components/ui/referenceTextareaUtils.tsx` - 引用高亮渲染工具
- `src/features/canvas/canvasUtils.ts` - 画布通用计算与连接预览
- `src/features/canvas/hooks/useCanvasDuplication.ts` - 画布复制/拖拽行为
- `src/features/canvas/hooks/useCanvasNodeMenu.ts` - 节点菜单与连接交互
- `src/features/canvas/hooks/useCanvasShortcuts.ts` - 画布快捷键行为
- `src/features/canvas/ui/CanvasOverlays.tsx` - 画布叠层 UI
- `src-tauri/resources/model-manifest.json` - 模型清单（自动生成，当前仍在旧目录）
- `src-tauri/resources/progress-seeds.json` - 进度学习 seeds（自动生成，当前仍在旧目录）
- `docs/task/项目计划/` - Tauri → Electron 迁移计划与收尾状态
