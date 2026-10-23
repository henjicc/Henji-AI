import { z } from 'zod'

const errorSchema = z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() })
export const nativeAudioMessageSchema = z.object({
  id: z.string().optional(), ok: z.boolean().optional(), result: z.unknown().optional(), error: errorSchema.optional(),
  event: z.enum(['level', 'samples', 'interrupted']).optional(), binaryBytes: z.number().int().min(0).max(8192),
}).passthrough()
export type NativeAudioMessage = z.infer<typeof nativeAudioMessageSchema>
export class AudioCaptureError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = code } }

/** 分片输入有上界，不能把半帧误当 JSON 或把任意长度分配到内存。 */
export class AudioCaptureFrameReader {
  private buffer = Buffer.alloc(0)
  push(chunk: Buffer, receive: (message: NativeAudioMessage, binary: Buffer) => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (length < 2 || length > 1_048_576) throw new AudioCaptureError('PROTOCOL_ERROR', '录音服务帧长度无效')
      if (this.buffer.length < 4 + length) break
      const message = nativeAudioMessageSchema.parse(JSON.parse(this.buffer.subarray(4, 4 + length).toString('utf8')) as unknown)
      const total = 4 + length + message.binaryBytes
      if (this.buffer.length < total) break
      const binary = Buffer.from(this.buffer.subarray(4 + length, total))
      this.buffer = this.buffer.subarray(total)
      receive(message, binary)
    }
    if (this.buffer.length > 1_060_000) throw new AudioCaptureError('PROTOCOL_ERROR', '录音服务数据超出上限')
  }
}
export function correlateNativeClock(beforeUs: number, afterUs: number, nativeUs: number): { offsetUs: number; uncertaintyUs: number } {
  if (![beforeUs, afterUs, nativeUs].every(Number.isFinite) || afterUs < beforeUs) throw new AudioCaptureError('CLOCK_ERROR', '录音时钟校准失败')
  return { offsetUs: (beforeUs + afterUs) / 2 - nativeUs, uncertaintyUs: (afterUs - beforeUs) / 2 }
}
