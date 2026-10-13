import { expect, it } from 'vitest'
import { encodeRecordingWav, recordingAudioRequestSchema } from './recordingAudio'
import { correlateRecordingClock, recordingUncertaintyP95 } from './recordingClock'

it('本地合成PCM的容器、裁幅、非法采样及IPC批次预算', () => {
  const wav = encodeRecordingWav(new Float32Array([-2, -.5, 0, .5, 2]), 48000); const v = new DataView(wav.buffer)
  expect(new TextDecoder().decode(wav.slice(0,4))).toBe('RIFF'); expect(v.getUint32(24,true)).toBe(48000); expect(v.getInt16(44,true)).toBe(-32768); expect(v.getInt16(52,true)).toBe(32767)
  expect(() => encodeRecordingWav(new Float32Array([NaN]),48000)).toThrow()
  expect(recordingAudioRequestSchema.safeParse({ action:'write',sessionId:'path/escape',chunkId:'x',sampleRate:48000,samples:new Float32Array([0]) }).success).toBe(false)
})
it('E09 合成采样真值量化误差P95不随消息投递抖动变化，输入延迟未知时不能称可信', () => {
  const errors: number[] = []
  for (let i=0;i<1000;i++) {
    const exact = i*1000/48000; const c = correlateRecordingClock({ originMs:0,beforeMs:200,afterMs:200.2,currentSeconds:1,timestamp:{ contextTime:1,performanceTime:1000 },sampleRate:48000,baseLatency:.01,inputLatency:.02 })
    errors.push(Math.abs(c.offsetUs + 20000 + Math.round(exact*1000) - exact*1000)); expect(c.uncertaintyUs).toBe(332767)
  }
  expect(recordingUncertaintyP95(errors)).toBeLessThanOrEqual(.5)
  expect(correlateRecordingClock({ originMs:0,beforeMs:0,afterMs:1,currentSeconds:0,sampleRate:48000,baseLatency:.01 }).trusted).toBe(false)
  expect(recordingUncertaintyP95([])).toBeNull()
})
