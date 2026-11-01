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
  { group: 'shader_texture', ids: ['shaders.Marble', 'shaders.Scratches'] },
  { group: 'shader_material', ids: ['shaders.BrushedMetal', 'shaders.CarbonFiber', 'shaders.Chrome', 'shaders.Crystal', 'shaders.Emboss', 'shaders.Frost', 'shaders.Glass', 'shaders.Goo', 'shaders.Heatmap', 'shaders.Hologram', 'shaders.Holographic', 'shaders.LightEdge', 'shaders.LiquidMetal', 'shaders.Nebula', 'shaders.Neon', 'shaders.Obsidian', 'shaders.Plastic', 'shaders.ThinFilm', 'shaders.Voxels', 'shaders.Water'] },
  { group: 'shader_blur', ids: ['shaders.AngularBlur', 'shaders.ChannelBlur', 'shaders.DiffuseBlur', 'shaders.ProgressiveBlur', 'shaders.TiltShift'] },
  { group: 'shader_distort', ids: ['shaders.BarShift', 'shaders.Bend', 'shaders.Bulge', 'shaders.ConcentricSpin', 'shaders.CornerPin', 'shaders.DisplacementMap', 'shaders.FlowField', 'shaders.FlutedGlass', 'shaders.Form3D', 'shaders.GlassTiles', 'shaders.Kaleidoscope', 'shaders.Mirror', 'shaders.Perspective', 'shaders.PolarCoordinates', 'shaders.RectangularCoordinates', 'shaders.Repeater', 'shaders.Spherize', 'shaders.Stretch', 'shaders.Twirl', 'shaders.WaveDistortion'] },
  { group: 'shader_adjust', ids: ['shaders.Duotone', 'shaders.FilmStock', 'shaders.Posterize', 'shaders.Solarize', 'shaders.Tritone'] },
  { group: 'shader_stylize', ids: ['shaders.Chalkboard', 'shaders.ChromaticAberration', 'shaders.CompressionArtifacts', 'shaders.ContourLines', 'shaders.CRTScreen', 'shaders.Dither', 'shaders.Engraving', 'shaders.Glitch', 'shaders.Glow', 'shaders.GradientMap', 'shaders.Halftone', 'shaders.LensDistortion', 'shaders.LensFlare', 'shaders.LightLeak', 'shaders.Paper', 'shaders.ReflectivePlane', 'shaders.Sparkle', 'shaders.Stone', 'shaders.VHS', 'shaders.Watercolor', 'shaders.Wool'] },
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

/** 严格全覆盖：漏排、重复排和失效的 ID 都在装配时指出，不能悄悄退回导出名排序。 */
export function orderVideoEditEffects(definitions: ReadonlyMap<string, VideoEditBuiltinEffectDefinition>): readonly VideoEditBuiltinEffectDefinition[] {
  const ordered: VideoEditBuiltinEffectDefinition[] = [], seen = new Set<string>()
  for (const { group, ids } of VIDEO_EDIT_EFFECT_CATALOG) for (const id of ids) {
    if (seen.has(id)) throw new Error(`效果目录重复 ID：${id}。`)
    const definition = definitions.get(id)
    if (!definition) throw new Error(`效果目录的 ${id} 尚未登记。`)
    seen.add(id); ordered.push({ ...definition, group })
  }
  const missing = [...definitions.keys()].filter(id => !seen.has(id))
  if (missing.length) throw new Error(`效果目录缺少：${missing.join('、')}。`)
  return ordered
}
