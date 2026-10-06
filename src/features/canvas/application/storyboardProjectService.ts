import { findCanvasProjectInstance } from './canvasProjectInstances'
import { listCanvasDocumentSummaries } from './canvasProjectService'
import { readPersistedCanvasProjectSnapshot } from './canvasQueryService'

/*
 * 分镜摘要（画布的只读投影）：3.4 起直接读画布文档（打开着的取实例，其余读文件），不再查画布表。
 * 列出与读取由分镜反射使用；分镜没有自己的能力入口，读详情用 get_canvas_document。
 */

const MAX_DETAIL_ITEMS = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function summarizeCollection(value: unknown, fields: string[]) {
  const collection = Array.isArray(value) ? value : []
  const items = collection.slice(0, MAX_DETAIL_ITEMS).flatMap((item) => {
    if (!isRecord(item)) return []
    const summary: Record<string, unknown> = {}
    for (const field of fields) {
      const fieldValue = item[field]
      if (typeof fieldValue === 'string' || typeof fieldValue === 'number' || typeof fieldValue === 'boolean') {
        summary[field] = fieldValue
      }
    }
    return [summary]
  })
  return {
    count: collection.length,
    ids: items.flatMap((item) => typeof item.id === 'string' ? [item.id] : []),
    items,
    truncated: collection.length > MAX_DETAIL_ITEMS,
  }
}

export async function listStoryboardProjects(): Promise<Record<string, unknown>[]> {
  return (await listCanvasDocumentSummaries()).map((project) => ({ ...project }))
}

export async function getStoryboardProject(projectId: string): Promise<Record<string, unknown>> {
  const instance = findCanvasProjectInstance(projectId)
  let project
  try {
    project = instance ? instance.snapshot() : await readPersistedCanvasProjectSnapshot(projectId)
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') throw new Error('NOT_FOUND')
    throw error
  }
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    nodeCount: project.nodes.length,
    nodeSummary: summarizeCollection(project.nodes, ['id', 'type', 'selected']),
    edgeSummary: summarizeCollection(project.edges, ['id', 'source', 'target', 'sourceHandle', 'targetHandle']),
  }
}
