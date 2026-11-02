import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinGroup } from './builtinEffects'

/** 顺序与分组的唯一目录；新效果按设计目录插入对应组，两个导出索引仍只负责登记。 */
export const VIDEO_EDIT_EFFECT_CATALOG: readonly { readonly group: VideoEditBuiltinGroup; readonly ids: readonly string[] }[] = [
  { group: 'blur', ids: ['blur', 'sharpen'] },
  { group: 'color', ids: ['color_grade', 'black_white', 'invert', 'gradient_map', 'posterize', 'film_look'] },
  { group: 'light', ids: ['glow', 'light_sweep', 'lens_flare', 'light_leak'] },
  { group: 'outline', ids: ['drop_shadow', 'stroke'] },
  { group: 'lens', ids: ['vignette', 'chromatic_aberration'] },
  { group: 'texture', ids: ['film_grain', 'halftone', 'dither_pattern', 'paper', 'scratches', 'retro_screen'] },
  { group: 'stylize', ids: ['mosaic', 'glitch', 'dissolve_reveal'] },
  { group: 'distort', ids: ['mirror', 'repeat', 'bulge', 'twirl', 'wave', 'corner_pin', 'displace'] },
  { group: 'frame', ids: ['crop', 'flip'] },
  { group: 'keying', ids: ['chroma_key', 'subject_key'] },
  { group: 'recording', ids: ['recording_cursor', 'recording_zoom', 'recording_frame'] },
  { group: 'generator', ids: ['gradient', 'noise', 'pattern', 'light_background', 'shaders.Waveform', 'shaders.Ripples', 'shaders.Spiral', 'shaders.Swirl', 'shaders.SineWave', 'shaders.FallingLines', 'shaders.StudioBackground'] },
  { group: 'art', ids: ['shaders.Watercolor', 'shaders.Engraving', 'shaders.Chalkboard', 'shaders.ContourLines', 'shaders.Wool', 'shaders.Stone'] },
  { group: 'glass_material', ids: ['shaders.FlutedGlass', 'shaders.GlassTiles', 'shaders.BrushedMetal', 'shaders.CarbonFiber', 'shaders.Chrome', 'shaders.Crystal', 'shaders.Emboss', 'shaders.Frost', 'shaders.Glass', 'shaders.Goo', 'shaders.Heatmap', 'shaders.Hologram', 'shaders.Holographic', 'shaders.LightEdge', 'shaders.LiquidMetal', 'shaders.Nebula', 'shaders.Neon', 'shaders.Obsidian', 'shaders.Plastic', 'shaders.ThinFilm', 'shaders.Voxels', 'shaders.Water'] },
  { group: 'rare_distort_light', ids: ['shaders.Kaleidoscope', 'shaders.PolarCoordinates', 'shaders.RectangularCoordinates', 'shaders.Bend', 'shaders.Stretch', 'shaders.LensDistortion', 'shaders.Form3D', 'shaders.Sparkle', 'shaders.ReflectivePlane', 'shaders.Perspective'] },
  { group: 'other', ids: ['shaders.Marble'] },
  { group: 'audio_level', ids: ['gain_balance', 'stereo_width'] },
  { group: 'audio_dynamics', ids: ['compressor', 'limiter', 'speech_leveler', 'noise_gate', 'de_esser'] },
  { group: 'audio_delay', ids: ['delay_echo'] },
  { group: 'audio_eq', ids: ['equalizer', 'audio_filter'] },
  { group: 'audio_modulation', ids: ['modulation'] },
  { group: 'audio_repair', ids: ['noise_reduction', 'dehum'] },
  { group: 'audio_space', ids: ['reverb'] },
  { group: 'audio_special', ids: ['distortion', 'vocal_enhancer'] },
  { group: 'audio_pitch', ids: ['pitch_shift'] },
]

/** 这几组进“更多”文件夹（默认折叠）：少用、原样保留的着色器组件。 */
const MORE_GROUPS: ReadonlySet<VideoEditBuiltinGroup> = new Set(['art', 'glass_material', 'rare_distort_light', 'other'])

/** 严格全覆盖：漏排、重复排和失效的 ID 都在装配时指出，不能悄悄退回导出名排序。 */
export function orderVideoEditEffects(definitions: ReadonlyMap<string, VideoEditBuiltinEffectDefinition>): readonly VideoEditBuiltinEffectDefinition[] {
  const ordered: VideoEditBuiltinEffectDefinition[] = [], seen = new Set<string>()
  for (const { group, ids } of VIDEO_EDIT_EFFECT_CATALOG) for (const id of ids) {
    if (seen.has(id)) throw new Error(`效果目录重复 ID：${id}。`)
    const definition = definitions.get(id)
    if (!definition) throw new Error(`效果目录的 ${id} 尚未登记。`)
    // 目录没改分组与分类的条目保持原对象：按 ID 取到的登记与模块导出的定义是同一个。
    const more = MORE_GROUPS.has(group)
    seen.add(id); ordered.push(definition.group === group && (!more || definition.category === 'more') ? definition : { ...definition, group, ...(more ? { category: 'more' as const } : {}) })
  }
  const missing = [...definitions.keys()].filter(id => !seen.has(id))
  if (missing.length) throw new Error(`效果目录缺少：${missing.join('、')}。`)
  return ordered
}
