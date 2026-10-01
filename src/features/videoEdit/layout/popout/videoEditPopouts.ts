import type { DockviewApi } from 'dockview-react'
import { createLogger } from '@/core/logging'
import { resetVideoEditLayout, showVideoEditPanel, VIDEO_EDIT_PANELS, type VideoEditPanelId } from '../videoEditDockLayout'
import { openVideoEditPopoutWindow, type VideoEditPopoutBounds, type VideoEditPopoutWindow } from './videoEditPopoutWindow'
import { readVideoEditPopoutLayout, writeVideoEditPopoutLayout, type VideoEditPopoutRecord } from './videoEditPopoutLayout'

const logger = createLogger('features.videoEdit.layout.popout')

/**
 * 允许浮出的面板。节目面板以“重挂载 + 旧渲染会话实际退场后再接入新显示面”迁移；
 * 源监视器仍不开放：重挂载会关闭当前源素材。
 */
export const VIDEO_EDIT_POPOUT_PANELS = ['project', 'program', 'effects', 'timeline', 'content'] as const satisfies readonly VideoEditPanelId[]
export type VideoEditPopoutPanelId = typeof VIDEO_EDIT_POPOUT_PANELS[number]
export function isVideoEditPopoutPanel(id: string): id is VideoEditPopoutPanelId {
  return (VIDEO_EDIT_POPOUT_PANELS as readonly string[]).includes(id)
}

/** `ready` 为 false 时 Dock 中的旧面板尚未卸载，浮窗暂不挂载内容，保证同一面板任何时刻只有一份。 */
export interface VideoEditPopoutEntry { id: VideoEditPopoutPanelId; popout: VideoEditPopoutWindow; visible: boolean; ready: boolean }

const entries = new Map<VideoEditPopoutPanelId, VideoEditPopoutEntry>()
const listeners = new Set<() => void>()
let revision = 0
let snapshot: readonly VideoEditPopoutEntry[] = []
/** 唯一的贴回目标；Dock 卸载后为 null，此时关闭浮窗不再贴回。 */
let dockApi: DockviewApi | null = null
/** 为 true 时关闭浮窗不移除记录：工作区卸载、主窗口退出/重载都应在下次打开时恢复。 */
let retainRecords = false
const unloadHosts = new WeakSet<Window>()
let resizeTimer: ReturnType<typeof setTimeout> | undefined
/** 当前在 Dock 中已挂载内容的面板。 */
const dockBodies = new Set<VideoEditPanelId>()

function publish(): void {
  revision++
  snapshot = [...entries.values()].map(entry => ({ ...entry }))
  listeners.forEach(listener => listener())
}
export function subscribeVideoEditPopouts(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditPopoutRevision(): number { return revision }
export function listVideoEditPopouts(): readonly VideoEditPopoutEntry[] { return snapshot }
export function isVideoEditPanelPoppedOut(id: string): boolean { return isVideoEditPopoutPanel(id) && entries.has(id) }

/** Dock 面板内容挂载时登记；卸载后若该面板正等待浮出，才放行浮窗挂载。 */
export function trackVideoEditDockPanel(id: VideoEditPanelId): () => void {
  dockBodies.add(id)
  return () => {
    dockBodies.delete(id)
    const entry = isVideoEditPopoutPanel(id) ? entries.get(id) : undefined
    if (entry && !entry.ready) { entry.ready = true; publish() }
  }
}

function updateRecords(change: (records: VideoEditPopoutRecord[]) => VideoEditPopoutRecord[]): void {
  writeVideoEditPopoutLayout(change(readVideoEditPopoutLayout(VIDEO_EDIT_POPOUT_PANELS)))
}
/** 把仍打开的浮窗当前位置写入记录（移动没有事件，只能在关闭/退出前读取）。 */
function rememberOpenBounds(): void {
  if (!entries.size) return
  updateRecords(records => records.map(record => {
    const bounds = entries.get(record.id as VideoEditPopoutPanelId)?.popout.readBounds()
    return bounds ? { ...record, bounds } : record
  }))
}

/** Dock 就绪/卸载时登记贴回目标；卸载会关闭全部浮窗、不贴回，但保留记录供下次恢复。 */
export function bindVideoEditPopoutDock(api: DockviewApi | null, host: Window = window): void {
  if (!api) { closeAllVideoEditPopouts({ keepRecords: true }); dockApi = null; return }
  dockApi = api
  retainRecords = false
  if (!unloadHosts.has(host)) {
    unloadHosts.add(host)
    // 主窗口关闭或重载：主进程随后销毁浮窗，记录必须保留并带上最后位置。
    host.addEventListener('pagehide', () => { rememberOpenBounds(); retainRecords = true })
  }
}

/** 已浮出则聚焦，返回 true；被主进程拒绝（数量上限、重复）或面板不支持时返回 false。 */
export function popOutVideoEditPanel(api: DockviewApi, id: VideoEditPanelId, host: Window = window, bounds?: VideoEditPopoutBounds): boolean {
  if (!isVideoEditPopoutPanel(id)) return false
  const existing = entries.get(id)
  if (existing) { existing.popout.focus(); return true }
  const panel = api.getPanel(id)
  const title = VIDEO_EDIT_PANELS.find(value => value.id === id)?.title ?? id
  const popout = openVideoEditPopoutWindow(id, {
    title: `痕迹AI · ${title}`,
    size: bounds ?? { width: Math.max(panel?.api.width ?? 0, 360), height: Math.max(panel?.api.height ?? 0, 480) },
    ...(bounds ? { position: { x: bounds.x, y: bounds.y } } : {}),
    onClosed: () => closed(id),
    onVisibilityChange: visible => { const entry = entries.get(id); if (entry && entry.visible !== visible) { entry.visible = visible; publish() } },
    onResize: () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(rememberOpenBounds, 300) },
  }, host)
  if (!popout) {
    logger.warn('剪辑浮窗未能打开', { event: 'video_edit.popout.open.rejected', context: { panel: id } })
    return false
  }
  dockApi = api
  entries.set(id, { id, popout, visible: popout.isVisible(), ready: !dockBodies.has(id) })
  const opened = popout.readBounds() ?? bounds
  updateRecords(records => [...records.filter(record => record.id !== id), opened ? { id, bounds: opened } : { id }])
  // 先登记浮窗再移出 Dock，面板组件在同一 React 树内换挂载点，不产生第二份视图。
  panel?.api.close()
  publish()
  return true
}

function closed(id: VideoEditPopoutPanelId): void {
  if (!entries.delete(id)) return
  // 用户关闭浮窗即贴回：不再记录为浮出。
  if (!retainRecords) updateRecords(records => records.filter(record => record.id !== id))
  publish()
  if (dockApi) {
    try { showVideoEditPanel(dockApi, id) } catch (error) { logger.warn('剪辑浮窗贴回失败', { event: 'video_edit.popout.dock.failed', error, context: { panel: id } }) }
  }
}

/** 贴回：关闭浮窗，由关闭回调把面板放回 Dock 并移除记录。 */
export function dockVideoEditPopout(id: VideoEditPanelId): void {
  if (isVideoEditPopoutPanel(id)) entries.get(id)?.popout.close()
}

/** 关闭全部浮窗且不贴回。`keepRecords` 时保留记录与最后位置（工作区卸载）；否则一并清除。 */
export function closeAllVideoEditPopouts(options: { keepRecords?: boolean } = {}): void {
  const target = dockApi
  const retained = retainRecords
  if (options.keepRecords) rememberOpenBounds()
  dockApi = null
  retainRecords = retained || options.keepRecords === true
  for (const entry of [...entries.values()]) entry.popout.close()
  retainRecords = retained
  dockApi = target
}

/**
 * 工程已打开、Dock 就绪后恢复上次浮出的面板；位置交给主进程校正到可见显示器。
 * 打不开的记录（例如主进程拒绝）移除，面板留在 Dock。
 */
export function restoreVideoEditPopouts(api: DockviewApi, host: Window = window): void {
  for (const record of readVideoEditPopoutLayout(VIDEO_EDIT_POPOUT_PANELS)) {
    const id = record.id as VideoEditPopoutPanelId
    if (entries.has(id)) continue
    if (!popOutVideoEditPanel(api, id, host, record.bounds)) updateRecords(records => records.filter(value => value.id !== id))
  }
}

/** 重置布局时浮出的面板回到默认 Dock 位置并清除浮窗记录，避免同一面板同时存在于 Dock 与浮窗。 */
export function resetVideoEditWorkspaceLayout(api: DockviewApi): void {
  closeAllVideoEditPopouts()
  writeVideoEditPopoutLayout([])
  resetVideoEditLayout(api)
}
