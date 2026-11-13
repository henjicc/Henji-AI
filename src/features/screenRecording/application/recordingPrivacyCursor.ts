import type { RecordingMedia } from '@/core/screenRecording/document'
import { recordingMediaEndUs } from '@/core/screenRecording/range'
import type { CaptureEvent } from '@/core/captureLog/events'
import type { OcrPrivacyRequest } from '@/platform/contracts/ocrPrivacy'

/** Sample the last known pointer at each OCR instant, including across event pages and recording pauses. */
export function recordingPrivacyCursor(media: readonly Pick<RecordingMedia, 'monoUs' | 'durationUs' | 'gaps'>[]) {
  const spans = [...media].sort((a, b) => a.monoUs - b.monoUs)
  const samples: NonNullable<OcrPrivacyRequest['cursor']> = []
  let index = 0, next = spans[0]?.monoUs ?? Infinity, point: [number, number] | null = null
  const emitBefore = (time: number): void => {
    while (next < time && index < spans.length) {
      samples.push({ monoUs: next, point })
      next += 100000
      if (next >= recordingMediaEndUs(spans[index])) next = spans[++index]?.monoUs ?? Infinity
    }
  }
  return {
    append(event: CaptureEvent): void {
      if (event.kind !== 'cursor') return
      emitBefore(event.monoUs)
      point = event.shape === 'hidden' ? null : event.point
    },
    finish(): NonNullable<OcrPrivacyRequest['cursor']> { emitBefore(Infinity); return samples },
  }
}
