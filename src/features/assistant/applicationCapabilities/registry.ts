import {
  BUILTIN_APPLICATION_CAPABILITY_REGISTRY,
  applyApplicationSettingsChangeCapability,
  closeApplicationSurfaceCapability,
  createImageEditPreviewFromRefCapability,
  focusApplicationEntityCapability,
  getApplicationSettingsCapability,
  getCurrentApplicationContextCapability,
  listGenerationHistoryCapability,
  openApplicationSurfaceCapability,
  openImageEditorWithSourceCapability,
  planApplicationSettingsChangeCapability,
  searchApplicationSettingsCapability,
} from '@/core/assistant/builtinApplicationCapabilities'
import { APPLICATION_SURFACE_IDS } from '@/core/assistant/applicationSurfaces'
import {
  applicationCapabilityInvocationSchema,
  type ApplicationCapabilityDefinition,
  type ApplicationCapabilityInvocation,
} from '@/core/assistant/applicationCapabilities'
import type { HostCommandResult } from '@/core/assistant/hostContracts'
import { createLogger } from '@/core/logging'

import { createHostContextSnapshot } from '../hostContext/hostContext'
import {
  createImageEditPreviewFromRef,
  listGenerationHistory,
  openImageEditorWithSource,
} from './generationCapabilities'
import {
  applyApplicationSettingsChange,
  getApplicationSettings,
  listApplicationSettingIds,
  planApplicationSettingsChange,
  searchApplicationSettings,
} from './settingsRegistry'
import {
  closeApplicationSurface,
  focusApplicationEntity,
  openApplicationSurface,
  listApplicationSurfaces,
} from './surfaceRegistry'

const logger = createLogger('features.assistant.application_capabilities')

interface CapabilityExecutionContext {
  signal: AbortSignal
}

type CapabilityHandler = (
  input: unknown,
  context: CapabilityExecutionContext
) => Promise<Record<string, unknown>> | Record<string, unknown>

class RendererApplicationCapabilityRegistry {
  private readonly definitions = new Map<string, ApplicationCapabilityDefinition>()
  private readonly handlers = new Map<string, CapabilityHandler>()

  register(
    definition: ApplicationCapabilityDefinition,
    handler: CapabilityHandler
  ): void {
    const current = this.definitions.get(definition.id)
    if (current) {
      throw new Error(`应用能力已注册：${definition.id}@${current.version}`)
    }
    if (!definition.permission.trim()) throw new Error(`应用能力未声明权限：${definition.id}`)
    if (definition.successEvidence.length === 0) {
      throw new Error(`应用能力缺少成功证据：${definition.id}`)
    }
    this.definitions.set(definition.id, definition)
    this.handlers.set(definition.id, handler)
  }

  listIds(): string[] {
    return [...this.definitions.keys()]
  }

  async execute(
    invocationInput: unknown,
    context: CapabilityExecutionContext
  ): Promise<Record<string, unknown>> {
    const invocation = applicationCapabilityInvocationSchema.parse(invocationInput)
    const definition = this.definitions.get(invocation.id)
    const handler = this.handlers.get(invocation.id)
    if (!definition || !handler) throw new Error('NOT_FOUND')
    if (definition.version !== invocation.version) throw new Error('VERSION_MISMATCH')
    const before = createHostContextSnapshot()
    for (const [scope, expected] of Object.entries(invocation.expectedRevisions ?? {})) {
      if (before.scopeRevisions[scope] !== expected) throw new Error('CONFLICT')
    }
    const input = definition.inputSchema.parse(invocation.input)
    const result = await handler(input, context)
    const snapshot = createHostContextSnapshot()
    const enriched = {
      ...result,
      revision: snapshot.revision,
      scopeRevisions: snapshot.scopeRevisions,
    }
    return definition.outputSchema.parse(enriched) as Record<string, unknown>
  }
}

const registry = new RendererApplicationCapabilityRegistry()

function registerBuiltins(): void {
  registry.register(getCurrentApplicationContextCapability, () => {
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
  registry.register(openApplicationSurfaceCapability, (input) => {
    const parsed = openApplicationSurfaceCapability.inputSchema.parse(input)
    return openApplicationSurface(parsed.surfaceId)
  })
  registry.register(closeApplicationSurfaceCapability, (input) => {
    const parsed = closeApplicationSurfaceCapability.inputSchema.parse(input)
    return closeApplicationSurface(parsed.surfaceId)
  })
  registry.register(focusApplicationEntityCapability, async (input, context) => {
    const parsed = focusApplicationEntityCapability.inputSchema.parse(input)
    return await focusApplicationEntity(parsed.ref, context.signal)
  })
  registry.register(searchApplicationSettingsCapability, (input) => {
    const parsed = searchApplicationSettingsCapability.inputSchema.parse(input)
    return { settings: searchApplicationSettings(parsed.query, parsed.limit) }
  })
  registry.register(getApplicationSettingsCapability, (input) => {
    const parsed = getApplicationSettingsCapability.inputSchema.parse(input)
    return getApplicationSettings(parsed.ids)
  })
  registry.register(planApplicationSettingsChangeCapability, (input) => {
    const parsed = planApplicationSettingsChangeCapability.inputSchema.parse(input)
    const plan = planApplicationSettingsChange(parsed.changes)
    return {
      ...plan,
      requiresReload: plan.changes.some((change) => change.requiresReload),
      requiresRestart: plan.changes.some((change) => change.requiresRestart),
    }
  })
  registry.register(applyApplicationSettingsChangeCapability, (input) => {
    const parsed = applyApplicationSettingsChangeCapability.inputSchema.parse(input)
    return applyApplicationSettingsChange(parsed.planRef)
  })
  registry.register(listGenerationHistoryCapability, async (input) => {
    const parsed = listGenerationHistoryCapability.inputSchema.parse(input)
    return await listGenerationHistory(parsed)
  })
  registry.register(openImageEditorWithSourceCapability, async (input) => {
    const parsed = openImageEditorWithSourceCapability.inputSchema.parse(input)
    return await openImageEditorWithSource(parsed.sourceRef)
  })
  registry.register(createImageEditPreviewFromRefCapability, async (input) => {
    const parsed = createImageEditPreviewFromRefCapability.inputSchema.parse(input)
    return await createImageEditPreviewFromRef(parsed)
  })
}

registerBuiltins()

if (registry.listIds().length !== BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().length) {
  throw new Error('应用能力注册不完整')
}
const registeredSurfaceIds = new Set(listApplicationSurfaces().map((surface) => surface.id))
for (const surfaceId of APPLICATION_SURFACE_IDS) {
  if (!registeredSurfaceIds.has(surfaceId)) throw new Error(`应用 Surface 未注册：${surfaceId}`)
}
if (listApplicationSettingIds().length === 0) {
  throw new Error('应用设置注册中心为空')
}

function toFailure(error: unknown): HostCommandResult {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'NOT_FOUND') {
    return { ok: false, error: { code: 'NOT_FOUND', message: '请求的应用对象不存在', recoverable: true } }
  }
  if (message === 'INVALID_INPUT' || message === 'VERSION_MISMATCH') {
    return { ok: false, error: { code: 'INVALID_INPUT', message: '应用能力参数无效', recoverable: true } }
  }
  if (message === 'CONFLICT') {
    return { ok: false, error: { code: 'CONFLICT', message: '应用状态已变化，请重新读取后再试', recoverable: true } }
  }
  return {
    ok: false,
    error: { code: 'COMMAND_REJECTED', message: message || '应用能力执行失败', recoverable: false },
  }
}

export async function executeApplicationCapabilityResult(
  invocation: ApplicationCapabilityInvocation,
  signal: AbortSignal
): Promise<HostCommandResult> {
  logger.info('capability.execute.start', {
    event: 'assistant.capability.execute.start',
    capabilityId: invocation.id,
  })
  try {
    const data = await registry.execute(invocation, { signal })
    const snapshot = createHostContextSnapshot()
    logger.info('capability.execute.completed', {
      event: 'assistant.capability.execute.completed',
      capabilityId: invocation.id,
      surface: snapshot.surface?.id,
    })
    return {
      ok: true,
      data,
      resultingRevision: snapshot.revision,
      resultingScopeRevisions: snapshot.scopeRevisions,
    }
  } catch (error) {
    logger.error('capability.execute.failed', error, {
      event: 'assistant.capability.execute.failed',
      capabilityId: invocation.id,
    })
    return toFailure(error)
  }
}

export function listRendererApplicationCapabilityIds(): string[] {
  return registry.listIds()
}
