import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { videoEditCodeClipReferenceIds } from '@/core/videoEdit/codeClipReferences'
import type { CodeMaterialRetargetedInstance } from '@/core/videoEdit/codeMaterialDocument'
import type { VideoEditClip, VideoEditDocument } from '@/core/videoEdit/document'
import { ensureVideoEditCodeParameterMetadata, peekVideoEditCodeProgram } from './videoEditCodeState'

const NO_PICTURE: Partial<Record<VideoEditClip['kind'], string>> = { audio: '声音', light: '灯光', adjustment: '调整层' }
/** 只用声音部分的视频片段同样没有画面。 */
const noPicture = (clip: VideoEditClip): string | undefined => NO_PICTURE[clip.kind] ?? (clip.sourceComponent === 'audio' ? '声音' : undefined)
const worldScene = (owner: object, clip: VideoEditClip): boolean => !!clip.code && peekVideoEditCodeProgram(owner, clip.code.versionId)?.worldScene === true

/** 片段选单只列引用得到画面的片段；世界场景看已读取的声明，尚未读取的在写入时再判断。 */
export function videoEditCodeClipReferenceSelectable(owner: object, clip: VideoEditClip): boolean {
  return !noPicture(clip) && !worldScene(owner, clip)
}

/**
 * 引用只取片段自身的画面。世界场景单独拿出来时用不上序列的相机、灯光与环境（实测画面按默认相机出，和时间线上看到的不同），
 * 声音、灯光、调整层没有自身画面（输入图是空的），所以都在写入时拒绝。放进子序列的世界场景带着子序列的相机，引用嵌套片段画面正确。
 */
async function assertReferable(owner: object, document: VideoEditDocument, referrer: VideoEditClip, target: VideoEditClip | undefined, signal?: AbortSignal): Promise<void> {
  if (!target || target.id === referrer.id) throw new Error('只能引用同一序列里的另一个片段。')
  const kind = noPicture(target)
  if (kind) throw new Error(`片段“${target.name}”是${kind}，没有可引用的画面，请改选有画面的片段。`)
  if (target.kind !== 'code' || !target.code) return
  await ensureVideoEditCodeParameterMetadata(owner, document, target.code.definitionId, target.code.versionId, signal)
  if (worldScene(owner, target)) throw new Error(`片段“${target.name}”是三维世界场景，画面由序列的相机和灯光决定，直接引用会画错。请把它放进子序列（相机也设在子序列里），再引用这个嵌套片段。`)
}

function clipReferenceTargets(clip: VideoEditClip | undefined): Map<string, string> {
  return new Map(Object.entries(clip?.code?.parameters ?? {}).flatMap(([parameter, value]) => isCodeImageReference(value) && value.kind === 'clip' ? [[parameter, value.clipId] as const] : []))
}

/** 旧版本读不到时不算世界场景：能否换走不该取决于旧源码还在不在。 */
async function versionIsWorldScene(owner: object, document: VideoEditDocument, code: NonNullable<VideoEditClip['code']>, signal?: AbortSignal): Promise<boolean> {
  try { await ensureVideoEditCodeParameterMetadata(owner, document, code.definitionId, code.versionId, signal) } catch (error) { signal?.throwIfAborted(); return false }
  return peekVideoEditCodeProgram(owner, code.versionId)?.worldScene === true
}

/**
 * 写入片段代码时核对这次新出现的引用；被别的片段引用的片段换源码版本时，只拦“这次才变成世界场景”的情况。
 * 只看这次的变化：已有的引用不挡住无关的修改，旧工程里已引用世界场景的片段照常能改源码。
 */
export async function assertVideoEditCodeClipReferenceWrite(owner: object, before: VideoEditDocument, next: VideoEditDocument, sequenceId: string, clipId: string, signal?: AbortSignal): Promise<void> {
  const clips = next.sequences.find(sequence => sequence.id === sequenceId)!.clips
  const clip = clips.find(value => value.id === clipId)!
  const previous = before.sequences.find(sequence => sequence.id === sequenceId)?.clips.find(value => value.id === clipId)
  const existing = clipReferenceTargets(previous)
  for (const [parameter, target] of clipReferenceTargets(clip)) {
    if (existing.get(parameter) !== target) await assertReferable(owner, next, clip, clips.find(value => value.id === target), signal)
  }
  if (!previous?.code || !clip.code || previous.code.versionId === clip.code.versionId) return
  const referrer = clips.find(value => value.id !== clipId && videoEditCodeClipReferenceIds(value).includes(clipId))
  if (!referrer || await versionIsWorldScene(owner, before, previous.code, signal)) return
  await assertReferable(owner, next, referrer, clip, signal)
}

/**
 * 批量换版本（升级素材、更新模板）与单个写入相反，这里不拒绝也不跳过：一个片段不该挡住整批，留在旧版本又会脱离“全部实例一起变”。
 * 引用保留，这次才变成世界场景的事实写进该实例的迁移说明，由调用方交代。声明在换版本前已读好；
 * 旧版本读不到（`unreadable`）时不知道它本来是不是世界场景，不报，免得把源码已丢的旧世界场景说成“这次才变”。
 */
export function noteVideoEditCodeClipWorldScenes(owner: object, before: VideoEditDocument, moved: { document: VideoEditDocument; instances: CodeMaterialRetargetedInstance[] }, unreadable: ReadonlySet<string>): { instances: CodeMaterialRetargetedInstance[]; facts: string[] } {
  const facts: string[] = []
  const instances = moved.instances.map(instance => {
    const { target } = instance
    if (target.kind !== 'clip') return instance
    const clips = moved.document.sequences.find(sequence => sequence.id === target.sequenceId)!.clips
    const clip = clips.find(value => value.id === target.id)!
    const previous = before.sequences.find(sequence => sequence.id === target.sequenceId)?.clips.find(value => value.id === target.id)
    if (!previous?.code || unreadable.has(previous.code.versionId) || worldScene(owner, previous) || !worldScene(owner, clip)) return instance
    const referrers = clips.filter(value => value.id !== clip.id && videoEditCodeClipReferenceIds(value).includes(clip.id))
    if (!referrers.length) return instance
    const fact = `片段“${clip.name}”换版本后成了三维世界场景，${referrers.map(value => `“${value.name}”`).join('、')}仍直接引用它，画面按默认相机出，和时间线上不同。请把它放进子序列（相机也设在子序列里），再引用这个嵌套片段。`
    facts.push(fact)
    return { ...instance, note: instance.note ? `${instance.note}；${fact}` : fact }
  })
  return { instances, facts }
}
