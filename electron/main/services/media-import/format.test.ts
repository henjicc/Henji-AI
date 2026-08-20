import { describe, expect, it } from 'vitest'

import { detectMediaFormat } from './format'

describe('detectMediaFormat', () => {
  it('识别图片、视频和音频签名', () => {
    expect(detectMediaFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'a.png').kind).toBe('image')
    expect(detectMediaFormat(Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), 'a.mp4').kind).toBe('video')
    expect(detectMediaFormat(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0]), 'a.mp3').kind).toBe('audio')
  })

  it('拒绝扩展名与内容类型伪装', () => {
    expect(() => detectMediaFormat(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0]), 'fake.png'))
      .toThrow('Unsupported or disguised media file')
  })
})
