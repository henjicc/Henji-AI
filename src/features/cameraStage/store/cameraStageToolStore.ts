import { create } from 'zustand'
import type { StageShot } from '../domain/shotTypes'

export type StageEditorTool = 'translate' | 'rotate' | 'scale' | 'path'

export interface StagePathSelection {
  shotId: string
  objectId: string
}

export type StagePathControlSelection =
  | { kind: 'start' | 'end' }
  | { kind: 'knot'; knotId: string }

export function resolvePathShotId(
  shots: StageShot[],
  currentTime: number,
  selectedShotId: string | null,
): string | null {
  if (shots.length < 2) return null
  const selectedIndex = selectedShotId ? shots.findIndex((shot) => shot.id === selectedShotId) : -1
  if (selectedIndex >= 0 && selectedIndex < shots.length - 1
    && Math.abs(shots[selectedIndex].time - currentTime) < 1e-4) {
    return shots[selectedIndex].id
  }
  const activeIndex = shots.findIndex((shot, index) => (
    index < shots.length - 1
    && currentTime >= shot.time
    && currentTime < shots[index + 1].time
  ))
  if (activeIndex >= 0) return shots[activeIndex].id
  if (selectedIndex >= 0) return shots[Math.min(selectedIndex, shots.length - 2)].id
  return shots[0].id
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
