import type { CodeEditActor } from '@/core/videoEdit/codeEdits'
import { assertCodeElementOverrideAllowed, codeElementOverrideValuesSchema, readCodeElementOverride, type CodeElementAddedEffect, type CodeElementEffectOverride, type CodeElementOverride, type CodeElementOverrideKey, type CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import { videoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'
import { compareCodeMaterialTime, type CodeMaterialKeyframe } from '@/core/videoEdit/codeMaterialAnimation'
import type { VideoEditSourceTime } from '@/core/videoEdit/time'
import { openAssistant, assetToAgentAttachment } from '@/features/assistant'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { createVideoEditAnnotation, updateVideoEditAnnotation, videoEditAnnotationPrompt } from './videoEditAnnotations'
import { videoEditCodeElementRegion } from './videoEditCodeElements'
import { focusVideoEditPanel, requireVideoEditInstance, type VideoEditGesture } from './videoEditService'
import { videoEditCodeParameterWriter, type VideoEditCodeTarget } from './videoEditCodeParameters'
import { codeAuthorTextParameterValue } from '@/core/videoEdit/codeAuthorTextBinding'
import { z } from 'zod'
import { codeMaterialVersion } from '@/core/videoEdit/codeMaterialDocument'
import { openVideoEditCodeProjectFile } from './videoEditCodeProjectView'
import { editVideoEditCodeElementClip as edit, readVideoEditCodeElementEdit, resolveVideoEditCodeElementClip as resolve, videoEditCodeElementEffectStates, videoEditCodeElementKind, writeVideoEditCodeElementGroups, type VideoEditCodeElementGroups, type VideoEditCodeElementTarget } from './videoEditCodeElementWrites'

const elementEditSchema = codeElementOverrideValuesSchema.extend({ text: z.string().max(4096).optional() })

export { readVideoEditCodeElementEdit, videoEditCodeElementKind, videoEditCodeElementEffectStates, validateVideoEditElementEffectWrite, writeVideoEditCodeElementGroups, videoEditClipEditsBase, type VideoEditCodeElementTarget, type VideoEditCodeElementGroups } from './videoEditCodeElementWrites'

function effectOverrides(override: CodeElementOverride): Record<string, CodeElementEffectOverride> {
  return Object.assign(Object.create(null) as Record<string, CodeElementEffectOverride>, structuredClone(override.effects ?? {}))
}
function cleanEffects(effects: Record<string, CodeElementEffectOverride>): Pick<CodeElementOverride, 'effects'> {
  const result: Record<string, CodeElementEffectOverride> = {}
  for (const [key, value] of Object.entries(effects)) {
    const entry: CodeElementEffectOverride = { ...(value.enabled === false ? { enabled: false } : {}), ...(Object.keys(value.values ?? {}).length ? { values: value.values } : {}), ...(Object.keys(value.curves ?? {}).length ? { curves: value.curves } : {}) }
    if (Object.keys(entry).length) Object.defineProperty(result, key, { value: entry, writable: true, configurable: true, enumerable: true })
  }
  return Object.keys(result).length ? { effects: result } : {}
}
function upsertEffect(points: CodeMaterialKeyframe[], time: VideoEditSourceTime, value: string | number | boolean, discrete: boolean): CodeMaterialKeyframe[] {
  const previous = points.find(point => compareCodeMaterialTime(point, time) === 0)
  return [...points.filter(point => point !== previous), { ...time, id: previous?.id ?? crypto.randomUUID(), value, interpolation: previous?.interpolation ?? (discrete ? 'hold' : 'linear') } as CodeMaterialKeyframe].sort(compareCodeMaterialTime)
}
function discreteEffectParam(id: string, field: string): boolean {
  const param = id !== 'look' ? videoEditBuiltinEffect(id)?.params.find(param => param.key === field) : undefined
  return !!param && param.type !== 'number' && param.type !== 'color'
}
/** 写入一个效果的值：已有曲线的参数在当前素材时刻写关键帧，静态参数保持静态。 */
function patchEffectValues(values: Record<string, string | number | boolean>, curves: NonNullable<CodeElementEffectOverride['curves']>, patch: Readonly<Record<string, string | number | boolean>>, time: VideoEditSourceTime, id: string): void {
  for (const [field, value] of Object.entries(patch)) {
    if (curves[field]?.length) curves[field] = upsertEffect(curves[field], time, value, discreteEffectParam(id, field))
    else values[field] = value
  }
}
/** 按 key 改元素的一项效果：代码给的效果可改值、曲线与 enabled（只记停用）；追加的效果改 params 与曲线，要关掉就移除它。 */
function updateVideoEditCodeElementEffectAs(actor: CodeEditActor, target: VideoEditCodeElementTarget, key: string, patch: CodeElementEffectOverride, options: { gesture?: VideoEditGesture; time?: VideoEditSourceTime } = {}): void {
  const current = readVideoEditCodeElementEdit(target), time = options.time ?? current.time
  const added = current.override.addedEffects?.find(effect => effect.key === key)
  const effects = effectOverrides(current.override)
  let addedEffects = current.override.addedEffects
  if (added) {
    if (patch.enabled !== undefined) throw new Error(`追加的效果「${key}」没有开关；不要它时请重置（移除）这一项。`)
    const params = { ...added.params }, curves = { ...added.curves, ...patch.curves }
    patchEffectValues(params, curves, patch.values ?? {}, time, added.id)
    addedEffects = addedEffects!.map(effect => effect === added ? { key, id: added.id, params, ...(Object.keys(curves).length ? { curves } : {}) } : effect)
  } else {
    const state = videoEditCodeElementEffectStates(current).find(state => state.key === key && !state.added)
    const previous: CodeElementEffectOverride = Object.hasOwn(effects, key) ? effects[key] : {}
    const next: CodeElementEffectOverride = { ...previous, ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }), values: { ...previous.values }, curves: { ...previous.curves, ...patch.curves } }
    patchEffectValues(next.values!, next.curves!, patch.values ?? {}, time, state?.id ?? '')
    effects[key] = next
  }
  writeVideoEditCodeElementGroups(target, { effects: { ...cleanEffects(effects), ...(addedEffects?.length ? { addedEffects } : {}) } }, actor, options.gesture)
}
/** 一个效果参数开关动画：没有曲线时在当前素材时刻按当前实际值建第一帧，已有曲线时收回成当前实际值的静态值。 */
function toggleVideoEditCodeElementEffectKeyframeAs(actor: CodeEditActor, target: VideoEditCodeElementTarget, key: string, field: string): void {
  const current = readVideoEditCodeElementEdit(target)
  const state = videoEditCodeElementEffectStates(current).find(state => state.key === key && !state.missing)
  if (!state || !Object.hasOwn(state.values, field)) throw new Error(`效果「${key}」没有参数 ${field}。`)
  const value = state.values[field]
  const added = current.override.addedEffects?.find(effect => effect.key === key)
  const curves = added ? { ...added.curves } : { ...(Object.hasOwn(current.override.effects ?? {}, key) ? current.override.effects![key].curves : {}) }
  const animated = !!curves[field]?.length
  if (animated) delete curves[field]
  else curves[field] = upsertEffect([], current.time, value, discreteEffectParam(state.id, field))
  const effects = effectOverrides(current.override)
  let addedEffects = current.override.addedEffects
  if (added) addedEffects = addedEffects!.map(effect => effect === added ? { key, id: added.id, params: { ...added.params, ...(animated ? { [field]: value } : {}) }, ...(Object.keys(curves).length ? { curves } : {}) } : effect)
  else {
    const previous: CodeElementEffectOverride = Object.hasOwn(effects, key) ? effects[key] : {}
    effects[key] = { ...previous, values: { ...previous.values, ...(animated ? { [field]: value } : {}) }, curves }
  }
  writeVideoEditCodeElementGroups(target, { effects: { ...cleanEffects(effects), ...(addedEffects?.length ? { addedEffects } : {}) } }, actor)
}
/** 追加到元素效果链末尾；不指定 key 时取 `<效果 ID>+<序号>`，与代码效果的自动 key（ID、ID#N）分开，源码后加同类效果也不会撞名。 */
function addVideoEditCodeElementEffectAs(actor: CodeEditActor, target: VideoEditCodeElementTarget, effect: Omit<CodeElementAddedEffect, 'key'> & { key?: string }): string {
  const current = readVideoEditCodeElementEdit(target)
  const used = new Set([...videoEditCodeElementEffectStates(current).map(state => state.key), ...(current.override.addedEffects ?? []).map(added => added.key)])
  let key = effect.key ?? `${effect.id}+1`
  for (let index = 2; effect.key === undefined && used.has(key); index++) key = `${effect.id}+${index}`
  writeVideoEditCodeElementGroups(target, { effects: { ...cleanEffects(effectOverrides(current.override)), addedEffects: [...current.override.addedEffects ?? [], { ...effect, key }] } }, actor)
  return key
}
/** 追加的效果整项移除；否则代码给的效果回到代码值并重新启用。 */
function resetVideoEditCodeElementEffectAs(actor: CodeEditActor, target: VideoEditCodeElementTarget, key: string): void {
  const current = readVideoEditCodeElementEdit(target), effects = effectOverrides(current.override)
  const added = current.override.addedEffects?.some(effect => effect.key === key)
  if (!added) delete effects[key]
  const addedEffects = added ? current.override.addedEffects!.filter(effect => effect.key !== key) : current.override.addedEffects
  writeVideoEditCodeElementGroups(target, { effects: { ...cleanEffects(effects), ...(addedEffects?.length ? { addedEffects } : {}) } }, actor)
}
/** 一项效果的几个参数回到原值：代码给的效果去掉这些参数的覆盖与曲线；追加的效果回到效果默认值。 */
function resetVideoEditCodeElementEffectParamsAs(actor: CodeEditActor, target: VideoEditCodeElementTarget, key: string, fields: readonly string[]): void {
  const current = readVideoEditCodeElementEdit(target), effects = effectOverrides(current.override)
  const added = current.override.addedEffects?.find(effect => effect.key === key)
  let addedEffects = current.override.addedEffects
  if (added) {
    const definition = videoEditBuiltinEffect(added.id), params = { ...added.params }, curves = { ...added.curves }
    for (const field of fields) { delete curves[field]; const fallback = definition?.params.find(param => param.key === field)?.default; if (fallback === undefined) delete params[field]; else params[field] = fallback as string | number | boolean }
    addedEffects = addedEffects!.map(effect => effect === added ? { key, id: added.id, params, ...(Object.keys(curves).length ? { curves } : {}) } : effect)
  } else if (Object.hasOwn(effects, key)) {
    const values = { ...effects[key].values }, curves = { ...effects[key].curves }
    for (const field of fields) { delete values[field]; delete curves[field] }
    effects[key] = { ...effects[key], values, curves }
  } else return
  writeVideoEditCodeElementGroups(target, { effects: { ...cleanEffects(effects), ...(addedEffects?.length ? { addedEffects } : {}) } }, actor)
}
function ensureOverride(clip: ReturnType<typeof resolve>['clip'], id: string): CodeElementOverride {
  const values = clip.elementOverrides ??= {}
  const current = readCodeElementOverride(values, id)
  if (current) return current
  const value: CodeElementOverride = {}
  Object.defineProperty(values, id, { value, writable: true, configurable: true, enumerable: true })
  return value
}
function upsert(points: CodeMaterialKeyframe[], time: VideoEditSourceTime, value: CodeMaterialKeyframe['value'], key: CodeElementOverrideKey): CodeMaterialKeyframe[] {
  const previous = points.find(point => compareCodeMaterialTime(point, time) === 0)
  return [...points.filter(point => point !== previous), { ...time, id: previous?.id ?? crypto.randomUUID(), value, interpolation: previous?.interpolation ?? (['text', 'fontFamily', 'hidden'].includes(key) ? 'hold' : 'linear') } as CodeMaterialKeyframe].sort(compareCodeMaterialTime)
}
/** UI and assistant persist one clip property. Existing animation records the current source time, static fields stay static. */
function updateVideoEditCodeElementAs(actor: CodeEditActor, target: VideoEditCodeElementTarget, patch: CodeElementOverrideValues & { text?: string }, options: { gesture?: VideoEditGesture; time?: VideoEditSourceTime } = {}): void {
  const parsed = elementEditSchema.parse(patch)
  const current = readVideoEditCodeElementEdit(target)
  if (!current.element) throw new Error('此帧的元素不存在，请选择可见元素。')
  assertCodeElementOverrideAllowed(current.element.author.kind, parsed)
  if (parsed.text !== undefined && current.textBinding) {
    if (Object.keys(parsed).length !== 1) throw new Error('文字内容和样式请分别修改。')
    videoEditCodeParameterWriter(actor).setVideoEditCodeParameter(target, current.textBinding.parameter, codeAuthorTextParameterValue(current.textBinding, current.parameters, parsed.text), { gesture: options.gesture, time: options.time ?? current.time }); return
  }
  const unsupported = Object.keys(parsed).filter(key => !['dx', 'dy', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity', 'hidden'].includes(key))
  if (unsupported.length) throw new Error(`此图层没有声明对应参数（${unsupported.join('、')}），请让助手修改源码。`)
  edit(actor, target, clip => {
    const value = ensureOverride(clip, target.elementId)
    for (const [key, next] of Object.entries(parsed)) {
      const field = key as CodeElementOverrideKey
      const points = value.curves?.[field]
      if (points?.length) value.curves![field] = upsert(points, options.time ?? current.time, next, field)
      else Object.assign(value, { [key]: next })
    }
  }, options.gesture)
}
/** 变换的一项回到代码给的值：去掉它的静态覆盖与曲线；不需要当前帧观察，隐藏的元素也能恢复显示。 */
function resetVideoEditCodeElementFieldAs(actor: CodeEditActor, target: VideoEditCodeElementTarget, key: CodeElementOverrideKey): void {
  edit(actor, target, clip => {
    const override = readCodeElementOverride(clip.elementOverrides, target.elementId)
    if (!override) return
    delete override[key]
    if (override.curves) { delete override.curves[key]; if (!Object.keys(override.curves).length) delete override.curves }
    if (!Object.keys(override).length) delete clip.elementOverrides![target.elementId]
  })
}
/** 元素的运动模糊：true 强制开、false 关、undefined 回到跟随片段；不走关键帧。 */
function setVideoEditCodeElementMotionBlurAs(actor: CodeEditActor, target: VideoEditCodeElementTarget, value: boolean | undefined): void {
  edit(actor, target, clip => {
    if (value !== undefined) { ensureOverride(clip, target.elementId).motionBlur = value; return }
    const override = readCodeElementOverride(clip.elementOverrides, target.elementId)
    if (!override) return
    delete override.motionBlur
    if (!Object.keys(override).length) delete clip.elementOverrides![target.elementId]
  })
}
function resetVideoEditCodeElementAs(actor: CodeEditActor, target: VideoEditCodeElementTarget): void { edit(actor, target, clip => { if (clip.elementOverrides) delete clip.elementOverrides[target.elementId] }) }
/** Explicitly arm/freeze transform channels. Static typography is never implicitly keyed. */
function setVideoEditCodeElementAutoKeyframesAs(actor: CodeEditActor, target: VideoEditCodeElementTarget, enabled: boolean): void {
  const current = readVideoEditCodeElementEdit(target)
  assertCodeElementOverrideAllowed(videoEditCodeElementKind(current, target.elementId) === 'adjust' ? 'adjust' : undefined, { dx: 0 })
  edit(actor, target, clip => {
    const override = ensureOverride(clip, target.elementId)
    for (const key of ['dx', 'dy', 'scaleX', 'scaleY', 'rotation'] as const) {
      const value = Number(current.values[key] ?? (key.startsWith('scale') ? 1 : 0))
      if (enabled) { if (!override.curves?.[key]) override.curves = { ...override.curves, [key]: upsert([], current.time, value, key) } }
      else { if (override.curves) delete override.curves[key]; Object.assign(override, { [key]: value }) }
    }
    if (!Object.keys(override.curves ?? {}).length) delete override.curves
  })
}
function toggleVideoEditCodeElementKeyframeAs(actor: CodeEditActor, target: VideoEditCodeElementTarget, key: CodeElementOverrideKey): void {
  if (!['dx', 'dy', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity', 'hidden'].includes(key)) throw new Error('文字与样式请使用作者声明的参数设置关键帧。')
  const current = readVideoEditCodeElementEdit(target)
  assertCodeElementOverrideAllowed(videoEditCodeElementKind(current, target.elementId) === 'adjust' ? 'adjust' : undefined, { [key]: current.values[key] ?? 0 } as CodeElementOverrideValues)
  const fallback = key === 'dx' || key === 'dy' || key === 'rotation' ? 0 : key === 'hidden' ? false : 1
  const value = codeElementOverrideValuesSchema.shape[key].parse(current.values[key] ?? fallback)
  if (value === undefined) throw new Error('此元素没有这项可编辑属性。')
  edit(actor, target, clip => {
    const override = ensureOverride(clip, target.elementId)
    if (override.curves?.[key]) { delete override.curves[key]; Object.assign(override, { [key]: value }); if (!Object.keys(override.curves).length) delete override.curves }
    else override.curves = { ...override.curves, [key]: upsert([], current.time, value, key) }
  })
}
export async function askAssistantForVideoEditCodeElement(target: VideoEditCodeElementTarget, bake = false, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const current = readVideoEditCodeElementEdit(target)
  if (!current.element || !current.entry) throw new Error('此元素当前不可见，请选择可见元素。')
  if (current.owner.playing) throw new Error('请先暂停画面，再告诉助手要改哪里。')
  const at = current.owner.frame, contentVersion = current.owner.contentVersion
  const frame = await observeVideoEditFrame(target.projectId, { kind: 'program', sequenceId: target.sequenceId, frame: at }, 1920, signal, undefined, { saveToAssets: true })
  signal?.throwIfAborted()
  if (!isVideoEditContentCurrent(current.owner, contentVersion) || current.owner.frame !== at || current.owner.playing || current.owner.activeSequenceId !== target.sequenceId) throw new Error('原画面已改变，请重新选择元素。')
  const span = current.element.sourceSpan
  const author = current.element.author
  const excerpt = span ? current.entry.files.files[span.file]?.slice(span.start, span.end) : undefined
  const location = `图层：${JSON.stringify({ id: target.elementId, name: author?.name, bounds: author?.bounds, sourceSpan: span, factory: author?.factory, data: author?.data })}。${excerpt === undefined ? '' : `\n局部源码（${span!.file}）：\n${excerpt}\n`}优先使用此定位；数据内容改对应数据项，外观改工厂函数。先观察标注帧截图核对，不必先读取整个效果文件。`
  const component = span && current.entry.files.files[span.file] === undefined
  const text = bake ? `请把这些覆盖写回源码，保留其它元素和动画。覆盖：${JSON.stringify(current.override)}；sourceSpan：${JSON.stringify(span)}。${component ? '此元素来自固定项目组件，不能改写已发布文件。先从 video_edit.code_component 的 versions/source 读回组件，发布组件新版本，再用原素材文件创建新素材版本，让组件导入解析到新版本。' : '创建新的源码版本，'}在同一事务绑定该片段的新版本并只删除已合并覆盖。` : '请修改这里（等待用户说明）。'
  const context = `${text}\n${location}`
  const id = createVideoEditAnnotation(target.projectId, target.sequenceId, { frame: current.owner.frame, clipId: target.clipId, target: { kind: 'element', elementId: target.elementId, ...(span ? { sourceSpan: { file: span.file, start: span.start, end: span.end } } : {}), region: videoEditCodeElementRegion(current.entry, current.element, current.sequence) }, text: context, status: 'open' })
  const mark = current.owner.document.sequences.find(sequence => sequence.id === target.sequenceId)!.annotations.find(mark => mark.id === id)!
  openAssistant(bake ? '请把这个元素的覆盖写回源码：' : '请修改这里：', { attachments: [{ attachment: assetToAgentAttachment(frame.asset), previewSrc: frame.asset.displayUrl }], context: videoEditAnnotationPrompt(target.projectId, [mark], context), onTextSubmitted: submitted => updateVideoEditAnnotation(target.projectId, id, current => ({ ...current, text: `${context}\n用户说明：${submitted}` })) })
  return id
}
export async function bakeVideoEditCodeElement(target: VideoEditCodeElementTarget, signal?: AbortSignal): Promise<'baked' | 'assistant'> {
  signal?.throwIfAborted()
  await askAssistantForVideoEditCodeElement(target, true, signal)
  return 'assistant'
}

const sourceOpeners = new Map<string, () => void>()
let pendingSource: string | undefined
const sourceOpenerKey = (target: VideoEditCodeTarget): string => JSON.stringify([target.projectId, target.sequenceId, target.clipId, target.versionId, target.effectId])
export { videoEditCodeElementHostSummary, videoEditCodeElementOverrideSummary } from './videoEditCodeElementSummary'
export function registerVideoEditCodeSourceOpener(target: VideoEditCodeTarget, open: () => void): () => void { const key = sourceOpenerKey(target); sourceOpeners.set(key, open); if (pendingSource === key) { pendingSource = undefined; open() } return () => { if (sourceOpeners.get(key) === open) sourceOpeners.delete(key) } }
export function showVideoEditCodeElementSource(target: VideoEditCodeElementTarget): void {
  const { clip } = resolve(target)
  // 工程素材的源码在代码工程里：打开元素所在的文件并选中它那一段
  const version = codeMaterialVersion(requireVideoEditInstance(target.projectId).document, clip.code!)
  if (version.project) {
    const span = readVideoEditCodeElementEdit(target).element?.sourceSpan
    const file = span && version.files.find(value => value.path === span.file)
    openVideoEditCodeProjectFile(target.projectId, file ? file.path : version.project.entry, file && span ? { hash: file.hash, start: span.start, end: span.end } : undefined)
    return
  }
  const key = sourceOpenerKey(target); focusVideoEditPanel(target.projectId, 'effects'); const open = sourceOpeners.get(key); if (open) open(); else pendingSource = key }

/** 写入来源在边界绑定：界面用 videoEditCodeElementWriter('user')，应用能力按操作来源创建。 */
export function videoEditCodeElementWriter(actor: CodeEditActor) {
  return {
    updateVideoEditCodeElement: updateVideoEditCodeElementAs.bind(undefined, actor),
    resetVideoEditCodeElement: resetVideoEditCodeElementAs.bind(undefined, actor),
    resetVideoEditCodeElementField: resetVideoEditCodeElementFieldAs.bind(undefined, actor),
    setVideoEditCodeElementMotionBlur: setVideoEditCodeElementMotionBlurAs.bind(undefined, actor),
    setVideoEditCodeElementAutoKeyframes: setVideoEditCodeElementAutoKeyframesAs.bind(undefined, actor),
    toggleVideoEditCodeElementKeyframe: toggleVideoEditCodeElementKeyframeAs.bind(undefined, actor),
    updateVideoEditCodeElementEffect: updateVideoEditCodeElementEffectAs.bind(undefined, actor),
    toggleVideoEditCodeElementEffectKeyframe: toggleVideoEditCodeElementEffectKeyframeAs.bind(undefined, actor),
    addVideoEditCodeElementEffect: addVideoEditCodeElementEffectAs.bind(undefined, actor),
    resetVideoEditCodeElementEffect: resetVideoEditCodeElementEffectAs.bind(undefined, actor),
    resetVideoEditCodeElementEffectParams: resetVideoEditCodeElementEffectParamsAs.bind(undefined, actor),
    writeVideoEditCodeElementGroups: (target: VideoEditCodeElementTarget, groups: VideoEditCodeElementGroups, gesture?: VideoEditGesture) => writeVideoEditCodeElementGroups(target, groups, actor, gesture),
  }
}
// 现有效果控件与画面直接操作是用户入口；界面改用 videoEditCodeElementWriter('user') 后删除这组导出。
export const { updateVideoEditCodeElement, resetVideoEditCodeElement, setVideoEditCodeElementAutoKeyframes, toggleVideoEditCodeElementKeyframe } = videoEditCodeElementWriter('user')
