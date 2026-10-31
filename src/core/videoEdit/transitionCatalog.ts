import type { VideoEditBuiltinParam, VideoEditBuiltinParams } from './builtinEffects'
import { VIDEO_EDIT_SOURCE_TRANSITION_KINDS, VIDEO_EDIT_SOURCE_TRANSITION_PARAMS, type VideoEditSourceTransitionKind } from './transitionSources'

type Variant = readonly [mode: string, label: string, source: VideoEditSourceTransitionKind, description: string]
interface TransitionEntry { kind: string; name: string; group: string; variants: readonly Variant[] }
const entry = <K extends string>(kind: K, name: string, group: string, variants: readonly Variant[]): TransitionEntry & { kind: K } => ({ kind, name, group, variants })

/** 目录只声明用户选择；所有方式仍委托已有实现，迁移与播放共用同一份双向参数映射。 */
export const CURATED_TRANSITIONS = [
  entry('flash', '闪光', '叠化', [['white', '白闪', 'flash', '切点附近以闪光颜色覆盖画面，再露出后一段'], ['exposure', '过曝', 'gl.Overexposure', '画面过曝发白，再溶解到后一段']]),
  entry('wipe', '擦除', '擦除', [['wipe', '擦除', 'wipe', '一条直线从选定边或角扫过，线后露出后一段，可设置边框'], ['linear', '线性擦除', 'shaders.LinearWipe', '按角度移动直线边界，线后露出后一段，可反向并调节羽化']]),
  entry('radial_wipe', '径向擦除', '擦除', [['clock', '时钟擦除', 'shaders.RadialWipe', '围绕中心旋转边界，像时钟指针一样擦出后一段']]),
  entry('barn_doors', '对开门', '擦除', [['angle', '对开门', 'shaders.BarnDoors', '两条平行边界沿设定角度向两侧分开，露出后一段'], ['horizontal_in', '水平分开', 'gl.SplitSlideInHorizontal', '后一段分成两半，沿水平相反方向滑入'], ['vertical_in', '垂直分开', 'gl.SplitSlideInVertical', '后一段分成两半，沿垂直相反方向滑入'], ['horizontal_out', '水平合拢', 'gl.SplitSlideOutHorizontal', '前一段分成两半，沿水平相反方向滑出'], ['vertical_out', '垂直合拢', 'gl.SplitSlideOutVertical', '前一段分成两半，沿垂直相反方向滑出']]),
  entry('blinds', '百叶窗', '擦除', [['uniform', '均匀', 'shaders.VenetianBlinds', '平行条带同时展开，露出后一段'], ['random', '随机', 'shaders.RandomBars', '平行条带以不同进度展开，露出后一段'], ['slice', '切片', 'shaders.SliceWipe', '画面分成条片，各条片错开进度擦出后一段']]),
  entry('squares_wipe', '方块擦除', '擦除', [['checker', '棋盘', 'shaders.CheckerWipe', '交错方格按棋盘图案露出后一段'], ['sweep', '扫入', 'gl.SquaresWipe', '方格沿斜向依次长大，露出后一段'], ['cover', '遮盖', 'gl.RectangleCover', '色块从中心长大盖住前一段，再缩小露出后一段'], ['wave', '波浪', 'gl.TilesWave', '后一段按斜向波浪逐块翻出']]),
  entry('shape_wipe', '形状擦除', '形状擦除', [['circle', '圆', 'iris_round', '以圆形边界展开后一段或收拢前一段，可设置边框'], ['reveal', '圆形揭示', 'shaders.IrisWipe', '圆形区域由中心向外扩大，露出后一段，可反向'], ['diamond', '菱形', 'shaders.DiamondWipe', '菱形区域由中心向外扩大，露出后一段，可反向'], ['rectangle', '方形', 'gl.RectangleIris', '前一段缩成小矩形，后一段再从矩形里展开'], ['box', '方框', 'gl.Box', '前一段收进方框（中心或一角），或后一段从方框展开'], ['star', '星形', 'gl.StarWipe', '星形从中心长大，露出后一段'], ['heart', '心形', 'gl.HeartWipe', '心形从中心长大，露出后一段'], ['leaf', '叶形', 'gl.LeafWipe', '叶子形状从中心长大，露出后一段'], ['flower', '花瓣', 'gl.FlowerWipe', '花瓣形状从中心长大，露出后一段'], ['bow', '领结', 'gl.BowTie', '领结形状擦过画面，形状可调、可反向'], ['bow_horizontal', '横向领结', 'gl.BowTieHorizontal', '两个三角从左右两侧长成领结形，露出后一段'], ['bow_vertical', '纵向领结', 'gl.BowTieVertical', '两个三角从上下两侧长成领结形，露出后一段'], ['dots', '圆点', 'gl.PolkaDotsCurtain', '后一段从不断变大的圆点里出现'], ['pinwheel', '风车', 'gl.Pinwheel', '旋转的风车叶片露出后一段']]),
  entry('dissolve', '溶解', '溶解', [['grain', '颗粒', 'shaders.NoiseDissolve', '按噪声分布逐点切换到后一段'], ['blocks', '方块', 'shaders.BlockDissolve', '按方块网格逐块切换到后一段'], ['burn', '灼烧蔓延', 'gl.GlowDissolve', '带发光边缘的区域逐渐扩展，露出后一段'], ['burn_wave', '波边烧穿', 'gl.UndulatingBurnOut', '波浪边缘的圆从中心烧开，露出后一段'], ['noise_reveal', '颗粒显影', 'dissolve_noise', '细碎颗粒均匀散开，逐渐露出后一段，交界处可带亮边和光晕'], ['blocks_reveal', '方块显影', 'dissolve_blocks', '方格按各自的随机顺序逐块露出后一段，交界处可带亮边和光晕'], ['dots', '点阵', 'dissolve_dots', '网格中的圆点各自先后扩大，露出后一段，交界处可带亮边和光晕'], ['halftone', '半调', 'dissolve_halftone', '规则网点逐渐扩大，后一段较亮的位置先显现，交界处可带亮边和光晕']]),
  entry('slide', '滑动', '运动', [['slide', '滑动', 'slide', '后一段从选定一侧滑入，盖住不动的前一段'], ['reveal', '右滑揭开', 'gl.SlideAwayRight', '前一段向右滑走，下面溶解成后一段']]),
  entry('cross_zoom', '缩放过渡', '运动', [['zoom', '推近', 'cross_zoom', '前一段放大、后一段从放大状态收回，中间交叉溶解并带放射拖影'], ['scale_in', '缩放淡入', 'gl.ScaleIn', '后一段从中心放大并淡入'], ['zoom_in', '推近淡出', 'gl.SimpleZoom', '推近前一段，再淡入后一段'], ['zoom_out', '拉远', 'gl.SimpleZoomOut', '后一段从放大状态拉远到原位'], ['circles', '圆环缩放', 'gl.ZoomInCircles', '前一段的同心圆环以不同速度放大，再露出后一段'], ['left', '推近左擦', 'gl.ZoomWipeLeft', '推近前一段，后一段从右向左擦入'], ['right', '推近右擦', 'gl.ZoomWipeRight', '推近前一段，后一段从左向右擦入']]),
  entry('rotate_zoom', '旋转缩放', '运动', [['dreamy', '梦幻旋转缩放', 'gl.DreamyZoom', '旋转放大并提亮，再缩回至后一段'], ['scale', '旋转放大', 'gl.RotateScaleFade', '前一段旋转放大后淡出到后一段'], ['vanish', '旋转消失', 'gl.RotateScaleVanish', '前一段旋转缩小，消失在后一段上'], ['fade', '旋转溶解', 'gl.RotateFade', '两段画面绕中心旋转并交叉溶解']]),
  entry('gl.Cube', '立方体旋转', '三维', [['cube', '立方体旋转', 'gl.Cube', '两段画面是旋转立方体的两个面，带地面倒影']]),
  entry('gl.SimpleFlip', '翻转', '三维', [['flip', '翻转', 'gl.SimpleFlip', '前一段绕竖轴翻转成后一段']]),
  entry('gl.Doorway', '开门', '三维', [['door', '开门', 'gl.Doorway', '前一段像双开门打开，后一段向前推进，带倒影']]),
  entry('glitch', '故障', '故障', [['bands', '条带', 'gl.GlitchBands', '带横向故障条纹与偏色的交叉溶解'], ['displace', '错位', 'gl.GlitchDisplace', '画面成块错位，闪到后一段'], ['flicker', '闪烁', 'gl.GlitchFlicker', '带颜色错位、残影和扫描线的闪烁故障'], ['memories', '记忆', 'gl.GlitchMemories', '带偏色故障方块的交叉溶解'], ['melt', '熔化', 'gl.DoomMelt', '前一段分成竖条，各竖条错开进度向下落出画面'], ['color', '色彩推挤', 'gl.ColorCoords', '一段画面的颜色推挤另一段，边推边溶解'], ['channels', '分通道', 'gl.ColorPhase', '红、绿、蓝通道先后切换的交叉溶解']]),
  entry('swirl', '旋涡', '扭曲', [['revolve', '旋涡卷入', 'gl.Revolve', '前一段带动态模糊旋转放大，卷入后一段'], ['swirl', '漩涡溶解', 'gl.Swirl', '两段画面绕中心卷动并交叉溶解'], ['cross', '交叉扭曲', 'gl.CrossWarp', '前一段放大、后一段缩回原位，从右向左扫过']]),
  entry('ripple', '波纹', '扭曲', [['wipe', '涟漪擦除', 'shaders.RippleWipe', '扩散的波纹边界擦出后一段'], ['dissolve', '涟漪溶解', 'gl.Ripple', '从中心扩散的涟漪里交叉溶解'], ['dreamy', '梦幻波动', 'gl.Dreamy', '带波浪扭曲的交叉溶解'], ['drop', '水滴', 'gl.WaterDrop', '在从中心扩散的环形波纹中溶解到后一段'], ['butterfly', '蝶翼波纹', 'gl.ButterflyWaveScrawler', '对画面做波纹位移与色彩分离，并交叉溶解到后一段']]),
  entry('luma_dissolve', '亮度溶解', '光', [['grayscale', '黑白溶解', 'gl.FadeGrayscale', '经过黑白画面的交叉溶解'], ['color', '按颜色切换', 'gl.ColorDistance', '颜色越接近的地方越先切到后一段']]),
] as const

export const REMOVED_VIDEO_EDIT_TRANSITIONS = ['gl.Bounce', 'gl.Rolls', 'gl.BookFlip', 'gl.StereoViewer', 'gl.Swap', 'gl.LeftRight', 'gl.TopBottom', 'gl.Squeeze', 'gl.Fold', 'shaders.PagePeel'] as const
export const isRemovedVideoEditTransition = (kind: string): boolean => (REMOVED_VIDEO_EDIT_TRANSITIONS as readonly string[]).includes(kind)
export const MORE_VIDEO_EDIT_TRANSITIONS = ['gl.DirectionalWarp', 'gl.Hexagonalize', 'gl.FlyEye', 'gl.LissajousTiles', 'gl.Morph', 'gl.Kaleidoscope', 'gl.PowerKaleido', 'gl.ColorWrap', 'gl.HsvFade', 'gl.MultiplyBlend', 'gl.EdgeGlow', 'gl.DirectionalScaled', 'gl.SplitSlideInOutHorizontal', 'gl.SplitSlideInOutVertical'] as const

interface VariantBinding { entry: TransitionEntry; variant: Variant; keys: ReadonlyMap<string, string> }
// 持久参数键只由此表决定；说明、来源参数顺序与供应商元数据不得改变已存键。新增方式在目录末尾追加并登记全部键。
export const CURATED_TRANSITION_PARAMETER_KEYS: Readonly<Partial<Record<VideoEditSourceTransitionKind, Readonly<Record<string, string>>>>> = {
  'flash': {color: 'color',intensity: 'intensity'},
  'gl.Overexposure': {strength: 'strength'},
  'wipe': {direction: 'direction',feather: 'feather',border: 'border',border_color: 'border_color'},
  'shaders.LinearWipe': {angle: 'angle',feather: 'linear_feather',invert: 'invert'},
  'shaders.RadialWipe': {start_angle: 'start_angle',direction: 'direction',center_x: 'center_x',center_y: 'center_y',feather: 'feather',invert: 'invert'},
  'shaders.BarnDoors': {angle: 'angle',feather: 'feather',invert: 'invert'},
  'gl.SplitSlideInHorizontal': {reverse: 'reverse'},
  'gl.SplitSlideInVertical': {reverse: 'reverse'},
  'gl.SplitSlideOutHorizontal': {reverse: 'reverse'},
  'gl.SplitSlideOutVertical': {reverse: 'reverse'},
  'shaders.VenetianBlinds': {angle: 'angle',strip_count: 'strip_count',feather: 'feather',invert: 'invert'},
  'shaders.RandomBars': {angle: 'random_angle',bar_count: 'bar_count',softness: 'softness',invert: 'random_invert'},
  'shaders.SliceWipe': {angle: 'slice_angle',slice_count: 'slice_count'},
  'shaders.CheckerWipe': {block_size: 'block_size',softness: 'softness',invert: 'invert'},
  'gl.SquaresWipe': {squares_x: 'squares_x',squares_y: 'squares_y',direction_x: 'direction_x',direction_y: 'direction_y',smoothness: 'smoothness'},
  'gl.RectangleCover': {bgcolor: 'bgcolor'},
  'gl.TilesWave': {tile_count_x: 'tile_count_x',tile_count_y: 'tile_count_y',flip_x: 'flip_x',flip_y: 'flip_y'},
  'iris_round': {mode: 'operation',center_x: 'center_x',center_y: 'center_y',feather: 'feather',border: 'border',border_color: 'border_color'},
  'shaders.IrisWipe': {center_x: 'reveal_center_x',center_y: 'reveal_center_y',feather: 'reveal_feather',invert: 'invert'},
  'shaders.DiamondWipe': {size: 'size',feather: 'diamond_feather',invert: 'diamond_invert'},
  'gl.RectangleIris': {bgcolor: 'bgcolor'},
  'gl.Box': {rect_in: 'rect_in',location: 'location'},
  'gl.StarWipe': {border_thickness: 'border_thickness',star_rotation: 'star_rotation',border_color: 'star_border_color',star_center_x: 'star_center_x',star_center_y: 'star_center_y'},
  'gl.HeartWipe': {},
  'gl.LeafWipe': {},
  'gl.FlowerWipe': {segments: 'segments'},
  'gl.BowTie': {adjust: 'adjust',reverse: 'reverse'},
  'gl.BowTieHorizontal': {},
  'gl.BowTieVertical': {},
  'gl.PolkaDotsCurtain': {dots: 'dots',center_x: 'dots_center_x',center_y: 'dots_center_y'},
  'gl.Pinwheel': {speed: 'speed'},
  'shaders.NoiseDissolve': {scale: 'scale',softness: 'softness',seed: 'seed',invert: 'invert'},
  'shaders.BlockDissolve': {block_size: 'block_size',softness: 'blocks_softness',invert: 'blocks_invert'},
  'gl.GlowDissolve': {u_line_width: 'u_line_width',u_spread_clr: 'u_spread_clr',u_hot_clr: 'u_hot_clr',u_pow: 'u_pow',u_intensity: 'u_intensity'},
  'gl.UndulatingBurnOut': {smoothness: 'smoothness',center_x: 'center_x',center_y: 'center_y',color: 'color'},
  'slide': {direction: 'direction',smooth: 'smooth'},
  'gl.SlideAwayRight': {},
  'cross_zoom': {zoom: 'zoom',blur: 'blur',center_x: 'center_x',center_y: 'center_y'},
  'gl.ScaleIn': {},
  'gl.SimpleZoom': {zoom_quickness: 'zoom_quickness'},
  'gl.SimpleZoomOut': {zoom_quickness: 'zoom_out_zoom_quickness',fade: 'fade'},
  'gl.ZoomInCircles': {},
  'gl.ZoomWipeLeft': {zoom_quickness: 'left_zoom_quickness'},
  'gl.ZoomWipeRight': {zoom_quickness: 'left_zoom_quickness'},
  'gl.DreamyZoom': {rotation: 'rotation',scale: 'scale'},
  'gl.RotateScaleFade': {center_x: 'center_x',center_y: 'center_y',rotations: 'rotations',scale: 'scale_scale',back_color: 'back_color'},
  'gl.RotateScaleVanish': {fade_in_second: 'fade_in_second',reverse_effect: 'reverse_effect',reverse_rotation: 'reverse_rotation'},
  'gl.RotateFade': {},
  'gl.Cube': {persp: 'persp',unzoom: 'unzoom',reflection: 'reflection',floating: 'floating'},
  'gl.SimpleFlip': {},
  'gl.Doorway': {reflection: 'reflection',perspective: 'perspective',depth: 'depth'},
  'gl.GlitchBands': {ampx: 'ampx',ampy: 'ampy'},
  'gl.GlitchDisplace': {},
  'gl.GlitchFlicker': {frame_rate: 'frame_rate',rgb_offset: 'rgb_offset',block_amount: 'block_amount',ghost_amount: 'ghost_amount',red_cyan: 'red_cyan',scanline: 'scanline'},
  'gl.GlitchMemories': {},
  'gl.DoomMelt': {bars: 'bars',amplitude: 'amplitude',noise: 'noise',frequency: 'frequency',drip_scale: 'drip_scale'},
  'gl.ColorCoords': {},
  'gl.ColorPhase': {from_step_r: 'from_step_r',from_step_g: 'from_step_g',from_step_b: 'from_step_b',from_step_a: 'from_step_a',to_step_r: 'to_step_r',to_step_g: 'to_step_g',to_step_b: 'to_step_b',to_step_a: 'to_step_a'},
  'gl.Revolve': {center_x: 'center_x',center_y: 'center_y',direction: 'direction',max_rotation: 'max_rotation',peak_zoom: 'peak_zoom',swirl: 'swirl',barrel: 'barrel',motion_blur: 'motion_blur',switch_start: 'switch_start',switch_end: 'switch_end',shadow: 'shadow'},
  'gl.Swirl': {},
  'gl.CrossWarp': {},
  'shaders.RippleWipe': {center_x: 'center_x',center_y: 'center_y',rings: 'rings',feather: 'feather',invert: 'invert'},
  'gl.Ripple': {amplitude: 'amplitude',speed: 'speed'},
  'gl.Dreamy': {},
  'gl.WaterDrop': {amplitude: 'drop_amplitude',speed: 'drop_speed'},
  'gl.ButterflyWaveScrawler': {amplitude: 'butterfly_amplitude',waves: 'waves',color_separation: 'color_separation'},
  'gl.FadeGrayscale': {intensity: 'intensity'},
  'gl.ColorDistance': {power: 'power'},
  'dissolve_noise': {size: 'reveal_size',seed: 'reveal_seed',softness: 'reveal_softness',edge_width: 'reveal_edge_width',edge_color: 'reveal_edge_color',glow_strength: 'reveal_glow_strength',glow_radius: 'reveal_glow_radius'},
  'dissolve_blocks': {size: 'reveal_size',seed: 'reveal_seed',softness: 'reveal_softness',edge_width: 'reveal_edge_width',edge_color: 'reveal_edge_color',glow_strength: 'reveal_glow_strength',glow_radius: 'reveal_glow_radius'},
  'dissolve_dots': {size: 'reveal_size',seed: 'reveal_seed',softness: 'reveal_softness',edge_width: 'reveal_edge_width',edge_color: 'reveal_edge_color',glow_strength: 'reveal_glow_strength',glow_radius: 'reveal_glow_radius'},
  'dissolve_halftone': {size: 'reveal_size',seed: 'reveal_seed',softness: 'reveal_softness',edge_width: 'reveal_edge_width',edge_color: 'reveal_edge_color',glow_strength: 'reveal_glow_strength',glow_radius: 'reveal_glow_radius'},
}
const BY_SOURCE = new Map<string, VariantBinding>()
const BY_KIND = new Map<string, TransitionEntry>(CURATED_TRANSITIONS.map(value => [value.kind, value]))
export const CURATED_TRANSITION_PARAMS = new Map<string, readonly VideoEditBuiltinParam[]>()
for (const definition of CURATED_TRANSITIONS) {
  const params: VideoEditBuiltinParam[] = []
  const merged = definition.variants.length > 1
  const explanation = definition.variants.map(([value, label, , description]) => `${value}（${label}）：${description}。`).join('')
  if (merged) params.push({ key: 'mode', name: '方式', type: 'enum', default: definition.variants[0][0], options: definition.variants.map(([value, label]) => ({ value, label })), animatable: false, tooltip: explanation, description: explanation })
  for (const variant of definition.variants) {
    const [mode, , source] = variant
    const keys = new Map<string, string>()
    for (const original of VIDEO_EDIT_SOURCE_TRANSITION_PARAMS[source]) {
      const target = CURATED_TRANSITION_PARAMETER_KEYS[source]?.[original.key]
      if (!target) throw new Error(`过渡 ${source} 的参数 ${original.key} 尚未登记持久键。`)
      const compatible = params.find(param => param.key === target)
      keys.set(original.key, target)
      if (compatible) {
        if (compatible.visibleWhen && 'in' in compatible.visibleWhen) compatible.visibleWhen.in?.push(mode)
      } else params.push({ ...original, key: target, ...(merged ? { visibleWhen: { param: 'mode', in: [mode] } } : {}) })
    }
    BY_SOURCE.set(source, { entry: definition, variant, keys })
  }
  CURATED_TRANSITION_PARAMS.set(definition.kind, params)
}

/** 先求值目录参数及其动画，再仅把当前方式需要的键交给渲染实现。 */
export function resolveVideoEditTransitionSource(kind: string, params: Readonly<VideoEditBuiltinParams>): { kind: VideoEditSourceTransitionKind; params: VideoEditBuiltinParams } | undefined {
  const definition = BY_KIND.get(kind)
  if (!definition) return (VIDEO_EDIT_SOURCE_TRANSITION_KINDS as readonly string[]).includes(kind) && !isRemovedVideoEditTransition(kind) ? { kind: kind as VideoEditSourceTransitionKind, params: { ...params } } : undefined
  const variant = definition.variants.find(([mode]) => mode === params.mode) ?? definition.variants[0]
  const binding = BY_SOURCE.get(variant[2])!
  return { kind: variant[2], params: Object.fromEntries(VIDEO_EDIT_SOURCE_TRANSITION_PARAMS[variant[2]].map(param => [param.key, params[binding.keys.get(param.key)!] ?? param.default])) }
}

export function videoEditTransitionBinding(kind: string): VariantBinding | undefined { return BY_SOURCE.get(kind) }
