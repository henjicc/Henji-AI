import { create } from 'zustand'
import type { StageStateKeyframe } from '../domain/stateKeyframeTypes'

export type StageEditorTool = 'translate' | 'rotate' | 'scale' | 'path'

export interface StagePathSelection {
  stateKeyframeId: string
  objectId: string
}

export type StagePathControlSelection =
  | { kind: 'start' | 'end' }
  | { kind: 'knot'; knotId: string }

export function resolvePathStateKeyframeId(
  stateKeyframes: StageStateKeyframe[],
  currentTime: number,
  selectedStateKeyframeId: string | null,
): string | null {
  if (stateKeyframes.length < 2) return null
  const selectedIndex = selectedStateKeyframeId ? stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === selectedStateKeyframeId) : -1
  if (selectedIndex >= 0 && selectedIndex < stateKeyframes.length - 1
    && Math.abs(stateKeyframes[selectedIndex].time - currentTime) < 1e-4) {
    return stateKeyframes[selectedIndex].id
  }
  const activeIndex = stateKeyframes.findIndex((stateKeyframe, index) => (
    index < stateKeyframes.length - 1
    && currentTime >= stateKeyframe.time
    && currentTime < stateKeyframes[index + 1].time
  ))
  if (activeIndex >= 0) return stateKeyframes[activeIndex].id
  if (selectedIndex >= 0) return stateKeyframes[Math.min(selectedIndex, stateKeyframes.length - 2)].id
  return stateKeyframes[0].id
}

interface CameraStageToolState {
  tool: StageEditorTool
  pathSelection: StagePathSelection | null
  controlSelection: StagePathControlSelection | null
  setTool: (tool: StageEditorTool) => void
  selectPath: (selection: StagePathSelection) => void
  selectControl: (selection: StagePathControlSelection | null) => void
  clearPathSelection: () => void
}

export const useCameraStageToolStore = create<CameraStageToolState>((set) => ({
  tool: 'translate',
  pathSelection: null,
  controlSelection: null,
  setTool: (tool) => set({
    tool,
    ...(tool === 'path' ? {} : { pathSelection: null, controlSelection: null }),
  }),
  selectPath: (pathSelection) => set({ tool: 'path', pathSelection, controlSelection: null }),
  selectControl: (controlSelection) => set({ controlSelection }),
  clearPathSelection: () => set({ pathSelection: null, controlSelection: null }),
}))
