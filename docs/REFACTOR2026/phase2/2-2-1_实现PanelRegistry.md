# 2-2-1 实现PanelRegistry

## 目标

实现特殊面板注册系统，管理所有复杂面板组件的注册和渲染

## 背景

根据 REFACTOR_PLAN.md 3.2 节，项目需要支持多种特殊面板：
- ResolutionPanel（分辨率面板）
- ModelSelectorPanel（模型选择面板）
- VoiceSelectorPanel（音色选择面板，待实现）
- CompositePanel（可组合面板，通用容器）

PanelRegistry 作为面板管理中心，提供：
- 面板组件注册
- 面板组件查询
- 统一的渲染接口
- 面板配置验证

## 前置依赖

- [ ] 1-1-2：定义参数类型系统
- [ ] 现有的 ResolutionPanel 和 ModelSelectorPanel

## 实施步骤

### 1. 定义面板类型系统

- [ ] 创建 `src/core/types/PanelTypes.ts`
- [ ] 定义 PanelType 枚举
- [ ] 定义 SpecialPanelConfig 接口
- [ ] 定义各面板的配置类型

```typescript
type PanelType =
  | 'resolution'
  | 'model-selector'
  | 'voice-selector'
  | 'style-gallery'
  | 'color-picker'
  | 'composite'
  | 'custom'

interface SpecialPanelConfig {
  type: PanelType
  label: I18nText
  width?: number
  alignment?: 'above' | 'below' | 'left' | 'right' | 'center'
  closeOnPanelClick?: boolean
  triggerStyle?: 'button' | 'input' | 'card'
  triggerDisplay?: (value: any) => string
  config: ResolutionConfig | VoiceSelectorConfig | CompositeConfig | CustomConfig
  value: any
  onChange: (value: any) => void
  showWhen?: (params: Params) => boolean
  disabled?: (params: Params) => boolean
}
```

### 2. 实现 PanelRegistry 类

- [ ] 创建 `src/core/panels/PanelRegistry.ts`
- [ ] 实现面板注册方法
- [ ] 实现面板查询方法
- [ ] 实现渲染方法
- [ ] 添加开发模式警告

```typescript
class PanelRegistry {
  private panels: Map<PanelType, React.ComponentType<any>> = new Map()

  register(type: PanelType, component: React.ComponentType<any>): void
  get(type: PanelType): React.ComponentType<any> | undefined
  has(type: PanelType): boolean
  render(config: SpecialPanelConfig): React.ReactNode
  listRegistered(): PanelType[]
}
```

### 3. 创建单例实例

- [ ] 导出 `panelRegistry` 单例
- [ ] 确保全局唯一

### 4. 注册现有面板

- [ ] 创建 `src/core/panels/registerDefaultPanels.ts`
- [ ] 注册 ResolutionPanel
- [ ] 注册 ModelSelectorPanel
- [ ] 在应用启动时调用注册

```typescript
import { panelRegistry } from './PanelRegistry'
import { ResolutionPanel } from '@/components/MediaGenerator/components/ParameterPanel/ResolutionPanel'
import { ModelSelectorPanel } from '@/components/ModelSelector/ModelSelectorPanel'

export function registerDefaultPanels() {
  panelRegistry.register('resolution', ResolutionPanel)
  panelRegistry.register('model-selector', ModelSelectorPanel)
  // 未来添加更多面板
}
```

### 5. 创建面板包装器

- [ ] 创建 `src/core/panels/PanelWrapper.tsx`
- [ ] 统一处理面板触发器
- [ ] 统一处理面板定位
- [ ] 统一处理打开/关闭逻辑

```typescript
interface PanelWrapperProps {
  config: SpecialPanelConfig
  children: React.ReactNode  // 面板内容
}

const PanelWrapper: React.FC<PanelWrapperProps> = ({ config, children }) => {
  // 处理触发器、定位、动画等
}
```

### 6. 实现配置验证

- [ ] 创建 `src/core/panels/validatePanelConfig.ts`
- [ ] 验证必需字段
- [ ] 验证配置类型匹配
- [ ] 开发模式下提供详细错误信息

### 7. 集成到参数系统

- [ ] 修改 ParamRenderer 支持 panel 类型
- [ ] 使用 PanelRegistry 渲染面板

## 涉及文件

### 新建文件
- `src/core/types/PanelTypes.ts` - 面板类型定义
- `src/core/panels/PanelRegistry.ts` - 面板注册中心
- `src/core/panels/PanelWrapper.tsx` - 面板包装器
- `src/core/panels/registerDefaultPanels.ts` - 默认面板注册
- `src/core/panels/validatePanelConfig.ts` - 配置验证
- `src/core/panels/index.ts` - 导出

### 修改文件
- `src/core/types/index.ts` - 导出面板类型
- `src/main.tsx` 或 `src/App.tsx` - 注册默认面板
- `src/components/params/ParamRenderer.tsx` - 支持 panel 类型

### 参考文件
- `src/components/MediaGenerator/components/ParameterPanel/ResolutionPanel/` - 现有分辨率面板
- `src/components/ModelSelector/ModelSelectorPanel.tsx` - 现有模型选择面板

## 验收标准

- [ ] PanelRegistry 支持注册和查询面板
- [ ] 成功注册 ResolutionPanel 和 ModelSelectorPanel
- [ ] PanelWrapper 正确处理面板触发和定位
- [ ] 配置验证能捕获常见错误
- [ ] ParamRenderer 能渲染面板类型参数
- [ ] TypeScript 类型检查通过
- [ ] 提供完整的 JSDoc 文档
- [ ] 创建示例验证功能

## 测试方法

### 单元测试

```typescript
describe('PanelRegistry', () => {
  test('should register and retrieve panel', () => {
    const MockPanel = () => <div>Mock Panel</div>
    panelRegistry.register('test-panel', MockPanel)
    expect(panelRegistry.has('test-panel')).toBe(true)
    expect(panelRegistry.get('test-panel')).toBe(MockPanel)
  })

  test('should warn on duplicate registration', () => {
    const consoleSpy = jest.spyOn(console, 'warn')
    panelRegistry.register('resolution', MockPanel)
    expect(consoleSpy).toHaveBeenCalled()
  })

  test('should return undefined for unregistered panel', () => {
    expect(panelRegistry.get('non-existent')).toBeUndefined()
  })
})
```

### 集成测试

```typescript
// 测试在 ParamRenderer 中使用
const panelParam: PanelParamDef = {
  id: 'resolution',
  component: 'panel',
  panelType: 'resolution',
  name: { zh: '分辨率', en: 'Resolution' },
  order: 1,
  panelConfig: {
    mode: 'aspect-quality',
    aspectRatios: ['16:9', '9:16', '1:1'],
    qualityTiers: ['720P', '1080P']
  }
}

// 验证能正确渲染
render(<ParamRenderer paramDef={panelParam} value={{}} onChange={() => {}} />)
```

## 风险与注意事项

### 风险
- 面板组件接口不统一，集成困难
- 现有面板需要重构才能适配注册系统

### 注意事项
- 保持现有面板的接口不变（通过适配器）
- PanelRegistry 应该是全局单例
- 面板注册应在应用启动早期完成
- 开发模式提供详细的错误信息
- 支持 HMR（热模块替换）时面板重新注册
- 考虑面板懒加载（按需加载）

## 参考实现

### PanelRegistry 实现

```typescript
// src/core/panels/PanelRegistry.ts
import React from 'react'

export type PanelType =
  | 'resolution'
  | 'model-selector'
  | 'voice-selector'
  | 'composite'
  | 'custom'

class PanelRegistry {
  private panels: Map<PanelType, React.ComponentType<any>> = new Map()

  /**
   * 注册面板组件
   * @param type 面板类型
   * @param component 面板组件
   */
  register(type: PanelType, component: React.ComponentType<any>): void {
    if (this.panels.has(type)) {
      console.warn(`Panel type "${type}" is already registered. Overwriting.`)
    }
    this.panels.set(type, component)
  }

  /**
   * 获取面板组件
   * @param type 面板类型
   * @returns 面板组件或 undefined
   */
  get(type: PanelType): React.ComponentType<any> | undefined {
    return this.panels.get(type)
  }

  /**
   * 检查面板是否已注册
   * @param type 面板类型
   * @returns 是否已注册
   */
  has(type: PanelType): boolean {
    return this.panels.has(type)
  }

  /**
   * 渲染面板
   * @param config 面板配置
   * @returns React 节点
   */
  render(config: SpecialPanelConfig): React.ReactNode {
    const Component = this.panels.get(config.type)

    if (!Component) {
      if (process.env.NODE_ENV === 'development') {
        console.error(`Unknown panel type: ${config.type}`)
      }
      return null
    }

    return <Component {...config} />
  }

  /**
   * 列出所有已注册的面板类型
   * @returns 面板类型数组
   */
  listRegistered(): PanelType[] {
    return Array.from(this.panels.keys())
  }
}

// 导出单例
export const panelRegistry = new PanelRegistry()
```

### 注册默认面板

```typescript
// src/core/panels/registerDefaultPanels.ts
import { panelRegistry } from './PanelRegistry'
import { ResolutionPanel } from '@/components/MediaGenerator/components/ParameterPanel/ResolutionPanel'
import { ModelSelectorPanel } from '@/components/ModelSelector/ModelSelectorPanel'

export function registerDefaultPanels() {
  // 注册分辨率面板
  panelRegistry.register('resolution', ResolutionPanel)

  // 注册模型选择面板
  panelRegistry.register('model-selector', ModelSelectorPanel)

  if (process.env.NODE_ENV === 'development') {
    console.log('Registered panels:', panelRegistry.listRegistered())
  }
}
```

### 在应用中初始化

```typescript
// src/main.tsx
import { registerDefaultPanels } from '@/core/panels/registerDefaultPanels'

// 在 React 渲染前注册
registerDefaultPanels()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

### ParamRenderer 集成

```typescript
// src/components/params/ParamRenderer.tsx
import { panelRegistry } from '@/core/panels/PanelRegistry'

function ParamRenderer({ paramDef, value, onChange }: ParamRendererProps) {
  // ...其他组件类型处理

  if (paramDef.component === 'panel') {
    return panelRegistry.render({
      type: paramDef.panelType,
      label: paramDef.name,
      config: paramDef.panelConfig,
      value,
      onChange
    })
  }

  return null
}
```

## 回滚方案

- 删除 `src/core/panels/` 目录
- 删除 `src/core/types/PanelTypes.ts`
- 从 `src/main.tsx` 移除面板注册调用
- 从 `ParamRenderer` 移除面板支持
- Git revert 相关提交
