/**
 * “生成”文件夹：原生的渐变，加上封装 `shaders` 组件的生成器。
 *
 * 封装生成器只上片段（着色器图出口 8 位），在内容 alpha 内按混合模式生成（`shaderGraph/effects.ts`）。
 * 噪声、图案、光效背景各把一组组件合成“方式”：共有参数在前，换算回各组件自己的范围，默认值对准组件默认；
 * 只属于某几种方式的参数按方式显隐。其余生成器参数沿用组件，只改名字、分组与说明。默认颜色一律中性黑白灰。
 * 速度类参数决定组件自己累加的时钟，一律不做动画（会话按它分开，见 `shaderClockRateProps`）。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam, VideoEditBuiltinParams } from './builtinEffects'
import type { ShaderGraphWrappedEffect } from './shaderGraph/effects'
import { requireShaderComponent, type ShaderComponent } from './shaderGraph/spec'
import { shaderBlendModeParam, shaderComponentParams, shaderComponentProps } from './shaderGraph/componentParams'
import { effectParam, type EffectParamText } from './effectIncludes'
import { GRADIENT_EFFECT_DEFINITION, percentPosition } from './gradient'
import { BLACK_HEX, DARK_GRAY_HEX, LIGHT_GRAY_HEX, MID_GRAY_HEX, WHITE_HEX } from '../theme/colorTokens'

type Values = Readonly<VideoEditBuiltinParams>
const { amount, signed, choice, color, angle } = effectParam
const num = (values: Values, key: string): number => Number(values[key] ?? 0)
const only = (...modes: string[]): { visibleWhen: { param: string; in: string[] } } => ({ visibleWhen: { param: 'mode', in: modes } })
const fixed = <T extends VideoEditBuiltinParam>(param: T): T => ({ ...param, animatable: false })

const requireComponent = (name: string): ShaderComponent => requireShaderComponent(name, '生成器')
/** 组件数值属性的 [下限, 默认, 上限]。 */
function bounds(component: ShaderComponent, key: string): [number, number, number] {
  const prop = component.props.find(item => item.key === key)
  if (!prop || typeof prop.default !== 'number') throw new Error(`${component.name} 没有数值属性 ${key}。`)
  return [prop.min ?? 0, prop.default, prop.max ?? 1]
}
const clamp = (value: number, [min, , max]: [number, number, number]): number => Math.min(max, Math.max(min, value))
/** 0–100 的滑块分两段线性：0 → 组件下限，50 → 组件默认，100 → 组件上限。 */
function around(component: ShaderComponent, key: string, value: number): number {
  const [min, middle, max] = bounds(component, key)
  return value <= 50 ? min + (middle - min) * value / 50 : middle + (max - middle) * (value - 50) / 50
}
/** 组件默认值乘倍数，夹在组件范围内。 */
const times = (component: ShaderComponent, key: string, factor: number): number => clamp(bounds(component, key)[1] * factor, bounds(component, key))
/** 0–100 线性铺满组件范围。 */
function span(component: ShaderComponent, key: string, value: number): number { const [min, , max] = bounds(component, key); return min + (max - min) * value / 100 }
/** 大小（0–100，50 = 组件默认，每加 25 大一倍）的倍数。 */
const sizeFactor = (value: number): number => 2 ** ((value - 50) / 25)
/** 按“画面里排几个”计数的属性：越大排得越少。 */
const fewer = (component: ShaderComponent, key: string, value: number): number => clamp(bounds(component, key)[1] / sizeFactor(value), bounds(component, key))
/** 按 exp(scale) 放大坐标的噪声：大一倍就减 ln2。 */
const expScale = (component: ShaderComponent, key: string, value: number): number => clamp(bounds(component, key)[1] - Math.log(sizeFactor(value)), bounds(component, key))
/** 粗细：50 = 组件默认，每加 25 粗一倍，0 没有。 */
const thickness = (component: ShaderComponent, key: string, value: number): number => value <= 0 ? 0 : clamp(bounds(component, key)[1] * sizeFactor(value), bounds(component, key))
/** 带方向的移动速度：−100..100 按组件正向上限换算。 */
function drift(component: ShaderComponent, key: string, value: number): number { const range = bounds(component, key); return clamp(value / 100 * Math.max(Math.abs(range[0]), Math.abs(range[2])), range) }
/** 角度（−180..180）换成组件的 0..360。 */
const turn = (value: number): number => ((value % 360) + 360) % 360
const point = (values: Values, key: string): { x: number; y: number } => ({ x: num(values, `${key}_x`) / 100, y: num(values, `${key}_y`) / 100 })

interface Method { value: string; label: string; component: string; props: (values: Values, component: ShaderComponent) => Record<string, unknown> }
interface Merged { definition: VideoEditBuiltinEffectDefinition; graph: ShaderGraphWrappedEffect; sources: readonly string[] }
function merged(definition: Omit<VideoEditBuiltinEffectDefinition, 'stage' | 'group' | 'params'>, mode: EffectParamText & { default: string }, methods: readonly Method[], params: readonly VideoEditBuiltinParam[]): Merged {
  const common = ['color_a', 'color_b', 'scale', 'contrast', 'balance', 'seed', 'speed']
  const ordered = [...common.flatMap(key => params.filter(param => param.key === key)), ...params.filter(param => !common.includes(param.key))]
  const byValue = new Map(methods.map(method => [method.value, { ...method, resolved: requireComponent(method.component) }]))
  const pick = (values: Values): Method & { resolved: ShaderComponent } => byValue.get(String(values.mode)) ?? byValue.get(mode.default)!
  return {
    definition: { ...definition, stage: 'generator', group: 'generator', params: [choice('mode', mode.default, methods.map(({ value, label }) => ({ value, label })), mode), ...ordered.map(param => param.type === 'color' ? { ...param, alpha: true } : param), shaderBlendModeParam('输出')] },
    graph: { id: definition.id, component: values => pick(values).component, props: values => { const method = pick(values); return { ...method.props(values, method.resolved), blendMode: values.blend_mode } } },
    sources: methods.map(method => method.component),
  }
}

// —— 噪声：10 种组件合成方式，共有颜色、缩放、对比度、平衡、随机种子、速度。 ——
const NOISE_SCALED = ['block', 'curl', 'erosion', 'gabor', 'perlin', 'simplex', 'wavelet', 'worley']
const NOISE_MOVING = ['block', 'curl', 'fractal', 'gabor', 'perlin', 'simplex', 'wavelet', 'worley']
const noiseBase = (values: Values, component: ShaderComponent): Record<string, unknown> => ({
  colorA: values.color_a, colorB: values.color_b, seed: num(values, 'seed'), contrast: around(component, 'contrast', num(values, 'contrast')),
  ...(component.props.some(prop => prop.key === 'balance') ? { balance: num(values, 'balance') / 100 } : {}),
  ...(component.props.some(prop => prop.key === 'speed') ? { speed: times(component, 'speed', num(values, 'speed')) } : {}),
})
const seeded = (values: Values, component: ShaderComponent): Record<string, unknown> => ({ ...noiseBase(values, component), scale: expScale(component, 'scale', num(values, 'scale')) })
const NOISE = merged({
  id: 'noise', name: '噪声', description: '生成随机起伏的噪声纹理，做云雾、烟、流动的底纹，或给别的效果当底图。默认是柔和起伏的黑白斑块，缓慢变化。',
  aliases: ['杂色', '分形杂色', '湍流杂色', '方块噪声', '蓝噪声', '旋流噪声', '侵蚀纹', '分形噪声', '指纹噪声', '柏林噪声', '单形噪声', '小波噪声', '细胞噪声', 'noise', 'fractal noise', 'perlin noise'],
}, { default: 'perlin', name: '方式', text: '噪声的样子。柏林（默认）平滑起伏；分形多层叠加像云；单形更有机；方块成柔和格子；细胞成一格格的斑；旋流像缓慢的流体；指纹、小波带方向的纹路；侵蚀像山脊；蓝噪声是均匀细密的颗粒。' }, [
  { value: 'perlin', label: '柏林', component: 'PerlinNoise', props: seeded },
  { value: 'fractal', label: '分形', component: 'FractalNoise', props: (values, component) => ({ ...noiseBase(values, component), detail: around(component, 'detail', num(values, 'detail')), octaves: num(values, 'octaves'), angle: num(values, 'angle') }) },
  { value: 'simplex', label: '单形', component: 'SimplexNoise', props: seeded },
  { value: 'block', label: '方块', component: 'BlockNoise', props: seeded },
  { value: 'worley', label: '细胞', component: 'WorleyNoise', props: (values, component) => ({ ...noiseBase(values, component), balance: -num(values, 'balance') / 100, scale: fewer(component, 'scale', num(values, 'scale')), mode: values.cell_shape, distance: values.cell_edge, jitter: num(values, 'jitter') / 100 }) },
  { value: 'curl', label: '旋流', component: 'CurlNoise', props: seeded },
  { value: 'gabor', label: '指纹', component: 'GaborNoise', props: (values, component) => ({ ...seeded(values, component), frequency: around(component, 'frequency', num(values, 'detail')) }) },
  { value: 'wavelet', label: '小波', component: 'WaveletNoise', props: (values, component) => ({ ...seeded(values, component), detail: around(component, 'detail', num(values, 'detail')) }) },
  { value: 'erosion', label: '侵蚀', component: 'ErosionNoise', props: seeded },
  { value: 'blue', label: '蓝噪声', component: 'BlueNoise', props: noiseBase },
], [
  { ...amount('scale', 50, { name: '缩放', text: '斑块有多大。50（默认）一块约为画面高度的七分之一；每加 25 大一倍，0 是默认的四分之一，100 是四倍。' }), ...only(...NOISE_SCALED) },
  amount('contrast', 50, { name: '对比度', text: '明暗之间过渡得多硬。50（默认）柔和起伏；往上调边界越来越清楚，100 接近黑白两色；往下调更灰更平。' }),
  { ...amount('detail', 50, { name: '细节', text: '纹路有多细碎。50（默认）；调大细小纹理更多、更密，调小更粗更简单。' }), ...only('fractal', 'gabor', 'wavelet') },
  color('color_a', WHITE_HEX, { group: '颜色', name: '颜色 A', text: '噪声亮的一端的颜色。白色（默认）；可以带透明度。' }),
  color('color_b', BLACK_HEX, { group: '颜色', name: '颜色 B', text: '噪声暗的一端的颜色。黑色（默认）；换成透明，噪声就只剩亮的部分叠在内容上。' }),
  { ...signed('balance', 0, { group: '颜色', name: '平衡', text: '两种颜色各占多少。0（默认）各一半；往正调颜色 A 多，往负调颜色 B 多。' }), ...only('perlin', 'simplex', 'block', 'worley', 'curl', 'gabor', 'wavelet', 'erosion', 'blue') },
  { ...fixed({ key: 'octaves', name: '层数', type: 'number', unit: 'value', min: 1, max: 8, step: 1, default: 4, group: '分形', description: '叠几层由粗到细的噪声。4（默认）像云；1 只有一层平滑起伏；8 最细腻，略慢。' }), ...only('fractal') },
  { ...angle('angle', 0, { group: '分形', name: '角度', text: '把噪声整体转一个角度。0°（默认）。' }), ...only('fractal') },
  { ...choice('cell_shape', 'f1', [{ value: 'f1', label: '斑点' }, { value: 'f2', label: '大斑' }, { value: 'f2MinusF1', label: '裂纹' }, { value: 'f1PlusF2', label: '鳞片' }, { value: 'f1TimesF2', label: '卵石' }], { group: '细胞', name: '形态', text: '一格格的细胞画成什么。斑点（默认）中心亮、边缘暗；裂纹只留细胞之间的分界线；鳞片、卵石是更饱满的块。' }), ...only('worley') },
  { ...choice('cell_edge', 'euclidean', [{ value: 'euclidean', label: '圆' }, { value: 'manhattan', label: '菱形' }, { value: 'chebyshev', label: '方' }], { group: '细胞', name: '轮廓', text: '细胞的轮廓偏向什么形状。圆（默认）；菱形、方更硬朗。' }), ...only('worley') },
  { ...amount('jitter', 100, { group: '细胞', name: '随机程度', text: '细胞排列有多乱。100（默认）完全随机；0 排成整齐的网格。' }), ...only('worley') },
  fixed({ ...amount('seed', 0, { group: '变化', name: '随机种子', text: '换一个数就换一种排布，整体样子不变。0（默认）。' }) }),
  { ...fixed({ key: 'speed', name: '速度', type: 'number', unit: 'multiplier', min: 0, max: 4, step: 0.05, default: 1, group: '变化', description: '噪声变化得多快。1（默认）缓慢流动；0 静止不动；2 快一倍。不能做关键帧。' }), ...only(...NOISE_MOVING) },
])

// —— 图案：12 种组件合成方式，共有颜色、缩放、旋转、线宽与柔和、随机与移动。 ——
const patternColors = (a: string, b: string) => (values: Values): Record<string, unknown> => ({ [a]: values.color_a, [b]: values.color_b })
const PATTERN = merged({
  id: 'pattern', name: '图案', description: '生成重复排列的图案：网格、条纹、棋盘、蜂窝、砖墙、点阵等，做科技感底纹或装饰背景。默认是黑底白色的线框网格。',
  aliases: ['网格', '线框网格', '砖墙', '棋盘格', '人字纹', '点阵', '蜂窝网格', '等距立方', '条纹', '三角网格', '特鲁谢拼贴', '泰森多边形', '编织', 'pattern', 'grid', 'stripes', 'checkerboard'],
}, { default: 'grid', name: '方式', text: '图案的样子。线框网格（默认）；条纹、人字纹是交替色带；棋盘格、蜂窝、三角网格、等距立方是拼贴；砖墙、编织像材质；点阵是一排排圆点；特鲁谢是弧线迷宫；泰森多边形是不规则的细胞。' }, [
  { value: 'grid', label: '线框网格', component: 'Grid', props: (values, c) => ({ color: values.color_a, cellColor: values.color_b, cells: fewer(c, 'cells', num(values, 'scale')), thickness: thickness(c, 'thickness', num(values, 'line_width')), rotation: turn(num(values, 'rotation')), softness: span(c, 'softness', num(values, 'softness')), variation: num(values, 'variation') / 100 }) },
  { value: 'stripes', label: '条纹', component: 'Stripes', props: (values, c) => ({ ...patternColors('colorA', 'colorB')(values), density: fewer(c, 'density', num(values, 'scale')), angle: ((bounds(c, 'angle')[1] + num(values, 'rotation') + 540) % 360) - 180, balance: (num(values, 'balance') + 100) / 200, softness: span(c, 'softness', num(values, 'softness')), speed: drift(c, 'speed', num(values, 'speed')) }) },
  { value: 'chevron', label: '人字纹', component: 'Chevron', props: (values, c) => ({ ...patternColors('colorA', 'colorB')(values), count: fewer(c, 'count', num(values, 'scale')), angle: num(values, 'rotation'), balance: (num(values, 'balance') + 100) / 200, softness: span(c, 'softness', num(values, 'softness')), speed: drift(c, 'speed', num(values, 'speed')) }) },
  { value: 'checker', label: '棋盘格', component: 'Checkerboard', props: (values, c) => ({ ...patternColors('colorA', 'colorB')(values), cells: fewer(c, 'cells', num(values, 'scale')), softness: span(c, 'softness', num(values, 'softness')) }) },
  { value: 'hex', label: '蜂窝', component: 'HexGrid', props: (values, c) => ({ ...patternColors('colorB', 'colorA')(values), cells: fewer(c, 'cells', num(values, 'scale')), thickness: thickness(c, 'thickness', num(values, 'line_width')), rotation: turn(num(values, 'rotation')), softness: span(c, 'softness', num(values, 'softness')), variation: num(values, 'variation') / 100 }) },
  { value: 'triangles', label: '三角网格', component: 'TriangularGrid', props: (values, c) => ({ ...patternColors('colorB', 'colorA')(values), cells: fewer(c, 'cells', num(values, 'scale')), thickness: thickness(c, 'thickness', num(values, 'line_width')), rotation: turn(num(values, 'rotation')), softness: span(c, 'softness', num(values, 'softness')), variation: num(values, 'variation') / 100, speed: drift(c, 'speed', num(values, 'speed')) }) },
  { value: 'cubes', label: '等距立方', component: 'IsometricCubes', props: (values, c) => ({ ...patternColors('colorA', 'colorB')(values), lineColor: values.line_color, cells: fewer(c, 'cells', num(values, 'scale')), thickness: thickness(c, 'thickness', num(values, 'line_width')), rotation: turn(num(values, 'rotation')), softness: span(c, 'softness', num(values, 'softness')), colorVariation: num(values, 'variation') / 100 }) },
  { value: 'dots', label: '点阵', component: 'DotGrid', props: (values, c) => ({ color: values.color_a, density: fewer(c, 'density', num(values, 'scale')), dotSize: around(c, 'dotSize', num(values, 'dot_size')), twinkle: num(values, 'twinkle') / 100, speed: drift(c, 'speed', num(values, 'speed')) }) },
  { value: 'brick', label: '砖墙', component: 'BrickPattern', props: (values, c) => ({ colorBrick: values.color_a, colorMortar: values.color_b, cellsX: fewer(c, 'cellsX', num(values, 'scale')), cellsY: fewer(c, 'cellsY', num(values, 'scale')), mortar: thickness(c, 'mortar', num(values, 'line_width')), rotation: turn(num(values, 'rotation')), softness: span(c, 'softness', num(values, 'softness')), variation: num(values, 'variation') / 100, seed: num(values, 'seed'), speed: drift(c, 'speed', num(values, 'speed')) }) },
  { value: 'weave', label: '编织', component: 'Weave', props: (values, c) => ({ ...patternColors('colorA', 'colorB')(values), cells: fewer(c, 'cells', num(values, 'scale')), gap: around(c, 'gap', num(values, 'gap')), rotation: turn(num(values, 'rotation')) }) },
  { value: 'truchet', label: '特鲁谢', component: 'Truchet', props: (values, c) => ({ ...patternColors('colorB', 'colorA')(values), cells: fewer(c, 'cells', num(values, 'scale')), thickness: thickness(c, 'thickness', num(values, 'line_width')), rotation: turn(num(values, 'rotation')), softness: span(c, 'softness', num(values, 'softness')), seed: num(values, 'seed') }) },
  { value: 'voronoi', label: '泰森多边形', component: 'Voronoi', props: (values, c) => ({ ...patternColors('colorA', 'colorB')(values), colorBorder: values.line_color, scale: fewer(c, 'scale', num(values, 'scale')), edgeSoftness: thickness(c, 'edgeSoftness', num(values, 'line_width')), seed: num(values, 'seed'), speed: drift(c, 'speed', num(values, 'speed')) }) },
], [
  amount('scale', 50, { name: '缩放', text: '图案每一格有多大。50（默认）；每加 25 大一倍、格子少一半，往下调格子更密。' }),
  { ...angle('rotation', 0, { name: '旋转', text: '把图案整体转一个角度。0°（默认）；网格转 45° 成菱形格。' }), ...only('grid', 'stripes', 'chevron', 'hex', 'triangles', 'cubes', 'brick', 'weave', 'truchet') },
  { ...amount('line_width', 50, { name: '线宽', text: '线条、灰缝或边线有多粗。50（默认）；每加 25 粗一倍，0 没有线。' }), ...only('grid', 'hex', 'triangles', 'cubes', 'brick', 'truchet', 'voronoi') },
  color('color_a', WHITE_HEX, { group: '颜色', name: '颜色 A', text: '图案本身（线条、砖块、圆点或第一种色块）的颜色。白色（默认）。' }),
  { ...color('color_b', BLACK_HEX, { group: '颜色', name: '颜色 B', text: '底色或第二种色块的颜色。黑色（默认）；换成透明，图案就叠在内容上。' }), ...only('grid', 'stripes', 'chevron', 'checker', 'hex', 'triangles', 'cubes', 'brick', 'weave', 'truchet', 'voronoi') },
  { ...color('line_color', DARK_GRAY_HEX, { group: '颜色', name: '边线颜色', text: '立方体或细胞之间分界线的颜色。深灰（默认）。' }), ...only('cubes', 'voronoi') },
  { ...signed('balance', 0, { group: '颜色', name: '平衡', text: '两种颜色的色带各占多宽。0（默认）一样宽；往正调颜色 A 宽，往负调颜色 B 宽。' }), ...only('stripes', 'chevron') },
  { ...amount('softness', 0, { group: '边缘', name: '柔和', text: '图案边缘清楚还是柔和。0（默认）利落；100 边缘化开成渐变。' }), ...only('grid', 'stripes', 'chevron', 'checker', 'hex', 'triangles', 'cubes', 'brick', 'truchet') },
  { ...amount('variation', 0, { group: '边缘', name: '明暗变化', text: '每一格随机亮一点暗一点，像拼贴材质。0（默认）一样；100 明显深浅不一。' }), ...only('grid', 'hex', 'triangles', 'cubes', 'brick') },
  { ...amount('gap', 50, { group: '边缘', name: '缝隙', text: '织线之间的缝隙。50（默认）；0 线挨着线，100 缝隙最大。' }), ...only('weave') },
  { ...amount('dot_size', 50, { group: '点', name: '点大小', text: '每个圆点占格子多大。50（默认）；100 圆点连成一片，0 看不见。' }), ...only('dots') },
  { ...amount('twinkle', 0, { group: '点', name: '闪烁', text: '圆点随机明灭。0（默认）不闪；100 明显闪烁。' }), ...only('dots') },
  { ...fixed({ ...amount('seed', 0, { group: '变化', name: '随机种子', text: '换一个数就换一种随机排布。0（默认）。' }) }), ...only('brick', 'truchet', 'voronoi') },
  { ...fixed({ ...signed('speed', 0, { group: '变化', name: '移动', text: '图案自己移动。0（默认）静止；往正、往负是两个方向，100 最快。不能做关键帧。' }) }), ...only('stripes', 'chevron', 'triangles', 'dots', 'brick', 'voronoi') },
])

// —— 光效背景：7 种组件合成方式，共有光的颜色、强度、位置、速度，各方式的形状参数按方式显隐。 ——
const light = (values: Values, component: ShaderComponent, key: string): number => clamp(bounds(component, key)[1] * num(values, 'intensity') / 100, bounds(component, key))
const speedOf = (values: Values, component: ShaderComponent): number => times(component, 'speed', num(values, 'speed'))
/** 各方式自己的位置参数，默认值取组件默认位置（每种光的构图不同，共用一组位置时切换方式会构图失当）。 */
function lightPosition(mode: string, componentName: string, prop: string, key: string, name: string, text: string): VideoEditBuiltinParam[] {
  const fallback = requireComponent(componentName).props.find(item => item.key === prop)?.default as { x?: number; y?: number } | undefined
  const [x, y] = [Math.round((fallback?.x ?? 0.5) * 100), Math.round((fallback?.y ?? 0.5) * 100)]
  return [
    { ...percentPosition(`${key}_x`, x, { group: '位置', name: `${name}（水平）`, text: `${text}，按画面宽度的百分比。${x}（默认）。` }), ...only(mode) },
    { ...percentPosition(`${key}_y`, y, { group: '位置', name: `${name}（垂直）`, text: `${text}，按画面高度的百分比。${y}（默认）。` }), ...only(mode) },
  ]
}
const LIGHT = merged({
  id: 'light_background', name: '光效背景', description: '生成发光的背景：体积光、极光、光束、放射光芒、棱镜彩虹、流动光丝、等离子。适合片头、转场底和氛围画面。在 8 位里计算，暗底上的大面积柔光可能出色带，要干净的柔光请用渐变、漏光或发光。',
  aliases: ['极光', '体积光', '光束', '放射光芒', '棱镜', '光丝', '等离子', '光线', '耶稣光', 'god rays', 'aurora', 'light rays'],
}, { default: 'godrays', name: '方式', text: '光的样子。体积光（默认）从一点放射出的光柱；极光是飘动的光帘；光束从起点射向终点；放射光芒是一圈尖角光；棱镜把白光分成彩虹；光丝是流动的光带；等离子是流动的光团。' }, [
  { value: 'godrays', label: '体积光', component: 'Godrays', props: (values, c) => ({ rayColor: values.color_a, backgroundColor: values.color_b, center: point(values, 'rays'), intensity: light(values, c, 'intensity'), speed: speedOf(values, c), density: around(c, 'density', num(values, 'count')), spotty: num(values, 'detail') / 100 }) },
  { value: 'aurora', label: '极光', component: 'Aurora', props: (values, c) => ({ colorB: values.color_a, colorA: values.color_a, colorC: values.color_b, center: point(values, 'aurora'), intensity: light(values, c, 'intensity'), speed: speedOf(values, c), waviness: around(c, 'waviness', num(values, 'wave')), rayDensity: around(c, 'rayDensity', num(values, 'detail')), height: around(c, 'height', num(values, 'spread')), seed: num(values, 'seed') }) },
  { value: 'beam', label: '光束', component: 'Beam', props: (values, c) => ({ insideColor: values.color_a, outsideColor: values.color_b, startPosition: point(values, 'beam_start'), endPosition: point(values, 'beam_end'), startThickness: thickness(c, 'startThickness', num(values, 'width')), endThickness: thickness(c, 'endThickness', num(values, 'width')), startSoftness: around(c, 'startSoftness', num(values, 'softness')), endSoftness: around(c, 'endSoftness', num(values, 'softness')) }) },
  { value: 'sunburst', label: '放射光芒', component: 'SunBurst', props: (values, c) => ({ color: values.color_a, background: values.color_b, center: point(values, 'burst'), speed: times(c, 'speed', num(values, 'speed')), rayCount: Math.round(around(c, 'rayCount', num(values, 'count'))), softness: span(c, 'softness', num(values, 'softness')), radius: around(c, 'radius', num(values, 'spread')) }) },
  { value: 'prism', label: '棱镜', component: 'Prism', props: (values, c) => ({ beamColor: values.color_a, position: point(values, 'prism'), splitPosition: point(values, 'prism_split'), intensity: light(values, c, 'intensity'), speed: speedOf(values, c), beamWidth: thickness(c, 'beamWidth', num(values, 'width')), softness: around(c, 'softness', num(values, 'softness')), spread: around(c, 'spread', num(values, 'spread')) }) },
  { value: 'strands', label: '光丝', component: 'Strands', props: (values, c) => ({ stops: [{ color: values.color_a, position: 0 }, { color: values.color_b, position: 1 }], start: point(values, 'strands_start'), end: point(values, 'strands_end'), speed: speedOf(values, c), lineCount: Math.round(around(c, 'lineCount', num(values, 'count'))), lineWidth: thickness(c, 'lineWidth', num(values, 'width')), amplitude: around(c, 'amplitude', num(values, 'wave')), spread: around(c, 'spread', num(values, 'spread')) }) },
  { value: 'plasma', label: '等离子', component: 'Plasma', props: (values, c) => ({ colorA: values.color_a, colorB: values.color_b, intensity: light(values, c, 'intensity'), speed: speedOf(values, c), density: around(c, 'density', num(values, 'count')), warp: around(c, 'warp', num(values, 'wave')) }) },
], [
  { ...amount('intensity', 100, { name: '强度', text: '光有多亮。100（默认）；50 柔和含蓄；可以输入到 200，更亮更满。' }, 200), ...only('godrays', 'aurora', 'prism', 'plasma') },
  color('color_a', WHITE_HEX, { group: '颜色', name: '光的颜色', text: '光最亮处的颜色。白色（默认）；换成淡金、淡蓝就是暖光、冷光。' }),
  { ...color('color_b', BLACK_HEX, { group: '颜色', name: '第二颜色', text: '光的另一种颜色：体积光、放射光芒是底色，光束是外缘，极光是光帘边缘，光丝是另一端，等离子是暗部。黑色（默认）。' }), ...only('godrays', 'aurora', 'beam', 'sunburst', 'strands', 'plasma') },
  ...lightPosition('godrays', 'Godrays', 'center', 'rays', '光源', '光柱从哪里放射出来'),
  ...lightPosition('aurora', 'Aurora', 'center', 'aurora', '位置', '极光帘从哪里垂下'),
  ...lightPosition('sunburst', 'SunBurst', 'center', 'burst', '中心', '光芒从哪里放射'),
  ...lightPosition('beam', 'Beam', 'startPosition', 'beam_start', '起点', '光束从哪里出发'),
  ...lightPosition('beam', 'Beam', 'endPosition', 'beam_end', '终点', '光束射到哪里'),
  ...lightPosition('prism', 'Prism', 'position', 'prism', '光源', '白光从哪里射来'),
  ...lightPosition('prism', 'Prism', 'splitPosition', 'prism_split', '分光点', '白光在哪里散成彩虹'),
  ...lightPosition('strands', 'Strands', 'start', 'strands_start', '起点', '光丝从哪里出发'),
  ...lightPosition('strands', 'Strands', 'end', 'strands_end', '终点', '光丝到哪里'),
  { ...amount('count', 50, { group: '形状', name: '数量', text: '光柱、光芒、光丝或光团有多密。50（默认）；往上更多更密，往下更少。' }), ...only('godrays', 'sunburst', 'strands', 'plasma') },
  { ...amount('width', 50, { group: '形状', name: '粗细', text: '光束、光丝有多粗。50（默认）；每加 25 粗一倍。' }), ...only('beam', 'prism', 'strands') },
  { ...amount('softness', 50, { group: '形状', name: '柔和', text: '光的边缘利落还是化开。50（默认）；往上更柔，往下更利。' }), ...only('beam', 'sunburst', 'prism') },
  { ...amount('wave', 50, { group: '形状', name: '波动', text: '光帘、光丝摆动或光团扭曲的幅度。50（默认）；0 平直，100 剧烈。' }), ...only('aurora', 'strands', 'plasma') },
  { ...amount('spread', 50, { group: '形状', name: '展开', text: '光铺开多大：极光的高度、光芒的长度、棱镜彩虹与光丝散开的宽度。50（默认）。' }), ...only('aurora', 'sunburst', 'prism', 'strands') },
  { ...amount('detail', 50, { group: '形状', name: '细节', text: '光里的细碎纹理：体积光的斑驳、极光的竖向光丝。50（默认）；0 平滑，100 最碎。' }), ...only('godrays', 'aurora') },
  { ...fixed({ key: 'speed', name: '速度', type: 'number', unit: 'multiplier', min: 0, max: 4, step: 0.05, default: 1, group: '变化', description: '光流动、转动得多快。1（默认）；0 静止；2 快一倍。不能做关键帧。' }), ...only('godrays', 'aurora', 'sunburst', 'prism', 'strands', 'plasma') },
  { ...fixed({ ...amount('seed', 0, { group: '变化', name: '随机种子', text: '换一个数就换一种光帘排布。0（默认）。' }) }), ...only('aurora') },
])

// —— 其余生成器：效果 ID 与参数沿用组件（旧工程里的这些效果照常渲染、旧关键帧照常读入），只改名字、分组、说明与默认颜色。 ——
interface Rename { name?: string; text: string; group?: string; default?: string | number; visibleWhen?: VideoEditBuiltinParam['visibleWhen'] }
function renamed(componentName: string, definition: Omit<VideoEditBuiltinEffectDefinition, 'stage' | 'group' | 'params'>, params: ReadonlyArray<[key: string, Rename]>): Merged {
  const component = requireComponent(componentName)
  const generated = new Map(shaderComponentParams(component, ['stops', 'colorSpace']).map(param => [param.key, param]))
  const ordered = params.map(([key, rename]) => {
    const param = generated.get(key)
    if (!param) throw new Error(`${componentName} 没有参数 ${key}。`)
    generated.delete(key)
    const { tooltip: _tooltip, ...base } = param
    return { ...base, ...(rename.name ? { name: rename.name } : {}), description: rename.text, ...(rename.group ? { group: rename.group } : {}), ...(rename.default !== undefined ? { default: rename.default } : {}), ...(rename.visibleWhen ? { visibleWhen: rename.visibleWhen } : {}) } as VideoEditBuiltinParam
  })
  generated.delete('blend_mode')
  if (generated.size) throw new Error(`${componentName} 还有参数没有说明：${[...generated.keys()].join('、')}。`)
  return {
    definition: { ...definition, stage: 'generator', group: 'generator', params: [...ordered, shaderBlendModeParam('输出')] },
    graph: { id: definition.id, component: componentName, props: values => shaderComponentProps(component, values) },
    sources: [componentName],
  }
}
const style = (...values: string[]): Rename['visibleWhen'] => ({ param: 'style', in: values })
const WAVEFORM = renamed('Waveform', { id: 'shaders.Waveform', name: '波形', aliases: ['音频波形', '均衡器', '示波器', '声波', 'waveform', 'audio visualizer'], description: '生成音频可视化的波形：柱状均衡器、填充波浪、示波线或点阵。给“音量”打关键帧可以跟着口播起伏。' }, [
  ['style', { name: '样式', text: '波形怎么画。条带（默认）像均衡器的柱子；波浪是实心起伏；线条像示波器；点阵由小点组成。' }],
  ['amplitude', { name: '音量', text: '信号有多强。1（默认）正常起伏；0 静音成一条线；2 满格。' }],
  ['frequency', { name: '起伏密度', group: '波形', text: '横向起伏有多密。1（默认）；调大峰更多更碎。' }],
  ['height', { name: '最大高度', group: '波形', text: '波形最高占画面高度的多少。0.6（默认）约六成。' }],
  ['align', { name: '朝向', group: '波形', text: '波形往哪边长。镜像（默认）上下对称；上、下只往一边长。' }],
  ['softness', { name: '柔和', group: '波形', text: '边缘清楚还是化开成光。0（默认）清楚。' }],
  ['count', { name: '柱数', group: '柱与点', text: '一共几根柱子或几列点。32（默认）。', visibleWhen: style('bars', 'dots') }],
  ['bar_width', { name: '柱宽', group: '柱与点', text: '柱子占一列的多宽。0.6（默认）；1 柱子挨在一起。', visibleWhen: style('bars') }],
  ['rounding', { name: '圆头', group: '柱与点', text: '柱子两端有多圆。1（默认）全圆；0 方头。', visibleWhen: style('bars') }],
  ['dot_size', { name: '点大小', group: '柱与点', text: '每个点占格子多大。0.7（默认）。', visibleWhen: style('dots') }],
  ['line_width', { name: '线宽', group: '柱与点', text: '示波线有多粗，按画面高度的比例。0.006（默认）。', visibleWhen: style('line') }],
  ['color_a', { name: '起点颜色', group: '颜色', default: WHITE_HEX, text: '波形起点一端的颜色。白色（默认）。' }],
  ['color_b', { name: '终点颜色', group: '颜色', default: LIGHT_GRAY_HEX, text: '波形终点一端的颜色。浅灰（默认），与起点同色就是单色。' }],
  ['from_x', { name: '起点（水平）', group: '位置', text: '波形从哪里开始，按画面宽度的百分比。0（默认）左边缘。' }],
  ['from_y', { name: '起点（垂直）', group: '位置', text: '波形起点的高度，按画面高度的百分比。50（默认）居中。' }],
  ['to_x', { name: '终点（水平）', group: '位置', text: '波形到哪里结束。100（默认）右边缘。' }],
  ['to_y', { name: '终点（垂直）', group: '位置', text: '波形终点的高度。50（默认）居中。' }],
  ['speed', { name: '速度', group: '变化', text: '模拟信号变化得多快。1（默认）；0 定住。不能做关键帧。' }],
  ['seed', { name: '随机种子', group: '变化', text: '换一个数就换一段起伏。1（默认）。' }],
])
const RIPPLES = renamed('Ripples', { id: 'shaders.Ripples', name: '波纹', aliases: ['同心圆', '水波纹', '涟漪', 'ripples'], description: '生成从一点向外扩散的同心波纹。适合声波、信号、点击扩散的示意背景。' }, [
  ['frequency', { name: '圈数', text: '一屏里有多少圈。20（默认）；调大圈更密。' }],
  ['thickness', { name: '粗细', text: '每一圈有多粗。0.5（默认）亮暗各一半；调小成细线。' }],
  ['color_a', { name: '波纹颜色', group: '颜色', text: '波纹本身的颜色。白色（默认）。' }],
  ['color_b', { name: '底色', group: '颜色', text: '圈与圈之间的颜色。黑色（默认）；换成透明就只留波纹。' }],
  ['center_x', { name: '中心（水平）', group: '位置', text: '波纹从哪里扩散，按画面宽度的百分比。50（默认）居中。' }],
  ['center_y', { name: '中心（垂直）', group: '位置', text: '按画面高度的百分比。50（默认）居中。' }],
  ['softness', { name: '柔和', group: '波纹', text: '圈的边缘清楚还是化开。0（默认）清楚。' }],
  ['phase', { name: '偏移', group: '波纹', text: '整组波纹往外推多少。0（默认）；速度为 0 时给它打关键帧，手动控制扩散。' }],
  ['speed', { name: '速度', group: '波纹', text: '波纹向外扩散得多快。1（默认）；负数往里收；0 静止。不能做关键帧。' }],
])
const SPIRAL = renamed('Spiral', { id: 'shaders.Spiral', name: '螺旋', aliases: ['螺旋线', '催眠', 'spiral'], description: '生成旋转的螺旋图案。适合眩晕、催眠、穿越感的转场底。' }, [
  ['scale', { name: '密度', text: '螺旋有几圈。1（默认）；调大圈数更多。' }],
  ['stroke_width', { name: '线宽', text: '螺旋线有多粗。0.5（默认）。' }],
  ['color_a', { name: '底色', group: '颜色', text: '线与线之间的颜色。黑色（默认）。' }],
  ['color_b', { name: '线条颜色', group: '颜色', text: '螺旋线的颜色。白色（默认）。' }],
  ['center_x', { name: '中心（水平）', group: '位置', text: '螺旋中心，按画面宽度的百分比。50（默认）居中。' }],
  ['center_y', { name: '中心（垂直）', group: '位置', text: '按画面高度的百分比。50（默认）居中。' }],
  ['stroke_falloff', { name: '向外变细', group: '线条', text: '线条越往外越细的程度。0（默认）一样粗。' }],
  ['softness', { name: '柔和', group: '线条', text: '线条边缘清楚还是渐隐。0（默认）清楚。' }],
  ['speed', { name: '速度', group: '线条', text: '旋转得多快。1（默认）；负数反方向转；0 静止。不能做关键帧。' }],
])
const SWIRL = renamed('Swirl', { id: 'shaders.Swirl', name: '旋涡', aliases: ['流体', '漩涡', '液体背景', 'swirl'], description: '生成两种颜色缓慢流动、互相卷入的旋涡纹理。适合柔和流动的氛围背景。' }, [
  ['detail', { name: '细节', text: '旋涡纹路有多细碎。1（默认）；调大更繁复。' }],
  ['blend', { name: '平衡', text: '两种颜色各占多少。50（默认）各一半；调小颜色 A 多，调大颜色 B 多。' }],
  ['speed', { name: '速度', text: '流动得多快。1（默认）；0 静止。不能做关键帧。' }],
  ['color_a', { name: '颜色 A', group: '颜色', default: DARK_GRAY_HEX, text: '第一种颜色。深灰（默认）。' }],
  ['color_b', { name: '颜色 B', group: '颜色', default: LIGHT_GRAY_HEX, text: '第二种颜色。浅灰（默认）。' }],
])
const SINE_WAVE = renamed('SineWave', { id: 'shaders.SineWave', name: '正弦波', aliases: ['波浪线', '曲线', 'sine wave'], description: '生成一条平滑起伏、缓慢流动的波浪线。适合信号、声音、节奏的示意。' }, [
  ['amplitude', { name: '起伏高度', text: '波浪起伏多高，按画面高度的比例。0.15（默认）。' }],
  ['frequency', { name: '波数', text: '一屏里有几个起伏。1（默认）。' }],
  ['thickness', { name: '粗细', text: '线有多粗。0.2（默认）。' }],
  ['color', { name: '颜色', group: '线条', text: '线的颜色。白色（默认）。' }],
  ['softness', { name: '柔和', group: '线条', text: '线的边缘有多柔。0.4（默认）略带光晕；0 利落。' }],
  ['speed', { name: '速度', group: '线条', text: '波浪流动得多快。1（默认）；负数反方向；0 静止。不能做关键帧。' }],
  ['position_x', { name: '位置（水平）', group: '位置', text: '波浪中心，按画面宽度的百分比。50（默认）居中。' }],
  ['position_y', { name: '位置（垂直）', group: '位置', text: '按画面高度的百分比。50（默认）居中。' }],
  ['angle', { name: '角度', group: '位置', text: '波浪整体转多少度。0（默认）水平。' }],
])
const FALLING_LINES = renamed('FallingLines', { id: 'shaders.FallingLines', name: '下落线条', aliases: ['流星', '雨', '数据流', '下落', 'falling lines', 'matrix rain'], description: '生成沿一个方向不断落下的细线，头亮尾淡。适合数据流、雨丝、速度感的背景。' }, [
  ['density', { name: '密度', text: '一共有几列线。15（默认）；调大更密。' }],
  ['trail_length', { name: '拖尾长度', text: '每条线拖多长。0.35（默认）；1 首尾相连。' }],
  ['speed', { name: '速度', text: '落得多快。0.5（默认）；0 静止。不能做关键帧。' }],
  ['color_a', { name: '头部颜色', group: '颜色', text: '线条前端的颜色。白色（默认）。' }],
  ['color_b', { name: '尾部颜色', group: '颜色', text: '线条末端的颜色。透明（默认），尾巴自然淡出。' }],
  ['balance', { name: '渐变中点', group: '颜色', text: '头尾颜色的过渡点。0.5（默认）居中；调大头部颜色占得多。' }],
  ['stroke_width', { name: '粗细', group: '线条', text: '线有多粗，按每列宽度的比例。0.15（默认）。' }],
  ['rounding', { name: '圆头', group: '线条', text: '线条前端有多圆。1（默认）全圆；0 方头。' }],
  ['angle', { name: '方向', group: '运动', text: '往哪个方向落，单位度。90（默认）向下；270 向上；0 向右。' }],
  ['speed_variance', { name: '快慢差异', group: '运动', text: '各列快慢不一的程度。0.3（默认）；0 齐步走。' }],
])
const STUDIO = renamed('StudioBackground', { id: 'shaders.StudioBackground', name: '影棚背景', aliases: ['摄影棚', '无缝背景', '产品背景', 'studio background'], description: '生成柔和打光的影棚无缝背景，墙面与地面圆滑相接，带缓慢漂移的环境光。适合产品、人物、Logo 展示。' }, [
  ['color', { name: '台面颜色', default: MID_GRAY_HEX, text: '墙面与地面本身的颜色。中灰（默认）；深灰是暗调影棚，浅灰是明亮的白棚。' }],
  ['brightness', { name: '环境亮度', text: '整体有多亮。20（默认）；调大更通透。' }],
  ['vignette', { name: '暗角', text: '四周压暗多少。0（默认）。' }],
  ['key_color', { name: '颜色', group: '主光', default: WHITE_HEX, text: '顶部主光的颜色。白色（默认）。' }],
  ['key_intensity', { name: '亮度', group: '主光', text: '主光有多亮。40（默认）。' }],
  ['key_softness', { name: '柔和', group: '主光', text: '主光的光斑有多散。50（默认）。' }],
  ['fill_color', { name: '颜色', group: '辅光', default: WHITE_HEX, text: '两侧辅光的颜色。白色（默认）。' }],
  ['fill_intensity', { name: '亮度', group: '辅光', text: '辅光有多亮。10（默认）。' }],
  ['fill_softness', { name: '柔和', group: '辅光', text: '辅光有多散。70（默认）。' }],
  ['fill_angle', { name: '张开', group: '辅光', text: '两盏辅光离中间多远。70（默认）。' }],
  ['back_color', { name: '颜色', group: '背光', default: WHITE_HEX, text: '墙面向上洗的背光颜色。白色（默认）。' }],
  ['back_intensity', { name: '亮度', group: '背光', text: '背光有多亮。20（默认）。' }],
  ['back_softness', { name: '柔和', group: '背光', text: '背光有多散。80（默认）。' }],
  ['center_x', { name: '台面中心（水平）', group: '布景', text: '光打到地面的位置，按画面宽度的百分比。50（默认）居中。' }],
  ['center_y', { name: '台面中心（垂直）', group: '布景', text: '按画面高度的百分比。80（默认）靠下。' }],
  ['light_target', { name: '光的落点', group: '布景', text: '光更多打在地面还是墙上。100（默认）地面。' }],
  ['wall_curvature', { name: '墙角弧度', group: '布景', text: '墙与地面相接处有多圆。10（默认）。' }],
  ['ambient_intensity', { name: '漂移光', group: '环境光', text: '缓慢漂移的环境光斑有多明显。50（默认）；0 没有。' }],
  ['ambient_speed', { name: '速度', group: '环境光', text: '环境光漂移得多快。2（默认）；0 定住。不能做关键帧。' }],
  ['seed', { name: '随机种子', group: '环境光', text: '换一个数就换一种光斑排布。0（默认）。' }],
])

const WRAPPED = [NOISE, PATTERN, LIGHT, WAVEFORM, RIPPLES, SPIRAL, SWIRL, SINE_WAVE, FALLING_LINES, STUDIO]
/** “生成”文件夹的定义；显示顺序由 `effectCatalog.ts` 决定。 */
export const GENERATOR_EFFECT_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = [GRADIENT_EFFECT_DEFINITION, ...WRAPPED.map(item => item.definition)]
export const WRAPPED_GENERATOR_SHADER_GRAPHS: readonly ShaderGraphWrappedEffect[] = WRAPPED.map(item => item.graph)
/** 封装进“生成”文件夹的组件：由封装登记，不按组件名另列一项（改名的七个沿用原 ID）。 */
export const WRAPPED_GENERATOR_SOURCES: ReadonlySet<string> = new Set(WRAPPED.flatMap(item => item.sources))
