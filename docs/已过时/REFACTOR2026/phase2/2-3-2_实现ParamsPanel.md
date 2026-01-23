# 2-3-2 实现ParamsPanel

## 目标

实现参数面板容器组件，自动渲染模型的所有参数

## 背景

ParamsPanel 是参数系统的最外层容器：
- 根据 modelId 加载参数定义
- 使用 useModelParams 管理状态
- 使用 ParamRenderer 渲染每个参数
- 按 order 排序显示
- 提供统一的布局和样式

## 前置依赖

- [ ] 1-2-1：实现ModelRegistry核心
- [ ] 1-3-1：实现useModelParams Hook
- [ ] 2-3-1：实现ParamRenderer

## 实施步骤

1. [ ] 创建 ParamsPanel 组件
   - 创建 `src/components/params/ParamsPanel.tsx`
   - 接收 modelId 和可选的 onChange 回调
   - 使用 useModelParams 管理参数状态

2. [ ] 实现参数加载
   - 从 ModelRegistry 获取参数 schema
   - 验证 schema 有效性
   - 处理加载失败情况

3. [ ] 实现参数排序
   - 根据 order 字段排序
   - 支持未设置 order 的参数（放在最后）

4. [ ] 实现参数渲染
   - 遍历 schema，使用 ParamRenderer 渲染
   - 传递必要的 props（value, onChange, allParams）
   - 传递辅助函数（getFilteredOptions）

5. [ ] 实现布局和样式
   - 响应式网格布局
   - 支持自定义间距
   - 支持分组（可选）

6. [ ] 实现参数导出
   - 提供 getParams() 方法
   - 提供 resetParams() 方法
   - 通过 ref 暴露给父组件

7. [ ] 添加加载状态
   - 显示加载指示器
   - 处理空状态（无参数）

8. [ ] 编写测试
   - 测试参数加载
   - 测试参数渲染
   - 测试参数修改
   - 测试参数导出

## 涉及文件

### 新建文件
- `src/components/params/ParamsPanel.tsx` - 参数面板组件
- `src/components/params/__tests__/ParamsPanel.test.tsx` - 测试

### 修改文件
无

## 验收标准

- [ ] 根据 modelId 自动加载参数 schema
- [ ] 参数按 order 正确排序
- [ ] 所有参数正确渲染
- [ ] 参数修改触发状态更新
- [ ] 支持参数导出和重置
- [ ] 响应式布局工作正常
- [ ] 加载和空状态显示正确
- [ ] 单元测试覆盖率 > 80%

## 测试方法

### 测试1：基础渲染
```typescript
// 创建测试模型
const testModel: ModelDefinition = {
  meta: {
    id: 'test-model',
    provider: 'test',
    type: 'image',
    name: { zh: '测试', en: 'Test' }
  },
  params: [
    {
      id: 'prompt',
      component: 'text',
      name: { zh: '提示词', en: 'Prompt' },
      order: 1,
      valueType: 'string',
      default: ''
    },
    {
      id: 'resolution',
      component: 'dropdown',
      name: { zh: '分辨率', en: 'Resolution' },
      order: 2,
      valueType: 'string',
      default: '1024*1024',
      options: [
        { value: '1024*1024', label: '1024×1024' }
      ]
    }
  ],
  endpoints: { default: '/test' },
  pricing: { currency: '¥', fixed: 0.1 }
}

// 注册模型
registry.register(testModel)

// 渲染
render(<ParamsPanel modelId="test-model" />)

// 验证参数渲染
expect(screen.getByLabelText('提示词')).toBeInTheDocument()
expect(screen.getByLabelText('分辨率')).toBeInTheDocument()
```

### 测试2：参数修改
```typescript
const mockOnChange = jest.fn()

render(
  <ParamsPanel
    modelId="test-model"
    onChange={mockOnChange}
  />
)

// 修改提示词
const input = screen.getByLabelText('提示词')
fireEvent.change(input, { target: { value: 'new prompt' } })

// 验证回调被调用
expect(mockOnChange).toHaveBeenCalledWith({
  prompt: 'new prompt',
  resolution: '1024*1024'
})
```

### 测试3：参数排序
```typescript
const modelWithOrder: ModelDefinition = {
  // ...
  params: [
    { id: 'c', order: 3, /* ... */ },
    { id: 'a', order: 1, /* ... */ },
    { id: 'b', order: 2, /* ... */ }
  ]
}

registry.register(modelWithOrder)
render(<ParamsPanel modelId="test-order" />)

// 获取所有参数容器
const paramElements = screen.getAllByTestId(/^param-/)

// 验证顺序
expect(paramElements[0]).toHaveAttribute('data-param-id', 'a')
expect(paramElements[1]).toHaveAttribute('data-param-id', 'b')
expect(paramElements[2]).toHaveAttribute('data-param-id', 'c')
```

### 测试4：参数导出
```typescript
const ref = React.createRef<ParamsPanelRef>()

render(
  <ParamsPanel
    modelId="test-model"
    ref={ref}
  />
)

// 修改参数
fireEvent.change(screen.getByLabelText('提示词'), {
  target: { value: 'test' }
})

// 导出参数
const params = ref.current?.getParams()
expect(params).toEqual({
  prompt: 'test',
  resolution: '1024*1024'
})

// 重置参数
ref.current?.resetParams()
expect(ref.current?.getParams()).toEqual({
  prompt: '',
  resolution: '1024*1024'
})
```

## 风险与注意事项

### 风险
- 参数过多时性能可能下降
- 联动逻辑可能导致渲染循环

### 注意事项
- 使用 React.memo 优化 ParamRenderer
- 避免不必要的全量重渲染
- 联动逻辑应该在 useModelParams 中处理，不在这里
- 提供清晰的错误信息
- 支持加载状态和空状态

## 实现参考

```typescript
// src/components/params/ParamsPanel.tsx

import React, { forwardRef, useImperativeHandle, useMemo } from 'react'
import { registry } from '@/core/ModelRegistry'
import { useModelParams } from '@/hooks/useModelParams'
import { ParamRenderer } from './ParamRenderer'
import './ParamsPanel.css'

interface ParamsPanelProps {
  modelId: string
  onChange?: (params: Record<string, any>) => void
  className?: string
}

export interface ParamsPanelRef {
  getParams: () => Record<string, any>
  resetParams: () => void
  setParam: (key: string, value: any) => void
}

export const ParamsPanel = forwardRef<ParamsPanelRef, ParamsPanelProps>(
  ({ modelId, onChange, className }, ref) => {
    // 加载参数 schema
    const schema = useMemo(() => {
      return registry.getSchema(modelId)
    }, [modelId])

    // 使用 useModelParams 管理状态
    const {
      params,
      setParam,
      resetParams,
      getFilteredOptions,
      schema: loadedSchema
    } = useModelParams(modelId)

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      getParams: () => params,
      resetParams,
      setParam
    }), [params, resetParams, setParam])

    // 参数变化时通知父组件
    React.useEffect(() => {
      onChange?.(params)
    }, [params, onChange])

    // 排序参数
    const sortedSchema = useMemo(() => {
      return [...loadedSchema].sort((a, b) => {
        const orderA = a.order ?? Number.MAX_SAFE_INTEGER
        const orderB = b.order ?? Number.MAX_SAFE_INTEGER
        return orderA - orderB
      })
    }, [loadedSchema])

    // 加载状态
    if (!schema || schema.length === 0) {
      return (
        <div className="params-panel-empty">
          该模型没有可配置参数
        </div>
      )
    }

    return (
      <div className={`params-panel ${className || ''}`}>
        {sortedSchema.map(paramDef => (
          <ParamRenderer
            key={paramDef.id}
            paramDef={paramDef}
            value={params[paramDef.id]}
            onChange={(value) => setParam(paramDef.id, value)}
            allParams={params}
            getFilteredOptions={getFilteredOptions}
          />
        ))}
      </div>
    )
  }
)

ParamsPanel.displayName = 'ParamsPanel'
```

```css
/* src/components/params/ParamsPanel.css */

.params-panel {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  padding: 16px;
}

.params-panel-empty {
  padding: 32px;
  text-align: center;
  color: var(--color-text-secondary);
}

@media (max-width: 768px) {
  .params-panel {
    grid-template-columns: 1fr;
  }
}
```

## 回滚方案

1. 删除 ParamsPanel 组件
2. 删除测试文件
3. 恢复到手动布局参数的方式
