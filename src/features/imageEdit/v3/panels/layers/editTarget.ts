import type { ImageEditorV3Controller } from '../../editor/types'
import { useImageEditorSessionStoreV3 } from '../../store'

/** 焦点是会话态；实际笔划仍由唯一已登记工具与区域/像素服务执行。 */
export function selectImageEditTargetV3(controller: ImageEditorV3Controller, layerId: string, target: 'pixels' | 'mask'): void {
  const store = useImageEditorSessionStoreV3.getState()
  store.setSelectedLayerIds(controller.sessionId, [layerId])
  store.setEditTarget(controller.sessionId, target)
  const session = store.sessions[controller.sessionId]
  const tool = target === 'mask' ? 'mask-edit' : session?.activeTool === 'mask-edit' ? 'raster-brush' : null
  if (tool && controller.profile.tools.some(entry => entry.id === tool && entry.readiness.state === 'ready')) {
    store.setActiveTool(controller.sessionId, tool)
  } else if (target === 'pixels' && session?.activeTool === 'mask-edit') store.setActiveTool(controller.sessionId, 'move')
}
