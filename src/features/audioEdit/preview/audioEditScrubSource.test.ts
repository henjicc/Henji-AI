import { beforeEach, expect, it, vi } from 'vitest'
import type { AudioEffectInstance } from '@/core/audio/effects/audioEffectChain'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { audioEditScrubSource } from './audioEditScrubSource'
import { PreviewChunkCache } from './previewChunkCache'

const { prepare, chain } = vi.hoisted(() => ({ prepare: vi.fn(), chain: { reset: vi.fn(async () => undefined), locate: vi.fn(), process: vi.fn(), dispose: vi.fn(), latency: 0 } }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioEdit: { preparePreviewChunk: prepare } }) }))
vi.mock('../application/audioEditProjectInstances', () => ({ flushAudioEditProject: async () => undefined }))
vi.mock('@/core/audio/effects/audioEffectChain', () => ({ AudioEffectChain: class { constructor() { return chain } } }))

const project: AudioEditProjectDocument = {
  id: 'scrub', name: '擦洗', referenceScript: '', suggestions: [], transcript: [], createdAt: 1, updatedAt: 1, revision: 1,
  source: { mediaType: 'audio', sourcePath: 'a.wav', audioPath: 'a.wav', durationFrames: 48000 * 10, sampleRate: 48000, channels: 2 },
}
const span = (start: number, end: number, output: number) => ({ sourceStartFrame: start, sourceEndFrame: end, outputStartFrame: output, outputEndFrame: output + end - start })
beforeEach(() => {
  chain.reset.mockClear(); chain.locate.mockClear(); chain.process.mockClear(); chain.latency = 0
  prepare.mockReset().mockImplementation(async ({ sourceStartFrame, frameCount }) => ({
    sourceStartFrame, sourceEndFrame: sourceStartFrame + frameCount, channels: 2, sampleRate: 48000,
    pcm: Float32Array.from({ length: frameCount * 2 }, (_, i) => (i % 2 ? -1 : 1) * (sourceStartFrame + Math.floor(i / 2))).buffer,
  }))
})

it('剪后试听按成片时间读声音：删掉的部分不占位置，播放头源帧换成擦洗位置；左右声道各自成平面', async () => {
  const spans = [span(0, 48000, 0), span(96000, 480000, 48000)]
  const source = audioEditScrubSource(project, 'edited', spans, new PreviewChunkCache(project, 'edited', spans), [])
  expect(source.frames).toBe(48000 + 384000)
  expect(source.seconds(96000 + 24000)).toBe(1.5)
  expect(source.seconds(60000)).toBe(1) // 落在删掉的部分：吸到后一段开头
  // 成片时间 1 秒之前是源 0..1 秒，之后接源 2 秒起（删除点两侧的拼接淡化与正常播放同一个渲染器）
  const [left, right] = await source.read(24000, 2)
  expect(Array.from(left)).toEqual([24000, 24001]); expect(Array.from(right)).toEqual([-24000, -24001])
  expect(Array.from((await source.read(48000 + 24000, 2))[0])).toEqual([120000, 120001])
  const spliced = new PreviewChunkCache(project, 'edited', spans)
  const across = await source.read(47000, 2000), expected = await spliced.readSequence(47000, 2000)
  expect(Array.from(across[0])).toEqual(Array.from(expected.filter((_, i) => i % 2 === 0)))
  const original = audioEditScrubSource(project, 'source', [span(0, 480000, 0)], new PreviewChunkCache(project, 'source', [span(0, 480000, 0)]), [])
  expect(original.seconds(120000)).toBe(2.5)
  expect(Array.from((await original.read(120000, 3))[0])).toEqual([120000, 120001, 120002])
})

it('有实时效果时每块重置效果链、预读一小段并扣掉延迟，听到的与播放经过同一套效果', async () => {
  chain.latency = 4
  const spans = [span(0, 480000, 0)]
  const effects = [{ id: 'eq', builtin: { id: 'eq_bands', params: {} }, amount: 1 }] as unknown as AudioEffectInstance[]
  const source = audioEditScrubSource(project, 'edited', spans, new PreviewChunkCache(project, 'edited', spans), effects)
  expect(source.concurrency).toBe(1)
  const [left] = await source.read(96000, 100)
  expect(chain.reset).toHaveBeenCalledWith(effects)
  const preroll = Math.round(0.3 * 48000)
  expect(chain.locate).toHaveBeenCalledWith(96000 - preroll)
  expect(chain.process.mock.calls[0][1]).toBe(preroll + 100 + 4)
  // 效果链替身不改声音：输出从预读与延迟之后开始，正好是请求的起点
  expect(left[0]).toBe(96000 + 4)
  source.dispose()
  expect(chain.dispose).toHaveBeenCalled()
})
