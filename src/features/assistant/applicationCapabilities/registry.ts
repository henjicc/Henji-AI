import {
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
import {
  BUILTIN_APPLICATION_CAPABILITY_REGISTRY,
} from '@/core/assistant/builtinApplicationCapabilityRegistry'
import { APPLICATION_SURFACE_IDS } from '@/core/assistant/applicationSurfaces'
import {
  applicationCapabilityInvocationSchema,
  type ApplicationCapabilityDefinition,
  type ApplicationCapabilityInvocation,
} from '@/core/assistant/applicationCapabilities'
import type { ApplicationCapabilityResult } from '@/core/assistant/hostContracts'
import { GenerationPreparationError } from '@/core/assistant/generationPreparation'
import { createLogger } from '@/core/logging'
import { AgentCanvasActionError } from '@/features/canvas/application/agentCanvasActions'
import { ZodError } from 'zod'

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
import type {
  ApplicationCapabilityHandlerRegistrar,
  CapabilityExecutionContext,
  CapabilityHandler,
} from './handlerTypes'
import { registerAssetCapabilityHandlers } from './registerAssetCapabilityHandlers'
import { registerCanvasCapabilityHandlers } from './registerCanvasCapabilityHandlers'
import { registerGenerationCapabilityHandlers } from './registerGenerationCapabilityHandlers'
import { registerToolboxCapabilityHandlers } from './registerToolboxCapabilityHandlers'

const logger = createLogger('features.assistant.application_capabilities')

class RendererApplicationCapabilityRegistry implements ApplicationCapabilityHandlerRegistrar {
  private readonly definitions = new Map<string, ApplicationCapabilityDefinition>()
  private readonly handlers = new Map<string, CapabilityHandler>()

  constructor() {
    for (const definition of BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list()) {
      this.definitions.set(definition.id, definition)
    }
  }

  registerHandler(id: string, handler: CapabilityHandler): void {
    const definition = this.definitions.get(id)
    if (!definition) throw new Error(`应用能力定义不存在：${id}`)
    if (this.handlers.has(id)) throw new Error(`应用能力处理器重复：${id}`)
    if (!definition.permission.trim()) throw new Error(`应用能力未声明权限：${id}`)
    if (definition.successEvidence.length === 0) throw new Error(`应用能力缺少成功证据：${id}`)
    this.handlers.set(id, handler)
  }

  listIds(): string[] {
    return [...this.handlers.keys()]
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
    const enrichedOutput = definition.outputSchema.safeParse(enriched)
    if (enrichedOutput.success) return enrichedOutput.data as Record<string, unknown>
    return definition.outputSchema.parse(result) as Record<string, unknown>
  }
}

const registry = new RendererApplicationCapabilityRegistry()

function registerBuiltins(): void {
  registry.registerHandler(getCurrentApplicationContextCapability.id, () => {
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
  registry.registerHandler(openApplicationSurfaceCapability.id, (input) => {
    const parsed = openApplicationSurfaceCapability.inputSchema.parse(input)
    return openApplicationSurface(parsed.surfaceId)
  })
  registry.registerHandler(closeApplicationSurfaceCapability.id, (input) => {
    const parsed = closeApplicationSurfaceCapability.inputSchema.parse(input)
    return closeApplicationSurface(parsed.surfaceId)
  })
  registry.registerHandler(focusApplicationEntityCapability.id, async (input, context) => {
    const parsed = focusApplicationEntityCapability.inputSchema.parse(input)
    return await focusApplicationEntity(parsed.ref, context.signal)
  })
  registry.registerHandler(searchApplicationSettingsCapability.id, (input) => {
    const parsed = searchApplicationSettingsCapability.inputSchema.parse(input)
    return { settings: searchApplicationSettings(parsed.query, parsed.limit) }
  })
  registry.registerHandler(getApplicationSettingsCapability.id, (input) => {
    const parsed = getApplicationSettingsCapability.inputSchema.parse(input)
    return getApplicationSettings(parsed.ids)
  })
  registry.registerHandler(planApplicationSettingsChangeCapability.id, (input) => {
    const parsed = planApplicationSettingsChangeCapability.inputSchema.parse(input)
    const plan = planApplicationSettingsChange(parsed.changes)
    return {
      ...plan,
      requiresReload: plan.changes.some((change) => change.requiresReload),
      requiresRestart: plan.changes.some((change) => change.requiresRestart),
    }
  })
  registry.registerHandler(applyApplicationSettingsChangeCapability.id, (input) => {
    const parsed = applyApplicationSettingsChangeCapability.inputSchema.parse(input)
    return applyApplicationSettingsChange(parsed.planRef)
  })
  registry.registerHandler(listGenerationHistoryCapability.id, async (input) => {
    const parsed = listGenerationHistoryCapability.inputSchema.parse(input)
    return await listGenerationHistory(parsed)
  })
  registry.registerHandler(openImageEditorWithSourceCapability.id, async (input) => {
    const parsed = openImageEditorWithSourceCapability.inputSchema.parse(input)
    return await openImageEditorWithSource(parsed.sourceRef)
  })
  registry.registerHandler(createImageEditPreviewFromRefCapability.id, async (input) => {
    const parsed = createImageEditPreviewFromRefCapability.inputSchema.parse(input)
    return await createImageEditPreviewFromRef(parsed)
  })
}

registerBuiltins()
registerGenerationCapabilityHandlers(registry)
registerAssetCapabilityHandlers(registry)
registerCanvasCapabilityHandlers(registry)
registerToolboxCapabilityHandlers(registry)

const frontendCapabilityCount = BUILTIN_APPLICATION_CAPABILITY_REGISTRY
  .list()
  .filter((definition) => definition.side === 'frontend')
  .length
if (registry.listIds().length !== frontendCapabilityCount) {
  throw new Error('应用能力注册不完整')
}
const registeredSurfaceIds = new Set(listApplicationSurfaces().map((surface) => surface.id))
for (const surfaceId of APPLICATION_SURFACE_IDS) {
  if (!registeredSurfaceIds.has(surfaceId)) throw new Error(`应用 Surface 未注册：${surfaceId}`)
}
if (listApplicationSettingIds().length === 0) {
  throw new Error('应用设置注册中心为空')
}

function toFailure(error: unknown): ApplicationCapabilityResult {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof AgentCanvasActionError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
        details: error.details,
      },
    }
  }
  if (error instanceof GenerationPreparationError) {
    return {
      ok: false,
      error: {
        code: error.code === 'MODEL_NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_INPUT',
        message: error.message,
        recoverable: true,
        details: error.details,
      },
    }
  }
  if (error instanceof ZodError) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: '应用能力参数无效',
        recoverable: true,
      },
    }
  }
  if (message === 'ABORTED' || (error instanceof DOMException && error.name === 'AbortError')) {
    return { ok: false, error: { code: 'ABORTED', message: '操作已取消', recoverable: false } }
  }
  if (message === 'NOT_FOUND' || message.endsWith('_NOT_FOUND')) {
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
    error: { code: 'CAPABILITY_REJECTED', message: message || '应用能力执行失败', recoverable: false },
  }
}

export async function executeApplicationCapabilityResult(
  invocation: ApplicationCapabilityInvocation,
  signal: AbortSignal
): Promise<ApplicationCapabilityResult> {
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
