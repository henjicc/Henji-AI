import { createLogger } from '@/core/logging'

const logger = createLogger('components.params.panels.composite.registerDefaultComponents')
/**
 * 注册默认组件
 *
 * 在应用启动时注册所有可用的子组件到 ComponentRegistry
 */

import { componentRegistry } from './ComponentRegistry'
import { AspectRatioSelector } from '../ResolutionPanel/AspectRatioSelector'
import { QualityTierSelector } from '../ResolutionPanel/QualityTierSelector'
import { CustomSizeInput } from '../ResolutionPanel/CustomSizeInput'
import { PresetResolutionSelector } from '../ResolutionPanel/PresetResolutionSelector'
import {
  CompositeDropdown,
  CompositeNumberInput,
  CompositeRadio,
  CompositeSwitch,
  CompositeTextInput,
} from './BasicInputComponents'

/**
 * 注册所有默认组件
 */
export function registerDefaultComponents(): void {
  // 注册分辨率相关组件
  componentRegistry.register('aspect-ratio', AspectRatioSelector)
  componentRegistry.register('quality-tier', QualityTierSelector)
  componentRegistry.register('custom-size', CustomSizeInput)
  componentRegistry.register('preset-resolution', PresetResolutionSelector)
  componentRegistry.register('text-input', CompositeTextInput)
  componentRegistry.register('number-input', CompositeNumberInput)
  componentRegistry.register('dropdown', CompositeDropdown)
  componentRegistry.register('switch', CompositeSwitch)
  componentRegistry.register('radio', CompositeRadio)

  // 开发模式下输出注册信息
  if (import.meta.env.DEV) {
    // logger.info('[ComponentRegistry] Registered components:', componentRegistry.listRegistered())
  }
}

