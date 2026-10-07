import { audibleVideoEditClips, videoEditClipMedia, videoEditDuration, videoEditNestedComposition, type VideoEditComposition } from './document'
import { activeVideoEditAudioEffects } from './compositing'
import type { VideoEditKeyframe } from './keyframes'
import { VIDEO_EDIT_MAX_SEQUENCE_DEPTH } from './sequenceGraph'
import { videoEditTransitionMedium, videoEditTransitionWindow, type VideoEditTransitionWindow } from './transitions'

function points(values: readonly VideoEditKeyframe[] | undefined): unknown[] {
  return (values ?? []).map(({ time, value, interpolation, easeRange }) => ({ time, value, interpolation, easeRange }))
}
/** Object insertion order and editing provenance do not change the rendered sound. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  return value
}

/** Project only the inputs consumed by mixAudio, recursively following audible nested clips. */
export function videoEditAudioContent(snapshot: VideoEditComposition): string {
  const cached = new Map<string, number>(); const sequences: unknown[] = []
  const content = (sequence: VideoEditComposition, path: readonly string[]): number => {
    if (path.includes(sequence.id) || path.length >= VIDEO_EDIT_MAX_SEQUENCE_DEPTH) throw new Error('嵌套声音存在循环或超过可混音层数。')
    const known = cached.get(sequence.id)
    if (known !== undefined) return known
    const index = sequences.length
    cached.set(sequence.id, index); sequences.push(null)
    const windows = (sequence.transitions ?? []).filter(transition => videoEditTransitionMedium(transition.kind) === 'audio').flatMap((transition): VideoEditTransitionWindow[] => {
      // The mixer also ignores windows made invalid by a filtered clip selection.
      try { return [videoEditTransitionWindow(sequence, transition)] } catch { return [] }
    })
    const result = { fps: sequence.fps, sampleRate: sequence.sampleRate, channels: sequence.channels,
      clips: audibleVideoEditClips(sequence).map(clip => {
        const nested = videoEditNestedComposition(sequence, clip)
        const media = nested ? undefined : videoEditClipMedia(sequence, clip)
        return {
          start: clip.start, duration: clip.duration, sourceInUs: clip.sourceInUs, sourceRemainder: clip.sourceRemainder,
          speed: clip.speed ?? { numerator: 1, denominator: 1 }, reverse: clip.reverse ?? false, preservePitch: clip.preservePitch ?? false,
          volume: clip.disabledIntrinsicSections?.includes('audio') ? 1 : clip.volume, volumeCurve: points(clip.disabledIntrinsicSections?.includes('audio') ? undefined : clip.curves?.volume), fadeInFrames: clip.fadeInFrames ?? 0, fadeOutFrames: clip.fadeOutFrames ?? 0,
          audioMapping: clip.audioMapping,
          effects: activeVideoEditAudioEffects(clip).map(effect => ({ id: effect.builtin.id, amount: effect.amount, params: effect.builtin.params,
            curves: Object.fromEntries(Object.entries(effect.builtin.curves ?? {}).map(([key, values]) => [key, points(values)])) })),
          transitions: windows.filter(window => window.left.id === clip.id && window.side !== 'in' || window.right.id === clip.id && window.side !== 'out').map(window => ({
            kind: window.transition.kind, start: window.start, end: window.end, side: window.side, outgoing: window.left.id === clip.id,
          })),
          source: nested ? { duration: videoEditDuration(nested) / nested.fps, sound: content(nested, [...path, sequence.id]) }
            : media ? { path: media.path, durationSeconds: media.durationSeconds, sourceRevision: media.sourceRevision, assetContent: media.assetContent } : null,
        }
      }),
    }
    sequences[index] = result
    return index
  }
  content(snapshot, [])
  return JSON.stringify(canonical(sequences))
}
