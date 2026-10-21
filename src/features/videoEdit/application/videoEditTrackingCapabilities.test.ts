import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { deflateRawSync } from 'node:zlib'
import { getPlatform } from '@/platform/runtime'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { recordingCursorFixture } from '@/tests/recordingCursorFixture'
import { encodeSmartRegionSegment } from '@/core/videoEdit/smartRegions'
import { createVideoEditTrackHeader, encodeVideoEditTrackGeometry, type VideoEditTrackBox } from '@/core/videoEdit/tracking'
import type { TrackingDefinition, TrackingProgressEvent, TrackingRange, TrackingRunOptions, TrackingStatus } from '@/platform/contracts/tracking'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { editVideoEditTracker, readVideoEditTrackingPlacement, simplifyVideoEditBakedSamples } from './videoEditTrackingEdits'
import { videoEditTrackerEntityId } from './videoEditCompositeEntities'
import { resetVideoEditTrackingForTests, startVideoEditTracking } from './videoEditTracking'
import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  setSmartRegions() {}
  async setRenderDivisor() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))

let progress: (event: TrackingProgressEvent) => void
const files = new Map<string, Uint8Array>()
const run = vi.fn<[TrackingDefinition, TrackingRange, TrackingRunOptions], Promise<TrackingStatus>>()
beforeEach(() => {
  installHarnessNativeStorage(); resetVideoEditTrackingForTests(); files.clear()
  vi.spyOn(getPlatform().tracking, 'status').mockResolvedValue({ state: 'idle' })
  // 后台分析立即完成：按定义方式返回对应的结果文件。
  run.mockReset().mockImplementation(async definition => {
    const path = resolve(tmpdir(), `${definition.method}.htrk`)
    queueMicrotask(() => progress({ definition, status: { state: 'ready', result: { path, startUs: 0, endUs: 10_000_000, fps: 30, summary: { tracked: 300, lost: 0 } } } }))
    return { state: 'tracking', progress: 0, direction: 'both' }
  })
  vi.spyOn(getPlatform().tracking, 'run').mockImplementation(run)
  vi.spyOn(getPlatform().tracking, 'stop').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().tracking, 'onProgress').mockImplementation(handler => { progress = handler; return () => {} })
  vi.spyOn(getPlatform().tracking, 'onFrameRequest').mockImplementation(() => () => {})
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const name = Object.keys(Object.fromEntries(files)).find(key => decodeURIComponent(String(url)).includes(key))
    return name ? new Response(new Uint8Array(files.get(name)!).buffer) : new Response(null, { status: 404 })
  }))
  startVideoEditTracking()
})
afterEach(async () => {
  resetVideoEditTrackingForTests()
  for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
})
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }

async function project() {
  const owner = await createVideoEditProject(); const id = owner.document.id
  appendVideoEditMedia(id, { id: 'media1', name: '视频', path: resolve(tmpdir(), 'shot.mp4'), kind: 'video', durationSeconds: 10, width: 1920, height: 1080 })
  appendVideoEditClip(id, 'media1'); appendVideoEditClip(id)
  const sequence = getActiveVideoEditSequence(owner)
  return { owner, id, sequenceId: sequence.id, video: sequence.clips.find(clip => clip.kind === 'video')!, text: sequence.clips.find(clip => clip.kind === 'text')! }
}

/** 两点跟踪结果：两点绕画面中心每帧转 1°（31 帧）。 */
function twoPointResult(): Uint8Array {
  const aspect = 16 / 9; const boxes: VideoEditTrackBox[] = []; const records: Uint8Array[] = []
  for (let f = 0; f <= 30; f++) {
    const angle = f * Math.PI / 180
    const points = [[0.4, 0.5], [0.6, 0.5]].map(([u, v]) => { const x = (u - 0.5) * aspect; const y = v - 0.5; return [(x * Math.cos(angle) - y * Math.sin(angle)) / aspect + 0.5, x * Math.sin(angle) + y * Math.cos(angle) + 0.5, 1] as [number, number, number] })
    boxes.push([Math.min(points[0][0], points[1][0]), Math.min(points[0][1], points[1][1]) - 0.02, Math.abs(points[1][0] - points[0][0]), Math.abs(points[1][1] - points[0][1]) + 0.04, 1])
    records.push(deflateRawSync(encodeVideoEditTrackGeometry({ points, confidence: 1 })))
  }
  return encodeSmartRegionSegment(createVideoEditTrackHeader({ method: 'point', model: 'test', fps: 30, firstFrame: 0, frameCount: 31, sourceWidth: 1920, sourceHeight: 1080, promptFrames: [0], boxes, summary: { tracked: 31, lost: 0 } }), records)
}

it('follow_video_edit_tracker：两点跟踪跟随旋转与缩放，绑定帧不动，之后随跟踪转动；可写成关键帧并一步撤销', async () => {
  // jsdom 的 Blob 没有 stream()：换成 Node 的 Blob，结果记录按正式 deflate-raw 解压。
  vi.stubGlobal('Blob', (await import('node:buffer')).Blob)
  const { owner, id, sequenceId, video, text } = await project(); const app = createApplicationHarness()
  files.set('point.htrk', twoPointResult())
  editVideoEditTracker(id, sequenceId, video.id, { id: 'pair', name: '两点', method: 'point', prompts: [{ timeUs: 0, points: [[0.4, 0.5, 1], [0.6, 0.5, 1]] }] })
  await act(flush)
  const input = { documentRef: { kind: 'video_edit.document', id }, clipRef: { kind: 'video_edit.clip', id: `${id}:${text.id}` }, trackerRef: { kind: 'video_edit.tracker', id: `${id}:${videoEditTrackerEntityId(video.id, 'pair')}` }, follow: { rotation: true, scale: true }, frame: 0 }
  const live = await app.call('follow_video_edit_tracker', input)
  expect(live, JSON.stringify(live)).toMatchObject({ ok: true, data: { verification: { verified: true } } })
  const following = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === text.id)!
  expect(following.follow?.motion?.rotation).toBeCloseTo(0, 3); expect(following.follow?.motion?.size).toBeGreaterThan(0)
  const at0 = (await readVideoEditTrackingPlacement(id, sequenceId, text.id, 0))!
  expect(at0.x).toBeCloseTo(text.x, 4); expect(at0.rotation).toBeCloseTo(text.rotation, 3)
  const at20 = evaluateVideoEditClip((await readVideoEditTrackingPlacement(id, sequenceId, text.id, 20))!, 20)
  expect(at20.rotation - text.rotation).toBeCloseTo(20, 1)
  // 应用为关键帧：每帧值写成线性关键帧，跟随去掉；画面上每一帧不变。
  const baked = await app.call('follow_video_edit_tracker', { ...input, apply: 'keyframes' })
  expect(baked, JSON.stringify(baked)).toMatchObject({ ok: true, data: { follow: null } })
  const clip = getActiveVideoEditSequence(owner).clips.find(entry => entry.id === text.id)!
  expect(clip.follow).toBeUndefined(); expect(clip.curves?.rotation?.length).toBeGreaterThan(1)
  expect(evaluateVideoEditClip(clip, 20).rotation).toBeCloseTo(at20.rotation, 2)
  act(() => { undoVideoEdit(id) })
  expect(getActiveVideoEditSequence(owner).clips.find(entry => entry.id === text.id)!.follow?.motion).toBeDefined()
  // 一点跟踪不能跟随旋转：拒绝并说明原因。
  editVideoEditTracker(id, sequenceId, video.id, { id: 'single', name: '一点', method: 'point', prompts: [{ timeUs: 0, points: [[0.4, 0.5, 1]] }] })
  const rejected = await app.call('follow_video_edit_tracker', { ...input, trackerRef: { kind: 'video_edit.tracker', id: `${id}:${videoEditTrackerEntityId(video.id, 'single')}` } })
  expect(JSON.stringify(rejected)).toContain('跟随旋转')
})

it('stabilize_video_edit_clip：写入参数、等待相机运动分析并读回实际裁切；关闭写 null', async () => {
  const { owner, id, video } = await project(); const app = createApplicationHarness()
  const camera: Array<[number, number, number, number, number]> = Array.from({ length: 301 }, (_, f) => [1, 0, 0.01 * Math.sin(f * 1.7), 0.008 * Math.cos(f * 2.3), 1])
  files.set('camera.htrk', encodeSmartRegionSegment(createVideoEditTrackHeader({ method: 'camera', model: 'test', fps: 30, firstFrame: 0, frameCount: 301, sourceWidth: 1920, sourceHeight: 1080, promptFrames: [0], boxes: camera.map(() => [0, 0, 1, 1, 1] as VideoEditTrackBox), summary: { tracked: 301, lost: 0 }, camera }), camera.map(() => deflateRawSync(encodeVideoEditTrackGeometry({ confidence: 1 })))))
  const result = await app.call('stabilize_video_edit_clip', { documentRef: { kind: 'video_edit.document', id }, clipRef: { kind: 'video_edit.clip', id: `${id}:${video.id}` }, smoothness: 'locked', maxCrop: 0.15 })
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { stabilization: { smoothness: 'locked', maxCrop: 0.15, rotation: true, scale: true }, verification: { verified: true } } })
  const data = (result as unknown as { data: { crop: number; analyzedFrames: number } }).data
  expect(data.crop).toBeGreaterThan(0); expect(data.crop).toBeLessThanOrEqual(0.15); expect(data.analyzedFrames).toBeGreaterThan(100)
  expect(run.mock.calls.some(([definition]) => definition.method === 'camera' && definition.prompts.length === 0)).toBe(true)
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.stabilization?.smoothness).toBe('locked')
  const off = await app.change({ kind: 'video_edit.clip', id: `${id}:${video.id}` }, { 'video_edit.clip.stabilization': null })
  expect(off, JSON.stringify(off)).toMatchObject({ ok: true })
  expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.stabilization).toBeUndefined()
})

it('track_video_edit_recording：光标与窗口跟踪直接由录制事件换算，不提交后台视觉跟踪', async () => {
  const fixture = await recordingCursorFixture(4, { windows: true })
  vi.spyOn(getPlatform().system.fs, 'readFile').mockImplementation(async path => fixture.bytes.get(String(path))!)
  const { owner, id, sequenceId, video } = await project(); const app = createApplicationHarness()
  editVideoProject(id, document => { document.media.find(media => media.id === 'media1')!.recordingCursor = fixture.source; return document })
  const clipRef = { kind: 'video_edit.clip', id: `${id}:${video.id}` }
  const cursor = await app.call('track_video_edit_recording', { documentRef: { kind: 'video_edit.document', id }, clipRef, target: 'cursor', frame: 30 })
  expect(cursor, JSON.stringify(cursor)).toMatchObject({ ok: true, data: { verification: { verified: true } } })
  const window = await app.call('track_video_edit_recording', { documentRef: { kind: 'video_edit.document', id }, clipRef, target: 'window', frame: 30, region: [150 / 1920, 150 / 1080, 200 / 1920, 100 / 1080] })
  expect(window, JSON.stringify(window)).toMatchObject({ ok: true })
  const trackers = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.trackers!
  expect(trackers.map(tracker => tracker.recording)).toEqual([{ kind: 'cursor' }, { kind: 'window', windowId: 'editor' }])
  // 光标在 1 秒时位于 (200, 300)（fixture：x = 100 + 时间/10000）。
  expect(trackers[0].prompts[0].points![0][0] * 1920).toBeCloseTo(200, 0)
  expect(run.mock.calls.every(([definition]) => !definition.recording)).toBe(true)
  const { readVideoEditTrackingBox } = await import('./videoEditTrackingEdits')
  const cursorBox = (await readVideoEditTrackingBox(id, sequenceId, video.id, trackers[0].id, 90))!
  expect((cursorBox[0] + cursorBox[2] / 2) * 1920).toBeCloseTo(400, 0)
  // 窗口 2 秒后移到 (400,200) 并横向放大 1.5 倍：区域跟着平移缩放。
  const windowBox = (await readVideoEditTrackingBox(id, sequenceId, video.id, trackers[1].id, 90))!
  expect(windowBox[0] * 1920).toBeCloseTo(400 + 50 * 1.5, 0); expect(windowBox[1] * 1080).toBeCloseTo(250, 0)
  expect(windowBox[2] * 1920).toBeCloseTo(300, 0)
})

it('关键帧精简：线性段只留端点，误差不超过容差', () => {
  const samples = Array.from({ length: 50 }, (_, t) => [t, t < 25 ? t * 0.01 : 0.24 - (t - 24) * 0.02] as [number, number])
  const kept = simplifyVideoEditBakedSamples(samples, 1e-6)
  expect(kept.map(([t]) => t)).toEqual([0, 24, 49])
})
