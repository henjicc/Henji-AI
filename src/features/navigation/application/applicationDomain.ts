import { switchWorkspace } from '@/stores/navigationStore'
import { parseCapabilityInput, throwIfCapabilityAborted } from '@/features/application-control/capabilities/handlerUtils'
import { APPLICATION_SURFACE_IDS } from '@/core/application-control/applicationSurfaces'
import { listApplicationSurfaces } from './surfaceCapabilityService'
import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { closeApplicationSurfaceCapability, focusApplicationEntityCapability, getCurrentApplicationContextCapability, openApplicationSurfaceCapability, observeApplicationSurfaceCapability } from '@/core/application-control/builtinApplicationCapabilities'
import { createHostContextSnapshot } from '@/features/application-control/hostContext/hostContext'
import { closeApplicationSurface, focusApplicationEntity, openApplicationSurface } from './surfaceCapabilityService'
import { observeApplicationSurface } from './surfaceObservation'

export const navigationApplicationDomain: ApplicationDomainModule = {
  id: 'navigation',
  entities: () => [],
  registerExecutors() {},
  registerCapabilities(registrar) {
  registrar.registerHandler('switch_workspace', (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      workspaceId: 'generation' | 'nodes' | 'tools' | 'assets'
    }>('switch_workspace', input)
    switchWorkspace(parsed.workspaceId)
    return { workspace: parsed.workspaceId }
  })

  registrar.registerHandler(getCurrentApplicationContextCapability.id, () => {
    const snapshot = createHostContextSnapshot()
    return {
      surface: snapshot.surface ?? {
        id: `workspace.${snapshot.workspace.id}`,
        kind: 'workspace',
        focusedRef: null,
        selectedRefs: [],
      },
      catalogRevision: snapshot.catalogRevision ?? 0,
      ready: snapshot.uiReady,
      revision: snapshot.revision,
    }
  })
  registrar.registerHandler(observeApplicationSurfaceCapability.id, async (input, context) => {
    const parsed = observeApplicationSurfaceCapability.inputSchema.parse(input)
    return await observeApplicationSurface(parsed, context.signal)
  })
  registrar.registerHandler(openApplicationSurfaceCapability.id, (input, context) => {
    const parsed = openApplicationSurfaceCapability.inputSchema.parse(input)
    return openApplicationSurface(parsed.surfaceId, context)
  })
  registrar.registerHandler(closeApplicationSurfaceCapability.id, (input) => {
    const parsed = closeApplicationSurfaceCapability.inputSchema.parse(input)
    return closeApplicationSurface(parsed.surfaceId)
  })
  registrar.registerHandler(focusApplicationEntityCapability.id, async (input, context) => {
    const parsed = focusApplicationEntityCapability.inputSchema.parse(input)
    return await focusApplicationEntity(parsed.ref, context.signal, context)
  })

  },
  validate() {
const registeredSurfaceIds = new Set(listApplicationSurfaces().map((surface) => surface.id))
for (const surfaceId of APPLICATION_SURFACE_IDS) {
  if (!registeredSurfaceIds.has(surfaceId)) throw new Error(`应用 Surface 未注册：${surfaceId}`)
}
  },
}
