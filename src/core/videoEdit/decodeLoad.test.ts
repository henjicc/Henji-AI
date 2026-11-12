import { describe, expect, it } from 'vitest'
import { VIDEO_EDIT_DEFAULT_DECODE_CAPACITY, videoEditDecodeCost, videoEditHardwareDecodable, videoEditLearnDecodeCapacity, type VideoEditDecodeStream } from './decodeLoad'

const uhd = (codec: string, megabits: number, extra: Partial<VideoEditDecodeStream> = {}): VideoEditDecodeStream => ({ codec, width: 3840, height: 2160, fps: 60, bitRate: megabits * 1e6, bitDepth: 8, chroma: '4:2:0', ...extra })

describe('实时播放解码负载', () => {
  it('四个实测点的相对吞吐由模型复现（参考路 = H.264 150Mbps 约 220 帧/秒）', () => {
    // 代价之比 = 参考路吞吐 / 该素材吞吐。
    for (const [stream, fps] of [[uhd('h264', 150), 220], [uhd('h264', 50), 260], [uhd('hevc', 150), 255], [uhd('hevc', 50), 470], [uhd('hevc', 50, { bitDepth: 10 }), 470]] as const) {
      expect(videoEditDecodeCost(stream)).toBeCloseTo(220 / fps, 1)
    }
  })

  it('多机位 4 路 4K60 H.264 原片加节目画面判为带不动；同样 4 路 HEVC 50Mbps 带得动', () => {
    const load = (stream: VideoEditDecodeStream, cameras: number): number => videoEditDecodeCost(stream) * (cameras + 1)
    expect(load(uhd('h264', 150), 4)).toBeGreaterThan(VIDEO_EDIT_DEFAULT_DECODE_CAPACITY)
    expect(load(uhd('h264', 150), 2)).toBeLessThanOrEqual(VIDEO_EDIT_DEFAULT_DECODE_CAPACITY)
    expect(load(uhd('hevc', 50), 4)).toBeLessThanOrEqual(VIDEO_EDIT_DEFAULT_DECODE_CAPACITY)
    // 1080p 代理很轻：4 路代理加节目原片也带得动。
    expect(videoEditDecodeCost({ codec: 'h264', width: 1920, height: 1080, fps: 60, bitDepth: 8 }) * 4 + videoEditDecodeCost(uhd('h264', 150))).toBeLessThanOrEqual(VIDEO_EDIT_DEFAULT_DECODE_CAPACITY)
  })

  it('显卡解不了的格式（4:2:2、H.264 10 位）按软解计三倍；码率缺失按参考码率推算', () => {
    expect(videoEditHardwareDecodable(uhd('h264', 150, { bitDepth: 10 }))).toBe(false)
    expect(videoEditHardwareDecodable(uhd('hevc', 150, { chroma: '4:2:2' }))).toBe(false)
    expect(videoEditHardwareDecodable(uhd('hevc', 150, { bitDepth: 10 }))).toBe(true)
    expect(videoEditDecodeCost(uhd('h264', 150, { bitDepth: 10 }))).toBeCloseTo(3 * videoEditDecodeCost(uhd('h264', 150)), 6)
    expect(videoEditDecodeCost(uhd('h264', 150, { bitRate: null }))).toBeCloseTo(1, 6)
  })

  it('估算带得动却明显丢帧时下调能力；丢得少或本来就判为带不动时不变', () => {
    expect(videoEditLearnDecodeCapacity(3, { load: 2.5, droppedRatio: .3 })).toBeCloseTo(2.375, 6)
    expect(videoEditLearnDecodeCapacity(3, { load: 2.5, droppedRatio: .1 })).toBe(3)
    expect(videoEditLearnDecodeCapacity(3, { load: 4, droppedRatio: .6 })).toBe(3)
  })
})
