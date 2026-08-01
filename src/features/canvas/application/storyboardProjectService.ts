import { getStoryboardProjectRecord, listStoryboardProjectSummaries } from '@/commands/storyboardProjects'

const MAX_DETAIL_ITEMS = 32

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

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
  return (await listStoryboardProjectSummaries()).map((project) => ({ ...project }))
}

export async function getStoryboardProject(projectId: string): Promise<Record<string, unknown>> {
  const project = await getStoryboardProjectRecord(projectId)
  if (!project) throw new Error('NOT_FOUND')
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    nodeCount: project.nodeCount,
    nodeSummary: summarizeCollection(parseJsonValue(project.nodesJson), ['id', 'type', 'position', 'selected']),
    edgeSummary: summarizeCollection(parseJsonValue(project.edgesJson), ['id', 'source', 'target', 'sourceHandle', 'targetHandle']),
    viewportBytes: new TextEncoder().encode(project.viewportJson).byteLength,
  }
}
