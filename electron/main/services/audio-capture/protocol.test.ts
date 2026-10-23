import { describe, it, expect } from 'vitest'
import { AudioCaptureFrameReader, correlateNativeClock } from './protocol'

describe('原生录音二进制协议与时钟', () => {
  it('任意分片保留 JSON 和采样字节边界，多个帧不串音', () => {
    const json = Buffer.from(JSON.stringify({ event: 'samples', binaryBytes: 8 }))
    const size = Buffer.alloc(4); size.writeUInt32LE(json.length)
    const frame = Buffer.concat([size, json, Buffer.from([1,2,3,4,5,6,7,8])])
    const reader = new AudioCaptureFrameReader(); const received: number[][] = []
    for (const byte of Buffer.concat([frame, frame])) reader.push(Buffer.from([byte]), (_event, data) => received.push([...data]))
    expect(received).toEqual([[1,2,3,4,5,6,7,8], [1,2,3,4,5,6,7,8]])
    expect(() => new AudioCaptureFrameReader().push(Buffer.from([255,255,255,255]), () => {})).toThrow('帧长度')
  })
  it('时钟使用往返中点且保留不确定度，不使用墙上时间', () => {
    expect(correlateNativeClock(10000, 10200, 1200)).toEqual({ offsetUs: 8900, uncertaintyUs: 100 })
    expect(() => correlateNativeClock(5, 1, 0)).toThrow()
  })
})
