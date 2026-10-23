import { z } from 'zod'

/** LUFS is gated programme loudness; dBTP is reconstructed peak, not a sample peak. */
export const videoEditLoudnessSettingsSchema = z.object({ targetLufs: z.number().finite().min(-70).max(-5).describe('整片目标积分听感响度 LUFS；网络视频 -14、播客 -16、EBU R128 广播 -23，越接近零越响。'), truePeakDbtp: z.number().finite().min(-8).max(0).describe('重建采样点之间的真峰值上限 dBTP，常用 -1；通过限幅控制，并非普通采样峰值。') }).strict()
export type VideoEditLoudnessSettings = z.infer<typeof videoEditLoudnessSettingsSchema>
export const videoEditLoudnessMeasurementSchema = z.object({ integratedLufs: z.number().finite().nullable(), shortTermLufs: z.number().finite().nullable(), truePeakDbtp: z.number().finite().nullable(), samplePeakDbfs: z.number().finite().nullable(), durationSeconds: z.number().nonnegative() }).strict()
export type VideoEditLoudnessMeasurement = z.infer<typeof videoEditLoudnessMeasurementSchema>
export const VIDEO_EDIT_LOUDNESS_PRESETS = [{ value: -14, label: '网络视频 · -14 LUFS' }, { value: -16, label: '播客 · -16 LUFS' }, { value: -23, label: '广播 EBU R128 · -23 LUFS' }] as const
export type VideoEditGainMode = 'set' | 'adjust' | 'peak_max' | 'peak_all' | 'loudness'
export const videoEditGainDbSchema = z.number().finite().min(-96).max(96)
/** 源增益与可动画的音量独立；停用固有音量不旁路源增益。 */
export function videoEditGainMultiplier(gainDb = 0): number { return 10 ** (gainDb / 20) }
function checkedGain(db: number): number {
  if (!videoEditGainDbSchema.safeParse(db).success) throw new Error('音频增益必须在 -96～+96 dB 之间。')
  return db
}
/** 标准化接收未施加片段增益、音量、淡化及效果的源测量，不累加旧增益。 */
export function videoEditGainValues(mode: VideoEditGainMode, value: number, gains: number[], measurements: VideoEditLoudnessMeasurement[] = []): number[] {
  if (!Number.isFinite(value)) throw new Error('目标值必须是有限数值。')
  if (mode === 'set') return gains.map(() => checkedGain(value))
  if (mode === 'adjust') return gains.map(gain => checkedGain(gain + value))
  if (measurements.length !== gains.length) throw new Error('请先完成所有片段的响度测量。')
  const levels = measurements.map(measurement => mode === 'loudness' ? measurement.integratedLufs : measurement.samplePeakDbfs)
  if (levels.some(level => level === null)) throw new Error('所选声音为静音、低于测量门限或不足 400 毫秒，无法标准化。')
  const maximum = Math.max(...levels as number[])
  return gains.map((_, index) => checkedGain(value - (mode === 'peak_max' ? maximum : levels[index]!)))
}
/** 录后按源声音匹配 -16 LUFS，真峰值优先，最多放大 30 dB；静音和短片段保留。 */
export function videoEditRecordingGainDb(gainDb: number, measurement: VideoEditLoudnessMeasurement): number {
  if (measurement.durationSeconds < .4 || measurement.integratedLufs === null || measurement.truePeakDbtp === null) return gainDb
  return checkedGain(Math.max(-96, Math.min(30, -16 - measurement.integratedLufs, -1 - measurement.truePeakDbtp)))
}
