import { styleKitContent, styleKitSchema, type StyleKit } from '@/core/videoEdit/styleKit'
import { videoEditStyleKitLibrary } from './videoEditStyleKitLibrary'
import { videoEditPresetPreferences } from './videoEditPresetPreferences'
import { setVideoEditNewSequenceStyle } from './videoEditService'

/**
 * A new sequence starts from the user's default style (preset panel “设为默认”). The project receives its own
 * snapshot, reusing an identical one it already has, so later library edits never change finished work.
 * Without a default nothing is bound: the assistant may still recommend the best-liked style, the user decides.
 */
export function defaultVideoEditStyleBinding(document: { styleKits?: StyleKit[] }, sequence: { styleKitId?: string }): { styleKits: StyleKit[]; styleKitId: string } | undefined {
  if (sequence.styleKitId) return undefined
  const id = videoEditPresetPreferences.defaultId('style')
  const kit = id ? videoEditStyleKitLibrary.list().find(value => value.id === id) : undefined
  if (!kit) return undefined
  const copy = kit
  const content = JSON.stringify(styleKitContent(copy))
  const existing = document.styleKits?.find(value => value.name === copy.name && JSON.stringify(styleKitContent(value)) === content)
  if (existing) return { styleKits: document.styleKits!, styleKitId: existing.id }
  const snapshot = styleKitSchema.parse({ ...copy, id: crypto.randomUUID(), revision: 0 })
  return { styleKits: [...(document.styleKits ?? []), snapshot], styleKitId: snapshot.id }
}
/** Pure helper for the sequence-creating paths: returns the document and sequence with the default style applied. */
export function withDefaultVideoEditStyle<D extends { styleKits?: StyleKit[] }, S extends { styleKitId?: string }>(document: D, sequence: S): { document: D; sequence: S } {
  const binding = defaultVideoEditStyleBinding(document, sequence)
  return binding ? { document: { ...document, styleKits: binding.styleKits }, sequence: { ...sequence, styleKitId: binding.styleKitId } } : { document, sequence }
}
setVideoEditNewSequenceStyle(withDefaultVideoEditStyle)
