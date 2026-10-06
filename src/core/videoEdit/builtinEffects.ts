/**
 * 内置效果（实施方案第六节、任务 4.7）：每个效果登记一次，效果面板、效果控件与助手都读这里。
 * - 参数用“意图量纲”：0–100 的强度、角度（度）、曝光档、颜色、选项与开关；每项写清范围、默认值、单位、
 *   给用户的悬停说明（`tooltip`）和给助手的语义说明（`description`，如“强度 30 ≈ 背景轻微虚化”）。
 * - 空间量（模糊半径、马赛克块大小、颗粒大小、偏移）一律相对画面高度，渲染尺寸变化（预览缩放、回放分辨率）效果看起来一样。
 * - 实现只有一份：剪辑合成器里的 GPU 着色器（`features/videoEdit/engine/videoEditBuiltinEffect*`），预览与导出同一路径，结果确定。
 * 存入片段效果链 `clip.effects` 时只记 `{ id, params }`；缺的参数按默认值，旧文件没有这个字段不受影响。
 */
import { VIDEO_EDIT_CHROMA_KEY_DEFAULT_HEX } from '../theme/colorTokens'
import { VIDEO_EDIT_AUDIO_EFFECT_DEFINITIONS } from './audioEffectDefinitions'

export type VideoEditBuiltinParamValue = number | boolean | string
export type VideoEditBuiltinParams = Record<string, VideoEditBuiltinParamValue>
/** 数值单位：strength 为 0–100 的无量纲强度，percent 为百分比，degrees 为角度，stops 为曝光档；音频效果另有 dB、Hz 与半音。 */
export type VideoEditBuiltinUnit = 'strength' | 'percent' | 'degrees' | 'stops' | 'decibels' | 'hertz' | 'semitones'
interface ParamBase { key: string; name: string; tooltip: string; description: string }
export type VideoEditBuiltinParam =
  | ParamBase & { type: 'number'; unit: VideoEditBuiltinUnit; min: number; max: number; step: number; default: number }
  | ParamBase & { type: 'color'; default: string }
  | ParamBase & { type: 'enum'; options: ReadonlyArray<{ value: string; label: string }>; default: string }
  | ParamBase & { type: 'boolean'; default: boolean }
export type VideoEditBuiltinGroup = 'blur' | 'color' | 'stylize' | 'frame' | 'keying' | 'audio_eq' | 'audio_dynamics' | 'audio_repair' | 'audio_space' | 'audio_level'
export const VIDEO_EDIT_BUILTIN_GROUP_NAMES: Record<VideoEditBuiltinGroup, string> = { blur: '模糊与锐化', color: '颜色', stylize: '风格化', frame: '画面', keying: '抠像', audio_eq: '均衡与滤波', audio_dynamics: '动态', audio_repair: '修复', audio_space: '空间与音调', audio_level: '音量与声道' }
/** 内置效果作用于画面还是声音：画面效果只加到画面片段，音频效果只加到声音片段。 */
export type VideoEditBuiltinMedia = 'video' | 'audio'
export interface VideoEditBuiltinEffectDefinition {
  id: string
  name: string
  group: VideoEditBuiltinGroup
  /** 缺省为画面效果；音频效果写 `audio`（登记在 `audioEffectDefinitions.ts`）。 */
  media?: VideoEditBuiltinMedia
  tooltip: string
  /** 给助手的语义说明：作用、适用场景、常用取值。 */
  description: string
  params: readonly VideoEditBuiltinParam[]
}
export const VIDEO_EDIT_BUILTIN_UNIT_LABELS: Record<VideoEditBuiltinUnit, string> = { strength: '', percent: '%', degrees: '°', stops: '档', decibels: 'dB', hertz: 'Hz', semitones: '半音' }

const strength = (key: string, name: string, fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit: 'strength', min: 0, max: 100, step: 1, default: fallback, tooltip, description })
const signed = (key: string, name: string, tooltip: string, description: string, fallback = 0): VideoEditBuiltinParam => ({ key, name, type: 'number', unit: 'strength', min: -100, max: 100, step: 1, default: fallback, tooltip, description })
const angle = (key: string, name: string, fallback: number, min: number, max: number, tooltip: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit: 'degrees', min, max, step: 1, default: fallback, tooltip, description })
const percent = (key: string, name: string, fallback: number, tooltip: string, description: string): VideoEditBuiltinParam => ({ key, name, type: 'number', unit: 'percent', min: 0, max: 100, step: 1, default: fallback, tooltip, description })
/** 参数构造（过渡参数登记复用，量纲与内置效果一致）。 */
export { strength as videoEditStrengthParam, percent as videoEditPercentParam }
const repeatEdges: VideoEditBuiltinParam = { key: 'repeat_edges', name: '重复边缘像素', type: 'boolean', default: true, tooltip: '开启时画面边缘不会变透明', description: 'true 时取画面外的颜色用最近的边缘像素（边缘不发虚、不透出下层）；false 时边缘向外渐隐成透明。' }

const VIDEO_EDIT_VIDEO_EFFECT_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = [
  { id: 'gaussian_blur', name: '高斯模糊', group: 'blur', tooltip: '均匀柔化整个画面，可只模糊水平或垂直方向', description: '均匀模糊画面，用于背景虚化、柔化、遮挡细节。模糊半径随画面高度缩放，任意分辨率观感一致。',
    params: [
      strength('strength', '模糊度', 30, '模糊程度，0 不模糊', '0 不模糊；10 ≈ 轻微柔化；30 ≈ 背景虚化；60 ≈ 强烈虚化只剩色块；100 ≈ 几乎看不出轮廓（半径约为画面高度的 6%）。'),
      { key: 'dimensions', name: '模糊方向', type: 'enum', default: 'both', options: [{ value: 'both', label: '水平和垂直' }, { value: 'horizontal', label: '水平' }, { value: 'vertical', label: '垂直' }], tooltip: '只沿一个方向模糊时画面会被拉出拖影', description: 'both 两个方向同时模糊；horizontal 只水平；vertical 只垂直。' },
      repeatEdges,
    ] },
  { id: 'directional_blur', name: '方向模糊', group: 'blur', tooltip: '沿一个方向拉出拖影，表现快速移动', description: '沿指定角度做线性拖影模糊，用于速度感、晃动感。',
    params: [
      angle('direction', '方向', 0, -180, 180, '拖影的方向，0° 为水平', '拖影方向角度：0 水平，90 垂直，45 斜向；正负 180 等价。'),
      strength('length', '模糊长度', 30, '拖影长度，0 没有拖影', '拖影长度：0 无；30 ≈ 画面高度的 3% 的轻微动感；100 ≈ 画面高度的 10% 的强烈拖影。'),
    ] },
  { id: 'zoom_blur', name: '缩放模糊', group: 'blur', tooltip: '从中心向外放射的模糊，表现冲刺或聚焦', description: '以中心点为原点向外放射的径向模糊，用于冲击感、转场前的冲刺感。',
    params: [
      strength('strength', '强度', 30, '放射模糊程度，0 不模糊', '0 无；20 ≈ 轻微冲刺感；50 ≈ 明显放射；100 ≈ 边缘几乎完全拉丝（约 20% 的缩放拖影）。'),
      percent('center_x', '中心水平位置', 50, '放射中心在画面中的水平位置', '放射中心的水平位置：0 左边缘，50 居中，100 右边缘。'),
      percent('center_y', '中心垂直位置', 50, '放射中心在画面中的垂直位置', '放射中心的垂直位置：0 上边缘，50 居中，100 下边缘。'),
    ] },
  { id: 'sharpen', name: '锐化', group: 'blur', tooltip: '加强边缘对比，让画面更清晰', description: '增强细节与边缘对比（反锐化掩模）。适度使用，过高会出现白边与噪点。',
    params: [strength('amount', '锐化量', 30, '锐化程度，0 不锐化', '0 无；20 ≈ 轻微提清晰度；50 ≈ 明显锐利；100 ≈ 很强，容易出现白边。')] },
  { id: 'brightness_contrast', name: '亮度与对比度', group: 'color', tooltip: '整体提亮或压暗，拉开或减弱明暗反差', description: '整体调整亮度与对比度。',
    params: [
      signed('brightness', '亮度', '正值提亮，负值压暗', '-100 很暗，0 不变，+30 ≈ 明显提亮，+100 接近过曝。'),
      signed('contrast', '对比度', '正值增强反差，负值让画面变灰', '-100 完全灰平，0 不变，+30 ≈ 明显增强反差，+100 对比度约 3 倍。'),
    ] },
  { id: 'exposure', name: '曝光', group: 'color', tooltip: '按相机曝光档调整亮度，高光过渡更自然', description: '在线性光下按档位调整曝光，比“亮度”更自然地处理高光。',
    params: [{ key: 'exposure', name: '曝光', type: 'number', unit: 'stops', min: -4, max: 4, step: 0.1, default: 0, tooltip: '每增加 1 档亮度翻倍', description: '曝光档：+1 亮度翻倍，-1 减半；常用 -1 到 +1；0 不变。' }] },
  { id: 'white_balance', name: '色温与色调', group: 'color', tooltip: '白平衡：让画面偏暖或偏冷，偏绿或偏洋红', description: '白平衡调整，用于校正偏色或营造冷暖氛围。',
    params: [
      signed('temperature', '色温', '正值偏暖（黄），负值偏冷（蓝）', '-100 很冷（蓝），0 不变，+20 ≈ 温暖午后，+100 很暖（橙黄）。'),
      signed('tint', '色调', '正值偏洋红，负值偏绿', '-100 明显偏绿，0 不变，+100 明显偏洋红；常用于修正荧光灯偏绿。'),
    ] },
  { id: 'hue_saturation', name: '色相与饱和度', group: 'color', tooltip: '旋转色相、调整鲜艳程度与明度', description: '整体旋转色相并调整饱和度与明度。',
    params: [
      angle('hue', '色相', 0, -180, 180, '整体旋转颜色，180° 为互补色', '色相旋转角度：0 不变，±180 变为互补色；小角度（±10）可微调肤色。'),
      signed('saturation', '饱和度', '正值更鲜艳，-100 为黑白', '-100 完全黑白，-30 ≈ 低饱和电影感，0 不变，+30 ≈ 鲜艳，+100 饱和度翻倍。'),
      signed('lightness', '明度', '正值整体变亮偏白，负值变暗偏黑', '-100 全黑，0 不变，+100 全白。'),
    ] },
  { id: 'black_white', name: '黑白', group: 'color', tooltip: '把画面变成黑白', description: '按人眼亮度把画面转成黑白（回忆、纪实感）；只想降低鲜艳度时把效果强度调到 30%–70%，或改用“色相与饱和度”。', params: [] },
  { id: 'invert', name: '反相', group: 'color', tooltip: '把颜色变成互补色（底片效果）', description: '反转颜色成互补色（底片效果），用于闪回、惊悚、故障风；保留透明度。部分反相可降低效果强度。', params: [] },
  { id: 'mosaic', name: '马赛克', group: 'stylize', tooltip: '把画面变成色块，常用于打码', description: '把画面切成方块并取每块平均颜色，用于打码、像素风。块大小随画面高度缩放。',
    params: [strength('block_size', '块大小', 30, '色块大小，0 不打码', '0 无；10 ≈ 细小方块（画面高度的 1%）；30 ≈ 常规打码（3%）；100 ≈ 很大的色块（10%）。')] },
  { id: 'vignette', name: '暗角', group: 'stylize', tooltip: '压暗（或提亮）画面四周，把视线引向中心', description: '让画面四周变暗（或变亮），聚焦中心、增加电影感。',
    params: [
      signed('amount', '数量', '正值压暗四周，负值提亮四周', '0 无；+30（默认）≈ 柔和电影暗角，+70 ≈ 浓重暗角，负值把四周提亮成白边。', 30),
      percent('midpoint', '大小', 50, '暗角从多远开始，数值越大中心亮区越大', '暗角开始的位置：0 从中心就开始变暗，50 默认，100 只在最角落。'),
      percent('feather', '羽化', 50, '暗角边缘过渡的柔和程度', '0 边缘很硬，50 默认柔和，100 非常柔和的大范围过渡。'),
    ] },
  { id: 'film_grain', name: '胶片颗粒', group: 'stylize', tooltip: '叠加随时间变化的胶片颗粒', description: '叠加逐帧变化的颗粒噪声，模拟胶片质感。颗粒大小随画面高度缩放，同一帧的颗粒每次渲染都相同。',
    params: [
      strength('amount', '强度', 30, '颗粒的明显程度', '0 无；15 ≈ 隐约的质感；30 ≈ 明显胶片感；100 ≈ 非常粗糙。'),
      strength('size', '颗粒大小', 30, '颗粒的粗细', '0 最细（画面高度的约 0.05%）；30 默认；100 很粗（约 0.4%）。'),
      { key: 'monochrome', name: '单色颗粒', type: 'boolean', default: true, tooltip: '关闭时颗粒带有彩色噪点', description: 'true 颗粒只改变明暗；false 各颜色通道独立的彩色颗粒。' },
    ] },
  { id: 'chromatic_aberration', name: '色差', group: 'stylize', tooltip: '把红蓝通道错开，模拟镜头色散或故障感', description: 'RGB 通道分离：红、蓝通道向相反方向偏移，用于镜头感、故障风。',
    params: [
      strength('amount', '偏移量', 20, '通道错开的距离', '0 无；10 ≈ 镜头边缘轻微色散；40 ≈ 明显故障感；100 ≈ 偏移约为画面高度的 2%。'),
      { key: 'mode', name: '方式', type: 'enum', default: 'radial', options: [{ value: 'radial', label: '从中心向外' }, { value: 'directional', label: '固定方向' }], tooltip: '从中心向外越到边缘越明显；固定方向整幅画面同样错开', description: 'radial 像真实镜头，越靠近边缘色散越强；directional 整幅画面沿“方向”统一错开。' },
      angle('direction', '方向', 0, -180, 180, '方式为固定方向时，通道错开的方向', '仅 mode=directional 时生效：0 水平错开，90 垂直错开。'),
    ] },
  { id: 'glow', name: '发光', group: 'stylize', tooltip: '让明亮区域向外晕开发光', description: '提取画面亮部、模糊后叠加回原画面，形成柔光、霓虹辉光。',
    params: [
      strength('threshold', '阈值', 60, '多亮的区域开始发光', '亮度高于此值的区域才发光：40 大部分亮部发光，60 默认，90 只有最亮的高光。'),
      strength('radius', '半径', 30, '光晕扩散范围', '0 很紧；30 默认；100 约为画面高度 8% 的大光晕。'),
      strength('intensity', '强度', 50, '光晕的亮度', '0 无；50 默认；100 很强的辉光。'),
    ] },
  { id: 'crop', name: '裁剪', group: 'frame', tooltip: '从四边裁掉画面，裁掉的部分透出下层', description: '按画面百分比从四边裁掉，裁掉部分变透明（可透出下层轨道）。做宽银幕黑边时把上下各裁 12% 左右。',
    params: [
      percent('left', '左侧', 0, '从左边裁掉的比例', '从左边裁掉的画面宽度百分比。'),
      percent('top', '顶部', 0, '从顶部裁掉的比例', '从上边裁掉的画面高度百分比；宽银幕效果约 12。'),
      percent('right', '右侧', 0, '从右边裁掉的比例', '从右边裁掉的画面宽度百分比。'),
      percent('bottom', '底部', 0, '从底部裁掉的比例', '从下边裁掉的画面高度百分比；宽银幕效果约 12。'),
      strength('feather', '羽化边缘', 0, '裁剪边缘的柔和程度', '0 硬边；100 边缘有约为画面高度 5% 的渐隐。'),
    ] },
  { id: 'flip', name: '翻转', group: 'frame', tooltip: '水平或垂直镜像画面', description: '镜像翻转画面：修正前置摄像头的左右镜像、调转人物朝向或做对称构图。',
    params: [{ key: 'axis', name: '翻转方向', type: 'enum', default: 'horizontal', options: [{ value: 'horizontal', label: '水平翻转' }, { value: 'vertical', label: '垂直翻转' }, { value: 'both', label: '水平和垂直' }], tooltip: '水平翻转左右互换，垂直翻转上下颠倒', description: 'horizontal 左右镜像；vertical 上下颠倒；both 两者都做（等于旋转 180°）。' }] },
  { id: 'chroma_key', name: '色度抠像', group: 'keying', tooltip: '去掉绿幕或蓝幕背景', description: '把接近“抠像颜色”的区域变透明（绿幕、蓝幕），并压掉主体边缘的反溢色。',
    params: [
      { key: 'key_color', name: '抠像颜色', type: 'color', default: VIDEO_EDIT_CHROMA_KEY_DEFAULT_HEX, tooltip: '要去掉的背景颜色', description: '要变透明的背景色，写 #rrggbb；默认纯绿。最好取画面里背景的实际颜色（绿幕通常是偏暗的绿，蓝幕是偏暗的蓝）。' },
      strength('tolerance', '容差', 30, '多接近抠像颜色的区域会被去掉', '数值越大去掉的颜色范围越宽：20 只去纯净背景，30 默认，60 背景光照不均时使用（可能吃掉主体）。'),
      strength('softness', '边缘柔化', 10, '透明边缘的过渡宽度', '0 硬边；10 默认；50 很柔的半透明边缘（适合头发）。'),
      strength('spill', '溢色抑制', 50, '去掉主体边缘反射的背景色', '0 不处理；50 默认；100 强力去除主体上的绿色/蓝色反光。'),
    ] },
]
/** 全部内置效果：画面效果在前，音频效果（4.7c）在后。 */
export const VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = [...VIDEO_EDIT_VIDEO_EFFECT_DEFINITIONS, ...VIDEO_EDIT_AUDIO_EFFECT_DEFINITIONS]

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
/** `effect:gaussian_blur` 或 `gaussian_blur` → 内置效果 ID；不是内置效果时返回 undefined。 */
export function parseVideoEditBuiltinRefId(value: string): string | undefined {
  const id = value.startsWith(VIDEO_EDIT_BUILTIN_REF_PREFIX) ? value.slice(VIDEO_EDIT_BUILTIN_REF_PREFIX.length) : value
  return definitions.has(id) ? id : undefined
}
export function videoEditBuiltinDefaults(definition: VideoEditBuiltinEffectDefinition): VideoEditBuiltinParams {
  return Object.fromEntries(definition.params.map(param => [param.key, param.default]))
}
const COLOR = /^#[0-9a-f]{6}$/
function range(param: Extract<VideoEditBuiltinParam, { type: 'number' }>): string { return `${param.min}–${param.max}${VIDEO_EDIT_BUILTIN_UNIT_LABELS[param.unit]}` }
/** 单个参数：`clamp` 时数值夹进范围（界面拖动、步进），否则超出范围直接报错（文档校验、助手写入，不静默改值）。 */
export function videoEditBuiltinParamValue(param: VideoEditBuiltinParam, raw: unknown, clamp = false): VideoEditBuiltinParamValue {
  switch (param.type) {
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
      if (!COLOR.test(value)) throw new Error(`“${param.name}”（${param.key}）需要 #rrggbb 颜色。`)
      return value
    }
  }
}
/**
 * 合并并校验参数：`base` 是现有值（缺省为默认值），`changes` 只覆盖给出的键。未知参数直接报错并列出可用参数。
 * 返回完整参数表（每个参数都有值）。
 */
export function normalizeVideoEditBuiltinParams(id: string, changes: Readonly<Record<string, unknown>> = {}, base?: Readonly<Record<string, unknown>>, clamp = false): VideoEditBuiltinParams {
  const definition = requireVideoEditBuiltinEffect(id)
  return normalizeVideoEditParamSet(`内置效果“${definition.name}”`, definition.params, changes, base, clamp)
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
    ...(param.type === 'number' ? { min: param.min, max: param.max, unit: param.unit } : {}),
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
/** 文档校验：未知效果、未知参数或越界值返回原因；缺的参数允许（按默认值，便于以后给效果加参数）。 */
export function videoEditBuiltinEffectIssue(instance: { id: string; params: Readonly<Record<string, unknown>> }): string | undefined {
  try { normalizeVideoEditBuiltinParams(instance.id, instance.params); return undefined } catch (error) { return error instanceof Error ? error.message : '内置效果参数无效。' }
}
/** 读取时补齐默认值（不校验，渲染用）；未知效果抛错。 */
export function resolveVideoEditBuiltinParams(instance: { id: string; params: Readonly<Record<string, unknown>> }): VideoEditBuiltinParams {
  const definition = requireVideoEditBuiltinEffect(instance.id)
  return Object.fromEntries(definition.params.map(param => [param.key, (instance.params[param.key] ?? param.default) as VideoEditBuiltinParamValue]))
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
