import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>>(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>) => boundary.handlers.set(channel, handler) },
  BrowserWindow: { fromWebContents: (sender: unknown) => ({ webContents: sender }) },
}))
vi.mock('../services/window-appearance', () => ({ parseWindowAppearance: vi.fn(), windowAppearance: { update: vi.fn() } }))
vi.mock('../windows/video-edit-popout', () => ({ controlVideoEditPopout: vi.fn() }))
vi.mock('../services/media-recycle/lifecycle', () => ({ mediaRecycleLifecycle: {} }))

import { registerWindowIpc } from './window'

function createContents() {
  // Chromium 在 file URL 的 query 改变后按新 URL 读默认值，已合成的页面仍保留旧比例。
  let nativeZoom = 1
  let rendererZoom = 1
  const contents = Object.assign(new EventEmitter(), {
    setZoomFactor: vi.fn((factor: number) => { nativeZoom = factor; rendererZoom = factor }),
    getZoomFactor: () => nativeZoom,
    rendererZoom: () => rendererZoom,
    navigateInPage: (isMainFrame = true) => {
      if (isMainFrame) nativeZoom = 1
      contents.emit('did-navigate-in-page', {}, 'file:///app/index.html?section=colors', isMainFrame)
    },
  })
  const apply = (factor: number) => boundary.handlers.get('window:setZoomFactor')!(
    { sender: contents } as unknown as IpcMainInvokeEvent, { factor },
  )
  return { contents, apply }
}

beforeEach(() => { boundary.handlers.clear(); registerWindowIpc() })

it('主框架 replaceState 后同步原生缩放与实际页面，后续 resize 仍一致', async () => {
  const { contents, apply } = createContents()
  expect(await apply(0.9)).toEqual({ ok: true, data: undefined })
  contents.navigateInPage()
  expect(contents.getZoomFactor()).toBe(contents.rendererZoom())
  expect(contents.getZoomFactor()).toBe(0.9)
  expect(await apply(1.25)).toEqual({ ok: true, data: undefined })
  contents.navigateInPage()
  expect(contents.getZoomFactor()).toBe(1.25)
  expect(contents.rendererZoom()).toBe(1.25)
})

it('比例按窗口保存，重复设置不重复监听，忽略子框架并在销毁时清理', async () => {
  const first = createContents()
  const second = createContents()
  await first.apply(0.9)
  await first.apply(1.1)
  await second.apply(1.5)
  expect(first.contents.listenerCount('did-navigate-in-page')).toBe(1)
  first.contents.setZoomFactor.mockClear()
  first.contents.navigateInPage(false)
  expect(first.contents.setZoomFactor).not.toHaveBeenCalled()
  first.contents.navigateInPage()
  second.contents.navigateInPage()
  expect(first.contents.getZoomFactor()).toBe(1.1)
  expect(second.contents.getZoomFactor()).toBe(1.5)
  first.contents.emit('destroyed')
  expect(first.contents.listenerCount('did-navigate-in-page')).toBe(0)
})
