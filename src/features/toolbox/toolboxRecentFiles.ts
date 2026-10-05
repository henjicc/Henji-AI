import type { AudioEditProjectSummary } from '@/core/audioEdit/types'
import { createLogger } from '@/core/logging'
import type { ToolboxToolId } from '@/core/types/workspace'
import type { DocumentSummary } from '@/core/documents/types'
import { getPlatform } from '@/platform/runtime'
import { selectToolboxTool } from '@/stores/navigationStore'

/**
 * 工具首页的“最近文件”（设计稿 Toolbox）：只汇总已有工程列表，按最近编辑排序，
 * 打开时复用各工具自己的正式打开入口，不新增数据、存储或通道。
 *
 * 图片编辑没有持久的最近文件记录（只在内存里记住当前会话），因此不进入这个列表。
 * 3D 镜头参考是通用文档（3.2）：列表查作品索引（已保存的、文件还在的），打开走它登记的打开入口，
 * 按需加载，工具首页本身不因此提前下载 3D 场景代码。
 */

const logger = createLogger('features.toolbox.recent')

export type ToolboxRecentTool = Extract<ToolboxToolId, 'audioEdit' | 'cameraStage'>

export interface ToolboxRecentFile {
  key: string
  toolId: ToolboxRecentTool
  projectId: string
  name: string
  updatedAt: number
}

export const TOOLBOX_RECENT_FILE_LIMIT = 5

export function mergeToolboxRecentFiles(
  audioProjects: readonly AudioEditProjectSummary[],
  cameraDocuments: readonly Pick<DocumentSummary, 'id' | 'name' | 'updatedAt'>[],
  limit = TOOLBOX_RECENT_FILE_LIMIT,
): ToolboxRecentFile[] {
  return [
    ...audioProjects.map((project) => ({
      key: `audioEdit:${project.id}`,
      toolId: 'audioEdit' as const,
      projectId: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    })),
    ...cameraDocuments.map((project) => ({
      key: `cameraStage:${project.id}`,
      toolId: 'cameraStage' as const,
      projectId: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    })),
  ]
    .filter((file) => Number.isFinite(file.updatedAt))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(0, limit))
}

/** 读取两个工具的工程摘要（全部，按最近编辑排序）；任一来源失败只记日志，不拖垮另一来源与首页。 */
export async function loadToolboxRecentFiles(): Promise<ToolboxRecentFile[]> {
  const [audio, camera] = await Promise.allSettled([
    getPlatform().audioEdit.listProjects(),
    import('@/features/documents/documentOperations')
      .then(({ getDocumentOperations }) => getDocumentOperations().listDocuments({
        kind: 'camera_stage', container: { kind: 'any' }, includeDrafts: false, includeMissing: false,
      })),
  ])
  for (const [source, result] of [['audioEdit', audio], ['cameraStage', camera]] as const) {
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
  )
}

/**
 * 打开一个最近文件：先用工具自己的入口把工程装好，再切到该工具。
 * 失败时仍进入该工具（落在它的工程列表），并把错误交给调用方提示。
 */
export async function openToolboxRecentFile(file: ToolboxRecentFile): Promise<void> {
  try {
    if (file.toolId === 'audioEdit') {
      const [{ loadAudioEditProject }, { useAudioEditStore }] = await Promise.all([
        import('@/features/audioEdit/application/audioEditProjectInstances'),
        import('@/features/audioEdit/store/audioEditStore'),
      ])
      useAudioEditStore.getState().setProject((await loadAudioEditProject(file.projectId)).document)
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
