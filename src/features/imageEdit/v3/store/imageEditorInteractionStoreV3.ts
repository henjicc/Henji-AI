import { create } from 'zustand'

import {
  clampImageEditorViewportZoomV3,
  normalizeImageEditorViewportPanV3,
  type ImageEditorViewportPanV3,
} from '../editor/viewportNavigationV3'

export interface ImageEditorLayerDragStateV3 {
  layerId: string
  overLayerId: string | null
}

export interface ImageEditorAnnotationSelectionV3 {
  layerId: string
  annotationId: string
}

interface ImageEditorInteractionStoreV3 {
  layerDragBySession: Record<string, ImageEditorLayerDragStateV3 | undefined>
  viewportZoomBySession: Record<string, number | undefined>
  viewportPanBySession: Record<string, ImageEditorViewportPanV3 | undefined>
  annotationSelectionBySession: Record<string, ImageEditorAnnotationSelectionV3 | undefined>
  beginLayerDrag: (sessionId: string, layerId: string) => void
  setLayerDragTarget: (sessionId: string, overLayerId: string | null) => void
  endLayerDrag: (sessionId: string) => void
  setViewportZoom: (sessionId: string, zoom: number) => void
  setViewportPan: (sessionId: string, pan: ImageEditorViewportPanV3) => void
  setViewportTransform: (
    sessionId: string,
    transform: { zoom: number; pan: ImageEditorViewportPanV3 },
  ) => void
  selectAnnotation: (
    sessionId: string,
    selection: ImageEditorAnnotationSelectionV3 | null,
  ) => void
  clearViewport: (sessionId: string) => void
}

/** 高频拖拽状态与文档/图层树分离，只有当前行订阅，不进入历史或持久化。 */
export const useImageEditorInteractionStoreV3 = create<ImageEditorInteractionStoreV3>((set) => ({
  layerDragBySession: {},
  viewportZoomBySession: {},
  viewportPanBySession: {},
  annotationSelectionBySession: {},

  beginLayerDrag: (sessionId, layerId) => set((state) => ({
    layerDragBySession: {
      ...state.layerDragBySession,
      [sessionId]: { layerId, overLayerId: null },
    },
  })),

  setLayerDragTarget: (sessionId, overLayerId) => set((state) => {
    const current = state.layerDragBySession[sessionId]
    if (!current || current.overLayerId === overLayerId) return state
    return {
      layerDragBySession: {
        ...state.layerDragBySession,
        [sessionId]: { ...current, overLayerId },
      },
    }
  }),

  endLayerDrag: (sessionId) => set((state) => {
    if (!state.layerDragBySession[sessionId]) return state
    const { [sessionId]: _removed, ...layerDragBySession } = state.layerDragBySession
    return { layerDragBySession }
  }),

  setViewportZoom: (sessionId, zoom) => set((state) => {
    const normalized = clampImageEditorViewportZoomV3(zoom)
    if (state.viewportZoomBySession[sessionId] === normalized) return state
    return {
      viewportZoomBySession: {
        ...state.viewportZoomBySession,
        [sessionId]: normalized,
      },
    }
  }),

  setViewportPan: (sessionId, pan) => set((state) => {
    const normalized = normalizeImageEditorViewportPanV3(pan)
    const current = state.viewportPanBySession[sessionId]
    if (current?.x === normalized.x && current.y === normalized.y) return state
    return {
      viewportPanBySession: {
        ...state.viewportPanBySession,
        [sessionId]: normalized,
      },
    }
  }),

  setViewportTransform: (sessionId, transform) => set((state) => {
    const zoom = clampImageEditorViewportZoomV3(transform.zoom)
    const pan = normalizeImageEditorViewportPanV3(transform.pan)
    const currentPan = state.viewportPanBySession[sessionId]
    if (
      state.viewportZoomBySession[sessionId] === zoom
      && currentPan?.x === pan.x
      && currentPan.y === pan.y
    ) return state
    return {
      viewportZoomBySession: {
        ...state.viewportZoomBySession,
        [sessionId]: zoom,
      },
      viewportPanBySession: {
        ...state.viewportPanBySession,
        [sessionId]: pan,
      },
    }
  }),

  selectAnnotation: (sessionId, selection) => set((state) => {
    const current = state.annotationSelectionBySession[sessionId]
    if (!selection) {
      if (!current) return state
      const { [sessionId]: _removed, ...annotationSelectionBySession } = state.annotationSelectionBySession
      return { annotationSelectionBySession }
    }
    if (current?.layerId === selection.layerId
      && current.annotationId === selection.annotationId) return state
    return {
      annotationSelectionBySession: {
        ...state.annotationSelectionBySession,
        [sessionId]: selection,
      },
    }
  }),

  clearViewport: (sessionId) => set((state) => {
    const hasViewport = sessionId in state.viewportZoomBySession
      || sessionId in state.viewportPanBySession
    const hasAnnotation = sessionId in state.annotationSelectionBySession
    if (!hasViewport && !hasAnnotation) return state
    const { [sessionId]: _removed, ...viewportZoomBySession } = state.viewportZoomBySession
    const { [sessionId]: _removedPan, ...viewportPanBySession } = state.viewportPanBySession
    const {
      [sessionId]: _removedAnnotation,
      ...annotationSelectionBySession
    } = state.annotationSelectionBySession
    return { viewportZoomBySession, viewportPanBySession, annotationSelectionBySession }
  }),
}))
