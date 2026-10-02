import { describe, expect, it } from 'vitest'

import { detectMediaFormat } from './format'

describe('detectMediaFormat', () => {
  it('识别图片、视频和音频签名', () => {
    expect(detectMediaFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'a.png').kind).toBe('image')
    expect(detectMediaFormat(Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), 'a.mp4').kind).toBe('video')
    expect(detectMediaFormat(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0]), 'a.mp3').kind).toBe('audio')
  })

  it('识别专业与广播封装：MXF、MPEG 节目流、传输流', () => {
    const mxf = Uint8Array.from([0x06, 0x0e, 0x2b, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0d, 0x01, 0x02, 0x01, 0x01, 0x02])
    expect(detectMediaFormat(mxf, 'a.MXF')).toEqual({ kind: 'video', mimeType: 'application/mxf', extension: 'mxf' })
    expect(detectMediaFormat(Uint8Array.from([0, 0, 1, 0xba, 0x44]), 'a.mpg').extension).toBe('mpg')
    expect(detectMediaFormat(Uint8Array.from([0, 0, 1, 0xb3, 0x78]), 'a.mpeg').extension).toBe('mpeg')
    const bdav = new Uint8Array(64); bdav[4] = 0x47
    expect(detectMediaFormat(bdav, 'a.m2ts')).toEqual({ kind: 'video', mimeType: 'video/mp2t', extension: 'm2ts' })
    expect(detectMediaFormat(Uint8Array.from([0x47, 0x40, 0x00]), 'a.mts').extension).toBe('mts')
    expect(() => detectMediaFormat(bdav, 'a.mp4')).toThrow('Unsupported or disguised media file')
    expect(() => detectMediaFormat(mxf, 'a.png')).toThrow('Unsupported or disguised media file')
  })

  it('拒绝扩展名与内容类型伪装', () => {
    expect(() => detectMediaFormat(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0]), 'fake.png'))
      .toThrow('Unsupported or disguised media file')
  })
})
