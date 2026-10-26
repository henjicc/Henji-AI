import { resolveVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { VIDEO_EDIT_COLOR_GRADE } from '@/core/videoEdit/colorGrade'
import { evaluateVideoEditEffect } from '@/core/videoEdit/keyframes'
import { ColorGradeExportRejection, type ColorGradeExportFormat, type ColorGradeLutSize } from '@/core/imaging/lut/colorGradeExport'
import type { CubeLut } from '@/core/imaging/lut/cube'
import { exportColorGradeFile, type ColorGradeExportFileResult } from '@/services/colorGradeExport'
import { requireVideoEditInstance } from './videoEditService'
import { readVideoEditColorLut } from './videoEditColorLuts'

export interface VideoEditColorGradeExportInput { projectId: string; effectId: string; frame?: number; format: ColorGradeExportFormat; lutSize?: ColorGradeLutSize; path: string; overwrite?: boolean; signal?: AbortSignal }
export interface VideoEditColorGradeExportResult extends ColorGradeExportFileResult { sequenceId: string; clipId: string; frame: number }

/**
 * 把片段上一个全能调色效果在某一帧的参数导出为 .cube / .cdl（调色带关键帧时按该帧求值）。
 * 不修改剪辑；效果强度与作用区域属于合成，不进文件，如实列在 omitted 里。
 */
export async function exportVideoEditColorGrade(input: VideoEditColorGradeExportInput): Promise<VideoEditColorGradeExportResult> {
  const owner = requireVideoEditInstance(input.projectId)
  const located = owner.document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => (clip.effects ?? []).filter(effect => effect.id === input.effectId).map(effect => ({ sequence, clip, effect }))))[0]
  if (!located) throw new ColorGradeExportRejection('找不到这个效果，请用目录返回的 video_edit.effect 引用。')
  const { sequence, clip, effect } = located
  if (effect.builtin?.id !== VIDEO_EDIT_COLOR_GRADE.id) throw new ColorGradeExportRejection(`这个效果是“${effect.name}”，只有全能调色效果可以导出 LUT。`)
  const end = clip.start + clip.duration - 1
  if (input.frame !== undefined && (input.frame < clip.start || input.frame > end)) throw new ColorGradeExportRejection(`frame 需要落在片段范围 ${clip.start}–${end} 内（序列帧）。`)
  const playhead = owner.activeSequenceId === sequence.id ? owner.frame : clip.start
  const frame = input.frame ?? Math.min(end, Math.max(clip.start, playhead))
  const params = resolveVideoEditBuiltinParams(evaluateVideoEditEffect(effect, frame - clip.start).builtin!)
  const luts = new Map<string, CubeLut>()
  for (const key of ['input_lut', 'look_lut']) {
    const id = params[key]
    if (typeof id !== 'string' || !id || !Number(params[`${key}_strength`])) continue
    const asset = owner.document.colorLuts?.find(value => value.id === id)
    if (!asset) throw new ColorGradeExportRejection('调色引用的 LUT 已从项目移除，请重新选择或导入。')
    try { luts.set(id, await readVideoEditColorLut(asset)) } catch (error) { throw new ColorGradeExportRejection(error instanceof Error ? error.message : String(error), { cause: error }) }
  }
  const omitted = [...effect.amount < 1 ? [`效果强度 ${Math.round(effect.amount * 100)}%（文件按 100% 写入）`] : [], ...effect.mask ? ['作用区域'] : []]
  const result = await exportColorGradeFile({ params, format: input.format, lutSize: input.lutSize, path: input.path, overwrite: input.overwrite, signal: input.signal, luts, omitted, title: `${clip.name} ${effect.name}` })
  return { ...result, sequenceId: sequence.id, clipId: clip.id, frame }
}
