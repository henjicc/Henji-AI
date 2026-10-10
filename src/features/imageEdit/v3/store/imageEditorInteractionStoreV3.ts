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

interface ImageEditorInteractionStoreV3 {
  layerDragBySession: Record<string, ImageEditorLayerDragStateV3 | undefined>
  viewportZoomBySession: Record<string, number | undefined>
  viewportPanBySession: Record<string, ImageEditorViewportPanV3 | undefined>
  beginLayerDrag: (sessionId: string, layerId: string) => void
  setLayerDragTarget: (sessionId: string, overLayerId: string | null) => void
  endLayerDrag: (sessionId: string) => void
  setViewportZoom: (sessionId: string, zoom: number) => void
  setViewportPan: (sessionId: string, pan: ImageEditorViewportPanV3) => void
  setViewportTransform: (
    sessionId: string,
    transform: { zoom: number; pan: ImageEditorViewportPanV3 },
  ) => void
  clearViewport: (sessionId: string) => void
}

/** 高频拖拽状态与文档/图层树分离，只有当前行订阅，不进入历史或持久化。 */
export const useImageEditorInteractionStoreV3 = create<ImageEditorInteractionStoreV3>((set) => ({
  layerDragBySession: {},
  viewportZoomBySession: {},
  viewportPanBySession: {},

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

  clearViewport: (sessionId) => set((state) => {
    if(!(sessionId in state.viewportZoomBySession)&&!(sessionId in state.viewportPanBySession))return state
    const {[sessionId]:_zoom,...viewportZoomBySession}=state.viewportZoomBySession
    const {[sessionId]:_pan,...viewportPanBySession}=state.viewportPanBySession
    return {viewportZoomBySession,viewportPanBySession}
  }),
}))
