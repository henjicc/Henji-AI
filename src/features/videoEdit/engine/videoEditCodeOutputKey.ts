import { documentFontRevision } from '@/platform/fontFaces'
import { codeMaterialUsesAudio } from '@/core/videoEdit/codeMaterialResources'
import type { VideoEditFrameFingerprint } from '@/core/videoEdit/renderFingerprint'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { codeMediaInputReference, codeMediaInputSample } from '@/core/videoEdit/codeMediaInput'
import { videoEditCodeInputs } from '@/core/videoEdit/codeInputParameters'
import { renderFingerprintHash, renderSceneRecordFingerprint } from '@/core/videoEdit/renderFingerprint'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditCodePlan } from './videoEditCodeSources'
import type { AuthorFingerprintInput } from './videoEditAuthorFingerprint'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'

/** 对象字段顺序不构成内容差异，数组顺序仍是作者输入的一部分。 */
export function codeOutputSignature(value: unknown): string {
  return renderFingerprintHash(JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    }
    return item
  }))
}

const objectSignatures = new WeakMap<object, string>()
/** 文档快照、音频采样和解析结果按对象替换；新包装只组合已记住的不可变子树。 */
export function codeOutputObjectSignature(value: unknown): string {
  if (!value || typeof value !== 'object') return codeOutputSignature([value])
  const cached = objectSignatures.get(value)
  if (cached !== undefined) return cached
  const key = Array.isArray(value)
    ? codeOutputSignature(['array', value.map(codeOutputObjectSignature)])
    : ArrayBuffer.isView(value) || value instanceof ArrayBuffer
      ? codeOutputSignature(value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : value)
      : codeOutputSignature(['object', Object.keys(value).sort().map(name => [name, codeOutputObjectSignature(Reflect.get(value, name))])])
  objectSignatures.set(value, key)
  return key
}

/** 网页、序列与近似样本没有本票可用的完整身份，沿正式生成路径执行。 */
export function codeOutputInputs(document: VideoEditComposition, plan: VideoEditCodePlan, frame: number,
  inputs: ReadonlyMap<string, VideoEditCodeImageInput> | undefined, exact: (input: VideoEditCodeImageInput) => boolean): Record<string, AuthorFingerprintInput> | undefined {
  if (Object.values(plan.inputParameters ?? {}).some(value => isCodeImageReference(value) && (value.kind === 'web' || value.kind === 'sequence'))) return undefined
  const result: Record<string, AuthorFingerprintInput> = {}
  for (const [name, key] of plan.imageKeys) {
    const reference = codeMediaInputReference(plan.inputParameters?.[name], name)
    if (!reference || reference.kind === 'web' || reference.kind === 'sequence') return undefined
    const media = document.media.find(value => value.id === reference.mediaId), input = inputs?.get(key)
    if (!media || !input || !exact(input)) return undefined
    result[name] = { width: input.width, height: input.height, identity: codeOutputSignature([
      codeOutputObjectSignature(media), reference, reference.kind === 'video' ? codeMediaInputSample(plan.clip, reference, frame, document.frameRate) : null,
      input.premultiplied, input.texture?.format ?? null,
    ]) }
  }
  return result
}

const sceneKeys = new WeakMap<object, string>()
export function codeOutputScenes(document: VideoEditComposition, plan: VideoEditCodePlan): unknown {
  const inputs = videoEditCodeInputs(document, plan.clip.code, () => plan.program!.parameters)
  return Object.entries(inputs?.scenes ?? {}).map(([name, scene]) => {
    let key = sceneKeys.get(scene)
    if (!key) {
      key = codeOutputSignature([scene.scene, scene.schema, scene.cuts, scene.issues, scene.records.map(renderSceneRecordFingerprint),
        scene.timetables.map(table => [table.container?.id, table.kind, String(table.end), table.inputs,
          table.shots.map(({ record, ...shot }) => [record.id, shot])])])
      sceneKeys.set(scene, key)
    }
    return [name, key]
  })
}

/** 声明摘要由作者指纹入口计算，输出复用只补宿主输入与环境身份。 */
export function codeOutputKey(document: VideoEditComposition, plan: VideoEditCodePlan, dependencies: Readonly<Record<string, AuthorFingerprintInput>>,
  declared: VideoEditFrameFingerprint | undefined, quality: EffectQuality = 'interactive', textIdentity?: string): string {
  const program = plan.program!, context = plan.context
  const { sourceTime, overrides, info, environment } = plan.outputFrame!
  return codeOutputSignature([plan.outputIdentity, plan.parameters, ...(textIdentity === undefined ? [] : [textIdentity]), codeOutputScenes(document, plan), dependencies,
    declared?.digest ?? (!declared && program.mode === 'static' && !codeMaterialUsesAudio(program) ? 'static' : [context.time, context.localTime, sourceTime]),
    codeOutputObjectSignature(context.audio), context.audioTime, info.frameDuration, info.clip.duration, context.width, context.height, plan.divisor ?? 1,
    documentFontRevision(), overrides, document.motionBlur === true, codeOutputObjectSignature(environment), quality])
}
