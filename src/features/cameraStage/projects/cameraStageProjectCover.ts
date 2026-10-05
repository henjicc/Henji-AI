import { createLogger } from '@/core/logging'
import { saveDocumentCover } from '@/commands/documents'

const logger = createLogger('features.cameraStage.documents.cover')

/**
 * 镜头参考的列表封面：始终取摄像机视图当前画面，存成通用文档封面（程序目录，按文档 ID，3.2）。
 * 文档文件里不写任何封面路径；文档移到回收站或空草稿删除时主进程一并清掉封面。
 *
 * 截图必须在 Canvas 还挂载时读，卸载后 WebGL 上下文已经没了；所以离开编辑器前先等这次保存完成。
 */
export async function updateCameraStageProjectCover(
  documentId: string,
  captureViewport: () => string | null,
): Promise<void> {
  try {
    const dataUrl = captureViewport()
    if (!dataUrl) return
    await saveDocumentCover({ docId: documentId, sources: [{ source: dataUrl, sourceKind: 'image' }] })
  } catch (error) {
    logger.warn('镜头参考封面更新失败', { event: 'camera_stage.document.cover.failed', context: { docId: documentId }, error: String(error) })
  }
}
