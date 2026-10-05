import { createLogger } from '@/core/logging'
import type { ToolboxToolId } from '@/core/types/workspace'
import type { DocumentSummary } from '@/core/documents/types'
import { selectToolboxTool } from '@/stores/navigationStore'

/**
 * 工具首页的“最近文件”（设计稿 Toolbox）：只汇总已有工程列表，按最近编辑排序，
 * 打开时复用各工具自己的正式打开入口，不新增数据、存储或通道。
 *
 * 口播（3.3）、3D 镜头参考（3.2）与图片文档（3.5）都是通用文档：列表查作品索引（已保存的、文件还在的），
 * 打开走各自的打开入口，按需加载，工具首页本身不因此提前下载 3D 场景或图片编辑器代码。
 */

const logger = createLogger('features.toolbox.recent')

export type ToolboxRecentTool = Extract<ToolboxToolId, 'audioEdit' | 'cameraStage' | 'imageMark'>

export interface ToolboxRecentFile {
  key: string
  toolId: ToolboxRecentTool
  projectId: string
  name: string
  updatedAt: number
}

export const TOOLBOX_RECENT_FILE_LIMIT = 5

type RecentDocument = Pick<DocumentSummary, 'id' | 'name' | 'updatedAt'>

export function mergeToolboxRecentFiles(
  audioDocuments: readonly RecentDocument[],
  cameraDocuments: readonly RecentDocument[],
  limit = TOOLBOX_RECENT_FILE_LIMIT,
  imageDocuments: readonly RecentDocument[] = [],
): ToolboxRecentFile[] {
  return [
    ...audioDocuments.map((document) => ({
      key: `audioEdit:${document.id}`,
      toolId: 'audioEdit' as const,
      projectId: document.id,
      name: document.name,
      updatedAt: document.updatedAt,
    })),
    ...cameraDocuments.map((project) => ({
      key: `cameraStage:${project.id}`,
      toolId: 'cameraStage' as const,
      projectId: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    })),
    ...imageDocuments.map((document) => ({
      key: `imageMark:${document.id}`,
      toolId: 'imageMark' as const,
      projectId: document.id,
      name: document.name,
      updatedAt: document.updatedAt,
    })),
  ]
    .filter((file) => Number.isFinite(file.updatedAt))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(0, limit))
}

/** 读取三个工具的文档摘要（全部，按最近编辑排序）；任一来源失败只记日志，不拖垮其他来源与首页。 */
export async function loadToolboxRecentFiles(): Promise<ToolboxRecentFile[]> {
  // 按需加载文档操作模块，三个来源共用一次加载
  const operations = import('@/features/documents/documentOperations')
  const listDocuments = (kind: 'audio_edit' | 'camera_stage' | 'image_document') => operations
    .then(({ getDocumentOperations }) => getDocumentOperations().listDocuments({
      kind, container: { kind: 'any' }, includeDrafts: false, includeMissing: false,
    }))
  const [audio, camera, image] = await Promise.allSettled([
    listDocuments('audio_edit'),
    listDocuments('camera_stage'),
    listDocuments('image_document'),
  ])
  for (const [source, result] of [['audioEdit', audio], ['cameraStage', camera], ['imageMark', image]] as const) {
    if (result.status === 'rejected') {
      logger.warn('工具首页最近文件读取失败', {
        event: 'toolbox.recent_files.load.failed',
        source,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }
  return mergeToolboxRecentFiles(
    audio.status === 'fulfilled' ? audio.value : [],
    camera.status === 'fulfilled' ? camera.value : [],
    Number.POSITIVE_INFINITY,
    image.status === 'fulfilled' ? image.value : [],
  )
}

/**
 * 打开一个最近文件：先用工具自己的入口把工程装好，再切到该工具。
 * 失败时仍进入该工具（落在它的工程列表），并把错误交给调用方提示。
 */
export async function openToolboxRecentFile(file: ToolboxRecentFile): Promise<void> {
  try {
    if (file.toolId === 'audioEdit') {
      const { openAudioEditDocument } = await import('@/features/audioEdit/application/audioEditDocumentService')
      await openAudioEditDocument({ id: file.projectId })
    } else if (file.toolId === 'imageMark') {
      // 图片编辑页接手打开（离开当前文档时可能要询问保存），这里只递交请求。
      const { requestImageDocumentInEditor } = await import('@/features/imageEdit/documents/imageDocumentWorkspace')
      requestImageDocumentInEditor({ id: file.projectId })
    } else {
      const { openCameraStageDocument } = await import('@/features/cameraStage/projects/cameraStageProjectService')
      await openCameraStageDocument({ id: file.projectId })
    }
    logger.info('工具首页打开最近文件', { event: 'toolbox.recent_files.open.completed', toolId: file.toolId })
  } catch (error) {
    logger.error('工具首页打开最近文件失败', error, {
      event: 'toolbox.recent_files.open.failed',
      toolId: file.toolId,
    })
    throw error
  } finally {
    selectToolboxTool(file.toolId)
  }
}
