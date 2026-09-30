// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DockviewApi } from 'dockview-react'
import { createVideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditInstance } from '../application/videoEditService'
import { VideoEditDock } from './VideoEditDock'
import { dockVideoEditPanel, resetVideoEditLayout, showVideoEditPanel } from './videoEditDockLayout'

const lifetime = vi.hoisted(() => ({ created: 0, live: 0, peak: 0, disposed: 0 }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
vi.mock('../panels/VideoEditProjectPanel', () => ({ VideoEditProjectPanel: () => <div>项目素材</div> }))
vi.mock('../panels/VideoEditEffectsPanel', () => ({ VideoEditEffectsPanel: () => <div>效果控件</div> }))
vi.mock('../VideoEditTimeline', () => ({ VideoEditTimeline: () => <div>时间线</div> }))
vi.mock('../VideoEditPreview', async () => {
  const { useEffect } = await import('react')
  return { VideoEditPreview: function Preview(): React.ReactElement {
    useEffect(() => {
      lifetime.created++; lifetime.live++; lifetime.peak = Math.max(lifetime.peak, lifetime.live)
      return () => { lifetime.live--; lifetime.disposed++ }
    }, [])
    return <div>节目画面</div>
  } }
})

beforeEach(() => {
  localStorage.clear(); lifetime.created = 0; lifetime.live = 0; lifetime.peak = 0; lifetime.disposed = 0
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 860))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('真实 Dockview React 移动、隐藏标签、缩放和重置不卸载节目；关闭释放，重开只有一个视图', () => {
  const document = createVideoEditDocument('布局验收')
  const instance: VideoEditInstance = { document, activeSequenceId: document.sequences[0].id, sequenceViews: new Map(), path: 'D:/layout.henji-video', dirty: false, error: null, past: [], future: [], selection: null, frame: 17, playing: false, busy: false, version: 0 }
  let api: DockviewApi | null = null
  const onApiChange = (value: DockviewApi | null): void => { api = value }
  const onError = vi.fn()
  const view = render(<VideoEditDock instance={instance} onError={onError} onApiChange={onApiChange} />)
  const dock = api as unknown as DockviewApi
  expect(lifetime).toMatchObject({ created: 1, live: 1, peak: 1, disposed: 0 })
  act(() => {
    dock.layout(1440, 860)
    const program = dock.getPanel('program')!
    dock.getPanel('timeline')!.api.moveTo({ group: program.group, position: 'center' })
    dock.layout(960, 640)
    dock.addFloatingGroup(program)
    dockVideoEditPanel(dock, program)
    resetVideoEditLayout(dock)
  })
  expect(lifetime).toMatchObject({ created: 1, live: 1, peak: 1, disposed: 0 })
  expect(instance.document).toBe(document); expect(instance.past).toHaveLength(0); expect(instance.frame).toBe(17)
  act(() => dock.getPanel('program')!.api.close())
  expect(lifetime).toMatchObject({ live: 0, disposed: 1 })
  act(() => { showVideoEditPanel(dock, 'program'); showVideoEditPanel(dock, 'program') })
  expect(lifetime).toMatchObject({ created: 2, live: 1, peak: 1, disposed: 1 })
  expect(onError).not.toHaveBeenCalled()
  view.unmount()
  expect(lifetime).toMatchObject({ live: 0, disposed: 2 })
})
