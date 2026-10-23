import { initializeMemoryDefaults } from '../memory/memoryDefaults'
import { organizeAssistantMemoryCapability, revertAssistantMemoryCapability } from '@/core/application-control/domains/assistantMemory/memoryCapabilities'
import { organizeMemory, revertMemory, refreshMemory } from '../memory/memoryService'
import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { createMemoryRegistrations, MemoryExecutor, MemorySettingsExecutor } from './memoryReflection'
export const memoryApplicationDomain: ApplicationDomainModule = {
  id: 'memory',
  entities: createMemoryRegistrations,
  registerExecutors(engine) {
    for (const layer of ['global', 'project', 'style'] as const) {
      const executor = new MemoryExecutor(layer)
      engine.registerMutationExecutor(executor)
      engine.registerCollectionExecutor(executor)
    }
    engine.registerMutationExecutor(new MemorySettingsExecutor())
  },
  registerCapabilities(registrar) {
    initializeMemoryDefaults()
    const receipt = async (changed: number) => { await refreshMemory(); return { resultRef: { kind: 'assistant.memory_settings' as const, id: 'singleton' as const }, changed, message: '记忆已更新，可在修改历史中查看并撤回。', verification: { verified: true, condition: '已回读记忆状态，修改写入历史。' } } }
    registrar.registerHandler(revertAssistantMemoryCapability.id, async (raw, context) => { const input = revertAssistantMemoryCapability.inputSchema.parse(raw); context.signal?.throwIfAborted(); await revertMemory(input.historyId, 'assistant'); return receipt(1) })
    registrar.registerHandler(organizeAssistantMemoryCapability.id, async (raw, context) => { const input = organizeAssistantMemoryCapability.inputSchema.parse(raw); context.signal?.throwIfAborted(); return receipt(await organizeMemory(true, input.changes)) })
  },
}
