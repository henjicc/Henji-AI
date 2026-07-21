/**
 * 注册默认参数面板组件。
 *
 * 注册器放在 UI 层，避免 core 反向依赖具体 React 面板实现。
 */

import { panelRegistry } from '@/core/panels/PanelRegistry'
import ModelSelectorPanel from '@/components/MediaGenerator/components/ModelSelectorPanel'
import { CompositePanel } from './CompositePanel'
import { MinimaxVoiceClonePanel } from './MinimaxVoiceClonePanel'
import { ModelscopeCustomModelPanel } from './ModelscopeCustomModelPanel'
import { ResolutionPanel } from './ResolutionPanel'
import { VoiceSelectorPanel } from './VoiceSelectorPanel'
import { registerDefaultComponents } from './composite/registerDefaultComponents'

export function registerDefaultPanels(): void {
  registerDefaultComponents()

  panelRegistry.register('resolution', ResolutionPanel)
  panelRegistry.register('model-selector', ModelSelectorPanel)
  panelRegistry.register('composite', CompositePanel)
  panelRegistry.register('modelscope-custom-model', ModelscopeCustomModelPanel)
  panelRegistry.register('voice-selector', VoiceSelectorPanel)
  panelRegistry.register('minimax-voice-clone', MinimaxVoiceClonePanel)
}
