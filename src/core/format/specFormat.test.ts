import { describe, expect, it } from 'vitest'
import { formatFileSize, formatFrameRate, formatSampleRate, formatResolutionText, videoCodecLabel } from './specFormat'

describe('界面规格写法', () => {
  it('文件大小按 1024 进位，10 以下留一位小数', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1.4 * 1024 ** 3)).toBe('1.4 GB')
    expect(formatFileSize(346 * 1024 ** 2)).toBe('346 MB')
    expect(formatFileSize(2 * 1024 ** 2)).toBe('2 MB')
  })

  it('帧率、采样率去掉多余小数，编码与分辨率按写法表', () => {
    expect(formatFrameRate(30000 / 1001)).toBe('29.97 帧/秒')
    expect(formatFrameRate(60, 'compact')).toBe('60fps')
    expect(formatSampleRate(44100)).toBe('44.1 kHz')
    expect(videoCodecLabel('hevc')).toBe('H.265')
    expect(formatResolutionText('最高 1080p，4k 另计；yuv420p 不变')).toBe('最高 1080P，4K 另计；yuv420p 不变')
  })
})
