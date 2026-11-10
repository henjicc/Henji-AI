import { waitForGenerationTask } from '@/features/generation/application/waitForGenerationTask'
import type { ModelTag } from '@/core/types'
import { applicationGenerationTaskId } from '@/core/application-control/operationIdentity'
import { registry } from '@/core/ModelRegistry'
import { createMediaGeneratorPromptReferences } from '@/components/MediaGenerator/promptState'
import { toLegacyPromptString } from '@/core/inputs/promptDocument/index'
import { generationApplicationService } from '@/features/generation/application/generationApplicationService'
import { assertGenerationMediaDimensions, estimateGenerationPrice } from '@/features/generation/application/generationPreparationService'
import { generationService } from '@/core/services/GenerationService'
import { transferGenerationPaidApproval } from '@/core/services/generationSubmissionConfirmation'
import { applicationWritePreflight } from '@/core/application-control/execution/writeExecution'
import { resolveGenerationMediaReferences } from '@/features/generation/application/generationMediaReferences'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { useProjectStore } from '@/stores/projectStore'
import { useCanvasStore } from '@/stores/canvasStore'
import type { CanvasGenerationResumeInput, CanvasNodeGenerationInput, GenerationContinueFrom, GenerationDestination } from '@/core/application-control/domains/generation/generationApplicationCapabilities'
import { prepareGenerationContinuation } from '@/core/services/generationContinuations'
import { databaseService } from '@/services/database/index'
import { isBuiltinModelType } from '@/core/modelSortOrder'
import { modelDefaultsManager } from '@/features/settings/modelDefaultsManager'

import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'
import { parseCapabilityInput, throwIfCapabilityAborted } from '@/features/application-control/capabilities/handlerUtils'
import { normalizeCanvasDocumentNodeIds } from '@/features/canvas'

interface SearchModelsInput {
  query: string
  mediaType?: 'image' | 'video' | 'audio'
  providerId?: string
  tags?: ModelTag[]
  sortBy?: 'registry' | 'recommended' | 'lowest_estimated_price'
  cursor: number
  limit: number
}

interface GenerationInput {
  modelId?: string
  prompt?: string
  mediaType?: 'image' | 'video' | 'audio'
  params?: Record<string, unknown>
  destination?: GenerationDestination
  continueFrom?: GenerationContinueFrom
}

/** 续接的源结果：生成记录里保存的参数，或画布结果节点记下的源模型与参数。 */
async function readContinuationSource(from: GenerationContinueFrom): Promise<{ modelId: string; options: DynamicValueMap }> {
  if (from.kind === 'generation.task') {
    const record = await databaseService.getHistoryById(from.taskId)
    if (!record) throw new Error(`INVALID_INPUT:找不到要续接的生成任务 ${from.taskId}`)
    return { modelId: record.modelId, options: (record.params ?? {}) as DynamicValueMap }
  }
  const { getCanvasProjectInstance } = await import('@/features/canvas')
  const nodeId = normalizeCanvasDocumentNodeIds(from).nodeId
  const node = (await getCanvasProjectInstance(from.documentId)).store.getState().nodes.find(item => item.id === nodeId)
  const source = node?.data.generationContinuation
  if (!source) throw new Error(`INVALID_INPUT:画布节点 ${from.nodeId} 不是能续接的生成结果`)
  return { modelId: source.modelId, options: source.params }
}

/**
 * 续接请求：目标模型、参数与平台引用由源结果决定，调用方补写的提示词与参数覆盖在上面。
 * 调用方给的 modelId 必须就是续接的目标模型，避免把引用交给认不出它的模型。
 */
async function applyContinuation(parsed: GenerationInput, resolvedParams: Record<string, unknown> | undefined): Promise<GenerationInput> {
  if (!parsed.continueFrom) return parsed
  const source = await readContinuationSource(parsed.continueFrom)
  const prepared = prepareGenerationContinuation(source.modelId, source.options, parsed.continueFrom.continuationId)
  if (!prepared) throw new Error(`INVALID_INPUT:这个结果不能做续接 ${parsed.continueFrom.continuationId}`)
  if (parsed.modelId && parsed.modelId !== prepared.targetModelId) {
    throw new Error(`INVALID_INPUT:续接 ${prepared.id} 的目标模型是 ${prepared.targetModelId}，modelId 不能改成别的模型`)
  }
  const target = registry.getModel(prepared.targetModelId)
  return {
    ...parsed,
    modelId: prepared.targetModelId,
    mediaType: (target?.meta.type ?? parsed.mediaType) as GenerationInput['mediaType'],
    prompt: parsed.prompt ?? (typeof prepared.params.prompt === 'string' ? prepared.params.prompt : ''),
    params: { ...prepared.params, ...(resolvedParams ?? {}) },
  }
}

const UPLOADED_MEDIA_FIELDS = ['uploadedImages', 'uploadedVideos', 'uploadedAudios'] as const

function isCanvasNodeReference(value: unknown): value is { kind: 'canvas.node'; id: string } {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'canvas.node'
    && typeof (value as { id?: unknown }).id === 'string'
}

/**
 * 参考素材写成画布节点时，落到同一画布的任务改为从这些节点连线取素材：画布上的参考关系要看得见，
 * 不能只把图传给模型却不连线。其他落点拿不到画布连线，直接说明怎么改。
 */
function canvasNodeReferenceIds(input: GenerationInput, destination: GenerationDestination): string[] {
  const refs = UPLOADED_MEDIA_FIELDS.flatMap(field => {
    const values = Array.isArray(input.params?.[field]) ? input.params![field] as unknown[] : []
    const nodes = values.filter(isCanvasNodeReference)
    // 连线素材排在显式素材之后，混写会打乱“图1/图2”、首尾帧这类按顺序生效的输入
    if (nodes.length && nodes.length !== values.length) {
      throw new Error(`INVALID_INPUT:${field} 里不能混写画布节点和其他素材引用；都放到画布上用节点引用，或都改用 generation.result / asset。`)
    }
    return nodes
  })
  if (!refs.length) return []
  if (destination.mode !== 'canvas') {
    throw new Error('INVALID_INPUT:画布节点只能作为画布上任务的参考素材；把任务放到该画布（destination.mode="canvas"），或改用节点结果的 generation.result。')
  }
  const prefix = `${destination.documentId}:`
  return refs.map(ref => {
    if (!ref.id.startsWith(prefix)) {
      throw new Error(`INVALID_INPUT:canvas.node 引用 ${ref.id} 不属于目标画布 ${destination.documentId}，应写成 ${prefix}<节点 id>。`)
    }
    return ref.id.slice(prefix.length)
  })
}

function withoutCanvasNodeReferences(params: GenerationInput['params']): GenerationInput['params'] {
  if (!params) return params
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key,
    (UPLOADED_MEDIA_FIELDS as readonly string[]).includes(key) && Array.isArray(value) ? value.filter(item => !isCanvasNodeReference(item)) : value]))
}

function generationDestination(input: GenerationInput): GenerationDestination {
  const destination = continuationDestination(input, defaultGenerationDestination(input))
  const referenced = canvasNodeReferenceIds(input, destination)
  if (!referenced.length || destination.mode !== 'canvas') return destination
  // 省略落点时默认会带上用户当前选中的节点；调用方已点名参考节点时只用点名的，不把选中项一起送给模型
  const base = input.destination ? destination.sourceNodeIds : []
  return { ...destination, sourceNodeIds: [...new Set([...base, ...referenced])] }
}

function continuationDestination(input: GenerationInput, destination: GenerationDestination): GenerationDestination {
  if (!input.continueFrom || destination.mode !== 'canvas') return destination
  // 续接靠平台引用，不把源结果当素材连进来；从画布结果续接时新节点放在它旁边。
  const from = input.continueFrom.kind === 'canvas.node' ? normalizeCanvasDocumentNodeIds(input.continueFrom) : input.continueFrom
  const anchor = from.kind === 'canvas.node' && from.documentId === destination.documentId ? from.nodeId : undefined
  return { ...destination, sourceNodeIds: [], ...(destination.placement || !anchor ? {} : { placement: { mode: 'right_of_node', anchorNodeId: anchor } }) }
}

function defaultGenerationDestination(input: GenerationInput): GenerationDestination {
  if (input.destination) return input.destination.mode === 'canvas' ? normalizeCanvasDocumentNodeIds(input.destination) : input.destination
  const projectId = useProjectStore.getState().currentProjectId
  const selectedNodeId = useCanvasStore.getState().selectedNodeId
  return useNavigationStore.getState().activeWorkspace === 'nodes' && projectId
    ? { mode: 'canvas', documentId: projectId, sourceNodeIds: selectedNodeId ? [selectedNodeId] : [] }
    : { mode: 'history' }
}

async function prepareInput(original: GenerationInput, destination = generationDestination(original)): Promise<ResolvedGenerationInput> {
  // 画布节点引用已转成目标画布的来源连线，素材由连线解析，不再按上传素材解析
  const input = { ...original, params: withoutCanvasNodeReferences(original.params) }
  // 续接时调用方参数先解析媒体引用，再叠到源结果参数上；源参数里已是解析好的本地路径。
  const ownParams = input.params !== undefined ? await resolveGenerationMediaReferences(input.params) : undefined
  const parsed = await applyContinuation(input, ownParams)
  const resolved = resolveGenerationInput(parsed)
  if (parsed.params !== undefined) resolved.options = parsed.continueFrom ? parsed.params : ownParams
  if (destination.mode === 'canvas') {
    const { resolveCanvasGenerationOptions } = await import('@/features/canvas/application/canvasGenerationTaskService')
    resolved.options = await resolveCanvasGenerationOptions(resolved, destination)
  }
  return resolved
}

interface ResolveGenerationModelInput {
  requestedModelId?: string
  preferredProviderIds: string[]
  prompt: string
  mediaType: 'image' | 'video' | 'audio'
  params: Record<string, unknown>
}

interface ResolvedGenerationInput {
  modelId: string
  prompt: string
  mediaType: 'image' | 'video' | 'audio'
  options?: Record<string, unknown>
}

/*
 * 放宽提交（5.4）：modelId/prompt/mediaType 省略时用当前生成草稿（generationDraftStore）
 * 补全，让助手能像人一样先逐步搭建输入（写提示词、选模型、上传媒体）再提交，不必每次
 * 一次性传全部参数。
 *
 * params 省略时用草稿里已上传的媒体路径兜底；params 一旦显式传入就按调用方给的原样
 * 使用，不与草稿合并——这是为了不破坏"传参数时仍按传入值走"的兼容性（任务文档明确要求，
 * 也是现有调用方不受影响的关键：老代码一直显式传 modelId/prompt/mediaType/params 四项，
 * 这里的默认值分支永远不会命中它们）。
 */
function resolveGenerationInput(input: GenerationInput): ResolvedGenerationInput {
  const draft = useGenerationDraftStore.getState().draft

  const modelId = input.modelId ?? (input.mediaType ? modelDefaultsManager.resolveModelId(input.mediaType) : draft.selectedModel)
  if (!modelId) throw new Error('INVALID_INPUT:未提供 modelId，且当前生成草稿未选中模型')

  const prompt = input.prompt ?? toLegacyPromptString(draft.promptDocument, {
    references: createMediaGeneratorPromptReferences(draft.uploadedPromptImages),
  })

  const selectedModel = registry.getDiscoverableModel(modelId)
  if (!selectedModel && registry.hasModel(modelId)) {
    throw new Error(
      'INVALID_INPUT:该模型仅供受控画布图片能力执行，请改用 apply_canvas_image_capability',
    )
  }
  const mediaType = input.mediaType ?? selectedModel?.meta.type
  if (!mediaType) throw new Error(`INVALID_INPUT:未提供 mediaType，且无法从模型 ${modelId} 推断`)
  if (!isBuiltinModelType(mediaType)) {
    throw new Error(`INVALID_INPUT:模型 ${modelId} 的类型 ${mediaType} 尚未被当前生成能力支持`)
  }

  const options = input.params ?? {
    images: draft.uploadedPromptImages.map((image) => image.url),
    uploadedFilePaths: draft.uploadedFilePaths,
    videos: draft.uploadedVideos,
    uploadedVideoFilePaths: draft.uploadedVideoFilePaths,
    audios: draft.uploadedAudios,
    uploadedAudioFilePaths: draft.uploadedAudioFilePaths,
  }

  return { modelId, prompt, mediaType, options }
}

export function registerGenerationCapabilityHandlers(
  registrar: ApplicationCapabilityHandlerRegistrar
): void {
  registrar.registerHandler('search_models', (input) => {
    const parsed = parseCapabilityInput<SearchModelsInput>('search_models', input)
    const search = generationApplicationService.searchModels(parsed)
    const start = parsed.cursor
    const models = search.models.slice(start, start + parsed.limit)
    return {
      catalogVersion: 'model-registry/v1',
      models,
      nextCursor: start + models.length < search.models.length ? start + models.length : null,
      selectionContext: {
        requestedMediaType: parsed.mediaType ?? null,
        requestedProviderId: parsed.providerId ?? null,
        appliedProviderId: search.appliedProviderId,
        providerIdNormalized: search.providerIdNormalized,
        requestedTags: parsed.tags ?? [],
        requestedSortBy: parsed.sortBy ?? 'registry',
        requestedQuery: parsed.query,
        matchedQueryTerms: search.matchedQueryTerms,
        ignoredQueryTerms: search.ignoredQueryTerms,
        compatibleCandidateCount: search.models.length,
      },
    }
  })

  registrar.registerHandler('get_model_schema', (input) => {
    const parsed = parseCapabilityInput<{ modelId: string }>('get_model_schema', input)
    return generationApplicationService.getModelSchema(parsed.modelId)
  })

  registrar.registerHandler('resolve_generation_model', async (input) => {
    const parsed = parseCapabilityInput<ResolveGenerationModelInput>('resolve_generation_model', input)
    const resolved = await generationApplicationService.resolveModel({
      requestedModelId: parsed.requestedModelId,
      preferredProviderIds: parsed.preferredProviderIds,
      currentModelId: useGenerationDraftStore.getState().draft.selectedModel || undefined,
      prompt: parsed.prompt,
      mediaType: parsed.mediaType,
      options: parsed.params,
    })
    // IPC capability handler 的返回边界是可序列化字典。不直接泄漏领域 service 的
    // named interface，也不把未来可能增加的内部选择信息自动穿透给助手。
    return {
      modelId: resolved.modelId,
      providerId: resolved.providerId,
      selection: resolved.selection,
    }
  })

  registrar.registerHandler('prepare_generation_task', async (input) => {
    const parsed = parseCapabilityInput<GenerationInput>('prepare_generation_task', input)
    const resolved = await prepareInput(parsed)
    const prepared = generationApplicationService.prepare(resolved)
    // 助手提交时的付费授权金额取这里的估价，必须和界面一样补齐媒体指标。
    const model = registry.getModel(resolved.modelId)
    if (model) await assertGenerationMediaDimensions(model, prepared.options as DynamicValueMap)
    const preparation = model ? { ...prepared, priceEstimate: await estimateGenerationPrice(model, prepared.options as DynamicValueMap) } : prepared
    const providerConfigured = (await generationService.getConfiguredProviders()).includes(String(preparation.providerId))
    const unavailable = getProviderAvailabilityFailure(String(preparation.providerId), resolved.modelId)
    return {
      preparation: { ...preparation, providerConfigured, canSubmit: providerConfigured && !unavailable,
        ...(unavailable ? { errorCode: unavailable.code, retryAfterMs: Math.max(0, unavailable.expiresAt - Date.now()) } : {}),
        message: `${adjustmentNote(preparation.adjustedParams)}${unavailable?.message ?? (providerConfigured ? '参数已通过校验，供应商已配置；提交按统一付费策略执行。' : '参数已通过校验，但供应商未配置，不能提交。请先配置该供应商凭据，或选择已配置供应商的模型。')}` },
    }
  })

  registrar.registerHandler('create_visible_generation_task', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<GenerationInput>('create_visible_generation_task', input)
    const { destination, resolved } = await applicationWritePreflight(context, async () => {
      const destination = generationDestination(parsed)
      return { destination, resolved: await prepareInput(parsed, destination) }
    })
    const providerId = registry.getModel(resolved.modelId)?.meta.provider
    const unavailable = providerId && getProviderAvailabilityFailure(providerId, resolved.modelId)
    if (unavailable) throw new ApplicationPreflightFailure(new Error(`${unavailable.code}:${unavailable.message}`))
    throwIfCapabilityAborted(context.signal)
    const taskId = context.callerGrant && context.requestId ? applicationGenerationTaskId(context.requestId) : context.requestId ?? crypto.randomUUID()
    const releaseApproval = transferGenerationPaidApproval(taskId, context.signal)
    try {
    if (destination.mode === 'canvas') {
      const { submitCanvasGenerationTask } = await import('@/features/canvas/application/canvasGenerationTaskService')
      const preparation = generationApplicationService.prepare(resolved)
      return await submitCanvasGenerationTask({ ...resolved, options: preparation.options as Record<string, unknown> }, destination,
        taskId)
    }
    return await generationApplicationService.submit(resolved, taskId)
    } catch (error) { releaseApproval(); throw error }
  })

  registrar.registerHandler('get_generation_task', async (input) => {
    const parsed = parseCapabilityInput<{ taskId: string }>('get_generation_task', input)
    return { task: await readGenerationTask(parsed.taskId) }
  })

  registrar.registerHandler('wait_generation_task', async (input, context) => {
    const parsed = parseCapabilityInput<{ taskId: string }>('wait_generation_task', input)
    return waitForGenerationTask(() => readGenerationTask(parsed.taskId), context.signal)
  })

  registrar.registerHandler('cancel_generation_task', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      taskId: string
      reason: string
    }>('cancel_generation_task', input)
    const { cancelCanvasGenerationTask } = await import('@/features/canvas/application/canvasGenerationTaskService')
    return await cancelCanvasGenerationTask(parsed.taskId) ?? await generationApplicationService.cancelTask(parsed.taskId, parsed.reason)
  })

  registrar.registerHandler('prepare_canvas_node_generation', async input => {
    const parsed = normalizeCanvasDocumentNodeIds(parseCapabilityInput<CanvasNodeGenerationInput>('prepare_canvas_node_generation', input))
    const { prepareCanvasNodeGeneration } = await import('@/features/canvas/application/canvasGenerationTaskService')
    return prepareCanvasNodeGeneration(parsed)
  })
  registrar.registerHandler('submit_canvas_node_generation', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = normalizeCanvasDocumentNodeIds(parseCapabilityInput<CanvasNodeGenerationInput & { inputSignature: string }>('submit_canvas_node_generation', input))
    const { submitCanvasNodeGeneration } = await import('@/features/canvas/application/canvasGenerationTaskService')
    const taskId = applicationGenerationTaskId(context.requestId ?? crypto.randomUUID())
    const releaseApproval = transferGenerationPaidApproval(taskId, context.signal)
    try { return await submitCanvasNodeGeneration(parsed, taskId, context.signal) }
    catch (error) { releaseApproval(); throw error }
  })
  registrar.registerHandler('resume_canvas_generation_task', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = normalizeCanvasDocumentNodeIds(parseCapabilityInput<CanvasGenerationResumeInput>('resume_canvas_generation_task', input))
    const { resumeCanvasGenerationTask } = await import('@/features/canvas/application/canvasGenerationTaskService')
    return resumeCanvasGenerationTask(parsed, context.signal)
  })
}

async function readGenerationTask(taskId: string): Promise<Record<string, unknown>> {
  const { getCanvasGenerationTask } = await import('@/features/canvas/application/canvasGenerationTaskService')
  return await getCanvasGenerationTask(taskId) ?? { ...generationApplicationService.getTask(taskId) }
}
import { getProviderAvailabilityFailure } from '@/core/services/providerAvailability'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'

/** 联动换掉了调用方明确传入的值时放在提示最前面：要的东西做不到，调用方得先知道再决定换模型、换档位还是接受。 */
function adjustmentNote(adjusted: unknown): string {
  if (!Array.isArray(adjusted) || !adjusted.length) return ''
  const items = (adjusted as Array<{ paramId: string; requested: unknown; applied: unknown }>)
    .map((item) => `${item.paramId} 由 ${JSON.stringify(item.requested)} 改为 ${JSON.stringify(item.applied)}`)
  return `注意：以下参数与当前其他参数组合冲突，已按模型规则改掉：${items.join('；')}。若必须用原值，请先调整与之冲突的参数。`
}
