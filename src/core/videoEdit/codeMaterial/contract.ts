/** Closed author languages v1/v2. These data structures contain no executable host values. */
export const CODE_MATERIAL_LIMITS = Object.freeze({ sourceBytes: 65536, astNodes: 8192, depth: 64, cpuOperations: 20000, draws: 256, parameters: 32, filterScalarOperations: 128, filterSamples: 4, stringLength: 4096, textCharacters: 8192 })
export type CodeColor = [number, number, number, number]
export interface CodeImageReference { kind: 'image'; mediaId: string }
export type CodeParameterValue = number | boolean | string | CodeColor | CodeImageReference | null
export type CodeParameterValues = Record<string, CodeParameterValue>
interface ParameterBase { key: string; title: string; description: string; animatable: boolean }
export type CodeParameterDeclaration = ParameterBase & (
  | { type: 'number'; default: number; min: number; max: number; step: number; unit: string }
  | { type: 'color'; default: CodeColor }
  | { type: 'boolean'; default: boolean }
  | { type: 'choice'; default: string; options: string[] }
  | { type: 'text'; default: string; maxLength: number }
  | { type: 'image'; default: null; animatable: false }
)
export type CodeValueType = 'number' | 'boolean' | 'string' | 'color' | 'image' | 'draw' | 'draws'
export type CodeContextKey = 'time' | 'localTime' | 'sequenceTime' | 'width' | 'height' | 'frame' | 'fps' | 'u' | 'v'
export interface CodeMaterialContext { time: number; localTime: number; sequenceTime: number; width: number; height: number; frame: number; fps: number; seed?: number }
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
export type CodeDrawKind = 'rect' | 'ellipse' | 'line' | 'text' | 'image'
export type CodeExpression = { type: CodeValueType } & (
  | { kind: 'literal'; value: number | boolean | string }
  | { kind: 'color'; values: CodeExpression[] }
  | { kind: 'context'; key: CodeContextKey }
  | { kind: 'parameter'; key: string }
  | { kind: 'binding'; slot: number }
  | { kind: 'component'; value: CodeExpression; index: 0 | 1 | 2 | 3 }
  | { kind: 'unary'; op: '+' | '-' | '!'; value: CodeExpression }
  | { kind: 'binary'; op: CodeBinaryOperator; left: CodeExpression; right: CodeExpression }
  | { kind: 'conditional'; condition: CodeExpression; yes: CodeExpression; no: CodeExpression }
  | { kind: 'call'; op: CodeBuiltin; args: CodeExpression[] }
  | { kind: 'draw'; shape: CodeDrawKind; properties: Record<string, CodeExpression> }
  | { kind: 'draws'; values: CodeExpression[] }
)
export interface CodeMaterialProgram {
  apiVersion: 1; languageVersion: 1 | 2; name: string; kind: 'generator' | 'filter'; mode: 'static' | 'dynamic'
  width: number; height: number; durationSeconds: number; seed: number
  parameters: CodeParameterDeclaration[]; bindings: { name: string; expression: CodeExpression }[]; result: CodeExpression
  metrics: { astNodes: number; astDepth: number; cpuOperations: number; scalarOperations: number; samples: number }
}
export type CodeDrawCommand =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: CodeColor; radius: number }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number; fill: CodeColor }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: CodeColor }
  | { kind: 'text'; x: number; y: number; text: string; fontSize: number; color: CodeColor; fontFamily: 'sans-serif' | 'serif' | 'monospace'; align: 'left' | 'center' | 'right' }
  | { kind: 'image'; source: CodeImageReference; x: number; y: number; width: number; height: number; opacity: number }
export type CodeMaterialErrorCode = 'SOURCE_LIMIT' | 'SYNTAX' | 'TYPE' | 'BUDGET' | 'PARAMETERS' | 'COMPATIBILITY' | 'CONTEXT' | 'NON_FINITE'
export class CodeMaterialError extends Error {
  constructor(readonly code: CodeMaterialErrorCode, message: string) { super(message); this.name = 'CodeMaterialError' }
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
  if (typeof value !== 'object' || value === null || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new CodeMaterialError('PARAMETERS', `${label}必须是明确的工程图片引用。`)
  const fields = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(fields).length !== 2 || !fields.kind || !fields.mediaId || !('value' in fields.kind) || !('value' in fields.mediaId) || fields.kind.value !== 'image' || typeof fields.mediaId.value !== 'string' || fields.mediaId.value.length < 1 || fields.mediaId.value.length > 100) throw new CodeMaterialError('PARAMETERS', `${label}仅允许 kind:image 和有效 mediaId。`)
  return { kind: 'image', mediaId: fields.mediaId.value }
}
