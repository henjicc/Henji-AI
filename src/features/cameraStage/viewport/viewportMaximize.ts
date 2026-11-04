import { useCameraStageViewportStore } from '../store/cameraStageViewportStore'
import { STAGE_VIEWPORT_IDS, type StageViewportId } from './viewportTypes'

function isViewportId(value: string | undefined): value is StageViewportId {
  return (STAGE_VIEWPORT_IDS as readonly string[]).includes(value ?? '')
}

/**
 * 最大化 / 还原窗格（` 键与视图菜单共用；窗格上中键单击直接切换那一格）：优先光标下的窗格，与 PR 的“最大化光标下的帧”一致；
 * 光标不在窗格上时取当前窗格。已最大化时光标就在唯一那格上，再按一次还原。
 */
export function toggleViewportMaximized(): void {
  const hovered = document.querySelector<HTMLElement>('[data-camera-stage-viewport-id]:hover')?.dataset.cameraStageViewportId
  const state = useCameraStageViewportStore.getState()
  state.toggleMaximized(isViewportId(hovered) ? hovered : state.maximizedViewportId ?? state.activeViewportId)
}
