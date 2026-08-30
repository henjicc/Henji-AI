import type {
  SpeechRecognitionOutput,
  SpeechRecognitionSegment,
  SpeechRecognitionWord,
} from '..'
import { AiRuntimeError } from '../../../runtime/AiRuntimeError'

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function words(value: unknown): readonly SpeechRecognitionWord[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new AiRuntimeError('invalid_response', 'Volcengine file ASR utterance words must be an array')
  }
  const parsed = value.flatMap((entry): SpeechRecognitionWord[] => {
    const item = record(entry)
    if (!item) return []
    const text = item.text
    if (typeof text !== 'string' || !text.trim()) return []
    return [{
      text,
      startMs: finiteNumber(item.start_time),
      endMs: finiteNumber(item.end_time),
    }]
  })
  return parsed.length ? parsed : undefined
}

function segments(value: unknown): readonly SpeechRecognitionSegment[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new AiRuntimeError('invalid_response', 'Volcengine file ASR result.utterances must be an array')
  }
  const parsed = value.flatMap((entry): SpeechRecognitionSegment[] => {
    const item = record(entry)
    if (!item) return []
    const text = item.text
    if (typeof text !== 'string' || !text.trim()) return []
    return [{
      text,
      startMs: finiteNumber(item.start_time),
      endMs: finiteNumber(item.end_time),
      words: words(item.words),
    }]
  })
  return parsed.length ? parsed : undefined
}

export function parseVolcengineFileTranscript(
  payload: unknown,
  metadata: { taskId: string; logId?: string }
): SpeechRecognitionOutput {
  const root = record(payload)
  const result = record(root?.result)
  const audioInfo = record(root?.audio_info)
  if (!result) {
    throw new AiRuntimeError('invalid_response', 'Volcengine file ASR response has no result object')
  }
  const text = result?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw new AiRuntimeError('invalid_response', 'Volcengine file ASR response has no transcript text')
  }
  return {
    text,
    durationMs: finiteNumber(audioInfo?.duration),
    segments: segments(result.utterances),
    providerMetadata: {
      taskId: metadata.taskId,
      ...(metadata.logId ? { logId: metadata.logId } : {}),
    },
  }
}
