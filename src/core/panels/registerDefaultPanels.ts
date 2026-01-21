/**
 * 注册默认面板
 *
 * 在应用启动时注册所有默认面板组件
 */

import { panelRegistry } from './PanelRegistry'
import { ResolutionPanel } from '@/components/params/panels/ResolutionPanel'
import { ModelSelectorPanel } from '@/components/MediaGenerator/components/ModelSelectorPanel'
import { CompositePanel } from '@/components/params/panels/CompositePanel'
import { registerDefaultComponents } from '@/components/params/panels/composite/registerDefaultComponents'

/**
 * 注册所有默认面板
 */
export function registerDefaultPanels(): void {
  // 先注册组件（CompositePanel 依赖这些组件）
  registerDefaultComponents()

  // 注册分辨率面板
  panelRegistry.register('resolution', ResolutionPanel)

  // 注册模型选择面板
  panelRegistry.register('model-selector', ModelSelectorPanel)

  // 注册通用组合面板
  panelRegistry.register('composite', CompositePanel)

  // 开发模式下输出注册信息
  if (process.env.NODE_ENV === 'development') {
    console.log('[PanelRegistry] Registered panels:', panelRegistry.listRegistered())
  }
}
