/**
 * 注册默认面板
 *
 * 在应用启动时注册所有默认面板组件
 */

import { panelRegistry } from './PanelRegistry'
import { ResolutionPanel } from '@/components/params/panels/ResolutionPanel'
import ModelSelectorPanel from '@/components/MediaGenerator/components/ModelSelectorPanel'
import { CompositePanel } from '@/components/params/panels/CompositePanel'
import { ModelscopeCustomModelPanel } from '@/components/params/panels/ModelscopeCustomModelPanel'
import { VoiceSelectorPanel } from '@/components/params/panels/VoiceSelectorPanel'
import { MinimaxVoiceClonePanel } from '@/components/params/panels/MinimaxVoiceClonePanel'
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

  // 注册 ModelScope 自定义模型面板
  panelRegistry.register('modelscope-custom-model', ModelscopeCustomModelPanel)

  // 注册通用音色选择面板
  panelRegistry.register('voice-selector', VoiceSelectorPanel)

  // 注册 MiniMax 音色克隆面板
  panelRegistry.register('minimax-voice-clone', MinimaxVoiceClonePanel)
}

