import { isCodeImageReference } from './codeMaterial/contract'
import type { VideoEditClip, VideoEditSequence } from './document'

type CodeParameters = Record<string, unknown>

/** 先按字段粗筛再完整校验：完整校验靠 try/catch，时间线每次编辑都要过一遍所有参数，数字、颜色这类参数不该每次都抛一次。 */
function isClipReference(value: unknown): value is { kind: 'clip'; clipId: string } {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'clip' && isCodeImageReference(value)
}

function codeParameterSets(clip: VideoEditClip): CodeParameters[] {
  return [clip.code?.parameters, ...(clip.effects ?? []).map(effect => effect.code?.parameters)].filter(value => !!value) as CodeParameters[]
}

/** 片段的代码（含代码滤镜）里图片参数引用的其他时间线片段。 */
export function videoEditCodeClipReferenceIds(clip: VideoEditClip): string[] {
  return codeParameterSets(clip).flatMap(parameters => Object.values(parameters).flatMap(value => isClipReference(value) ? [value.clipId] : []))
}

/**
 * 改写片段代码里对其他片段的引用：`map` 给出新 ID 就改写，给 null 就把参数置空（引用不到了），给 undefined 保持不变。
 * 复制、粘贴、复制序列、拆分时片段换了 ID，引用要跟着指向对应的新片段。没有引用时原样返回同一对象。
 */
export function remapVideoEditCodeClipReferences(clip: VideoEditClip, map: (clipId: string) => string | null | undefined): VideoEditClip {
  const rewrite = (parameters: CodeParameters): CodeParameters => {
    let changed = false
    const next = Object.fromEntries(Object.entries(parameters).map(([key, value]) => {
      if (!isClipReference(value)) return [key, value]
      const target = map(value.clipId)
      if (target === undefined || target === value.clipId) return [key, value]
      changed = true
      return [key, target === null ? null : { kind: 'clip', clipId: target }]
    }))
    return changed ? next : parameters
  }
  const code = clip.code ? rewrite(clip.code.parameters as CodeParameters) : undefined
  const effects = clip.effects?.map(effect => effect.code ? { effect, parameters: rewrite(effect.code.parameters as CodeParameters) } : { effect, parameters: undefined })
  const codeChanged = !!clip.code && code !== clip.code.parameters
  const effectsChanged = !!effects?.some(({ effect, parameters }) => parameters !== undefined && parameters !== effect.code!.parameters)
  if (!codeChanged && !effectsChanged) return clip
  return {
    ...clip,
    ...(codeChanged ? { code: { ...clip.code!, parameters: code as NonNullable<VideoEditClip['code']>['parameters'] } } : {}),
    ...(effectsChanged ? { effects: effects!.map(({ effect, parameters }) => parameters === undefined || parameters === effect.code!.parameters ? effect : { ...effect, code: { ...effect.code!, parameters: parameters as NonNullable<typeof effect.code>['parameters'] } }) } : {}),
  }
}

/**
 * 被引用片段切成两半后该指向哪一半：与引用方时间重叠最多的一半，重叠相同取左半。
 * 引用只在帧落在被引用片段自身范围内时才有画面，所以引用方同一帧也被切开时，两半各自只与同侧那半重叠，
 * 切开前后每一帧取到的画面不变。
 */
export function videoEditCodeClipSplitTarget(referrer: Pick<VideoEditClip, 'start' | 'duration'>, left: Pick<VideoEditClip, 'id' | 'start' | 'duration'>, right: Pick<VideoEditClip, 'id' | 'start' | 'duration'>): string {
  const overlap = (target: Pick<VideoEditClip, 'start' | 'duration'>): number => Math.max(0, Math.min(referrer.start + referrer.duration, target.start + target.duration) - Math.max(referrer.start, target.start))
  return overlap(right) > overlap(left) ? right.id : left.id
}

/**
 * 一次切割结束后按最终时间重新决定每个引用指向哪一半。逐个拆分时，先拆被引用片段再拆引用方，引用方的两半会沿用
 * 同一个目标，结果取决于处理顺序；最终时间与处理顺序无关，这里统一算一遍。
 * @param rights 右半 ID → 原片段（左半）ID。
 */
export function retargetVideoEditSplitCodeClipReferences(clips: readonly VideoEditClip[], rights: ReadonlyMap<string, string>): VideoEditClip[] {
  const byId = new Map(clips.map(clip => [clip.id, clip]))
  const rightOf = new Map([...rights].map(([right, left]) => [left, right]))
  return clips.map(clip => remapVideoEditCodeClipReferences(clip, target => {
    const leftId = rights.get(target) ?? (rightOf.has(target) ? target : undefined)
    if (leftId === undefined) return undefined
    return videoEditCodeClipSplitTarget(clip, byId.get(leftId)!, byId.get(rightOf.get(leftId)!)!)
  }))
}

/** 片段从序列里移除后，其余片段里指向它的代码参数置空：不留下每帧都找不到的引用。没有这种引用时原样返回同一序列。 */
export function detachVideoEditRemovedCodeClipReferences(previous: Pick<VideoEditSequence, 'clips'>, sequence: VideoEditSequence): VideoEditSequence {
  const present = new Set(sequence.clips.map(clip => clip.id))
  const removed = new Set(previous.clips.map(clip => clip.id).filter(id => !present.has(id)))
  if (!removed.size) return sequence
  const clips = sequence.clips.map(clip => remapVideoEditCodeClipReferences(clip, target => removed.has(target) ? null : undefined))
  return clips.every((clip, index) => clip === sequence.clips[index]) ? sequence : { ...sequence, clips }
}

/** 一次编辑让仍在序列里的片段失去的引用：哪个片段（或它的哪个代码滤镜）的哪个参数原来指向哪个片段。 */
export interface VideoEditLostCodeClipReference { clipId: string; effectId?: string; parameter: string; targetClipId: string }
export function videoEditLostCodeClipReferences(before: readonly VideoEditClip[], after: readonly VideoEditClip[]): VideoEditLostCodeClipReference[] {
  const remaining = new Map(after.map(clip => [clip.id, clip]))
  const existed = new Set(before.map(clip => clip.id))
  return before.flatMap(clip => {
    const current = remaining.get(clip.id)
    if (!current) return []
    const lost = (parameters: object | undefined, now: object | undefined, effectId?: string): VideoEditLostCodeClipReference[] => Object.entries(parameters ?? {}).flatMap(([parameter, value]) => {
      // 编辑前就指向不存在片段的旧引用被顺手清掉，不是这次编辑造成的损失。
      if (!isClipReference(value) || !existed.has(value.clipId) || remaining.has(value.clipId) || isClipReference((now as CodeParameters | undefined)?.[parameter])) return []
      return [{ clipId: clip.id, ...(effectId ? { effectId } : {}), parameter, targetClipId: value.clipId }]
    })
    return [...lost(clip.code?.parameters, current.code?.parameters), ...(clip.effects ?? []).flatMap(effect => lost(effect.code?.parameters, current.effects?.find(value => value.id === effect.id)?.code?.parameters, effect.id))]
  })
}

/** 风格件带到别的剪辑里用：效果代码里对本剪辑片段的引用在那里没有意义，保存时置空。 */
export function detachVideoEditEffectClipReferences<T extends { code?: { parameters: object } }>(effects: readonly T[]): T[] {
  return effects.map(effect => {
    if (!effect.code || !Object.values(effect.code.parameters).some(isClipReference)) return effect
    return { ...effect, code: { ...effect.code, parameters: Object.fromEntries(Object.entries(effect.code.parameters).map(([key, value]) => [key, isClipReference(value) ? null : value])) } }
  })
}
