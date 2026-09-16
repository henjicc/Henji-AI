import { ApplicationControlExecutionEngine, ApplicationReflectionRegistry } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { BUILTIN_APPLICATION_CAPABILITIES } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { APPLICATION_DOMAINS } from '../applicationDomains'

let registry: ApplicationReflectionRegistry | undefined
let executionEngine: ApplicationControlExecutionEngine | undefined

export function getApplicationReflectionRegistry(): ApplicationReflectionRegistry {
  if (registry) return registry
  const next = new ApplicationReflectionRegistry(APPLICATION_CAPABILITY_CATALOG_VERSION)
  for (const domain of APPLICATION_DOMAINS) for (const registration of domain.entities()) {
    try { next.register(registration) }
    catch (error) { throw new Error(`应用反射注册失败：${domain.id} / ${registration.entity.id}。${String(error)}`) }
  }
  registry = next
  return next
}

export function collectionWritersByEntityType(
  operation: 'create' | 'remove'
): ReadonlyMap<string, readonly string[]> {
  const effect = operation === 'create' ? 'create' : 'delete'
  const writers = new Map<string, string[]>()
  for (const capability of BUILTIN_APPLICATION_CAPABILITIES) {
    if (capability.external) continue
    for (const impact of capability.control?.impacts ?? []) {
      if (impact.effect !== effect) continue
      for (const entityType of impact.entityTypes) {
        const list = writers.get(entityType) ?? []
        if (!list.includes(capability.id)) list.push(capability.id)
        writers.set(entityType, list)
      }
    }
  }
  return writers
}

export function getApplicationControlExecutionEngine(): ApplicationControlExecutionEngine {
  if (executionEngine) return executionEngine
  const creators = collectionWritersByEntityType('create')
  const removers = collectionWritersByEntityType('remove')
  const next = new ApplicationControlExecutionEngine(getApplicationReflectionRegistry(), {
    resolvePersistenceParticipants: (steps, context) => APPLICATION_DOMAINS.flatMap(domain => [...domain.resolvePersistenceParticipants?.(steps, context) ?? []]),
    describeCollectionWriters: (entityType, operation) => (operation === 'create' ? creators : removers).get(entityType) ?? [],
  })
  for (const domain of APPLICATION_DOMAINS) domain.registerExecutors(next)
  executionEngine = next
  return next
}
