import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StageViewMode } from '../domain/sceneTypes'

export type CameraStageAppView = 'list' | 'editor'

interface CameraStageSessionState {
  appView: CameraStageAppView
  lastProjectId: string | null
  stageViewMode: StageViewMode
  /** 封面写盘完成后自增；工程列表据此重新拉取摘要，避免刚退出时还显示上一张封面 */
  coverRevision: number
  setAppView: (view: CameraStageAppView) => void
  setLastProjectId: (projectId: string | null) => void
  setStageViewMode: (mode: StageViewMode) => void
  markCoversChanged: () => void
}

export const useCameraStageSessionStore = create<CameraStageSessionState>()(
  persist(
    (set) => ({
      appView: 'list',
      lastProjectId: null,
      stageViewMode: 'director',
      coverRevision: 0,
      setAppView: (appView) => set((state) => (state.appView === appView ? state : { appView })),
      setLastProjectId: (lastProjectId) => set((state) => (
        state.lastProjectId === lastProjectId ? state : { lastProjectId }
      )),
      setStageViewMode: (stageViewMode) => set((state) => (
        state.stageViewMode === stageViewMode ? state : { stageViewMode }
      )),
      markCoversChanged: () => set((state) => ({ coverRevision: state.coverRevision + 1 })),
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
