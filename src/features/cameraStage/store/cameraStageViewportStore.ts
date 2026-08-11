import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  STAGE_VIEWPORT_IDS,
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
export const VIEWPORT_STATE_VERSION = 3

type PersistedViewportState = Pick<
  CameraStageViewportState,
  'layout' | 'activeViewportId' | 'maximizedViewportId' | 'viewports'
>

/** 同一种画面只算一次；用它判断两个窗格是不是在显示同样的东西。 */
function sourceKey(source: StageViewportSource): string {
  if (source.kind === 'fixed') return `fixed:${source.view}`
  if (source.kind === 'camera') return `camera:${source.cameraId}`
  return source.kind
}

/** 修复重复时的候补画面，按对运镜的有用程度排。 */
const REPAIR_FALLBACKS: readonly StageViewportSource[] = [
  { kind: 'director' },
  { kind: 'active_camera' },
  { kind: 'fixed', view: 'top' },
  { kind: 'fixed', view: 'front' },
  { kind: 'fixed', view: 'right' },
  { kind: 'fixed', view: 'left' },
  { kind: 'fixed', view: 'back' },
  { kind: 'fixed', view: 'bottom' },
]

/**
 * 把重复的窗格改回各不相同。
 *
 * 存量状态里躺着上一个 bug 的产物：摄像机 id 失效时旧代码把那一格改成"自由透视"并存了下来，
 * 于是本地存的就是两格都是自由透视。迁移如果原样保留"用户的选择"，等于把 bug 的产物当成
 * 用户意图搬到新版本——用户看到的还是两个一模一样的画面，只是换了个位置。
 *
 * 重复本身就是可判定的损坏信号：四个格子显示同一种画面没有任何意义。命中就退回该格的默认值；
 * 默认值也撞车时按 REPAIR_FALLBACKS 找第一个没被占用的。
 */
function repairDuplicateViewports(
  viewports: Record<StageViewportId, StageViewportConfig>
): Record<StageViewportId, StageViewportConfig> {
  const defaults = cloneDefaultStageViewports()
  const used = new Set<string>()
  const repaired = {} as Record<StageViewportId, StageViewportConfig>
  for (const id of STAGE_VIEWPORT_IDS) {
    const current = viewports[id]?.source ?? defaults[id].source
    const candidates = [current, defaults[id].source, ...REPAIR_FALLBACKS]
    const picked = candidates.find((candidate) => !used.has(sourceKey(candidate))) ?? current
    used.add(sourceKey(picked))
    repaired[id] = { id, source: picked }
  }
  return repaired
}

/**
 * v1（透视/顶/正/右）→ v2（透视/摄像机/顶/正）→ v3（v2 基础上修掉重复窗格）。
 *
 * v2 的迁移保留了用户自己选的来源，但没想到**存量状态里本来就有重复**——那是上一个 bug 存
 * 下来的，不是用户选的。v3 加一道去重修复：v2 之前的状态全部过一遍。
 *
 * `activeViewportId` / `maximizedViewportId` 里指向已删除窗格（`right`）的引用必须一起改掉，
 * 否则它们指着一个不存在的格子，界面表现为"点谁都不高亮"或"怎么都退不出最大化"。
 *
 * 抽成导出的纯函数是为了能直接测：迁移逻辑埋在 persist 选项里就只能靠实机验证，
 * 而这类问题恰恰是静默的——这一轮就是这么漏过去的。
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
  const merged: Record<StageViewportId, StageViewportConfig> = version >= 2
    ? { ...defaults, ...(state.viewports ?? {}) }
    : {
        perspective: legacy.perspective ?? defaults.perspective,
        camera: defaults.camera,
        top: legacy.top ?? defaults.top,
        front: legacy.front ?? defaults.front,
      }
  const viewports = repairDuplicateViewports(merged)
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
