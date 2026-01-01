# Tab 工作区开发指南

本文档说明如何在 Henji-AI 中开发新的 Tab 工作区。

## 架构概览

```
App.tsx
├── WindowControls.tsx      ← 标题栏 + Tab 切换按钮
└── TabContainer.tsx        ← 工作区容器
    ├── ConversationWorkspace.tsx  ← 对话 Tab
    ├── CanvasPlaceholder.tsx      ← 画布 Tab (开发中)
    └── ToolboxPlaceholder.tsx     ← 工具箱 Tab (开发中)
```

## 添加新 Tab

### 1. 创建工作区组件

在 `src/workspaces/` 目录下创建新组件：

```tsx
// src/workspaces/MyWorkspace.tsx
import React from 'react'

const MyWorkspace: React.FC = () => {
  return (
    <div className="h-full flex-1 bg-[#0a0a0a] flex flex-col">
      {/* 你的内容 */}
    </div>
  )
}

export default MyWorkspace
```

> **注意**: 根容器使用 `h-full flex-1`，不要用 `min-h-screen`，高度由外层控制。

### 2. 注册到 TabContainer

修改 `src/components/TabContainer.tsx`：

```tsx
// 添加懒加载导入
const MyWorkspace = lazy(() => import('../workspaces/MyWorkspace'))

// 在 JSX 中添加条件渲染
{activeTab === 'my-tab-id' && <MyWorkspace />}
```

### 3. 添加 Tab 按钮

修改 `src/components/WindowControls.tsx` 中的 `tabs` 数组：

```tsx
const tabs: TabConfig[] = [
  // ... 现有 tabs
  {
    id: 'my-tab-id',  // 与 TabContainer 中的 activeTab 值对应
    label: '我的 Tab',
    icon: (
      <svg className="w-3.5 h-3.5" ...>
        {/* 图标 */}
      </svg>
    )
  }
]
```

## 使用共享服务

### 调用 AI 模型

工作区可以使用 `ApiService` 调用任何已适配的 AI 模型：

```tsx
import { apiService } from '../services/api'

// 方式1：创建独立适配器
const adapter = apiService.createAdapter({
  type: 'ppio',      // 或 'fal', 'kie', 'modelscope'
  modelName: 'seedream-4.0'
})
const result = await adapter.generateImage({
  prompt: '...',
  model: 'seedream-4.0'
})

// 方式2：一次性调用
const result = await apiService.generateWithModel('image', {
  provider: 'fal',
  model: 'seedream-4.5',
  prompt: '...'
})
```

### 获取模型参数 Schema

```tsx
import { getModelSchema, getModelDefaultValues } from '../models'

const schema = getModelSchema('seedream-4.0')  // 获取参数定义
const defaults = getModelDefaultValues('seedream-4.0')  // 获取默认值
```

### 保存/读取数据

```tsx
import { readJsonFromAppData, writeJsonToAppData } from '../utils/save'

// 读取
const data = await readJsonFromAppData<MyDataType>('my-data.json')

// 写入
await writeJsonToAppData('my-data.json', data)
```

## 样式规范

- 背景色：`bg-[#0a0a0a]` 或 `bg-[#0a0b0d]`
- 文字色：`text-white` / `text-gray-400` / `text-gray-500`
- 边框色：`border-white/5` / `border-white/10`
- 主题色：`#00a0ea`（蓝色高亮）

## 文件结构建议

```
src/workspaces/
├── MyWorkspace/
│   ├── index.tsx           ← 主组件
│   ├── components/         ← 子组件
│   ├── hooks/              ← 自定义 hooks
│   └── utils/              ← 工具函数
```

## 注意事项

1. **独立状态**：每个 Tab 的状态应该独立管理，不要污染其他 Tab
2. **懒加载**：使用 `React.lazy` 导入工作区组件，减少首屏加载时间
3. **高度控制**：工作区根容器使用 `h-full flex-1`，避免双滚动条
4. **样式隔离**：避免使用全局样式，防止影响其他 Tab
