import { beforeEach, expect, it, vi } from 'vitest'
import type { AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'
import { decodeSpeechEnergy } from './speech-energy'
import { runAudioEditProcess } from './process'

vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: vi.fn(async () => 'ffmpeg') }))
vi.mock('./process', () => ({ runAudioEditProcess: vi.fn() }))
const source: AudioEditSourceMetadata = { sourcePath: 'voice.wav', audioPath: 'voice.wav', sampleRate: 16000, durationFrames: 4800, channels: 2, mediaType: 'audio', ownership: 'external', audioStreamIndex: 1 }
function levels(line: (value: string) => void): void {
  for (let index = 0; index < 30; index++) {
    line(`[ametadata@wide @ 123] lavfi.astats.Overall.RMS_level=${index < 10 || index >= 20 ? -20 : -80}`)
    line('[ametadata@wide @ 123] lavfi.astats.Overall.Number_of_samples=160')
    line(`[ametadata@high @ 456] lavfi.astats.Overall.RMS_level=${index < 10 || index >= 20 ? -40 : -100}`)
  }
}
beforeEach(() => { vi.mocked(runAudioEditProcess).mockReset(); vi.mocked(runAudioEditProcess).mockImplementation(async (_binary, _args, _signal, onLine) => { levels(onLine!); return '' }) })

it('只返回真实全频和高频共同低谷，不做时间线或文档写入', async () => {
  const result = await decodeSpeechEnergy(source, {}, new AbortController().signal, () => undefined)
  expect(result.pauses).toEqual([{ startMs: 100, endMs: 200, cutMs: 150 }])
})

it('超过六小时的输入在解码前拒绝', async () => {
  await expect(decodeSpeechEnergy({ ...source, durationFrames: 7 * 3600 * 16000 }, {}, new AbortController().signal, () => undefined)).rejects.toThrow('六小时')
  expect(runAudioEditProcess).not.toHaveBeenCalled()
})

it('提前取消不解码，缺失高频证据拒绝输出可剪切静音', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(decodeSpeechEnergy(source, {}, controller.signal, () => undefined)).rejects.toThrow()
  expect(runAudioEditProcess).not.toHaveBeenCalled()
  vi.mocked(runAudioEditProcess).mockImplementationOnce(async (_binary, _args, _signal, onLine) => { onLine!('[ametadata@wide @ 123] lavfi.astats.Overall.RMS_level=-inf'); return '' })
  await expect(decodeSpeechEnergy(source, {}, new AbortController().signal, () => undefined)).rejects.toThrow('完整')
})
