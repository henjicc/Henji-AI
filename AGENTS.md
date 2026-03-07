# AGENTS.md

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
- **禁止**在组件或服务中直接使用 `fetch()` 或 `axios`
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
   - 禁止在组件/服务中直接使用 `fetch()` 或 `axios`
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
