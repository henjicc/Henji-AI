import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument, addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { createVideoEditSequence, videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { VideoEditDecodeLookahead, videoEditDecodeTargets } from './videoEditDecodeLookahead'
import type { VideoEditNativeFrames } from './videoEditNativeFrameSource'
import { videoEditPictureSeconds } from '@/core/videoEdit/time'

function fixture() {
  const document = createVideoEditTestDocument('前瞻')
  addLegacyVideoEditTracks(document.sequences[0])
  document.media = ['a', 'b', 'c'].map(id => ({ id, name: id, path: `${id}.mp4`, kind: 'video', width: 3840, height: 2160, durationSeconds: 20 }))
  document.items = document.media.map(media => ({ id: media.id, name: media.name, kind: 'video', mediaId: media.id }))
  const base: VideoEditClip = { id: 'a', itemId: 'a', name: '片段', kind: 'video', track: 1, start: 0, duration: 30, sourceInUs: 1_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
  document.sequences[0].clips = [base, { ...base, id: 'b', itemId: 'b', start: 60 }, { ...base, id: 'c', itemId: 'c', start: 150 }]
  return { document, base, composition: videoEditComposition(document, document.sequences[0].id) }
}

afterEach(() => { vi.useRealTimers() })

it('播放只扫描后三秒，暂停前后两秒；同文件邻近片段去重并定位入点', () => {
  const { composition, base } = fixture()
  composition.clips.push({ ...base, id: 'a2', start: 40, sourceInUs: 5_000_000 })
  const playing = videoEditDecodeTargets(composition, 15, true)
  expect(playing.map(target => target.media.id)).toEqual(['a', 'b'])
  expect(playing[1]).toMatchObject({ time: videoEditPictureSeconds(1), distance: 1.5, purpose: 'playback' })
  const paused = videoEditDecodeTargets(composition, 100, false)
  expect(paused.map(target => target.media.id).sort()).toEqual(['a', 'b', 'c'])
  expect(paused.every(target => target.purpose === 'seek')).toBe(true)
})

it('变速嵌套中的短片段和代码效果视频参数按正式源时间映射', () => {
  const { document, base } = fixture()
  const child = createVideoEditSequence('子序列'); addLegacyVideoEditTracks(child)
  child.clips = [{ ...base, itemId: 'b', start: 60, duration: 1, sourceInUs: 3_000_000 }]
  document.sequences.push(child)
  document.items.push({ id: 'nested', name: '嵌套', kind: 'sequence', sequenceId: child.id })
  document.sequences[0].clips = [{ ...base, id: 'nested', itemId: 'nested', kind: 'sequence', sourceInUs: 0, duration: 120, speed: { numerator: 2, denominator: 1 } }, {
    ...base, id: 'code', kind: 'code', track: 2, start: 30, code: { definitionId: 'd', versionId: 'v', parameters: { image: { kind: 'video', mediaId: 'c', time: 4 } } },
  }]
  const targets = videoEditDecodeTargets(videoEditComposition(document, document.sequences[0].id), 0, true)
  expect(targets.find(target => target.media.id === 'b')).toMatchObject({ time: videoEditPictureSeconds(3), purpose: 'playback', distance: 1 })
  // 视频参数每个引用独占解码会话，由渲染器在片段开始前自己打开并解到入点；前瞻不再为它预开文件共享的 seek 会话。
  expect(targets.find(target => target.media.id === 'c')).toBeUndefined()
})

it('已就绪预渲染文件替换覆盖区间，暂停仍读取原片', () => {
  const { composition } = fixture()
  const windows = [{ key: 'ready', startFrame: 0, endFrame: 120, url: 'cache.mp4', width: 1920, height: 1080, fps: 30 }]
  expect(videoEditDecodeTargets(composition, 15, true, windows)).toMatchObject([{ media: { path: 'cache.mp4' }, time: .5, purpose: 'playback' }])
  expect(videoEditDecodeTargets(composition, 15, false, windows).some(target => target.media.path === 'cache.mp4')).toBe(false)
})

it('效果视频参数与转场两侧余量也进入前瞻，隐藏轨道不打开', () => {
  const { composition, base } = fixture()
  composition.clips = [{ ...base, duration: 60, effects: [{ id: 'effect', name: '效果', enabled: true, amount: 1, code: { definitionId: 'd', versionId: 'v', parameters: { input: { kind: 'video', mediaId: 'c', time: 4 } } } }] }, { ...base, id: 'b', itemId: 'b', start: 60 }]
  composition.transitions = [{ id: 'cross', kind: 'cross_dissolve', leftClipId: 'a', rightClipId: 'b', durationFrames: 10 }]
  const targets = videoEditDecodeTargets(composition, 55, true)
  expect(targets.find(target => target.media.id === 'b')).toMatchObject({ distance: 0, time: videoEditPictureSeconds(1 - 5 / 30) })
  expect(targets.find(target => target.media.id === 'c')).toBeUndefined()
  composition.tracks = composition.tracks.map(track => ({ ...track, enabled: false }))
  expect(videoEditDecodeTargets(composition, 55, true)).toEqual([])
})

function harness() {
  const calls: Array<{ media: string; signal: AbortSignal; finish: () => void }> = []
  const backend = {
    reads: () => true, needsPreopen: () => true, maintain: vi.fn(async () => {}), canPreopen: vi.fn(async (): Promise<boolean> => true), cancelSpeculative: vi.fn(), log: vi.fn(),
    preopen: vi.fn((media, target) => {
      let finish!: () => void
      const ready = new Promise<void>(resolve => { finish = resolve })
      calls.push({ media: media.id, signal: target!.signal, finish })
      return { ready, release: vi.fn() }
    }),
  } satisfies Pick<VideoEditNativeFrames, 'reads' | 'needsPreopen' | 'maintain' | 'canPreopen' | 'cancelSpeculative' | 'log' | 'preopen'>
  return { scheduler: new VideoEditDecodeLookahead(backend as unknown as VideoEditNativeFrames), backend, calls }
}

it('单并发、滚动不重开；跳转取消未完成任务，旧帧完成不复活队列', async () => {
  vi.useFakeTimers()
  const { composition } = fixture(), { scheduler, calls } = harness()
  scheduler.beforeFrame(composition, 0, true); scheduler.update(composition, 0, true, [])
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(1)
  scheduler.beforeFrame(composition, 1, true); scheduler.update(composition, 1, true, [])
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(1)
  calls[0].finish(); await vi.advanceTimersByTimeAsync(1)
  expect(calls).toHaveLength(2)
  scheduler.beforeFrame(composition, 150, false)
  expect(calls[1].signal.aborted).toBe(true)
  scheduler.update(composition, 1, true, []); calls[1].finish()
  await vi.advanceTimersByTimeAsync(500)
  expect(calls).toHaveLength(2)
  scheduler.cancel()
})

it('预算不足仅记录放弃，不打开；暂停防抖后才启动，停止取消排队任务', async () => {
  vi.useFakeTimers()
  const { composition } = fixture(), { scheduler, backend } = harness()
  backend.canPreopen.mockResolvedValue(false)
  scheduler.beforeFrame(composition, 0, false); scheduler.update(composition, 0, false, [])
  await vi.advanceTimersByTimeAsync(100)
  expect(backend.canPreopen).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  expect(backend.preopen).not.toHaveBeenCalled()
  expect(backend.log).toHaveBeenCalledWith('debug', expect.any(String), 'video_edit.decode.preopen.skipped', expect.objectContaining({ reason: 'budget' }))
  scheduler.beforeFrame(composition, 150, false); scheduler.update(composition, 150, false, []); scheduler.cancel()
  const count = backend.canPreopen.mock.calls.length
  await vi.advanceTimersByTimeAsync(200)
  expect(backend.canPreopen).toHaveBeenCalledTimes(count)
})

it('前台仍有流水帧时不开始前瞻，完成后每次只发一个任务', async () => {
  vi.useFakeTimers()
  const { composition } = fixture(), { backend, calls } = harness()
  let idle = false
  const scheduler = new VideoEditDecodeLookahead(backend as unknown as VideoEditNativeFrames, media => media, { idle: () => idle, prepare: async () => true, retain: () => {} })
  scheduler.beforeFrame(composition, 0, true); scheduler.update(composition, 0, true, [])
  await vi.advanceTimersByTimeAsync(10); expect(calls).toHaveLength(0)
  idle = true; scheduler.update(composition, 0, true, [])
  await vi.advanceTimersByTimeAsync(10); expect(calls).toHaveLength(1)
  idle = false; scheduler.beforeFrame(composition, 1, true); calls[0].finish()
  await vi.advanceTimersByTimeAsync(10); expect(calls).toHaveLength(1)
  scheduler.cancel()
})

it('浏览器回退仍复用同一图片和代码前瞻队列，不依赖原生预算接口', async () => {
  vi.useFakeTimers()
  const { composition, base } = fixture()
  composition.media[0] = { ...composition.media[0], kind: 'image' }
  composition.clips = [{ ...base, kind: 'image' }]
  const prepare = vi.fn(async (_target: unknown, _signal: AbortSignal) => true)
  const scheduler = new VideoEditDecodeLookahead(undefined, media => media, { idle: () => true, prepare, retain: () => {} })
  scheduler.beforeFrame(composition, 0, true); scheduler.update(composition, 0, true, [])
  await vi.advanceTimersByTimeAsync(10)
  expect(prepare).toHaveBeenCalledOnce(); expect(prepare.mock.calls[0][0]).toMatchObject({ kind: 'image', media: { id: 'a' } })
  scheduler.cancel()
})


it('五秒及更短预渲染段在前瞻范围内预打开，平移后仍按段内偏移定位', () => {
  const { composition } = fixture()
  const windows = [
    { key: 'first', startFrame: 120, endFrame: 180, url: 'preview-first.mp4', width: 1920, height: 1080, fps: 30 },
    { key: 'second', startFrame: 180, endFrame: 210, url: 'preview-second.mp4', width: 1920, height: 1080, fps: 30 },
  ]
  const targets = videoEditDecodeTargets(composition, 150, true, windows)
  expect(targets.find(target => target.media.path === windows[0].url)).toMatchObject({ time: 1, distance: 0, purpose: 'playback' })
  expect(targets.find(target => target.media.path === windows[1].url)).toMatchObject({ time: 0, distance: 1, purpose: 'playback' })
  expect(videoEditDecodeTargets(composition, 150, false, windows).every(target => !target.media.path.startsWith('preview-'))).toBe(true)
})

it('暂停时同一帧重画不取消已准备好的内容（提前打开的会话保持），播放头移开才取消', async () => {
  vi.useFakeTimers()
  const { composition } = fixture()
  const signals: AbortSignal[] = []
  const retained: number[] = []
  const scheduler = new VideoEditDecodeLookahead(undefined, media => media, { idle: () => true, prepare: (_target, signal) => { signals.push(signal); return new Promise<boolean>(() => {}) }, retain: targets => { retained.push(targets.length) } })
  composition.media[0] = { ...composition.media[0], kind: 'image' }
  composition.clips = [{ ...composition.clips[0], kind: 'image' }]
  scheduler.beforeFrame(composition, 0, false); scheduler.update(composition, 0, false, [])
  await vi.advanceTimersByTimeAsync(200)
  expect(signals).toHaveLength(1)
  // 旧实现每个暂停帧都整体取消：重画一次就关掉提前打开的解码会话，随后再从关键帧重来。
  scheduler.beforeFrame(composition, 0, false)
  expect(signals[0].aborted).toBe(false); expect(retained.at(-1)).toBeGreaterThan(0)
  scheduler.beforeFrame(composition, 30, false)
  expect(signals[0].aborted).toBe(true); expect(retained.at(-1)).toBe(0)
  scheduler.cancel()
})
