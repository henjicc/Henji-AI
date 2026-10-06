import { z } from 'zod'

/** LUFS is gated programme loudness; dBTP is reconstructed peak, not a sample peak. */
export const videoEditLoudnessSettingsSchema = z.object({ targetLufs: z.number().finite().min(-70).max(-5).describe('整片目标积分听感响度 LUFS；网络视频 -14、播客 -16、EBU R128 广播 -23，越接近零越响。'), truePeakDbtp: z.number().finite().min(-8).max(0).describe('重建采样点之间的真峰值上限 dBTP，常用 -1；通过限幅控制，并非普通采样峰值。') }).strict()
export type VideoEditLoudnessSettings = z.infer<typeof videoEditLoudnessSettingsSchema>
export const videoEditLoudnessMeasurementSchema = z.object({ integratedLufs: z.number().finite().nullable(), shortTermLufs: z.number().finite().nullable(), truePeakDbtp: z.number().finite().nullable(), samplePeakDbfs: z.number().finite().nullable(), durationSeconds: z.number().nonnegative() }).strict()
export type VideoEditLoudnessMeasurement = z.infer<typeof videoEditLoudnessMeasurementSchema>
export const VIDEO_EDIT_LOUDNESS_PRESETS = [{ value: -14, label: '网络视频 · -14 LUFS' }, { value: -16, label: '播客 · -16 LUFS' }, { value: -23, label: '广播 EBU R128 · -23 LUFS' }] as const
export type VideoEditGainMode = 'set' | 'adjust' | 'peak_max' | 'peak_all' | 'loudness'
export function videoEditVolumeFromDb(db: number): number {
  if (!Number.isFinite(db)) throw new Error('增益必须是有限的 dB 数值。')
  const volume = 10 ** (db / 20)
  if (volume > 2 + 1e-10 || volume <= 0) throw new Error('片段当前最高支持 +6.02 dB 增益。请降低目标，或使用导出的整片响度标准化。')
  return Math.min(2, volume)
}
export function videoEditGainVolumes(mode: VideoEditGainMode, value: number, volumes: number[], measurements: VideoEditLoudnessMeasurement[] = []): number[] {
  if (!Number.isFinite(value)) throw new Error('目标值必须是有限数值。')
  if (mode === 'set') return volumes.map(() => videoEditVolumeFromDb(value))
  if (mode === 'adjust') return volumes.map(volume => volume === 0 ? 0 : videoEditVolumeFromDb(20 * Math.log10(volume) + value))
  if (measurements.length !== volumes.length) throw new Error('请先完成所有片段的响度测量。')
  const levels = measurements.map(measurement => mode === 'loudness' ? measurement.integratedLufs : measurement.samplePeakDbfs)
  if (levels.some(level => level === null)) throw new Error('所选声音为静音、低于测量门限或不足 400 毫秒，无法标准化。')
  const maximum = Math.max(...levels as number[])
  return volumes.map((volume, index) => videoEditVolumeFromDb(20 * Math.log10(volume) + value - (mode === 'peak_max' ? maximum : levels[index]!)))
}
