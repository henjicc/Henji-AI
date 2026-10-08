export type CodeColor = [number, number, number, number]
export interface CodeImageReference { kind: 'image'; mediaId: string }
export interface CodePoint { x: number; y: number }
export interface CodeGrade { hue: number; strength: number; luminance: number }
export interface CodeGradientStop { at: number; color: CodeColor }
export type CodeRange = [number, number]
export type CodeEasing = string | CodeColor
export type CodeBasicParameterValue = number | boolean | string | CodeColor | CodeRange | CodePoint | CodeGrade | CodeGradientStop[] | CodePoint[]
export type CodeParameterObject = Record<string, CodeBasicParameterValue>
export type CodeParameterValue = CodeBasicParameterValue | CodeParameterObject | CodeImageReference | null
export type CodeParameterValues = Record<string, CodeParameterValue>
export interface CodeParameterVisibility { param: string; equals?: number | boolean | string; notEquals?: number | boolean | string; in?: (number | boolean | string)[] }
interface ParameterBase { key: string; title: string; description: string; animatable: boolean; tooltip?: string; group?: string; advanced?: boolean; visibleWhen?: CodeParameterVisibility }
export type CodeBasicParameterDeclaration = ParameterBase & (
  | { type: 'number'; default: number; min: number; max: number; step: number; unit: string; control?: 'slider' | 'knob' | 'input' }
  | { type: 'angle'; default: number; min: number; max: number }
  | { type: 'point'; default: CodePoint; space: 'frame' | 'pixels'; min: CodePoint; max: CodePoint }
  | { type: 'range'; default: CodeRange; min: number; max: number; step: number; unit: string }
  | { type: 'color'; default: CodeColor; alpha?: boolean }
  | { type: 'gradient'; default: CodeGradientStop[]; maxStops: number }
  | { type: 'curve'; default: CodePoint[]; kind: 'tone' | 'hue' }
  | { type: 'grade'; default: CodeGrade }
  | { type: 'boolean'; default: boolean }
  | { type: 'choice'; default: string; options: string[]; optionLabels?: Record<string, string>; control?: 'dropdown' | 'segmented' }
  | { type: 'text'; default: string; maxLength: number; multiline?: boolean }
  | { type: 'font'; default: string }
  | { type: 'easing'; default: CodeEasing }
  | { type: 'seed'; default: number }
)
export interface CodeParameterTypeDefinition { title: string; layout: 'stack' | 'row' | 'grid' | 'wheel'; fields: Record<string, CodeBasicParameterDeclaration> }
/** A closed IR tag keeps consumers exhaustive; typeName retains the author's open type name. */
export type CodeParameterDeclaration = CodeBasicParameterDeclaration | (ParameterBase & (
  | { type: 'image'; default: null; animatable: false }
  | { type: 'custom'; typeName: string; default: CodeParameterObject; fields: Record<string, CodeBasicParameterDeclaration> }
))
