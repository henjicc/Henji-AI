import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StageViewMode } from '../domain/sceneTypes'

export type CameraStageAppView = 'list' | 'editor'

interface CameraStageSessionState {
  appView: CameraStageAppView
  lastProjectId: string | null
  stageViewMode: StageViewMode
  setAppView: (view: CameraStageAppView) => void
  setLastProjectId: (projectId: string | null) => void
  setStageViewMode: (mode: StageViewMode) => void
}

export const useCameraStageSessionStore = create<CameraStageSessionState>()(
  persist(
    (set) => ({
      appView: 'list',
      lastProjectId: null,
      stageViewMode: 'director',
      setAppView: (appView) => set({ appView }),
      setLastProjectId: (lastProjectId) => set({ lastProjectId }),
      setStageViewMode: (stageViewMode) => set({ stageViewMode }),
    }),
    {
      name: 'camera-stage-session',
      partialize: (state) => ({
        appView: state.appView,
        lastProjectId: state.lastProjectId,
        stageViewMode: state.stageViewMode,
      }),
    },
  ),
)
