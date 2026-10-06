// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { getPlatform } from '@/platform/runtime'
import { videoEditClipSchema, videoEditDocumentSchema } from '@/core/videoEdit/document'
import { videoEditEffectMaskSchema } from '@/core/videoEdit/effectMasks'
import type { TrackingDefinition, TrackingProgressEvent, TrackingRange, TrackingRunOptions, TrackingStatus } from '@/platform/contracts/tracking'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, createVideoEditProject, editVideoSequence, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView, undoVideoEdit } from './videoEditService'
import { editVideoEditTracker } from './videoEditTrackingEdits'
import { nestVideoEditSelection } from './videoEditNesting'
import * as trackingEdits from './videoEditTrackingEdits'
import { videoEditTrackerEntityId } from './videoEditCompositeEntities'
import { resetVideoEditTrackingForTests, runVideoEditTracking, startVideoEditTracking, videoEditTrackResults, videoEditTrackingRequest, videoEditTrackingStatus, waitVideoEditTracking } from './videoEditTracking'
import { getVideoEditTrackingEditing, setVideoEditTrackingEditing } from './videoEditTrackingEditing'
import { getVideoEditMaskEditing, setVideoEditMaskEditing } from './videoEditMaskEditing'
import { VideoEditTrackingPanel } from '../panels/VideoEditTrackingPanel'
import { VideoEditTrackingOverlay } from '../panels/VideoEditTrackingOverlay'
import { createVideoEditTrackHeader } from '@/core/videoEdit/tracking'
import type { VideoEditTrackQuad } from '@/core/videoEdit/tracking'
import { encodeSmartRegionSegment } from '@/core/videoEdit/smartRegions'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  setSmartRegions() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))
let progress: (event: TrackingProgressEvent) => void
const status = vi.fn<[TrackingDefinition], Promise<TrackingStatus>>()
const run = vi.fn<[TrackingDefinition, TrackingRange, TrackingRunOptions], Promise<TrackingStatus>>()
beforeEach(() => {
  installHarnessNativeStorage(); resetVideoEditTrackingForTests(); setVideoEditTrackingEditing(null)
  status.mockReset().mockResolvedValue({ state: 'idle' }); run.mockReset().mockResolvedValue({ state: 'tracking', progress: 0, direction: 'both' })
  vi.spyOn(getPlatform().tracking, 'status').mockImplementation(status)
  vi.spyOn(getPlatform().tracking, 'run').mockImplementation(run)
  vi.spyOn(getPlatform().tracking, 'stop').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().tracking, 'onProgress').mockImplementation(handler => { progress = handler; return () => {} })
  startVideoEditTracking()
})
afterEach(async () => {
  cleanup(); resetVideoEditTrackingForTests(); setVideoEditTrackingEditing(null); setVideoEditMaskEditing(null)
  for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
})
const tracker = { id: 'track1', name: '杯子', method: 'box' as const, prompts: [{ timeUs: 0, box: [0.2, 0.2, 0.2, 0.3] as [number, number, number, number] }] }
it('嵌套导出等待子序列跟踪，按完整快照提供子跟踪结果', async () => {
  const { owner, id, sequenceId, video } = await project()
  editVideoEditTracker(id, sequenceId, video.id, tracker); await flush()
  editVideoSequence(id, sequenceId, sequence => { sequence.clips.find(clip => clip.id === video.id)!.effects = [{ id: 'nested-effect', name: '模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: {} }, mask: { regionId: 'tracker', trackerId: tracker.id } }]; return sequence })
  nestVideoEditSelection({ projectId: id, sequenceId, clipIds: getActiveVideoEditSequence(owner).clips.map(clip => clip.id) }, '含跟踪的子序列')
  const snapshot = getActiveVideoEditSequence(owner); const definition = status.mock.calls.at(-1)![0]
  let completed = false; const waiting = waitVideoEditTracking(snapshot, snapshot).then(() => { completed = true })
  await flush(); expect(completed).toBe(false)
  progress({ definition, status: { state: 'ready', result: result() } }); await waiting
  expect(Object.keys(videoEditTrackResults(snapshot))).toHaveLength(1)
})

it.each(['point','planar'] as const)('面板建立 %s；中途拖点/拖角、AE 内外框及纠错可撤销',async method=> {
  const {owner,id,video}=await project();setVideoEditView(id,{frame:0,selection:video.id})
  vi.stubGlobal('PointerEvent',MouseEvent)
  vi.spyOn(SVGElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,width:1920,height:1080,right:1920,bottom:1080,toJSON:()=>({})})
  Object.defineProperty(SVGElement.prototype,'setPointerCapture',{configurable:true,value:()=>{}})
  vi.spyOn(trackingEdits,'readVideoEditTrackingGeometry').mockResolvedValue(undefined)
  const onError=vi.fn();const view=render(<><VideoEditTrackingPanel instance={owner} onError={onError}/><VideoEditTrackingOverlay instance={owner} onError={onError}/></>)
  fireEvent.click(view.getByLabelText('新建跟踪方式'));fireEvent.click(view.getByText(method==='point'?'点 · 特征跟踪':'平面 · 四角'))
  if(method==='point'){fireEvent.click(view.getByLabelText('跟踪点数量'));fireEvent.click(view.getByText('2 个点'))}
  fireEvent.click(view.getByText('新建'));const svg=view.getByLabelText('节目跟踪选择')
  const initial:VideoEditTrackQuad=[[.2,.2],[.8,.2],[.8,.8],[.2,.8]]
  for(const [x,y] of initial.slice(0,method==='point'?2:4)){fireEvent.pointerDown(svg,{button:0,clientX:x*1920,clientY:y*1080});fireEvent.pointerUp(svg,{clientX:x*1920,clientY:y*1080})}
  await act(flush)
  const read=()=>getActiveVideoEditSequence(owner).clips.find(c=>c.id===video.id)!.trackers![0]
  expect(read().method).toBe(method);expect(method==='point'?read().prompts[0].points?.length:read().prompts[0].quad?.length).toBe(method==='point'?2:4)
  act(()=>setVideoEditView(id,{frame:10}));await act(flush)
  const handle=view.getByLabelText(method==='point'?'跟踪点 1':'平面角点 1')
  fireEvent.pointerDown(handle,{button:0,clientX:384,clientY:216});fireEvent.pointerMove(svg,{clientX:480,clientY:270});fireEvent.pointerUp(svg,{clientX:480,clientY:270});await act(flush)
  expect(read().prompts.length).toBe(2);expect(read().prompts[1].timeUs).toBe(333333)
  expect((method==='point'?read().prompts[1].points!:read().prompts[1].quad!)[0][0]).toBeCloseTo(.25)
  if(method==='point') {
    const search=view.getByLabelText('跟踪点 1 搜索框');fireEvent.pointerDown(search,{button:0,clientX:588,clientY:270});fireEvent.pointerMove(svg,{clientX:700,clientY:270});fireEvent.pointerUp(svg,{clientX:700,clientY:270});await act(flush)
    expect(read().prompts[1].window!.search).toBeGreaterThan(.2)
    act(()=>{undoVideoEdit(id)});expect(read().prompts[1].window!.search).toBe(.2)
  }
  act(()=>{undoVideoEdit(id)});expect(read().prompts.length).toBe(1);expect(onError).not.toHaveBeenCalled()
})

it('助手通用事务创建点/平面与角点贴合；错误目标回滚、可回读与撤销',async()=> {
  const {owner,id,video,text}=await project();appendVideoEditClip(id,'media1')
  const replacement=getActiveVideoEditSequence(owner).clips.filter(c=>c.kind==='video' && c.id!==video.id)[0]
  const app=createApplicationHarness();const source={kind:'video_edit.clip',id:`${id}:${video.id}`};const target={kind:'video_edit.clip',id:`${id}:${replacement.id}`}
  const quad:VideoEditTrackQuad=[[.2,.2],[.8,.2],[.8,.8],[.2,.8]]
  try {
    const baseline=await app.read(source)
    expect(await app.call('change_application_entities',{summary:'跟踪屏幕与特征点',changes:[{kind:'create_items',entityType:'video_edit.tracker',parent:source,items:[{properties:{'video_edit.tracker.name':'屏幕','video_edit.tracker.method':'planar','video_edit.tracker.prompts':[{timeUs:0,quad}]}},{properties:{'video_edit.tracker.name':'特征点','video_edit.tracker.method':'point','video_edit.tracker.prompts':[{timeUs:0,points:[[.5,.5,1]]}]}}]}]},baseline.revisions as Record<string,number>)).toMatchObject({ok:true})
    const stored=getActiveVideoEditSequence(owner).clips.find(c=>c.id===video.id)!.trackers!
    const follow={mode:'corner_pin',clipId:video.id,trackerId:stored[0].id,offsetX:0,offsetY:0}
    expect(await app.change(target,{'video_edit.clip.follow':follow})).toMatchObject({ok:true})
    expect((await app.read(target,['video_edit.clip.follow'])).properties).toMatchObject({'video_edit.clip.follow':follow})
    expect(await app.change(target,{'video_edit.clip.follow':{...follow,trackerId:stored[1].id}})).toMatchObject({ok:false})
    expect(await app.change({kind:'video_edit.clip',id:`${id}:${text.id}`},{'video_edit.clip.follow':follow})).toMatchObject({ok:false})
    expect(getActiveVideoEditSequence(owner).clips.find(c=>c.id===replacement.id)!.follow).toEqual(follow)
    undoVideoEdit(id);expect(getActiveVideoEditSequence(owner).clips.find(c=>c.id===replacement.id)!.follow).toBeUndefined()
  }finally{app.dispose()}
})
async function project() {
  const owner = await createVideoEditProject(); const id = owner.document.id
  appendVideoEditMedia(id, { id: 'media1', name: '视频', path: resolve(tmpdir(), 'tracking.mp4'), kind: 'video', durationSeconds: 10, width: 1920, height: 1080 })
  appendVideoEditClip(id, 'media1'); appendVideoEditClip(id)
  const sequence = getActiveVideoEditSequence(owner); const video = sequence.clips.find(clip => clip.kind === 'video')!; const text = sequence.clips.find(clip => clip.kind === 'text')!
  return { owner, id, sequenceId: sequence.id, video, text }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const result = (startUs = 0, endUs = 10_000_000) => ({ path: resolve(tmpdir(), 'track.htrk'), startUs, endUs, fps: 30, summary: { tracked: 300, lost: 0 } })

it('schema 拒绝非媒体跟踪、重复 ID、无提示；保存容许剪切后落空的绑定', async () => {
  const { owner, video, text } = await project()
  const document = structuredClone(owner.document); const sequence = document.sequences[0]
  const clip = sequence.clips.find(clip => clip.id === video.id)!
  clip.trackers = [tracker, tracker]
  expect(videoEditDocumentSchema.safeParse(document).success).toBe(false)
  clip.trackers = [tracker]; sequence.clips.find(clip => clip.id === text.id)!.trackers = [tracker]
  expect(videoEditDocumentSchema.safeParse(document).success).toBe(false)
  expect(videoEditClipSchema.safeParse({ ...video, trackers: [{ ...tracker, prompts: [] }] }).success).toBe(false)
  expect(videoEditClipSchema.safeParse({ ...text, follow: { clipId: 'removed', trackerId: 'gone', offsetX: 0, offsetY: 0 } }).success).toBe(true)
  expect(videoEditEffectMaskSchema.safeParse({ regionId: 'tracker', trackerId: '' }).success).toBe(false)
  expect(videoEditEffectMaskSchema.parse({ regionId: 'shapes', shapes: [{ id: 's1', kind: 'rect', box: [0, 0, 1, 1], follow: { trackerId: 'gone', reference: [0, 0, 1, 1] } }] }).regionId).toBe('shapes')
})
it('新定义先查缓存、缺结果开始跟踪；同定义多片段合并素材范围，旧查询不复活删除的跟踪', async () => {
  const { owner, id, sequenceId, video } = await project()
  editVideoSequence(id, sequenceId, sequence => { const source = sequence.clips.find(clip => clip.id === video.id)!; source.duration = 30; source.trackers = [tracker]; sequence.clips.push({ ...source, id: 'copy', start: 30, sourceInUs: 3_000_000 }); return sequence })
  await flush()
  expect(status).toHaveBeenCalledTimes(1)
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ method: 'box' }), { startUs: 0, endUs: 4_000_000 }, { direction: 'both' })
  resetVideoEditTrackingForTests()
  let finish!: (value: TrackingStatus) => void
  status.mockImplementation(() => new Promise(resolve => { finish = resolve })); run.mockClear(); startVideoEditTracking(); await flush()
  editVideoSequence(id, sequenceId, sequence => { for (const clip of sequence.clips) delete clip.trackers; return sequence })
  finish({ state: 'ready', result: result() }); await flush()
  expect(videoEditTrackResults()).toEqual({}); expect(run).not.toHaveBeenCalled(); expect(owner.document.sequences[0].clips[0].trackers).toBeUndefined()
})
it('已有缓存直接复用；进度先到完成时迟到 run 回执不倒退状态；原地续跟改变结果版本', async () => {
  const { owner, id, sequenceId, video } = await project()
  status.mockResolvedValue({ state: 'ready', result: result() })
  editVideoEditTracker(id, sequenceId, video.id, tracker); await flush(); expect(run).not.toHaveBeenCalled()
  const request = videoEditTrackingRequest(owner.document, getActiveVideoEditSequence(owner).frameRate, getActiveVideoEditSequence(owner).clips[0], tracker)!
  const first = Object.values(videoEditTrackResults())[0].version
  let complete!: (value: TrackingStatus) => void
  run.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  runVideoEditTracking(request.definition, request.range, { direction: 'forward' }); await flush()
  expect(Object.values(videoEditTrackResults())[0].version).toBe(first)
  progress({ definition: request.definition, status: { state: 'tracking', direction: 'forward', progress: 0.5, result: result() } })
  expect(Object.values(videoEditTrackResults())[0].version).toBe(first)
  progress({ definition: request.definition, status: { state: 'ready', result: result() } })
  complete({ state: 'tracking', progress: 0, direction: 'forward' }); await flush()
  expect(videoEditTrackingStatus(request.definition)?.state).toBe('ready')
  expect(Object.values(videoEditTrackResults())[0].version).not.toBe(first)
})
it('导出等待使用的跟踪；停止后仅续跟一次仍不满则按已有部分导出，失败与取消均结束等待', async () => {
  const { owner, id, sequenceId, video } = await project()
  editVideoEditTracker(id, sequenceId, video.id, tracker); await flush()
  editVideoSequence(id, sequenceId, sequence => { sequence.clips.find(clip => clip.id === video.id)!.effects = [{ id: 'fx', name: '模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: {} }, mask: { regionId: 'tracker', trackerId: tracker.id } }]; return sequence })
  const sequence = getActiveVideoEditSequence(owner); const request = videoEditTrackingRequest(owner.document, sequence.frameRate, sequence.clips[0], tracker)!
  let resolved = false
  const waiting = waitVideoEditTracking(sequence, sequence).then(() => { resolved = true }); await flush(); expect(resolved).toBe(false)
  run.mockResolvedValue({ state: 'ready', result: result(0, 1_000_000) })
  progress({ definition: request.definition, status: { state: 'ready', result: result(0, 1_000_000), stopped: true } })
  await waiting; expect(run).toHaveBeenCalledTimes(2)
  run.mockResolvedValue({ state: 'failed', reason: 'model' })
  await expect(waitVideoEditTracking(sequence, sequence)).rejects.toThrow('本地模型下载失败')
  const controller = new AbortController(); controller.abort(new Error('cancel'))
  await expect(waitVideoEditTracking(sequence, sequence, controller.signal)).rejects.toThrow('cancel')
})
it('助手同一正式事务创建、修改与回读跟踪，绑定与取消跟随，错误引用被拒绝', async () => {
  const { owner, id, video, text } = await project(); const app = createApplicationHarness()
  const clipRef = { kind: 'video_edit.clip', id: `${id}:${video.id}` }
  try {
    const baseline = await app.read(clipRef)
    const created = await app.call('change_application_entities', { summary: '跟踪杯子', changes: [{ kind: 'create_items', entityType: 'video_edit.tracker', parent: clipRef, items: [{ properties: { 'video_edit.tracker.name': tracker.name, 'video_edit.tracker.method': tracker.method, 'video_edit.tracker.prompts': tracker.prompts } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const stored = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.trackers![0]
    const ref = { kind: 'video_edit.tracker', id: `${id}:${videoEditTrackerEntityId(video.id, stored.id)}` }
    await flush()
    expect(await app.change(ref, { 'video_edit.tracker.name': '红杯子' })).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.tracker.name'])).properties).toMatchObject({ 'video_edit.tracker.name': '红杯子' })
    const follow = { clipId: video.id, trackerId: stored.id, offsetX: 0.1, offsetY: 0.2 }
    expect(await app.change(clipRef, { 'video_edit.clip.follow': follow })).toMatchObject({ ok: false })
    const textRef = { kind: 'video_edit.clip', id: `${id}:${text.id}` }
    expect(await app.change(textRef, { 'video_edit.clip.follow': follow })).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === text.id)!.follow).toEqual(follow)
    expect(await app.change(textRef, { 'video_edit.clip.follow': { ...follow, trackerId: 'missing' } })).toMatchObject({ ok: false })
    expect(await app.change(textRef, { 'video_edit.clip.follow': null })).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === text.id)!.follow).toBeUndefined()
    expect(await app.change(ref, { 'video_edit.tracker.prompts': [{ timeUs: 0, points: [[0.5, 0.5, 1]] }] })).toMatchObject({ ok: false })
    expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.trackers![0].prompts).toEqual(tracker.prompts)
    const effectBaseline = await app.read(clipRef)
    expect(await app.call('change_application_entities', { summary: '跟踪区域模糊', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clipRef, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:gaussian_blur', 'video_edit.effect.mask': { regionId: 'tracker', trackerId: stored.id } } }] }] }, effectBaseline.revisions as Record<string, number>)).toMatchObject({ ok: true })
    const effect = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.effects![0]
    expect(effect.mask).toEqual({ regionId: 'tracker', trackerId: stored.id })
    const effectRef = { kind: 'video_edit.effect', id: `${id}:${effect.id}` }
    expect(await app.change(effectRef, { 'video_edit.effect.mask': { regionId: 'tracker', trackerId: 'missing' } })).toMatchObject({ ok: false })
    const removeBaseline = await app.read(clipRef)
    expect(await app.call('change_application_entities', { summary: '移除跟踪', changes: [{ kind: 'remove_items', entityType: 'video_edit.tracker', parent: clipRef, targets: [ref] }] }, removeBaseline.revisions as Record<string, number>)).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.trackers).toEqual([])
    expect(await app.change(effectRef, { 'video_edit.effect.name': '杯子模糊' })).toMatchObject({ ok: true })
    expect(await app.change(effectRef, { 'video_edit.effect.mask': null })).toMatchObject({ ok: true })
  } finally { app.dispose() }
})
it('导出等待保留原定义：用户删除跟踪不取消等待，结果仍按导出快照推送', async () => {
  const { owner, id, sequenceId, video } = await project()
  editVideoEditTracker(id, sequenceId, video.id, tracker); await flush()
  editVideoSequence(id, sequenceId, sequence => { sequence.clips.find(clip => clip.id === video.id)!.effects = [{ id: 'fx', name: '模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: {} }, mask: { regionId: 'tracker', trackerId: tracker.id } }]; return sequence })
  const snapshot = getActiveVideoEditSequence(owner); const definition = status.mock.calls.at(-1)![0]
  const waiting = waitVideoEditTracking(snapshot, snapshot)
  editVideoEditTracker(id, sequenceId, video.id, { remove: tracker.id })
  expect(getPlatform().tracking.stop).not.toHaveBeenCalled()
  progress({ definition, status: { state: 'ready', result: result() } }); await waiting
  expect(Object.keys(videoEditTrackResults())).toHaveLength(0)
  expect(Object.keys(videoEditTrackResults(snapshot))).toHaveLength(1)
})
it('面板点选三候选后建立跟踪，按钮续跟/单步/停止，删除与撤销共用领域历史', async () => {
  const { owner, id, sequenceId, video } = await project(); setVideoEditView(id, { frame: 0, selection: video.id })
  const maskEditing = { projectId: id, sequenceId, clipId: video.id, effectId: 'mask-effect', pen: true }
  setVideoEditMaskEditing(maskEditing)
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, toJSON: () => ({}) })
  Object.defineProperty(SVGElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: () => ({ width: 50 }), createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData: () => {} } as unknown as CanvasRenderingContext2D)
  vi.spyOn(trackingEdits, 'readVideoEditTrackingBox').mockResolvedValue([0.2, 0.2, 0.2, 0.3, 1])
  vi.spyOn(getPlatform().tracking, 'candidates').mockResolvedValue({ size: 128, candidates: [0, 1, 2].map(() => ({ logits: new Int8Array(128 * 128).fill(1), score: 0.9 })) })
  const onError = vi.fn(); const view = render(<><VideoEditTrackingPanel instance={owner} onError={onError} /><VideoEditTrackingOverlay instance={owner} onError={onError} /></>)
  fireEvent.click(view.getByText('新建'))
  expect(getVideoEditMaskEditing()).toBeNull()
  const svg = view.getByLabelText('节目跟踪选择')
  fireEvent.pointerDown(svg, { button: 0, clientX: 960, clientY: 540 }); fireEvent.pointerUp(svg, { button: 0, clientX: 960, clientY: 540 })
  await waitFor(() => expect(view.getByText('候选 3')).toBeTruthy())
  fireEvent.click(view.getByText('候选 3')); fireEvent.click(view.getByText('使用候选')); await act(flush)
  const stored = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.trackers![0]
  expect(stored.prompts[0]).toEqual({ timeUs: 0, points: [[0.5, 0.5, 1]], candidate: 3 })
  expect(getVideoEditTrackingEditing()?.trackerId).toBe(stored.id)
  fireEvent.click(view.getByLabelText('停止跟踪')); await act(flush); expect(getPlatform().tracking.stop).toHaveBeenCalled()
  const definition = status.mock.calls.at(-1)![0]; act(() => progress({ definition, status: { state: 'ready', result: result() } }))
  fireEvent.click(view.getByLabelText('向后一帧')); await act(flush); expect(run).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { direction: 'backward', limit: 1 })
  act(() => progress({ definition, status: { state: 'ready', result: result() } }))
  fireEvent.click(view.getByLabelText('向前跟踪')); await act(flush); expect(run).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { direction: 'forward' })
  fireEvent.click(view.getByLabelText(`删除${stored.name}`)); expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.trackers).toEqual([])
  act(() => { undoVideoEdit(id) }); expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.trackers?.length).toBe(1)
  expect(onError).not.toHaveBeenCalled()
  act(() => setVideoEditMaskEditing(maskEditing)); expect(getVideoEditTrackingEditing()).toBeNull()
})

it('框选建立物体跟踪，拖框纠错只增加当前帧提示；绑定片段保持位置并可撤销', async () => {
  const { owner, id, sequenceId, video, text } = await project(); setVideoEditView(id, { frame: 0, selection: video.id })
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, toJSON: () => ({}) })
  Object.defineProperty(SVGElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} })
  const readBox = vi.spyOn(trackingEdits, 'readVideoEditTrackingBox').mockResolvedValue([0.1, 0.1, 0.2, 0.3, 1])
  const onError = vi.fn(); const view = render(<><VideoEditTrackingPanel instance={owner} onError={onError} /><VideoEditTrackingOverlay instance={owner} onError={onError} /></>)
  fireEvent.click(view.getByLabelText('新建跟踪方式')); fireEvent.click(view.getByText('物体框 · 框选')); fireEvent.click(view.getByText('新建'))
  const svg = view.getByLabelText('节目跟踪选择')
  fireEvent.pointerDown(svg, { button: 0, clientX: 192, clientY: 108 }); fireEvent.pointerMove(svg, { clientX: 576, clientY: 432 }); fireEvent.pointerUp(svg, { clientX: 576, clientY: 432 }); await act(flush)
  const stored = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.trackers![0]
  expect(stored.method).toBe('box'); expect(stored.prompts[0].box?.[0]).toBeCloseTo(0.1)
  act(() => setVideoEditView(id, { frame: 10 })); await act(flush)
  fireEvent.pointerDown(svg, { button: 0, clientX: 192, clientY: 108 }); fireEvent.pointerMove(svg, { clientX: 384, clientY: 216 }); fireEvent.pointerUp(svg, { clientX: 384, clientY: 216 }); await act(flush)
  const corrected = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === video.id)!.trackers![0]
  expect(corrected.prompts.length).toBe(2); expect(corrected.prompts[1].timeUs).toBe(333333); expect(corrected.prompts[1].box?.[0]).toBeCloseTo(0.2)
  readBox.mockRestore()
  const request = status.mock.calls.at(-1)![0]
  const bytes = encodeSmartRegionSegment(createVideoEditTrackHeader({ method: 'box', model: 'vittrack', fps: 30, firstFrame: 0, frameCount: 1, sourceWidth: 1920, sourceHeight: 1080, promptFrames: [0], boxes: [[0.1, 0.1, 0.2, 0.3, 1]], summary: { tracked: 1, lost: 0 } }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes).buffer)))
  act(() => progress({ definition: request, status: { state: 'ready', result: result() } }))
  await act(async () => { await trackingEdits.bindVideoEditTracking(id, sequenceId, video.id, corrected.id, { clipId: text.id, scale: true }) })
  const following = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === text.id)!
  expect(following.follow?.clipId).toBe(video.id); expect(following.x).toBe(text.x); expect(following.y).toBe(text.y)
  expect(following.follow?.scaleReference).toBeGreaterThan(0)
  act(() => { undoVideoEdit(id) }); expect(getActiveVideoEditSequence(owner).clips.find(clip => clip.id === text.id)!.follow).toBeUndefined()
  expect(onError).not.toHaveBeenCalled()
})
