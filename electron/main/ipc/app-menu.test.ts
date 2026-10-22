import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, Input, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { bindAppMenuWindow, buildNativeAppMenuTemplate, isAppMenuShortcut, parseAppMenuModel, registerAppMenuIpc } from './app-menu'
import type { AppMenuNativeMenu } from '../../../src/core/appMenu/appMenu'

const mock = vi.hoisted(() => ({
  handler: undefined as undefined | ((event: IpcMainInvokeEvent, model: unknown) => Promise<unknown>),
  focused: null as BrowserWindow | null, sender: null as BrowserWindow | null,
  setMenu: vi.fn(), build: vi.fn((template: MenuItemConstructorOptions[]) => template),
}))
vi.mock('electron', () => ({
  app: { name: '痕迹AI' },
  ipcMain: { handle: (_channel: string, handler: typeof mock.handler) => { mock.handler = handler } },
  Menu: { setApplicationMenu: mock.setMenu, buildFromTemplate: mock.build },
  BrowserWindow: { fromWebContents: () => mock.sender, getFocusedWindow: () => mock.focused },
}))

const model: AppMenuNativeMenu[] = [
  { id: 'file', label: '文件', submenu: [{ type: 'normal', id: 'app.settings', label: '设置' }, { type: 'separator' }, { type: 'normal', id: 'app.quit', label: '退出' }] },
  { id: 'edit', label: '编辑', submenu: [{ type: 'normal', id: 'videoEdit.undo', editRole: 'undo', label: '撤销', accelerator: 'CmdOrCtrl+Z', enabled: false }] },
  { id: 'clip', label: '剪辑', submenu: [{ type: 'submenu', id: 'clip.more', label: '更多', submenu: [{ type: 'checkbox', id: 'clip.toggle', label: '开关', checked: true }] }] },
]
function entries(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] { return item.submenu as MenuItemConstructorOptions[] }
function makeWindow(): { win: BrowserWindow; event: IpcMainInvokeEvent; send: ReturnType<typeof vi.fn>; destroy: () => void } {
  let destroyed = false
  const send = vi.fn()
  const mainFrame = {}
  const contents = { send, mainFrame, isDestroyed: () => destroyed, on: vi.fn(), setIgnoreMenuShortcuts: vi.fn() }
  const win = { webContents: contents, isDestroyed: () => destroyed } as unknown as BrowserWindow
  return { win, event: { sender: contents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent, send, destroy: () => { destroyed = true } }
}
beforeEach(() => { vi.stubGlobal('process', { ...process, platform: 'darwin' }); vi.clearAllMocks() })
afterEach(() => { vi.unstubAllGlobals() })

describe('原生菜单转换与路由', () => {
  it('应用菜单置首，移走设置/退出，保留嵌套与勾选，按编辑语义补缺', () => {
    const invoke = vi.fn()
    const template = buildNativeAppMenuTemplate(model, '痕迹AI', invoke)
    expect(template.map(item => item.label)).toEqual(['痕迹AI', '编辑', '剪辑'])
    expect(entries(template[0]).filter(item => item.role).map(item => item.role)).toEqual(['about', 'hide', 'hideOthers', 'unhide', 'quit'])
    expect(entries(template[0]).find(item => item.id === 'app.settings')).toMatchObject({ accelerator: 'Command+,', registerAccelerator: false })
    const edit = entries(template[1])
    expect(edit[0]).toMatchObject({ id: 'videoEdit.undo', enabled: false, accelerator: 'CmdOrCtrl+Z', registerAccelerator: false })
    expect(edit.filter(item => item.role).map(item => item.role)).toEqual(['redo', 'cut', 'copy', 'paste', 'selectAll'])
    expect(entries(entries(template[2])[0])[0]).toMatchObject({ checked: true, type: 'checkbox', registerAccelerator: false })
    expect(parseAppMenuModel(model)).toEqual(model)
    expect(() => parseAppMenuModel([{ id: 'edit', label: '编辑', submenu: [{ type: 'normal', run: 'not allowed' }] }])).toThrow()
    expect(() => parseAppMenuModel([{ id: 'edit', label: '编辑', submenu: [{ type: 'normal', enabled: 'yes' }] }])).toThrow()
  })

  it('只接受聚焦主窗口；点击发回原窗口，失焦、销毁、子窗口、子 frame 与 Windows 均拒绝', async () => {
    registerAppMenuIpc()
    const main = makeWindow(); const child = makeWindow()
    bindAppMenuWindow(main.win)
    mock.sender = main.win; mock.focused = main.win
    await mock.handler!(main.event, model)
    expect(mock.setMenu).toHaveBeenCalledOnce()
    const template = mock.build.mock.calls[0][0]
    const click = entries(entries(template.find(item => item.id === 'clip')!)[0])[0].click!
    const invokeClick = (): void => { Reflect.apply(click, undefined, []) }
    invokeClick()
    expect(main.send).toHaveBeenCalledWith('appMenu:invoke', { id: 'clip.toggle' })
    mock.focused = child.win
    invokeClick()
    await mock.handler!(main.event, model)
    mock.sender = child.win
    await mock.handler!(child.event, model)
    expect(mock.setMenu).toHaveBeenCalledOnce()
    expect(main.send).toHaveBeenCalledOnce()
    mock.sender = main.win; mock.focused = main.win
    await mock.handler!({ ...main.event, senderFrame: {} } as IpcMainInvokeEvent, model)
    expect(mock.setMenu).toHaveBeenCalledOnce()
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    await mock.handler!(main.event, model)
    expect(mock.setMenu).toHaveBeenCalledOnce()
    main.destroy(); invokeClick()
    expect(main.send).toHaveBeenCalledOnce()
  })

  it('macOS 命令键绕过原生 accelerator，普通按键与缺省系统编辑键仍可用', () => {
    const input = { key: 'z', meta: true, control: false, shift: false, alt: false } as Input
    expect(isAppMenuShortcut(input, model)).toBe(true)
    expect(isAppMenuShortcut({ ...input, shift: true }, model)).toBe(false)
    expect(isAppMenuShortcut({ ...input, key: 'c' }, model)).toBe(false)
    const template = buildNativeAppMenuTemplate([], '痕迹AI', vi.fn())
    expect(entries(template[1]).map(item => item.role)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
  })
})
