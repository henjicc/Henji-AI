import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { isAgentAuthoredStep } from '@/features/application-control'
import { jsonEqual } from '@/core/jsonEqual'
import { audioEditClueOptionLabel } from '../audioEditClueReview'

/*
 * 历史记录面板的步骤名：撤销栈只存作品快照，这里比较相邻两份快照，说出这一步改了什么。
 * 只看用户能感知的内容（删除/静音、修复、音量、文字、声音处理、处理参数），说不出来的统一叫“编辑”。
 */

const enabledCount = <T extends { enabled: boolean }>(items: readonly T[] | undefined) => (items ?? []).filter(item => item.enabled).length
// 相邻快照共享没改动的子树，按引用短路比较，不把整段转写序列化
const same = jsonEqual

/**
 * 快照是不可变的：同一对相邻快照的步骤名只算一次。每次编辑只多出一对新快照，
 * 历史面板重新列出整条历史时不再对每一步重新比较整段转写。
 */
const labels = new WeakMap<AudioEditProjectDocument, WeakMap<AudioEditProjectDocument, string>>()

export function describeAudioEditStep(before: AudioEditProjectDocument, after: AudioEditProjectDocument): string {
  let byBefore = labels.get(after)
  if (!byBefore) labels.set(after, byBefore = new WeakMap())
  let label = byBefore.get(before)
  if (label === undefined) byBefore.set(before, label = compareAudioEditStep(before, after))
  return label
}

function compareAudioEditStep(before: AudioEditProjectDocument, after: AudioEditProjectDocument): string {
  const clue = describeClueStep(before, after)
  if (clue) return clue
  const cutsBefore = (before.cuts ?? []).filter(cut => cut.enabled)
  const cutsAfter = (after.cuts ?? []).filter(cut => cut.enabled)
  if (cutsAfter.length > cutsBefore.length) {
    const added = cutsAfter.find(cut => !cutsBefore.some(item => item.id === cut.id))
    return added?.mode === 'mute' ? '静音' : '删除'
  }
  if (cutsAfter.length < cutsBefore.length) return '恢复'
  if (enabledCount(after.repairs) !== enabledCount(before.repairs)) {
    const added = (after.repairs ?? []).find(repair => repair.enabled && !(before.repairs ?? []).some(item => item.id === repair.id))
    return added ? added.kind === 'declick' ? '去爆音' : '频谱修复' : '撤掉修复'
  }
  if (!same(after.gainRegions, before.gainRegions)) {
    const added = (after.gainRegions ?? []).find(region => !(before.gainRegions ?? []).some(item => item.id === region.id))
    if (!added) return '调整音量'
    if (added.fadeInFrames > 0 && added.gainDb === 0) return '淡入'
    if (added.fadeOutFrames > 0 && added.gainDb === 0) return '淡出'
    return `音量 ${added.gainDb > 0 ? '+' : ''}${added.gainDb} dB`
  }
  if (before.transcript.length !== after.transcript.length) return after.transcript.length ? '转写' : '清空文字'
  const included = (doc: AudioEditProjectDocument) => doc.transcript.filter(block => block.included).length
  if (included(after) < included(before)) return '删除文字'
  if (included(after) > included(before)) return '恢复文字'
  if (!same(after.transcript, before.transcript)) return '修改文字'
  if (!same(after.effectChain, before.effectChain) || after.chainBypassed !== before.chainBypassed) return '效果控件'
  if (!same(after.output, before.output)) return '输出'
  if (!same(after.batchSettings, before.batchSettings)) return '处理参数'
  if (!same(after.suggestions, before.suggestions)) return '处理建议'
  if (after.referenceScript !== before.referenceScript) return '参考逐字稿'
  if (after.name !== before.name) return '重命名'
  return '编辑'
}

/**
 * 改判一条线索（界面上选做法，或助手写 chosen_option / status）：删词、补停顿剪切都随它发生，
 * 按“线索改为某种做法”命名，不叫“删除”“恢复”。只认这一步里恰好一条线索变了的情况，批量处理照旧按内容命名。
 */
function describeClueStep(before: AudioEditProjectDocument, after: AudioEditProjectDocument): string | undefined {
  if (before.suggestions === after.suggestions && before.suggestionHandoff === after.suggestionHandoff) return undefined
  const previous = new Map(before.suggestions.map(item => [item.id, item]))
  const changed = after.suggestions.filter(item => { const old = previous.get(item.id); return old && (old.status !== item.status || !same(old.blockIds, item.blockIds) || before.suggestionHandoff?.[item.id]?.chosen !== after.suggestionHandoff?.[item.id]?.chosen) })
  if (changed.length !== 1) return undefined
  const item = changed[0]
  const chosen = after.suggestionHandoff?.[item.id]?.chosen
  const options = after.suggestionHandoff?.[item.id]?.options ?? []
  if (chosen && chosen !== before.suggestionHandoff?.[item.id]?.chosen) {
    const splices = options.filter(option => option.id.startsWith('splice_'))
    return `线索改为${audioEditClueOptionLabel(chosen, splices.findIndex(option => option.id === chosen), splices.length)}`
  }
  if (item.status === 'dismissed') return item.kind === 'retake' ? '线索改为两遍都留' : '线索改为保留'
  if (item.status === 'applied') return item.kind === 'retake' ? `线索改为${audioEditClueOptionLabel(options[0]?.id ?? 'keep_later')}` : item.kind === 'long_silence' ? '线索改为压缩' : '线索改为删掉'
  return undefined
}

export interface AudioEditHistoryEntry { label: string; state: 'done' | 'current' | 'undone'; /** 跳到这一步需要撤销（正数）或重做（负数）多少次。 */ steps: number }

/** 历史列表：最早保留的状态到当前，再到可以重做的步骤（重做栈第一项是下一步）。撤销栈有上限，最早一项叫“起点”。 */
export function audioEditHistoryEntries(past: readonly AudioEditProjectDocument[], current: AudioEditProjectDocument, future: readonly AudioEditProjectDocument[]): AudioEditHistoryEntry[] {
  const timeline = [...past, current, ...future]
  const currentIndex = past.length
  return timeline.map((document, index) => ({
    // 人和助手在同一个撤销栈里：助手做的步骤标出来，撤销时知道撤的是谁的
    label: index === 0 ? '起点' : `${isAgentAuthoredStep(document) ? '助手：' : ''}${describeAudioEditStep(timeline[index - 1], document)}`,
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'undone',
    steps: currentIndex - index,
  }))
}
