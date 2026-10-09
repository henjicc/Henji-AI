import { createLogger } from '@/core/logging'
import type { ToolboxToolId } from '@/core/types/workspace'
import { TOOLBOX_RUNTIME, type ToolboxRuntimeTool } from '@/workspaces/toolboxRuntime'
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

export type ToolboxRecentTool = ToolboxToolId

export interface ToolboxRecentFile<TToolId extends string = ToolboxRecentTool> {
  key: string
  toolId: TToolId
  projectId: string
  name: string
  updatedAt: number
}

export const TOOLBOX_RECENT_FILE_LIMIT = 5

type RecentDocument = Pick<DocumentSummary, 'id' | 'name' | 'updatedAt'>

export interface ToolboxRecentSource<TToolId extends string = ToolboxRecentTool> {
  toolId: TToolId
  documents: readonly RecentDocument[]
}

export function mergeToolboxRecentFiles<TToolId extends string>(
  sources: readonly ToolboxRecentSource<TToolId>[],
  limit = Number.POSITIVE_INFINITY,
): ToolboxRecentFile<TToolId>[] {
  return sources.flatMap(({ toolId, documents }) => documents.map((document) => ({
    key: `${toolId}:${document.id}`, toolId, projectId: document.id,
    name: document.name, updatedAt: document.updatedAt,
  })))
    .filter((file) => Number.isFinite(file.updatedAt))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(0, limit))
}

export function getToolboxRecentFileProviders<T extends ToolboxRuntimeTool>(tools: readonly T[]): readonly T[] {
  return tools.filter((tool) => tool.descriptor.actions.includes('recent_files'))
}

/** 汇总已登记工具的文档摘要；单个来源失败保留其他来源，工程数量不设上限。 */
export async function loadToolboxRecentFiles(
  tools = TOOLBOX_RUNTIME,
): Promise<ToolboxRecentFile[]> {
  const providers = getToolboxRecentFileProviders(tools)
  const operations = import('@/features/documents/documentOperations')
  const results = await Promise.allSettled(providers.map(async (tool) => {
    const { getDocumentOperations } = await operations
    return getDocumentOperations().listDocuments({
      kind: tool.descriptor.recentFiles.documentKind, container: { kind: 'any' },
      includeDrafts: false, includeMissing: false,
    })
  }))
  return mergeToolboxRecentFiles(providers.map((tool, index) => {
    const result = results[index]
    if (result.status === 'rejected') {
      logger.warn('工具首页最近文件读取失败', {
        event: 'toolbox.recent_files.load.failed', source: tool.descriptor.id,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
    return { toolId: tool.descriptor.id, documents: result.status === 'fulfilled' ? result.value : [] }
  }))
}

/**
 * 打开一个最近文件：先用工具自己的入口把工程装好，再切到该工具。
 * 失败时仍进入该工具（落在它的工程列表），并把错误交给调用方提示。
 */
export async function openToolboxRecentFile(file: ToolboxRecentFile): Promise<void> {
  try {
    const provider = getToolboxRecentFileProviders(TOOLBOX_RUNTIME).find((tool) => tool.descriptor.id === file.toolId)
    if (!provider?.openRecentFile) throw new Error(`工具 ${file.toolId} 没有最近文件打开入口`)
    await provider.openRecentFile(file.projectId)
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
