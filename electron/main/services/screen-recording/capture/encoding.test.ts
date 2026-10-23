import { describe, expect, it, vi } from 'vitest'
import { buildGfxCaptureArgs } from './gfxcapture'
import { recordingEncoderProfile } from '../../video/hwaccel'
import { captureOptionsSchema } from '../../../../../src/core/screenRecording/capture'
vi.mock('../../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
const source = { selector: 'hmonitor' as const, handle: '100', width: 3840, height: 2160 }
describe('录制编码参数契约', () => {
  for (const codec of ['h264', 'hevc'] as const) for (const encoder of ['nvidia', 'intel', 'amd', 'apple', 'software'] as const) {
    it.each(['quality', 'vbr', 'cbr'] as const)(`${codec}/${encoder}/%s 保持码率模式、无 B 帧与恒定帧率`, rateControl => {
      const options = captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 3840, height: 2160, fps: 60, bitrate: 20e6, codec, encoder, rateControl })
      const args = buildGfxCaptureArgs(options, source, recordingEncoderProfile(codec, encoder, rateControl), 'screen.mp4')
      const value = (key: string): string | undefined => args[args.indexOf(key) + 1]
      expect(value('-maxrate')).toBe(rateControl === 'vbr' ? '30000k' : '20000k')
      expect(value('-bf')).toBe('0'); expect(value('-g')).toBe('30'); expect(value('-fps_mode')).toBe('cfr')
      if (encoder === 'nvidia') { expect(value('-rc')).toBe(rateControl === 'cbr' ? 'cbr' : 'vbr'); expect(args.includes('-cq')).toBe(rateControl === 'quality') }
      if (encoder === 'software') { expect(value('-preset')).toBe('superfast'); expect(value('-c:v')).toBe(codec === 'hevc' ? 'libx265' : 'libx264'); expect(args.includes('-crf')).toBe(rateControl === 'quality') }
    })
  }
  it.each([10, 15, 30, 60, 120] as const)('关键帧间隔 %s 帧不随帧率改变', keyframeFrames => {
    for (const fps of [30, 60] as const) {
      const options = captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 1920, height: 1080, fps, keyframeFrames })
      const args = buildGfxCaptureArgs(options, source, recordingEncoderProfile('h264', 'nvidia', 'quality'), 'screen.mp4')
      expect(args[args.indexOf('-g') + 1]).toBe(String(keyframeFrames))
    }
  })
  it('自动关键帧：最长 30 帧并开启突变补帧；固定间隔严格关闭突变补帧', () => {
    for (const [keyframeFrames, sceneCut] of [[undefined, true], [60, false]] as const) {
      const options = captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 1920, height: 1080, fps: 60, ...(keyframeFrames ? { keyframeFrames } : {}) })
      const nvenc = buildGfxCaptureArgs(options, source, recordingEncoderProfile('h264', 'nvidia', 'quality', sceneCut), 'screen.mp4')
      expect(nvenc[nvenc.indexOf('-g') + 1]).toBe(sceneCut ? '30' : '60')
      expect(nvenc[nvenc.indexOf('-rc-lookahead') + 1]).toBe(sceneCut ? '20' : '0')
      expect(nvenc.includes('-no-scenecut')).toBe(!sceneCut)
      const x264 = recordingEncoderProfile('h264', 'software', 'quality', sceneCut).buildEncodeArgs(1, 1, 1)
      expect(x264[x264.indexOf('-sc_threshold') + 1]).toBe(sceneCut ? '40' : '0')
      expect(recordingEncoderProfile('hevc', 'software', 'quality', sceneCut).buildEncodeArgs(1, 1, 1).join(' ')).toContain(`scenecut=${sceneCut ? 40 : 0}`)
    }
  })
})
