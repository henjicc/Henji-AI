import { isCodeImageReference } from './codeMaterial/contract'
import type { VideoEditClip } from './document'

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

/** 风格件带到别的剪辑里用：效果代码里对本剪辑片段的引用在那里没有意义，保存时置空。 */
export function detachVideoEditEffectClipReferences<T extends { code?: { parameters: object } }>(effects: readonly T[]): T[] {
  return effects.map(effect => {
    if (!effect.code || !Object.values(effect.code.parameters).some(isClipReference)) return effect
    return { ...effect, code: { ...effect.code, parameters: Object.fromEntries(Object.entries(effect.code.parameters).map(([key, value]) => [key, isClipReference(value) ? null : value])) } }
  })
}
