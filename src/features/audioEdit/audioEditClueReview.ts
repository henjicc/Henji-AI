import { applyAudioEditSuggestion, audioEditSuggestionOptionBlocker, audioEditSuggestionState, chooseAudioEditSuggestionOption, chosenAudioEditSuggestionOption, dismissAudioEditSuggestion } from '@/core/audioEdit/edits'
import { normalizeAudioEditFiller } from '@/core/audioEdit/analysis'
import type { AudioEditProjectDocument, AudioEditSuggestion } from '@/core/audioEdit/types'
import { audioEditClueCounts, audioEditClueTier, audioEditSuggestionOptionTexts, audioEditSuggestionTexts, type AudioEditClueTier } from './application/audioEditFields'

export type { AudioEditClueTier } from './application/audioEditFields'

export interface AudioEditClueOption {
  id: string
  label: string
  /** 这种做法删完后接缝两侧连起来读的样子，“｜”是接缝 */
  readsAs?: string
}

export interface AudioEditClueRow {
  id: string
  tier: AudioEditClueTier
  kind: AudioEditSuggestion['kind']
  /** 这一处被处理的文字 */
  text: string
  reason: { label: string; detail: string }
  /** 当前采用的做法；还没处理时为空 */
  current?: string
  options: AudioEditClueOption[]
  /** 改判不了的原因 */
  blocked?: string
  startFrame: number
  endFrame: number
}

/**
 * 本地算法的 reason 到用户语言：label 是行里的短语，detail 是悬停时的全称。
 * 新增的 reason 不在表里时按线索类型落到通用说法，不露出原始值。
 */
const RETAKE_REASONS: Record<string, { label: string; detail: string }> = {
  repeated: { label: '重念', detail: '两遍几乎相同' },
  script: { label: '对稿重念', detail: '对照参考稿，这里往回重念了' },
  marker: { label: '念坏重来', detail: '“哎”之后从前一句开头重来' },
  stutter: { label: '口吃或叠词', detail: '像口吃，也可能是叠词或强调' },
  loop: { label: '连着重复', detail: '同一截话连着重复很多遍，也可能是有意叠说' },
  reworded: { label: '念到一半改口', detail: '换了说法，没有参考稿佐证，可能本来就是两句' },
  short_repeat: { label: '短句重复', detail: '很短的原样重复，像强调或叠句' },
  parallel: { label: '像排比', detail: '开头相同的两句，像排比、列举或对比' },
  unsaid: { label: '前一遍多说了', detail: '前一遍里有后一遍没再说的内容' },
  complete_clause: { label: '删的是整句', detail: '要删的是说完的一整句' },
  joined: { label: '两遍连着念', detail: '两遍之间没有停顿，不像念坏重来' },
  inside_unsure: { label: '整段未定', detail: '所在的整段重复还没确定' },
  residual: { label: '开头仍相同', detail: '去重念之后前后两段开头仍相同' },
}
const KIND_REASONS: Record<AudioEditSuggestion['kind'], { label: string; detail: string }> = {
  retake: { label: '重念', detail: '同一内容念了几遍' },
  filler: { label: '语气词', detail: '语气词，结合上下文决定删不删' },
  long_silence: { label: '停顿过长', detail: '停顿比设定的最短停顿更长' },
}

export function audioEditClueReason(kind: AudioEditSuggestion['kind'], reason: string | undefined): { label: string; detail: string } {
  return (kind === 'retake' && reason ? RETAKE_REASONS[reason] : undefined) ?? KIND_REASONS[kind]
}

/** 做法名用结果说：留哪一遍、换个切点、都留；换切点有几种时按顺序编号。 */
export function audioEditClueOptionLabel(id: string, spliceIndex = 0, spliceCount = 1): string {
  if (id === 'keep_later') return '留后一遍'
  if (id === 'keep_earlier') return '留前一遍'
  if (id === 'keep_both') return '两遍都留'
  if (id.startsWith('splice_')) return spliceCount > 1 ? `换个切点 ${spliceIndex + 1}` : '换个切点'
  return '另一种剪法'
}

/** 语气词、长停顿线索只有处理与保留两种做法，与重念的做法 id 分开，免得混写进 chosen_option */
const HINT_APPLY = 'hint:apply'
const HINT_KEEP = 'hint:keep'

function clueText(document: AudioEditProjectDocument, item: AudioEditSuggestion): string {
  if (item.kind === 'long_silence') return `停顿 ${((item.endFrame - item.startFrame) / document.source.sampleRate).toFixed(1)} 秒`
  const text = audioEditSuggestionTexts(document, item.id).removed
  return (item.kind === 'filler' ? normalizeAudioEditFiller(text) || text : text) || item.title
}

function retakeOptions(document: AudioEditProjectDocument, item: AudioEditSuggestion): AudioEditClueOption[] {
  const options = document.suggestionHandoff?.[item.id]?.options ?? []
  const texts = new Map(audioEditSuggestionOptionTexts(document, item.id).map((entry) => [entry.id, entry.reads_as]))
  const splices = options.filter((option) => option.id.startsWith('splice_'))
  return options.map((option) => {
    const readsAs = texts.get(option.id)
    return { id: option.id, label: audioEditClueOptionLabel(option.id, splices.indexOf(option), splices.length), ...(readsAs ? { readsAs } : {}) }
  })
}

function rowFor(document: AudioEditProjectDocument, item: AudioEditSuggestion, tier?: AudioEditClueTier): AudioEditClueRow {
  const base = { id: item.id, kind: item.kind, text: clueText(document, item), startFrame: item.startFrame, endFrame: item.endFrame }
  if (item.kind !== 'retake' || !document.suggestionHandoff?.[item.id]?.options?.length) {
    const apply = item.kind === 'long_silence' ? '压缩' : item.kind === 'retake' ? '删掉前一遍' : '删掉'
    const current = item.status === 'applied' ? HINT_APPLY : item.status === 'dismissed' ? HINT_KEEP : undefined
    return {
      ...base, tier: tier ?? audioEditClueTier(document, item) ?? 'hint', reason: audioEditClueReason(item.kind, undefined),
      options: [{ id: HINT_APPLY, label: apply }, { id: HINT_KEEP, label: item.kind === 'retake' ? '两遍都留' : '保留' }],
      ...(current ? { current } : {}),
      // 旧口播的重念没有交接材料：处理过以后只能逐词恢复
      ...(item.status !== 'pending' ? { blocked: '已处理过，可在文字稿里逐词恢复' } : {}),
    }
  }
  const current = chosenAudioEditSuggestionOption(document, item)
  const blocked = audioEditSuggestionOptionBlocker(document, item)
  return {
    ...base, tier: tier ?? audioEditClueTier(document, item) ?? 'auto', reason: audioEditClueReason('retake', document.suggestionHandoff[item.id].reason),
    options: retakeOptions(document, item), ...(current ? { current } : {}), ...(blocked ? { blocked } : {}),
  }
}

const TIER_ORDER: Record<AudioEditClueTier, number> = { decide: 0, check: 1, auto: 2, hint: 3 }

/**
 * 面板里的线索行：要人定的在最前，抽看的次之，各层内按时间先后（人过一遍时是顺着听的）。
 * `pinned` 是这次打开面板后改判过的线索与它当时所在的层：改判后分层会变，但正在过的那一行不该跳走。
 */
export function buildAudioEditClueRows(document: AudioEditProjectDocument, pinned: ReadonlyMap<string, AudioEditClueTier> = new Map()): AudioEditClueRow[] {
  const rows: AudioEditClueRow[] = []
  for (const item of document.suggestions) {
    const tier = pinned.get(item.id)
    if (!tier && !audioEditClueTier(document, item)) continue
    if (tier && audioEditSuggestionState(document, item) === 'stale') continue
    rows.push(rowFor(document, item, tier))
  }
  return rows.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.startFrame - b.startFrame)
}

/** 底栏计数按线索此刻的真实分层算，不受固定行影响；与助手读到的 audio_edit.document.clue_counts 同一份。 */
export const countAudioEditClues = audioEditClueCounts

/**
 * 改判一条线索：重念走与助手写 chosen_option 相同的 chooseAudioEditSuggestionOption；语气词、停顿走处理 / 隐藏。
 * 人在这里定了，助手标给用户的那条就不再等人（与助手把 audience 写回 assistant 相同）。做不成时原样返回文档。
 */
export function chooseAudioEditClueOption(document: AudioEditProjectDocument, id: string, optionId: string): AudioEditProjectDocument {
  const item = document.suggestions.find((entry) => entry.id === id)
  if (!item) return document
  let next: AudioEditProjectDocument
  if (optionId === HINT_APPLY) next = item.status === 'pending' ? applyAudioEditSuggestion(document, id) : document
  else if (optionId === HINT_KEEP) next = item.status === 'pending' ? dismissAudioEditSuggestion(document, id) : document
  else next = chooseAudioEditSuggestionOption(document, id, optionId)
  const handoff = next.suggestionHandoff?.[id]
  if (next === document || handoff?.audience !== 'user') return next
  const { audience: _audience, ...rest } = handoff
  return { ...next, suggestionHandoff: { ...next.suggestionHandoff, [id]: rest } }
}
