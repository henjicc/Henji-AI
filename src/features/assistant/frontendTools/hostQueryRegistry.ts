import { hostQuerySchema, type HostQuery } from '@/core/assistant/hostContracts'
import { useProjectStore } from '@/stores/projectStore'

import { createHostContextSnapshot } from '../hostContext/hostContext'

type HostQueryHandler = (query: HostQuery) => Promise<Record<string, unknown>>

const handlers = new Map<HostQuery['name'], HostQueryHandler>([
  ['get_host_context', async () => ({ snapshot: createHostContextSnapshot() })],
  ['list_canvas_projects', async () => {
    if (!useProjectStore.getState().isHydrated) await useProjectStore.getState().hydrate()
    return { projects: useProjectStore.getState().projects }
  }],
])

export async function executeHostQuery(queryInput: unknown): Promise<Record<string, unknown>> {
  const query = hostQuerySchema.parse(queryInput)
  const handler = handlers.get(query.name)
  if (!handler) throw new Error(`Unknown host query: ${query.name}`)
  return await handler(query)
}
