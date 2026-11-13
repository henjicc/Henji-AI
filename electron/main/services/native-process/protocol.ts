import { z } from 'zod'

/**
 * 自研原生进程（录音、画面采集）共用的协议约定：标准输入一行一条 JSON 指令；标准输出 `u32 小端 JSON 字节数` + JSON +
 * `binaryBytes` 字节二进制；应答 `{id, ok, result | error}`，事件 `{event, ...}`。
 */
export class NativeProcessError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = code } }
export const nativeErrorSchema = z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() })
export interface NativeProcessMessage { id?: string; ok?: boolean; result?: unknown; error?: z.infer<typeof nativeErrorSchema>; event?: string; binaryBytes: number }

/** 分片输入有上界，不能把半帧误当 JSON 或把任意长度分配到内存。 */
export class NativeFrameReader<T extends NativeProcessMessage> {
  private buffer = Buffer.alloc(0)
  constructor(private readonly schema: z.ZodType<T>, private readonly service: string) {}
  push(chunk: Buffer, receive: (message: T, binary: Buffer) => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (length < 2 || length > 1_048_576) throw new NativeProcessError('PROTOCOL_ERROR', `${this.service}帧长度无效`)
      if (this.buffer.length < 4 + length) break
      const message = this.schema.parse(JSON.parse(this.buffer.subarray(4, 4 + length).toString('utf8')) as unknown)
      const total = 4 + length + message.binaryBytes
      if (this.buffer.length < total) break
      const binary = Buffer.from(this.buffer.subarray(4 + length, total))
      this.buffer = this.buffer.subarray(total)
      receive(message, binary)
    }
    if (this.buffer.length > 1_060_000) throw new NativeProcessError('PROTOCOL_ERROR', `${this.service}数据超出上限`)
  }
}

/** 原生单调时钟与主进程时钟的对应：取往返中点，误差是往返的一半；不用墙上时间。 */
export function correlateNativeClock(beforeUs: number, afterUs: number, nativeUs: number): { offsetUs: number; uncertaintyUs: number } {
  if (![beforeUs, afterUs, nativeUs].every(Number.isFinite) || afterUs < beforeUs) throw new NativeProcessError('CLOCK_ERROR', '原生时钟校准失败')
  return { offsetUs: (beforeUs + afterUs) / 2 - nativeUs, uncertaintyUs: (afterUs - beforeUs) / 2 }
}
