import type { VideoEditClip, VideoEditComposition, VideoEditSequence } from '@/core/videoEdit/document'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'

export interface VideoEditParameterPatch {
  sequenceId: string
  clipId: string
  effects?: Array<{ id: string; value: VideoEditEffect }>
  code?: VideoEditClip['code']
  graphic?: VideoEditClip['graphic']
}
export interface VideoEditParameterUpdate { baseRevision: number; revision: number; patches: VideoEditParameterPatch[] }
/** Existing queued audio must be remixed when an audio clip's effects change. */
export function videoEditParameterAffectsAudio(document: VideoEditComposition, update: VideoEditParameterUpdate): boolean {
  return update.patches.some(patch => (patch.sequenceId === document.id ? document.clips : document.sequences?.find(value => value.id === patch.sequenceId)?.clips)?.some(clip => clip.id === patch.clipId && clip.kind === 'audio'))
}
/** Only changed text-valued bindings may introduce a font. Numeric/color drags need no font scan. */
export function videoEditParameterNeedsFonts(document: VideoEditComposition, update: VideoEditParameterUpdate): boolean {
  const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : typeof value === 'object' && value !== null ? Object.values(value).flatMap(strings) : []
  const binding = (code: VideoEditClip['code']): string[] => [...strings(code?.parameters), ...Object.values(code?.curves ?? {}).flatMap(points => points.flatMap(point => strings(point.value)))]
  return update.patches.some(patch => {
    const clip = (patch.sequenceId === document.id ? document.clips : document.sequences?.find(value => value.id === patch.sequenceId)?.clips)?.find(value => value.id === patch.clipId)
    if (!clip) return true
    if (patch.graphic && !same(strings(clip.graphic), strings(patch.graphic))) return true
    if (patch.code && !same(binding(clip.code), binding(patch.code))) return true
    return patch.effects?.some(change => !same(binding(clip.effects?.find(value => value.id === change.id)?.code), binding(change.value.code))) ?? false
  })
}
const same = (left: unknown, right: unknown): boolean => left === right || JSON.stringify(left) === JSON.stringify(right)
function unchanged(left: object, right: object, omit: readonly string[]): boolean {
  const a = left as Record<string, unknown>; const b = right as Record<string, unknown>
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => omit.includes(key) || same(a[key], b[key]))
}

/** Parameter-only changes use the same domain values as export; structural edits always use the full update. */
export function videoEditParameterUpdate(before: VideoEditComposition, next: VideoEditComposition): VideoEditParameterUpdate | undefined {
  if (before === next || !unchanged(before, next, ['revision', 'clips', 'sequences'])) return undefined
  const patches: VideoEditParameterPatch[] = []
  const collect = (a: Pick<VideoEditSequence, 'id' | 'clips'>, b: Pick<VideoEditSequence, 'id' | 'clips'>): boolean => {
    if (a.clips === b.clips) return true
    if (a.clips.length !== b.clips.length) return false
    for (let i = 0; i < a.clips.length; i++) {
      const clip = a.clips[i]; const changed = b.clips[i]
      if (clip === changed) continue
      if (!unchanged(clip, changed, ['effects', 'code', 'graphic'])) return false
      if (!unchanged(clip.code ?? {}, changed.code ?? {}, ['parameters', 'curves'])) return false
      if (!unchanged(clip.graphic ?? {}, changed.graphic ?? {}, ['objects'])) return false
      const effects: VideoEditParameterPatch['effects'] = []
      if (!same(clip.effects, changed.effects)) {
        if (clip.effects?.length !== changed.effects?.length) return false
        for (let j = 0; j < (clip.effects?.length ?? 0); j++) {
          const effect = clip.effects![j]; const value = changed.effects![j]
          if (same(effect, value)) continue
          if (!unchanged(effect, value, ['amount', 'enabled', 'builtin', 'code', 'mask'])) return false
          if (!unchanged(effect.builtin ?? {}, value.builtin ?? {}, ['params', 'curves'])) return false
          if (!unchanged(effect.code ?? {}, value.code ?? {}, ['parameters', 'curves'])) return false
          effects.push({ id: effect.id, value })
        }
      }
      const patch: VideoEditParameterPatch = { sequenceId: a.id, clipId: clip.id }
      if (effects.length) patch.effects = effects
      if (!same(clip.code, changed.code)) patch.code = changed.code
      if (!same(clip.graphic, changed.graphic)) patch.graphic = changed.graphic
      if (patch.effects || patch.code || patch.graphic) patches.push(patch)
    }
    return true
  }
  if (!collect(before, next)) return undefined
  const a = before.sequences ?? []; const b = next.sequences ?? []
  if (a.length !== b.length) return undefined
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    if (!unchanged(a[i], b[i], ['clips']) || (a[i].id !== next.id && !collect(a[i], b[i]))) return undefined
  }
  return { baseRevision: before.revision, revision: next.revision, patches }
}

export function applyVideoEditParameterUpdate(document: VideoEditComposition, update: VideoEditParameterUpdate): VideoEditComposition {
  if (document.revision !== update.baseRevision) throw new Error('参数预览版本已改变，请重新同步画面。')
  const clips = (sequenceId: string, values: VideoEditClip[]): VideoEditClip[] => values.map(clip => {
    const patch = update.patches.find(value => value.sequenceId === sequenceId && value.clipId === clip.id)
    if (!patch) return clip
    return { ...clip, ...(patch.effects ? { effects: clip.effects?.map(effect => patch.effects!.find(value => value.id === effect.id)?.value ?? effect) } : {}), ...(patch.code ? { code: patch.code } : {}), ...(patch.graphic ? { graphic: patch.graphic } : {}) }
  })
  return { ...document, revision: update.revision, clips: clips(document.id, document.clips), ...(document.sequences ? { sequences: document.sequences.map(sequence => update.patches.some(patch => patch.sequenceId === sequence.id) ? { ...sequence, clips: clips(sequence.id, sequence.clips) } : sequence) } : {}) }
}
