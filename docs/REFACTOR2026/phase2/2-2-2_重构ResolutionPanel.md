# 2-2-2 重构ResolutionPanel

## 目标

将现有的 ResolutionPanel 重构为可配置的组合式面板，支持不同模型的分辨率配置需求

## 背景

现有的 ResolutionPanel（位于 `src/components/MediaGenerator/components/ParameterPanel/ResolutionPanel/`）是专为即梦 4.0 设计的：
- 9 个固定比例选项 + 智能选项
- 2K/4K 质量切换
- 自定义尺寸输入
- 智能匹配功能

根据 REFACTOR_PLAN.md 3.3 节，需要将其重构为支持三种分辨率模式：
- Mode A：比例 + 质量档位（如 Wan 2.6）
- Mode B：预设分辨率（如部分图片模型）
- Mode C：自定义尺寸（高级用户）

同时需要拆分为可复用的子组件，为后续 CompositePanel 做准备。

## 前置依赖

- [ ] 2-2-1：实现PanelRegistry
- [ ] 2-1-1：实现基础输入组件

## 实施步骤

### 1. 分析现有实现

- [ ] 阅读现有 ResolutionPanel 代码
- [ ] 识别可复用的子组件
- [ ] 识别需要参数化的配置
- [ ] 列出需要保留的功能

### 2. 拆分子组件

创建可复用的子组件：

- [ ] `AspectRatioSelector.tsx` - 比例选择器
  - 支持网格布局
  - 支持图标可视化
  - 支持智能匹配选项

- [ ] `QualityTierSelector.tsx` - 质量档位选择器
  - 支持多档位选择
  - 显示实际分辨率提示

- [ ] `CustomSizeInput.tsx` - 自定义尺寸输入
  - 宽度/高度输入
  - 步进验证
  - 比例锁定（可选）

- [ ] `PresetResolutionSelector.tsx` - 预设分辨率选择器
  - 下拉或网格选择
  - 显示比例信息

```typescript
// 子组件接口示例
interface AspectRatioSelectorProps {
  value: string  // '16:9'
  onChange: (value: string) => void
  options: AspectRatioOption[]
  visualize?: boolean  // 显示图标
  smartMatchEnabled?: boolean  // 显示智能选项
}

interface QualityTierSelectorProps {
  value: string  // '720P'
  onChange: (value: string) => void
  options: QualityOption[]
  availableFor?: string  // 当前比例可用的质量
}

interface CustomSizeInputProps {
  value: { width: number; height: number }
  onChange: (value: { width: number; height: number }) => void
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  step: number
  lockRatio?: boolean
}
```

### 3. 重构 ResolutionPanel 主组件

- [ ] 创建新的 `ResolutionPanel.tsx`
- [ ] 支持三种模式配置
- [ ] 根据配置动态渲染子组件
- [ ] 处理模式切换逻辑
- [ ] 实现智能匹配功能

```typescript
interface ResolutionPanelProps {
  value: ResolutionValue
  onChange: (value: ResolutionValue) => void
  config: ResolutionConfig
}

interface ResolutionConfig {
  mode: 'aspect-quality' | 'preset' | 'custom' | 'hybrid'

  // Mode A: 比例 + 质量
  aspectRatios?: {
    options: AspectRatioOption[]
    default: string
    smartMatch?: boolean
  }
  qualityTiers?: {
    options: QualityOption[]
    default: string
    availableFor?: Record<string, string[]>
  }

  // Mode B: 预设
  presets?: {
    options: PresetOption[]
    default: string
  }

  // Mode C: 自定义
  customSize?: {
    enabled: boolean
    minWidth: number
    maxWidth: number
    minHeight: number
    maxHeight: number
    step: number
  }
}

interface ResolutionValue {
  mode: 'aspect-quality' | 'preset' | 'custom'
  aspectRatio?: string
  quality?: string
  preset?: string
  width?: number
  height?: number
}
```

### 4. 实现配置驱动逻辑

- [ ] 根据 config.mode 决定显示哪些子组件
- [ ] 处理子组件间的联动（如质量档位根据比例过滤）
- [ ] 实现值的转换和验证

### 5. 保留智能匹配功能

- [ ] 集成 `src/utils/smartMatch.ts`
- [ ] 上传图片时自动匹配比例
- [ ] 提供"智能"选项

### 6. 更新样式

- [ ] 提取通用样式到 `ResolutionPanel/styles.css`
- [ ] 确保子组件样式独立
- [ ] 支持不同模式的布局

### 7. 创建配置示例

- [ ] 为不同模型创建配置示例
- [ ] 验证配置的灵活性

```typescript
// 示例1：Wan 2.6（比例 + 质量）
const wan26Config: ResolutionConfig = {
  mode: 'aspect-quality',
  aspectRatios: {
    options: [
      { value: '16:9', label: { zh: '16:9 横屏', en: '16:9' } },
      { value: '9:16', label: { zh: '9:16 竖屏', en: '9:16' } },
      { value: '1:1', label: { zh: '1:1 方形', en: '1:1' } }
    ],
    default: '16:9',
    smartMatch: true
  },
  qualityTiers: {
    options: [
      { value: '720P', label: { zh: '720P', en: '720P' }, resolution: '1280×720' },
      { value: '1080P', label: { zh: '1080P', en: '1080P' }, resolution: '1920×1080' }
    ],
    default: '720P'
  }
}

// 示例2：简单图片模型（预设分辨率）
const simpleImageConfig: ResolutionConfig = {
  mode: 'preset',
  presets: {
    options: [
      { value: '1024*1024', label: '1024×1024 (1:1)' },
      { value: '1024*768', label: '1024×768 (4:3)' },
      { value: '768*1024', label: '768×1024 (3:4)' }
    ],
    default: '1024*1024'
  }
}

// 示例3：混合模式（支持自定义）
const advancedConfig: ResolutionConfig = {
  mode: 'hybrid',
  aspectRatios: { /* ... */ },
  qualityTiers: { /* ... */ },
  customSize: {
    enabled: true,
    minWidth: 512,
    maxWidth: 4096,
    minHeight: 512,
    maxHeight: 4096,
    step: 64
  }
}
```

### 8. 迁移现有使用

- [ ] 为即梦 4.0 创建配置
- [ ] 替换现有 ResolutionPanel 使用
- [ ] 验证功能完整性

## 涉及文件

### 新建文件
- `src/components/params/panels/ResolutionPanel/index.tsx` - 主组件（新版）
- `src/components/params/panels/ResolutionPanel/AspectRatioSelector.tsx`
- `src/components/params/panels/ResolutionPanel/QualityTierSelector.tsx`
- `src/components/params/panels/ResolutionPanel/CustomSizeInput.tsx`
- `src/components/params/panels/ResolutionPanel/PresetResolutionSelector.tsx`
- `src/components/params/panels/ResolutionPanel/styles.css`
- `src/components/params/panels/ResolutionPanel/types.ts`

### 修改文件
- `src/core/panels/registerDefaultPanels.ts` - 注册新版组件

### 参考文件
- `src/components/MediaGenerator/components/ParameterPanel/ResolutionPanel/` - 现有实现
- `src/utils/smartMatch.ts` - 智能匹配工具

### 可能废弃的文件
- 旧版 ResolutionPanel（保留作为参考，待验证后删除）

## 验收标准

- [ ] 支持三种分辨率模式（aspect-quality, preset, custom）
- [ ] 子组件可独立使用
- [ ] 智能匹配功能正常
- [ ] 即梦 4.0 迁移后功能完整
- [ ] 配置灵活，易于为新模型创建配置
- [ ] 样式与现有 UI 一致
- [ ] TypeScript 类型完整
- [ ] 通过 PanelRegistry 正确注册和渲染

## 测试方法

### 子组件测试

```typescript
// AspectRatioSelector
test('renders aspect ratio options', () => {
  const options = [
    { value: '16:9', label: { zh: '16:9', en: '16:9' } },
    { value: '1:1', label: { zh: '1:1', en: '1:1' } }
  ]
  render(<AspectRatioSelector value="16:9" onChange={() => {}} options={options} />)
  expect(screen.getByText('16:9')).toBeInTheDocument()
})

// QualityTierSelector
test('filters quality options by aspect ratio', () => {
  const config = {
    options: [
      { value: '720P', label: '720P' },
      { value: '1080P', label: '1080P' }
    ],
    availableFor: {
      '1:1': ['720P']  // 1:1 只支持 720P
    }
  }
  // 测试过滤逻辑
})
```

### 集成测试

```typescript
// 测试完整的分辨率面板
test('ResolutionPanel changes mode correctly', () => {
  const config: ResolutionConfig = {
    mode: 'aspect-quality',
    aspectRatios: { /* ... */ },
    qualityTiers: { /* ... */ }
  }

  const onChange = jest.fn()
  render(<ResolutionPanel value={{ mode: 'aspect-quality' }} onChange={onChange} config={config} />)

  // 选择比例
  fireEvent.click(screen.getByText('9:16'))
  expect(onChange).toHaveBeenCalledWith({
    mode: 'aspect-quality',
    aspectRatio: '9:16',
    quality: '720P'
  })
})
```

### 手动测试

1. 即梦 4.0 场景测试
   - 所有比例选项正常
   - 2K/4K 切换正常
   - 自定义尺寸输入正常
   - 智能匹配正常

2. 新配置测试
   - 创建 Wan 2.6 配置
   - 验证只显示 5 个比例
   - 验证 720P/1080P 切换

3. 简单模型测试
   - 创建预设分辨率配置
   - 验证下拉选择正常

## 风险与注意事项

### 风险
- 重构可能破坏现有功能
- 配置接口设计不当导致难以使用

### 注意事项
- 保留旧版 ResolutionPanel 作为备份
- 逐步迁移，不要一次性替换所有使用
- 确保即梦 4.0 功能完整性（这是最复杂的场景）
- 子组件应尽量独立，减少相互依赖
- 考虑性能优化（React.memo）
- 智能匹配逻辑应提取为独立工具函数
- 配置验证应提供清晰的错误信息

## 参考实现

### ResolutionPanel 主组件

```typescript
import React from 'react'
import { AspectRatioSelector } from './AspectRatioSelector'
import { QualityTierSelector } from './QualityTierSelector'
import { CustomSizeInput } from './CustomSizeInput'
import { PresetResolutionSelector } from './PresetResolutionSelector'
import { ResolutionConfig, ResolutionValue } from './types'

interface ResolutionPanelProps {
  value: ResolutionValue
  onChange: (value: ResolutionValue) => void
  config: ResolutionConfig
}

export const ResolutionPanel: React.FC<ResolutionPanelProps> = ({
  value,
  onChange,
  config
}) => {
  // Mode A: 比例 + 质量
  if (config.mode === 'aspect-quality' || config.mode === 'hybrid') {
    return (
      <div className="resolution-panel">
        {config.aspectRatios && (
          <AspectRatioSelector
            value={value.aspectRatio || config.aspectRatios.default}
            onChange={(aspectRatio) => onChange({ ...value, aspectRatio })}
            options={config.aspectRatios.options}
            visualize={true}
            smartMatchEnabled={config.aspectRatios.smartMatch}
          />
        )}

        {config.qualityTiers && (
          <QualityTierSelector
            value={value.quality || config.qualityTiers.default}
            onChange={(quality) => onChange({ ...value, quality })}
            options={config.qualityTiers.options}
            availableFor={value.aspectRatio}
          />
        )}

        {config.mode === 'hybrid' && config.customSize?.enabled && (
          <CustomSizeInput
            value={{ width: value.width || 1280, height: value.height || 720 }}
            onChange={({ width, height }) => onChange({ ...value, width, height })}
            {...config.customSize}
          />
        )}
      </div>
    )
  }

  // Mode B: 预设分辨率
  if (config.mode === 'preset' && config.presets) {
    return (
      <div className="resolution-panel">
        <PresetResolutionSelector
          value={value.preset || config.presets.default}
          onChange={(preset) => onChange({ ...value, preset })}
          options={config.presets.options}
        />
      </div>
    )
  }

  // Mode C: 纯自定义
  if (config.mode === 'custom' && config.customSize) {
    return (
      <div className="resolution-panel">
        <CustomSizeInput
          value={{ width: value.width || 1280, height: value.height || 720 }}
          onChange={({ width, height }) => onChange({ ...value, width, height })}
          {...config.customSize}
        />
      </div>
    )
  }

  return null
}
```

## 回滚方案

- 保留旧版 ResolutionPanel 代码
- 从 PanelRegistry 移除新版注册
- 恢复旧版注册
- Git revert 相关提交
