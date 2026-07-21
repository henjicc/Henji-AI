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
      setAppView: (appView) => set((state) => (state.appView === appView ? state : { appView })),
      setLastProjectId: (lastProjectId) => set((state) => (
        state.lastProjectId === lastProjectId ? state : { lastProjectId }
      )),
      setStageViewMode: (stageViewMode) => set((state) => (
        state.stageViewMode === stageViewMode ? state : { stageViewMode }
      )),
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
