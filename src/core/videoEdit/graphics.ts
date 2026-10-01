import { z } from 'zod'
import { CodeMaterialError } from './codeMaterial/contract'
import type { CodeColor, CodeDrawCommand, CodeParameterDeclaration, CodeParameterValues } from './codeMaterial/contract'
import { codeMaterialCurvesSchema, evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from './codeMaterialAnimation'
import type { PreparedCodeMaterialParameters } from './codeMaterialAnimation'
import type { CodeMaterialMetadata } from './codeMaterialDocument'
import { codeMaterialInstanceSchema } from './codeMaterialPersistence'
import type { VideoEditSourceTime } from './time'

const dimensionsSchema = z.object({ width: z.number().finite().int().min(16).max(8192), height: z.number().finite().int().min(16).max(8192) }).strict()
const graphicObjectSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), kind: z.enum(['rect', 'ellipse', 'text']),
  parameters: codeMaterialInstanceSchema.shape.parameters, curves: codeMaterialCurvesSchema.optional(),
}).strict()
const graphicSchema = dimensionsSchema.extend({ objects: z.array(graphicObjectSchema).max(32) })
export type VideoEditGraphicObject = z.infer<typeof graphicObjectSchema>
export type VideoEditGraphic = z.infer<typeof graphicSchema>
export function orderVideoEditGraphicObjects(objects: VideoEditGraphicObject[], ids: string[]): VideoEditGraphicObject[] {
  if (ids.length !== objects.length || new Set(ids).size !== objects.length || ids.some(id => !objects.some(object => object.id === id))) throw new Error('请使用完整、无重复的图形对象顺序。')
  return ids.map(id => objects.find(object => object.id === id)!)
}
export interface VideoEditGraphicDraw { command: CodeDrawCommand; rotation: number; pivotX: number; pivotY: number }
export interface PreparedVideoEditGraphic {
  width: number; height: number
  objects: ReadonlyArray<Pick<VideoEditGraphicObject, 'id' | 'name' | 'kind'> & { parameters: PreparedCodeMaterialParameters }>
}

function number(key: string, title: string, value: number, min: number, max: number, unit = 'px', step = 1): CodeParameterDeclaration {
  return { key, title, description: '', animatable: true, type: 'number', default: value, min, max, unit, step }
}
function color(key: string, title: string): CodeParameterDeclaration {
  return { key, title, description: '', animatable: true, type: 'color', default: [1, 1, 1, 1] }
}

/** One declaration serves persistence validation, parameter controls and source-time curves. */
export function videoEditGraphicObjectMetadata(graphic: VideoEditGraphic, object: VideoEditGraphicObject): CodeMaterialMetadata {
  const width = graphic.width / 2; const height = graphic.height / 2
  const text = object.kind === 'text'
  const parameters: CodeParameterDeclaration[] = [
    number('x', text ? '水平锚点' : '水平位置', text ? graphic.width / 2 : (graphic.width - width) / 2, -16384, 16384),
    number('y', text ? '垂直锚点' : '垂直位置', text ? graphic.height / 2 : (graphic.height - height) / 2, -16384, 16384),
    number('rotation', '旋转', 0, -360, 360, '°'), number('opacity', '不透明度', 1, 0, 1, '', .01),
  ]
  if (text) {
    parameters.push(color('color', '文字颜色'),
      { key: 'text', title: '文字', description: '', animatable: true, type: 'text', default: '文字', maxLength: 2000 },
      number('fontSize', '字号', Math.min(128, Math.max(24, graphic.height / 12)), 1, 512),
      { key: 'fontFamily', title: '字体', description: '', animatable: true, type: 'choice', default: 'sans-serif', options: ['sans-serif', 'serif', 'monospace'] },
      { key: 'align', title: '对齐', description: '', animatable: true, type: 'choice', default: 'center', options: ['left', 'center', 'right'] })
  } else {
    parameters.push(number('width', '宽度', width, 0, 16384), number('height', '高度', height, 0, 16384), color('fill', '填充颜色'))
    if (object.kind === 'rect') parameters.push(number('radius', '圆角', 0, 0, 8192))
  }
  return { name: object.name, kind: 'generator', mode: 'static', width: graphic.width, height: graphic.height, durationSeconds: 1800, seed: 0, parameters }
}

export const videoEditGraphicSchema = graphicSchema.superRefine((graphic, context) => {
  const ids = new Set<string>(); let curveCount = 0; let pointCount = 0
  for (const [index, object] of graphic.objects.entries()) {
    if (ids.has(object.id)) context.addIssue({ code: 'custom', path: ['objects', index, 'id'], message: '图形对象标识不能重复。' })
    ids.add(object.id)
    const curves = Object.values(object.curves ?? {})
    curveCount += curves.length; pointCount += curves.reduce((count, points) => count + points.length, 0)
    try { prepareCodeMaterialParameters(videoEditGraphicObjectMetadata(graphic, object), object) }
    catch (error) {
      if (!(error instanceof CodeMaterialError) && !(error instanceof z.ZodError)) throw error
      context.addIssue({ code: 'custom', path: ['objects', index], message: error.message })
    }
  }
  if (curveCount > 32 || pointCount > 2048) context.addIssue({ code: 'custom', path: ['objects'], message: '整份图形最多32条曲线及2048个关键帧。' })
})

/** Prepare per immutable graphic; the caller owns caching and its bounded lifetime. */
export function prepareVideoEditGraphic(graphic: VideoEditGraphic): PreparedVideoEditGraphic {
  const checked = videoEditGraphicSchema.parse(graphic)
  return { width: checked.width, height: checked.height, objects: checked.objects.map(object => ({
    id: object.id, name: object.name, kind: object.kind, parameters: prepareCodeMaterialParameters(videoEditGraphicObjectMetadata(checked, object), object),
  })) }
}

function ink(value: CodeParameterValues, key: 'fill' | 'color'): CodeColor {
  const color = value[key] as CodeColor
  return [color[0], color[1], color[2], color[3] * (value.opacity as number)]
}
export function evaluateVideoEditGraphic(prepared: PreparedVideoEditGraphic, time: VideoEditSourceTime): VideoEditGraphicDraw[] {
  // Also validate the source clock for an empty graphic, through the same evaluator.
  if (!prepared.objects.length) { evaluateCodeMaterialParameters({ values: {}, curves: new Map() }, time); return [] }
  return prepared.objects.map(object => {
    const value = evaluateCodeMaterialParameters(object.parameters, time)
    const x = value.x as number; const y = value.y as number; const rotation = value.rotation as number
    if (object.kind === 'text') return { rotation, pivotX: x, pivotY: y, command: {
      kind: 'text', x, y, text: value.text as string, fontSize: value.fontSize as number, color: ink(value, 'color'),
      fontFamily: value.fontFamily as 'sans-serif' | 'serif' | 'monospace', align: value.align as 'left' | 'center' | 'right',
    } }
    const width = value.width as number; const height = value.height as number
    const geometry = { x, y, width, height, fill: ink(value, 'fill') }
    const command: CodeDrawCommand = object.kind === 'rect' ? { kind: 'rect', ...geometry, radius: value.radius as number } : { kind: 'ellipse', ...geometry }
    return { command, rotation, pivotX: x + width / 2, pivotY: y + height / 2 }
  })
}

export function createVideoEditGraphic(kind: 'solid' | 'rect' | 'ellipse' | 'text', width: number, height: number): VideoEditGraphic {
  const dimensions = dimensionsSchema.parse({ width, height })
  const object: VideoEditGraphicObject = { id: crypto.randomUUID(), name: { solid: '纯色', rect: '矩形', ellipse: '椭圆', text: '文字' }[kind], kind: kind === 'solid' ? 'rect' : kind, parameters: {} }
  const graphic: VideoEditGraphic = { ...dimensions, objects: [object] }
  object.parameters = prepareCodeMaterialParameters(videoEditGraphicObjectMetadata(graphic, object), object).values
  if (kind === 'solid') Object.assign(object.parameters, { x: 0, y: 0, width, height, fill: [0, 0, 0, 1] })
  return videoEditGraphicSchema.parse(graphic)
}
