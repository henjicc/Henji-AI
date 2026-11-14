import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { UNDO_HISTORY_STEPS } from '@/core/undoHistory'
import { getAudioEditProjectInstance, sameAudioEditProjectContent, subscribeAudioEditProjectDisposal, undoAudioEditProject, type AudioEditProjectInstance } from './audioEditProjectInstances'

/*
 * 按回执撤销口播的某一步（undo_audio_edit / redo_audio_edit）。
 * 走与界面同一个撤销栈，但只在这一步正好处在栈顶时才撤或重做：之后有人（通常是用户手改）又改过口播，
 * 直接按栈撤就会把那次修改撤掉，所以拒绝并说明原因，由调用方逐处改回或请用户自己撤销。
 */

interface Step {
  documentId: string
  instance: AudioEditProjectInstance
  /** 这一步之前的作品内容。 */
  before: AudioEditProjectDocument
  /** 这一步之后的作品内容。 */
  after: AudioEditProjectDocument
}

const steps = new Map<string, Step>()
/** 只给最近这些步发回执；更早的步多半已被后续修改压住，撤销本来也会被拒。 */
const MAX_STEPS = UNDO_HISTORY_STEPS

// 口播关闭后撤销历史随实例一起没了，登记也不再留着作品快照
subscribeAudioEditProjectDisposal((documentId) => {
  for (const [ref, step] of steps) if (step.documentId === documentId) steps.delete(ref)
})

/** 显示设置不进撤销，名称是文件名：比较“是不是这一步前后的内容”时不算它们。 */
function sameStepContent(left: AudioEditProjectDocument | undefined, right: AudioEditProjectDocument): boolean {
  return Boolean(left) && sameAudioEditProjectContent({ ...left!, name: right.name, viewSettings: right.viewSettings }, right)
}

/**
 * 一次操作结束后登记它形成的那一步，返回撤销引用；操作没有改动内容，或不是恰好一步（例如被别的修改插进来），返回 undefined。
 * start 是操作开始前读到的作品。
 */
export function recordAudioEditStep(documentId: string, start: AudioEditProjectDocument): string | undefined {
  const instance = getAudioEditProjectInstance(documentId)
  if (!instance || instance.past.at(-1) !== start || sameStepContent(instance.document, start)) return undefined
  const ref = `audio_edit.step:${crypto.randomUUID()}`
  steps.set(ref, { documentId, instance, before: start, after: instance.document })
  while (steps.size > MAX_STEPS) steps.delete(steps.keys().next().value!)
  return ref
}

/**
 * 这一步此刻在撤销栈里的位置：applied 生效且在栈顶（可撤销）；undone 已撤销且在重做栈顶（可重做，可能是用户在界面撤的）；
 * cleared 撤销历史被清空（冲突后重新载入）；buried 之后又有别的修改压在上面。
 */
function stepState(step: Step): 'applied' | 'undone' | 'cleared' | 'buried' {
  const { instance } = step
  if (!instance.past.length && !instance.future.length) return 'cleared'
  if (sameStepContent(instance.document, step.after) && sameStepContent(instance.past.at(-1), step.before)) return 'applied'
  if (sameStepContent(instance.document, step.before) && sameStepContent(instance.future[0], step.after)) return 'undone'
  return 'buried'
}

function requireStep(documentId: string, undoRef: string): Step {
  const step = steps.get(undoRef)
  if (!step || step.documentId !== documentId) throw new Error('找不到这一步：撤销引用只对这份口播、在本次运行里由能力回执给出的那一步有效；口播关闭后引用作废。')
  const instance = getAudioEditProjectInstance(documentId)
  if (!instance || instance !== step.instance) {
    steps.delete(undoRef)
    throw new Error('口播关闭后重新打开过，撤销历史已清空，不能按这条引用撤销。请读回当前内容，用 audio_edit.transcript_block.included 或 audio_edit.cut 逐处改回。')
  }
  if (instance.busy) throw new Error('口播正在处理，等处理完成后再撤销。')
  return step
}

const REDO_HINT = '请读回当前内容，用 audio_edit.transcript_block.included、audio_edit.cut 等逐处改，或请用户在音频编辑里按撤销、重做。'
function refusal(state: 'cleared' | 'buried', action: string): Error {
  return new Error(state === 'cleared'
    ? `CONFLICT:口播在保存冲突后重新载入过，撤销历史已清空，这次没有${action}。${REDO_HINT}`
    : `CONFLICT:这一步之后口播又有了修改（可能是用户手改），为了不冲掉那些修改，这次没有${action}。${REDO_HINT}`)
}

/** 撤销回执对应的那一步。 */
export function undoAudioEditStep(documentId: string, undoRef: string): void {
  const step = requireStep(documentId, undoRef)
  const state = stepState(step)
  if (state === 'undone') throw new Error('这一步已经撤销了（可能是用户在音频编辑里按了撤销）；要恢复用 redo_audio_edit。')
  if (state !== 'applied') throw refusal(state, '撤销')
  undoAudioEditProject(documentId)
}

/** 重做这条回执对应、已被撤销的那一步（不论是按回执撤的还是用户在界面撤的）。 */
export function redoAudioEditStep(documentId: string, undoRef: string): void {
  const step = requireStep(documentId, undoRef)
  const state = stepState(step)
  if (state === 'applied') throw new Error('这一步现在是生效的，不需要重做。')
  if (state !== 'undone') throw refusal(state, '重做')
  undoAudioEditProject(documentId, true)
}

/** 仅供测试：清空登记。 */
export function resetAudioEditStepsForTests(): void { steps.clear() }
