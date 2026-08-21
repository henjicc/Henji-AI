import { createLogger } from '@/core/logging'
import { saveProjectCover } from '@/commands/projectCovers'
import { useCameraStageSessionStore } from '../store/cameraStageSessionStore'

const logger = createLogger('cameraStage.projects.cover')

/**
 * 3D 镜头参考工程封面：始终取摄像机视图当前画面。
 *
 * 与画布不同，这里没有"生成结果"的概念，工程本身就是一套镜头，视口画面即内容。
 * 退出编辑器时调用一次；截图必须在 Canvas 还挂载时读，卸载后 WebGL 上下文已经没了。
 */
export async function updateCameraStageProjectCover(
  projectId: string,
  captureViewport: () => string | null,
): Promise<void> {
  try {
    const dataUrl = captureViewport()
    if (!dataUrl) return
    await saveProjectCover({
      scope: 'camera-stage',
      projectId,
      sources: [{ source: dataUrl, sourceKind: 'image' }],
    })
    useCameraStageSessionStore.getState().markCoversChanged()
  } catch (error) {
    logger.warn('3D 镜头参考工程封面更新失败', { projectId, error: String(error) })
  }
}
