/**
 * 视频过渡的参数登记（任务 4.7，第一批视频过渡）：与内置效果同一套“意图量纲”（`builtinEffects.ts`）——方向用选项，
 * 羽化、边框等空间量是 0–100 的强度并按画面高度比例换算，颜色写 `#rrggbb`；每项都有给用户的 `tooltip` 与给助手的 `description`。
 * 只有登记在这里的种类走内置效果着色器（`features/videoEdit/engine/videoEditBuiltinEffect*`）；交叉溶解、黑场、白场仍走原混合。
 * 过渡上存的 `parameters` 可选、可只写一部分，缺的键按默认值渲染，旧文件不受影响。
 */
import { WHITE_HEX } from '../theme/colorTokens'
import { describeVideoEditParams, normalizeVideoEditParamSet, videoEditPercentParam as percent, videoEditStrengthParam as strength, type VideoEditBuiltinParam, type VideoEditBuiltinParams } from './builtinEffects'
import type { VideoEditTransitionKind } from './transitions'
import { SHADER_GRAPH_TRANSITION_KINDS, SHADER_GRAPH_TRANSITION_PARAMS } from './shaderGraph/transitions'

/** 走内置效果着色器的视频过渡种类（顺序即效果面板顺序）。 */
export const VIDEO_EDIT_BUILTIN_TRANSITION_KINDS = ['wipe', 'push', 'slide', 'cross_zoom', 'blur_dissolve', 'flash', 'iris_round', ...SHADER_GRAPH_TRANSITION_KINDS] as const
export type VideoEditBuiltinTransitionKind = typeof VIDEO_EDIT_BUILTIN_TRANSITION_KINDS[number]

const EDGES = [
  { value: 'from_left', label: '从左侧' }, { value: 'from_right', label: '从右侧' }, { value: 'from_top', label: '从顶部' }, { value: 'from_bottom', label: '从底部' },
] as const
const CORNERS = [
  { value: 'from_top_left', label: '从左上角' }, { value: 'from_top_right', label: '从右上角' }, { value: 'from_bottom_left', label: '从左下角' }, { value: 'from_bottom_right', label: '从右下角' },
] as const
const feather = (fallback: number): VideoEditBuiltinParam => strength('feather', '羽化', fallback, '新旧画面交界处的柔和程度', `交界的渐变宽度：0 硬边；${fallback}（默认）≈ 画面高度的 ${fallback / 5}% 的柔边；50 ≈ 10%；100 ≈ 20% 的大范围渐变。`)
const border = strength('border', '边框宽度', 0, '交界处描一条边线，0 没有边框', '交界处边线的宽度：0（默认）没有边框；30 ≈ 画面高度 1% 的细线；100 ≈ 3% 的粗线。')
const borderColor: VideoEditBuiltinParam = { key: 'border_color', name: '边框颜色', type: 'color', default: WHITE_HEX, tooltip: '边线的颜色（边框宽度大于 0 时可见）', description: '边线颜色，写 #rrggbb；默认白色。仅在 border 大于 0 时可见。' }
const smooth: VideoEditBuiltinParam = { key: 'smooth', name: '缓入缓出', type: 'boolean', default: true, tooltip: '开头和结尾放慢，中间加快，运动更自然', description: 'true（默认）开头结尾慢、中间快；false 匀速移动，切换感更机械。' }
const centerX = percent('center_x', '中心水平位置', 50, '中心点在画面中的水平位置', '中心点的水平位置：0 左边缘，50（默认）居中，100 右边缘。')
const centerY = percent('center_y', '中心垂直位置', 50, '中心点在画面中的垂直位置', '中心点的垂直位置：0 上边缘，50（默认）居中，100 下边缘。')
const movingDirection = (tooltip: string): VideoEditBuiltinParam => ({ key: 'direction', name: '方向', type: 'enum', default: 'from_right', options: EDGES, tooltip, description: '后一段画面从哪一侧进入：from_left 从左侧（向右运动）、from_right（默认）从右侧、from_top 从顶部、from_bottom 从底部。' })

export const VIDEO_EDIT_TRANSITION_PARAMS: Readonly<Record<VideoEditBuiltinTransitionKind, readonly VideoEditBuiltinParam[]>> = {
  ...SHADER_GRAPH_TRANSITION_PARAMS,
  wipe: [
    { key: 'direction', name: '方向', type: 'enum', default: 'from_left', options: [...EDGES, ...CORNERS], tooltip: '擦除从画面哪一边或哪个角开始', description: '擦除的起点：from_left（默认）从左向右擦，from_right 从右向左，from_top 从上往下，from_bottom 从下往上；from_top_left 等四个值从对应角斜向擦过。' },
    feather(10), border, borderColor,
  ],
  push: [movingDirection('后一段画面从哪一侧推入，把前一段推出画面'), smooth],
  slide: [movingDirection('后一段画面从哪一侧滑入，盖在前一段上面'), smooth],
  cross_zoom: [
    strength('zoom', '缩放幅度', 50, '前一段放大冲出、后一段从放大状态收回的程度', '过渡中点画面放大的倍数：0 不缩放（只剩交叉溶解）；50（默认）≈ 2 倍；100 ≈ 3 倍。'),
    strength('blur', '动感模糊', 50, '缩放时沿放射方向的模糊程度', '缩放时的放射拖影：0 没有拖影；50（默认）明显的冲刺感；100 强烈拉丝。'),
    centerX, centerY,
  ],
  blur_dissolve: [strength('blur', '模糊度', 50, '过渡中点画面最模糊的程度', '中点最大模糊（与“高斯模糊”同一量纲）：20 ≈ 轻微失焦；50（默认）≈ 明显虚化；100 ≈ 半径约为画面高度 6% 的强烈虚化。')],
  flash: [
    { key: 'color', name: '闪光颜色', type: 'color', default: WHITE_HEX, tooltip: '闪光的颜色', description: '闪光颜色，写 #rrggbb；默认白色（相机闪光、回忆）；红色可表现冲击、受伤。' },
    strength('intensity', '闪光强度', 100, '中点画面被闪光盖住的程度', '中点闪光的覆盖程度：100（默认）中点整屏变成闪光色；50 ≈ 半透明的一闪；20 ≈ 轻微一亮。'),
  ],
  iris_round: [
    { key: 'mode', name: '方式', type: 'enum', default: 'open', options: [{ value: 'open', label: '由中心展开' }, { value: 'close', label: '向中心收拢' }], tooltip: '后一段从圆里展开，或前一段缩进圆里消失', description: 'open（默认）后一段画面从中心的小圆展开到全屏；close 前一段画面收缩成小圆消失，露出后一段。' },
    centerX, centerY, feather(5), border, borderColor,
  ],
}

export function isVideoEditBuiltinTransitionKind(kind: VideoEditTransitionKind | string): kind is VideoEditBuiltinTransitionKind {
  return (VIDEO_EDIT_BUILTIN_TRANSITION_KINDS as readonly string[]).includes(kind)
}
/** 这种过渡的参数登记；交叉溶解、黑场、白场与音频过渡没有参数。 */
export function videoEditTransitionParamDefinitions(kind: VideoEditTransitionKind): readonly VideoEditBuiltinParam[] {
  return isVideoEditBuiltinTransitionKind(kind) ? VIDEO_EDIT_TRANSITION_PARAMS[kind] : []
}
/** 合并并校验（界面拖动 `clamp` 时数值夹进范围，助手写入越界直接报错）；返回完整参数表。 */
export function normalizeVideoEditTransitionParams(kind: VideoEditTransitionKind, name: string, changes: Readonly<Record<string, unknown>> = {}, base?: Readonly<Record<string, unknown>>, clamp = false): VideoEditBuiltinParams {
  return normalizeVideoEditParamSet(`过渡“${name}”`, videoEditTransitionParamDefinitions(kind), changes, base, clamp)
}
/** 只校验给出的键、不补默认值（助手整体写入：写什么存什么）。 */
export function validateVideoEditTransitionParams(kind: VideoEditTransitionKind, name: string, params: Readonly<Record<string, unknown>>): VideoEditBuiltinParams {
  const full = normalizeVideoEditTransitionParams(kind, name, params)
  return Object.fromEntries(Object.keys(params).map(key => [key, full[key]]))
}
/** 渲染用：补齐默认值（不校验）。 */
export function resolveVideoEditTransitionParams(kind: VideoEditTransitionKind, params: Readonly<Record<string, unknown>> | undefined): VideoEditBuiltinParams {
  return Object.fromEntries(videoEditTransitionParamDefinitions(kind).map(param => [param.key, (params?.[param.key] ?? param.default) as VideoEditBuiltinParams[string]]))
}
/** 文档校验：未知参数、越界或错类型返回原因。 */
export function videoEditTransitionParamsIssue(kind: VideoEditTransitionKind, name: string, params: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (!params) return undefined
  try { normalizeVideoEditTransitionParams(kind, name, params); return undefined } catch (error) { return error instanceof Error ? error.message : '过渡参数无效。' }
}
export function describeVideoEditTransitionParams(kind: VideoEditTransitionKind): ReturnType<typeof describeVideoEditParams> { return describeVideoEditParams(videoEditTransitionParamDefinitions(kind)) }
