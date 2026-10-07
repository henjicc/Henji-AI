import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam, VideoEditBuiltinUnit } from '../builtinEffects'
import { BLACK_HEX, THEME_SEED_ACCENT_HEX, WHITE_HEX } from '../../theme/colorTokens'

/** Trusted, closed catalog. Source and WGSL never come from a project or code author. */
export const SHADER_LIBRARY_SOURCE = { repository: 'https://github.com/shader-effects-inc/shaders', revision: 'dbfd42abe341e7a6ea0b8ea1f5bab018b8e8439a', license: 'MIT', copyright: '2026 Shader Effects Inc.' } as const

export function shaderNumber(key: string, name: string, min: number, max: number, value: number, unit: VideoEditBuiltinUnit, description: string, step = 1): Extract<VideoEditBuiltinParam, { type: 'number' }> {
  return { key, name, type: 'number', min, max, default: value, unit, step, description, tooltip: description, animatable: true }
}
const strength = shaderNumber('strength', '强度', 0, 100, 100, 'strength', '0 完全恢复输入；100 完整效果。背景生成时会替换原画面，可降低强度与输入混合。')
const scale = shaderNumber('scale', '图案密度', 1, 100, 30, 'strength', '数值越大图案越密、细节越小；空间尺度相对画面高度，预览与导出一致。')
const speed = shaderNumber('speed', '流动速度', -4, 4, 1, 'multiplier', '以剪辑序列秒时间求值；1 正常速度，0 静止，负值反向。不累积历史帧。', .1)
const direction = shaderNumber('direction', '方向', -180, 180, 0, 'degrees', '0 水平向右，90 垂直向下；角度相对画面坐标。')
const seed = shaderNumber('seed', '图案种子', 0, 10000, 42, 'strength', '同一种子、时间和参数得到同一图案；更换数值重新分布纹理，不改变时间线。')
const colors: readonly Extract<VideoEditBuiltinParam, { type: 'color' }>[] = [
  { key: 'color_a', name: '起始颜色', type: 'color', default: THEME_SEED_ACCENT_HEX.violet, description: '图案暗部或渐变起点颜色，按线性光插值。', tooltip: '图案暗部或渐变起点颜色', animatable: true },
  { key: 'color_b', name: '终止颜色', type: 'color', default: THEME_SEED_ACCENT_HEX.teal, description: '图案亮部或渐变终点颜色，按线性光插值。', tooltip: '图案亮部或渐变终点颜色', animatable: true },
]
export const SHADER_BACKGROUND_NAMES = [
  'shader_linear_gradient', 'shader_radial_gradient', 'shader_conic_gradient', 'shader_diamond_gradient', 'shader_mesh_gradient', 'shader_flowing_gradient',
  'shader_aurora', 'shader_perlin_noise', 'shader_fractal_noise', 'shader_plasma', 'shader_marble', 'shader_worley_noise',
  'shader_grid', 'shader_dot_grid', 'shader_checkerboard', 'shader_stripes', 'shader_beam', 'shader_sparkle',
] as const
export const SHADER_FILTER_NAMES = [
  'shader_chromatic', 'shader_scanlines', 'shader_vhs', 'shader_halftone', 'shader_pixelate', 'shader_ascii', 'shader_glass', 'shader_glass_tiles',
  'shader_twirl', 'shader_wave', 'shader_vignette', 'shader_grain', 'shader_zoom_blur', 'shader_linear_blur', 'shader_glow_pro', 'shader_kaleidoscope',
] as const
export type ShaderEffectName = typeof SHADER_BACKGROUND_NAMES[number] | typeof SHADER_FILTER_NAMES[number]
export const SHADER_TRANSITION_NAMES = ['shader_noise_dissolve', 'shader_block_dissolve', 'shader_diamond_wipe', 'shader_linear_wipe', 'shader_light_leak', 'shader_ripple_wipe'] as const
export type ShaderTransitionName = typeof SHADER_TRANSITION_NAMES[number]
export interface ShaderLibraryDefinition extends VideoEditBuiltinEffectDefinition {
  id: ShaderEffectName
  role: 'background' | 'filter'
  sourceEffect: string
  /** Cover is rendered through the same name/params/time API at thumbnail size. */
  cover: { kind: 'render'; timeSeconds: number }
}
type Background = readonly [typeof SHADER_BACKGROUND_NAMES[number], string, string, string, boolean]
const backgrounds: readonly Background[] = [
  ['shader_linear_gradient', '线性渐变', 'LinearGradient', '沿指定方向从起始色过渡到终止色；用于标题底板、品牌背景。密度控制渐变宽度。', false],
  ['shader_radial_gradient', '径向渐变', 'RadialGradient', '从画面中心向四周渐变；用于聚焦主体、柔和底板。密度控制亮区半径。', false],
  ['shader_conic_gradient', '角向渐变', 'ConicGradient', '颜色围绕画面中心旋转成色环；用于抽象背景，方向旋转色环起点。', false],
  ['shader_diamond_gradient', '菱形渐变', 'DiamondGradient', '按到中心的菱形距离渐变；用于几何、科技背景。', false],
  ['shader_mesh_gradient', '网格渐变', 'MeshGradient', '四角色域叠加柔和波动的网格渐变；用于柔和海报底图。', true],
  ['shader_flowing_gradient', '流动渐变', 'FlowingGradient', '低频噪声驱动色带流动；用于动态标题和舒缓背景。', true],
  ['shader_aurora', '极光', 'Aurora', '四层发光帘幕与垂直光带缓慢流动；用于梦幻、夜空背景。', true],
  ['shader_perlin_noise', '柏林噪声', 'PerlinNoise', '平滑梯度噪声在两色之间变化；用于云状纹理与动感底图。', true],
  ['shader_fractal_noise', '分形噪声', 'FractalNoise', '五个频段叠加平滑噪声；用于云雾、石质和颗粒纹理。', true],
  ['shader_plasma', '等离子波纹', 'Plasma', '正弦波与径向波交织为流动色团；用于复古、音乐背景。', true],
  ['shader_marble', '大理石纹', 'Marble', '分形噪声扰动条纹形成大理石脉络；用于材质底板。', true],
  ['shader_worley_noise', '细胞纹理', 'WorleyNoise', '按最近随机点的距离生成细胞状纹理；用于有机、液态背景。', true],
  ['shader_grid', '线框网格', 'Grid', '等间距线框；用于坐标、设计稿、科技背景，可旋转。', false],
  ['shader_dot_grid', '点阵网格', 'DotGrid', '等间距圆点；用于印刷、科技、简洁背景，可旋转。', false],
  ['shader_checkerboard', '棋盘格', 'Checkerboard', '两色棋盘图案；用于几何背景和透明度检查，可旋转。', false],
  ['shader_stripes', '条纹', 'Stripes', '两色平行条纹，可旋转并按时间流动；用于节奏背景。', true],
  ['shader_beam', '光束', 'Beam', '多条柔和放射光束从中心展开；用于聚光、神圣光与标题背景。', true],
  ['shader_sparkle', '闪烁星场', 'Sparkle', '固定种子的星点随时间明暗起伏；随机寻帧时位置固定，无粒子模拟历史。', true],
]
function backgroundParams(id: typeof SHADER_BACKGROUND_NAMES[number], animated: boolean): readonly VideoEditBuiltinParam[] {
  const hasNoise = ['shader_flowing_gradient', 'shader_aurora', 'shader_perlin_noise', 'shader_fractal_noise', 'shader_marble', 'shader_worley_noise', 'shader_sparkle'].includes(id)
  const hasScale = !['shader_conic_gradient', 'shader_mesh_gradient'].includes(id)
  const hasDirection = id !== 'shader_mesh_gradient'
  const gradient = ['shader_linear_gradient', 'shader_radial_gradient', 'shader_diamond_gradient'].includes(id)
  const lights = ['shader_aurora', 'shader_beam', 'shader_sparkle'].includes(id)
  return [strength, ...(hasScale ? [{ ...scale, default: gradient ? 1 : scale.default }] : []), ...(hasDirection ? [direction] : []), ...(hasNoise ? [seed] : []), ...colors.map(param => param.key === 'color_a' && lights ? { ...param, default: BLACK_HEX } : param), ...(animated ? [speed] : [])]
}
type Filter = readonly [ShaderEffectName, string, string, string, readonly VideoEditBuiltinParam[]]
const filters: readonly Filter[] = [
  ['shader_chromatic', '镜头色差', 'ChromaticAberration', '红蓝通道沿方向分离，偏移最大为画面高度的 2%。', [direction]],
  ['shader_scanlines', '扫描线', 'CRTScreen', '叠加水平暗线，模拟老式屏幕；密度控制线数。', [scale]],
  ['shader_vhs', '录像带', 'VHS', '确定性横向抖动、色差与扫描线；用于旧录像、故障风。', [scale, speed, seed]],
  ['shader_halftone', '印刷半调', 'Halftone', '按原画亮度改变印刷网点大小；密度控制网点数量，方向旋转网版。', [scale, direction]],
  ['shader_pixelate', '像素化', 'Pixelate', '把原画简化为像素块；密度越高像素块越细。', [scale]],
  ['shader_ascii', '字符画', 'Ascii', '按网格单元亮度选择程序化字符笔画，保留原色；不加载字体或依赖 DOM。', [scale]],
  ['shader_glass', '条纹玻璃', 'FlutedGlass', '正弦凹槽折射原画；方向控制凹槽方向，密度控制凹槽数。', [scale, direction]],
  ['shader_glass_tiles', '玻璃砖', 'GlassTiles', '每块玻璃内做圆弧折射；密度控制玻璃砖数量。', [scale]],
  ['shader_twirl', '中心旋涡', 'Twirl', '围绕中心按距离扭转取样；用于旋涡、梦境。正角度顺时针，负角度反向。', [shaderNumber('direction', '扭转角度', -180, 180, 90, 'degrees', '最大扭转幅度随到中心的距离增加；0 不扭转，正值顺时针，负值反向。')]],
  ['shader_wave', '波浪扭曲', 'WaveDistortion', '沿方向做随时间移动的正弦波折射；用于水面、热浪。', [scale, direction, speed]],
  ['shader_vignette', '电影暗角', 'Vignette', '柔和压暗四角聚焦中央；强度控制暗角深度，保持透明度。', []],
  ['shader_grain', '胶片噪点', 'FilmGrain', '随剪辑时间更新的单色颗粒；图案密度越大颗粒越细，种子固定。', [scale, speed, seed]],
  ['shader_zoom_blur', '径向拖影', 'ZoomBlur', '从中心向外放射的拖影，复用现有双工序缩放模糊。', []],
  ['shader_linear_blur', '方向拖影', 'LinearBlur', '沿方向拖影，复用现有双工序方向模糊。', [direction]],
  ['shader_glow_pro', '辉光PRO', 'Glow', '复用图片编辑辉光PRO配方：线性光亮通提取、多尺度散射和高光肩部；保留透明度。', [
    shaderNumber('range', '光晕范围', 0, 100, 50, 'strength', '0 紧贴光源，100 广阔光晕；按画面长边比例分配散射层。'),
    shaderNumber('threshold', '高光门槛', 0, 100, 50, 'strength', '越大只有更亮的光源发光；使用图片编辑同一 EV 亮通配方。'),
    shaderNumber('exposure', '光晕亮度', 0, 100, 58, 'strength', '光晕亮度；58 对应图片编辑默认。'),
    shaderNumber('rolloff', '高光过渡', 0, 100, 62, 'strength', '数值越大高光压缩越柔和，减少硬裁切死白。'),
    shaderNumber('core_white', '光核白热', 0, 100, 55, 'strength', '数值越大彩色光源核心越偏白，模拟过曝。'),
  ]],
  ['shader_kaleidoscope', '万花筒', 'Kaleidoscope', '按扇区镜像折叠原画；密度控制扇区数量，方向旋转中心。', [scale, direction]],
]
export const SHADER_EFFECT_DEFINITIONS: readonly ShaderLibraryDefinition[] = [
  ...backgrounds.map(([id, name, sourceEffect, description, animated]): ShaderLibraryDefinition => ({ id, name, role: 'background', group: 'shader_background', sourceEffect, description: `${description}生成整幅背景并替换输入；在图形片段上使用即可成为时间线背景。强度 0 恢复输入。`, tooltip: description, cover: { kind: 'render', timeSeconds: 1 }, params: backgroundParams(id, animated) })),
  ...filters.map(([id, name, sourceEffect, description, params]): ShaderLibraryDefinition => ({ id, name, role: 'filter', group: id === 'shader_glow_pro' ? 'shader_light' : 'shader_filter', sourceEffect, description: `${description}强度 0 完全恢复输入。`, tooltip: description, cover: { kind: 'render', timeSeconds: 1 }, params: [{ ...strength, default: 40 }, ...params] })),
]
export const SHADER_TRANSITION_DEFINITIONS = [
  { kind: 'shader_noise_dissolve', name: '噪声溶解', sourceEffect: 'NoiseDissolve', description: '稳定分形噪声逐渐露出后一段，适合有机、柔和切换。' },
  { kind: 'shader_block_dissolve', name: '像素溶解', sourceEffect: 'BlockDissolve', description: '固定种子的方块按随机顺序露出后一段，适合像素、科技切换。' },
  { kind: 'shader_diamond_wipe', name: '菱形擦除', sourceEffect: 'DiamondWipe', description: '从中心展开菱形，露出后一段，适合几何切换。' },
  { kind: 'shader_linear_wipe', name: '斜向柔擦', sourceEffect: 'LinearWipe', description: '按方向用柔边擦入后一段，适合清爽的段落切换。' },
  { kind: 'shader_light_leak', name: '漏光转场', sourceEffect: 'LightLeak', description: '暖色光带掠过画面时溶入后一段，适合胶片、日光风格。' },
  { kind: 'shader_ripple_wipe', name: '液态波纹', sourceEffect: 'RippleWipe', description: '波纹折射原画并从中心换成后一段，适合水面、梦境切换。' },
] as const
export const SHADER_TRANSITION_PARAMS: readonly VideoEditBuiltinParam[] = [
  { ...strength, default: 70, description: '装饰、折射或图案的程度；0 退化为普通交叉溶解，仍然完成前后片段切换。' },
  scale, direction, seed,
  shaderNumber('feather', '羽化', 0, 100, 15, 'strength', '交界柔和程度；0 硬边，100 宽柔边。'),
]
/** Transitions have no parameter curves; only clip effect parameters support keyframes. */
function transitionParams(keys: readonly string[]): readonly VideoEditBuiltinParam[] { return SHADER_TRANSITION_PARAMS.filter(param => keys.includes(param.key)).map(param => ({ ...param, animatable: false })) }
export const SHADER_TRANSITION_PARAM_DEFINITIONS: Readonly<Record<ShaderTransitionName, readonly VideoEditBuiltinParam[]>> = {
  shader_noise_dissolve: transitionParams(['strength', 'scale', 'seed', 'feather']),
  shader_block_dissolve: transitionParams(['strength', 'scale', 'seed', 'feather']),
  shader_diamond_wipe: transitionParams(['strength', 'feather']),
  shader_linear_wipe: transitionParams(['strength', 'direction', 'feather']),
  shader_light_leak: transitionParams(['strength', 'scale', 'direction']),
  shader_ripple_wipe: transitionParams(['strength', 'scale', 'feather']),
}
export function shaderEffectDefinition(name: string): ShaderLibraryDefinition | undefined { return SHADER_EFFECT_DEFINITIONS.find(definition => definition.id === name) }
export function isShaderTransition(name: string): name is ShaderTransitionName { return (SHADER_TRANSITION_NAMES as readonly string[]).includes(name) }
/** Default neutral thumbnail input; real covers use the exact production render interface. */
export const SHADER_COVER_COLORS = { dark: BLACK_HEX, light: WHITE_HEX } as const
