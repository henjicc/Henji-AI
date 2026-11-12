/** 逐帧全频与高频电平（dBFS），与停顿压缩、去重念同一分析 */
export interface AudioEditLevels { resolutionMs: number; wideDb: readonly number[]; highDb?: readonly number[] }

/** 字头前的轻声最多往前算这么长（毫秒）：送气、擦音、浊音起头的那一小段。 */
export const AUDIO_EDIT_ONSET_SEARCH_MS = 80
const ABOVE_FLOOR_DB = 6
const HIGH_ABOVE_FLOOR_DB = 15

export function levelPercentile(values: readonly number[], ratio: number): number {
  const sorted = values.filter((value) => Number.isFinite(value) && value > -120).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] : -120
}

/** 高于底噪的轻声（送气、擦音、浊音起头）：全频高出几 dB，或高频明显高出；底噪取全频与高频各自的 10% 分位。 */
export function audibleCells(levels: AudioEditLevels): (cell: number) => boolean {
  const wideFloor = levelPercentile(levels.wideDb, 0.1)
  const highFloor = levels.highDb ? levelPercentile(levels.highDb, 0.1) : Infinity
  return (cell) => levels.wideDb[cell] >= wideFloor + ABOVE_FLOOR_DB || (levels.highDb?.[cell] ?? -Infinity) >= highFloor + HIGH_ABOVE_FLOOR_DB
}

/**
 * 一个字识别起点之前紧挨着的轻声从哪儿开始（源采样帧）：从起点往前数连续高于底噪的格，最多 AUDIO_EDIT_ONSET_SEARCH_MS。
 * “再”“所”这类字主体起音前常有几十毫秒很轻的浊音或擦音，识别的起点又常落在主体上，这一段要算作字头。
 */
export function audioEditOnsetStart(levels: AudioEditLevels, audible: (cell: number) => boolean, startFrame: number, sampleRate: number): number {
  const cellFrames = levels.resolutionMs * sampleRate / 1000
  const limit = Math.round(AUDIO_EDIT_ONSET_SEARCH_MS / levels.resolutionMs)
  let cell = Math.floor(startFrame / cellFrames) - 1, count = 0
  while (cell >= 0 && count < limit && audible(cell)) { cell--; count++ }
  return Math.min(startFrame, Math.round((cell + 1) * cellFrames))
}
