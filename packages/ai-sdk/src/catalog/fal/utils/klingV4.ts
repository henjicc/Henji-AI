/** Fal 上 Kling 4.0 与 4.0 Flash 共用的取值与计费时长换算。 */

import type { JsonObject } from '../../../types/runtime'
import { resolveUploadedVideoDurationSeconds } from '../../shared/mediaPresence'

export const KLING_V4_MODES = ['text-image-to-video', 'reference-to-video', 'video-edit'] as const
export const KLING_V4_RATIOS = ['16:9', '9:16', '1:1', '21:9'] as const

export function klingV4Mode(value: unknown): (typeof KLING_V4_MODES)[number] {
  return KLING_V4_MODES.includes(value as (typeof KLING_V4_MODES)[number])
    ? value as (typeof KLING_V4_MODES)[number]
    : 'text-image-to-video'
}

export function klingV4Duration(value: unknown, max: number): number {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(3, number)) : 5
}

export function klingV4Prompt(params: JsonObject): string {
  return typeof params.prompt === 'string' ? params.prompt.trim() : ''
}

/** 智能比例：参考素材交给平台自适应，纯文生视频按首图比例无从参考，回退 16:9。 */
export function klingV4Ratio(value: unknown, adaptive: 'auto' | undefined): string | undefined {
  const raw = String(value || 'smart')
  if ((KLING_V4_RATIOS as readonly string[]).includes(raw)) return raw
  return adaptive
}

/** 视频编辑输出默认跟随源视频长度；源视频时长未知时按 5 秒估算。 */
export function klingV4EditSeconds(params: JsonObject): { source: number; input: number } {
  const durations = Array.isArray(params.__videoDurationSeconds) ? params.__videoDurationSeconds : []
  const first = typeof durations[0] === 'number' && durations[0] > 0
    ? durations[0]
    : (typeof params.__firstVideoDurationSeconds === 'number' && params.__firstVideoDurationSeconds > 0 ? params.__firstVideoDurationSeconds : 5)
  return { source: first, input: resolveUploadedVideoDurationSeconds(params, 5) }
}
