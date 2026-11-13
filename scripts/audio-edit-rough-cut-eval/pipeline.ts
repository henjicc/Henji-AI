// 评估台打包入口：按快速处理的顺序把粗剪管线的纯函数串起来（去重念 → 压缩停顿 → 语气词 → 呼吸 → 字间气口）。
// `@rough-cut-core` 由评估台指到被评估的那份源码（当前工作区，或从 Git 取出的某个版本）。
import { detectAudioEditRetakes, audioEditRetakeSuggestion } from '@rough-cut-core/audioEdit/retakes'
import { applyAudioEditSuggestion, cleanAudioEditFillers, DEFAULT_AUDIO_EDIT_SETTINGS } from '@rough-cut-core/audioEdit/edits'
import { audioEditSilenceSuggestions } from '@rough-cut-core/audioEdit/silence'
import { applyAudioEditBreathPolicy } from '@rough-cut-core/audioEdit/breaths'
import { cleanAudioEditGaps } from '@rough-cut-core/audioEdit/gaps'

interface Block { id: string; text: string; startFrame: number; endFrame: number }
interface Pause { startMs: number; endMs: number; cutMs: number }
export interface RoughCutInput {
  sampleRate: number
  channels: number
  durationFrames: number
  referenceScript: string
  blocks: Block[]
  pauses: Pause[]
  breaths?: Array<{ startMs: number; endMs: number; peak: number }>
  levels?: { wideDb: number[]; highDb: number[] }
}

const transcript = (input: RoughCutInput) => input.blocks.map((block) => ({ ...block, included: true, locked: false, granularity: 'word' as const }))

interface Handoff { blockIds: string[]; review: boolean; options: Array<{ id: string; blockIds: string[] }> }
// 被评估的版本可能还没有“做法”这一项（--ref 指到更早的提交）
const handoffOf = (retake: { blockIds: string[]; review: boolean; options?: Array<{ id: string; blockIds: string[] }> }): Handoff =>
  ({ blockIds: retake.blockIds, review: retake.review, options: (retake.options ?? []).map((option) => ({ id: option.id, blockIds: option.blockIds })) })

/** 只跑去重念：返回每处删掉哪些词、是否只是待确认、交给助手的其他做法。 */
export function detectRetakes(input: RoughCutInput): Array<Handoff & { confidence: string; joined: boolean }> {
  return detectAudioEditRetakes(transcript(input), {
    sampleRate: input.sampleRate, pauses: input.pauses, referenceScript: input.referenceScript, ...(input.breaths ? { breaths: input.breaths } : {}),
  }).map((retake) => ({ ...handoffOf(retake), confidence: retake.confidence, joined: retake.joined }))
}

/** 整条快速处理：返回每个词是否被删、全部剪切、待确认的重念。需要逐帧电平与呼吸。 */
export function roughCut(input: RoughCutInput) {
  const { sampleRate } = input
  const settings = DEFAULT_AUDIO_EDIT_SETTINGS
  const breaths = input.breaths ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 评估台要能套在不同版本的源码上，文档类型不跟着某一版走
  let doc: any = {
    id: 'eval', name: 'eval', createdAt: 0, updatedAt: 0, revision: 0, referenceScript: input.referenceScript,
    source: { mediaType: 'audio', sourcePath: 'eval', audioPath: 'eval', sampleRate, channels: input.channels, durationFrames: input.durationFrames },
    transcript: transcript(input), suggestions: [], cuts: [], gainRegions: [], batchSettings: settings,
  }
  const retakes = detectAudioEditRetakes(doc.transcript, { sampleRate, pauses: input.pauses, breaths, referenceScript: input.referenceScript })
  doc = { ...doc, suggestions: retakes.map(audioEditRetakeSuggestion) }
  for (const retake of retakes) if (!retake.review) doc = applyAudioEditSuggestion(doc, retake.id)
  const intervals = input.pauses.map((pause) => ({ startFrame: Math.ceil(pause.startMs * sampleRate / 1000), endFrame: Math.floor(pause.endMs * sampleRate / 1000) }))
  const silences = audioEditSilenceSuggestions(doc, intervals, settings)
  doc = { ...doc, suggestions: [...doc.suggestions, ...silences] }
  for (const silence of silences) doc = applyAudioEditSuggestion(doc, silence.id)
  doc = input.levels ? cleanAudioEditFillers(doc, settings.fillers, undefined, [...input.pauses, ...breaths]) : cleanAudioEditFillers(doc, settings.fillers)
  if (input.levels) {
    const levels = { resolutionMs: 10, wideDb: input.levels.wideDb, highDb: input.levels.highDb }
    doc = applyAudioEditBreathPolicy(doc, breaths, 'delete', undefined, input.pauses, levels).document
    doc = cleanAudioEditGaps(doc, breaths, levels).document
  }
  return {
    deleted: doc.transcript.map((block: { included: boolean }) => !block.included) as boolean[],
    cuts: (doc.cuts ?? []).filter((cut: { enabled: boolean }) => cut.enabled)
      .map((cut: { id: string; startFrame: number; endFrame: number; mode?: string }) => ({ id: cut.id, startFrame: cut.startFrame, endFrame: cut.endFrame, mute: cut.mode === 'mute' })) as Array<{ id: string; startFrame: number; endFrame: number; mute: boolean }>,
    review: retakes.filter((retake) => retake.review).map((retake) => retake.blockIds),
    retakeCount: retakes.filter((retake) => !retake.review).length,
    handoff: retakes.map(handoffOf),
  }
}
