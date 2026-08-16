import type {
  HenjiScriptApiProjection,
  HenjiScriptPropertyDefinition,
} from '../../../../../src/core/assistant/capabilityDiscovery'
import type { AgentEffectKind } from '../../../../../src/core/assistant/observedEffect'

export interface HenjiScriptApiLease {
  actions: ReadonlySet<string>
  recipes: ReadonlySet<string>
  entityTypes: ReadonlySet<string>
  propertyIds: ReadonlySet<string>
  propertyDefinitions: ReadonlyMap<string, HenjiScriptPropertyDefinition>
  forbiddenEffects?: ReadonlySet<AgentEffectKind>
}

const leases = new Map<string, HenjiScriptApiLease>()

export function rememberHenjiScriptApiLease(
  runId: string,
  projection: HenjiScriptApiProjection,
): void {
  leases.set(runId, {
    actions: new Set(projection.actions.map((item) => item.id)),
    recipes: new Set(projection.recipes.map((item) => item.id)),
    entityTypes: new Set(projection.entities.entityTypes),
    propertyIds: new Set(projection.entities.propertyIds),
    propertyDefinitions: new Map(projection.entities.propertyDefinitions.map((item) => [item.id, item])),
    forbiddenEffects: new Set(projection.forbiddenEffects),
  })
}

export function getHenjiScriptApiLease(runId: string): HenjiScriptApiLease | null {
  return leases.get(runId) ?? null
}

export function clearHenjiScriptApiLease(runId: string): void {
  leases.delete(runId)
}
