

import { getToolboxState, listToolboxTools } from '@/features/toolbox/application/toolboxApplicationService'
import { selectToolboxTool } from '@/stores/navigationStore'

import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'

import { parseCapabilityInput, throwIfCapabilityAborted } from '@/features/application-control/capabilities/handlerUtils'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'

export function registerToolboxCapabilityHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  registrar.registerHandler('list_toolbox_tools', () => ({
    tools: listToolboxTools(),
  }))

  registrar.registerHandler('get_toolbox_state', () => ({
    state: getToolboxState(),
  }))

  registrar.registerHandler('select_toolbox_tool', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      toolId: 'audioEdit' | 'cameraStage' | 'imageMark' | null
    }>('select_toolbox_tool', input)
    if (parsed.toolId) {
      const surfaceId = parsed.toolId === 'cameraStage'
        ? 'tool.camera_stage'
        : parsed.toolId === 'audioEdit' ? 'tool.audio_edit' : 'tool.image_edit'
      return { toolId: parsed.toolId, ...openApplicationSurface(surfaceId, context) }
    }
    // 关闭工具只回工具箱首页，不抢占用户当前所在工作区。
    selectToolboxTool(null)
    return { toolId: parsed.toolId, surfaceId: null }
  })

}
