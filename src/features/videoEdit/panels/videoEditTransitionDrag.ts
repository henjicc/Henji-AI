import { VIDEO_EDIT_TRANSITION_PRESETS, type VideoEditTransitionKind } from '@/core/videoEdit/transitions'

/** 从效果面板拖出过渡预设：拖动数据带上种类；拖动中（dragover 读不到数据）由这里记住正在拖的预设。 */
export const VIDEO_EDIT_TRANSITION_DRAG_TYPE = 'application/x-henji-video-edit-transition'
let active: { projectId: string; kind: VideoEditTransitionKind } | null = null
export function startVideoEditTransitionDrag(dataTransfer: DataTransfer, projectId: string, kind: VideoEditTransitionKind): void {
  dataTransfer.setData(VIDEO_EDIT_TRANSITION_DRAG_TYPE, kind)
  dataTransfer.effectAllowed = 'copy'
  active = { projectId, kind }
}
export function endVideoEditTransitionDrag(): void { active = null }
/** 拖进时间线的是不是过渡预设；是就返回它的种类（拖动中只能从记住的预设读，松手时读拖动数据）。 */
export function readVideoEditTransitionDrag(dataTransfer: DataTransfer | null, projectId: string): VideoEditTransitionKind | undefined {
  if (!dataTransfer || !Array.from(dataTransfer.types).includes(VIDEO_EDIT_TRANSITION_DRAG_TYPE)) return undefined
  const data = dataTransfer.getData(VIDEO_EDIT_TRANSITION_DRAG_TYPE)
  const kind = VIDEO_EDIT_TRANSITION_PRESETS.find(preset => preset.kind === data)?.kind
  return kind ?? (active?.projectId === projectId ? active.kind : undefined)
}
