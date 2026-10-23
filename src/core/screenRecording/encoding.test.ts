import { describe, expect, it } from 'vitest'
import { recordingEncoding } from './encoding'
import { recordingOutput } from '../../services/recordingSetupModel'

describe('录制编码默认值', () => {
  it.each([
    ['1080p', 30, 12], ['1080p', 60, 18], ['1440p', 30, 20], ['1440p', 60, 28], ['2160p', 30, 28], ['2160p', 60, 40],
  ] as const)('%s/%s 默认 H.264 %s Mbps，HEVC 为七成', (quality, fps, mbps) => {
    expect(recordingOutput({ quality, fps })).toMatchObject({ fps, bitrate: mbps * 1e6, codec: 'h264', encoder: 'auto', keyframeFrames: 30, rateControl: 'quality' })
    expect(recordingOutput({ quality, fps, codec: 'hevc' }).bitrate).toBe(Math.round(mbps * .7 * 1e6))
  })
  it('保留用户覆盖，自定义分辨率按像素所属档位解析', () => {
    expect(recordingEncoding({ width: 1280, height: 720, fps: 60 })).toMatchObject({ bitrate: 18e6 })
    expect(recordingOutput({ quality: '2160p', fps: 60, bitrate: 8e6, rateControl: 'cbr', keyframeFrames: 10, codec: 'hevc', encoder: 'software' })).toMatchObject({ bitrate: 8e6, rateControl: 'cbr', keyframeFrames: 10, codec: 'hevc', encoder: 'software' })
  })
})
