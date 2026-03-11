# CLAUDE.md

使用中文回复，每次回复开头都添加"💡"
除非用户要求，否则禁止创建文档，禁止在处理完问题后创建总结文档

## 项目概述

Henji-AI（痕迹AI）是基于 Tauri 的桌面应用，聚合多个 AI 提供商（PPIO、Fal、ModelScope、KIE）生成图像、视频和音频。采用 Provider 架构 + 配置驱动模型定义。

## 常用命令

```bash
npm install              # 安装依赖
npm run dev              # 运行 Vite 开发服务器
npm run build            # 构建前端
npm run tauri:dev        # 运行 Tauri 开发模式（Windows 需要 MSVC）
npm run tauri:dev:mac    # 运行 Tauri 开发模式（macOS）
```

**注意**: 项目使用 `@/` 作为 `src/` 的路径别名

## 核心架构原则

**关键：解耦是本项目架构的基础，始终优先考虑关注点分离**

### 1. 配置驱动架构（最重要）

所有模型特定行为必须在配置中定义，而非代码：

- UI 渲染由 `src/models/{provider}/*.model.ts` 中的参数 schema 驱动
- 使用 `defineModel()` 定义模型，自动注册到 `ModelRegistry`
- **禁止**在 UI 组件中写 `if (modelId === 'specific-model')`
- **禁止**在通用组件中硬编码模型特定逻辑
- 需要模型特定行为时，扩展模型定义 schema

### 2. 提供商隔离模式

内部系统与外部 API 完全隔离：

- 所有外部 API 调用必须通过 `src/core/providers/`（新系统）
- **禁止**在业务组件中直接使用 `fetch()` 或 `axios`；服务层仅允许封装非模型生成场景的网络请求
- 每个提供商有自己的 Provider 类实现 `ProviderHandler` 接口
- Provider 处理所有提供商特定细节（认证、请求格式、响应解析、轮询）
- 通过 `GenerationService` 统一调用各提供商

**注意**：`src/adapters/` 已移除，旧代码仅保存在 `old-Henji-AI/`

### 3. 严格解耦

- **层级分离**: 组件不包含业务逻辑，业务逻辑不直接调用 API，Provider 不包含 UI 逻辑
- **文件大小限制**: 每个文件最多 400 行（硬性约束）
  - 超过 350 行时必须重构：提取子组件、移动逻辑到 hooks、提取工具函数
- **单一职责**: 每个文件/类/函数只做一件事，如果描述时用到"和"字，就需要拆分
- **禁止跨层导入**:
  - 组件不能导入 `providers/` 或 `adapters/`
  - Provider 不能导入 `components/`
  - 模型不能导入 `services/` 或 `components/`
  - 使用 `core/` 作为层间桥梁

### 4. UI Primitive 单点落地（新增）

- **统一入口**：业务组件（`components/`、`features/`、`workspaces/`）只消费 `@/components/ui` 导出的 `Ui*` 组件
- **原生标签落点**：`<button>/<input>/<select>/<textarea>` 只允许在 `src/components/ui/primitives.tsx` 中实现
- **禁止回退**：禁止在业务组件重新引入原生控件并单独写一套样式
- **样式令牌规则**：通用视觉 token 在 `src/components/ui/styleTokens.ts` 维护，业务组件不直接复制 token 字符串
- **颜色令牌规则**：颜色值统一由 `src/index.css`（CSS 变量）+ `tailwind.config.js`（语义色映射）+ `src/core/theme/colorTokens.ts`（TS 常量）提供
- **颜色使用规则**：业务组件优先使用语义类（如 `bg-app`/`text-text-dark`/`border-border-dark`）与 `styleTokens`，避免散落色值
- **颜色查改入口**：调色时只允许在 `src/index.css`、`tailwind.config.js`、`src/components/ui/styleTokens.ts` 三处查找/修改，不新增额外“颜色清单”文件
- **新增交互控件时**：优先扩展 `Ui*`（如 `UiButton`/`UiInput`/`UiOptionButton`），再由业务层复用

### 5. 画布模块拆分约定（新增）

- `src/features/canvas/Canvas.tsx` 只保留编排与接线，不承载复杂业务实现
- 画布行为优先放入 hooks：
  - `src/features/canvas/hooks/useCanvasDuplication.ts`
  - `src/features/canvas/hooks/useCanvasNodeMenu.ts`
  - `src/features/canvas/hooks/useCanvasShortcuts.ts`
- 画布 UI 叠层与展示优先抽离到 `src/features/canvas/ui/`（例如 `CanvasOverlays.tsx`、`CanvasEmptyHint.tsx`）
- 通用计算与连接预览逻辑放在 `src/features/canvas/canvasUtils.ts`

### 6. 主题与运行时样式落地约定（新增）

- `settingsStore` 中的 `themeTonePreset` / `uiRadiusPreset` / `accentColor` 变更后，必须同步到 `document.documentElement`（`data-*` 或 CSS 变量）
- 禁止“有设置项但未生效”的状态长期存在；新增主题设置时需同时提交“状态 + 应用层同步器”
- 主题状态必须单一数据源，避免多套 store 并存且互不联动

### 7. 根级 Provider 挂载约定（新增）

- 全局 Provider（如拖拽、全局菜单、通知）只允许在应用根层挂载一次
- 禁止在 `main.tsx` 与 `App.tsx`（或其他根容器）重复包裹同一 Provider，避免事件重复订阅与状态分叉

## 目录结构

```
src/
├── components/        # React UI 组件（纯展示）
├── core/              # 系统核心（新架构）
│   ├── ModelRegistry.ts      # 模型注册中心
│   ├── defineModel.ts        # 模型定义辅助函数
│   ├── providers/            # 新系统：Provider 类
│   │   ├── base/             # ProviderHandler 基类
│   │   ├── PPIOProvider.ts   # PPIO 提供商实现
│   │   ├── FalProvider.ts    # Fal 提供商实现
│   │   ├── KIEProvider.ts    # KIE 提供商实现
│   │   └── ModelscopeProvider.ts # ModelScope 提供商实现
│   ├── services/             # 新系统：GenerationService
│   │   └── GenerationService.ts  # 统一生成服务
│   ├── linkage/              # 参数联动引擎
│   ├── request/              # 请求构建器
│   └── types/                # 核心类型定义
├── models/            # 模型定义（新架构）
│   ├── fal/           # Fal 提供商模型（*.model.ts）
│   ├── kie/           # KIE 提供商模型（*.model.ts）
│   ├── modelscope/    # ModelScope 提供商模型（*.model.ts）
│   └── ppio/          # PPIO 提供商模型（*.model.ts）
├── services/          # 领域服务（数据库/上传/预设等）
├── hooks/             # 可复用 React 逻辑
├── utils/             # 纯工具函数
└── workspaces/        # 主工作区组件
```
old-Henji-AI/           # 旧项目代码备份（仅供对照）

**架构迁移状态（重要）：**

项目正在进行重大架构迁移，从 Adapter 系统迁移到 Provider 系统：

- **旧系统**（已移除，保存在 `old-Henji-AI/`）：
  - `src/adapters/` - Adapter 类（历史代码）
  - `src/services/api.ts` - 旧的 API 服务（历史代码）
  - 旧模型文件：`src/models/*.ts`（已删除）
  - 手动配置：`src/components/MediaGenerator/builders/`（已删除）

- **新系统**（已完成主体搭建）：
  - `src/core/providers/` - Provider 类（ProviderHandler + 各提供商 Provider）
  - `src/core/services/GenerationService.ts` - 统一生成服务
  - 模型定义：`src/models/{provider}/*.model.ts` + `defineModel()`
  - 配置驱动：所有行为由 schema 定义

- **迁移进度**：
  - ✅ 任务01：Provider 基础架构已完成
  - ✅ 任务02：GenerationService 已完成
  - ✅ 任务03-1：PPIOProvider 已完成
  - ✅ 任务03-2：PPIO 模型映射已完成（14/14）
  - 🔄 任务04：PPIO 其他模型测试进行中（已完成 Kling 2.6 Pro）
  - ⏳ 任务05-07：其他供应商测试与清理收尾

**开发指南：**
- **新模型开发**：使用新系统（`defineModel` + Provider）
- **修改现有模型**：优先在新系统中修改
- **不要依赖 adapters**：仅保留在 `old-Henji-AI/`
- **参考迁移计划**：`迁移计划_新系统完全替代adapters/清单.md`

## 关键约束（不可违反）

### 解耦约束

1. **文件大小限制：最多 400 行**
   - 这是硬性限制，不是建议
   - 达到 350 行时开始重构
   - 大文件是解耦不足的代码异味

2. **禁止跨层导入**
   - 组件不能导入 `providers/` 或 `adapters/`
   - Provider 不能导入 `components/`
   - 模型不能导入 `services/` 或 `components/`
   - 违反表示架构理解错误

3. **禁止直接 API 调用**
   - 所有外部 API 必须通过 `src/core/providers/`（新系统）
   - 禁止在业务组件中直接使用 `fetch()` 或 `axios`
   - 服务层的网络请求仅用于非模型生成领域能力（如上传/更新检查），且必须集中封装
   - **不要使用** `src/adapters/`（旧系统，正在淘汰）

4. **禁止模型特定 UI 逻辑**
   - UI 组件必须是通用的，由模型 schema 驱动
   - 禁止在组件中写 `if (modelId === 'specific-model')`
   - 需要模型特定行为时，扩展模型定义 schema

### 类型安全约束

5. **禁止 `any` 类型**
   - 到处使用正确的 TypeScript 类型
   - 例外情况需要详细注释说明原因

6. **显式返回类型**
   - 所有导出函数应有显式返回类型

### 配置约束

7. **配置优于代码**
   - 使用模型定义，而非 if-else 语句处理模型特定行为
   - 扩展 schema，不要添加特殊情况
   - 如果你在添加基于模型 ID 的 switch 语句，说明做错了

8. **UI 一致性约束（新增）**
   - 对话模式、画布模式、工具模式必须复用同一套 `Ui*` primitives
   - 禁止“同功能组件多份实现”（例如分别维护两套按钮/输入框样式）

9. **ReferenceTextarea 规范（新增）**
   - @引用标记插入/删除/空格归一化统一走 `src/core/inputs/referenceTokens.ts`
   - 高亮渲染统一走 `src/components/ui/referenceTextareaUtils.tsx`
   - 禁止在业务组件重复实现 @引用解析、删除范围、文本高亮逻辑

10. **文件上传控件规范（新增）**
   - 上传能力统一复用 `FileUploader` / `UiInput(type=file)` 方案
   - 拖拽排序逻辑统一复用 `src/components/ui/fileUploader/useReorderDrag.ts`
   - 禁止在业务组件重复实现上传/排序基础交互

11. **颜色硬编码约束（新增）**
   - 新增/修改 UI 代码时，禁止直接写十六进制颜色（如 `#007eff`）或 `rgb/rgba` 字面量
   - 颜色应先沉淀到 `src/index.css` 变量、`tailwind.config.js` 语义色或 `src/core/theme/colorTokens.ts`
   - 例外仅限图像处理/画布绘制等算法场景（Canvas/SVG 像素绘制），且应优先复用已有 token

12. **API 调用边界约束（修订）**
   - 模型生成主链路（提交任务、轮询、结果解析）必须通过 `src/core/providers/` + `GenerationService`
   - `services/`、`utils/` 中允许存在非模型生成场景的网络请求（如更新检查、上传、资源转换），但必须封装在服务层，禁止散落到业务 UI
   - 新增外部 API 集成时，先判断是否属于“模型生成主链路”；属于则必须走 Provider，不属于则落在对应领域服务

13. **文件体积治理约束（新增）**
   - 400 行上限仍是目标约束；对存量超长文件，采用“禁止继续增长 + 修改即拆分”的治理策略
   - 新建文件禁止超过 400 行；修改存量超长文件时，优先拆出 hooks / utils / 子组件

14. **类型治理约束（修订）**
   - 目标仍为禁止 `any`，但当前存量代码较多；执行策略为“增量零新增 any”
   - 若确需新增 `any`，必须在同一处添加原因注释与后续替换计划

15. **画布实现单源约束（新增）**
   - `src/features/canvas/` 为当前主实现目录
   - `src/workspaces/canvas/` 视为历史/过渡代码，除迁移与删除外不再新增功能
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
    type: 'video',  // 'image' | 'video' | 'audio'
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
    // ... 更多参数
  ],
  linkages: [
    // 可选：参数交互规则
  ],
  endpoints: {
    selector: (params) => '/api/endpoint'
  },
  request: {
    builder: (params) => ({
      prompt: params.prompt
      // ... 映射到 API 格式
    })
  }
})
```

### 步骤 2: 验证

```bash
npm run build  # 验证 TypeScript 编译
npm run dev    # 在应用中测试
```

模型将自动被发现和注册。

## 参数类型

- `text`: 文本输入
- `number`: 数字输入
- `slider`: 滑块
- `dropdown`: 下拉选择
- `radio`: 单选按钮组
- `switch`: 布尔开关
- `image-upload`: 图片上传
- `video-upload`: 视频上传
- `composite`: 自定义面板组件

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

## 重构后回归检查（新增）

每次涉及 UI/画布重构后，至少执行：

```bash
npm run build
rg -n "<button|<input|<select|<textarea" src --glob "*.tsx"
rg -n "#[0-9a-fA-F]{3,8}|rgba?\(" src --glob "*.tsx" --glob "*.ts"
rg -n "\bany\b" src --glob "*.ts" --glob "*.tsx"
```

期望结果：
- `npm run build` 通过
- 原生控件命中仅存在于 `src/components/ui/primitives.tsx`
- 新增改动中不引入新的颜色硬编码（`#xxxxxx` / `rgb` / `rgba`）
- 不新增 `any`（允许存量，禁止增量）

文件长度硬约束检查：

```bash
powershell -Command "$files = Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx; foreach ($f in $files) { $count = (Get-Content $f.FullName).Count; if ($count -gt 400) { Write-Output \"$($f.FullName)`t$count\" } }"
```

期望结果：
- 新文件无 `> 400` 行，存量超长文件不继续膨胀并持续拆分

## 常见问题

**模型未显示：**
- 检查文件命名：必须以 `.model.ts` 结尾
- 检查文件位置：必须在 `src/models/` 中
- 运行 `npm run build` 检查 TypeScript 错误

**联动不工作：**
- 验证 `trigger` 和 `target` 参数 ID
- 检查 `condition` 函数逻辑

**请求格式错误：**
- 在 `request.builder()` 中添加 console.log
- 验证参数值类型

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
- `src/core/providers/base/` - Provider 基类（新系统）
- `src/core/services/GenerationService.ts` - 统一生成服务（新系统）
- `src/App.tsx` - 应用入口
- `docs/model-adaptation-guide-new.md` - 模型适配指南（新架构）
- `迁移计划_新系统完全替代adapters/清单.md` - 架构迁移计划
- `src/components/ui/primitives.tsx` - UI primitives 唯一原生标签落点
- `src/components/ui/styleTokens.ts` - UI 视觉 token
- `src/core/theme/colorTokens.ts` - 主题与画布颜色常量
- `src/index.css` - 全局 CSS 变量（语义色源头）
- `tailwind.config.js` - CSS 变量到 Tailwind 语义类映射
- `src/stores/settingsStore.ts` - 主题/界面设置状态源（含 tone/radius/accent）
- `src/stores/themeStore.ts` - 主题状态历史实现（修改前先确认是否保留或合并）
- `src/components/ui/ReferenceTextarea.tsx` - 引用输入与高亮核心组件
- `src/components/ui/referenceTextareaUtils.tsx` - 引用高亮渲染工具
- `src/features/canvas/canvasUtils.ts` - 画布通用计算与连接预览
- `src/features/canvas/hooks/useCanvasDuplication.ts` - 画布复制/拖拽行为
- `src/features/canvas/hooks/useCanvasNodeMenu.ts` - 节点菜单与连接交互
- `src/features/canvas/hooks/useCanvasShortcuts.ts` - 画布快捷键行为
- `src/features/canvas/ui/CanvasOverlays.tsx` - 画布叠层 UI（空态/菜单/预览）
