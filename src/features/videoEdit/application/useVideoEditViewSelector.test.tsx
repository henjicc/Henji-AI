// @vitest-environment jsdom
import { Profiler, type ReactNode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { videoEditSubtitleStyleSchema } from '@/core/videoEdit/subtitleStyle'
import { closeAllVideoEdits, createVideoEditTestProject } from './videoEditDocumentTestKit'
import { appendVideoEditClip, getActiveVideoEditSequence, setVideoEditTimelineView, setVideoEditView, type VideoEditInstance } from './videoEditService'
import { createVideoEditCaption } from './videoEditTimedContent'
import { VideoEditToolbar } from '../VideoEditApp'
import { VideoEditTimelineInOut } from '../timeline/VideoEditTimelineInOut'
import { VideoEditRenderBar } from '../timeline/VideoEditRenderBar'
import { VideoEditInOutDuration } from '../timeline/VideoEditTimelineTransport'
import { VideoEditTextOverlay } from '../panels/VideoEditTextOverlay'
import { VideoEditCodeElementOverlay } from '../VideoEditCodeElementOverlay'
import * as captionTargets from '../panels/videoEditCaptionTextTargets'

vi.mock('react-virtuoso', () => ({ Virtuoso: () => <div /> }))
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (text: string) => ({ width: [...text].length * 20 }) } as unknown as CanvasRenderingContext2D)
})
afterEach(async () => { cleanup(); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

/** 和时间线拖动播放头一样：逐帧写 frame 并标 scrubbing，松手时只把 scrubbing 写回 false。 */
function scrub(owner: VideoEditInstance, from: number, frames: number): void {
  for (let frame = from; frame < from + frames; frame++) act(() => { setVideoEditView(owner.document.id, { playing: false, frame, scrubbing: true }) })
}
function release(owner: VideoEditInstance): void { act(() => { setVideoEditView(owner.document.id, { scrubbing: false }) }) }
function counted(commits: Record<string, number>, id: string, children: ReactNode): React.ReactElement {
  commits[id] = 0
  return <Profiler id={id} onRender={() => { commits[id]++ }}>{children}</Profiler>
}

it('拖动播放头 30 帧，命令带不重绘；换工具与选择时立即更新', async () => {
  const owner = await createVideoEditTestProject(); appendVideoEditClip(owner.document.id)
  const commits: Record<string, number> = {}
  const view = render(counted(commits, 'toolbar', <VideoEditToolbar instance={owner} api={null} run={operation => { void operation() }} onNotice={vi.fn()} />))
  const before = commits.toolbar
  scrub(owner, 1, 30); release(owner)
  expect(commits.toolbar - before).toBe(0)
  expect(view.container.querySelector('[data-video-edit-annotation-options]')).toBeNull()
  act(() => { setVideoEditTimelineView(owner.document.id, { tool: 'annotate' }) })
  expect(view.container.querySelector('[data-video-edit-annotation-options]')).not.toBeNull()
  const afterTool = commits.toolbar
  const clipId = getActiveVideoEditSequence(owner).clips[0].id
  act(() => { setVideoEditView(owner.document.id, { selection: owner.selection === clipId ? null : clipId }) })
  expect(commits.toolbar).toBeGreaterThan(afterTool)
})

it('入出点区间、入出点时长与渲染条拖动中不重绘，入出点变化时更新', async () => {
  const owner = await createVideoEditTestProject(); appendVideoEditClip(owner.document.id)
  act(() => { setVideoEditTimelineView(owner.document.id, { inFrame: 10, outFrame: 40 }) })
  const sequence = getActiveVideoEditSequence(owner)
  const commits: Record<string, number> = {}
  const view = render(<>
    {counted(commits, 'range', <VideoEditTimelineInOut instance={owner} sequence={sequence} fps={sequence.fps} duration={120} pixels={2} onError={vi.fn()} />)}
    {counted(commits, 'duration', <VideoEditInOutDuration instance={owner} />)}
    {counted(commits, 'bar', <VideoEditRenderBar instance={owner} pixels={2} />)}
  </>)
  const before = { ...commits }
  scrub(owner, 1, 30); release(owner)
  expect({ range: commits.range - before.range, duration: commits.duration - before.duration, bar: commits.bar - before.bar }).toEqual({ range: 0, duration: 0, bar: 0 })
  act(() => { setVideoEditTimelineView(owner.document.id, { inFrame: 20 }) })
  expect(view.container.querySelector('[data-video-edit-in-out-range]')?.getAttribute('data-video-edit-in-out-range')).toBe('20-40')
  expect(view.container.querySelector('[data-video-edit-in-out-duration]')?.getAttribute('data-video-edit-in-out-duration')).toBe('20')
})

it('文字与代码元素覆盖层拖动中不逐帧排版，松手后按最终帧补一次', async () => {
  const owner = await createVideoEditTestProject()
  const style = videoEditSubtitleStyleSchema.parse({})
  createVideoEditCaption(owner.document.id, owner.activeSequenceId, { start: 0, duration: 60, text: '第一句', style })
  const second = createVideoEditCaption(owner.document.id, owner.activeSequenceId, { start: 60, duration: 60, text: '第二句', style })
  act(() => { setVideoEditTimelineView(owner.document.id, { tool: 'select' }); setVideoEditView(owner.document.id, { frame: 10 }) })
  const layout = vi.spyOn(captionTargets, 'videoEditCaptionTextTargets')
  const commits: Record<string, number> = {}
  const view = render(<div>
    {counted(commits, 'text', <VideoEditTextOverlay instance={owner} onError={vi.fn()} />)}
    {counted(commits, 'elements', <VideoEditCodeElementOverlay instance={owner} enabled onError={vi.fn()} />)}
  </div>)
  const captionsShown = (): (string | null)[] => [...view.container.querySelectorAll('[data-video-edit-caption][data-caption-field="text"]')].map(node => node.getAttribute('data-video-edit-caption'))
  expect(captionsShown()).toHaveLength(1)
  // 进入拖动时收起命中目标要重绘，之后逐帧都不重绘、不排版。
  scrub(owner, 11, 1)
  expect(captionsShown()).toEqual([])
  const before = { ...commits }; const layouts = layout.mock.calls.length
  scrub(owner, 12, 79)
  expect({ text: commits.text - before.text, elements: commits.elements - before.elements, layouts: layout.mock.calls.length - layouts }).toEqual({ text: 0, elements: 0, layouts: 0 })
  release(owner)
  expect(commits.text).toBeGreaterThan(before.text); expect(commits.elements).toBeGreaterThan(before.elements)
  expect(layout.mock.calls.length).toBeGreaterThan(layouts)
  expect(owner.frame).toBe(90)
  expect(captionsShown()).toEqual([second])
})
