# AGENTS.md

使用中文回复，每次回复开头都添加"💡"
除非用户要求，否则禁止创建文档，禁止在处理完问题后创建总结文档

## 协作约定

- 允许 Codex 在完成一组相关改动、验证通过或需要保存阶段性成果时自主提交 commit
- commit 信息使用中文，简洁说明本次改动目的
- 提交前优先检查工作区，避免把无关文件、临时截图、日志或自动生成但非必要的产物误提交

## 项目概述

Henji-AI（痕迹AI）是基于 Tauri 的桌面应用，聚合多个 AI 提供商（PPIO、Fal、ModelScope、KIE）生成图像、视频和音频

## 常用命令

```bash
npm install                 # 安装依赖
npm run dev                 # 运行 Vite 开发服务器
npm run build               # 构建前端（包含 manifest 与校验）
npm run gen:model-manifest  # 生成模型清单到 src-tauri/resources/model-manifest.json
npm run check:colors        # 颜色规范检查
npm run check:model-i18n    # 模型 i18n key 校验
npm run tauri:dev           # 运行 Tauri 开发模式（Windows 需要 MSVC）
npm run tauri:dev:mac       # 运行 Tauri 开发模式（macOS）
```

**注意**: 项目使用 `@/` 作为 `src/` 的路径别名

**Windows / MSVC 注意**:

- 在 Windows 下执行 `cargo test`、`cargo build`、`tauri dev`、`tauri build` 等 Rust/Tauri 命令时，必须先进入 VS Build Tools 的开发者命令环境，再设置 `CC=cl.exe` 与 `CXX=cl.exe`
- 推荐复用 `npm run tauri:dev` / `npm run tauri:build` 中的做法，不要直接在普通 PowerShell 环境里裸跑 `cargo`
- Windows 的 `npm run tauri:dev` 默认会设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`，用于打开 WebView2 CDP 调试端口
- 如需单独运行 Rust 测试，可参考：

```powershell
$vsDevCmd = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat'
cmd.exe /c "call `"$vsDevCmd`" -arch=amd64 && set CC=cl.exe && set CXX=cl.exe && cargo test --manifest-path src-tauri\Cargo.toml"
```

**Tauri / WebView2 调试注意**:

- Tauri UI 验收应优先看真实 Tauri WebView，不要把裸浏览器打开的 Vite 页面当作最终视觉依据
- 自定义标题栏、窗口按钮、设置入口、对话/画布/工具箱切换等能力依赖 Tauri 容器，裸浏览器页面可能缺失或表现不同
- 运行 `npm run tauri:dev` 后，可通过 `http://127.0.0.1:9223/json/version` 和 `http://127.0.0.1:9223/json` 检查 CDP 是否开启
- 使用 Playwright/CDP 连接真实 WebView 时，选择 title 为 `痕迹AI`、url 为 `http://localhost:3000/` 的 page target；忽略 DevTools 自身 target
- 如果 9223 不通，先确认应用是在设置环境变量之后启动的；已打开的 WebView 不会因为后设置环境变量而自动启用 CDP

**Manifest 注意**:

- `src-tauri/resources/model-manifest.json` 是自动生成产物，不是手写主源
- 它会在 `npm run gen:model-manifest`、`npm run dev`、`npm run build`、`npm run tauri:dev`、`npm run tauri:build` 这类脚本链路中刷新
- 单纯“退出并重新打开应用”不会重新生成 manifest；修改模型定义、请求构建或运行时约束后，必须重新跑上述脚本之一

## 核心架构原则

**关键：解耦是本项目架构的基础，始终优先考虑关注点分离**

### 1. 配置驱动架构（最重要）

所有模型特定行为必须在配置中定义，而非代码：

- UI 渲染由 `src/models/{provider}/*.model.ts` 中的参数 schema 驱动
- 使用 `defineModel()` 定义模型，自动注册到 `ModelRegistry`
- **禁止**在 UI 组件中写 `if (modelId === 'specific-model')`
- **禁止**在通用组件中硬编码模型特定逻辑
- 需要模型特定行为时，扩展模型定义 schema

### 2. 生成链路边界（已更新）

模型生成主链路按以下路径执行：

- 前端：`GenerationService`（`src/core/services/GenerationService.ts`）
- 前端命令桥：`src/commands/aiRuntime.ts`
- 后端执行：`src-tauri/src/ai_runtime/`（Rust providers + 轮询 + trace）

约束：

- **禁止**在业务组件中直接发起模型生成 API 调用
- `src/core/providers/` 当前主要承载基类与兼容层（如 `ProviderFactoryRegistry`），不再承担真实 provider 执行
- 所有模型生成相关的提供商细节（鉴权、路由、请求格式、轮询、结果解析）应落在 Rust `ai_runtime/providers/*.rs`
- 非模型生成场景（如更新检查、资源下载/转换）允许在服务层封装网络请求，但禁止散落在业务 UI

**注意**：`src/adapters/` 已移除，旧代码仅保存在 `old-Henji-AI/`

### 3. 严格解耦与体积治理

- **层级分离**: 组件不包含业务编排，业务层不直接实现 provider 协议，Provider/Runtime 不包含 UI 逻辑
- **文件体积策略**:
  - 新文件优先控制在 `<= 400` 行
  - `400~500` 行可接受（非阻断）
  - `> 500` 行允许少量存量存在，但应遵循“禁止继续膨胀 + 修改即拆分”
- **单一职责**: 每个文件/类/函数只做一件事，如果描述时需要用到“和”，优先拆分
- **禁止跨层导入**:
  - 组件不能导入 `providers/`（运行时实现）或 `adapters/`
  - Runtime/Provider 层不能导入 `components/`
  - 模型定义不能导入 `services/` 或 `components/`
  - 使用 `core/` 作为层间桥梁

### 4. UI Primitive 单点落地

- **统一入口**：业务组件（`components/`、`features/`、`workspaces/`）只消费 `@/components/ui` 导出的 `Ui*` 组件
- **原生标签落点**：`<button>/<input>/<select>/<textarea>` 只允许在 `src/components/ui/primitives.tsx` 中实现
- **禁止回退**：禁止在业务组件重新引入原生控件并单独写一套样式
- **通用优先**：能复用现有通用组件时，优先复用现成的 `Ui*`、`Dropdown`、`PanelTrigger` 等组件，不要随手新写“看起来差不多”的组件
- **新增门槛**：只有在现有通用组件确实覆盖不了需求时，才考虑新增组件；动手前先告诉用户原因和替代方案，等用户确认后再创建
- **样式令牌规则**：通用视觉 token 在 `src/components/ui/styleTokens.ts` 维护，业务组件不直接复制 token 字符串
- **颜色令牌规则**：颜色值统一由 `src/index.css`（CSS 变量）+ `tailwind.config.js`（语义色映射）+ `src/core/theme/colorTokens.ts`（TS 常量）提供
- **颜色使用规则**：业务组件优先使用语义类（如 `bg-app`/`text-text-dark`/`border-border-dark`）与 `styleTokens`
- **颜色查改入口**：调色只允许在 `src/index.css`、`tailwind.config.js`、`src/components/ui/styleTokens.ts` 三处改动
- **新增交互控件时**：优先扩展 `Ui*`（如 `UiButton`/`UiInput`/`UiOptionButton`），再由业务层复用

### 5. 画布模块拆分约定

- `src/features/canvas/Canvas.tsx` 只保留编排与接线，不承载复杂业务实现
- 画布行为优先放入 hooks：
  - `src/features/canvas/hooks/useCanvasDuplication.ts`
  - `src/features/canvas/hooks/useCanvasNodeMenu.ts`
  - `src/features/canvas/hooks/useCanvasShortcuts.ts`
- 画布 UI 叠层与展示优先抽离到 `src/features/canvas/ui/`（例如 `CanvasOverlays.tsx`、`CanvasEmptyHint.tsx`）
- 通用计算与连接预览逻辑放在 `src/features/canvas/canvasUtils.ts`

### 6. 主题与运行时样式落地约定

- `settingsStore` 中的 `themeTonePreset` / `uiRadiusPreset` / `accentColor` 变更后，必须同步到 `document.documentElement`（`data-*` 或 CSS 变量）
- 禁止“有设置项但未生效”的状态长期存在；新增主题设置时需同时提交“状态 + 应用层同步器”
- 主题状态必须单一数据源，避免多套 store 并存且互不联动

### 7. 根级 Provider 挂载约定

- 全局 Provider（如拖拽、全局菜单、通知）只允许在应用根层挂载一次
- 禁止在多个根容器重复包裹同一 Provider，避免事件重复订阅与状态分叉

## 目录结构

```text
src/
├── commands/          # 前端到 Tauri 的命令桥（含 aiRuntime）
├── components/        # React UI 组件（展示 + 轻交互）
├── core/              # 前端核心（模型定义、注册、请求构建、兼容层）
│   ├── providers/
│   │   ├── base/                  # ProviderHandler 基类与类型
│   │   └── ProviderFactoryRegistry.ts # 兼容层（非真实 provider 执行）
│   ├── services/                  # GenerationService
│   ├── linkage/                   # 参数联动引擎
│   ├── request/                   # 请求构建器
│   └── types/                     # 核心类型定义
├── features/          # 领域功能（含主画布实现）
├── models/            # 模型定义（*.model.ts）
├── services/          # 领域服务（数据库/上传/更新检查/预设等）
├── stores/            # Zustand 状态管理
├── hooks/             # 可复用 React 逻辑
├── utils/             # 纯工具函数
└── workspaces/        # 工作区容器

src-tauri/src/ai_runtime/
├── commands.rs        # Tauri 命令入口
├── providers/         # 实际 provider 执行（fal/kie/modelscope/ppio）
├── polling.rs         # 轮询
├── request_builder_dsl.rs
└── ...                # key_store / trace / upload / task_registry 等
```

old-Henji-AI/           # 旧项目代码备份（仅供对照）

## 架构迁移状态（重要）

项目已完成从 Adapter 到 Provider Runtime 的主迁移：

- ✅ `src/adapters/` 已移除，旧代码保存在 `old-Henji-AI/`
- ✅ 前端模型生成统一走 `GenerationService -> aiRuntime`
- ✅ Provider 实际执行下沉到 Rust `ai_runtime/providers/*.rs`
- ✅ 构建前自动生成 `src-tauri/resources/model-manifest.json`

当前开发基线：

- 新模型开发：`defineModel` + `.model.ts` + i18n + manifest 构建链路
- 模型生成相关改动：优先改 Rust runtime 与模型配置，不在 UI 写 provider 特判
- 非模型生成网络能力：放在对应 `services/` 领域服务集中封装

## 关键约束（不可违反）

### 解耦约束

1. **文件体积治理（放宽）**
   - `<= 400` 行仍为优先目标
   - `400~500` 行可接受
   - `> 500` 行允许少量存量，但禁止继续膨胀，且修改时优先拆分

2. **禁止跨层导入**
   - 组件不能导入 Runtime Provider 实现或旧 adapters
   - Runtime/Provider 不能导入 UI 组件
   - 模型不能导入 `services/` 或 `components/`

3. **禁止在业务 UI 直接走模型 API**
   - 模型生成主链路必须通过 `GenerationService + src/commands/aiRuntime.ts + src-tauri/ai_runtime`
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
npm run build   # 自动生成 manifest + 颜色校验 + i18n 校验 + 编译构建
npm run dev     # 前端调试
npm run tauri:dev  # 端到端联调（推荐）
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

## 重构后回归检查

每次涉及 UI / 画布 / 模型参数重构后，优先执行快速检查，`npm run build` 只在需要验证完整类型链路、最终产物或发布前再跑：

```bash
npm run gen:model-manifest
npm run check:colors
npm run check:model-i18n
npm run check:rust:logging
npm run lint
```

`npm run build` 很费时间，不要无必要地频繁执行。

```powershell
# 原生控件检查（命中应仅在 primitives.tsx）
$files = Get-ChildItem src -Recurse -Include *.tsx
$matches = $files | Select-String -Pattern '<button','<input','<select','<textarea' -CaseSensitive
$matches | Where-Object { $_.Path -notlike '*src\components\ui\primitives.tsx' }

# 颜色硬编码检查
Get-ChildItem src -Recurse -Include *.ts,*.tsx | Select-String -Pattern '#[0-9a-fA-F]{3,8}|rgba?\('

# any 增量检查
Get-ChildItem src -Recurse -Include *.ts,*.tsx | Select-String -Pattern '\bany\b'

# 文件行数治理检查（重点关注 > 500）
powershell -Command "$files = Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx; foreach ($f in $files) { $count = (Get-Content $f.FullName).Count; if ($count -gt 500) { Write-Output \"$($f.FullName)`t$count\" } }"
```

期望结果：

- 快速检查优先通过；`npm run build` 仅在确有需要时执行
- 原生控件命中仅存在于 `src/components/ui/primitives.tsx`
- 新增改动不引入新的颜色硬编码
- 不新增 `any`（允许存量，禁止增量）
- 新文件尽量 `<= 400` 行；`400~500` 可接受；`> 500` 需有拆分计划并避免继续增长

## 常见问题

**模型未显示：**
- 检查文件命名：必须以 `.model.ts` 结尾
- 检查文件位置：必须在 `src/models/` 中
- 先跑 `npm run gen:model-manifest` 和 `npm run lint`
- 需要确认类型和产物时，再跑 `npm run build`

**联动不工作：**
- 验证 `trigger` 和 `target` 参数 ID
- 检查 `condition` 函数逻辑

**请求格式错误：**
- 在 `request.builder()` 中增加最小日志定位
- 对照 `src-tauri/resources/model-manifest.json` 检查输出 builder 结果

## 技术栈

- **框架**: Tauri 2.0 (Rust 后端)
- **前端**: React 18 + TypeScript
- **构建工具**: Vite 4
- **样式**: Tailwind CSS
- **数据库**: SQLite (Tauri 插件)
- **国际化**: i18next

## 重要文件

- `src/core/ModelRegistry.ts` - 模型注册中心
- `src/core/defineModel.ts` - 模型定义辅助函数
- `src/core/services/GenerationService.ts` - 前端统一生成服务入口
- `src/commands/aiRuntime.ts` - 前端到 Tauri AI Runtime 命令桥
- `src/core/providers/base/` - Provider 基类与类型（兼容层）
- `src/core/providers/ProviderFactoryRegistry.ts` - Provider 注册兼容层
- `src-tauri/src/ai_runtime/commands.rs` - Tauri AI Runtime 命令入口
- `src-tauri/src/ai_runtime/providers/` - 真实 provider 执行实现
- `src-tauri/resources/model-manifest.json` - 模型清单（构建自动生成）
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
- `docs/model-adaptation-guide-new.md` - 模型适配指南（新架构）
- `迁移计划_新系统完全替代adapters/清单.md` - 历史迁移清单（仅供对照）
