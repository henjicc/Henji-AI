import { parameterVisibilityText } from '../imaging/parameterVisibility'
import { VIDEO_EDIT_COLOR_GRADE } from './colorGrade'
import * as effectIndex from './effectIndex'
import { registerEffects } from './effectRegistration'
import { orderVideoEditEffects } from './effectCatalog'
import { type LayerEffectReference } from './layerEffectGeometry'
/**
 * 内置效果（实施方案第六节、任务 4.7）：每个效果登记一次，效果面板、效果控件与助手都读这里。
 * - 参数用“意图量纲”：0–100 的强度、角度（度）、曝光档、颜色、选项与开关；每项写清范围、默认值、单位和一份说明
 *   （`description`，人和助手读同一句，如“40（默认）背景虚化”）。范围分硬范围 min/max 与滑块用的 softMin/softMax。
 * - 空间量（模糊半径、马赛克块大小、颗粒大小、偏移）一律相对画面高度，渲染尺寸变化（预览缩放、回放分辨率）效果看起来一样。
 * - 实现只有一份：剪辑合成器里的 GPU 着色器（`features/videoEdit/engine/videoEditBuiltinEffect*`），预览与导出同一路径，结果确定。
 * 存入片段效果链 `clip.effects` 时只记 `{ id, params }`；缺的参数按默认值，旧文件没有这个字段不受影响。
 */
import { parseColorGradeCurve } from './colorGradeCurves'
import { imagingParamsForSpace, type ImagingParamSpace } from '../imaging/parameterDefinition'

export type { ImagingParamValue as VideoEditBuiltinParamValue, ImagingParams as VideoEditBuiltinParams, ImagingUnit as VideoEditBuiltinUnit, ImagingParam as VideoEditBuiltinParam } from '../imaging/parameterDefinition'
import { IMAGING_UNIT_LABELS, type ImagingParamValue as VideoEditBuiltinParamValue, type ImagingParam as VideoEditBuiltinParam, type ImagingParams as VideoEditBuiltinParams, type ImagingUnit as VideoEditBuiltinUnit } from '../imaging/parameterDefinition'
export type VideoEditBuiltinGroup = 'light' | 'outline' | 'lens' | 'texture' | 'distort' | 'recording' | 'art' | 'glass_material' | 'rare_distort_light' | 'other' | 'blur' | 'color' | 'stylize' | 'frame' | 'keying' | 'audio_level' | 'audio_dynamics' | 'audio_delay' | 'audio_eq' | 'audio_modulation' | 'audio_repair' | 'audio_space' | 'audio_special' | 'audio_pitch' | 'shader_texture' | 'shader_shape' | 'shader_material' | 'shader_blur' | 'shader_distort' | 'shader_adjust' | 'shader_stylize'
export const VIDEO_EDIT_BUILTIN_GROUP_NAMES: Record<VideoEditBuiltinGroup, string> = { blur: '模糊与锐化', color: '颜色', light: '光', outline: '轮廓与阴影', lens: '镜头', texture: '质感', stylize: '风格化', distort: '变形', frame: '画面', keying: '抠像', recording: '录屏', audio_level: '振幅与声道', audio_dynamics: '动态', audio_delay: '延迟', audio_eq: '均衡与滤波', audio_modulation: '调制', audio_repair: '修复', audio_space: '空间', audio_special: '特殊', audio_pitch: '时间与变调', art: '艺术画风', glass_material: '玻璃与材质', rare_distort_light: '少用变形与光', other: '其他', shader_texture: '纹理与背景', shader_shape: '图形', shader_material: '材质', shader_blur: '着色器模糊', shader_distort: '扭曲变形', shader_adjust: '着色器调色', shader_stylize: '着色器风格化' }
/** 内置效果作用于画面还是声音：画面效果只加到画面片段，音频效果只加到声音片段。 */
export type VideoEditBuiltinMedia = 'video' | 'audio'
export interface VideoEditEffectPrecisionPlan { readonly passes: readonly { readonly entry: string }[] }
export interface VideoEditBuiltinEffectDefinition {
  /** 缺省为空间取样；逐点效果供执行器合并，生成器进入“生成”文件夹。 */
  stage?: 'point' | 'spatial' | 'generator'
  /** 只看当前参数与规划；没有声明时不要求高精度。 */
  precision?: (params: VideoEditBuiltinParams, plan: VideoEditEffectPrecisionPlan) => boolean
  category?: 'more'
  /** layer 可用于作者图层及片段；不写只用于片段。 */
  space?: 'layer' | 'frame' | 'clip'
  /**
   * 规划随效果时钟变化的效果必须声明：返回这一帧规划真正依赖的值（整帧序号、段号或带小数的帧位置；画面不变时返回常量）。
   * 帧时长相同且返回值相同的帧必须得到相同的规划。输出复用键与指纹并入返回值而不是帧号（帧时长由各自的键另行覆盖），
   * 同一段错法、强度为 0 等画面不变的帧照样复用。
   */
  frameSeed?: (params: VideoEditBuiltinParams, frame: number) => number
  /**
   * 按自动识别的人物轮廓工作（只用于片段）：宿主分析片段素材里的人物，把这一帧的人物蒙版作为工序纹理 `subject` 交给规划；
   * 还没分析好时这一帧先不画这个效果，导出前等分析完成。
   */
  subjectMatte?: (params: VideoEditBuiltinParams) => boolean
  /** `prior`：前面效果已经外扩的量（逻辑像素），`reference` 的内容框已含这一圈；按真实几何算外扩的效果（透视、镜面中心）用它还原内容框。 */
  bleed?: (params: VideoEditBuiltinParams, reference: LayerEffectReference, prior?: number) => number
  author?: { factory: string }
  id: string
  name: string
  /** 效果面板搜索用的别名：并入它的旧效果名、常见英文名。 */
  aliases?: readonly string[]
  group: VideoEditBuiltinGroup
  /** 缺省为画面效果；音频效果写 `audio`（登记在 `audioEffectDefinitions.ts`）。 */
  media?: VideoEditBuiltinMedia
  /** 只在尚未改写成一份说明的效果上另给效果面板一句短话；不写时面板与助手都读 `description`。 */
  tooltip?: string
  /** 一份说明，人和助手都读：做什么、什么时候用，必要时一句注意事项。 */
  description: string
  params: readonly VideoEditBuiltinParam[]
  /** Thumbnail recipe, rendered by the trusted library on the existing host device. */
  cover?: { kind: 'render'; timeSeconds: number }
}
export const VIDEO_EDIT_BUILTIN_UNIT_LABELS: Record<VideoEditBuiltinUnit, string> = IMAGING_UNIT_LABELS

export { videoEditStrengthParam, videoEditPercentParam } from './effectParams'

/** 全部消费者共用显式目录的顺序，索引只负责登记。 */
export const VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS = orderVideoEditEffects(registerEffects<VideoEditBuiltinEffectDefinition>(effectIndex))

const definitions = new Map(VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(definition => [definition.id, definition]))
export function videoEditBuiltinEffect(id: string): VideoEditBuiltinEffectDefinition | undefined { return definitions.get(id) }
export function requireVideoEditBuiltinEffect(id: string): VideoEditBuiltinEffectDefinition {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`没有内置效果“${id}”，可用：${[...definitions.keys()].join('、')}。`)
  return definition
}
/** 效果登记表与助手用的稳定 ID：`effect:<内置效果 ID>`。 */
export const VIDEO_EDIT_BUILTIN_REF_PREFIX = 'effect:'
/** 内置效果作用于画面还是声音；不认识的效果按画面效果。 */
export function videoEditBuiltinEffectMedia(id: string): VideoEditBuiltinMedia { return definitions.get(id)?.media ?? 'video' }
export function videoEditBuiltinRefId(id: string): string { return `${VIDEO_EDIT_BUILTIN_REF_PREFIX}${id}` }
/** `effect:blur` 或 `blur` → 内置效果 ID；不是内置效果时返回 undefined。 */
export function parseVideoEditBuiltinRefId(value: string): string | undefined {
  const id = value.startsWith(VIDEO_EDIT_BUILTIN_REF_PREFIX) ? value.slice(VIDEO_EDIT_BUILTIN_REF_PREFIX.length) : value
  return definitions.has(id) ? id : undefined
}
export function videoEditBuiltinDefaults(definition: VideoEditBuiltinEffectDefinition): VideoEditBuiltinParams {
  return Object.fromEntries(definition.params.map(param => [param.key, param.default]))
}
const COLOR = /^#[0-9a-f]{6}$/
const COLOR_ALPHA = /^#[0-9a-f]{6}([0-9a-f]{2})?$/
function range(param: Extract<VideoEditBuiltinParam, { type: 'number' }>): string { return `${param.min}–${param.max}${VIDEO_EDIT_BUILTIN_UNIT_LABELS[param.unit]}` }
/** 单个参数：`clamp` 时数值夹进范围（界面拖动、步进），否则超出范围直接报错（文档校验、助手写入，不静默改值）。 */
export function videoEditBuiltinParamValue(param: VideoEditBuiltinParam, raw: unknown, clamp = false): VideoEditBuiltinParamValue {
  switch (param.type) {
    case 'curve': {
      const points = parseColorGradeCurve(raw)
      if (param.key.startsWith('curve_hue_') && points.length && (points[0].x !== 0 || points[points.length - 1].x !== 100 || points[0].y !== points[points.length - 1].y)) throw new Error('色相曲线必须覆盖0–100且两端输出相同，保证红色色相连续。')
      return raw as string
    }
    case 'lut':
      if (typeof raw !== 'string' || raw.length > 100 || (raw && !/^[A-Za-z0-9_-]+$/.test(raw))) throw new Error('LUT 需要项目中已导入的 LUT 引用，空字符串移除。')
      return raw
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`“${param.name}”（${param.key}）需要数字，范围 ${range(param)}。`)
      if (clamp) return Math.min(param.max, Math.max(param.min, raw))
      if (raw < param.min || raw > param.max) throw new Error(`“${param.name}”（${param.key}）超出范围 ${range(param)}。`)
      return raw
    }
    case 'boolean':
      if (typeof raw !== 'boolean') throw new Error(`“${param.name}”（${param.key}）需要 true 或 false。`)
      return raw
    case 'enum':
      if (typeof raw !== 'string' || !param.options.some(option => option.value === raw)) throw new Error(`“${param.name}”（${param.key}）可选：${param.options.map(option => option.value).join('、')}。`)
      return raw
    case 'color': {
      const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
      if (!(param.alpha ? COLOR_ALPHA : COLOR).test(value)) throw new Error(`“${param.name}”（${param.key}）需要 ${param.alpha ? '#rrggbb 或带透明度的 #rrggbbaa' : '#rrggbb'} 颜色。`)
      return value
    }
  }
}
/**
 * 合并并校验参数：`base` 是现有值（缺省为默认值），`changes` 只覆盖给出的键。未知参数直接报错并列出可用参数。
 * 返回完整参数表（每个参数都有值）。
 */
export function normalizeVideoEditBuiltinParams(id: string, changes: Readonly<Record<string, unknown>> = {}, base?: Readonly<Record<string, unknown>>, clamp = false, space: ImagingParamSpace = 'clip'): VideoEditBuiltinParams {
  const definition = requireVideoEditBuiltinEffect(id)
  for (const key of new Set([...Object.keys(changes), ...Object.keys(base ?? {})])) {
    const issue = videoEditBuiltinParamSpaceIssue(definition.params.find(param => param.key === key), space)
    if (issue) throw new Error(`${definition.name}.${key}：${issue}`)
  }
  const values = normalizeVideoEditParamSet(`内置效果“${definition.name}”`, imagingParamsForSpace(definition.params, space), changes, base, clamp)
  if (id === VIDEO_EDIT_COLOR_GRADE.id) for (const channel of ['saturation', 'luminance']) {
    if (Number(values[`hsl_${channel}_start`]) > Number(values[`hsl_${channel}_end`])) throw new Error(`hsl_${channel}_start 不得大于 hsl_${channel}_end；只有色相允许跨0°回绕。`)
  }
  return values
}
/** 显式参数与曲线/旋钮目标共用同一空间约束；动态值也不能跨空间使用。 */
export function videoEditBuiltinParamSpaceIssue(param: VideoEditBuiltinParam | undefined, space: ImagingParamSpace): string | undefined {
  if (!param?.spaces || param.spaces.includes(space)) return undefined
  const names = { clip: '片段', layer: '图层', frame: '整帧' }
  return `参数只能用于${param.spaces.map(value => names[value]).join('、')}效果。`
}
/** 按一组参数登记合并并校验（内置效果与过渡共用）；`owner` 只用于报错文字。 */
export function normalizeVideoEditParamSet(owner: string, params: readonly VideoEditBuiltinParam[], changes: Readonly<Record<string, unknown>> = {}, base?: Readonly<Record<string, unknown>>, clamp = false): VideoEditBuiltinParams {
  const unknown = Object.keys(changes).filter(key => !params.some(param => param.key === key))
  if (unknown.length) throw new Error(`${owner}没有参数 ${unknown.join('、')}；${params.length ? `可用参数：${params.map(param => param.key).join('、')}` : '它没有可调参数'}。`)
  return Object.fromEntries(params.map(param => {
    const raw = param.key in changes ? changes[param.key] : base && param.key in base ? base[param.key] : param.default
    return [param.key, videoEditBuiltinParamValue(param, raw, clamp && param.key in changes)]
  }))
}
/** 给助手的参数说明（内置效果与过渡共用）。 */
export function describeVideoEditParams(params: readonly VideoEditBuiltinParam[]): Array<Record<string, string | number | boolean | string[]>> {
  return params.map(param => ({
    key: param.key, name: param.name, type: param.type, default: param.default, description: param.description,
    ...(param.animatable !== undefined ? { animatable: param.animatable } : {}),
    ...(param.group ? { group: param.group } : {}),
    ...(param.spaces ? { spaces: [...param.spaces] } : {}),
    ...(param.visibleWhen ? { visibleWhen: `${parameterVisibilityText(param.visibleWhen)} 时才起作用` } : {}),
    ...(param.type === 'number' ? { min: param.min, max: param.max, unit: param.unit, ...(param.softMin !== undefined ? { softMin: param.softMin } : {}), ...(param.softMax !== undefined ? { softMax: param.softMax } : {}) } : {}),
    ...(param.type === 'enum' ? { options: param.options.map(option => option.value) } : {}),
  }))
}
/**
 * 只校验给出的键、不补默认值（助手整体写入 parameters 时用：写什么存什么，读回与写入一致；缺的键渲染时按默认值）。
 */
export function validateVideoEditBuiltinParams(id: string, params: Readonly<Record<string, unknown>>): VideoEditBuiltinParams {
  const full = normalizeVideoEditBuiltinParams(id, params)
  return Object.fromEntries(Object.keys(params).map(key => [key, full[key]]))
}
/**
 * 已移除的内置效果：登记里已没有这个 ID（并进了别的效果或删除了）。工程、预设库、风格包与模板里原样保留，
 * 渲染与混音跳过，效果控件里显示“已移除”并可删除；新建与写入参数仍会拒绝它。
 */
export function isRemovedVideoEditBuiltinEffect(id: string): boolean { return !definitions.has(id) }
/**
 * 存档里的一项内置效果读不读得进来。效果改版后旧存档要能打开：已移除的效果、超出当前范围的数值（使用时按范围钳制）、
 * 已不存在的参数都照样读入、原样保留；只有类型不对（数字写成文字、选项不存在、颜色格式错）才算内容损坏。
 * 新建与写入参数走 `normalizeVideoEditBuiltinParams` / `validateVideoEditBuiltinParams`，仍按硬范围严格报错。
 */
export function videoEditBuiltinEffectIssue(instance: { id: string; params: Readonly<Record<string, unknown>> }): string | undefined {
  const definition = definitions.get(instance.id)
  if (!definition) return undefined
  const known = Object.fromEntries(Object.entries(instance.params).filter(([key]) => definition.params.some(param => param.key === key)))
  try { normalizeVideoEditBuiltinParams(instance.id, known, undefined, true); return undefined } catch (error) { return error instanceof Error ? error.message : '内置效果参数无效。' }
}
/** 存档里与当前登记对不上、读取时容忍了的地方（打开工程时记一次日志）：已移除的效果，或按范围钳制的参数键。 */
export function storedVideoEditBuiltinEffectNotes(instance: { id: string; params: Readonly<Record<string, unknown>> }): { removed: boolean; clamped: string[] } {
  const definition = definitions.get(instance.id)
  if (!definition) return { removed: true, clamped: [] }
  return { removed: false, clamped: definition.params.filter(param => param.type === 'number' && typeof instance.params[param.key] === 'number' && (instance.params[param.key] as number < param.min || instance.params[param.key] as number > param.max)).map(param => param.key) }
}
/** 读取时补齐默认值，超出范围的旧数值按当前范围钳制（不报错，渲染用）；已移除的效果抛错，调用方先用 `isRemovedVideoEditBuiltinEffect` 跳过。 */
export function resolveVideoEditBuiltinParams(instance: { id: string; params: Readonly<Record<string, unknown>> }): VideoEditBuiltinParams {
  const definition = requireVideoEditBuiltinEffect(instance.id)
  return Object.fromEntries(definition.params.map(param => {
    const value = (instance.params[param.key] ?? param.default) as VideoEditBuiltinParamValue
    return [param.key, param.type === 'number' && typeof value === 'number' ? Math.min(param.max, Math.max(param.min, value)) : value]
  }))
}
/** 这一帧要不要片段素材的人物蒙版（参数已按这一帧求值）；已移除的效果不要。渲染准备与合成用它。 */
export function videoEditEffectUsesSubject(instance: { id: string; params: Readonly<Record<string, unknown>> } | undefined): boolean {
  const definition = instance && definitions.get(instance.id)
  return Boolean(instance && definition?.subjectMatte?.(resolveVideoEditBuiltinParams(instance)))
}
/**
 * 片段上任一帧会不会用到人物蒙版：静态参数，或某个关键帧的取值（如发光按关键帧切到轮廓方式）。
 * 分析请求、导出等待、状态与“只能用于视频图片片段”的校验用它，按帧跳过的效果不会漏掉分析。
 */
export function videoEditEffectNeedsSubject(instance: { id: string; params: Readonly<Record<string, unknown>>; curves?: Readonly<Record<string, readonly { value: unknown }[]>> } | undefined): boolean {
  const subjectMatte = instance && definitions.get(instance.id)?.subjectMatte
  if (!instance || !subjectMatte) return false
  const params = resolveVideoEditBuiltinParams(instance)
  return subjectMatte(params) || Object.entries(instance.curves ?? {}).some(([key, points]) => points.some(point => subjectMatte({ ...params, [key]: point.value as VideoEditBuiltinParamValue })))
}
export function isVideoEditBuiltinParamDefault(param: VideoEditBuiltinParam, value: unknown): boolean { return value === undefined || value === param.default }
/** 给助手的结构化目录：每个效果的作用与参数语义（范围、默认值、单位、取值含义）。 */
export function describeVideoEditBuiltinEffect(definition: VideoEditBuiltinEffectDefinition): Record<string, string | Array<Record<string, string | number | boolean | string[]>>> {
  return {
    id: videoEditBuiltinRefId(definition.id), name: definition.name, group: VIDEO_EDIT_BUILTIN_GROUP_NAMES[definition.group],
    // 适用片段写在说明开头：音频效果只能加到声音片段（kind 为 audio），画面效果只能加到画面片段。
    description: `${definition.media === 'audio' ? '音频效果，只能加到声音片段（kind 为 audio）。' : '画面效果，只能加到画面片段（声音片段除外）。'}${definition.description}`,
    params: describeVideoEditParams(definition.params),
  }
}
