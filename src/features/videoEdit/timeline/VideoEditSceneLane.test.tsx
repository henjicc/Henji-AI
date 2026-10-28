// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { GOLDEN_SCENE_DECLARATION, goldenScene } from '@/core/videoEdit/scene/sceneTestFixtures'
import { videoEditFps } from '@/core/videoEdit/time'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { useNavigationStore } from '@/stores/navigationStore'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'
import { readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from '../application/videoEditCodeState'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { selectedVideoEditSceneRecord, selectVideoEditSceneRecord } from '../application/videoEditSceneSelection'
import { closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, subscribeVideoEdit, videoEditCommittedDocument, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditTimelineCanvas } from './VideoEditTimelineCanvas'
import { TIMELINE_HEADER_WIDTH } from './timelineGeometry'
import { keyframeLaneHeight, KEYFRAME_LANE_HEADER, KEYFRAME_LANE_ROW, sceneLaneRowCount } from './keyframeLaneGeometry'

vi.mock('../application/videoEditAuthorInspection', () => ({ inspectVideoEditAuthor: async (bundle: ReturnType<typeof testAuthorBundle>) => testAuthorProgram(bundle) }))
vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const PIXELS = 2
/** 黄金声明加两类：起止都按录屏秒锚定的标注（结束锚定），挂在段落下的备注（连同子记录删除）。 */
const DECLARATION = {
  ...GOLDEN_SCENE_DECLARATION,
  kinds: {
    ...GOLDEN_SCENE_DECLARATION.kinds,
    note: { title: '备注', parent: ['segment'], at: 'at', end: 'end', influence: 'span', lane: { style: 'block' }, fields: { at: { type: 'time' }, end: { type: 'time' } } },
    callout: { title: '标注', at: 'at', end: 'until', influence: 'span', footage: 'win', lane: { style: 'block' }, fields: { at: { type: 'time', anchor: 'footage' }, until: { type: 'time', anchor: 'footage' }, win: { type: 'ref', to: ['window'] } } },
  },
}
const source = `export default {name:"片子",kind:"generator",mode:"dynamic",width:1920,height:1080,durationSeconds:10,params:[{key:"scene",type:"scene",title:"片子数据",schema:${JSON.stringify(DECLARATION)}}],draw(ctx,t,p){}}`
let owner: VideoEditInstance
let onError: ReturnType<typeof vi.fn>
let frames: FrameRequestCallback[] = []
function View(): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  return <VideoEditTimelineCanvas instance={owner} sequence={getActiveVideoEditSequence(owner)} pixels={PIXELS} onError={onError} />
}
const fps = () => videoEditFps(getActiveVideoEditSequence(owner).frameRate)
const record = (id: string) => owner.document.scenes![0].records.find(item => item.id === id)
const item = (id: string) => document.querySelector(`[data-video-edit-scene-item="${id}"]`) as HTMLElement
/** 片段从第 0 帧开始、正常速度：剪后 t 秒在 x = 轨道头宽 + t·fps·像素；n 帧的位移是 n·像素。 */
const x = (seconds: number) => TIMELINE_HEADER_WIDTH + seconds * fps() * PIXELS
const runFrames = () => act(() => { const pending = frames; frames = []; for (const callback of pending) callback(0) })
function dragBy(lane: HTMLElement, target: HTMLElement, from: number, frameCount: number, options: { pointerId?: number; shiftKey?: boolean } = {}): void {
  const pointerId = options.pointerId ?? 1, to = from + frameCount * PIXELS
  fireEvent.pointerDown(target, { pointerId, button: 0, clientX: from })
  fireEvent.pointerMove(lane, { pointerId, clientX: to, shiftKey: options.shiftKey })
  fireEvent.pointerUp(lane, { pointerId, clientX: to, shiftKey: options.shiftKey })
}

beforeEach(async () => {
  installHarnessNativeStorage(); useNavigationStore.getState().setActiveWorkspace('videoEdit'); onError = vi.fn(); frames = []
  vi.spyOn(getPlatform().mediaCache, 'renderList').mockResolvedValue([])
  vi.stubGlobal('PointerEvent', class extends MouseEvent { readonly pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  const raf = (callback: FrameRequestCallback) => { frames.push(callback); return frames.length }
  vi.stubGlobal('requestAnimationFrame', raf); vi.stubGlobal('cancelAnimationFrame', () => undefined)
  window.requestAnimationFrame = raf; window.cancelAnimationFrame = () => undefined
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: () => undefined },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: () => undefined },
  })
  owner = await createVideoEditTestProject()
  const program = testAuthorProgram(testAuthorBundle({ entry: 'main.ts', files: { 'main.ts': source }, apiVersion: 5 }))
  const version = { id: 'v', ...testCodeManifest(source, owner.document), apiVersion: 5 as const, languageVersion: program.languageVersion }
  rememberVideoEditCodeMetadata(owner, 'd', version, program)
  editVideoProject(owner.document.id, document => { document = structuredClone(document)
    document.media.push({ id: 'screen', name: '录屏', path: 'D:/screen.mp4', kind: 'video', durationSeconds: 20, width: 1920, height: 1080 })
    document.codeMaterials = [{ id: 'd', name: '片子', defaultVersionId: 'v', versions: [version] }]
    const scene = goldenScene('screen')
    scene.records.push({ id: 'no-1', kind: 'note', parent: 'seg-switch', values: { at: 1, end: 2 } }, { id: 'co-1', kind: 'callout', values: { at: { src: 0.6 }, until: { src: 1 }, win: 'win-demo' } },
      // 只有结束按录屏秒锚定的标注
      { id: 'co-2', kind: 'callout', values: { at: 0.6, until: { src: 1 }, win: 'win-demo' } })
    document.scenes = [scene]
    document.items.push({ id: 'i', name: '片子', kind: 'code', code: { definitionId: 'd', versionId: 'v', parameters: { ...validateCodeMaterialParameters(program), scene: { kind: 'scene', sceneId: 'golden-scene' } } } })
    document.sequences[0].clips.push(makeVideoEditItemClip(document, 'i', document.sequences[0].id, { frame: 0 }, readVideoEditCodeMetadata(owner, document)))
    return document
  })
  // 吸附与本组用例无关（各边离片段边、播放头都超过吸附距离，关掉免得受默认值影响）
  setVideoEditTimelineView(owner.document.id, { snapping: false })
})
afterEach(async () => { cleanup(); useAlertDialogStore.setState({ queue: [] }); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

async function openLane(view: ReturnType<typeof render>): Promise<HTMLElement> {
  fireEvent.click(view.getByRole('button', { name: '展开视频 1' }))
  fireEvent.click(await view.findByRole('menuitem', { name: /片子数据/ }))
  const lane = await view.findByRole('group', { name: '视频 1片子数据' })
  await waitFor(() => expect(item('seg-switch')).toBeTruthy())
  return lane
}

it('子轨道高度按显示的子行数算，收起的组算一行', () => {
  const groups = [{ kind: 'a', rows: [1, 2, 3] }, { kind: 'b', rows: [1] }]
  expect(sceneLaneRowCount(groups, new Set())).toBe(4)
  expect(sceneLaneRowCount(groups, new Set(['a']))).toBe(2)
  expect(keyframeLaneHeight('scene', 4)).toBe(KEYFRAME_LANE_HEADER + 4 * KEYFRAME_LANE_ROW + 4)
  expect(keyframeLaneHeight('scene', 0)).toBe(keyframeLaneHeight('scene', 1))
})

it('展开入口可选片子数据：按声明顺序成组，名称与面板同一套称呼，剪切口零宽、超出片段的夹到边缘并标记', async () => {
  const view = render(<View />)
  const lane = await openLane(view)
  expect([...lane.querySelectorAll('[data-video-edit-scene-group-row]')].map(row => row.getAttribute('data-video-edit-scene-group-row'))).toEqual(['segment', 'shot', 'focusKey', 'cut', 'note', 'callout', 'callout'])
  expect(item('seg-switch').getAttribute('aria-label')).toMatch(/^交换机 /)
  // 没有名称的记录叫“类型 + 序号”，与片子数据面板的记录树一致
  expect(item('sh-1').getAttribute('aria-label')).toMatch(/^窗口内容 1 /)
  expect(item('fk-1').getAttribute('data-scene-style')).toBe('key')
  // 窗口没有结束时刻：最后一项窗口内容一直放下去，在片段末端夹住并标出
  expect(item('sh-2').getAttribute('data-clipped')).toBe('right')
  expect(item('cut-1').getAttribute('data-scene-style')).toBe('cut')
  expect(item('cut-1').style.width).toBe('')
  fireEvent.click(within(lane).getByRole('button', { name: '收起段落' }))
  expect(item('seg-switch')).toBeTruthy()
  expect(lane.querySelectorAll('[data-video-edit-scene-group-row]')).toHaveLength(7)
  fireEvent.click(view.getByRole('button', { name: '收起视频 1片子数据' }))
  expect(view.queryByRole('group', { name: '视频 1片子数据' })).toBeNull()
  expect(onError).not.toHaveBeenCalled()
})

it('点一下（没越过起拖阈值）只选中，不开手势、不写回', async () => {
  const view = render(<View />)
  const lane = await openLane(view)
  const history = owner.past.length, before = record('seg-switch')
  fireEvent.pointerDown(item('seg-switch'), { pointerId: 1, button: 0, clientX: x(1) })
  fireEvent.pointerMove(lane, { pointerId: 1, clientX: x(1) + 2 })
  fireEvent.pointerUp(lane, { pointerId: 1, clientX: x(1) + 2 })
  expect(selectedVideoEditSceneRecord(owner)).toEqual({ sceneId: 'golden-scene', recordId: 'seg-switch' })
  expect(record('seg-switch')).toBe(before)
  expect(owner.past).toHaveLength(history)
})

it('拖块体按整帧整条挪动、松手一步撤销；拖回原处不留撤销步', async () => {
  const view = render(<View />)
  const lane = await openLane(view)
  const history = owner.past.length
  dragBy(lane, item('seg-switch'), x(1), -6)
  await waitFor(() => expect(record('seg-switch')?.values.start).toBeCloseTo(0.5 - 6 / fps(), 6))
  expect(record('seg-switch')?.values.end).toBeCloseTo(2.5 - 6 / fps(), 6)
  expect(owner.past).toHaveLength(history + 1)
  expect(item('seg-switch').getAttribute('aria-pressed')).toBe('true')
  // 不足一帧的指针位移落回原处：取消手势
  fireEvent.pointerDown(item('seg-switch'), { pointerId: 2, button: 0, clientX: x(1) })
  fireEvent.pointerMove(lane, { pointerId: 2, clientX: x(1) + 3 * PIXELS })
  fireEvent.pointerMove(lane, { pointerId: 2, clientX: x(1) + 0.4 * PIXELS })
  fireEvent.pointerUp(lane, { pointerId: 2, clientX: x(1) + 0.4 * PIXELS })
  await act(async () => { await Promise.resolve() })
  expect(owner.past).toHaveLength(history + 1)
  expect(onError).not.toHaveBeenCalled()
})

it('按录屏秒锚定的开始与结束拖动后仍是 {src}；按住 Shift 改写成秒数', async () => {
  const view = render(<View />)
  const lane = await openLane(view)
  const step = 6 / fps()
  dragBy(lane, item('fk-1'), x(0.8), 6)
  await waitFor(() => expect((record('fk-1')?.values.at as { src: number }).src).toBeCloseTo(0.8 + step, 6))
  // 标注（按录屏秒锚定的起止）整条拖动：起止都保持锚定
  const half = 3 / fps()
  dragBy(lane, item('co-1'), x(0.8), 3, { pointerId: 2 })
  await waitFor(() => expect((record('co-1')?.values.at as { src: number }).src).toBeCloseTo(0.6 + half, 6))
  expect((record('co-1')?.values.until as { src: number }).src).toBeCloseTo(1 + half, 6)
  // 拖右边缘：结束字段也保持锚定，开始不动
  dragBy(lane, item('co-1').querySelector('[data-video-edit-scene-edge="end"]') as HTMLElement, x(1 + half), 6, { pointerId: 3 })
  await waitFor(() => expect((record('co-1')?.values.until as { src: number }).src).toBeCloseTo(1 + half + step, 6))
  expect((record('co-1')?.values.at as { src: number }).src).toBeCloseTo(0.6 + half, 6)
  dragBy(lane, item('fk-1'), x(0.8 + step), 3, { pointerId: 4, shiftKey: true })
  await waitFor(() => expect(record('fk-1')?.values.at).toBeCloseTo(0.8 + step + 3 / fps(), 6))
  expect(onError).not.toHaveBeenCalled()
})

it('锚定的记录整条往左拖过自身长度：先换开始再反解结束，两端锚定与只有结束锚定都能落下', async () => {
  const view = render(<View />)
  const lane = await openLane(view)
  // 标注长 0.4 秒，往左拖约 0.5 秒（整帧）
  const frameCount = -Math.round(0.5 * fps()), shift = frameCount / fps()
  dragBy(lane, item('co-1'), x(0.8), frameCount)
  await waitFor(() => expect((record('co-1')?.values.at as { src: number }).src).toBeCloseTo(0.6 + shift, 6))
  expect((record('co-1')?.values.until as { src: number }).src).toBeCloseTo(1 + shift, 6)
  dragBy(lane, item('co-2'), x(0.8), frameCount, { pointerId: 2 })
  await waitFor(() => expect(record('co-2')?.values.at).toBeCloseTo(0.6 + shift, 6))
  expect((record('co-2')?.values.until as { src: number }).src).toBeCloseTo(1 + shift, 6)
  expect(onError).not.toHaveBeenCalled()
})

it('在时间线上点选片段清掉记录选择', async () => {
  const view = render(<View />)
  await openLane(view)
  act(() => selectVideoEditSceneRecord(owner.document.id, { sceneId: 'golden-scene', recordId: 'sh-1' }))
  const clip = document.querySelector('[data-video-edit-clip]') as HTMLElement
  fireEvent.pointerDown(clip, { pointerId: 9, button: 0, clientX: x(5) })
  fireEvent.pointerUp(clip, { pointerId: 9, clientX: x(5) })
  expect(selectedVideoEditSceneRecord(owner)).toBeUndefined()
})

it('拖动按帧预览、只预览不提交；Esc 取消回到原样', async () => {
  const view = render(<View />)
  const lane = await openLane(view)
  const history = owner.past.length
  fireEvent.pointerDown(item('seg-switch'), { pointerId: 1, button: 0, clientX: x(1) })
  fireEvent.pointerMove(lane, { pointerId: 1, clientX: x(1) - 20 * PIXELS })
  fireEvent.pointerMove(lane, { pointerId: 1, clientX: x(1) - 6 * PIXELS })
  runFrames()
  // 一帧只套用最新的一次移动
  expect(record('seg-switch')?.values.start).toBeCloseTo(0.5 - 6 / fps(), 6)
  expect(videoEditCommittedDocument(owner).scenes![0].records.find(value => value.id === 'seg-switch')?.values).toMatchObject({ start: 0.5, end: 2.5 })
  fireEvent.keyDown(lane, { key: 'Escape' })
  expect(record('seg-switch')?.values).toMatchObject({ start: 0.5, end: 2.5 })
  fireEvent.pointerUp(lane, { pointerId: 1, clientX: x(1) - 6 * PIXELS })
  expect(owner.past).toHaveLength(history)
  expect(onError).not.toHaveBeenCalled()
})

it('Delete 只删这里显示的选中记录；连同子记录时先确认', async () => {
  const view = render(<View />)
  const lane = await openLane(view)
  const history = owner.past.length
  // 片子数据面板里选中的“高亮”没有显示在子轨道上：在子轨道上按 Delete 不删
  act(() => selectVideoEditSceneRecord(owner.document.id, { sceneId: 'golden-scene', recordId: 'fo-1' }))
  fireEvent.keyDown(lane, { key: 'Delete' })
  await act(async () => { await Promise.resolve() })
  expect(record('fo-1')).toBeDefined()

  fireEvent.pointerDown(item('sh-1'), { pointerId: 1, button: 0, clientX: x(0.5) })
  fireEvent.pointerUp(lane, { pointerId: 1, clientX: x(0.5) })
  fireEvent.keyDown(lane, { key: 'Delete' })
  await waitFor(() => expect(record('sh-1')).toBeUndefined())
  expect(selectedVideoEditSceneRecord(owner)).toBeUndefined()
  expect(owner.past).toHaveLength(history + 1)

  // 段落下挂着备注：先确认，取消就不删
  fireEvent.pointerDown(item('seg-switch'), { pointerId: 2, button: 0, clientX: x(1) })
  fireEvent.pointerUp(lane, { pointerId: 2, clientX: x(1) })
  fireEvent.keyDown(lane, { key: 'Delete' })
  await waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  expect(useAlertDialogStore.getState().queue[0].message).toContain('连同下面 1 条记录一起删除')
  act(() => useAlertDialogStore.getState().dismissCurrent())
  await act(async () => { await Promise.resolve() })
  expect(record('seg-switch')).toBeDefined()
  fireEvent.keyDown(lane, { key: 'Delete' })
  await waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  // 确认弹窗期间子记录被别处删掉：确认后按当时的数据重取要删的集合，照样删掉，不整笔报错
  act(() => { editVideoProject(owner.document.id, document => ({ ...document, scenes: [{ ...document.scenes![0], records: document.scenes![0].records.filter(value => value.id !== 'no-1') }] })) })
  act(() => useAlertDialogStore.getState().confirmCurrent())
  await waitFor(() => expect(record('seg-switch')).toBeUndefined())
  expect(record('no-1')).toBeUndefined()
  expect(owner.past).toHaveLength(history + 3)
  expect(onError).not.toHaveBeenCalled()
})
