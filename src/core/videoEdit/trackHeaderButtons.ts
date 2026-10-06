import { z } from 'zod'
import { sanitizeVideoEditButtonBars, withVideoEditButtonBar } from './buttonBars'

/**
 * 轨道头按钮可自定义（剪辑对齐 PR 2.4）：视频轨与音频轨各一栏。默认按 PR 只放几个——视频轨：锁定、同步锁定、
 * 切换轨道输出；音频轨：锁定、静音、独奏——其余（目标、视频轨静音独奏、音频轨输出与同步锁定）在按钮编辑器里加。
 * 点轨道编号与名称本身就是设为目标（PR 的轨道定位），所以“目标”默认不占按钮位。
 */
export type VideoEditTrackHeaderKind = 'video' | 'audio'
export const VIDEO_EDIT_TRACK_HEADER_BUTTONS = ['locked', 'sync', 'enabled', 'muted', 'solo', 'target'] as const
export type VideoEditTrackHeaderButtonId = typeof VIDEO_EDIT_TRACK_HEADER_BUTTONS[number]
export const VIDEO_EDIT_TRACK_HEADER_BUTTON_DEFAULTS: Record<VideoEditTrackHeaderKind, readonly VideoEditTrackHeaderButtonId[]> = {
  video: ['locked', 'sync', 'enabled'],
  audio: ['locked', 'muted', 'solo'],
}
export type VideoEditTrackHeaderButtonLayouts = Partial<Record<VideoEditTrackHeaderKind, readonly VideoEditTrackHeaderButtonId[]>>

/** 助手设置属性 `video_edit.track_header_buttons` 的值：只列改过的那一类，省略即默认。 */
export const videoEditTrackHeaderButtonLayoutsSchema = z.object({
  video: z.array(z.enum(VIDEO_EDIT_TRACK_HEADER_BUTTONS)).optional(),
  audio: z.array(z.enum(VIDEO_EDIT_TRACK_HEADER_BUTTONS)).optional(),
}).strict()

export function videoEditTrackHeaderButtons(layouts: VideoEditTrackHeaderButtonLayouts, kind: VideoEditTrackHeaderKind): readonly VideoEditTrackHeaderButtonId[] {
  return layouts[kind] ?? VIDEO_EDIT_TRACK_HEADER_BUTTON_DEFAULTS[kind]
}
export function sanitizeVideoEditTrackHeaderButtons(value: unknown): VideoEditTrackHeaderButtonLayouts {
  return sanitizeVideoEditButtonBars(['video', 'audio'] as const, () => VIDEO_EDIT_TRACK_HEADER_BUTTONS, value)
}
export function withVideoEditTrackHeaderButtons(layouts: VideoEditTrackHeaderButtonLayouts, kind: VideoEditTrackHeaderKind, ids: readonly string[] | null): VideoEditTrackHeaderButtonLayouts {
  return withVideoEditButtonBar<VideoEditTrackHeaderKind, VideoEditTrackHeaderButtonId>(layouts, kind, ids, VIDEO_EDIT_TRACK_HEADER_BUTTONS, VIDEO_EDIT_TRACK_HEADER_BUTTON_DEFAULTS[kind])
}
