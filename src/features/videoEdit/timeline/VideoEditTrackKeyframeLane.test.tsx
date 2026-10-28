// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { expectButtonDisabled } from '@/tests/buttonAssertions'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView, subscribeVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { addVideoEditTextClipAt } from '../application/videoEditTimeline'
import { VideoEditTimelineCanvas } from './VideoEditTimelineCanvas'
import { TIMELINE_CAPTION_HEIGHT, timelineLayout } from './timelineGeometry'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let owner: VideoEditInstance
let clipId: string
let onError: ReturnType<typeof vi.fn>
function View(): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  return <VideoEditTimelineCanvas instance={owner} sequence={getActiveVideoEditSequence(owner)} pixels={2} onError={onError} />
}
const clip = () => getActiveVideoEditSequence(owner).clips.find(value => value.id === clipId)!

beforeEach(async () => {
  installHarnessNativeStorage(); onError = vi.fn()
  // 标尺上的渲染条读渲染缓存清单；本测试不涉及渲染缓存，按空缓存处理
  vi.spyOn(getPlatform().mediaCache, 'renderList').mockResolvedValue([])
  vi.stubGlobal('PointerEvent', class extends MouseEvent { readonly pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: () => undefined },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: () => undefined },
  })
  owner = await createVideoEditTestProject()
  const sequence = getActiveVideoEditSequence(owner)
  clipId = addVideoEditTextClipAt(owner.document.id, sequence.id, 0, 1)
  editVideoProject(owner.document.id, document => { document = structuredClone(document);
    const target = document.sequences.find(value => value.id === sequence.id)!.clips.find(value => value.id === clipId)!
    target.curves = { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 20, value: 0.2, interpolation: 'linear' }], opacity: [{ time: 10, value: 0.5, interpolation: 'hold' }] }
    return document
  })
})
afterEach(async () => { cleanup(); for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it('展开的轨道在片段行下方留出关键帧区，命中仍只认片段行', () => {
  const sequence = getActiveVideoEditSequence(owner); const video = sequence.tracks.find(track => track.kind === 'video')!
  const input = { viewportHeight: 600, split: 0.5, scroll: { video: 0, audio: 0 } }
  const plain = timelineLayout(sequence, input); const opened = timelineLayout(sequence, { ...input, lanes: new Map([[video.id, 92]]) })
  const before = plain.rows.find(row => row.track.id === video.id)!; const after = opened.rows.find(row => row.track.id === video.id)!
  expect(after).toMatchObject({ height: before.height, lane: 92, top: before.top - 92 })
  expect(opened.regions.video.content - plain.regions.video.content).toBe(92)
  expect(plain.rows.every(row => !('lane' in row))).toBe(true)
})

it('点三角展开轨道：每个有动画的属性一行；拖关键帧改时间是一步撤销，右键改定格，Delete 删除（重要记录 019）', async () => {
  const view = render(<View />)
  fireEvent.click(view.getByRole('button', { name: '展开视频 1关键帧' }))
  const lane = view.getByRole('group', { name: '视频 1关键帧' })
  expect([...lane.querySelectorAll('[data-video-edit-keyframe-lane-row]')].map(row => row.textContent)).toEqual(['位置', '不透明度'])
  // 收起时片段底边的小点提示在展开后不再画
  expect(document.querySelector(`[data-video-edit-clip="${clipId}"] [data-video-edit-keyframe-line]`)).toBeNull()

  const history = owner.past.length
  // 拖动中关键帧换位置会重新挂载，移动与松开由关键帧区接住
  fireEvent.pointerDown(view.getByRole('button', { name: /^位置关键帧 00:00:00:20/ }), { pointerId: 1, button: 0, clientX: 100 })
  fireEvent.pointerMove(lane, { pointerId: 1, clientX: 110 })
  fireEvent.pointerMove(lane, { pointerId: 1, clientX: 120 })
  fireEvent.pointerUp(lane, { pointerId: 1, clientX: 120 })
  await waitFor(() => expect(clip().curves?.x?.map(point => point.time)).toEqual([0, 30]))
  expect(owner.past).toHaveLength(history + 1)

  const moved = view.getByRole('button', { name: /^位置关键帧 00:00:01:00/ })
  fireEvent.contextMenu(moved, { clientX: 160, clientY: 200 })
  fireEvent.click(await view.findByRole('menuitem', { name: /定格/ }))
  await waitFor(() => expect(clip().curves?.x?.[1].interpolation).toBe('hold'))
  expect(view.getByRole('button', { name: /^位置关键帧 00:00:01:00 定格/ }).getAttribute('aria-pressed')).toBe('true')

  fireEvent.keyDown(view.getByRole('button', { name: /^位置关键帧 00:00:01:00/ }), { key: 'Delete' })
  await waitFor(() => expect(clip().curves?.x?.map(point => point.time)).toEqual([0]))
  expect(clip()).toBeDefined()
  expect(onError).not.toHaveBeenCalled()
})

it('删光一个分量的关键帧时留下那一帧的数值；播放头处的菱形按钮整行打关键帧', async () => {
  const view = render(<View />)
  fireEvent.click(view.getByRole('button', { name: '展开视频 1关键帧' }))
  fireEvent.keyDown(view.getByRole('button', { name: /^不透明度关键帧/ }), { key: 'Delete' })
  await waitFor(() => expect(clip().curves?.opacity).toBeUndefined())
  expect(clip().opacity).toBe(0.5)
  // 播放头在 0 帧：位置一行已有关键帧，菱形按钮是“删除”；挪开播放头后变“添加”，X、Y 两个分量一起打
  act(() => setVideoEditView(owner.document.id, { frame: 12 }))
  fireEvent.click(view.getByRole('button', { name: '下一个位置关键帧' }))
  await waitFor(() => expect(owner.frame).toBe(20))
  act(() => setVideoEditView(owner.document.id, { frame: 12 }))
  fireEvent.click(view.getByRole('button', { name: '上一个位置关键帧' }))
  await waitFor(() => expect(owner.frame).toBe(0))
  act(() => setVideoEditView(owner.document.id, { frame: 12 }))
  fireEvent.click(await view.findByRole('button', { name: '添加位置关键帧' }))
  await waitFor(() => expect(clip().curves?.y?.map(point => point.time)).toEqual([12]))
  expect(clip().curves?.x?.map(point => point.time)).toEqual([0, 12, 20])
  expect(onError).not.toHaveBeenCalled()
})

it('切到速度曲线：左边选属性，选中的关键帧可改直线、曲线或定格', async () => {
  const view = render(<View />)
  fireEvent.click(view.getByRole('button', { name: '展开视频 1关键帧' }))
  fireEvent.click(view.getByRole('radio', { name: '速度曲线' }))
  const curve = await view.findByLabelText('位置速度曲线')
  const shapes = view.getByRole('radiogroup', { name: '选中关键帧的形状' })
  for (const radio of shapes.querySelectorAll<HTMLElement>('[role="radio"]')) expectButtonDisabled(radio)
  fireEvent.pointerDown(curve.querySelector('[data-curve-time="0"]')!, { pointerId: 1, button: 0, clientX: 0, clientY: 50 })
  fireEvent.pointerUp(curve, { pointerId: 1 })
  fireEvent.click(view.getByRole('radio', { name: '曲线' }))
  await waitFor(() => expect(clip().curves?.x?.[0].interpolation).toBe('ease'))
  fireEvent.click(view.getByRole('button', { name: '不透明度' }))
  expect(view.getByLabelText('不透明度速度曲线')).toBeTruthy()
  expect(onError).not.toHaveBeenCalled()
})

it('时间线矮时展开最下面的视频轨：先借声音区的空余挪分界线，再把关键帧区滚到字幕轨下方，不被盖住', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(220)
  const view = render(<View />)
  const divider = () => Number.parseFloat(document.querySelector<HTMLElement>('[data-video-edit-track-divider]')!.style.top)
  const before = divider()
  fireEvent.click(view.getByRole('button', { name: '展开视频 1关键帧' }))
  const lane = view.getByRole('group', { name: '视频 1关键帧' })
  await waitFor(() => expect(divider()).toBeGreaterThan(before))
  await waitFor(() => expect(Number.parseFloat(lane.style.top)).toBeGreaterThanOrEqual(TIMELINE_CAPTION_HEIGHT))
})
