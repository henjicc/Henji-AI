# 2-2-3 实现CompositePanel

## 目标

实现通用可组合面板系统，支持通过配置组合多个子组件

## 背景

特殊面板系统需要两种实现方式：
1. 专用面板：如 ModelSelectorPanel，有复杂交互逻辑
2. 可组合面板：如 ResolutionPanel，由多个基础组件组合

可组合面板优势：
- 通过配置驱动，无需编写专门代码
- 组件可复用
- 支持灵活的布局和联动
- 降低开发成本

## 前置依赖

- [ ] 1-1-2：定义参数类型系统
- [ ] 2-2-1：实现PanelRegistry

## 实施步骤

1. [ ] 定义可组合面板配置接口
   - 创建 `src/core/types/CompositePanel.ts`
   - 定义 CompositePanelConfig 接口
   - 定义 ComponentConfig 接口
   - 定义 ComponentLinkage 接口

2. [ ] 创建基础子组件
   - AspectRatioSelector - 比例选择器
   - QualityTierSelector - 质量档位选择器
   - CustomSizeInput - 自定义尺寸输入
   - PreviewDisplay - 预览显示
   - SearchInput - 搜索输入
   - FilterTabs - 筛选标签
   - GridSelector - 网格选择器

3. [ ] 实现 CompositePanel 容器
   - 创建 `src/components/panels/CompositePanel.tsx`
   - 支持 vertical/horizontal/grid 布局
   - 渲染所有子组件
   - 管理组件间通信

4. [ ] 实现组件注册系统
   - 创建子组件注册表
   - registerComponent(type, component)
   - getComponent(type)

5. [ ] 实现组件间联动
   - 处理 ComponentLinkage 配置
   - 支持 filter/reset/update 效果
   - 管理联动执行顺序

6. [ ] 实现条件显示
   - 支持 showWhen 配置
   - 动态显示/隐藏组件

7. [ ] 编写示例配置
   - 使用 CompositePanel 实现分辨率面板
   - 验证配置驱动方式可行

8. [ ] 编写文档和测试
   - 组件配置文档
   - 联动配置示例
   - 单元测试和集成测试

## 涉及文件

### 新建文件
- `src/core/types/CompositePanel.ts` - 配置接口
- `src/components/panels/CompositePanel.tsx` - 容器组件
- `src/components/panels/composite/` - 子组件目录
  - `AspectRatioSelector.tsx`
  - `QualityTierSelector.tsx`
  - `CustomSizeInput.tsx`
  - `PreviewDisplay.tsx`
  - `SearchInput.tsx`
  - `FilterTabs.tsx`
  - `GridSelector.tsx`
- `src/components/panels/composite/registry.ts` - 组件注册表
- `src/components/panels/__tests__/CompositePanel.test.tsx` - 测试

### 修改文件
- `src/components/panels/PanelRegistry.ts` - 注册 CompositePanel

## 验收标准

- [ ] 支持 vertical/horizontal/grid 三种布局
- [ ] 支持所有计划的基础子组件
- [ ] 支持组件间联动（filter/reset/update）
- [ ] 支持条件显示（showWhen）
- [ ] 可通过配置实现分辨率面板
- [ ] 组件注册系统工作正常
- [ ] 单元测试覆盖率 > 80%

## 测试方法

### 测试1：基础渲染
```typescript
const config: CompositePanelConfig = {
  layout: 'vertical',
  gap: 16,
  components: [
    {
      id: 'aspectRatio',
      type: 'aspect-ratio',
      label: { zh: '比例', en: 'Aspect Ratio' },
      config: {
        options: ['16:9', '9:16', '1:1']
      }
    },
    {
      id: 'quality',
      type: 'quality-tier',
      label: { zh: '质量', en: 'Quality' },
      config: {
        options: [
          { value: '720P', label: '720P' },
          { value: '1080P', label: '1080P' }
        ]
      }
    }
  ]
}

render(<CompositePanel config={config} value={{}} onChange={() => {}} />)

// 验证两个组件都渲染
expect(screen.getByText('比例')).toBeInTheDocument()
expect(screen.getByText('质量')).toBeInTheDocument()
```

### 测试2：组件联动
```typescript
const config: CompositePanelConfig = {
  layout: 'vertical',
  components: [
    { id: 'aspectRatio', type: 'aspect-ratio', /* ... */ },
    { id: 'customSize', type: 'custom-size', /* ... */ }
  ],
  linkages: [
    {
      source: 'aspectRatio',
      target: 'customSize',
      effect: 'update',
      handler: (aspectRatio) => {
        return calculateDefaultSize(aspectRatio)
      }
    }
  ]
}

const { result } = renderHook(() => {
  const [value, setValue] = useState({})
  return { value, setValue }
})

render(
  <CompositePanel
    config={config}
    value={result.current.value}
    onChange={result.current.setValue}
  />
)

// 修改比例
fireEvent.click(screen.getByText('16:9'))

// 验证自定义尺寸自动更新
await waitFor(() => {
  expect(result.current.value.customSize.width).toBe(1920)
  expect(result.current.value.customSize.height).toBe(1080)
})
```

### 测试3：条件显示
```typescript
const config: CompositePanelConfig = {
  layout: 'vertical',
  components: [
    { id: 'aspectRatio', type: 'aspect-ratio', /* ... */ },
    {
      id: 'customSize',
      type: 'custom-size',
      showWhen: (value) => value.aspectRatio !== 'smart'
    }
  ]
}

const { rerender } = render(
  <CompositePanel config={config} value={{ aspectRatio: '16:9' }} />
)

// 自定义尺寸应该显示
expect(screen.getByText('自定义尺寸')).toBeInTheDocument()

// 切换到智能模式
rerender(
  <CompositePanel config={config} value={{ aspectRatio: 'smart' }} />
)

// 自定义尺寸应该隐藏
expect(screen.queryByText('自定义尺寸')).not.toBeInTheDocument()
```

## 风险与注意事项

### 风险
- 配置过于复杂，难以理解
- 组件间联动可能有循环依赖

### 注意事项
- 保持子组件简单和通用
- 联动逻辑应在容器中处理，不在子组件中
- 子组件应该是纯展示组件
- 配置应该易于理解和维护
- 提供充分的示例和文档

## 配置接口设计

```typescript
// src/core/types/CompositePanel.ts

interface CompositePanelConfig {
  layout: 'vertical' | 'horizontal' | 'grid'
  gap?: number
  gridColumns?: number
  components: ComponentConfig[]
  linkages?: ComponentLinkage[]
}

interface ComponentConfig {
  id: string
  type: ComponentType
  label?: I18nText
  config: any  // 组件特定配置
  showWhen?: (compositeValue: any) => boolean
}

interface ComponentLinkage {
  source: string
  target: string
  effect: 'filter' | 'reset' | 'update'
  handler: (sourceValue: any, targetConfig: any) => any
}

type ComponentType =
  | 'aspect-ratio'
  | 'quality-tier'
  | 'custom-size'
  | 'preview'
  | 'search'
  | 'filter'
  | 'grid'
```

## CompositePanel 实现参考

```typescript
// src/components/panels/CompositePanel.tsx

import React, { useMemo } from 'react'
import { componentRegistry } from './composite/registry'
import type { CompositePanelConfig } from '@/core/types/CompositePanel'

interface CompositePanelProps {
  config: CompositePanelConfig
  value: Record<string, any>
  onChange: (value: Record<string, any>) => void
}

export const CompositePanel: React.FC<CompositePanelProps> = ({
  config,
  value,
  onChange
}) => {
  // 处理子组件值变化
  const handleComponentChange = (componentId: string, componentValue: any) => {
    const newValue = { ...value, [componentId]: componentValue }

    // 执行联动
    if (config.linkages) {
      for (const linkage of config.linkages) {
        if (linkage.source === componentId) {
          const targetComponent = config.components.find(c => c.id === linkage.target)
          if (targetComponent) {
            const updatedValue = linkage.handler(componentValue, targetComponent.config)
            newValue[linkage.target] = updatedValue
          }
        }
      }
    }

    onChange(newValue)
  }

  // 渲染子组件
  const renderComponent = (componentConfig: ComponentConfig) => {
    // 检查显示条件
    if (componentConfig.showWhen && !componentConfig.showWhen(value)) {
      return null
    }

    const Component = componentRegistry.get(componentConfig.type)
    if (!Component) {
      console.warn(`Unknown component type: ${componentConfig.type}`)
      return null
    }

    return (
      <div key={componentConfig.id} className="composite-panel-component">
        {componentConfig.label && (
          <label className="component-label">
            {typeof componentConfig.label === 'string'
              ? componentConfig.label
              : componentConfig.label.zh}
          </label>
        )}
        <Component
          config={componentConfig.config}
          value={value[componentConfig.id]}
          onChange={(v) => handleComponentChange(componentConfig.id, v)}
        />
      </div>
    )
  }

  // 布局样式
  const layoutStyle = useMemo(() => {
    if (config.layout === 'grid') {
      return {
        display: 'grid',
        gridTemplateColumns: `repeat(${config.gridColumns || 2}, 1fr)`,
        gap: `${config.gap || 16}px`
      }
    }
    return {
      display: 'flex',
      flexDirection: config.layout === 'vertical' ? 'column' : 'row',
      gap: `${config.gap || 16}px`
    }
  }, [config.layout, config.gap, config.gridColumns])

  return (
    <div className="composite-panel" style={layoutStyle}>
      {config.components.map(renderComponent)}
    </div>
  )
}
```

## 回滚方案

1. 从 PanelRegistry 移除 CompositePanel 注册
2. 删除 `src/components/panels/CompositePanel.tsx`
3. 删除 `src/components/panels/composite/` 目录
4. 删除配置接口定义
