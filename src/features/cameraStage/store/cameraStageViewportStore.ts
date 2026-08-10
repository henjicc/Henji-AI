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

/**
 * 版本号必须跟着默认布局一起动。
 *
 * 这份配置是持久化的：只改 `DEFAULT_STAGE_VIEWPORTS` 而不升版本，老用户读回本地旧状态，
 * 新默认永远不生效——改了等于没改，而且从表现上完全看不出来。
 */
export const VIEWPORT_STATE_VERSION = 2

type PersistedViewportState = Pick<
  CameraStageViewportState,
  'layout' | 'activeViewportId' | 'maximizedViewportId' | 'viewports'
>

/**
 * v1（透视/顶/正/右）→ v2（透视/摄像机/顶/正）。
 *
 * 右视图那一格换成摄像机视角，其余保留用户自己选的来源；`activeViewportId` /
 * `maximizedViewportId` 里指向 `right` 的引用必须一起改掉，否则它们指着一个不存在的窗格，
 * 界面表现为"点谁都不高亮"或"怎么都退不出最大化"。
 *
 * 抽成导出的纯函数是为了能直接测：迁移逻辑埋在 persist 选项里就只能靠实机验证，
 * 而这类问题恰恰是静默的。
 */
export function migrateViewportState(persisted: unknown, version: number): PersistedViewportState {
  const state = (persisted ?? {}) as Partial<PersistedViewportState>
  const defaults = cloneDefaultStageViewports()
  if (version >= VIEWPORT_STATE_VERSION) {
    return {
      layout: state.layout ?? 'quad',
      activeViewportId: state.activeViewportId ?? 'perspective',
      maximizedViewportId: state.maximizedViewportId ?? null,
      viewports: state.viewports ?? defaults,
    }
  }
  const legacy = (state.viewports ?? {}) as Record<string, StageViewportConfig | undefined>
  const viewports: Record<StageViewportId, StageViewportConfig> = {
    perspective: legacy.perspective ?? defaults.perspective,
    camera: defaults.camera,
    top: legacy.top ?? defaults.top,
    front: legacy.front ?? defaults.front,
  }
  const remap = (id: string | null | undefined): StageViewportId | null => (
    id && id in viewports ? id as StageViewportId : null
  )
  return {
    layout: state.layout ?? 'quad',
    viewports,
    activeViewportId: remap(state.activeViewportId) ?? 'perspective',
    maximizedViewportId: remap(state.maximizedViewportId),
  }
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
      /**
       * 版本号必须跟着默认布局一起动。
       *
       * 这份配置是持久化的：只改 `DEFAULT_STAGE_VIEWPORTS` 而不升版本，老用户读回本地旧状态，
       * 新默认永远不生效——改了等于没改，而且从表现上完全看不出来。
       */
      version: VIEWPORT_STATE_VERSION,
      migrate: (persisted, version) => migrateViewportState(persisted, version) as CameraStageViewportState,
      partialize: (state) => ({
        layout: state.layout,
        activeViewportId: state.activeViewportId,
        maximizedViewportId: state.maximizedViewportId,
        viewports: state.viewports,
      }),
    },
  ),
)
