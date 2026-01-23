# 2-3-1 实现ParamRenderer

## 目标

实现参数自动渲染器，根据参数定义自动选择和渲染对应的 UI 组件

## 背景

新架构的核心优势是配置驱动 UI 生成：
- 根据 ParamDef 自动选择组件
- 处理条件显示（visible）
- 处理禁用状态（disabled）
- 统一的属性传递和事件处理

ParamRenderer 是连接参数定义和 UI 组件的桥梁

## 前置依赖

- [ ] 1-1-2：定义参数类型系统
- [ ] 2-1-1：实现基础输入组件
- [ ] 2-1-2：实现下拉和开关组件
- [ ] 2-1-3：实现上传组件
- [ ] 2-2-2：重构ResolutionPanel
- [ ] 2-2-3：实现CompositePanel

## 实施步骤

1. [ ] 创建 ParamRenderer 组件
   - 创建 `src/components/params/ParamRenderer.tsx`
   - 接收 paramDef, value, onChange, allParams
   - 根据 component 类型分发渲染

2. [ ] 实现组件映射
   - 创建 component type 到组件的映射表
   - 支持所有基础组件类型
   - 支持特殊面板类型

3. [ ] 实现条件显示逻辑
   - 处理 visible 配置
   - 支持字符串表达式（如 `mode !== "reference"`）
   - 支持函数判断
   - 不满足条件时返回 null

4. [ ] 实现禁用状态逻辑
   - 处理 disabled 配置
   - 支持条件判断
   - 传递给子组件

5. [ ] 实现智能匹配触发
   - 处理 onUpload.smartMatch 配置
   - 上传完成时触发智能匹配
   - 调用对应参数的匹配逻辑

6. [ ] 实现统一的属性传递
   - 提取通用属性（label, tooltip, disabled）
   - 传递组件特定属性
   - 处理 i18n 文本

7. [ ] 添加错误边界
   - 捕获组件渲染错误
   - 显示友好的错误信息
   - 不影响其他组件渲染

8. [ ] 编写测试
   - 测试所有组件类型渲染
   - 测试条件显示
   - 测试禁用状态
   - 测试错误处理

## 涉及文件

### 新建文件
- `src/components/params/ParamRenderer.tsx` - 参数渲染器
- `src/components/params/ParamRendererErrorBoundary.tsx` - 错误边界
- `src/components/params/__tests__/ParamRenderer.test.tsx` - 测试

### 修改文件
无

## 验收标准

- [ ] 支持所有参数组件类型渲染
- [ ] 条件显示（visible）工作正确
- [ ] 禁用状态（disabled）工作正确
- [ ] 智能匹配触发正确
- [ ] i18n 文本正确显示
- [ ] 错误边界捕获异常
- [ ] 单元测试覆盖率 > 85%

## 测试方法

### 测试1：基础组件渲染
```typescript
const textParam: ParamDef = {
  id: 'prompt',
  component: 'text',
  name: { zh: '提示词', en: 'Prompt' },
  order: 1,
  valueType: 'string',
  default: '',
  maxLength: 500
}

render(
  <ParamRenderer
    paramDef={textParam}
    value=""
    onChange={mockOnChange}
    allParams={{}}
  />
)

expect(screen.getByLabelText('提示词')).toBeInTheDocument()
expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '500')
```

### 测试2：条件显示
```typescript
const imageUploadParam: ParamDef = {
  id: 'images',
  component: 'image-upload',
  name: { zh: '图片', en: 'Images' },
  order: 10,
  maxCount: 1,
  visible: {
    condition: 'mode !== "reference-to-video"'
  }
}

// 场景1：应该显示
const { rerender } = render(
  <ParamRenderer
    paramDef={imageUploadParam}
    value={[]}
    onChange={mockOnChange}
    allParams={{ mode: 'text-image-to-video' }}
  />
)
expect(screen.getByText('图片')).toBeInTheDocument()

// 场景2：应该隐藏
rerender(
  <ParamRenderer
    paramDef={imageUploadParam}
    value={[]}
    onChange={mockOnChange}
    allParams={{ mode: 'reference-to-video' }}
  />
)
expect(screen.queryByText('图片')).not.toBeInTheDocument()
```

### 测试3：禁用状态
```typescript
const durationParam: ParamDef = {
  id: 'duration',
  component: 'slider',
  name: { zh: '时长', en: 'Duration' },
  order: 5,
  valueType: 'number',
  default: 5,
  min: 5,
  max: 15,
  disabled: {
    condition: (params) => params.quality === '1080P',
    message: { zh: '1080P不支持长时长', en: '1080P does not support long duration' }
  }
}

render(
  <ParamRenderer
    paramDef={durationParam}
    value={5}
    onChange={mockOnChange}
    allParams={{ quality: '1080P' }}
  />
)

const slider = screen.getByRole('slider')
expect(slider).toBeDisabled()
expect(screen.getByText('1080P不支持长时长')).toBeInTheDocument()
```

### 测试4：错误处理
```typescript
const brokenParam: ParamDef = {
  id: 'broken',
  component: 'non-existent' as any,
  name: { zh: '测试', en: 'Test' },
  order: 1,
  valueType: 'string',
  default: ''
}

// 不应该导致整个应用崩溃
render(
  <ParamRenderer
    paramDef={brokenParam}
    value=""
    onChange={mockOnChange}
    allParams={{}}
  />
)

expect(screen.getByText(/Unknown component type/)).toBeInTheDocument()
```

## 风险与注意事项

### 风险
- 条件表达式求值可能有安全问题
- 组件渲染错误可能影响其他组件

### 注意事项
- 使用错误边界隔离组件错误
- 条件表达式应该简单，避免复杂逻辑
- 组件映射应该完整，避免遗漏
- 性能优化：使用 React.memo 避免不必要的重渲染
- 属性传递应该类型安全

## 实现参考

```typescript
// src/components/params/ParamRenderer.tsx

import React, { useMemo } from 'react'
import { useI18n } from '@/hooks/useI18n'
import type { ParamDef } from '@/core/types/ParamDef'
import { TextInput } from './TextInput'
import { NumberInput } from './NumberInput'
import { SliderInput } from './SliderInput'
import { DropdownInput } from './DropdownInput'
import { SwitchInput } from './SwitchInput'
import { RadioInput } from './RadioInput'
import { ImageUpload } from './ImageUpload'
import { VideoUpload } from './VideoUpload'
import { ResolutionPanel } from '../panels/ResolutionPanel'
import { ParamRendererErrorBoundary } from './ParamRendererErrorBoundary'

// 组件映射表
const COMPONENT_MAP = {
  text: TextInput,
  number: NumberInput,
  slider: SliderInput,
  dropdown: DropdownInput,
  switch: SwitchInput,
  radio: RadioInput,
  'image-upload': ImageUpload,
  'video-upload': VideoUpload,
  resolution: ResolutionPanel
} as const

interface ParamRendererProps {
  paramDef: ParamDef
  value: any
  onChange: (value: any) => void
  allParams: Record<string, any>
  getFilteredOptions?: (paramId: string) => any[]
  onSmartMatch?: (paramId: string, matchedValue: any) => void
}

export const ParamRenderer: React.FC<ParamRendererProps> = React.memo(({
  paramDef,
  value,
  onChange,
  allParams,
  getFilteredOptions,
  onSmartMatch
}) => {
  const { t } = useI18n()

  // 检查是否应该显示
  const isVisible = useMemo(() => {
    if (!paramDef.visible) return true

    if (typeof paramDef.visible.condition === 'function') {
      return paramDef.visible.condition(allParams)
    }

    if (typeof paramDef.visible.condition === 'string') {
      try {
        const fn = new Function('params', `
          with (params) {
            return ${paramDef.visible.condition}
          }
        `)
        return fn(allParams)
      } catch (error) {
        console.error('Visible condition evaluation error:', error)
        return true
      }
    }

    return true
  }, [paramDef.visible, allParams])

  // 检查是否应该禁用
  const isDisabled = useMemo(() => {
    if (!paramDef.disabled) return false

    if (typeof paramDef.disabled.condition === 'function') {
      return paramDef.disabled.condition(allParams)
    }

    return false
  }, [paramDef.disabled, allParams])

  if (!isVisible) {
    return null
  }

  // 获取组件
  const Component = COMPONENT_MAP[paramDef.component]
  if (!Component) {
    return (
      <div className="param-renderer-error">
        Unknown component type: {paramDef.component}
      </div>
    )
  }

  // 通用属性
  const commonProps = {
    value,
    onChange,
    disabled: isDisabled,
    label: t(paramDef.name),
    tooltip: paramDef.tooltip ? t(paramDef.tooltip) : undefined
  }

  // 组件特定属性
  let specificProps = {}

  switch (paramDef.component) {
    case 'dropdown':
      specificProps = {
        options: getFilteredOptions
          ? getFilteredOptions(paramDef.id)
          : paramDef.options
      }
      break

    case 'slider':
      specificProps = {
        min: paramDef.min,
        max: paramDef.max,
        step: paramDef.step,
        marks: paramDef.marks,
        unit: paramDef.unit
      }
      break

    case 'image-upload':
      specificProps = {
        maxCount: paramDef.maxCount,
        format: paramDef.uploadFormat,
        onUpload: (files) => {
          onChange(files)
          // 触发智能匹配
          if (paramDef.triggerSmartMatch && onSmartMatch) {
            paramDef.triggerSmartMatch.forEach(targetParamId => {
              // 这里应该调用智能匹配逻辑
              // 简化示例，实际应该从 schema 获取匹配函数
            })
          }
        }
      }
      break

    // ... 其他组件类型
  }

  return (
    <ParamRendererErrorBoundary paramId={paramDef.id}>
      <div className="param-renderer" data-param-id={paramDef.id}>
        <Component {...commonProps} {...specificProps} />
        {isDisabled && paramDef.disabled?.message && (
          <div className="param-disabled-message">
            {t(paramDef.disabled.message)}
          </div>
        )}
      </div>
    </ParamRendererErrorBoundary>
  )
})

ParamRenderer.displayName = 'ParamRenderer'
```

## 回滚方案

1. 删除 ParamRenderer 组件
2. 删除测试文件
3. 恢复到手动渲染参数 UI 的方式
