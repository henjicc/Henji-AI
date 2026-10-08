import type { StyleTokens } from '../styleKit'
import type { ShaderGraphCustomShader, ShaderGraphSpec } from '../shaderGraph/spec'
/** Closed author languages. These data structures contain no executable host values. */
export const CODE_MATERIAL_LIMITS = Object.freeze({ sourceBytes: 65536, astNodes: 8192, depth: 64, cpuOperations: 20000, draws: 256, parameters: 32, filterScalarOperations: 128, filterSamples: 4, stringLength: 4096, textCharacters: 8192 })
/** Work ceilings for the explicit v3 language; resident pixels remain separately budgeted by the GPU host. */
export const CODE_V3_LIMITS = Object.freeze({ astNodes: 16384, depth: 64, cpuOperations: 200000, draws: 4096, shaderLayers: 32, shaderFilterPasses: 8, repeatDepth: 4, filterScalarOperations: 4096, filterSamples: 64, pathPoints: 4096, gradientStops: 8, textCharacters: 8192 })
export type { CodeColor, CodeImageReference, CodePoint, CodeGrade, CodeGradientStop, CodeRange, CodeEasing, CodeBasicParameterValue, CodeParameterObject, CodeParameterValue, CodeParameterValues, CodeParameterVisibility, CodeBasicParameterDeclaration, CodeParameterTypeDefinition, CodeParameterDeclaration } from '../../imaging/parameterTypes'
import type { CodeColor, CodeImageReference, CodeParameterTypeDefinition, CodeParameterDeclaration } from '../../imaging/parameterTypes'
export const CODE_PARAMETER_TYPES = ['number', 'angle', 'point', 'range', 'color', 'gradient', 'curve', 'grade', 'choice', 'boolean', 'text', 'font', 'image', 'easing', 'seed'] as const
export type CodeValueType = 'number' | 'boolean' | 'string' | 'color' | 'image' | 'draw' | 'draws' | 'array' | 'object' | 'paint'
export type CodeContextKey = 'time' | 'localTime' | 'sequenceTime' | 'width' | 'height' | 'frame' | 'fps' | 'u' | 'v'
export interface CodeMaterialContext { time: number; localTime: number; sequenceTime: number; width: number; height: number; frame: number; fps: number; seed?: number; style?: StyleTokens }
export const CODE_CONTEXT_KEYS: readonly CodeContextKey[] = ['time', 'localTime', 'sequenceTime', 'width', 'height', 'frame', 'fps', 'u', 'v']
export const CODE_TIME_KEYS: readonly CodeContextKey[] = ['time', 'localTime', 'sequenceTime', 'frame', 'fps']
export const CODE_BUILTINS = ['sin', 'cos', 'abs', 'floor', 'ceil', 'round', 'min', 'max', 'clamp', 'mix', 'smoothstep', 'random', 'rgba', 'sample'] as const
export type CodeBuiltin = typeof CODE_BUILTINS[number]
/** Conservative work units, not elapsed time; transcendental calls are charged more CPU work. */
export function codeBuiltinCost(op: CodeBuiltin, type: CodeValueType): { cpu: number; scalar: number } {
  const channels = type === 'color' ? 4 : 1
  // sample's fixed GPU interpolation/unpremultiply work is governed separately by the sample cap.
  const scalar = channels * (op === 'random' ? 12 : op === 'mix' ? 3 : op === 'smoothstep' ? 11 : op === 'clamp' || op === 'round' ? 2 : ['rgba', 'sample'].includes(op) ? 0 : 1)
  return { scalar, cpu: op === 'sin' || op === 'cos' ? 16 : Math.max(1, scalar) }
}
export type CodeBinaryOperator = '+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=' | '===' | '!==' | '&&' | '||'
/** JS remainder lowers to divide, truncation, multiplication and subtraction on the GPU. */
export function codeBinaryCost(op: CodeBinaryOperator): number { return op === '%' ? 4 : 1 }
export function codeConditionalCost(type: CodeValueType): number { return type === 'color' ? 4 : 1 }
export type CodeDrawKind = 'rect' | 'ellipse' | 'line' | 'text' | 'image' | 'group' | 'path' | 'shader'
export interface CodeSourceSpan { file: string; start: number; end: number; startLine: number; startColumn: number; endLine: number; endColumn: number }
export type CodeBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add' | 'lighten' | 'darken'
export interface CodeGradient { kind: 'linearGradient' | 'radialGradient'; x1?: number; y1?: number; x2?: number; y2?: number; cx?: number; cy?: number; r?: number; stops: [number, CodeColor][] }
export type CodePaint = CodeColor | CodeGradient
export type CodeMatrix = [number, number, number, number, number, number]
export interface CodeTextLayout { width: number; height: number; lines: string[]; lineWidths?: number[]; baselineOffset?: number; fontSize: number; font: string; fontGeneration?: number; missingFont?: string; glyphs: { text: string; x: number; y: number; width: number }[] }
export interface CodeTextMeasureRequest { text: string; fontFamily: string; fontWeight: number; fontStyle: string; fontSize: number; letterSpacing: number; lineHeight: number; maxWidth: number; wrap: boolean; maxLines: number }
export type CodeTextMeasurer = (request: CodeTextMeasureRequest) => CodeTextLayout
export interface CodeDrawMetadata {
  /** Host-only evaluated correction; never accepted by the author language. */
  elementTransform?: CodeMatrix; authorAnchor?: boolean; authorElementId?: string
  elementId?: string; sourceSpan?: CodeSourceSpan; elementPath?: string[]
  opacity?: number; rotation?: number; scaleX?: number; scaleY?: number; anchorX?: number; anchorY?: number; blend?: CodeBlend
  paint?: CodePaint; stroke?: CodePaint; strokeWidth?: number; lineCap?: 'butt' | 'round' | 'square'; lineJoin?: 'miter' | 'round' | 'bevel'; dash?: number[]; trimStart?: number; trimEnd?: number
  shadow?: { x: number; y: number; blur: number; color: CodeColor }; glow?: { radius: number; intensity: number; color: CodeColor }; blur?: number
}
export type CodeExpression = { type: CodeValueType; sourceSpan?: CodeSourceSpan } & (
  | { kind: 'literal'; value: number | boolean | string }
  | { kind: 'color'; values: CodeExpression[] }
  | { kind: 'context'; key: CodeContextKey }
  | { kind: 'style'; path: string[] }
  | { kind: 'parameter'; key: string }
  | { kind: 'binding'; slot: number }
  | { kind: 'component'; value: CodeExpression; index: 0 | 1 | 2 | 3 }
  | { kind: 'unary'; op: '+' | '-' | '!'; value: CodeExpression }
  | { kind: 'binary'; op: CodeBinaryOperator; left: CodeExpression; right: CodeExpression }
  | { kind: 'conditional'; condition: CodeExpression; yes: CodeExpression; no: CodeExpression }
  | { kind: 'call'; op: CodeBuiltin; args: CodeExpression[] }
  | { kind: 'draw'; shape: CodeDrawKind; properties: Record<string, CodeExpression>; sourceSpan?: CodeSourceSpan; children?: CodeExpression }
  | { kind: 'draws'; values: CodeExpression[] }
  | { kind: 'array'; values: CodeExpression[] }
  | { kind: 'object'; properties: Record<string, CodeExpression> }
  | { kind: 'index'; value: CodeExpression; index: CodeExpression }
  | { kind: 'field'; value: CodeExpression; key: string }
  | { kind: 'local'; slot: number }
  | { kind: 'repeat'; count: CodeExpression; max: number; slot: number; body: CodeExpression }
  | { kind: 'v3call'; op: string; args: CodeExpression[]; sourceSpan?: CodeSourceSpan }
  | { kind: 'textAnimation'; slot: number; countSlot: number; body: CodeExpression }
)
export interface CodeMaterialProgram {
  sourceSpan?: CodeSourceSpan
  apiVersion: 1; languageVersion: 1 | 2 | 3; name: string; kind: 'generator' | 'filter'; mode: 'static' | 'dynamic'
  width: number; height: number; durationSeconds: number; seed: number
  parameters: CodeParameterDeclaration[]; bindings: { name: string; expression: CodeExpression }[]; result: CodeExpression
  types?: Record<string, CodeParameterTypeDefinition>
  /** v3：素材里自己写的着色器（WGSL 函数体），供 shader / shaderFilter 按名字使用。 */
  shaders?: ShaderGraphCustomShader[]
  metrics: { astNodes: number; astDepth: number; cpuOperations: number; scalarOperations: number; samples: number; draws?: number }
}
export type CodeDrawCommand = CodeDrawMetadata & (
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: CodeColor; radius: number; radii?: number[] }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number; fill: CodeColor }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: CodeColor }
  | { kind: 'text'; x: number; y: number; text: string; fontSize: number; color: CodeColor; fontFamily: string; align: 'left' | 'center' | 'right'; fontWeight?: number; fontStyle?: string; baseline?: string; letterSpacing?: number; lineHeight?: number; maxWidth?: number; wrap?: boolean; maxLines?: number; layout?: CodeTextLayout; perChar?: { x: number; y: number; opacity: number; scale: number; rotation: number }[] }
  | { kind: 'image'; source: CodeImageReference; x: number; y: number; width: number; height: number; opacity: number }
  | { kind: 'group'; x: number; y: number; children: CodeDrawCommand[]; clip?: { x: number; y: number; width: number; height: number } }
  | { kind: 'path'; points: [number, number][][]; closed: boolean; fill: CodeColor }
  | { kind: 'shader'; graph: ShaderGraphSpec; time: number; x: number; y: number; width: number; height: number }
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
export function codeColor(value: unknown, label: string): CodeColor {
  if (!Array.isArray(value) || value.length !== 4) throw new CodeMaterialError('PARAMETERS', `${label}必须是四通道 0 到 1 的 RGBA 颜色。`)
  const channels = [value[0], value[1], value[2], value[3]]
  if (channels.some(channel => typeof channel !== 'number' || !Number.isFinite(channel) || channel < 0 || channel > 1)) throw new CodeMaterialError('PARAMETERS', `${label}必须是四通道 0 到 1 的 RGBA 颜色。`)
  return channels as CodeColor
}
/** A reference is data only; filenames, getters, prototypes and extra capabilities never cross this boundary. */
export function codeImageReference(value: unknown, label: string): CodeImageReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new CodeMaterialError('PARAMETERS', `${label}必须是明确的剪辑图片引用。`)
  const fields = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(fields).length !== 2 || !fields.kind || !fields.mediaId || !('value' in fields.kind) || !('value' in fields.mediaId) || fields.kind.value !== 'image' || typeof fields.mediaId.value !== 'string' || fields.mediaId.value.length < 1 || fields.mediaId.value.length > 100) throw new CodeMaterialError('PARAMETERS', `${label}仅允许 kind:image 和有效 mediaId。`)
  return { kind: 'image', mediaId: fields.mediaId.value }
}
export function isCodeImageReference(value: unknown): value is CodeImageReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const fields = Object.getOwnPropertyDescriptors(value)
  return Object.keys(fields).length === 2 && fields.kind?.value === 'image' && typeof fields.mediaId?.value === 'string'
}
export function isCodeColor(value: unknown): value is CodeColor {
  return Array.isArray(value) && value.length === 4 && value.every(channel => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1)
}
