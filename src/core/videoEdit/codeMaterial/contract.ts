import type { AudioContentAnalysis } from '../../audioAnalysis/contentAnalysis'
/** Host safety bounds for structured graphics, component graphs and glyph requests; author JS has no language budget. */
export const CODE_MATERIAL_LIMITS = Object.freeze({ stringLength: 4096, textCharacters: 8192, pathPoints: 4096 })
export type { CodeColor, CodeImageReference, CodeVideoSpan, CodeAudioReference, CodeSceneReference, CodePoint, CodeGrade, CodeGradientStop, CodeRange, CodeEasing, CodeBasicParameterValue, CodeParameterObject, CodeParameterValue, CodeParameterValues, CodeParameterVisibility, CodeBasicParameterDeclaration, CodeParameterTypeDefinition, CodeParameterDeclaration } from '../../imaging/parameterTypes'
import type { CodeColor, CodeImageReference, CodeVideoSpan } from '../../imaging/parameterTypes'
import { CODE_VIDEO_SPAN_LIMIT, codeVideoSpansIssue } from './videoSpans'
export const CODE_PARAMETER_TYPES = ['number', 'angle', 'point', 'range', 'color', 'gradient', 'curve', 'grade', 'choice', 'boolean', 'text', 'textStyle', 'table', 'font', 'image', 'audio', 'easing', 'seed', 'scene'] as const
export interface CodeMaterialContext { time: number; localTime: number; sequenceTime: number; width: number; height: number; frame: number; fps: number; seed?: number; audio?: AudioContentAnalysis; audioTime?: number }
export interface CodeSourceSpan { file: string; start: number; end: number; startLine: number; startColumn: number; endLine: number; endColumn: number }
export const CODE_BLEND_NAMES = ['normal', 'multiply', 'screen', 'overlay', 'add', 'lighten', 'darken', 'difference', 'exclusion', 'soft-light', 'hard-light', 'color-dodge', 'color-burn', 'hue', 'saturation', 'color', 'luminosity'] as const
export type CodeBlend = typeof CODE_BLEND_NAMES[number]
export interface CodeGradient { kind: 'linearGradient' | 'radialGradient' | 'conicGradient'; x1?: number; y1?: number; x2?: number; y2?: number; cx?: number; cy?: number; r?: number; angle?: number; stops: [number, CodeColor][] }
export type CodePaint = CodeColor | CodeGradient
export type CodeMatrix = [number, number, number, number, number, number]
export interface CodeTextLayout { width: number; height: number; lines: string[]; lineWidths?: number[]; baselineOffset?: number; fontSize: number; font: string; fontGeneration?: number; missingFont?: string; glyphs: { text: string; x: number; y: number; width: number }[] }
export interface CodeTextMeasureRequest { text: string; fontFamily: string; fontWeight: number; fontStyle: string; fontSize: number; letterSpacing: number; lineHeight: number; maxWidth: number; wrap: boolean; maxLines: number }
export type CodeTextMeasurer = (request: CodeTextMeasureRequest) => CodeTextLayout
export interface CodeDrawMetadata {
  /** Host-only evaluated correction; never accepted by the author language. */
  elementTransform?: CodeMatrix; authorAnchor?: boolean; authorElementId?: string
  elementId?: string; sourceSpan?: CodeSourceSpan; elementPath?: string[]
  opacity?: number; rotation?: number; scaleX?: number; scaleY?: number; skewX?: number; skewY?: number; anchorX?: number; anchorY?: number; blend?: CodeBlend
  paint?: CodePaint; stroke?: CodePaint; strokeWidth?: number; lineCap?: 'butt' | 'round' | 'square'; lineJoin?: 'miter' | 'round' | 'bevel'; dash?: number[]; trimStart?: number; trimEnd?: number
  shadow?: { x: number; y: number; blur: number; color: CodeColor }; glow?: { radius: number; intensity: number; color: CodeColor }; blur?: number
}
export type CodeDrawCommand = CodeDrawMetadata & (
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: CodeColor; radius: number; radii?: number[] }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number; fill: CodeColor }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: CodeColor }
  | { kind: 'text'; x: number; y: number; text: string; fontSize: number; color: CodeColor; fontFamily: string; align: 'left' | 'center' | 'right'; fontWeight?: number; fontStyle?: string; baseline?: string; letterSpacing?: number; lineHeight?: number; maxWidth?: number; wrap?: boolean; maxLines?: number; layout?: CodeTextLayout }
  | { kind: 'image'; source: CodeImageReference; x: number; y: number; width: number; height: number; opacity: number }
)
export type CodeMaterialErrorCode = 'SOURCE_LIMIT' | 'SYNTAX' | 'TYPE' | 'BUDGET' | 'PARAMETERS' | 'COMPATIBILITY' | 'CONTEXT' | 'NON_FINITE'
export class CodeMaterialError extends Error {
  constructor(readonly code: CodeMaterialErrorCode, message: string, readonly sourceSpan?: CodeSourceSpan) { super(sourceSpan && !message.includes(`（${sourceSpan.file}:`) ? `${message}（${sourceSpan.file}:${sourceSpan.startLine}:${sourceSpan.startColumn}）` : message); this.name = 'CodeMaterialError' }
}
export function assertCodeMaterialKey(key: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || ['__proto__', 'prototype', 'constructor', 'caller', 'callee', 'arguments'].includes(key)) throw new CodeMaterialError('SYNTAX', `不允许的名称：${key}`)
}
export function finiteCodeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new CodeMaterialError('NON_FINITE', `${label}必须是有限数值。`)
  return value
}
export function codeColor(value: unknown, label: string, clamp = false): CodeColor {
  if (!Array.isArray(value) || value.length !== 4) throw new CodeMaterialError('PARAMETERS', `${label}必须是四通道 0 到 1 的 RGBA 颜色。`)
  const channels = [value[0], value[1], value[2], value[3]]
  if (!clamp && channels.some(channel => typeof channel !== 'number' || !Number.isFinite(channel) || channel < 0 || channel > 1)) throw new CodeMaterialError('PARAMETERS', `${label}必须是四通道 0 到 1 的 RGBA 颜色。`)
  return channels.map((channel, index) => Math.min(1, Math.max(0, finiteCodeNumber(channel, `${label}.${['r', 'g', 'b', 'a'][index]}`)))) as CodeColor
}
/** Own data fields of a plain object (no getters, symbols or prototype), or undefined. */
function plainFields(value: unknown): Record<string, PropertyDescriptor> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return undefined
  const fields = Object.getOwnPropertyDescriptors(value)
  return Reflect.ownKeys(value).length === Object.keys(fields).length && Object.values(fields).every(field => 'value' in field) ? fields : undefined
}
/** Validated timetables by identity: references are read every frame, and document values are replaced, never mutated. */
const checkedSpans = new WeakMap<object, CodeVideoSpan[]>()
function codeVideoSpans(value: unknown, label: string): CodeVideoSpan[] {
  const checked = typeof value === 'object' && value !== null ? checkedSpans.get(value) : undefined
  if (checked) return checked
  const fail = (detail: string): never => { throw new CodeMaterialError('PARAMETERS', `${label}.spans ${detail}`) }
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || !value.length || value.length > CODE_VIDEO_SPAN_LIMIT) return fail(`需要 1–${CODE_VIDEO_SPAN_LIMIT} 段 {from,to,src,rate?,cursor?}。`)
  const spans = Array.from({ length: value.length }, (_, index): CodeVideoSpan => {
    const fields = Object.prototype.hasOwnProperty.call(value, index) ? plainFields(value[index]) : undefined
    const number = (key: string, minimum = -Infinity): number | undefined => {
      const field = fields?.[key]?.value
      if (field === undefined) return undefined
      if (typeof field !== 'number' || !Number.isFinite(field) || field < minimum) fail(`[${index}].${key} 必须是${minimum === 0 ? '非负' : ''}有限数值。`)
      return field
    }
    if (!fields || Object.keys(fields).some(key => !['from', 'to', 'src', 'rate', 'cursor'].includes(key))) fail(`[${index}] 只能包含 from、to、src、rate、cursor。`)
    const from = number('from'), to = number('to'), src = number('src', 0), rate = number('rate', 0), cursor = fields!.cursor?.value
    if (from === undefined || to === undefined || src === undefined) fail(`[${index}] 需要 from、to、src。`)
    if (cursor !== undefined && typeof cursor !== 'boolean') fail(`[${index}].cursor 必须是布尔值。`)
    return { from: from!, to: to!, src: src!, ...(rate === undefined ? {} : { rate }), ...(cursor === undefined ? {} : { cursor }) }
  })
  const issue = codeVideoSpansIssue(spans)
  if (issue) throw new CodeMaterialError('PARAMETERS', `${label}.${issue}`)
  checkedSpans.set(value, spans)
  return spans
}
/** A reference is data only; filenames, getters, prototypes and extra capabilities never cross this boundary. */
export function codeImageReference(value: unknown, label: string): CodeImageReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new CodeMaterialError('PARAMETERS', `${label}必须是明确的剪辑图片引用。`)
  const fields = plainFields(value)
  if (!fields || Object.keys(fields).some(key => !['kind', 'mediaId', 'time', 'spans'].includes(key)) || !['image', 'video', 'sequence'].includes(fields.kind?.value) || typeof fields.mediaId?.value !== 'string' || fields.mediaId.value.length < 1 || fields.mediaId.value.length > 100 || fields.kind.value === 'sequence' && (fields.mediaId.value !== 'below' || fields.time || fields.spans)) throw new CodeMaterialError('PARAMETERS', `${label}需要图片/视频 mediaId 或 {kind:'sequence',mediaId:'below'}。`)
  const time = fields.time?.value
  if (fields.time && (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || fields.kind.value !== 'video')) throw new CodeMaterialError('PARAMETERS', `${label}.time 仅支持视频的非负秒数。`)
  if (fields.spans && fields.kind.value !== 'video') throw new CodeMaterialError('PARAMETERS', `${label}.spans 仅支持视频。`)
  if (fields.spans && fields.time) throw new CodeMaterialError('PARAMETERS', `${label}的 time 与 spans 不能同时给出。`)
  const spans = fields.spans ? codeVideoSpans(fields.spans.value, label) : undefined
  return { kind: fields.kind.value, mediaId: fields.mediaId.value, ...(time === undefined ? {} : { time }), ...(spans ? { spans } : {}) }
}
export function isCodeImageReference(value: unknown): value is CodeImageReference {
  try { codeImageReference(value, '图片'); return true } catch { return false }
}
export function codeAudioReference(value: unknown, label: string): import('../../imaging/parameterTypes').CodeAudioReference {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new CodeMaterialError('PARAMETERS', `${label}需要音频素材引用。`)
  const fields = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).length !== 2 || fields.kind?.value !== 'audio' || typeof fields.mediaId?.value !== 'string' || !fields.mediaId.value.length || fields.mediaId.value.length > 100) throw new CodeMaterialError('PARAMETERS', `${label}仅允许 kind:audio 和 mediaId。`)
  return { kind: 'audio', mediaId: fields.mediaId.value }
}
export function isCodeAudioReference(value: unknown): value is import('../../imaging/parameterTypes').CodeAudioReference {
  try { codeAudioReference(value, '音频'); return true } catch { return false }
}
/** 片子数据参数的值：只引用同一剪辑里的一份片子数据（scenes），记录本身不进参数。 */
export function codeSceneReference(value: unknown, label: string): import('../../imaging/parameterTypes').CodeSceneReference {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new CodeMaterialError('PARAMETERS', `${label}需要片子数据引用。`)
  const fields = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).length !== 2 || fields.kind?.value !== 'scene' || typeof fields.sceneId?.value !== 'string' || !fields.sceneId.value.length || fields.sceneId.value.length > 100) throw new CodeMaterialError('PARAMETERS', `${label}仅允许 kind:scene 和 sceneId。`)
  return { kind: 'scene', sceneId: fields.sceneId.value }
}
export function isCodeSceneReference(value: unknown): value is import('../../imaging/parameterTypes').CodeSceneReference {
  try { codeSceneReference(value, '片子数据'); return true } catch { return false }
}
export function isCodeColor(value: unknown): value is CodeColor {
  return Array.isArray(value) && value.length === 4 && value.every(channel => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1)
}
