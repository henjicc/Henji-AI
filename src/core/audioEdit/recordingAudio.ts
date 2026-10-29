import { z } from 'zod'
import type { TimestampedTranscript } from './timestampedTranscript'

const id = z.uuid()
// 超级关键帧沿用正式草稿关联身份，音频块与付费请求仍必须是 UUID。
export const recordingAudioSessionIdSchema = z.union([id, z.templateLiteral(['super-keyframes:', id])])
const scope = { sessionId: recordingAudioSessionIdSchema, chunkId: id }
export const recordingAudioRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('write'), ...scope, sampleRate: z.number().int().min(8000).max(192000), samples: z.custom<Float32Array>(v => v instanceof Float32Array && v.length > 0 && v.byteLength <= 8 * 1024 * 1024) }).strict(),
  z.object({ action: z.literal('read'), ...scope }).strict(),
  z.object({ action: z.literal('erase'), sessionId: recordingAudioSessionIdSchema }).strict(),
  z.object({ action: z.literal('release'), sessionId: recordingAudioSessionIdSchema }).strict(),
  z.object({ action: z.literal('archive'), sessionId: recordingAudioSessionIdSchema }).strict(),
  z.object({ action: z.literal('restore'), sessionId: recordingAudioSessionIdSchema, path: z.string().min(1), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ action: z.literal('transcribe'), ...scope, modelId: z.string().min(1), requestId: id, resume: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('preflight'), ...scope, modelId: z.string().min(1), requestId: id, resume: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('cancel'), sessionId: recordingAudioSessionIdSchema }).strict(),
])
export type RecordingAudioRequest = z.infer<typeof recordingAudioRequestSchema>
export interface RecordingAudioResult { transcript: TimestampedTranscript; modelId: string; providerId: string; requestId: string }
export interface RecordingAudioPlatform {
  write(input: Extract<RecordingAudioRequest, { action: 'write' }>): Promise<void>
  read(sessionId: string, chunkId: string): Promise<Uint8Array>
  erase(sessionId: string): Promise<void>
  release(sessionId: string): Promise<void>
  archive(sessionId: string): Promise<{ path: string; digest: string; bytes: number }>
  restore(input: Extract<RecordingAudioRequest, { action: 'restore' }>): Promise<void>
  transcribe(input: Extract<RecordingAudioRequest, { action: 'transcribe' }>): Promise<RecordingAudioResult>
  preflight(input: Extract<RecordingAudioRequest, { action: 'preflight' }>): Promise<void>
  cancel(sessionId: string): Promise<void>
}
/** Standard PCM16 WAV container; no DSP/resampling and no arrival timestamps. */
export function encodeRecordingWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2); const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string): void => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) { if (!Number.isFinite(samples[i])) throw new Error('录音采样无效。'); const v = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true) }
  return bytes
}
