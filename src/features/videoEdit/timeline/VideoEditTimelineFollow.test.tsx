import { useSettingsStore } from '@/stores/settingsStore'
import { createVideoEditTestProject as createVideoEditProject } from '../application/videoEditDocumentTestKit'
// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { VideoEditTimeline } from '../VideoEditTimeline'
import { closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, setVideoEditView, subscribeVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { TIMELINE_HEADER_WIDTH } from './timelineGeometry'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
// 渲染栏是时间线主体的直接子组件：它每渲染一次，就是整条时间线重渲染了一次。
const canvasRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('./VideoEditRenderBar', () => ({ VideoEditRenderBar: () => { canvasRenders.count++; return null } }))

const CLIENT_WIDTH = 900
const center = (CLIENT_WIDTH - TIMELINE_HEADER_WIDTH) / 2
let owner: VideoEditInstance
let now = 0
const onError = vi.fn()
function View(): React.ReactElement { useSyncExternalStore(subscribeVideoEdit, videoEditRevision); return <VideoEditTimeline instance={owner} onError={onError} /> }
const setup = (): HTMLElement => render(<View />).getByRole('region', { name: '时间线编辑区域' })
const play = (frame: number, playbackDirection: 1 | -1 = 1): void => act(() => { setVideoEditView(owner.document.id, { frame, playing: true, playbackDirection }, true) })
/** 浏览器写 scrollLeft 后会发 scroll 事件，jsdom 不发，这里补上。 */
const frame = (host: HTMLElement, value: number): void => { act(() => { setVideoEditView(owner.document.id, { frame: value }, true) }); fireEvent.scroll(host) }

beforeEach(async () => {
  installHarnessNativeStorage(); onError.mockClear(); canvasRenders.count = 0; now = 1000
  useSettingsStore.setState({ videoEditTimelineAutoScroll: true })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(getPlatform().video, 'getFilmstripFrame').mockImplementation((_request, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('用例结束', 'AbortError')))))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: CLIENT_WIDTH, bottom: 300, width: CLIENT_WIDTH, height: 300, x: 0, y: 0, toJSON: () => ({}) })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(CLIENT_WIDTH)
  owner = (await createVideoEditProject())!
  editVideoProject(owner.document.id, document => { document = structuredClone(document)
    document.media.push({ id: 'media', name: '视频', path: 'D:/fixture/video.mp4', kind: 'video', width: 64, height: 64, durationSeconds: 200, hasAudio: false })
    document.items.push({ id: 'item', name: '视频', kind: 'video', mediaId: 'media' })
    const sequence = document.sequences[0]
    sequence.clips = [{ ...makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, track: sequence.tracks.find(track => track.kind === 'video')!.index }), duration: 6000 }]
    return document
  })
})
afterEach(async () => { cleanup(); await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage(); useSettingsStore.setState({ videoEditTimelineAutoScroll: true }) })

it('正放时走到中间才开始滚并保持在中间；暂停后不再动，也不抢用户滚到的位置', () => {
  const host = setup(); const pixels = 60 * owner.zoom / getActiveVideoEditSequence(owner).fps
  play(10); expect(host.scrollLeft).toBe(0)
  frame(host, Math.floor(center / pixels) - 1); expect(host.scrollLeft).toBe(0)
  frame(host, 2000); expect(2000 * pixels - host.scrollLeft).toBeCloseTo(center)
  frame(host, 2500); expect(2500 * pixels - host.scrollLeft).toBeCloseTo(center)
  act(() => { setVideoEditView(owner.document.id, { playing: false }) })
  const paused = host.scrollLeft
  frame(host, 3000); expect(host.scrollLeft).toBe(paused)
  host.scrollLeft = 40; fireEvent.scroll(host)
  frame(host, 4000); expect(host.scrollLeft).toBe(40)
  expect(onError).not.toHaveBeenCalled()
})

it('关掉设置后播放不滚动，播放中关掉也立刻停', () => {
  const host = setup()
  useSettingsStore.setState({ videoEditTimelineAutoScroll: false })
  play(3000); expect(host.scrollLeft).toBe(0)
  act(() => useSettingsStore.setState({ videoEditTimelineAutoScroll: true }))
  frame(host, 3001); const following = host.scrollLeft; expect(following).toBeGreaterThan(0)
  act(() => useSettingsStore.setState({ videoEditTimelineAutoScroll: false }))
  frame(host, 3500); expect(host.scrollLeft).toBe(following)
})

it('播放中手动滚动：跟随让开，停手一段时间后回到播放头', () => {
  const host = setup(); const pixels = 60 * owner.zoom / getActiveVideoEditSequence(owner).fps
  play(2000); frame(host, 2001)
  host.scrollLeft = 100; fireEvent.scroll(host)
  frame(host, 2002); expect(host.scrollLeft).toBe(100)
  now += 1000; frame(host, 2003); expect(host.scrollLeft).toBe(100)
  now += 1500; frame(host, 2004); expect(2004 * pixels - host.scrollLeft).toBeCloseTo(center)
})

it('跟随滚动不让整条时间线逐帧重渲染，停下时收回精确的可见范围', () => {
  const host = setup(); const pixels = 60 * owner.zoom / getActiveVideoEditSequence(owner).fps
  const ticks = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[data-video-edit-ruler] span.font-mono:not([role])')]
  play(1000)
  frame(host, 1001)
  const before = canvasRenders.count
  const frames = 300
  for (let value = 1002; value < 1002 + frames; value++) frame(host, value)
  expect(frames * pixels).toBeGreaterThan(256)
  expect(canvasRenders.count - before).toBeLessThan(5)
  // 滚动中刻度盖住实际可见区右缘，不露空白
  const right = host.scrollLeft + CLIENT_WIDTH - TIMELINE_HEADER_WIDTH
  expect(Math.max(...ticks().map(tick => Number.parseFloat(tick.style.left)))).toBeGreaterThanOrEqual(right)
  const during = canvasRenders.count
  act(() => { setVideoEditView(owner.document.id, { playing: false }) })
  expect(canvasRenders.count).toBeGreaterThan(during)
})

it('倒放镜像：播放头退到中间才滚，回到开头滚到 0', () => {
  const host = setup(); const pixels = 60 * owner.zoom / getActiveVideoEditSequence(owner).fps
  host.scrollLeft = 1000; fireEvent.scroll(host)
  const frameAt = (x: number): number => Math.round((host.scrollLeft + x) / pixels)
  play(frameAt(center + 200), -1); expect(host.scrollLeft).toBe(1000)
  const atCenter = frameAt(center) - 10
  frame(host, atCenter); expect(atCenter * pixels - host.scrollLeft).toBeCloseTo(center)
  frame(host, 5); expect(host.scrollLeft).toBe(0)
})
