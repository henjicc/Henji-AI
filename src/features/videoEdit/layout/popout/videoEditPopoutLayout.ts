import { createLogger } from '@/core/logging'
import type { VideoEditPopoutBounds } from './videoEditPopoutWindow'

const logger = createLogger('features.videoEdit.layout.popout')

/**
 * 每台机器的视图便利项：哪些面板浮出到系统窗口及其上次位置。与 Dock 布局一样只存
 * 视图状态，不含工程内容；读写失败只记日志，按“没有浮窗”正常启动。
 */
export const VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY = 'henji.videoEdit.popoutLayout.v1'
const MAX_RECORDS = 8
const MAX_COORDINATE = 100_000

export interface VideoEditPopoutRecord { id: string; bounds?: VideoEditPopoutBounds }

function isBounds(value: unknown): value is VideoEditPopoutBounds {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, width, height } = value as Record<string, unknown>
  const finite = (input: unknown, min: number): input is number => typeof input === 'number' && Number.isFinite(input) && input >= min && Math.abs(input) <= MAX_COORDINATE
  return finite(x, -MAX_COORDINATE) && finite(y, -MAX_COORDINATE) && finite(width, 1) && finite(height, 1)
}

/** 只接受已知面板；重复、未知或损坏的条目丢弃。 */
export function parseVideoEditPopoutLayout(raw: string | null, allowed: readonly string[]): VideoEditPopoutRecord[] {
  if (!raw) return []
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { panels?: unknown }).panels)) throw new Error('不支持的剪辑浮窗记录')
  const seen = new Set<string>()
  const records: VideoEditPopoutRecord[] = []
  for (const entry of (value as { panels: unknown[] }).panels.slice(0, MAX_RECORDS)) {
    if (typeof entry !== 'object' || entry === null) continue
    const { id, bounds } = entry as { id?: unknown; bounds?: unknown }
    if (typeof id !== 'string' || !allowed.includes(id) || seen.has(id)) continue
    seen.add(id)
    records.push(isBounds(bounds) ? { id, bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) } } : { id })
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
    else storage.setItem(VIDEO_EDIT_POPOUT_LAYOUT_STORAGE_KEY, JSON.stringify({ version: 1, panels: records }))
  } catch (error) {
    logger.warn('剪辑浮窗记录保存失败', { event: 'video_edit.popout.layout.write_failed', error })
  }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
