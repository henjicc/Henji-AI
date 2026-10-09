import { convertImageEditFilterScopeCapability } from '@/core/application-control/domains/imageEdit/imageEditFilterCapabilities'
import { prepareImageEditFilterConversionV3, commitImageEditFilterConversionV3 } from '../v3/filterWorkspace/service'
import { findImageEditLayerLocationV3 } from '../v3/editor/layerTreeV3'
import { computeImageEditSelectionCapability } from '@/core/application-control/domains/imageEdit/imageEditAdvancedSelectionCapabilities'
import { previewImageEditSelectionIntentV3, applyImageEditSelectionPreviewV3 } from '../v3/tools/selectionAdvanced/service'
import { snapshotImageEditFilterSelectionV3 } from '../v3/filterWorkspace/service'
import { splitImageEditV3FilterRef, imageEditV3FilterRef } from '../v3/application/imageEditDocumentRefs'
import { selectImageEditRegionCapability } from '@/core/application-control/domains/imageEdit/imageEditSubjectCapabilities'
import { selectImageEditRegionV3 } from '../v3/application/imageEditSubjectSelectionServiceV3'
import { retryImageEditDocumentSaveV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOperations'
import { splitImageEditV3DocumentRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'
import { splitImageEditV3LayerRef, imageEditV3LayerRef, findImageEditV3LiveLayer } from '../v3/application/imageEditDocumentRefs'
import { applyImageEditSelectionCapability } from '@/core/application-control/domains/imageEdit/imageEditSelectionCapabilities'
import { applyImageEditSelectionV3 } from '../v3/application/imageEditSelectionServiceV3'
import { IMAGE_EDIT_REPAIR_CAPABILITIES, repairImageEditRegionCapability, imageEditRepairInputSchema } from '@/core/application-control/domains/imageEdit/imageEditRepairCapabilities'
import { repairImageEditRegionV3 } from '../v3/application/imageEditRepairServiceV3'
import { imageEditV3DocumentRef } from '../v3/application/imageEditDocumentRefs'
import { requireImageEditDocumentInstanceV3 } from '../v3/application/imageEditDocumentInstances'
import { runImageEditPersistedOperationV3 } from '../v3/application/imageEditPersistenceOperations'
import { applicationCallerAccess } from '@/core/application-control/callerContext'
import type { ApplicationRef } from '@/core/application-control/applicationCapabilities'

import { commitImageEdit } from '@/features/imageEdit/application/imageEditApplicationService'

import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'
import { createImageEditPreviewFromRef } from '@/features/imageEdit/application/imageSourceCapabilityService'
import { readImageEditPreview } from '@/features/imageEdit/application/imageEditSessionRegistry'
import { parseCapabilityInput, throwIfCapabilityAborted } from '@/features/application-control/capabilities/handlerUtils'
import { registerDocumentCreator, registerDocumentOpener, registerDocumentReleaser } from '@/features/documents/documentOperations'
import { UI_WHITE_HEX } from '@/components/ui/styleTokens'
import { createBlankImageDataUrl } from '@/features/imageMark/standalone/blankImage'
import { createImageDocumentFromSource } from '@/features/imageMark/standalone/imageDocumentFromSource'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { releaseImageDocument } from '@/features/imageEdit/documents/imageDocumentRuntime'
import { requestImageDocumentInEditor } from '@/features/imageEdit/documents/imageDocumentWorkspace'

export function registerImageEditCapabilityHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  registrar.registerHandler(convertImageEditFilterScopeCapability.id, async (input, context) => {
    const parsed = convertImageEditFilterScopeCapability.inputSchema.parse(input)
    const target = parsed.targetRef.kind === 'image_edit.layer_filter' ? splitImageEditV3FilterRef(parsed.targetRef) : splitImageEditV3LayerRef(parsed.targetRef)
    const { documentId, layerId } = target
    const access = context.callerGrant ? applicationCallerAccess(context.callerGrant, context.requestId ?? 'convert-filter', context.signal) : undefined
    return runImageEditPersistedOperationV3(documentId, access, async () => {
      const { bus, persistenceOwner } = requireImageEditDocumentInstanceV3(documentId)
      if (access && persistenceOwner?.projection?.requiredPermissions.some(p => !access.permissions.has(p))) throw new Error('PERMISSION_DENIED:图片文档节点保存需要原画布的写入权限')
      context.signal?.throwIfAborted()
      const location = findImageEditLayerLocationV3(bus.getSnapshot().document.layers, layerId)
      if (!location) throw new Error('图层不存在，请重新读取')
      const below = location.container[location.index - 1]
      const filterId = 'filterId' in target && typeof target.filterId === 'string' ? target.filterId : null
      if (!filterId && !below) throw new Error('没有可挂载的下方图层')
      const plan = prepareImageEditFilterConversionV3(bus, filterId
        ? { direction: 'content-to-composite', layerId, filterId, title: location.layer.name + ' · 滤镜' }
        : { direction: 'composite-to-content', layerId, targetLayerId: below.id })
      const commandId = commitImageEditFilterConversionV3(bus, plan)
      const result = findImageEditV3LiveLayer(bus.getSnapshot().document, plan.resultLayerId)
      return { ref: plan.resultFilterId ? imageEditV3FilterRef(documentId, plan.resultLayerId, plan.resultFilterId) : imageEditV3LayerRef(documentId, plan.resultLayerId),
        ownerRef: imageEditV3LayerRef(documentId, filterId ? layerId : plan.resultLayerId), commandId, beforeTargets: plan.beforeTargets, afterTargets: plan.afterTargets,
        verification: { verified: Boolean(result && (!plan.resultFilterId || result.layer.filters.some(f => f.id === plan.resultFilterId))) } }
    })
  })
  registrar.registerHandler(computeImageEditSelectionCapability.id, async (input, context) => {
    const parsed = computeImageEditSelectionCapability.inputSchema.parse(input)
    const { documentId, layerId } = splitImageEditV3LayerRef(parsed.targetRef)
    const access = context.callerGrant ? applicationCallerAccess(context.callerGrant, context.requestId ?? 'compute-selection', context.signal) : undefined
    return runImageEditPersistedOperationV3(documentId, access, async () => {
      const { bus, persistenceOwner } = requireImageEditDocumentInstanceV3(documentId)
      if (access && persistenceOwner?.projection?.requiredPermissions.some(p => !access.permissions.has(p))) throw new Error('PERMISSION_DENIED:图片文档节点保存需要原画布的写入权限')
      const preview = await previewImageEditSelectionIntentV3(bus, layerId, parsed.operation, parsed.combine, { signal: context.signal })
      applyImageEditSelectionPreviewV3(bus, preview)
      return { ref: { ...imageEditV3DocumentRef(documentId), kind: 'image_edit.selection' }, verification: { verified: JSON.stringify(bus.getSnapshot().selection) === JSON.stringify(preview.result) } }
    })
  })
  registrar.registerHandler(selectImageEditRegionCapability.id, async (input, context) => {
    const parsed = selectImageEditRegionCapability.inputSchema.parse(input)
    const { documentId, layerId } = splitImageEditV3LayerRef(parsed.targetRef)
    const access = context.callerGrant ? applicationCallerAccess(context.callerGrant, context.requestId ?? 'select-region', context.signal) : undefined
    return runImageEditPersistedOperationV3(documentId, access, async () => {
      const { bus, persistenceOwner } = requireImageEditDocumentInstanceV3(documentId)
      if (access && persistenceOwner?.projection?.requiredPermissions.some(permission => !access.permissions.has(permission))) throw new Error('PERMISSION_DENIED:图片文档节点保存需要原画布的写入权限')
      const result = await selectImageEditRegionV3(bus, layerId, { region: parsed.region, candidateId: parsed.candidateId, combine: parsed.combine, signal: context.signal })
      const ref = { ...imageEditV3DocumentRef(documentId), kind: 'image_edit.selection' as const }
      return { ref, status: result.status, candidates: result.candidates,
        verification: { verified: result.status === 'candidates' ? result.candidates.length > 1 : JSON.stringify(bus.getSnapshot().selection) === JSON.stringify(result.selection) } }
    })
  })
  for (const capability of IMAGE_EDIT_REPAIR_CAPABILITIES) registrar.registerHandler(capability.id, async (input, context) => {
    const parsed = capability.inputSchema.parse(input)
    const { documentId, layerId } = splitImageEditV3LayerRef(parsed.targetRef)
    if (parsed.region.kind === 'selection' && parsed.region.ref.id !== imageEditV3DocumentRef(documentId).id) throw new Error('选区引用与目标图层不在同一个图片文档，请读取目标文档的选区引用')
    const access = context.callerGrant ? applicationCallerAccess(context.callerGrant, context.requestId ?? 'repair-region', context.signal) : undefined
    return runImageEditPersistedOperationV3(documentId, access, async () => {
      const { bus, persistenceOwner } = requireImageEditDocumentInstanceV3(documentId)
      if (access && persistenceOwner?.projection?.requiredPermissions.some(permission => !access.permissions.has(permission))) throw new Error('PERMISSION_DENIED:图片文档节点保存需要原画布的写入权限')
      const result = await repairImageEditRegionV3(bus, layerId, { action: capability.id === 'remove_image_edit_region' ? 'remove' : 'repair', quality: parsed.quality,
        ...(parsed.region.kind === 'subject' || parsed.region.kind === 'portrait' ? { semanticRegion: parsed.region.kind, candidateId: parsed.region.candidateId } : {}),
        ...(parsed.region.kind === 'rectangle' ? { rectangle: { x: parsed.region.x, y: parsed.region.y, width: parsed.region.width, height: parsed.region.height } } : {}),
        ...(capability.id === repairImageEditRegionCapability.id ? { sourceRegion: imageEditRepairInputSchema.parse(input).sourceRegion } : {}), signal: context.signal })
      const current = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
      const head = bus.getPersistenceSnapshot().history.undo.at(-1)?.forward
      return { ref: imageEditV3LayerRef(documentId, layerId), documentRef: imageEditV3DocumentRef(documentId), commandId: result.commandId,
        verification: { verified: current?.layer.type === 'raster' && head?.commandId === result.commandId && head.type === 'raster.apply-tile-delta' && head.layerId === layerId && head.changes.every(change => current.layer.type === 'raster' && current.layer.tiles[change.tileKey] === change.resourceId) } }
    })
  })
  registrar.registerHandler(applyImageEditSelectionCapability.id, async (input, context) => {
    const parsed = applyImageEditSelectionCapability.inputSchema.parse(input)
    const target = parsed.targetRef.kind === 'image_edit.layer_filter' ? splitImageEditV3FilterRef(parsed.targetRef) : splitImageEditV3LayerRef(parsed.targetRef)
    const { documentId, layerId } = target
    const executionContext = context.callerGrant ? applicationCallerAccess(context.callerGrant, context.requestId ?? 'selection-apply', context.signal) : undefined
    return runImageEditPersistedOperationV3(documentId, executionContext, async () => {
      const { bus } = requireImageEditDocumentInstanceV3(documentId)
      const owner = requireImageEditDocumentInstanceV3(documentId).persistenceOwner
      if (executionContext && owner?.projection?.requiredPermissions.some(p => !executionContext.permissions.has(p))) throw new Error('PERMISSION_DENIED:图片文档节点保存需要原画布的写入权限')
      if ('filterId' in target && typeof target.filterId === 'string') {
        const commandId = await snapshotImageEditFilterSelectionV3(bus, layerId, target.filterId, context.signal)
        return { ref: imageEditV3FilterRef(documentId, layerId, target.filterId), commandId,
          verification: { verified: Boolean(findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)?.layer.filters.find(f => f.id === target.filterId)?.mask) } }
      }
      const result = await applyImageEditSelectionV3(bus, layerId, parsed.action, context.signal)
      return { ref: imageEditV3LayerRef(documentId, result.layerId), commandId: result.commandId,
        verification: { verified: Boolean(findImageEditV3LiveLayer(bus.getSnapshot().document, result.layerId)?.layer.mask) } }
    })
  })
  // 图片文档的通用打开与后台释放（3.5）：列出、新建、移动、副本、回收站、改名走通用文档能力，
  // 这里只登记“打开到哪里”（工具箱图片编辑页接手，离开当前文档时按草稿规则询问）和后台会话怎么释放。
  registerDocumentOpener('image_document', (document) => {
    requestImageDocumentInEditor({ id: document.id, path: document.path })
    openApplicationSurface('tool.image_edit')
  })
  registerDocumentReleaser('image_document', releaseImageDocument)
  // 在剪辑里新建图片文档（4.1）：按剪辑序列的画面尺寸建一张空白图片，草稿放在所在项目里，再交给图片编辑页打开
  registerDocumentCreator('image_document', async (container, { size }) => {
    const edge = (value: number | undefined, fallback: number): number => Math.min(8192, Math.max(16, Math.round(value ?? fallback)))
    const blank = createBlankImageDataUrl({ width: edge(size?.width, 1920), height: edge(size?.height, 1080), dpi: 72, backgroundColor: UI_WHITE_HEX })
    const document = await createImageDocumentFromSource({ url: blank, blank: true }, container)
    const meta = document.session.documentMeta
    requestImageDocumentInEditor({ id: meta.id, path: meta.path })
    openApplicationSurface('tool.image_edit')
    return meta
  })

  registrar.registerHandler('create_image_edit_preview', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      sourceRef: ApplicationRef
      operations: Record<string, unknown>[]
    }>('create_image_edit_preview', input)
    const preview = await createImageEditPreviewFromRef({
      sourceRef: parsed.sourceRef,
      operations: parsed.operations,
    })
    const previewRef = String(preview.previewRef)
    /*
     * 回执必须带 verification：外部操作账本的 `ok` 只认 `data.verification.verified`，
     * 缺了它，一次**完全成功**的预览会以 `ok:false` / `isError:true` 交给调用方——
     * 标准 MCP 客户端据此判定失败，「生成结果 → 编辑 → 下一次生成」这条链当场断在中间。
     * 这里按稳定引用真的读回来一次再声明，读不回来就是 false，不做橡皮图章。
     */
    const registered = readImageEditPreview(previewRef)
    return {
      previewRef,
      sourceRef: parsed.sourceRef,
      resultRefs: preview.resultRefs,
      operationCount: preview.operationCount,
      hasEffect: preview.hasEffect,
      width: preview.width,
      height: preview.height,
      verification: {
        verified: Boolean(registered),
        condition: '预览已登记，可按该稳定引用继续编辑或作为下一次生成的输入',
        target: { kind: 'image_edit.preview', id: previewRef },
      },
    }
  })

  registrar.registerHandler('commit_image_edit', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const parsed = parseCapabilityInput<{
      previewRef: string
      displayName?: string
    }>('commit_image_edit', input)
    return await commitImageEdit(parsed.previewRef, parsed.displayName)
  })

  registrar.registerHandler('retry_image_edit_document_save', async (input, context) => {
    throwIfCapabilityAborted(context.signal)
    const { documentRef, expectedOwnerId } = parseCapabilityInput<{ documentRef: { kind: 'image_edit.document'; id: string }; expectedOwnerId?: string }>(
      'retry_image_edit_document_save', input)
    const saved = await retryImageEditDocumentSaveV3(splitImageEditV3DocumentRef(documentRef).documentId, expectedOwnerId)
    return { ref: documentRef, status: 'persisted', effects: saved.receipt?.effects ?? [],
      resultingRevisions: saved.receipt?.resultingRevisions ?? {} }
  })

}
