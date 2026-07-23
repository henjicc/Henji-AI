import {
  hostQuerySchema,
  type HostCommandResult,
  type HostQuery,
} from '@/core/assistant/hostContracts'
import { registry } from '@/core/ModelRegistry'
import { getI18nText } from '@/core/types'
import { useProjectStore } from '@/stores/projectStore'
import { getVisibleGenerationTask } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'

import { createHostContextSnapshot } from '../hostContext/hostContext'

type HostQueryHandler = (query: HostQuery) => Promise<Record<string, unknown>>

const handlers = new Map<HostQuery['name'], HostQueryHandler>([
  ['get_host_context', async () => ({ snapshot: createHostContextSnapshot() })],
  ['list_canvas_projects', async () => {
    if (!useProjectStore.getState().isHydrated) await useProjectStore.getState().hydrate()
    return { projects: useProjectStore.getState().projects }
  }],
  ['search_models', async (query) => {
    if (query.name !== 'search_models') return {}
    const normalized = query.input.query.trim().toLowerCase()
    const filtered = registry.listAllModels().filter((model) => {
      if (query.input.mediaType && model.meta.type !== query.input.mediaType) return false
      if (query.input.providerId && model.meta.provider !== query.input.providerId) return false
      if (!normalized) return true
      return `${model.meta.id} ${getI18nText(model.meta.name, 'zh')} ${getI18nText(model.meta.name, 'en')}`
        .toLowerCase()
        .includes(normalized)
    })
    const start = query.input.cursor
    const models = filtered.slice(start, start + query.input.limit).map((model) => ({
      modelId: model.meta.id,
      providerId: model.meta.provider,
      mediaType: model.meta.type,
      name: model.meta.name,
      tags: model.meta.tags ?? [],
    }))
    return {
      catalogVersion: 'model-registry/v1',
      models,
      nextCursor: start + models.length < filtered.length ? start + models.length : null,
    }
  }],
  ['get_model_schema', async (query) => {
    if (query.name !== 'get_model_schema') return {}
    const model = registry.getModel(query.input.modelId)
    if (!model) throw new Error('MODEL_NOT_FOUND')
    const params = model.params.map((param) => ({
      id: param.id,
      type: param.type,
      name: param.name,
      description: param.description,
      required: param.required === true,
      default: param.default,
      options: 'options' in param ? param.options : undefined,
    }))
    return {
      schemaVersion: 'model-schema/v1',
      meta: {
        id: model.meta.id,
        provider: model.meta.provider,
        type: model.meta.type,
        name: model.meta.name,
        tags: model.meta.tags ?? [],
      },
      params: JSON.parse(JSON.stringify(params)) as unknown,
    }
  }],
  ['get_generation_task', async (query) => {
    if (query.name !== 'get_generation_task') return {}
    const task = getVisibleGenerationTask(query.input.taskId)
    if (!task) throw new Error('TASK_NOT_FOUND')
    return { task }
  }],
])

export async function executeHostQuery(queryInput: unknown): Promise<Record<string, unknown>> {
  const query = hostQuerySchema.parse(queryInput)
  const handler = handlers.get(query.name)
  if (!handler) throw new Error(`Unknown host query: ${query.name}`)
  return await handler(query)
}

export async function executeHostQueryResult(queryInput: unknown): Promise<HostCommandResult> {
  try {
    const data = await executeHostQuery(queryInput)
    const snapshot = createHostContextSnapshot()
    return {
      ok: true,
      data,
      resultingRevision: snapshot.revision,
      resultingScopeRevisions: snapshot.scopeRevisions,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'MODEL_NOT_FOUND' || message === 'TASK_NOT_FOUND') {
      return {
        ok: false,
        error: { code: 'NOT_FOUND', message: '请求的宿主资源不存在', recoverable: false },
      }
    }
    return {
      ok: false,
      error: { code: 'COMMAND_REJECTED', message: message || '宿主查询执行失败', recoverable: false },
    }
  }
}
