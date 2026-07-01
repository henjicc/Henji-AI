import { extractAudioSamples } from '../services/audio/ops'
import type { ExtractAudioSamplesResultDto } from '../services/audio/types'
import { parseRecord, registerIpcHandler } from './registry'

interface ExtractAudioSamplesPayload {
  source: string
  bucketCount: number
}

export function registerAudioIpc(): void {
  registerIpcHandler<ExtractAudioSamplesPayload, ExtractAudioSamplesResultDto>(
    'audio:extractSamples',
    parseExtractAudioSamplesPayload,
    ({ source, bucketCount }) => extractAudioSamples(source, bucketCount)
  )
}

function parseExtractAudioSamplesPayload(input: unknown): ExtractAudioSamplesPayload {
  const record = parseRecord(input)
  return {
    source: readString(record, 'source'),
    bucketCount: readNumber(record, 'bucketCount'),
  }
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field "${field}"`)
  }
  return value
}

function readNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number field "${field}"`)
  }
  return value
}
