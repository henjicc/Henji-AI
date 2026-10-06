// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DockviewApi } from 'dockview-react'
import { createVideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditInstance } from '../application/videoEditService'
import { VideoEditDock } from './VideoEditDock'
import { dockVideoEditPanel, resetVideoEditLayout, showVideoEditPanel } from './videoEditDockLayout'
import { listVideoEditPopouts, popOutVideoEditPanel, resetVideoEditWorkspaceLayout } from './popout/videoEditPopouts'
import { VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY } from './popout/videoEditPopoutLayout'
import { videoEditKeyboardCommand } from '../application/videoEditKeyboard'
import { createPopoutTestHost } from './popout/videoEditPopout.testSupport'

const lifetime = vi.hoisted(() => ({ created: 0, live: 0, peak: 0, disposed: 0 }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
vi.mock('../panels/VideoEditProjectPanel', () => ({ VideoEditProjectPanel: () => <div>素材面板</div> }))
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
  const instance: VideoEditInstance = { document, activeSequenceId: document.sequences[0].id, sequenceViews: new Map(), selectedItemIds: [], selectedBinId: '', openSequenceIds: [document.sequences[0].id], selectedClipIds: [], targetTrackIds: [], tool: 'select', snapping: true, zoom: 1, inFrame: null, outFrame: null, session: {} as VideoEditInstance['session'], dirty: false, error: null, past: [], future: [], selection: null, frame: 17, playing: false, playbackDirection: 1, activePanel: 'timeline', busy: false, version: 0 }
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

it('DOM 面板浮出到系统窗口后仍由同一 React 树渲染；关闭浮窗贴回，重置与卸载不留浮窗或重复面板', () => {
  const document = createVideoEditDocument('浮窗验收')
  const instance: VideoEditInstance = { document, activeSequenceId: document.sequences[0].id, sequenceViews: new Map(), selectedItemIds: [], selectedBinId: '', openSequenceIds: [document.sequences[0].id], selectedClipIds: [], targetTrackIds: [], tool: 'select', snapping: true, zoom: 1, inFrame: null, outFrame: null, session: {} as VideoEditInstance['session'], dirty: false, error: null, past: [], future: [], selection: null, frame: 3, playing: false, playbackDirection: 1, activePanel: 'timeline', busy: false, version: 0 }
  let api: DockviewApi | null = null
  const onError = vi.fn()
  const view = render(<VideoEditDock instance={instance} onError={onError} onApiChange={value => { api = value }} />)
  const dock = api as unknown as DockviewApi
  const { host, opened } = createPopoutTestHost()
  act(() => { dock.layout(1440, 860) })

  expect(popOutVideoEditPanel(dock, 'source', host)).toBe(false)
  let popped = false
  act(() => { popped = popOutVideoEditPanel(dock, 'effects', host) })
  expect(popped).toBe(true)
  expect(dock.getPanel('effects')).toBeUndefined()
  const effects = opened[0].child
  expect(effects.document.body.textContent).toContain('效果控件')
  expect(effects.document.querySelector('[data-video-edit-panel="effects"]')).not.toBeNull()
  expect(listVideoEditPopouts().map(entry => entry.id)).toEqual(['effects'])
  act(() => { popOutVideoEditPanel(dock, 'effects', host) })
  expect(opened).toHaveLength(1)
  expect(effects.focus).toHaveBeenCalled()

  act(() => effects.userClose())
  expect(dock.getPanel('effects')).toBeDefined()
  expect(effects.document.querySelector('[data-video-edit-panel]')).toBeNull()
  expect(listVideoEditPopouts()).toHaveLength(0)

  act(() => { popOutVideoEditPanel(dock, 'timeline', host) })
  expect(dock.getPanel('timeline')).toBeUndefined()
  act(() => resetVideoEditWorkspaceLayout(dock))
  expect(opened[1].child.close).toHaveBeenCalledOnce()
  expect(dock.panels.filter(panel => panel.id === 'timeline')).toHaveLength(1)

  act(() => { popOutVideoEditPanel(dock, 'project', host) })
  expect(lifetime).toMatchObject({ created: 1, live: 1 })
  view.unmount()
  expect(opened[2].child.close).toHaveBeenCalledOnce()
  expect(listVideoEditPopouts()).toHaveLength(0)
  expect(onError).not.toHaveBeenCalled()
})

const makeInstance = (name: string): VideoEditInstance => {
  const document = createVideoEditDocument(name)
  return { document, activeSequenceId: document.sequences[0].id, sequenceViews: new Map(), selectedItemIds: [], selectedBinId: '', openSequenceIds: [document.sequences[0].id], selectedClipIds: [], targetTrackIds: [], tool: 'select', snapping: true, zoom: 1, inFrame: null, outFrame: null, session: {} as VideoEditInstance['session'], dirty: false, error: null, past: [], future: [], selection: null, frame: 0, playing: false, playbackDirection: 1, activePanel: 'timeline', busy: false, version: 0 }
}
const savedPopouts = (): unknown => JSON.parse(localStorage.getItem(VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY) ?? 'null')

it('节目面板可浮出（重挂载一次、不并存两份）；浮窗记录随工作区卸载/主窗口退出保留并在 Dock 就绪后恢复，用户关闭即移除', () => {
  const { opened, open } = createPopoutTestHost()
  vi.spyOn(window, 'open').mockImplementation(open as typeof window.open)
  const instance = makeInstance('持久化')
  let api: DockviewApi | null = null
  const first = render(<VideoEditDock instance={instance} onError={vi.fn()} onApiChange={value => { api = value }} />)
  let dock = api as unknown as DockviewApi
  act(() => { dock.layout(1440, 860) })
  expect(opened).toHaveLength(0)

  act(() => { popOutVideoEditPanel(dock, 'program') })
  expect(dock.getPanel('program')).toBeUndefined()
  expect(opened[0].child.document.body.textContent).toContain('节目画面')
  expect(lifetime).toMatchObject({ created: 2, live: 1, peak: 1, disposed: 1 })
  act(() => { popOutVideoEditPanel(dock, 'timeline') })
  expect(savedPopouts()).toEqual({ version: 1, panels: [
    { id: 'program', bounds: { x: 2760, y: 200, width: 480, height: 360 } },
    { id: 'timeline', bounds: { x: 2760, y: 200, width: 480, height: 360 } },
  ] })

  // 用户关闭节目浮窗 = 贴回并移除记录。
  act(() => opened[0].child.userClose())
  expect(dock.getPanel('program')).toBeDefined()
  expect(savedPopouts()).toEqual({ version: 1, panels: [{ id: 'timeline', bounds: { x: 2760, y: 200, width: 480, height: 360 } }] })

  // 工作区卸载：浮窗关闭、不贴回，但记录与最后位置保留。
  opened[1].child.screenX = 100
  first.unmount()
  expect(opened[1].child.close).toHaveBeenCalledOnce()
  expect(savedPopouts()).toEqual({ version: 1, panels: [{ id: 'timeline', bounds: { x: 100, y: 200, width: 480, height: 360 } }] })

  // 重开同一工作区：Dock 就绪后按记录恢复，位置经 features 交给主进程校正。
  const second = render(<VideoEditDock instance={makeInstance('持久化')} onError={vi.fn()} onApiChange={value => { api = value }} />)
  dock = api as unknown as DockviewApi
  expect(opened).toHaveLength(3)
  expect(opened[2].name).toBe('henji-video-edit-popout:timeline')
  expect(opened[2].features).toBe(`popup,width=480,height=360,left=100,top=200,henjiTitle=${encodeURIComponent('痕迹AI · 时间线')}`)
  expect(dock.getPanel('timeline')).toBeUndefined()

  // 主窗口退出/重载：pagehide 后主进程销毁浮窗，记录保留。
  act(() => { window.dispatchEvent(new Event('pagehide')) })
  act(() => opened[2].child.userClose())
  expect(savedPopouts()).toEqual({ version: 1, panels: [{ id: 'timeline', bounds: { x: 2760, y: 200, width: 480, height: 360 } }] })
  second.unmount()

  // 重置布局清除记录；损坏的记录不影响启动。
  const third = render(<VideoEditDock instance={makeInstance('持久化')} onError={vi.fn()} onApiChange={value => { api = value }} />)
  dock = api as unknown as DockviewApi
  expect(opened).toHaveLength(4)
  act(() => resetVideoEditWorkspaceLayout(dock))
  expect(localStorage.getItem(VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY)).toBeNull()
  expect(dock.panels.filter(panel => panel.id === 'timeline')).toHaveLength(1)
  third.unmount()
  localStorage.setItem(VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY, '{broken')
  const fourth = render(<VideoEditDock instance={makeInstance('持久化')} onError={vi.fn()} onApiChange={() => {}} />)
  expect(opened).toHaveLength(4)
  fourth.unmount()
})

it('浮窗焦点从 body 收回到 React 焦点根，Ctrl+Z 沿 React 树到达同一快捷键处理器一次并阻止原生撤销；输入框内不拦截', async () => {
  const frame = document.createElement('iframe'); document.body.append(frame)
  const popoutWindow = frame.contentWindow as Window & typeof globalThis
  vi.spyOn(window, 'open').mockImplementation((() => popoutWindow) as typeof window.open)
  const instance = makeInstance('快捷键')
  let api: DockviewApi | null = null
  const handled: string[] = []
  // 与剪辑工作区根部相同的处理方式：同一 React 树上唯一的 keydown 处理器。
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const binding = videoEditKeyboardCommand({ ...event.nativeEvent, code: event.code, key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, repeat: event.repeat, isComposing: false, defaultPrevented: event.defaultPrevented, target: event.target }, 'timeline', {})
    if (!binding) return
    handled.push(binding.id); event.preventDefault()
  }
  const view = render(<div onKeyDown={onKeyDown}><VideoEditDock instance={instance} onError={vi.fn()} onApiChange={value => { api = value }} /></div>)
  const dock = api as unknown as DockviewApi
  act(() => { dock.layout(1440, 860); popOutVideoEditPanel(dock, 'effects') })
  const child = popoutWindow.document
  const container = child.activeElement as HTMLElement
  expect(container.hasAttribute('data-video-edit-popout-focus')).toBe(true)
  expect(container.querySelector('[data-video-edit-panel="effects"]')).not.toBeNull()
  // 编辑完失焦：焦点掉到子窗 body，此时 keydown 不在 React 树内；宿主随即把焦点收回焦点根。
  container.blur()
  expect(child.activeElement).toBe(child.body)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(child.activeElement).toBe(container)
  const undo = new popoutWindow.KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })
  act(() => { container.dispatchEvent(undo) })
  expect(handled).toEqual(['undo'])
  expect(undo.defaultPrevented).toBe(true)
  const input = child.createElement('input'); container.querySelector('[data-video-edit-panel="effects"]')!.append(input)
  const typing = new popoutWindow.KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })
  act(() => { input.dispatchEvent(typing) })
  expect(handled).toEqual(['undo']); expect(typing.defaultPrevented).toBe(false)
  input.remove()
  view.unmount(); frame.remove()
})
