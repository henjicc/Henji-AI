import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditGraphic, VideoEditGraphicObject } from '@/core/videoEdit/graphics'
import { videoEditGraphicObjectMetadata } from '@/core/videoEdit/graphics'
import { compareCodeMaterialTime, evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { PreparedCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { VideoEditSourceTime } from '@/core/videoEdit/time'
import { measureVideoEditGlyph } from '../videoEditGlyphMetrics'

const textKeys = ['text', 'fontFamily', 'fontSize'] as const
const zero: VideoEditSourceTime = { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
function sameText(object: VideoEditGraphicObject, previous: VideoEditGraphicObject | undefined): boolean {
  return previous?.kind === 'text' && textKeys.every(key => object.parameters[key] === previous.parameters[key] && JSON.stringify(object.curves?.[key]) === JSON.stringify(previous.curves?.[key]))
}
function check(prepared: PreparedCodeMaterialParameters, time: VideoEditSourceTime, maxFontSize?: number): void {
  const values = evaluateCodeMaterialParameters(prepared, time)
  if (values.text === '') return // Empty text creates no glyph in the production GPU path.
  measureVideoEditGlyph(values.text as string, maxFontSize ?? values.fontSize as number, values.fontFamily as string)
}
function validate(graphic: VideoEditGraphic, previous?: VideoEditGraphic): void {
  if (graphic === previous) return
  const old = previous && graphic.width === previous.width && graphic.height === previous.height ? new Map(previous.objects.map(object => [object.id, object])) : undefined
  for (const object of graphic.objects) {
    if (object.kind !== 'text' || sameText(object, old?.get(object.id))) continue
    const prepared = prepareCodeMaterialParameters(videoEditGraphicObjectMetadata(graphic, object), object)
    const times = [zero, ...textKeys.flatMap(key => prepared.curves.get(key)?.points ?? [])].sort(compareCodeMaterialTime).filter((time, index, all) => !index || compareCodeMaterialTime(all[index - 1], time) !== 0)
    const sizes = prepared.curves.get('fontSize')?.points
    for (const [index, time] of times.entries()) {
      check(prepared, time)
      const next = times[index + 1]
      if (!next) continue
      // Text and font are hold curves. Only a continuous size segment can
      // approach the next boundary's size while retaining the current text.
      // A hold jump must instead be checked with the new text at that boundary.
      let leftIndex = -1
      if (sizes) for (let at = 0; at < sizes.length && compareCodeMaterialTime(sizes[at], time) <= 0; at++) leftIndex = at
      const left = sizes?.[leftIndex]
      if (!left || left === sizes?.at(-1) || left.interpolation === 'hold') continue
      const current = evaluateCodeMaterialParameters(prepared, time).fontSize as number
      const end = evaluateCodeMaterialParameters(prepared, next).fontSize as number
      check(prepared, time, Math.max(current, end))
    }
  }
}

/** Certify every possible text/font/size interval, including offscreen source
 * keyframes. Unchanged text bindings need no measurement or render work. */
export function validateVideoEditGraphicTextBudget(document: VideoEditDocument, before?: VideoEditDocument): void {
  if (document.items !== before?.items) {
    const old = new Map(before?.items.map(item => [item.id, item.graphic]))
    for (const item of document.items) if (item.graphic) validate(item.graphic, old.get(item.id))
  }
  const oldSequences = new Map(before?.sequences.map(sequence => [sequence.id, sequence]))
  for (const sequence of document.sequences) {
    const previous = oldSequences.get(sequence.id)
    if (sequence.clips === previous?.clips) continue
    const old = new Map(previous?.clips.map(clip => [clip.id, clip.graphic]))
    for (const clip of sequence.clips) if (clip.graphic) validate(clip.graphic, old.get(clip.id))
  }
}
