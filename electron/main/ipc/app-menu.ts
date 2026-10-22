import { app, BrowserWindow, Menu, type Input, type MenuItemConstructorOptions } from 'electron'
import { z } from 'zod'
import type { AppMenuNativeItem, AppMenuNativeMenu, AppMenuEditRole } from '../../../src/core/appMenu/appMenu'
import { registerIpcHandler } from './registry'

const editRoles = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as const
const itemSchema: z.ZodType<AppMenuNativeItem> = z.lazy(() => z.object({
  type: z.enum(['normal', 'checkbox', 'separator', 'submenu']),
  id: z.string().min(1).max(200).optional(), label: z.string().max(500).optional(),
  accelerator: z.string().max(100).optional(), enabled: z.boolean().optional(), checked: z.boolean().optional(),
  editRole: z.enum(editRoles).optional(), submenu: z.array(itemSchema).max(200).optional(),
}).strict())
const menusSchema = z.array(z.object({ id: z.string().min(1).max(200), label: z.string().max(500), submenu: z.array(itemSchema).max(200) }).strict()).max(30)

export function parseAppMenuModel(input: unknown): AppMenuNativeMenu[] {
  // 先限深，避免递归校验被异常 IPC 载荷耗尽栈。
  const inspect = (value: unknown, depth: number): void => {
    if (depth > 10) throw new Error('菜单层级过深')
    if (Array.isArray(value)) { if (value.length > 200) throw new Error('菜单项过多'); value.forEach(item => inspect(item, depth + 1)) }
    else if (value && typeof value === 'object' && 'submenu' in value) inspect(value.submenu, depth + 1)
  }
  inspect(input, 0)
  return menusSchema.parse(input)
}

/** 设置没有 Electron role，沿用应用的设置命令；其他应用级动作使用系统 role。 */
export function buildNativeAppMenuTemplate(menus: readonly AppMenuNativeMenu[], name: string, invoke: (id: string) => void): MenuItemConstructorOptions[] {
  const declared = new Set<AppMenuEditRole>()
  const convert = (items: readonly AppMenuNativeItem[]): MenuItemConstructorOptions[] => items
    .filter(item => !['app.settings', 'app.quit'].includes(item.id ?? ''))
    .map(item => {
      const { editRole, submenu, ...options } = item
      if (editRole) declared.add(editRole)
      return { ...options, registerAccelerator: false, ...(submenu ? { submenu: convert(submenu) } : item.type !== 'separator' ? {
        click: () => { if (item.id && item.enabled !== false) invoke(item.id) },
      } : {}) }
    }).filter((item, index, items) => item.type !== 'separator' || (index > 0 && index < items.length - 1 && items[index - 1].type !== 'separator'))
  const template: MenuItemConstructorOptions[] = menus.map(menu => ({ id: menu.id, label: menu.label, submenu: convert(menu.submenu) }))
  const missing: MenuItemConstructorOptions[] = editRoles.filter(role => !declared.has(role)).map(role => ({ role, registerAccelerator: false }))
  const edit = template.find(menu => menu.id === 'edit')
  if (edit) {
    const entries = edit.submenu as MenuItemConstructorOptions[]
    if (missing.length) edit.submenu = [...entries, ...(entries.length ? [{ type: 'separator' as const }] : []), ...missing]
  } else template.splice(template[0]?.id === 'file' ? 1 : 0, 0, { id: 'edit', label: '编辑', submenu: missing })
  const settings = menus.flatMap(menu => menu.submenu).find(item => item.id === 'app.settings')
  return [{ label: name, submenu: [
    { role: 'about', registerAccelerator: false },
    { type: 'separator' },
    { id: 'app.settings', label: '设置…', accelerator: 'Command+,', registerAccelerator: false, enabled: Boolean(settings && settings.enabled !== false), click: () => invoke('app.settings') },
    { type: 'separator' },
    { role: 'hide', registerAccelerator: false }, { role: 'hideOthers', registerAccelerator: false }, { role: 'unhide', registerAccelerator: false },
    { type: 'separator' }, { role: 'quit', registerAccelerator: false },
  ] }, ...template.filter(menu => (menu.submenu as MenuItemConstructorOptions[]).length)]
}

/** macOS 不支持 registerAccelerator=false；匹配的按键放行给渲染层，且不 preventDefault。 */
export function isAppMenuShortcut(input: Input, menus: readonly AppMenuNativeMenu[]): boolean {
  const matches = (shortcut: string): boolean => {
    const parts = shortcut.toLowerCase().split('+')
    const key = parts.pop()!
    const aliases: Record<string, string> = { space: ' ', left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', esc: 'escape', '←': 'arrowleft', '→': 'arrowright', '↑': 'arrowup', '↓': 'arrowdown' }
    const codeNames: Record<string, string> = { Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', BracketLeft: '[', BracketRight: ']', Space: ' ' }
    const physicalKey = input.code ? codeNames[input.code] ?? input.code.replace(/^(?:Key|Digit)/, '').toLowerCase() : input.key.toLowerCase()
    return (aliases[key] ?? key) === physicalKey
      && Boolean(input.meta) === parts.some(part => ['cmdorctrl', 'commandorcontrol', 'cmd', 'command', 'meta', 'super'].includes(part))
      && Boolean(input.control) === parts.some(part => ['ctrl', 'control'].includes(part))
      && Boolean(input.shift) === parts.includes('shift') && Boolean(input.alt) === parts.some(part => ['alt', 'option'].includes(part))
  }
  const walk = (items: readonly AppMenuNativeItem[]): boolean => items.some(item => Boolean(item.accelerator && matches(item.accelerator)) || Boolean(item.submenu && walk(item.submenu)))
  return menus.some(menu => walk(menu.submenu))
}

/** 仅 createWindow 显式登记的主窗口可贡献；辅助窗口即使有 preload 也不能覆盖。 */
const mainWindows = new WeakSet<BrowserWindow>()
export function bindAppMenuWindow(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return
  mainWindows.add(win)
  let menus: AppMenuNativeMenu[] = []
  windowModels.set(win, model => { menus = model })
  win.webContents.on('before-input-event', (_event, input) => win.webContents.setIgnoreMenuShortcuts(isAppMenuShortcut(input, menus)))
}
const windowModels = new WeakMap<BrowserWindow, (model: AppMenuNativeMenu[]) => void>()

export function registerAppMenuIpc(): void {
  registerIpcHandler('appMenu:update', parseAppMenuModel, (menus, event) => {
    if (process.platform !== 'darwin') return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !mainWindows.has(win) || win.isDestroyed() || BrowserWindow.getFocusedWindow() !== win || event.senderFrame !== event.sender.mainFrame) return
    windowModels.get(win)?.(menus)
    const invoke = (id: string): void => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed() && BrowserWindow.getFocusedWindow() === win) win.webContents.send('appMenu:invoke', { id })
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildNativeAppMenuTemplate(menus, app.name, invoke)))
  })
}
