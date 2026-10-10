import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { createImageEditGroupLayerV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import {
  collectImageEditLayerIdsV3,
  type ImageEditLayerV3,
} from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { addImageEditLayerWithSelectionV3 } from '../application/imageEditSelectionServiceV3'
import { getOrCreateImageEditDocumentInstanceV3, attachImageEditDocumentInstanceV3 } from '../application/imageEditDocumentInstances'
import {
  getImageEditorHostProfileV3,
  getReadyImageEditorToolIdsV3,
} from '../application/imageEditorHostProfiles'
import {
  useImageEditorInteractionStoreV3,
  useImageEditorSessionStoreV3,
} from '../store'
import { createImageEditDuplicateIdMapV3, findImageEditLayerLocationV3 } from './layerTreeV3'
import type { ImageEditorV3Controller, ImageEditorV3Props } from './types'

interface DefaultLayerCandidateV3 {
  layer: ImageEditLayerV3
  interactive: boolean
}

/** 新会话优先选中可见、未锁定的原始栅格层，而不是最上面的效果或空容器。 */
export function resolveImageEditorDefaultLayerIdV3(
  layers: readonly ImageEditLayerV3[],
): string | null {
  const candidates: DefaultLayerCandidateV3[] = []
  const visit = (entries: readonly ImageEditLayerV3[], ancestorsInteractive: boolean): void => {
    for (const layer of entries) {
      const interactive = ancestorsInteractive && layer.visible && !layer.locked
      candidates.push({ layer, interactive })
      if (layer.type === 'group') visit(layer.children, interactive)
    }
  }
  visit(layers, true)
  return candidates.find(({ layer, interactive }) => (
    interactive && layer.type === 'raster' && layer.source.kind === 'resource'
  ))?.layer.id
    ?? candidates.find(({ layer, interactive }) => interactive && (layer.type === 'raster' || layer.type === 'smart'))?.layer.id
    ?? candidates.find(({ layer, interactive }) => (
      interactive && (['text', 'shape', 'path'].includes(layer.type) || layer.type === 'group')
    ))?.layer.id
    ?? [...candidates].reverse().find(({ interactive }) => interactive)?.layer.id
    ?? candidates.at(-1)?.layer.id
    ?? null
}

export function useImageEditorControllerV3(
  props: Pick<
    ImageEditorV3Props,
    | 'document'
    | 'historySnapshot'
    | 'profileId'
    | 'initialSelectedLayerId'
    | 'initialToolId'
    | 'onDocumentChange'
    | 'onPersistenceChange'
    | 'persistenceHost'
    | 'resourceByteSizes'
    | 'resourceDescriptors'
  >,
): { controller: ImageEditorV3Controller; bus: ImageEditCommandBusV3 } {
  const reactId = useId().replace(/:/g, '')
  const sessionId = useMemo(
    () => `image-editor-v3-${props.profileId}-${props.document.id}-${reactId}`,
    [props.document.id, props.profileId, reactId],
  )
  const profile = getImageEditorHostProfileV3(props.profileId)
  const readyToolIds = useMemo(() => getReadyImageEditorToolIdsV3(profile), [profile])
  const onPersistentChangeRef = useRef(props.onPersistenceChange)
  onPersistentChangeRef.current = props.onPersistenceChange
  const initialResourceByteSizes = useMemo<Readonly<Record<string, number>>>(() => ({
    ...Object.fromEntries((props.resourceDescriptors ?? []).map((resource) => [
      resource.resourceRef,
      resource.byteLength,
    ])),
    ...(props.resourceByteSizes ?? {}),
  }), [props.resourceByteSizes, props.resourceDescriptors])
  const binding = getOrCreateImageEditDocumentInstanceV3(props.document, {
    historySnapshot: props.historySnapshot, resourceByteSizes: initialResourceByteSizes,
  }, props.persistenceHost)
  const [snapshot, setSnapshot] = useState(binding.bus.getSnapshot())
  const [historyFailed, setHistoryFailed] = useState(false)
  const historyViewActive = useRef(true)
  useEffect(() => { historyViewActive.current = true; return () => { historyViewActive.current = false } }, [binding.bus])
  const navigateHistory = useCallback((redo: boolean): void => {
    setHistoryFailed(false)
    void (async () => { if (redo) await binding.bus.redo(); else await binding.bus.undo() })().catch(() => {
      if (historyViewActive.current) setHistoryFailed(true)
    })
  }, [binding.bus])
  const document = snapshot.document.id === binding.documentId ? snapshot.document : binding.bus.getSnapshot().document
  const historyState = snapshot.document.id === binding.documentId ? snapshot.history : binding.bus.getSnapshot().history
  const onDocumentChangeRef = useRef(props.onDocumentChange)
  onDocumentChangeRef.current = props.onDocumentChange
  const suppliedDocumentRef = useRef(props.document)
  suppliedDocumentRef.current = props.document

  useEffect(() => attachImageEditDocumentInstanceV3(binding.documentId), [binding.documentId])

  useEffect(() => {
    let previousDocument = binding.bus.getSnapshot().document
    setSnapshot(binding.bus.getSnapshot())
    // 重挂载以应用实例为准，旧 props 不能覆盖尚未保存的修改和撤销历史。
    if (suppliedDocumentRef.current !== previousDocument) {
      onDocumentChangeRef.current(previousDocument)
      onPersistentChangeRef.current?.(binding.bus.getPersistenceSnapshot())
    }
    const unsubscribePersistence = binding.bus.subscribePersistence((persistence) => onPersistentChangeRef.current?.(persistence))
    const unsubscribe = binding.bus.subscribe((next) => {
      setSnapshot(next)
      if (next.document !== previousDocument) onDocumentChangeRef.current(next.document)
      previousDocument = next.document
    })
    return () => { unsubscribe(); unsubscribePersistence() }
  }, [binding.bus])

  useEffect(() => {
    useImageEditorSessionStoreV3.getState().ensureSession(
      sessionId,
      readyToolIds,
      props.initialSelectedLayerId,
      props.initialToolId,
    )
    return () => {
      useImageEditorSessionStoreV3.getState().disposeSession(sessionId)
      useImageEditorInteractionStoreV3.getState().endLayerDrag(sessionId)
      useImageEditorInteractionStoreV3.getState().clearViewport(sessionId)
    }
  }, [props.initialSelectedLayerId, props.initialToolId, readyToolIds, sessionId])

  useEffect(() => {
    const session = useImageEditorSessionStoreV3.getState().sessions[sessionId]
    if (!session) return
    const validIds = new Set(collectImageEditLayerIdsV3(document.layers))
    const selected = session.selectedLayerIds.filter((id) => validIds.has(id))
    const fallbackId = resolveImageEditorDefaultLayerIdV3(document.layers)
    if (selected.length === 0 && fallbackId) selected.push(fallbackId)
    const store = useImageEditorSessionStoreV3.getState()
    store.setSelectedLayerIds(sessionId, selected)
    const target = selected.length === 1 ? findImageEditLayerLocationV3(document.layers, selected[0])?.layer : undefined
    if (session.editTarget === 'mask' && !target?.mask) {
      store.setEditTarget(sessionId, 'pixels')
      if (session.activeTool === 'mask-edit') store.setActiveTool(sessionId, readyToolIds.includes('raster-brush') ? 'raster-brush' : 'move')
    }
  }, [document.layers, readyToolIds, sessionId])

  const controller = useMemo<ImageEditorV3Controller>(() => {
    const commandBase = (): { commandId: string; expectedRevision: number } => ({
      commandId: createImageEditIdV3('command'),
      expectedRevision: binding.bus.getSnapshot().document.revision,
    })
    return {
      sessionId,
      profile,
      document,
      regionPort: binding.bus,
      setNamedRegions: regions => binding.bus.dispatch({ ...commandBase(), type: 'document.set-named-regions', regions }),
      moveLayers: moves => binding.bus.dispatch({ ...commandBase(), type: 'layer.move-many', moves }),
      updateLayerCommon: (layerId, patch) => {
        binding.bus.dispatch({ ...commandBase(), type: 'layer.update-common', layerId, patch })
      },
      updateLayerParams: (layerId, params) => {
        binding.bus.dispatch({ ...commandBase(), type: 'layer.update-params', layerId, params })
      },
      addLayer: async (layer, parentId, index, signal, onProgress) => {
        await addImageEditLayerWithSelectionV3(binding.bus, layer, parentId, index, signal, onProgress)
      },
      deleteLayer: (layerId) => {
        binding.bus.dispatch({ ...commandBase(), type: 'layer.delete', layerId })
      },
      duplicateLayer: (layerId, parentId, index) => {
        const location = findImageEditLayerLocationV3(binding.bus.getSnapshot().document.layers, layerId)
        if (!location) return null
        const idMap = createImageEditDuplicateIdMapV3(location.layer)
        binding.bus.dispatch({
          ...commandBase(),
          type: 'layer.duplicate',
          layerId,
          parentId,
          index,
          idMap,
        })
        return idMap[layerId] ?? null
      },
      moveLayer: (layerId, parentId, index) => {
        binding.bus.dispatch({ ...commandBase(), type: 'layer.move', layerId, parentId, index })
      },
      groupLayers: (layerIds, groupName) => {
        const group = createImageEditGroupLayerV3(createImageEditIdV3('layer'), groupName)
        binding.bus.dispatch({ ...commandBase(), type: 'layer.group', layerIds: [...layerIds], group })
        return group.id
      },
      ungroupLayer: (groupId) => {
        binding.bus.dispatch({ ...commandBase(), type: 'layer.ungroup', groupId })
      },
      updateGroupIsolation: (layerId, isolated) => {
        binding.bus.dispatch({ ...commandBase(), type: 'group.update-isolation', layerId, isolated })
      },
      setLayerMask: (layerId, mask) => {
        binding.bus.dispatch({
          ...commandBase(),
          type: 'layer.set-mask',
          layerId,
          mask,
        })
      },
      setOutputGeometryPreview: (previewId, orientation, crop) => {
        binding.bus.setPreview({
          id: previewId,
          kind: 'crop',
          targetId: document.id,
          baseRevision: binding.bus.getSnapshot().document.revision,
          value: {
            orientation: { ...orientation },
            crop: crop ? { ...crop } : null,
          },
        })
      },
      clearOutputGeometryPreview: (previewId) => binding.bus.clearPreview(previewId),
      commitOutputGeometryPreview: (previewId, orientation, crop) => {
        binding.bus.commitPreview(previewId, {
          ...commandBase(),
          type: 'document.update-output-geometry',
          orientation: { ...orientation },
          crop: crop ? { ...crop } : null,
        })
      },
      setParameterPreview: (previewId, layerId, value) => {
        binding.bus.setPreview({
          id: previewId,
          kind: 'parameter',
          targetId: layerId,
          baseRevision: binding.bus.getSnapshot().document.revision,
          value,
        })
      },
      clearParameterPreview: (previewId) => binding.bus.clearPreview(previewId),
      setTransformPreview: (previewId, layerId, transform) => {
        binding.bus.setPreview({
          id: previewId,
          kind: 'transform',
          targetId: layerId,
          baseRevision: binding.bus.getSnapshot().document.revision,
          value: [...transform],
        })
      },
      clearTransformPreview: (previewId) => binding.bus.clearPreview(previewId),
      commitTransformPreview: (previewId, layerId, transform) => {
        binding.bus.commitPreview(previewId, {
          ...commandBase(),
          type: 'layer.update-common',
          layerId,
          patch: { transform: [...transform] },
        })
      },
      commitLayerCommonPreview: (previewId, layerId, patch) => {
        binding.bus.commitPreview(previewId, {
          ...commandBase(),
          type: 'layer.update-common',
          layerId,
          patch,
        })
      },
      commitLayerParamsPreview: (previewId, layerId, params) => {
        binding.bus.commitPreview(previewId, {
          ...commandBase(),
          type: 'layer.update-params',
          layerId,
          params,
        })
      },
      undo: () => navigateHistory(false),
      historyFailed,
      dismissHistoryFailure: () => setHistoryFailed(false),
      historyPort: binding.bus,
      historyResourceDescriptors: props.resourceDescriptors,
      redo: () => navigateHistory(true),
      canUndo: historyState.undoCount > 0,
      canRedo: historyState.redoCount > 0,
    }
  }, [binding.bus, document, historyState.redoCount, historyState.undoCount, historyFailed, navigateHistory, profile, props.resourceDescriptors, sessionId])

  return { controller, bus: binding.bus }
}

export function useImageEditorBusSnapshotV3(
  bus: ImageEditCommandBusV3,
): ReturnType<ImageEditCommandBusV3['getSnapshot']> {
  const [snapshot, setSnapshot] = useState(bus.getSnapshot())
  useEffect(() => {
    setSnapshot(bus.getSnapshot())
    return bus.subscribe(setSnapshot)
  }, [bus])
  return snapshot
}
