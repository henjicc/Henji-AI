/*
 * 应用菜单（标题栏菜单栏 / macOS 系统菜单栏）的唯一契约与登记表。
 *
 * - 菜单是“已登记操作”的一种视图，不是第二套入口：每个菜单项执行的必须是工作区现有的命令或服务函数
 *   （与快捷键、按钮、智能助手同一份实现），不得在菜单里另写业务逻辑。
 * - 谁声明：应用层提供公共菜单（文件、编辑、视图、窗口、帮助）；每个工作区或工具在“显示时”声明自己的菜单与
 *   要并入公共菜单的项，隐藏或卸载时撤回。同 id 的菜单按声明顺序合并，分组之间自动加分隔线。
 * - 展示：Windows 在窗口标题栏左侧渲染菜单栏；macOS 用同一份模型生成系统原生菜单栏（窗口内不再画）。
 * - 快捷键只做展示：真正的按键处理仍由各工作区负责，原生菜单的 accelerator 不注册为全局按键，避免一键两响。
 */

/** 顶层菜单 id：公共菜单固定为 file、edit、view、window、help；工作区菜单用自己的 id（如 sequence、clip、marker、audio、image、layer）。 */
export type AppMenuId = string
export type AppMenuEditRole = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'

export interface AppMenuCommand {
  kind: 'action'
  /** 全局唯一、稳定（“工作区.动作”，如 videoEdit.split）；macOS 原生菜单回传它。 */
  id: string
  label: string
  /** 显示用的快捷键，统一写 Windows 形式（Ctrl+Shift+Z），macOS 端自动换成 ⌘⇧Z。 */
  shortcut?: string
  /** 编辑语义仅供原生菜单补缺，不取代工作区 run。 */
  editRole?: AppMenuEditRole
  /** 不可用时给出原因，菜单里灰显并在悬停说明里显示原因（与按钮的 disabledReason 一致）。 */
  disabledReason?: string
  /** 勾选态（开关类，如“显示智能助手”）。 */
  checked?: boolean
  /** 危险动作（删除类），菜单里用危险色。 */
  danger?: boolean
  run: () => void | Promise<void>
}
export interface AppMenuSubmenu { kind: 'submenu'; id: string; label: string; items: readonly AppMenuEntry[]; disabledReason?: string }
export interface AppMenuSeparator { kind: 'separator' }
export type AppMenuEntry = AppMenuCommand | AppMenuSubmenu | AppMenuSeparator

export interface AppMenuSection {
  /** 并入哪个顶层菜单。 */
  menu: AppMenuId
  /** 顶层菜单名（第一次出现时生效；公共菜单的名字由应用层定）。 */
  label?: string
  /** 同一顶层菜单内的分组顺序，小的在前；公共分组用 0–99，工作区分组用 100 以上（窗口菜单的公共分组例外，用 900 以上排在工作区面板之后）。 */
  order?: number
  items: readonly AppMenuEntry[]
}

/** 顶层菜单在菜单栏里的顺序：文件、编辑，然后是工作区自己的菜单（按声明顺序），最后视图、窗口、帮助。 */
export const APP_MENU_LEADING: readonly AppMenuId[] = ['file', 'edit']
export const APP_MENU_TRAILING: readonly AppMenuId[] = ['view', 'window', 'help']
export const APP_MENU_LABELS: Readonly<Record<'file' | 'edit' | 'view' | 'window' | 'help', string>> = {
  file: '文件', edit: '编辑', view: '视图', window: '窗口', help: '帮助',
}

export interface AppMenu { id: AppMenuId; label: string; items: readonly AppMenuEntry[] }

interface Contribution { owner: string; sequence: number; sections: readonly AppMenuSection[] }
const contributions = new Map<string, Contribution>()
const listeners = new Set<() => void>()
let sequence = 0
let snapshot: readonly AppMenu[] = []

/**
 * 声明（或替换）某个所有者的菜单内容，返回撤回函数。owner 用“工作区/工具 id”（如 app、videoEdit、audioEdit）。
 * 内容变化（可用状态、勾选）时用同一个 owner 再声明一次即可；撤回只撤回本次声明对应的内容。
 */
export function contributeAppMenus(owner: string, sections: readonly AppMenuSection[]): () => void {
  const previous = contributions.get(owner)
  const entry: Contribution = { owner, sequence: previous?.sequence ?? ++sequence, sections }
  contributions.set(owner, entry)
  schedule()
  return () => { if (contributions.get(owner) === entry) { contributions.delete(owner); schedule() } }
}

/*
 * 工作区常在每次状态变化（播放走帧、拖动节点）时撤回再重新声明。合并到一个微任务里重建，且只有可见内容
 * （名称、可用性、勾选、快捷键）变化时才通知菜单栏与原生菜单；执行函数经稳定的转发调用最新一次声明。
 */
let dirty = false
let scheduled = false
let notifyPending = false
let lastSignature = ''
const latestRuns = new Map<string, AppMenuCommand['run']>()
function schedule(): void {
  dirty = true
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    flush()
    if (!notifyPending) return
    notifyPending = false
    listeners.forEach(listener => listener())
  })
}
function flush(): void {
  if (!dirty) return
  dirty = false
  latestRuns.clear()
  const next = rebuild()
  const signature = JSON.stringify(next, (_key, value: unknown) => typeof value === 'function' ? undefined : value)
  if (signature === lastSignature) return
  lastSignature = signature
  snapshot = next
  notifyPending = true
}

export function subscribeAppMenus(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function getAppMenus(): readonly AppMenu[] { flush(); return snapshot }

/** 按 id 找菜单项（macOS 原生菜单点击回传、测试用）。 */
export function findAppMenuCommand(id: string, menus: readonly AppMenu[] = getAppMenus()): AppMenuCommand | undefined {
  const walk = (items: readonly AppMenuEntry[]): AppMenuCommand | undefined => {
    for (const item of items) {
      if (item.kind === 'action' && item.id === id) return item
      if (item.kind === 'submenu') {
        const found = walk(item.items)
        if (found) return item.disabledReason ? { ...found, disabledReason: item.disabledReason } : found
      }
    }
    return undefined
  }
  for (const menu of menus) { const found = walk(menu.items); if (found) return found }
  return undefined
}

function rebuild(): readonly AppMenu[] {
  const byMenu = new Map<AppMenuId, { label?: string; first: number; sections: { order: number; seq: number; items: readonly AppMenuEntry[] }[] }>()
  for (const contribution of [...contributions.values()].sort((a, b) => a.sequence - b.sequence)) {
    contribution.sections.forEach((section, index) => {
      const slot = byMenu.get(section.menu) ?? { first: contribution.sequence * 1000 + index, sections: [] }
      if (!slot.label && section.label) slot.label = section.label
      slot.sections.push({ order: section.order ?? 50, seq: contribution.sequence * 1000 + index, items: section.items })
      byMenu.set(section.menu, slot)
    })
  }
  const known = APP_MENU_LABELS as Record<string, string>
  const build = (id: AppMenuId): AppMenu | null => {
    const slot = byMenu.get(id)
    if (!slot) return null
    const groups = slot.sections.sort((a, b) => a.order - b.order || a.seq - b.seq).map(section => section.items).filter(items => items.length)
    const items = groups.flatMap((group, index) => index ? [{ kind: 'separator' } as const, ...group] : [...group]).map(relay)
    return items.length ? { id, label: known[id] ?? slot.label ?? id, items } : null
  }
  const middle = [...byMenu.entries()].filter(([id]) => !APP_MENU_LEADING.includes(id) && !APP_MENU_TRAILING.includes(id)).sort((a, b) => a[1].first - b[1].first).map(([id]) => id)
  return [...APP_MENU_LEADING, ...middle, ...APP_MENU_TRAILING].map(build).filter((menu): menu is AppMenu => Boolean(menu))
}

/** 菜单里放转发函数，内容未变时沿用旧快照也能执行到最新声明的动作。 */
function relay(item: AppMenuEntry): AppMenuEntry {
  if (item.kind === 'separator') return item
  if (item.kind === 'submenu') return { ...item, items: item.items.map(relay) }
  latestRuns.set(item.id, item.run)
  const id = item.id
  return { ...item, run: () => { const run = latestRuns.get(id); return run?.() } }
}

/** macOS 原生菜单用的可序列化模型（去掉 run）。 */
export interface AppMenuNativeItem {
  type: 'normal' | 'checkbox' | 'separator' | 'submenu'
  id?: string; label?: string; accelerator?: string; enabled?: boolean; checked?: boolean
  submenu?: AppMenuNativeItem[]
  editRole?: AppMenuEditRole
}
export interface AppMenuNativeMenu { id: string; label: string; submenu: AppMenuNativeItem[] }

/** 显示用快捷键（Ctrl+Shift+Z）转 Electron accelerator（CmdOrCtrl+Shift+Z）。 */
export function toElectronAccelerator(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined
  const names: Record<string, string> = { ctrl: 'CmdOrCtrl', '←': 'Left', '→': 'Right', '↑': 'Up', '↓': 'Down', pgup: 'PageUp', pgdn: 'PageDown' }
  return shortcut.split('+').map(part => part.trim()).map(part => names[part.toLowerCase()] ?? part).join('+')
}

export function toNativeAppMenu(menus: readonly AppMenu[] = getAppMenus()): AppMenuNativeMenu[] {
  const convert = (items: readonly AppMenuEntry[]): AppMenuNativeItem[] => items.map((item): AppMenuNativeItem => {
    if (item.kind === 'separator') return { type: 'separator' }
    if (item.kind === 'submenu') return { type: 'submenu', id: item.id, label: item.label, enabled: !item.disabledReason, submenu: convert(item.items) }
    return { type: item.checked === undefined ? 'normal' : 'checkbox', id: item.id, label: item.label, accelerator: toElectronAccelerator(item.shortcut), enabled: !item.disabledReason, ...(item.editRole ? { editRole: item.editRole } : {}), ...(item.checked === undefined ? {} : { checked: item.checked }) }
  })
  return menus.map(menu => ({ id: String(menu.id), label: menu.label, submenu: convert(menu.items) }))
}
