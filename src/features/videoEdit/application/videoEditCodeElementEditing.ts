import { codeElementOverrideValuesSchema, evaluateCodeElementOverride, readCodeElementOverride, type CodeElementOverride, type CodeElementOverrideKey, type CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import { compareCodeMaterialTime, type CodeMaterialKeyframe } from '@/core/videoEdit/codeMaterialAnimation'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import type { VideoEditSourceTime } from '@/core/videoEdit/time'
import { openAssistant, assetToAgentAttachment } from '@/features/assistant'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { readVideoEditCodeProgram } from './videoEditCodeState'
import { createVideoEditAnnotation, updateVideoEditAnnotation, videoEditAnnotationPrompt } from './videoEditAnnotations'
import { videoEditCodeElementFrames, videoEditCodeElementRegion } from './videoEditCodeElements'
import { editVideoProject, focusVideoEditPanel, requireVideoEditInstance, updateVideoEditGesture, type VideoEditGesture } from './videoEditService'
import { readVideoEditCodeEditor, setVideoEditCodeParameter, type VideoEditCodeTarget } from './videoEditCodeParameters'
import { codeAuthorTextParameterValue, readCodeAuthorTextBinding } from '@/core/videoEdit/codeAuthorTextBinding'
import { z } from 'zod'
import { codeMaterialVersion } from '@/core/videoEdit/codeMaterialDocument'
import { openVideoEditCodeProjectFile } from './videoEditCodeProjectView'

const elementEditSchema = codeElementOverrideValuesSchema.extend({ text: z.string().max(4096).optional() })

export interface VideoEditCodeElementTarget extends VideoEditCodeTarget { elementId: string }
function resolve(target: VideoEditCodeElementTarget, document = requireVideoEditInstance(target.projectId).document) {
  const sequence = document.sequences.find(value => value.id === target.sequenceId)
  const clip = sequence?.clips.find(value => value.id === target.clipId)
  if (!sequence || clip?.kind !== 'code' || !clip.code || clip.code.versionId !== target.versionId || target.effectId) throw new Error('原代码元素或源码版本已改变，请重新选择。')
  return { sequence, clip }
}
export function readVideoEditCodeElementEdit(target: VideoEditCodeElementTarget) {
  const owner = requireVideoEditInstance(target.projectId); const { sequence, clip } = resolve(target)
  const time = videoEditClipSourceTimeAt(clip, Math.max(0, Math.min(clip.duration - 1, owner.frame - clip.start)), sequence.frameRate)
  const entry = videoEditCodeElementFrames(owner, sequence.id, Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.frame))).get(clip.id)
  const element = entry?.index.byId.get(target.elementId)
  const program = readVideoEditCodeProgram(owner, owner.document, clip.code!)
  const override = readCodeElementOverride(clip.elementOverrides, target.elementId) ?? {}
  const editor = readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId)
  const textBinding = readCodeAuthorTextBinding(element?.author, editor.metadata.parameters, editor.parameters)
  return { owner, sequence, clip, entry, element, program, override, values: evaluateCodeElementOverride(override, time), time, textBinding, parameters: editor.parameters }
}
function edit(target: VideoEditCodeElementTarget, change: (clip: ReturnType<typeof resolve>['clip']) => void, gesture?: VideoEditGesture): void {
  if (gesture && gesture.projectId !== target.projectId) throw new Error('元素调整不属于此剪辑。')
  const update = (document: VideoEditDocument): VideoEditDocument => { const { clip } = resolve(target, document); change(clip); if (!Object.keys(clip.elementOverrides ?? {}).length) delete clip.elementOverrides; return document }
  if (gesture) updateVideoEditGesture(gesture, update)
  else editVideoProject(target.projectId, update)
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
export function updateVideoEditCodeElement(target: VideoEditCodeElementTarget, patch: CodeElementOverrideValues & { text?: string }, options: { gesture?: VideoEditGesture; time?: VideoEditSourceTime } = {}): void {
  const parsed = elementEditSchema.parse(patch)
  const current = readVideoEditCodeElementEdit(target)
  if (!current.element) throw new Error('此帧的元素不存在，请选择可见元素。')
  if (parsed.text !== undefined && current.textBinding) {
    if (Object.keys(parsed).length !== 1) throw new Error('文字内容和样式请分别修改。')
    setVideoEditCodeParameter(target, current.textBinding.parameter, codeAuthorTextParameterValue(current.textBinding, current.parameters, parsed.text), { gesture: options.gesture, time: options.time ?? current.time }); return
  }
  const unsupported = Object.keys(parsed).filter(key => !['dx', 'dy', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity', 'hidden'].includes(key))
  if (unsupported.length) throw new Error(`此图层没有声明对应参数（${unsupported.join('、')}），请让助手修改源码。`)
  edit(target, clip => {
    const value = ensureOverride(clip, target.elementId)
    for (const [key, next] of Object.entries(parsed)) {
      const field = key as CodeElementOverrideKey
      const points = value.curves?.[field]
      if (points?.length) value.curves![field] = upsert(points, options.time ?? current.time, next, field)
      else Object.assign(value, { [key]: next })
    }
  }, options.gesture)
}
export function resetVideoEditCodeElement(target: VideoEditCodeElementTarget): void { edit(target, clip => { if (clip.elementOverrides) delete clip.elementOverrides[target.elementId] }) }
/** Explicitly arm/freeze transform channels. Static typography is never implicitly keyed. */
export function setVideoEditCodeElementAutoKeyframes(target: VideoEditCodeElementTarget, enabled: boolean): void {
  const current = readVideoEditCodeElementEdit(target)
  edit(target, clip => {
    const override = ensureOverride(clip, target.elementId)
    for (const key of ['dx', 'dy', 'scaleX', 'scaleY', 'rotation'] as const) {
      const value = Number(current.values[key] ?? (key.startsWith('scale') ? 1 : 0))
      if (enabled) { if (!override.curves?.[key]) override.curves = { ...override.curves, [key]: upsert([], current.time, value, key) } }
      else { if (override.curves) delete override.curves[key]; Object.assign(override, { [key]: value }) }
    }
    if (!Object.keys(override.curves ?? {}).length) delete override.curves
  })
}
export function toggleVideoEditCodeElementKeyframe(target: VideoEditCodeElementTarget, key: CodeElementOverrideKey): void {
  if (!['dx', 'dy', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity', 'hidden'].includes(key)) throw new Error('文字与样式请使用作者声明的参数设置关键帧。')
  const current = readVideoEditCodeElementEdit(target)
  const fallback = key === 'dx' || key === 'dy' || key === 'rotation' ? 0 : key === 'hidden' ? false : 1
  const value = codeElementOverrideValuesSchema.shape[key].parse(current.values[key] ?? fallback)
  if (value === undefined) throw new Error('此元素没有这项可编辑属性。')
  edit(target, clip => {
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
  const frame = await observeVideoEditFrame(target.projectId, { kind: 'program', sequenceId: target.sequenceId, frame: at }, 1920, signal)
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
