import type { z } from 'zod'
import type { remixVideoEditMusicCapability } from '@/core/application-control/domains/videoEdit/videoEditMusicRemixCapability'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { verifyVideoEditContentSaved } from './videoEditDocumentAlgorithm'
import { remixVideoEditMusic, VideoEditMusicRemixRejection, type VideoEditMusicRemixTarget } from './videoEditMusicRemix'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit } from './videoEditService'

type Input = z.infer<typeof remixVideoEditMusicCapability.inputSchema>
type Output = z.infer<typeof remixVideoEditMusicCapability.outputSchema>

function childOf(projectId: string, value: { kind: string; id: string }): string {
  const parsed = splitVideoEditRef(value)
  if (parsed.projectId !== projectId || !parsed.childId) throw new ApplicationPreflightFailure(new Error(`${value.kind} 必须属于目标剪辑，请使用目录返回的完整引用。`))
  return parsed.childId
}

/** 助手入口：引用换成标识后委托与界面相同的 remixVideoEditMusic，保存并按保存后的片段核对时长与接缝。 */
export async function executeVideoEditMusicRemixCapability(input: Input, signal?: AbortSignal): Promise<Output> {
  const projectId = input.documentRef.id
  const sequenceId = childOf(projectId, input.sequenceRef), clipId = childOf(projectId, input.clipRef)
  const target: VideoEditMusicRemixTarget = input.target.kind === 'clip_end' ? { kind: 'clip_end', clipId: childOf(projectId, input.target.clipRef) } : input.target
  const owner = requireVideoEditInstance(projectId), before = owner.contentVersion
  let result: Awaited<ReturnType<typeof remixVideoEditMusic>>
  try {
    result = await remixVideoEditMusic({ projectId, sequenceId, clipId, target, repetition: input.repetition, granularity: input.granularity, seed: input.seed }, signal)
  } catch (error) {
    if (owner.contentVersion !== before) throw error
    const facts = error instanceof VideoEditMusicRemixRejection ? [error.facts.minSeconds !== undefined ? `可行的最短时长约 ${Math.ceil(error.facts.minSeconds)} 秒` : '', error.facts.maxSeconds !== undefined ? `目前最长约 ${Math.floor(error.facts.maxSeconds)} 秒` : ''].filter(Boolean).join('，') : ''
    throw new ApplicationPreflightFailure(facts && error instanceof Error ? new Error(`${error.message}（${facts}）`) : error)
  }
  const expected = owner.document, committed = owner.contentVersion
  try { await saveVideoEdit(projectId) } catch (error) {
    throw new ApplicationPersistenceFailure('音乐已重构但未保存，请重试保存，不要重复重构。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error)
  }
  const saved = await verifyVideoEditContentSaved(owner, expected, committed)
  const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  const clips = sequence?.clips.filter(clip => clip.remix?.id === result.remixId).sort((a, b) => a.start - b.start) ?? []
  const contiguous = clips.length === result.clipIds.length && clips.every((clip, k) => k === 0 ? clip.start === result.startFrame : clip.start === clips[k - 1].start + clips[k - 1].duration)
  const span = clips.length ? clips.at(-1)!.start + clips.at(-1)!.duration - clips[0].start : 0
  const joined = clips.slice(1).every((clip, k) => sequence!.transitions?.some(transition => transition.kind === 'constant_power' && transition.leftClipId === clips[k].id && transition.rightClipId === clip.id))
  const verified = saved && contiguous && span === result.targetFrames && joined
  const weakest = result.seams.reduce((min, seam) => Math.min(min, seam.confidence), 1)
  return {
    documentRef: input.documentRef, resultRefs: result.clipIds.map(id => ({ kind: 'video_edit.clip', id: `${projectId}:${id}` })), remixId: result.remixId,
    startFrame: result.startFrame, targetFrames: result.targetFrames, seams: result.seams, trimmedSeconds: result.trimmedSeconds, analysis: result.analysis,
    message: `已重构为 ${result.targetFrames} 帧（${result.clipIds.length} 段、${result.seams.length} 个接缝${result.seams.length ? `，最弱接缝把握 ${weakest.toFixed(2)}` : ''}）${result.trimmedSeconds > 0.05 ? `，结尾截掉 ${result.trimmedSeconds.toFixed(1)} 秒并淡出` : ''}${result.analysis.model === 'fallback' ? '；节拍模型不可用，本次用较粗的节拍估计' : ''}，可一步撤销。`,
    verification: { verified, condition: verified ? '已保存并读回：子片段首尾相接、总长等于目标帧数，每个接缝都有恒定功率过渡。' : '保存回读或结构核对未通过，请读回片段检查。' },
  }
}
