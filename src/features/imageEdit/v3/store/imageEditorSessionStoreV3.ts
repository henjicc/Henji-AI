import { create } from 'zustand'

import type { ImageEditSelectionCombineModeV3 } from '@/core/imageEdit/v3/selection'
import { ANNOTATION_DEFAULT_STROKE_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { DEFAULT_MOSAIC_STRENGTH_PERCENT } from '@/core/imageEdit/constraints'
import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'

export interface ImageEditorToolSettingsV3 {
  snappingEnabled: boolean
  brushSize: number
  brushOpacity: number
  brushHardness: number
  maskMode: 'paint' | 'erase'
  selectionCombineMode: ImageEditSelectionCombineModeV3
  annotationStrokeWidth: number
  annotationFontSize: number
  annotationColor: string
  annotationTextBackgroundEnabled: boolean
  annotationTextBackgroundColor: string
  annotationCalloutShape: 'rect' | 'ellipse'
  annotationMosaicMode: 'pixel' | 'blur'
  annotationMosaicStrength: number
  annotationTool: ImageEditorToolIdV3
  cropAspectRatio: ImageEditorCropAspectRatioV3
}

export type ImageEditorCropAspectRatioV3 =
  | 'free'
  | 'original'
  | '1:1'
  | '4:3'
  | '3:4'
  | '16:9'
  | '9:16'
  | '2:1'
  | '21:9'

export interface ImageEditorSessionStateV3 {
  activeTool: ImageEditorToolIdV3
  selectedLayerIds: string[]
  expandedGroupIds: string[]
  toolSettings: ImageEditorToolSettingsV3
}

interface ImageEditorSessionStoreV3 {
  sessions: Record<string, ImageEditorSessionStateV3>
  ensureSession: (
    sessionId: string,
    allowedTools: readonly ImageEditorToolIdV3[],
    initialLayerId?: string,
    initialToolId?: ImageEditorToolIdV3,
  ) => void
  disposeSession: (sessionId: string) => void
  setActiveTool: (sessionId: string, tool: ImageEditorToolIdV3) => void
  setSelectedLayerIds: (sessionId: string, layerIds: readonly string[]) => void
  toggleGroupExpanded: (sessionId: string, groupId: string) => void
  setToolSetting: <K extends keyof ImageEditorToolSettingsV3>(
    sessionId: string,
    key: K,
    value: ImageEditorToolSettingsV3[K],
  ) => void
}

const DEFAULT_TOOL_SETTINGS: ImageEditorToolSettingsV3 = {
  snappingEnabled: true,
  brushSize: 32,
  brushOpacity: 1,
  brushHardness: 0.8,
  maskMode: 'paint',
  selectionCombineMode: 'replace',
  annotationStrokeWidth: 4,
  annotationFontSize: 32,
  annotationColor: ANNOTATION_DEFAULT_STROKE_HEX,
  annotationTextBackgroundEnabled: false,
  annotationTextBackgroundColor: WHITE_HEX,
  annotationCalloutShape: 'rect',
  annotationMosaicMode: 'pixel',
  annotationMosaicStrength: DEFAULT_MOSAIC_STRENGTH_PERCENT,
  annotationTool: 'annotation-arrow',
  cropAspectRatio: 'free',
}

function uniqueIds(layerIds: readonly string[]): string[] {
  return [...new Set(layerIds.filter(Boolean))]
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export const useImageEditorSessionStoreV3 = create<ImageEditorSessionStoreV3>((set) => ({
  sessions: {},

  ensureSession: (sessionId, allowedTools, initialLayerId, initialToolId) => set((state) => {
    const existing = state.sessions[sessionId]
    if (existing) {
      if (allowedTools.includes(existing.activeTool)) return state
      const fallback = allowedTools[0]
      if (!fallback) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...existing, activeTool: fallback },
        },
      }
    }
    const activeTool = initialToolId && allowedTools.includes(initialToolId)
      ? initialToolId
      : allowedTools[0]
    if (!activeTool) throw new Error('图片编辑宿主必须至少允许一个工具')
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          activeTool,
          selectedLayerIds: initialLayerId ? [initialLayerId] : [],
          expandedGroupIds: [],
          toolSettings: { ...DEFAULT_TOOL_SETTINGS },
        },
      },
    }
  }),

  disposeSession: (sessionId) => set((state) => {
    if (!(sessionId in state.sessions)) return state
    const { [sessionId]: _removed, ...sessions } = state.sessions
    return { sessions }
  }),

  setActiveTool: (sessionId, activeTool) => set((state) => {
    const session = state.sessions[sessionId]
    if (!session || session.activeTool === activeTool) return state
    return { sessions: { ...state.sessions, [sessionId]: { ...session, activeTool } } }
  }),

  setSelectedLayerIds: (sessionId, layerIds) => set((state) => {
    const session = state.sessions[sessionId]
    if (!session) return state
    const selectedLayerIds = uniqueIds(layerIds)
    if (sameIds(session.selectedLayerIds, selectedLayerIds)) return state
    return { sessions: { ...state.sessions, [sessionId]: { ...session, selectedLayerIds } } }
  }),

  toggleGroupExpanded: (sessionId, groupId) => set((state) => {
    const session = state.sessions[sessionId]
    if (!session) return state
    const expandedGroupIds = session.expandedGroupIds.includes(groupId)
      ? session.expandedGroupIds.filter((id) => id !== groupId)
      : [...session.expandedGroupIds, groupId]
    return { sessions: { ...state.sessions, [sessionId]: { ...session, expandedGroupIds } } }
  }),

  setToolSetting: (sessionId, key, value) => set((state) => {
    const session = state.sessions[sessionId]
    if (!session || session.toolSettings[key] === value) return state
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          toolSettings: { ...session.toolSettings, [key]: value },
        },
      },
    }
  }),
}))

export function getImageEditorSessionV3(sessionId: string): ImageEditorSessionStateV3 | undefined {
  return useImageEditorSessionStoreV3.getState().sessions[sessionId]
}
