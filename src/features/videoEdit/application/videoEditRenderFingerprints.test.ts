import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import type { VideoEditInstance } from './videoEditService'
import { videoEditRenderFingerprints, subscribeVideoEditRenderFingerprints } from './videoEditRenderFingerprints'
import { videoEditRenderWindows } from '@/core/videoEdit/renderCache'
import { GOLDEN_SCENE_DECLARATION, goldenScene } from '@/core/videoEdit/scene/sceneTestFixtures'
import { parseCodeMaterialV3Parameters } from '@/core/videoEdit/codeMaterial/parameterTypes'

const state = vi.hoisted(() => ({ owners: [] as VideoEditInstance[], listeners: new Set<() => void>(), frame: vi.fn(), dispose: vi.fn(), info: vi.fn(), sessions: 0,
  batches: [] as Array<{ start: number; end: number; budget: number; at: number }> }))
vi.mock('./videoEditService', () => ({ listVideoEditInstances: () => state.owners, subscribeVideoEditView: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener) } }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: state.info, warn() {} }) }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class { constructor() { state.sessions++ } async fingerprintCodeFrames(id: string, start: number, end: number, _web: unknown, budget: number) {
  state.batches.push({ start, end, budget, at: performance.now() }); return [[start, await state.frame(id, start)]]
} dispose = state.dispose } }))

function fixture() {
  const document = createVideoEditTestDocument('指纹调度')
  document.sequences[0].clips = [{ id: 'code', itemId: 'code', name: '代码', kind: 'code', track: 1, start: 0, duration: 3,
    sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '',
    code: { definitionId: 'definition', versionId: 'version', parameters: {} } } satisfies VideoEditClip]
  const owner = { document, contentVersion: 0, frame: 0, playing: false, scrubbing: false, busy: false } as VideoEditInstance
  state.owners = [owner]; state.sessions = 0; state.batches = []; state.frame.mockReset(); state.info.mockReset(); state.dispose.mockReset(); state.dispose.mockResolvedValue(undefined)
  state.frame.mockImplementation(async (_id: string, frame: number) => ({ digest: `frame:${frame}` }))
  return { owner, composition: videoEditComposition(document, document.sequences[0].id) }
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }) })
afterEach(async () => { state.owners = []; await vi.runAllTimersAsync(); vi.useRealTimers() })
async function finish(): Promise<void> { await vi.advanceTimersByTimeAsync(0); await vi.runAllTimersAsync() }

it('每个片段的 render_cache 日志汇总声明、录制、版本摘要帧数及回退原因', async () => {
  const { owner, composition } = fixture()
  state.frame.mockImplementation(async (_id: string, frame: number) => [
    { digest: 'declared', method: 'frameKey' }, { digest: 'recorded', method: 'recording' }, { fallback: 'frame-key-error:test' },
  ][frame])
  videoEditRenderFingerprints(owner, composition, 'fonts:1', {}); await finish()
  expect(state.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    event: 'video_edit.render_cache.completed', context: expect.objectContaining({ clipId: 'code',
      methods: expect.objectContaining({ frameKey: 1, recording: 1, version: 1 }), fallbacks: { 'frame-key-error:test': 1 } }),
  }))
})

it('同一片段版本跨文档快照复用帧指纹，只有变更的片段重新请求 Worker', async () => {
  const { owner, composition } = fixture()
  videoEditRenderFingerprints(owner, composition, 'fonts:1', {}); await finish()
  expect(state.frame).toHaveBeenCalledTimes(3)
  expect(videoEditRenderFingerprints(owner, composition, 'fonts:1', {})?.get('code')?.frames.size).toBe(3)
  owner.document = { ...owner.document, revision: owner.document.revision + 1 }
  const unchanged = videoEditComposition(owner.document, owner.document.sequences[0].id)
  expect(videoEditRenderFingerprints(owner, unchanged, 'fonts:1', {})?.get('code')?.frames.size).toBe(3)
  expect(state.frame).toHaveBeenCalledTimes(3)
  const changed = structuredClone(owner.document); changed.sequences[0].clips[0].code!.versionId = 'next'
  owner.document = changed
  const next = videoEditComposition(changed, changed.sequences[0].id)
  videoEditRenderFingerprints(owner, next, 'fonts:1', {}); await finish()
  expect(state.frame).toHaveBeenCalledTimes(6)
})

it('播放中持续计算，不释放模块；拖动暂停后空闲立即恢复，已完成帧不重算', async () => {
  const { owner, composition } = fixture()
  let interrupted = false
  state.frame.mockImplementation(async (_id: string, frame: number) => {
    if (frame === 1 && !interrupted) { interrupted = true; owner.scrubbing = true }
    return { digest: `frame:${frame}` }
  })
  owner.playing = true
  const result = videoEditRenderFingerprints(owner, composition, 'fonts:1', {})
  expect(result?.get('code')?.frames.size).toBe(0)
  await vi.advanceTimersByTimeAsync(50)
  expect(state.frame.mock.calls.map(call => call[1])).toEqual([0, 1])
  expect(state.dispose).not.toHaveBeenCalled()
  owner.scrubbing = false
  await finish()
  expect(state.frame.mock.calls.map(call => call[1])).toEqual([0, 1, 2])
  expect(state.sessions).toBe(1)
  expect(state.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'video_edit.render_cache.resumed' }))
})

it('导出时以单帧和 1ms 预算推进，每批至少让出 50ms，拖动仍暂停', async () => {
  const { owner, composition } = fixture()
  owner.busy = true
  const result = videoEditRenderFingerprints(owner, composition, 'fonts:1', {})!
  await vi.advanceTimersByTimeAsync(49)
  expect(state.batches).toEqual([{ start: 0, end: 1, budget: 1, at: 0 }])
  expect(result.get('code')?.frames.size).toBe(1)
  owner.scrubbing = true
  await vi.advanceTimersByTimeAsync(100)
  expect(state.batches).toHaveLength(1)
  owner.scrubbing = false
  await finish()
  expect(result.get('code')?.frames.size).toBe(3)
  expect(state.batches.every(batch => batch.end === batch.start + 1 && batch.budget === 1)).toBe(true)
  expect(state.batches[2].at - state.batches[1].at).toBeGreaterThanOrEqual(50)
})

it.each(['scrubbing', 'busy', 'playing'] as const)('其他工程的 %s 不暂停或降低本工程指纹批次预算', async activity => {
  const { owner, composition } = fixture()
  state.owners.push({ ...owner, [activity]: true })
  const result = videoEditRenderFingerprints(owner, composition, 'fonts:1', {})!
  await vi.advanceTimersByTimeAsync(1)
  expect(result.get('code')?.frames.size).toBe(3)
  expect(state.batches.every(batch => batch.budget === 8)).toBe(true)
})

it('引用场景记录变化使帧表失效，同一合成重复读取不再次序列化场景', async () => {
  const { owner, composition } = fixture()
  composition.scenes = [goldenScene('screen')]
  composition.clips[0].code!.parameters = { film: { kind: 'scene', sceneId: 'golden-scene' } }
  const declarations = parseCodeMaterialV3Parameters({ film: { type: 'scene', title: '片子', schema: GOLDEN_SCENE_DECLARATION } }, {}, 5)
  const read = () => declarations
  const scene = composition.scenes[0], serialize = vi.fn(() => ({ ...scene }))
  Object.defineProperty(scene, 'toJSON', { value: serialize })
  const first = videoEditRenderFingerprints(owner, composition, 'fonts:1', {}, read)!
  await finish()
  expect(serialize).toHaveBeenCalledOnce()
  for (let count = 0; count < 10; count++) videoEditRenderFingerprints(owner, composition, 'fonts:1', {}, read)
  expect(serialize).toHaveBeenCalledOnce()
  expect(state.frame).toHaveBeenCalledTimes(3)
  const changed = { ...composition, scenes: [{ ...scene, records: scene.records.map(record => record.id === 'seg-switch' ? { ...record, values: { ...record.values, name: '新记录' } } : record) }] }
  owner.contentVersion++
  const next = videoEditRenderFingerprints(owner, changed, 'fonts:1', {}, read)!
  expect(next.get('code')).not.toBe(first.get('code'))
  expect(next.get('code')?.frames.size).toBe(0)
  await finish()
  expect(state.frame).toHaveBeenCalledTimes(6)
})

it('正式 scene 声明的默认值只能为空，直接声明默认场景引用会被参数解析器拒绝', () => {
  const film = { type: 'scene', title: '片子', schema: GOLDEN_SCENE_DECLARATION }
  expect(parseCodeMaterialV3Parameters({ film }, {}, 5)[0].default).toBeNull()
  expect(() => parseCodeMaterialV3Parameters({ film: { ...film, default: { kind: 'scene', sceneId: 'golden-scene' } } }, {}, 5)).toThrow('default:null')
})

it('先完成播放头窗口内所有代码片段并发布，继续前方；播放头跳转会重排剩余窗口', async () => {
  const { owner } = fixture(), sequence = owner.document.sequences[0]
  sequence.frameRate = { numerator: 1, denominator: 1 }
  sequence.clips[0].duration = 20
  sequence.clips.push({ ...sequence.clips[0], id: 'overlay' })
  const composition = videoEditComposition(owner.document, sequence.id)
  owner.frame = 11; owner.playing = true
  const result = videoEditRenderFingerprints(owner, composition, 'fonts:1', {})!
  const states: Array<Array<boolean | undefined>> = []
  const stop = subscribeVideoEditRenderFingerprints(() => {
    states.push(videoEditRenderWindows(composition, { fontRevision: 0, analysis: '', codeFingerprints: result }).map(window => window.fingerprintPending))
  })
  await vi.advanceTimersByTimeAsync(170)
  expect(state.frame.mock.calls.slice(0, 10).map(call => [call[0], call[1]])).toEqual([
    ...[10, 11, 12, 13, 14].map(frame => ['code', frame]), ...[10, 11, 12, 13, 14].map(frame => ['overlay', frame]),
  ])
  expect(states).toContainEqual([true, true, undefined, true])
  expect(state.frame.mock.calls[10]?.[1]).toBe(15)
  owner.frame = 1
  await finish(); stop()
  expect(state.frame.mock.calls[11]?.[1]).toBe(0)
  expect(result.get('code')?.frames.size).toBe(20)
  expect(result.get('overlay')?.frames.size).toBe(20)
})

it('编辑中止旧快照时不把缺帧回退写进共享缓存，新快照继续缺失帧', async () => {
  const { owner, composition } = fixture()
  let changed = false
  state.frame.mockImplementation(async (_id: string, frame: number) => {
    if (frame === 1 && !changed) { changed = true; owner.document = { ...owner.document, revision: owner.document.revision + 1 }; owner.contentVersion++ }
    return { digest: `frame:${frame}` }
  })
  videoEditRenderFingerprints(owner, composition, 'fonts:1', {}); await finish()
  expect(state.frame.mock.calls.map(call => call[1])).toEqual([0, 1])
  const next = videoEditComposition(owner.document, owner.document.sequences[0].id)
  videoEditRenderFingerprints(owner, next, 'fonts:1', {}); await finish()
  expect(state.frame.mock.calls.map(call => call[1])).toEqual([0, 1, 1, 2])
  expect(videoEditRenderFingerprints(owner, next, 'fonts:1', {})?.get('code')?.frames.get(2)).toEqual({ digest: 'frame:2' })
})


it('改名等元数据更新沿用合成对象时继续计算，内容版本打断后同一合成也能重排恢复', async () => {
  const { owner, composition } = fixture()
  state.frame.mockImplementation(async (_id: string, frame: number) => {
    if (frame === 1) owner.document = { ...owner.document, name: '改名' }
    return { digest: `frame:${frame}` }
  })
  const result = videoEditRenderFingerprints(owner, composition, 'fonts:1', {})!
  await finish()
  expect(result.get('code')?.frames.size).toBe(3)

  let interrupted = false
  state.frame.mockImplementation(async (_id: string, frame: number) => {
    if (frame === 1 && !interrupted) { interrupted = true; owner.contentVersion++ }
    return { digest: `frame:${frame}` }
  })
  videoEditRenderFingerprints(owner, composition, 'fonts:2', {}); await finish()
  const resumed = videoEditRenderFingerprints(owner, composition, 'fonts:2', {})!
  await finish()
  expect(resumed.get('code')?.frames.size).toBe(3)
  expect(state.frame.mock.calls.map(call => call[1])).toEqual([0, 1, 2, 0, 1, 1, 2])
})

it('未引用的素材、片子数据、网页以及片段改名不清空帧表，A→B→A 立即复用 A', async () => {
  const { owner, composition } = fixture()
  const first = videoEditRenderFingerprints(owner, composition, 'fonts:1', {})!
  await finish()
  const changed = structuredClone(composition)
  changed.clips[0].name = '改名'
  changed.media.push({ id: 'unused', name: '未用', path: 'unused.mp4', kind: 'video', width: 100, height: 100, durationSeconds: 1, hasAudio: false })
  changed.scenes = [{ id: 'unused', name: '未用', schema: { id: 'unused', version: 1 }, records: [] }]
  owner.contentVersion++
  expect(videoEditRenderFingerprints(owner, changed, 'fonts:1', { unused: 'changed' })?.get('code')).toBe(first.get('code'))
  const b = structuredClone(composition); b.clips[0].code!.versionId = 'B'
  owner.contentVersion++
  videoEditRenderFingerprints(owner, b, 'fonts:1', {}); await finish()
  const calls = state.frame.mock.calls.length
  owner.contentVersion++
  expect(videoEditRenderFingerprints(owner, composition, 'fonts:1', {})?.get('code')?.frames.size).toBe(3)
  expect(state.frame).toHaveBeenCalledTimes(calls)
})

it('基础设施偶发失败保留已算帧，退避后补缺帧，不永久写入失败回退', async () => {
  const { owner, composition } = fixture()
  state.frame.mockRejectedValueOnce(new Error('Worker 暂不可用'))
  const first = videoEditRenderFingerprints(owner, composition, 'fonts:1', {})!
  await vi.advanceTimersByTimeAsync(10)
  expect(first.get('code')?.frames.size).toBe(0)
  videoEditRenderFingerprints(owner, composition, 'fonts:1', {})
  expect(state.frame).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1100)
  videoEditRenderFingerprints(owner, composition, 'fonts:1', {}); await finish()
  expect(first.get('code')?.frames.size).toBe(3)
  expect([...first.get('code')!.frames.values()].every(value => value.digest)).toBe(true)
})

it('字体、分析或网页环境在批次途中改变时拒收迟到结果，同一内容版本可立即重排', async () => {
  const { owner, composition } = fixture()
  let environment = 1
  state.frame.mockImplementationOnce(async () => { environment = 2; return { digest: 'stale' } })
  const old = videoEditRenderFingerprints(owner, composition, 'fonts:1', {}, undefined, () => environment === 1)!
  await finish()
  expect(old.get('code')?.frames.size).toBe(0)
  const next = videoEditRenderFingerprints(owner, composition, 'fonts:1', {}, undefined, () => environment === 2)!
  await finish()
  expect(next.get('code')?.frames.size).toBe(3)
  expect([...next.get('code')!.frames.values()].some(value => value.digest === 'stale')).toBe(false)
})

it('历史帧表从缓存淘汰后快照仍保留结果，再次读取可重新补算', async () => {
  const { owner, composition } = fixture()
  const first = videoEditRenderFingerprints(owner, composition, 'fonts:1', {})!
  await finish()
  for (let index = 0; index < 130; index++) {
    const next = structuredClone(composition); next.clips[0].code!.versionId = `version-${index}`
    owner.contentVersion++
    videoEditRenderFingerprints(owner, next, 'fonts:1', {}); await finish()
  }
  expect(first.get('code')?.frames.size).toBe(3)
  expect(first.get('code')?.signature).not.toBe('')
  const count = state.frame.mock.calls.length
  owner.contentVersion++
  const restored = videoEditRenderFingerprints(owner, composition, 'fonts:1', {})!
  expect(restored.get('code')).not.toBe(first.get('code'))
  await finish()
  expect(restored.get('code')?.frames.size).toBe(3)
  expect(state.frame.mock.calls.length).toBe(count + 3)
})

it('当前序列的帧批次越过非当前序列的后续区间，不等待它整片完成', async () => {
  const { owner, composition } = fixture()
  owner.activeSequenceId = composition.id
  const other = structuredClone(composition); other.id = 'secondary'; other.clips[0].id = 'other'
  let release!: () => void
  state.frame.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return { digest: 'other:0' } })
  videoEditRenderFingerprints(owner, other, 'fonts:1', {})
  await vi.advanceTimersByTimeAsync(0)
  videoEditRenderFingerprints(owner, composition, 'fonts:1', {})
  release(); await finish()
  const calls = state.frame.mock.calls.map(call => [call[0], call[1]])
  expect(calls.indexOf(calls.find(call => call[0] === 'code')!)).toBeLessThan(calls.indexOf(calls.find(call => call[0] === 'other' && call[1] === 1)!))
})

it('连续完成许多窗口时合并发布，最终通知保留完整帧表', async () => {
  const { owner, composition } = fixture()
  composition.frameRate = { numerator: 1, denominator: 1 }; composition.fps = 1; composition.clips[0].duration = 1000
  const updated = vi.fn(), stop = subscribeVideoEditRenderFingerprints(updated)
  const result = videoEditRenderFingerprints(owner, composition, 'fonts:1', {})!
  await finish(); stop()
  expect(result.get('code')?.frames.size).toBe(1000)
  expect(updated.mock.calls.length).toBeLessThan(10)
})
