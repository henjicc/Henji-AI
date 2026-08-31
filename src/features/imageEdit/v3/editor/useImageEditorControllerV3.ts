import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { createImageEditGroupLayerV3, createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import type { ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import { collectImageEditLayerIdsV3 } from '@/core/imageEdit/v3/layerTypes'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { registerImageEditV3LiveSession } from '../application/imageEditLiveSessionRegistry'
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

interface BusBinding {
  bus: ImageEditCommandBusV3
}

function createBinding(
  document: ImageEditDocumentV3,
  historySnapshot: ImageEditCommandHistorySnapshotV3 | null | undefined,
  onPersistentChange: (snapshot: ImageEditPersistenceSnapshotV3) => void,
  resourceByteSizes: Readonly<Record<string, number>>,
): BusBinding {
  return {
    bus: new ImageEditCommandBusV3(document, {
      historySnapshot,
      onPersistentChange,
      resourceByteSizes,
    }),
  }
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
  const notifyPersistentChange = useRef((snapshot: ImageEditPersistenceSnapshotV3): void => {
    onPersistentChangeRef.current?.(snapshot)
  }).current
  const initialResourceByteSizes = useMemo<Readonly<Record<string, number>>>(() => ({
    ...Object.fromEntries((props.resourceDescriptors ?? []).map((resource) => [
      resource.resourceRef,
      resource.byteLength,
    ])),
    ...(props.resourceByteSizes ?? {}),
  }), [props.resourceByteSizes, props.resourceDescriptors])
  const [binding, setBinding] = useState<BusBinding>(() => createBinding(
    props.document,
    props.historySnapshot,
    notifyPersistentChange,
    initialResourceByteSizes,
  ))
  const [document, setDocument] = useState(props.document)
  const [historyState, setHistoryState] = useState(binding.bus.getSnapshot().history)
  const documentRef = useRef(props.document)
  const onDocumentChangeRef = useRef(props.onDocumentChange)
  onDocumentChangeRef.current = props.onDocumentChange

  useEffect(() => {
    const current = binding.bus.getSnapshot().document
    if (current.id === props.document.id && current.revision === props.document.revision) return
    const next = createBinding(
      props.document,
      props.historySnapshot,
      notifyPersistentChange,
      initialResourceByteSizes,
    )
    documentRef.current = props.document
    setBinding(next)
    setDocument(props.document)
    setHistoryState(next.bus.getSnapshot().history)
  }, [binding.bus, initialResourceByteSizes, notifyPersistentChange, props.document, props.historySnapshot])

  useEffect(() => () => binding.bus.dispose(), [binding.bus])

  useEffect(
    () => registerImageEditV3LiveSession(sessionId, binding.bus),
    [binding.bus, sessionId],
  )

  useEffect(() => binding.bus.subscribe((snapshot) => {
    setHistoryState((current) => (
      current.undoCount === snapshot.history.undoCount
        && current.redoCount === snapshot.history.redoCount
        ? current
        : snapshot.history
    ))
    if (documentRef.current === snapshot.document) return
    documentRef.current = snapshot.document
    setDocument(snapshot.document)
    onDocumentChangeRef.current(snapshot.document)
  }), [binding.bus])

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
    if (selected.length === 0 && document.layers.length > 0) {
      selected.push(document.layers[document.layers.length - 1].id)
    }
    useImageEditorSessionStoreV3.getState().setSelectedLayerIds(sessionId, selected)
  }, [document.layers, sessionId])

  const controller = useMemo<ImageEditorV3Controller>(() => {
    const commandBase = (): { commandId: string; expectedRevision: number } => ({
      commandId: createImageEditIdV3('command'),
      expectedRevision: binding.bus.getSnapshot().document.revision,
    })
    return {
      sessionId,
      profile,
      document,
      updateLayerCommon: (layerId, patch) => {
        binding.bus.dispatch({ ...commandBase(), type: 'layer.update-common', layerId, patch })
      },
      updateLayerParams: (layerId, params) => {
        binding.bus.dispatch({ ...commandBase(), type: 'layer.update-params', layerId, params })
      },
      addAnnotation: (layerId, annotation, index) => {
        const location = findImageEditLayerLocationV3(
          binding.bus.getSnapshot().document.layers,
          layerId,
        )
        if (!location || location.layer.type !== 'annotation') {
          throw new Error(`标注目标图层不存在：${layerId}`)
        }
        binding.bus.dispatch({
          ...commandBase(),
          type: 'annotation.add',
          layerId,
          index: index ?? location.layer.annotations.length,
          annotation,
        })
      },
      updateAnnotation: (layerId, annotationId, annotation) => {
        binding.bus.dispatch({
          ...commandBase(),
          type: 'annotation.update',
          layerId,
          annotationId,
          annotation,
        })
      },
      deleteAnnotation: (layerId, annotationId) => {
        binding.bus.dispatch({
          ...commandBase(),
          type: 'annotation.delete',
          layerId,
          annotationId,
        })
      },
      addLayer: (layer, parentId, index) => {
        binding.bus.dispatch({ ...commandBase(), type: 'layer.add', layer, parentId, index })
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
      undo: () => { binding.bus.undo() },
      redo: () => { binding.bus.redo() },
      canUndo: historyState.undoCount > 0,
      canRedo: historyState.redoCount > 0,
    }
  }, [binding.bus, document, historyState.redoCount, historyState.undoCount, profile, sessionId])

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
