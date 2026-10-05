import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StageViewMode } from '../domain/sceneTypes'

export type CameraStageAppView = 'list' | 'editor'

interface CameraStageSessionState {
  appView: CameraStageAppView
  /** 上次在编辑器里打开的镜头参考文档 ID（应用重启后恢复用）。 */
  lastDocumentId: string | null
  stageViewMode: StageViewMode
  setAppView: (view: CameraStageAppView) => void
  setLastDocumentId: (documentId: string | null) => void
  setStageViewMode: (mode: StageViewMode) => void
}

export const useCameraStageSessionStore = create<CameraStageSessionState>()(
  persist(
    (set) => ({
      appView: 'list',
      lastDocumentId: null,
      stageViewMode: 'director',
      setAppView: (appView) => set((state) => (state.appView === appView ? state : { appView })),
      setLastDocumentId: (lastDocumentId) => set((state) => (
        state.lastDocumentId === lastDocumentId ? state : { lastDocumentId }
      )),
      setStageViewMode: (stageViewMode) => set((state) => (
        state.stageViewMode === stageViewMode ? state : { stageViewMode }
      )),
    }),
    {
      name: 'camera-stage-session',
      // 3.2 起记的是文档 ID（版本 1 记的是旧工程 ID，丢弃）
      version: 2,
      migrate: (): Pick<CameraStageSessionState, 'appView' | 'lastDocumentId' | 'stageViewMode'> => (
        { appView: 'list', lastDocumentId: null, stageViewMode: 'director' }
      ),
      partialize: (state) => ({
        appView: state.appView,
        lastDocumentId: state.lastDocumentId,
        stageViewMode: state.stageViewMode,
      }),
    },
  ),
)
