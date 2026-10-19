import { expect, it, vi } from 'vitest'
import { AudioContentAnalyzer } from '@/core/audioAnalysis/contentAnalysis'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { VideoEditContentAudio } from './videoEditContentAudio'
import { codeAudioComposition } from '@/core/videoEdit/codeAudio'
import { codeMediaInputComposition, codeMediaFrameParameters, codeMediaInputKey } from './videoEditCodeMediaInput'

vi.mock('../application/videoEditBeatWorkerClient', () => ({ analyzeVideoEditBeatsOffThread: async (rate: number, blocks: AsyncIterable<Float32Array[]>, signal: AbortSignal, fps: number) => {
  const analyzer = new AudioContentAnalyzer(rate, fps)
  for await (const planes of blocks) { signal.throwIfAborted(); analyzer.append(planes) }
  signal.throwIfAborted(); return analyzer.finish()
} }))
function fixture() {
  const document = createVideoEditTestDocument('内容联动')
  const composition = videoEditComposition(document, document.sequences[0].id)
  const clip: VideoEditClip = { id: 'code', itemId: 'code', name: '代码', kind: 'code', track: 3, start: 60, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
  composition.media = [{ id: 'movie', kind: 'video', name: '视频', path: 'D:/movie.mp4', width: 64, height: 64, durationSeconds: 10, sourceRevision: 'a' }]
  composition.items = [{ id: 'movie-item', name: '视频', kind: 'video', mediaId: 'movie' }]
  composition.clips = [clip, { ...clip, id: 'lower', itemId: 'movie-item', track: 1, kind: 'video' }, { ...clip, id: 'upper', track: 4 }]
  return { composition, clip }
}
it('按内容、混音配置与区间缓存，命中不再解码；进度与释放完整', async () => {
  const { composition } = fixture(), mix = vi.fn(async (_start: number, duration: number) => [new Float32Array(Math.round(duration * composition.sampleRate)).fill(.25)]), dispose = vi.fn(async () => {})
  const create = vi.fn(() => ({ mixAudio: mix, dispose })), service = new VideoEditContentAudio(create), progress: number[] = []
  const signal = new AbortController().signal
  const first = await service.analyze(composition, 0, 2, signal, value => progress.push(value))
  expect(await service.analyze(structuredClone(composition), 0, 2, signal)).toBe(first)
  expect(create).toHaveBeenCalledTimes(1); expect(mix).toHaveBeenCalledTimes(2); expect(dispose).toHaveBeenCalledTimes(1)
  expect(progress).toEqual([.5, 1]); expect(first.levels.every(value => value === .25)).toBe(true)
  await service.analyze(composition, 1, 1, signal)
  await service.analyze({ ...composition, media: [{ ...composition.media[0], sourceRevision: 'b' }] }, 0, 2, signal)
  expect(create).toHaveBeenCalledTimes(3)
})
it('取消、失败均不入缓存，释放资源；无声音正常完成', async () => {
  const { composition } = fixture(), dispose = vi.fn(async () => {}), controller = new AbortController()
  const mix = vi.fn(async (_start: number, duration: number) => { controller.abort(new Error('取消')); return [new Float32Array(Math.round(duration * composition.sampleRate))] })
  const service = new VideoEditContentAudio(() => ({ mixAudio: mix, dispose }))
  await expect(service.analyze(composition, 0, 1, controller.signal)).rejects.toThrow('取消')
  mix.mockRejectedValueOnce(new Error('解码失败'))
  await expect(service.analyze(composition, 0, 1, new AbortController().signal)).rejects.toThrow('解码失败')
  mix.mockImplementation(async (_start, duration) => [new Float32Array(Math.round(duration * composition.sampleRate))])
  expect(await service.analyze(composition, 0, 1, new AbortController().signal)).toMatchObject({ bpm: 0, beats: [], onsets: [] })
  expect(dispose).toHaveBeenCalledTimes(3)
})
it('音频默认只取下方轨道，指定媒体去掉片段处理；视频时间不量化到序列帧', () => {
  const { composition, clip } = fixture()
  expect(codeAudioComposition(composition, clip).document.clips.map(clip => clip.id)).toEqual(['lower'])
  const explicit = codeAudioComposition(composition, clip, 'movie')
  expect(explicit.start).toBe(0); expect(explicit.duration).toBe(10)
  expect(explicit.document.clips[0]).toMatchObject({ volume: 1, start: 0, sourceInUs: 0 })
  const frame = clip.start + 3
  const follow = codeMediaInputComposition(composition, clip, { kind: 'video', mediaId: 'movie' }, frame)
  expect(follow.document.clips[0].sourceInUs).toBe(Math.floor(3 / composition.fps * 1e6))
  const fixed = codeMediaInputComposition(composition, clip, { kind: 'video', mediaId: 'movie', time: .123456 }, frame)
  expect(fixed.document.clips[0].sourceInUs).toBe(123456)
  expect(fixed.document.width).toBe(64)
  expect(() => codeMediaInputComposition(composition, clip, { kind: 'video', mediaId: 'movie', time: 12 }, frame)).toThrow('超出')
  expect(codeMediaInputComposition(composition, clip, { kind: 'sequence', mediaId: 'below' }, frame).document.clips.map(clip => clip.id)).toEqual(['lower'])
  expect(codeMediaFrameParameters(clip, { input: { kind: 'video', mediaId: 'movie' } })).toEqual({ input: { kind: 'image', mediaId: codeMediaInputKey(clip.id, 'input') } })
})
it('visual-only changes reuse completed sound analysis while audible gain changes invalidate it', async () => {
  const { composition } = fixture(), create = vi.fn(() => ({ mixAudio: async (_start: number, duration: number) => [new Float32Array(Math.round(duration * composition.sampleRate)).fill(.25)], dispose: async () => {} }))
  const service = new VideoEditContentAudio(create), signal = new AbortController().signal
  const original = await service.analyze(composition, 0, 1, signal)
  const visual = { ...composition, revision: composition.revision + 1, clips: composition.clips.map(clip => ({ ...clip, x: .9, rotation: 45 })) }
  expect(await service.analyze(visual, 0, 1, signal)).toBe(original)
  expect(create).toHaveBeenCalledOnce()
  await service.analyze({ ...visual, clips: visual.clips.map(clip => ({ ...clip, volume: .5 })) }, 0, 1, signal)
  expect(create).toHaveBeenCalledTimes(2)
})
it('cancels a pending real mixer call immediately, disposes once and ignores its late PCM instead of caching it', async () => {
  const { composition } = fixture(), controller = new AbortController()
  let accept!: (planes: Float32Array[]) => void
  const dispose = vi.fn(async () => {}), mix = vi.fn(() => new Promise<Float32Array[]>(resolve => { accept = resolve }))
  const service = new VideoEditContentAudio(() => ({ mixAudio: mix, dispose }))
  const pending = service.analyze(composition, 0, 1, controller.signal)
  const rejected = expect(pending).rejects.toThrow('中止等待混音')
  controller.abort(new Error('中止等待混音')); await rejected
  expect(dispose).toHaveBeenCalledOnce()
  accept([new Float32Array(composition.sampleRate).fill(.8)])
  mix.mockImplementation(async () => [new Float32Array(composition.sampleRate).fill(.25)])
  const fresh = await service.analyze(composition, 0, 1, new AbortController().signal)
  expect(fresh.levels.every(value => value === .25)).toBe(true); expect(mix).toHaveBeenCalledTimes(2)
})
