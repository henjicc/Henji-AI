import type { TextStyle } from './vectorContent/text'
import type { CodeSceneSchema } from '../videoEdit/scene/sceneDeclaration'
export type CodeColor = [number, number, number, number]
/**
 * 视频参数取帧时间表的一段：片段时间 t（片段入点 + 片段内时间，秒）落在 [from, to) 时取 src + (t − from) × rate（缺省 1，0 为停住）；
 * cursor:false 时这一段不画录制鼠标与点击涟漪。
 */
export interface CodeVideoSpan { from: number; to: number; src: number; rate?: number; cursor?: boolean }
/**
 * 网页画面：本地网页文件夹（`path` 是文件夹或其中 index.html 的本机绝对路径）在隔离的离屏页面里排版绘制。
 * 视口 `width`×`height`（CSS 像素，默认 1920×1080），只渲染 `region`（[x, y, 宽, 高]，默认整个视口），每 CSS 像素
 * `scale` 个设备像素（默认 2）；取帧时刻 `time`/`spans` 与视频参数同义，是页面时间（交给 `henjiWeb.seek`）。
 * `boxes` 是每帧要读矩形的 CSS 选择器。语义与限制见 `codeMaterial/webSource.ts`。
 * `data-henji-stage` 标记视口大小、原点 (0,0) 的舞台；宿主搬入画布后不依赖父元素选择器或泛选 canvas，背景与动态内容（含弹层）留在舞台内，舞台外可见内容保持静止。
 */
export interface CodeWebReference { kind: 'web'; path: string; width?: number; height?: number; region?: [number, number, number, number]; scale?: number; time?: number; spans?: CodeVideoSpan[]; boxes?: string[]; mediaId?: never }
export type CodeImageReference = { kind: 'image'; mediaId: string; time?: never; spans?: never } | { kind: 'video'; mediaId: string; time?: number; spans?: CodeVideoSpan[] } | { kind: 'sequence'; mediaId: 'below'; time?: never; spans?: never } | CodeWebReference
export interface CodeAudioReference { kind: 'audio'; mediaId: string }
/** 片子数据参数的值：引用同一剪辑 scenes 里的一份（作者接口 v5 起）。 */
export interface CodeSceneReference { kind: 'scene'; sceneId: string }
export interface CodePoint { x: number; y: number }
export interface CodeGrade { hue: number; strength: number; luminance: number }
export interface CodeGradientStop { at: number; color: CodeColor }
export type CodeRange = [number, number]
export type CodeEasing = string | CodeColor
export type CodeBasicParameterValue = number | boolean | string | CodeColor | CodeRange | CodePoint | CodeGrade | CodeGradientStop[] | CodePoint[]
export type CodeParameterObject = Record<string, CodeBasicParameterValue>
export type CodeParameterTableRow = Record<string, CodeBasicParameterValue | TextStyle>
export type CodeParameterValue = CodeBasicParameterValue | CodeParameterObject | CodeParameterTableRow[] | TextStyle | CodeImageReference | CodeAudioReference | CodeSceneReference | null
export type CodeParameterValues = Record<string, CodeParameterValue>
export interface CodeParameterVisibility { param: string; equals?: number | boolean | string; notEquals?: number | boolean | string; in?: (number | boolean | string)[] }
interface ParameterBase { key: string; title: string; description: string; animatable: boolean; tooltip?: string; group?: string; layer?: string; advanced?: boolean; visibleWhen?: CodeParameterVisibility }
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
export type CodeTextStyleParameterDeclaration = ParameterBase & { type: 'textStyle'; default: TextStyle }
/** A closed IR tag keeps consumers exhaustive; typeName retains the author's open type name. */
export type CodeParameterDeclaration = CodeBasicParameterDeclaration | CodeTextStyleParameterDeclaration | (ParameterBase & (
  | { type: 'image'; default: null; animatable: false }
  | { type: 'audio'; default: null; animatable: false }
  | { type: 'scene'; default: null; animatable: false; schema: CodeSceneSchema }
  | { type: 'table'; default: CodeParameterTableRow[]; fields: Record<string, CodeBasicParameterDeclaration | CodeTextStyleParameterDeclaration>; rowKey?: string }
  | { type: 'custom'; typeName: string; default: CodeParameterObject; fields: Record<string, CodeBasicParameterDeclaration> }
))
