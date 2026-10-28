import type { CodeImageReference, CodeParameterDeclaration, CodeParameterValues, CodeSceneReference } from './codeMaterial/contract'
import { CODE_VIDEO_SPAN_LIMIT } from './codeMaterial/videoSpans'
import type { CodeMaterialInstance } from './codeMaterialPersistence'
import type { VideoEditComposition } from './document'
import { videoEditSceneInputs } from './scene/sceneInputs'
import { videoEditSceneMedia } from './scene/sceneMedia'
import { resolveVideoEditScene, type ResolvedVideoEditScene, type VideoEditSceneResolveIssue } from './scene/sceneResolve'
import type { VideoEditScene } from './scene/sceneSchema'

/**
 * 代码实例渲染时的“合成后的参数”：片段存的参数，加上片子数据（scene 参数）派生的取帧参数。
 * 取帧、解码前瞻、预热、运动审查与预渲染分段都从这里读，不再各自读 code.parameters：派生的视频、截图引用
 * 只由片子数据决定，不存在片段上（sceneInputs.ts）。
 *
 * 解析片子数据要用代码声明的结构（scene 参数的 schema），它只在编译源码后才知道，所以由调用方给出声明读取器：
 * 渲染 Worker 读已编译的程序，应用层读代码参数元数据。读不到时不派生、不解析，scene 参数记进 unresolved。
 * 没有 scene 参数的实例（包括全部作者接口 v4 代码）原样返回 code.parameters，行为与以前完全相同。
 *
 * 对象身份：结果按实例对象缓存，并核对文档的片子数据数组、素材数组与声明数组的身份；解析器本身按片子数据、
 * schema 与素材种类表的对象身份缓存。文档每次编辑都以新对象送进 Worker，同一文档版本内各帧拿到同一个结果对象
 * （解析结果与派生参数都不逐帧重算、不深拷贝），文档变了才重新解析。作者代码因此可以按 params.<key> 的对象身份
 * 缓存自己的派生数据；解析结果是共享的，作者代码不能修改它。
 */
export type VideoEditCodeDeclarationReader = (instance: CodeMaterialInstance) => readonly CodeParameterDeclaration[] | undefined
export type VideoEditCodeSceneDocument = Pick<VideoEditComposition, 'media' | 'scenes'>
/** `from`：问题从片段素材时间的哪一刻起影响画面（例如取帧车道截断以后的内容）；省略表示整段都受影响。 */
export interface VideoEditCodeSceneIssue { readonly parameter: string; readonly scene: VideoEditScene; readonly issue: VideoEditSceneResolveIssue; readonly from?: number }
export interface VideoEditCodeInputs {
  /** 片段存的参数加上 derived。 */
  readonly parameters: CodeParameterValues
  /** 片子数据派生的取帧参数，键是解析结果的 input（作者代码 inputs.images / assets 用同一个键）。 */
  readonly derived: Readonly<Record<string, CodeImageReference>>
  /** scene 参数键 → 解析结果，就是作者代码拿到的 params.<key>。 */
  readonly scenes: Readonly<Record<string, ResolvedVideoEditScene>>
  /** 没能解析的 scene 参数键（声明还没读到、声明不是 scene 类型或引用的片子数据不存在）：作者代码拿到 null。 */
  readonly unresolved: readonly string[]
  readonly issues: readonly VideoEditCodeSceneIssue[]
}

const isSceneValue = (value: unknown): value is CodeSceneReference => typeof value === 'object' && value !== null && !Array.isArray(value) && (value as { kind?: unknown }).kind === 'scene' && typeof (value as { sceneId?: unknown }).sceneId === 'string'
const sceneKeyCache = new WeakMap<CodeParameterValues, readonly string[]>()
/** 实例参数里引用片子数据的键。 */
export function videoEditCodeSceneKeys(instance: Pick<CodeMaterialInstance, 'parameters'> | undefined): readonly string[] {
  if (!instance) return []
  let keys = sceneKeyCache.get(instance.parameters)
  if (!keys) { keys = Object.entries(instance.parameters).flatMap(([key, value]) => isSceneValue(value) ? [key] : []); sceneKeyCache.set(instance.parameters, keys) }
  return keys
}

interface Cached { scenes: VideoEditCodeSceneDocument['scenes']; media: VideoEditCodeSceneDocument['media']; declarations: readonly CodeParameterDeclaration[] | undefined; inputs: VideoEditCodeInputs }
const inputCache = new WeakMap<CodeMaterialInstance, Cached>()

/** 实例没有 scene 参数时返回 undefined。 */
export function videoEditCodeInputs(document: VideoEditCodeSceneDocument, instance: CodeMaterialInstance | undefined, read: VideoEditCodeDeclarationReader | undefined): VideoEditCodeInputs | undefined {
  const keys = videoEditCodeSceneKeys(instance)
  if (!instance || !keys.length) return undefined
  const declarations = read?.(instance)
  const hit = inputCache.get(instance)
  if (hit && hit.scenes === document.scenes && hit.media === document.media && hit.declarations === declarations) return hit.inputs
  const derived: Record<string, CodeImageReference> = {}, scenes: Record<string, ResolvedVideoEditScene> = {}, unresolved: string[] = [], issues: VideoEditCodeSceneIssue[] = []
  for (const key of keys) {
    const sceneId = (instance.parameters[key] as CodeSceneReference).sceneId
    const declaration = declarations?.find(item => item.key === key)
    const scene = document.scenes?.find(item => item.id === sceneId)
    if (declaration?.type !== 'scene' || !scene) { unresolved.push(key); continue }
    const resolved = resolveVideoEditScene(scene, declaration.schema, { media: videoEditSceneMedia(document) })
    scenes[key] = resolved
    Object.assign(derived, videoEditSceneInputs(resolved))
    for (const issue of resolved.issues) { const from = issue.severity === 'user' && issue.path === 'timetable' ? truncatedFrom(resolved, issue.recordId) : undefined; issues.push({ parameter: key, scene, issue, ...(from === undefined ? {} : { from }) }) }
  }
  const inputs: VideoEditCodeInputs = { parameters: Object.keys(derived).length ? { ...instance.parameters, ...derived } : instance.parameters, derived, scenes, unresolved, issues }
  inputCache.set(instance, { scenes: document.scenes, media: document.media, declarations, inputs })
  return inputs
}
/** 合成后的参数（片段存的加派生的取帧参数）；没有 scene 参数时就是 code.parameters 本身。 */
export function videoEditCodeInputParameters(document: VideoEditCodeSceneDocument, instance: CodeMaterialInstance | undefined, read: VideoEditCodeDeclarationReader | undefined): CodeParameterValues {
  return videoEditCodeInputs(document, instance, read)?.parameters ?? instance?.parameters ?? {}
}
/**
 * 交给作者代码的 params：`values` 是这一帧求值并换成输入画面后的参数（含派生的取帧参数）。派生的取帧参数只进
 * inputs.images / assets，不进 params；scene 参数换成解析结果，没能解析的是 null。没有 scene 参数时原样返回。
 */
export function videoEditCodeAuthorParameters(values: CodeParameterValues, inputs: VideoEditCodeInputs | undefined): Readonly<Record<string, unknown>> {
  if (!inputs) return values
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (Object.hasOwn(inputs.derived, key)) continue
    result[key] = Object.hasOwn(inputs.scenes, key) ? inputs.scenes[key] : isSceneValue(value) ? null : value
  }
  return result
}
/** 取帧车道截断以后，这扇窗口从哪一刻起不再取帧：被截断车道保留的最后一段的结束。 */
function truncatedFrom(resolved: ResolvedVideoEditScene, containerId: string | undefined): number | undefined {
  let from: number | undefined
  for (const table of resolved.timetables) {
    if (table.container?.id !== containerId) continue
    for (const input of Object.values(table.inputs)) {
      if (input.kind !== 'video' || !input.spans || input.spans.length < CODE_VIDEO_SPAN_LIMIT) continue
      const to = input.spans[input.spans.length - 1].to
      from = from === undefined ? to : Math.min(from, to)
    }
  }
  return from
}
/** 用户需要看到的问题（severity 'user'），按呈现文字去重；给出 `time`（片段素材秒）时只要影响这一刻的。 */
export function videoEditCodeSceneUserMessages(inputs: VideoEditCodeInputs | undefined, time?: number): string[] {
  return [...new Set((inputs?.issues ?? []).filter(item => item.issue.severity === 'user' && (time === undefined || item.from === undefined || time >= item.from)).map(item => `片子数据“${item.scene.name}”：${item.issue.message}`))]
}
