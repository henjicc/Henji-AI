/**
 * Style dictionary: common grading looks expressed in the grade's own sliders (data, not LUTs), so a person or the assistant
 * can pick one, scale it with `strength` and keep adjusting. Applied on top of a primary correction; white balance and
 * exposure are deliberately absent (they belong to correction, not to a look).
 */
export interface ColorGradeStyle { id: string; name: string; tags: readonly string[]; description: string; params: Readonly<Record<string, number>> }

export const COLOR_GRADE_STYLES: readonly ColorGradeStyle[] = [
  { id: 'teal_orange', name: '青橙电影', tags: ['电影感', '青橙', 'teal orange', '大片'], description: '阴影偏青、高光与肤色偏橙，轻微加对比；人物在冷背景中跳出来。',
    params: { contrast: 15, shadow_hue: 195, shadow_strength: 18, highlight_hue: 35, highlight_strength: 14, grade_balance: -10, mixer_orange_saturation: 10, mixer_blue_hue: -20, mixer_aqua_hue: 25, vibrance: 10 } },
  { id: 'film_fade', name: '胶片褪色', tags: ['胶片', '复古', 'film', 'vintage'], description: '抬起黑位、压低反差与饱和度，暗部带一点暖绿。',
    params: { faded_film: 30, contrast: -10, saturation: -15, tone_shadows: 15, shadow_hue: 80, shadow_strength: 8, highlight_hue: 40, highlight_strength: 6 } },
  { id: 'japanese_airy', name: '日系清新', tags: ['日系', '清新', '通透', 'airy'], description: '高亮低反差，青绿色调，肤色干净；适合白天人像与静物。',
    params: { contrast: -15, highlights: -10, shadows: 25, tone_lights: 10, saturation: -10, vibrance: 10, midtone_hue: 175, midtone_strength: 6, mixer_green_hue: 25, mixer_orange_luminance: 15 } },
  { id: 'cyberpunk', name: '赛博霓虹', tags: ['赛博朋克', '霓虹', 'cyberpunk', '夜景'], description: '暗部偏蓝紫、高光偏洋红，高饱和高对比。',
    params: { contrast: 25, saturation: 20, shadow_hue: 250, shadow_strength: 22, highlight_hue: 310, highlight_strength: 18, mixer_blue_saturation: 25, mixer_magenta_saturation: 25, blacks: -15 } },
  { id: 'warm_golden', name: '暖调黄金时刻', tags: ['暖调', '黄昏', '金色', 'golden hour'], description: '整体暖金，中间调偏橙，高光柔和。',
    params: { global_hue: 40, global_strength: 8, midtone_hue: 30, midtone_strength: 10, highlights: -15, vibrance: 15, mixer_yellow_saturation: 15 } },
  { id: 'cool_moody', name: '冷调阴郁', tags: ['冷调', '阴郁', '低饱和', 'moody'], description: '冷蓝、低饱和、压暗高光，适合雨天与情绪片。',
    params: { contrast: 10, highlights: -25, saturation: -25, global_hue: 215, global_strength: 8, shadow_hue: 210, shadow_strength: 12, mixer_orange_saturation: -10 } },
  { id: 'bw_contrast', name: '黑白高反差', tags: ['黑白', '单色', 'bw', 'monochrome'], description: '去色并加对比，用混色器明度控制各颜色转灰后的亮暗。',
    params: { saturation: -100, contrast: 30, whites: 10, blacks: -15, mixer_red_luminance: 10, mixer_blue_luminance: -20 } },
  { id: 'clean_commercial', name: '干净商业', tags: ['商业', '干净', '产品', 'clean'], description: '轻提对比和自然饱和度，压一点高光，颜色准确不夸张。',
    params: { contrast: 10, highlights: -10, whites: 5, blacks: -5, vibrance: 15 } },
  { id: 'bleach_bypass', name: '留银', tags: ['留银', '高反差低饱和', 'bleach bypass'], description: '高对比、低饱和、金属质感的冷硬画面。',
    params: { contrast: 35, saturation: -45, tone_highlights: 10, tone_shadows: -10, blacks: -10 } },
]

/** Values of a style at `strength` (0–1) relative to neutral; wheel hues and the mode never scale. */
export function scaleColorGradeStyle(style: ColorGradeStyle, strength: number, defaults: Readonly<Record<string, unknown>>): Record<string, number> {
  const k = Math.max(0, Math.min(1, strength))
  return Object.fromEntries(Object.entries(style.params).map(([key, value]) => {
    if (key.endsWith('_hue') && !key.startsWith('mixer_')) return [key, value]
    const base = typeof defaults[key] === 'number' ? defaults[key] as number : 0
    return [key, Math.round((base + (value - base) * k) * 100) / 100]
  }))
}
