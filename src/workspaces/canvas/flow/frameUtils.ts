import type {
  StoryboardFrameItem,
  StoryboardGenFrameItem,
} from '@/workspaces/canvas/types'

export function normalizeCount(value: number): number {
  return Math.max(1, Math.min(8, Math.floor(value || 1)))
}

export function ensureStoryboardGenFrames(
  rows: number,
  cols: number,
  frames: StoryboardGenFrameItem[]
): StoryboardGenFrameItem[] {
  const total = normalizeCount(rows) * normalizeCount(cols)
  return Array.from({ length: total }, (_, index) => ({
    id: frames[index]?.id ?? `sgf-${index + 1}`,
    description: frames[index]?.description ?? '',
    referenceIndex: frames[index]?.referenceIndex ?? null,
  }))
}

export function ensureStoryboardSplitFrames(
  rows: number,
  cols: number,
  frames: StoryboardFrameItem[]
): StoryboardFrameItem[] {
  const total = normalizeCount(rows) * normalizeCount(cols)
  return Array.from({ length: total }, (_, index) => ({
    id: frames[index]?.id ?? `ssf-${index + 1}`,
    imageUrl: frames[index]?.imageUrl ?? null,
    filePath: frames[index]?.filePath ?? '',
    note: frames[index]?.note ?? '',
    order: index,
  }))
}
