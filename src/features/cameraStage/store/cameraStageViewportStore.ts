import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  cloneDefaultStageViewports,
  type StageViewportConfig,
  type StageViewportId,
  type StageViewportSource,
} from '../viewport/viewportTypes'

interface CameraStageViewportState {
  layout: 'single' | 'quad'
  activeViewportId: StageViewportId
  maximizedViewportId: StageViewportId | null
  viewports: Record<StageViewportId, StageViewportConfig>
  setLayout: (layout: 'single' | 'quad') => void
  setActiveViewport: (id: StageViewportId) => void
  setViewportSource: (id: StageViewportId, source: StageViewportSource) => void
  toggleMaximized: (id: StageViewportId) => void
  resetViewports: () => void
}

export const useCameraStageViewportStore = create<CameraStageViewportState>()(
  persist(
    (set) => ({
      layout: 'quad',
      activeViewportId: 'perspective',
      maximizedViewportId: null,
      viewports: cloneDefaultStageViewports(),
      setLayout: (layout) => set((state) => ({
        layout,
        maximizedViewportId: layout === 'quad' ? null : state.activeViewportId,
      })),
      setActiveViewport: (activeViewportId) => set({ activeViewportId }),
      setViewportSource: (id, source) => set((state) => ({
        viewports: { ...state.viewports, [id]: { id, source } },
      })),
      toggleMaximized: (id) => set((state) => ({
        activeViewportId: id,
        maximizedViewportId: state.maximizedViewportId === id ? null : id,
      })),
      resetViewports: () => set({
        layout: 'quad',
        activeViewportId: 'perspective',
        maximizedViewportId: null,
        viewports: cloneDefaultStageViewports(),
      }),
    }),
    {
      name: 'camera-stage-viewports-v1',
      partialize: (state) => ({
        layout: state.layout,
        activeViewportId: state.activeViewportId,
        maximizedViewportId: state.maximizedViewportId,
        viewports: state.viewports,
      }),
    },
  ),
)
