import { createLogger } from '@/core/logging'
import type { VideoEditPopoutBounds } from './videoEditPopoutWindow'

const logger = createLogger('features.videoEdit.layout.popout')

/**
 * 每台机器的视图便利项：有哪些系统浮窗、各装着哪些面板（PR：一个浮动窗口可以容纳多个面板标签）、
 * 当前标签与上次位置。与 Dock 布局一样只存视图状态，不含剪辑内容；读写失败只记日志，按“没有浮窗”正常启动。
 * 版本 1（一个窗口一个面板）的旧记录按每个面板一个窗口读入。
 */
export const VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY = 'henji.videoEdit.popoutLayout.v1'
const MAX_RECORDS = 8
const MAX_COORDINATE = 100_000

export interface VideoEditPopoutRecord { panels: string[]; active: string; bounds?: VideoEditPopoutBounds }

function isBounds(value: unknown): value is VideoEditPopoutBounds {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, width, height } = value as Record<string, unknown>
  const finite = (input: unknown, min: number): input is number => typeof input === 'number' && Number.isFinite(input) && input >= min && Math.abs(input) <= MAX_COORDINATE
  return finite(x, -MAX_COORDINATE) && finite(y, -MAX_COORDINATE) && finite(width, 1) && finite(height, 1)
}

function normalizeBounds(bounds: unknown): { bounds?: VideoEditPopoutBounds } {
  return isBounds(bounds) ? { bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) } } : {}
}
/** 只接受已知面板；一个面板只出现在一个窗口里，未知或损坏的条目丢弃，没有面板的窗口丢弃。 */
export function parseVideoEditPopoutLayout(raw: string | null, allowed: readonly string[]): VideoEditPopoutRecord[] {
  if (!raw) return []
  const value: unknown = JSON.parse(raw)
  const version = typeof value === 'object' && value !== null ? (value as { version?: unknown }).version : undefined
  const list = version === 1 ? (value as { panels?: unknown }).panels : version === 2 ? (value as { windows?: unknown }).windows : undefined
  if (!Array.isArray(list)) throw new Error('不支持的剪辑浮窗记录')
  const seen = new Set<string>()
  const records: VideoEditPopoutRecord[] = []
  for (const entry of list.slice(0, MAX_RECORDS)) {
    if (typeof entry !== 'object' || entry === null) continue
    const { id, panels, active, bounds } = entry as { id?: unknown; panels?: unknown; active?: unknown; bounds?: unknown }
    const candidates = version === 1 ? [id] : Array.isArray(panels) ? panels : []
    const kept = candidates.filter((panel): panel is string => typeof panel === 'string' && allowed.includes(panel) && !seen.has(panel))
    kept.forEach(panel => seen.add(panel))
    if (!kept.length) continue
    records.push({ panels: kept, active: typeof active === 'string' && kept.includes(active) ? active : kept[0], ...normalizeBounds(bounds) })
  }
  return records
}

export function readVideoEditPopoutLayout(allowed: readonly string[], storage: Pick<Storage, 'getItem'> | null = safeStorage()): VideoEditPopoutRecord[] {
  try {
    return storage ? parseVideoEditPopoutLayout(storage.getItem(VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY), allowed) : []
  } catch (error) {
    logger.warn('剪辑浮窗记录读取失败，按无浮窗启动', { event: 'video_edit.popout.layout.read_failed', error })
    return []
  }
}

export function writeVideoEditPopoutLayout(records: readonly VideoEditPopoutRecord[], storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    if (!storage) return
    if (records.length === 0) storage.removeItem(VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY)
    else storage.setItem(VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY, JSON.stringify({ version: 2, windows: records }))
  } catch (error) {
    logger.warn('剪辑浮窗记录保存失败', { event: 'video_edit.popout.layout.write_failed', error })
  }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
