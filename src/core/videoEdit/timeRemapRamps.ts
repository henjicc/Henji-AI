import { videoEditTimeRemapSchema, videoEditTimeRemapSpeedAtSource, VIDEO_EDIT_TIME_REMAP_MAX_POINTS, VIDEO_EDIT_TIME_REMAP_SPEED_MAX, VIDEO_EDIT_TIME_REMAP_SPEED_MIN, type VideoEditTimeRemap, type VideoEditTimeRemapPoint } from './timeRemap'
import { videoEditClipSourceSecondsAtTime, videoEditClipSourceSpanSeconds, type VideoEditClipTiming } from './clipSpeed'
import { videoEditSourceSeconds } from './time'

/**
 * 速度坡道与曲线预设（时间重映射的算法入口，界面预设与助手 ramp 能力共用）：都只产出 `timeRemap` 曲线，
 * 写入统一走速度编辑（`applyVideoEditSpeedChange`），时长随曲线重新积分。
 */

/** 剪映式曲线变速预设：按片段用到的素材长度的比例放点，速度为倍率。 */
export const VIDEO_EDIT_TIME_REMAP_PRESETS = {
  montage: { label: '蒙太奇', points: [[0, 2.5], [.3, .5], [.7, .5], [1, 2.5]] },
  hero: { label: '英雄时刻', points: [[0, 1.5], [.4, .25], [.6, .25], [1, 1.5]] },
  bullet: { label: '子弹时间', points: [[0, 2], [.3, .15], [.7, .15], [1, 2]] },
  jump: { label: '跳接', points: [[0, 1], [.4, 1], [.5, 4], [.6, 1], [1, 1]] },
  flash_in: { label: '闪进', points: [[0, 4], [.35, 1], [1, 1]] },
  flash_out: { label: '闪出', points: [[0, 1], [.65, 1], [1, 4]] },
} as const satisfies Record<string, { label: string; points: ReadonlyArray<readonly [number, number]> }>
export type VideoEditTimeRemapPreset = keyof typeof VIDEO_EDIT_TIME_REMAP_PRESETS
export const VIDEO_EDIT_TIME_REMAP_PRESET_IDS = Object.keys(VIDEO_EDIT_TIME_REMAP_PRESETS) as VideoEditTimeRemapPreset[]

const clampSpeed = (value: number): number => Math.max(VIDEO_EDIT_TIME_REMAP_SPEED_MIN, Math.min(VIDEO_EDIT_TIME_REMAP_SPEED_MAX, value))
/** 预设曲线：点按素材长度 `spanSeconds` 的比例放置，点之间缓入缓出。 */
export function videoEditTimeRemapPreset(preset: VideoEditTimeRemapPreset, spanSeconds: number): VideoEditTimeRemap {
  const span = Math.max(1, Math.round(spanSeconds * 1e6))
  return videoEditTimeRemapSchema.parse({ points: VIDEO_EDIT_TIME_REMAP_PRESETS[preset].points.map(([x, speed]) => ({ offsetUs: Math.round(x * span), speed, interpolation: 'ease' })) })
}

/** 一处速度坡道：在时间线 `atSeconds`（序列秒）附近把速度变到 `speed`，`holdSeconds` 保持、两侧按秒数缓入缓出。 */
export interface VideoEditSpeedRamp { atSeconds: number; speed: number; holdSeconds: number; easeInSeconds: number; easeOutSeconds: number }

/**
 * 按坡道生成速度曲线。坡道时刻按片段**当前**的换算落到素材位置（用户看到的那一刻画面就是坡道中心），
 * 缓入/缓出/保持的秒数按当时的速度换算成素材长度：缓入段按基础速度，保持段按目标速度。坡道之外是 `baseSpeed`。
 * 坡道重叠时按时间先后保留前一个，后一个整体挪到其后（不会产生倒退的点）。
 */
export function buildVideoEditSpeedRampCurve(clip: VideoEditClipTiming, fps: number, ramps: readonly VideoEditSpeedRamp[], baseSpeed: number): VideoEditTimeRemap {
  const base = clampSpeed(baseSpeed)
  const head = videoEditSourceSeconds(clip)
  const span = videoEditClipSourceSpanSeconds(clip, fps)
  const along = (seconds: number): number => Math.abs(videoEditClipSourceSecondsAtTime(clip, seconds, fps) - head)
  const points: VideoEditTimeRemapPoint[] = [{ offsetUs: 0, speed: base, interpolation: 'ease' }]
  const push = (seconds: number, speed: number, interpolation: VideoEditTimeRemapPoint['interpolation']): void => {
    const offsetUs = Math.round(Math.max(0, seconds) * 1e6)
    const last = points[points.length - 1]
    if (offsetUs <= last.offsetUs) { if (offsetUs === last.offsetUs) points[points.length - 1] = { offsetUs, speed: clampSpeed(speed), interpolation }; return }
    points.push({ offsetUs, speed: clampSpeed(speed), interpolation })
  }
  for (const ramp of [...ramps].sort((a, b) => a.atSeconds - b.atSeconds)) {
    const target = clampSpeed(ramp.speed)
    const center = along(ramp.atSeconds)
    const hold = Math.max(0, ramp.holdSeconds) * target
    const easeIn = Math.max(0, ramp.easeInSeconds) * (base + target) / 2
    const easeOut = Math.max(0, ramp.easeOutSeconds) * (base + target) / 2
    const start = Math.max(points[points.length - 1].offsetUs / 1e6, center - hold / 2 - easeIn)
    push(start, base, 'ease')
    push(start + easeIn, target, hold > 0 ? 'hold' : 'ease')
    if (hold > 0) push(start + easeIn + hold, target, 'ease')
    push(start + easeIn + hold + easeOut, base, 'ease')
  }
  if (points.length > VIDEO_EDIT_TIME_REMAP_MAX_POINTS) throw new Error(`速度坡道太多：最多 ${Math.floor((VIDEO_EDIT_TIME_REMAP_MAX_POINTS - 1) / 4)} 处。`)
  // 结尾之后的点无害（修剪出点时会重新用到），但最后一处坡道仍须落在片段用到的素材内才有意义。
  if (ramps.length && points.length > 1 && points[1].offsetUs / 1e6 >= span) throw new Error('坡道时刻不在片段范围内，请使用片段开始到结束之间的序列时间。')
  return videoEditTimeRemapSchema.parse({ points })
}
/** 曲线在每个点处的速度（读回摘要用）。 */
export function videoEditTimeRemapSummary(remap: VideoEditTimeRemap): Array<{ sourceSeconds: number; speedPercent: number }> {
  return remap.points.map(point => ({ sourceSeconds: point.offsetUs / 1e6, speedPercent: Math.round(videoEditTimeRemapSpeedAtSource(remap, point.offsetUs / 1e6) * 10000) / 100 }))
}
