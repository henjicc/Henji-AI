import { videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { screenAttentionSettingsSchema } from '@/core/videoEdit/screenAttention'
import type { RecordingMovieRecipe } from '@/core/screenRecording/movie'
import { analyzeVideoEditScreenAttentionOffThread } from '@/features/videoEdit'

/** Same attention pass for editable movies and detached product compositions. */
export async function applyRecordingMovieAttention(draft: VideoEditDocument, sequenceIds: readonly string[], strength: RecordingMovieRecipe['attention'], signal: AbortSignal, current: () => void): Promise<void> {
  if (strength === 'off') return
  for (const id of sequenceIds) {
    const sequence = draft.sequences.find(sequence => sequence.id === id)!
    for (let index = 0; index < sequence.clips.length; index++) {
      current()
      const clip = sequence.clips[index], composition = videoEditComposition(draft, id)
      composition.clips = [clip]
      composition.media = composition.media.filter(media => draft.items.some(item => item.id === clip.itemId && item.mediaId === media.id))
      composition.sequences = []
      sequence.clips[index] = (await analyzeVideoEditScreenAttentionOffThread({ composition, clipId: clip.id, target: { width: sequence.width, height: sequence.height }, settings: screenAttentionSettingsSchema.parse({ strength }) }, signal)).clip
    }
  }
}
