import { beforeEach, expect, it, vi } from 'vitest'
import type { AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'
import { analyzeSpeechEnergy } from './speech-energy'
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

it('同内容及声道复用分析且返回隔离副本，内容变更或声道改变重新分析', async () => {
  const identified = { ...source, identity: { size: 100, mtimeMs: 1, digest: crypto.randomUUID() } }
  const verify = vi.fn(async () => undefined)
  const analyze = (current = identified, channels?: Array<{ stream: number; channel: number }>) => analyzeSpeechEnergy(current, { channels }, new AbortController().signal, () => undefined, verify)
  const first = await analyze()
  expect(first.pauses).toEqual([{ startMs: 100, endMs: 200, cutMs: 150 }])
  first.pauses.length = 0
  expect((await analyze()).pauses).toHaveLength(1)
  expect(runAudioEditProcess).toHaveBeenCalledTimes(1)
  await analyze(identified, [{ stream: 0, channel: 1 }])
  await analyze({ ...identified, identity: { ...identified.identity, digest: crypto.randomUUID() } })
  expect(runAudioEditProcess).toHaveBeenCalledTimes(3)
  expect(verify).toHaveBeenCalledTimes(3)
})

it('源文件在分析过程中改变时拒绝结果且不污染可复用缓存', async () => {
  const identified = { ...source, identity: { size: 100, mtimeMs: 1, digest: crypto.randomUUID() } }
  await expect(analyzeSpeechEnergy(identified, {}, new AbortController().signal, () => undefined, async () => { throw new Error('原素材内容已改变') })).rejects.toThrow('已改变')
  await analyzeSpeechEnergy(identified, {}, new AbortController().signal, () => undefined, async () => undefined)
  expect(runAudioEditProcess).toHaveBeenCalledTimes(2)
})

it('提前取消不解码，缺失高频证据拒绝输出可剪切静音', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(analyzeSpeechEnergy(source, {}, controller.signal, () => undefined, async () => undefined)).rejects.toThrow()
  expect(runAudioEditProcess).not.toHaveBeenCalled()
  vi.mocked(runAudioEditProcess).mockImplementationOnce(async (_binary, _args, _signal, onLine) => { onLine!('[ametadata@wide @ 123] lavfi.astats.Overall.RMS_level=-inf'); return '' })
  await expect(analyzeSpeechEnergy(source, {}, new AbortController().signal, () => undefined, async () => undefined)).rejects.toThrow('完整')
})
