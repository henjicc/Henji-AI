import type { PromptEditorExternalChange, PromptEditorHandle } from '@/components/ui'
import { remapRemovedPromptImages } from '../promptState'
import {
  generationMediaSnapshotsEqual,
  readGenerationMediaSnapshot,
  restoreGenerationMediaSnapshot,
  type GenerationMediaSnapshot,
} from '@/features/generation/store/generationMediaSnapshot'

/**
 * 参考素材从 before 变到当前状态的一次变化；没变时返回 null。
 * 撤销、重做都是整份换回快照，所以只在素材正好处于另一端时才换：中间若有没登记的改动
 * （裁切视频、查看器里替换、切模型裁掉多余素材、助手写入），跳过这一步，不把那些改动冲掉。
 */
export function mediaChangeSince(before: GenerationMediaSnapshot): PromptEditorExternalChange | null {
  const after = readGenerationMediaSnapshot()
  if (generationMediaSnapshotsEqual(before, after)) return null
  const swap = (from: GenerationMediaSnapshot, to: GenerationMediaSnapshot) => (): void => {
    if (generationMediaSnapshotsEqual(readGenerationMediaSnapshot(), from)) restoreGenerationMediaSnapshot(to)
  }
  return { undo: swap(after, before), redo: swap(before, after) }
}

/**
 * 执行一次参考素材操作（上传、删除、替换、排序、粘贴），落定后把素材变化记进提示词编辑器的撤销栈，
 * 与打字按顺序一起撤销。操作同步执行（粘贴要在事件当下决定是否接管），异步部分结束后再比对前后快照。
 * 删掉的图被提示词引用着时，引用在同一步里改指同一位置的新图（换掉的图沿用原身份，引用本来就跟着走）。
 */
export function trackMediaChange<T>(getEditor: () => PromptEditorHandle | null | undefined, operation: () => T): T {
  const before = readGenerationMediaSnapshot()
  const result = operation()
  void Promise.resolve(result).catch(() => undefined).then(() => {
    const change = mediaChangeSince(before)
    if (change) getEditor()?.recordExternalChange(change, remapRemovedPromptImages(before.uploadedPromptImages, readGenerationMediaSnapshot().uploadedPromptImages))
  })
  return result
}
