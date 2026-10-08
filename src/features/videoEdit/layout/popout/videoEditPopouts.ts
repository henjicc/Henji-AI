import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'
import { createLogger } from '@/core/logging'
import type { DockDragSource, DockDropZone } from '@/components/dockviewDocking'
import { addVideoEditPanelAt, resetVideoEditLayout, showVideoEditPanel, VIDEO_EDIT_PANELS, type VideoEditPanelId } from '../videoEditDockLayout'
import { openVideoEditPopoutWindow, VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT, type VideoEditPopoutBounds, type VideoEditPopoutWindow } from './videoEditPopoutWindow'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { readVideoEditPopoutLayout, writeVideoEditPopoutLayout, type VideoEditPopoutRecord } from './videoEditPopoutLayout'

const logger = createLogger('features.videoEdit.layout.popout')

/**
 * 允许浮出的面板。节目面板以“重挂载 + 旧渲染会话实际退场后再接入新显示面”迁移；
 * 源监视器仍不开放：重挂载会关闭当前源素材。
 */
export const VIDEO_EDIT_POPOUT_PANELS = ['project', 'program', 'effects', 'timeline', 'content', 'effects_library', 'tracking', 'color_grade', 'title_templates'] as const satisfies readonly VideoEditPanelId[]
export type VideoEditPopoutPanelId = typeof VIDEO_EDIT_POPOUT_PANELS[number]
export function isVideoEditPopoutPanel(id: string): id is VideoEditPopoutPanelId {
  return (VIDEO_EDIT_POPOUT_PANELS as readonly string[]).includes(id)
}

/**
 * 一个系统浮窗（PR：浮动窗口可以容纳多个面板，叠成标签）。`key` 是交给主进程的窗口键（`frameName` 后缀），
 * 取第一个放进来的面板名，被占用时加序号。`pending` 是 Dock 中旧面板尚未卸载的面板：它们暂不挂载内容，
 * 保证同一面板任何时刻只有一份。
 */
export interface VideoEditPopoutEntry { key: string; panels: VideoEditPopoutPanelId[]; active: VideoEditPopoutPanelId; popout: VideoEditPopoutWindow; visible: boolean; pending: VideoEditPopoutPanelId[] }

const windows = new Map<string, VideoEditPopoutEntry>()
const listeners = new Set<() => void>()
let revision = 0
let snapshot: readonly VideoEditPopoutEntry[] = []
/** 唯一的贴回目标；Dock 卸载后为 null，此时关闭浮窗不再贴回。 */
let dockApi: DockviewApi | null = null
/** 停靠宿主根元素与所在窗口：浮窗标签拖回主窗口时在这里判定落点、画指示。 */
let dockRoot: HTMLElement | null = null
let dockHost: Window | null = null
let popoutHost: Window = typeof window === 'undefined' ? (undefined as unknown as Window) : window
/**
 * 浮窗关闭后其中的面板去哪：`default` = 贴回默认方位（贴回按钮、面板菜单）；落点 = 拖回时指示的位置；
 * 没有登记 = 用户关闭窗口，面板随之关闭（PR：关闭浮动窗口即关闭其中的面板，可从面板菜单重新打开）。
 */
const dockTargets = new Map<string, 'default' | DockDropZone>()
/** 拖动标签或整个浮窗时，指针下作为“放进这个浮窗”落点的那个浮窗（它的标题栏高亮）。 */
let dropTarget: string | null = null

/** 为 true 时关闭浮窗不移除记录：工作区卸载、主窗口退出/重载都应在下次打开时恢复。 */
let retainRecords = false
const unloadHosts = new WeakSet<Window>()
let resizeTimer: ReturnType<typeof setTimeout> | undefined
/** 当前在 Dock 中已挂载内容的面板。 */
const dockBodies = new Set<VideoEditPanelId>()

function publish(): void {
  revision++
  snapshot = [...windows.values()].map(entry => ({ ...entry, panels: [...entry.panels], pending: [...entry.pending] }))
  listeners.forEach(listener => listener())
}
export function subscribeVideoEditPopouts(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditPopoutRevision(): number { return revision }
export function listVideoEditPopouts(): readonly VideoEditPopoutEntry[] { return snapshot }
function windowOf(id: string): VideoEditPopoutEntry | undefined { return [...windows.values()].find(entry => entry.panels.includes(id as VideoEditPopoutPanelId)) }
export function isVideoEditPanelPoppedOut(id: string): boolean { return isVideoEditPopoutPanel(id) && Boolean(windowOf(id)) }
export function videoEditPopoutDropTarget(): string | null { return dropTarget }
export function setVideoEditPopoutDropTarget(key: string | null): void { if (dropTarget !== key) { dropTarget = key; publish() } }
const panelTitle = (id: VideoEditPanelId): string => VIDEO_EDIT_PANELS.find(value => value.id === id)?.title ?? id

/** Dock 面板内容挂载时登记；卸载后若该面板正等待浮出，才放行浮窗挂载。 */
export function trackVideoEditDockPanel(id: VideoEditPanelId): () => void {
  dockBodies.add(id)
  return () => {
    dockBodies.delete(id)
    const entry = windowOf(id)
    if (entry?.pending.includes(id as VideoEditPopoutPanelId)) { entry.pending = entry.pending.filter(value => value !== id); publish() }
  }
}

function recordOf(entry: VideoEditPopoutEntry, bounds = entry.popout.readBounds()): VideoEditPopoutRecord {
  return { panels: [...entry.panels], active: entry.active, ...(bounds ? { bounds } : {}) }
}
/** 记录 = 当前全部浮窗（含最新位置）；`keep` 里是暂时关闭但要保留的记录（工作区卸载）。 */
function writeRecords(): void {
  if (retainRecords) return
  writeVideoEditPopoutLayout([...windows.values()].map(entry => recordOf(entry)))
}
/** 把仍打开的浮窗当前位置写入记录（移动没有事件，只能在关闭/退出前读取）。 */
function rememberOpenBounds(): void { if (windows.size) writeVideoEditPopoutLayout([...windows.values()].map(entry => recordOf(entry))) }

/** 标题栏拖动移动窗口后记住位置（移动本身没有事件）。 */
export function rememberVideoEditPopoutBounds(): void { rememberOpenBounds() }

/** Dock 就绪/卸载时登记贴回目标；卸载会关闭全部浮窗、不贴回，但保留记录供下次恢复。 */
export function bindVideoEditPopoutDock(api: DockviewApi | null, host: Window = window, root: HTMLElement | null = null): void {
  if (!api) { closeAllVideoEditPopouts({ keepRecords: true }); dockApi = null; dockRoot = null; dockHost = null; return }
  dockApi = api
  dockRoot = root
  dockHost = host
  retainRecords = false
  if (!unloadHosts.has(host)) {
    unloadHosts.add(host)
    // 主窗口关闭或重载：主进程随后销毁浮窗，记录必须保留并带上最后位置。
    host.addEventListener('pagehide', () => { rememberOpenBounds(); retainRecords = true })
  }
}

function freeKey(first: VideoEditPopoutPanelId): string {
  if (!windows.has(first)) return first
  for (let index = 2; ; index++) if (!windows.has(`${first}-${index}`)) return `${first}-${index}`
}
function defaultSize(api: DockviewApi | null, id: VideoEditPanelId, minHeight: number): { width: number; height: number } {
  const panel = api?.getPanel(id)
  return { width: Math.max(panel?.api.width ?? 0, 360), height: Math.max(panel?.api.height ?? 0, minHeight) + VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT }
}
/** 面板离开原处：在 Dock 里就关掉 Dock 里的那个，在别的浮窗里就从那个浮窗拿出（拿空了关窗）。 */
function detachPanel(id: VideoEditPopoutPanelId, api: DockviewApi | null): void {
  const from = windowOf(id)
  if (from) { takeOut(from, id); return }
  api?.getPanel(id)?.api.close()
}
function takeOut(entry: VideoEditPopoutEntry, id: VideoEditPopoutPanelId): void {
  entry.panels = entry.panels.filter(value => value !== id); entry.pending = entry.pending.filter(value => value !== id)
  if (entry.active === id && entry.panels.length) setActive(entry, entry.panels[Math.max(0, entry.panels.length - 1)])
  if (!entry.panels.length) { windows.delete(entry.key); dockTargets.delete(entry.key); entry.popout.close() }
}
function setActive(entry: VideoEditPopoutEntry, id: VideoEditPopoutPanelId): void {
  entry.active = id
  entry.popout.setTitle(`痕迹AI · ${panelTitle(id)}`)
}

/** 开一个新浮窗装 `panels`（按顺序成标签）；被主进程拒绝（数量上限）时返回 null，面板留在原处。 */
function openWindow(api: DockviewApi | null, panels: VideoEditPopoutPanelId[], active: VideoEditPopoutPanelId, host: Window, bounds?: VideoEditPopoutBounds): VideoEditPopoutEntry | null {
  const key = freeKey(panels[0])
  const popout = openVideoEditPopoutWindow(key, {
    title: `痕迹AI · ${panelTitle(active)}`,
    size: bounds ?? defaultSize(api, active, 480),
    ...(bounds ? { position: { x: bounds.x, y: bounds.y } } : {}),
    onClosed: () => { if (popout) closed(key, popout) },
    onVisibilityChange: visible => { const entry = windows.get(key); if (entry && entry.popout === popout && entry.visible !== visible) { entry.visible = visible; publish() } },
    onResize: () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(rememberOpenBounds, 300) },
    ...(isDesktopRuntime() ? { control: request => { void getPlatform().window.controlPopout({ panelKey: key, ...request }).catch(error => logger.warn('剪辑浮窗几何控制失败', { event: 'video_edit.popout.control.failed', error, context: { panel: key, action: request.action } })) } } : {}),
  }, host)
  if (!popout) {
    logger.warn('剪辑浮窗未能打开', { event: 'video_edit.popout.open.rejected', context: { panels } })
    return null
  }
  popoutHost = host
  // 先登记浮窗再移出原处，面板组件在同一 React 树内换挂载点，不产生第二份视图。
  for (const id of panels) detachPanel(id, api)
  const entry: VideoEditPopoutEntry = { key, panels: [...panels], active, popout, visible: popout.isVisible(), pending: panels.filter(id => dockBodies.has(id)) }
  windows.set(key, entry)
  writeRecords()
  publish()
  return entry
}

/** 浮动面板：已浮出则切到它所在浮窗的这个标签并聚焦，返回 true；被主进程拒绝或面板不支持时返回 false。 */
export function popOutVideoEditPanel(api: DockviewApi, id: VideoEditPanelId, host: Window = window, bounds?: VideoEditPopoutBounds): boolean {
  if (!isVideoEditPopoutPanel(id)) return false
  if (windowOf(id)) { focusVideoEditPopoutPanel(id); return true }
  dockApi = api
  return Boolean(openWindow(api, [id], id, host, bounds))
}

/** 切到面板所在浮窗的这个标签并聚焦窗口（Shift+1…5 等聚焦面板命令）。 */
export function focusVideoEditPopoutPanel(id: string): void {
  const entry = windowOf(id)
  if (!entry) return
  if (entry.active !== id) { setActive(entry, id as VideoEditPopoutPanelId); writeRecords(); publish() }
  entry.popout.focus()
}
/** 浮窗标题栏里点标签：切换当前面板。 */
export function activateVideoEditPopoutPanel(key: string, id: VideoEditPopoutPanelId): void {
  const entry = windows.get(key)
  if (!entry || !entry.panels.includes(id) || entry.active === id) return
  setActive(entry, id); writeRecords(); publish()
}

/**
 * 把面板放进已有的浮窗，叠成标签并切到最后放进的那个（PR：把面板拖进浮动窗口形成标签组）。
 * 面板可以来自 Dock，也可以来自别的浮窗（拿空的浮窗随之关闭）。
 */
export function moveVideoEditPanelsToPopout(key: string, ids: readonly VideoEditPanelId[]): boolean {
  const entry = windows.get(key)
  const moving = ids.filter(isVideoEditPopoutPanel).filter(id => !entry?.panels.includes(id))
  if (!entry || !moving.length) return false
  for (const id of moving) {
    detachPanel(id, dockApi)
    entry.panels.push(id)
    if (dockBodies.has(id)) entry.pending.push(id)
  }
  setActive(entry, moving.at(-1)!)
  writeRecords(); publish()
  entry.popout.focus()
  return true
}

/** 把浮窗里的一个标签拖出成单独的浮窗（PR 拖出标签）；面板只有它一个时只是不动。 */
export function detachVideoEditPopoutPanel(id: VideoEditPanelId, at: { x: number; y: number }): boolean {
  const from = windowOf(id)
  if (!from || !isVideoEditPopoutPanel(id) || from.panels.length < 2) return false
  const size = from.popout.readBounds() ?? { width: 480, height: 360 }
  return Boolean(openWindow(dockApi, [id], id, popoutHost, { x: Math.round(at.x - 48), y: Math.round(at.y - VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT / 2), width: size.width, height: size.height }))
}

function dockPanels(panels: readonly VideoEditPopoutPanelId[], target: 'default' | DockDropZone): void {
  const api = dockApi
  if (!api) return
  let anchor: DockviewGroupPanel | undefined
  for (const id of panels) {
    try {
      // 第一个面板放到落点，其余叠进同一组（整组贴回）。
      const panel = anchor && api.groups.includes(anchor) ? addVideoEditPanelAt(api, id, { kind: 'group', group: anchor, position: 'center', rect: { left: 0, top: 0, width: 0, height: 0 } }) : target === 'default' ? showVideoEditPanel(api, id) : addVideoEditPanelAt(api, id, target)
      anchor ??= target === 'default' ? undefined : panel.group
    } catch (error) { logger.warn('剪辑浮窗贴回失败', { event: 'video_edit.popout.dock.failed', error, context: { panel: id } }) }
  }
}

function closed(key: string, popout: VideoEditPopoutWindow): void {
  const entry = windows.get(key)
  if (!entry || entry.popout !== popout) return
  const target = dockTargets.get(key)
  dockTargets.delete(key)
  windows.delete(key)
  if (dropTarget === key) dropTarget = null
  // 贴回或关闭都不再记录为浮出；工作区卸载、主窗口退出时保留记录供下次恢复。
  writeRecords()
  publish()
  if (target) dockPanels(entry.panels, target)
}

/** 贴回一个面板：从它所在的浮窗拿出（拿空就关窗），放回 Dock 默认方位或拖回时指示的落点。 */
export function dockVideoEditPopout(id: VideoEditPanelId, zone?: DockDropZone): void {
  const entry = isVideoEditPopoutPanel(id) ? windowOf(id) : undefined
  if (!entry) return
  if (entry.panels.length === 1) { dockVideoEditPopoutWindow(entry.key, zone); return }
  takeOut(entry, id as VideoEditPopoutPanelId)
  writeRecords(); publish()
  dockPanels([id as VideoEditPopoutPanelId], zone ?? 'default')
}
/** 贴回整个浮窗（标题栏贴回按钮、拖整个窗口回主窗口）：关窗，全部面板按标签顺序回到 Dock 的同一组。 */
export function dockVideoEditPopoutWindow(key: string, zone?: DockDropZone): void {
  const entry = windows.get(key)
  if (!entry) return
  dockTargets.set(key, zone ?? 'default')
  entry.popout.close()
}

/** 关闭浮窗里的一个面板（标签右键“关闭面板”）；面板可从面板菜单重新打开。 */
export function closeVideoEditPopout(id: VideoEditPanelId): void {
  const entry = isVideoEditPopoutPanel(id) ? windowOf(id) : undefined
  if (!entry) return
  takeOut(entry, id as VideoEditPopoutPanelId)
  writeRecords(); publish()
}
/** 关闭整个浮窗及其中的面板（标题栏关闭按钮）。 */
export function closeVideoEditPopoutWindow(key: string): void { windows.get(key)?.popout.close() }

/** 浮窗标签拖回主窗口时用到的停靠宿主；Dock 未就绪返回 null。 */
export function videoEditPopoutDockHost(): { api: DockviewApi; root: HTMLElement; host: Window } | null {
  return dockApi && dockRoot && dockHost ? { api: dockApi, root: dockRoot, host: dockHost } : null
}

/** 屏幕坐标（DIP）落在哪个浮窗上（`except` 除外，拖动中的窗口自己不算）。 */
export function videoEditPopoutAt(screen: { x: number; y: number }, except?: string): string | null {
  for (const entry of windows.values()) {
    if (entry.key === except) continue
    const bounds = entry.popout.readBounds()
    if (bounds && screen.x >= bounds.x && screen.x <= bounds.x + bounds.width && screen.y >= bounds.y && screen.y <= bounds.y + bounds.height) return entry.key
  }
  return null
}

/** 能浮出为独立窗口的来源：可浮出的面板，或含可浮出面板的组。 */
export function canFloatVideoEditDockSource(source: DockDragSource): boolean {
  return source.kind === 'panel' ? isVideoEditPopoutPanel(source.panel.id) : source.group.panels.some(panel => isVideoEditPopoutPanel(panel.id))
}

/**
 * 浮动面板组：组内可浮出的面板放进同一个浮窗，叠成标签（PR），当前标签保持当前；以 `at`（屏幕坐标，指针位置）
 * 为标题栏上的抓取点，不给 `at` 时由主进程放在主窗口所在显示器居中。
 */
export function popOutVideoEditGroup(api: DockviewApi, group: DockviewGroupPanel, host: Window = window, at?: { x: number; y: number }): boolean {
  const ids = group.panels.map(panel => panel.id).filter(isVideoEditPopoutPanel).filter(id => !windowOf(id))
  if (!ids.length) return false
  const active = ids.find(id => id === group.activePanel?.id) ?? ids[0]
  const size = defaultSize(api, active, 240)
  dockApi = api
  return Boolean(openWindow(api, ids, active, host, at ? { x: at.x - 48, y: at.y - VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT / 2, ...size } : undefined))
}

/**
 * 拖动标签或组松开在主窗口外（或 Ctrl+拖动）：落在已有浮窗上就叠进那个浮窗（PR 把面板拖进浮动窗口），
 * 否则在指针处浮出为新的独立窗口。
 */
export function floatVideoEditDockSource(api: DockviewApi, source: DockDragSource, at: { x: number; y: number }, host: Window = window): void {
  const ids = (source.kind === 'group' ? source.group.panels.map(panel => panel.id) : [source.panel.id]).filter(isVideoEditPopoutPanel)
  if (!ids.length) return
  dockApi = api
  const target = videoEditPopoutAt(at)
  if (target) { moveVideoEditPanelsToPopout(target, ids); return }
  if (source.kind === 'group') { popOutVideoEditGroup(api, source.group, host, at); return }
  const size = { width: Math.max(source.panel.api.width, 360), height: Math.max(source.panel.api.height, 240) + VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT }
  popOutVideoEditPanel(api, ids[0], host, { x: at.x - 48, y: at.y - VIDEO_EDIT_POPOUT_TITLEBAR_HEIGHT / 2, ...size })
}

/** 关闭全部浮窗且不贴回。`keepRecords` 时保留记录与最后位置（工作区卸载）；否则一并清除。 */
export function closeAllVideoEditPopouts(options: { keepRecords?: boolean } = {}): void {
  const target = dockApi
  const retained = retainRecords
  if (options.keepRecords) rememberOpenBounds()
  dockApi = null
  retainRecords = retained || options.keepRecords === true
  for (const entry of [...windows.values()]) { dockTargets.delete(entry.key); entry.popout.close() }
  retainRecords = retained
  dockApi = target
}

/**
 * 剪辑已打开、Dock 就绪后恢复上次的浮窗与其中的标签；位置交给主进程校正到可见显示器。
 * 打不开的记录（例如主进程拒绝）移除，面板留在 Dock。
 */
export function restoreVideoEditPopouts(api: DockviewApi, host: Window = window): void {
  dockApi = api
  for (const record of readVideoEditPopoutLayout(VIDEO_EDIT_POPOUT_PANELS)) {
    const panels = record.panels.filter((id): id is VideoEditPopoutPanelId => isVideoEditPopoutPanel(id) && !windowOf(id))
    if (!panels.length) continue
    const active = panels.includes(record.active as VideoEditPopoutPanelId) ? record.active as VideoEditPopoutPanelId : panels[0]
    openWindow(api, panels, active, host, record.bounds)
  }
  writeRecords()
}

/** 重置布局时浮出的面板回到默认 Dock 位置并清除浮窗记录，避免同一面板同时存在于 Dock 与浮窗。 */
export function resetVideoEditWorkspaceLayout(api: DockviewApi): void {
  closeAllVideoEditPopouts()
  writeVideoEditPopoutLayout([])
  resetVideoEditLayout(api)
}
