import { getDocumentHoverFrames } from '@/commands/documents'
import type { DocumentCoverSource } from '@/core/documents/types'
import { sha256HexString } from '@/utils/save/hash'
import { videoEditComposition, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditFrameSourceAt } from './videoEditProjectCover'

export const VIDEO_EDIT_HOVER_LEVELS = [1, 4, 8, 16, 32, 48] as const

/** 取样落在同一张 48 格网格上，升档只补新位置；短片按实际整数帧去重。 */
export function videoEditHoverPositions(duration: number): Array<{ position: number; frame: number }> {
  const positions = new Set<number>([24])
  for (const count of VIDEO_EDIT_HOVER_LEVELS.slice(1)) for (let index = 0; index < count; index++) positions.add(Math.floor(index * 48 / count))
  const frames = new Set<number>()
  return [...positions].flatMap(index => {
    const position = index / 48, frame = Math.min(Math.max(0, duration - 1), Math.floor(position * duration))
    if (frames.has(frame)) return []
    frames.add(frame)
    return [{ position, frame }]
  })
}

const keys = new WeakMap<VideoEditDocument, Promise<string>>()
export function videoEditHoverContentKey(document: VideoEditDocument): Promise<string> {
  let key = keys.get(document)
  if (!key) {
    // 取实际渲染快照：改名、保存和导出记录不会改变画面，嵌套序列与固定代码版本则会。
    const composition = document.sequences[0] ? videoEditComposition(document, document.sequences[0].id) : null
    const content = composition ? { ...composition, revision: 0 } : null
    key = sha256HexString(JSON.stringify(content, (_name: string, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : value))
    keys.set(document, key)
  }
  return key
}

/** 序列帧优先；没有有效缓存时才抽原素材，不在悬停路径渲染项目。 */
export async function loadVideoEditHoverPreview(document: VideoEditDocument): Promise<((fraction: number) => DocumentCoverSource | null) | null> {
  const stored = await getDocumentHoverFrames(document.id)
  if (stored?.frames.length && stored.contentKey === await videoEditHoverContentKey(document)) {
    return fraction => {
      const closest = stored.frames.reduce((best, item) => Math.abs(item.position - fraction) < Math.abs(best.position - fraction) ? item : best)
      return { source: closest.path, sourceKind: 'image' }
    }
  }
  const sources = Array.from({ length: 16 }, (_, index) => videoEditFrameSourceAt(document, (index + 0.5) / 16))
  if (!sources.some(Boolean)) return null
  return fraction => sources[Math.min(15, Math.floor(Math.max(0, fraction) * 16))]
}
