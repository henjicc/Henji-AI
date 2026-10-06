import { z } from 'zod'
import { sanitizeVideoEditButtonBars, withVideoEditButtonBar } from './buttonBars'

/**
 * 监视器按钮栏可自定义（剪辑对齐 PR 2.5）：节目、源监视器各有一组可用按钮，默认只显示 PR 默认的那几个，
 * 其余在“按钮编辑器”里拖进按钮栏。设置里只存用户改过的那一侧；没存 = 用默认（默认随版本调整时跟着走）。
 */
export type VideoEditMonitorKind = 'program' | 'source'

/** 节目监视器可用按钮（编辑器网格按此顺序）。命令按钮的 id 与剪辑命令同名；`export_frame`、`mode_*` 是监视器自己的动作。 */
export const VIDEO_EDIT_PROGRAM_BUTTONS = [
  'add_marker', 'mark_in', 'mark_out', 'clear_in_out', 'go_in', 'go_out',
  'go_start', 'step_back_five', 'step_back', 'play_reverse', 'play_stop', 'play_pause', 'play_forward', 'step_forward', 'step_forward_five', 'go_end',
  'go_prev_edit', 'go_next_edit', 'lift', 'extract', 'export_frame',
  'mode_select', 'mode_move', 'mode_point', 'mode_region',
] as const
/** 源监视器可用按钮；`drag_*` 是只能拖动的“拖入画面／声音／链接音画”。 */
export const VIDEO_EDIT_SOURCE_BUTTONS = [
  'mark_in', 'mark_out', 'clear_in_out',
  'step_back_five', 'step_back', 'play_reverse', 'play_stop', 'play_pause', 'play_forward', 'step_forward', 'step_forward_five',
  'insert', 'overwrite', 'drag_video', 'drag_audio', 'drag_linked',
] as const
export type VideoEditProgramButtonId = typeof VIDEO_EDIT_PROGRAM_BUTTONS[number]
export type VideoEditSourceButtonId = typeof VIDEO_EDIT_SOURCE_BUTTONS[number]
export type VideoEditMonitorButtonId = VideoEditProgramButtonId | VideoEditSourceButtonId

/**
 * 默认按钮：节目按 PR 默认节目监视器（添加标记、入点、出点、转到入点、后退一帧、播放、前进一帧、转到出点、提升、提取、导出帧）；
 * 源按 PR 默认源监视器的入出点、逐帧、播放、插入、覆盖，另保留原有的 J/K/L 与三个拖入按钮（我们没有 PR 源监视器下方的拖动图标区）。
 */
export const VIDEO_EDIT_MONITOR_BUTTON_DEFAULTS: { program: readonly VideoEditProgramButtonId[]; source: readonly VideoEditSourceButtonId[] } = {
  program: ['add_marker', 'mark_in', 'mark_out', 'go_in', 'step_back', 'play_pause', 'step_forward', 'go_out', 'lift', 'extract', 'export_frame'],
  source: ['mark_in', 'mark_out', 'step_back', 'play_reverse', 'play_stop', 'play_pause', 'play_forward', 'step_forward', 'insert', 'overwrite', 'drag_video', 'drag_audio', 'drag_linked'],
}

export type VideoEditMonitorButtonLayouts = Partial<Record<VideoEditMonitorKind, readonly VideoEditMonitorButtonId[]>>

/** 助手设置属性 `video_edit.monitor_buttons` 的值：只列改过的那一侧，省略即默认。 */
export const videoEditMonitorButtonLayoutsSchema = z.object({
  program: z.array(z.enum(VIDEO_EDIT_PROGRAM_BUTTONS)).optional(),
  source: z.array(z.enum(VIDEO_EDIT_SOURCE_BUTTONS)).optional(),
}).strict()

export function videoEditMonitorButtonCatalog(kind: VideoEditMonitorKind): readonly VideoEditMonitorButtonId[] {
  return kind === 'program' ? VIDEO_EDIT_PROGRAM_BUTTONS : VIDEO_EDIT_SOURCE_BUTTONS
}

/** 当前按钮栏：用户改过就用用户的（可以为空），否则用默认。 */
export function videoEditMonitorButtons(layouts: VideoEditMonitorButtonLayouts, kind: VideoEditMonitorKind): readonly VideoEditMonitorButtonId[] {
  return layouts[kind] ?? VIDEO_EDIT_MONITOR_BUTTON_DEFAULTS[kind]
}

/** 读设置时清洗：去掉不认识的按钮与重复项，形状不对的那一侧回到默认，不让旧设置读失败。 */
export function sanitizeVideoEditMonitorButtons(value: unknown): VideoEditMonitorButtonLayouts {
  return sanitizeVideoEditButtonBars(['program', 'source'] as const, videoEditMonitorButtonCatalog, value)
}

/** 写设置：与默认相同就不存（以后默认调整时跟着走）。 */
export function withVideoEditMonitorButtons(layouts: VideoEditMonitorButtonLayouts, kind: VideoEditMonitorKind, ids: readonly string[] | null): VideoEditMonitorButtonLayouts {
  return withVideoEditButtonBar<VideoEditMonitorKind, VideoEditMonitorButtonId>(layouts, kind, ids, videoEditMonitorButtonCatalog(kind), VIDEO_EDIT_MONITOR_BUTTON_DEFAULTS[kind])
}
