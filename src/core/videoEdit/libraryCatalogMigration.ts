import { videoEditTransitionBinding } from './transitionCatalog'

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const MERGED_EFFECT_IDS: Readonly<Record<string, string>> = {
  gaussian_blur: 'blur', directional_blur: 'blur', zoom_blur: 'blur', lens_blur: 'blur',
  brightness_contrast: 'color_grade', exposure: 'color_grade', white_balance: 'color_grade', hue_saturation: 'color_grade',
  'shaders.Grayscale': 'black_white', 'shaders.Invert': 'invert', 'shaders.Flip': 'flip',
  'shaders.Blur': 'blur', 'shaders.LinearBlur': 'blur', 'shaders.ZoomBlur': 'blur', 'shaders.BokehBlur': 'blur',
  'shaders.Sharpness': 'sharpen', 'shaders.BrightnessContrast': 'color_grade', 'shaders.Exposure': 'color_grade',
  'shaders.Saturation': 'color_grade', 'shaders.HueShift': 'color_grade', 'shaders.Vibrance': 'color_grade', 'shaders.Tint': 'color_grade',
  'shaders.FilmGrain': 'film_grain', 'shaders.Vignette': 'vignette', 'shaders.Pixelate': 'mosaic',
}

/** 只换算有明确合并目标的目录引用；已移除或未知的收藏保留，避免丢失用户偏好。 */
export function videoEditLibraryCatalogId(id: string, category?: string): string {
  // 评分里的 effect 是个人预设命名空间，只有收藏引用才使用 effect: 前缀。
  if (category) return category === 'transition' ? videoEditTransitionBinding(id)?.entry.kind ?? id : id
  const prefix = id.startsWith('transition:') ? 'transition:' : id.startsWith('effect:') ? 'effect:' : ''
  const kind = prefix ? id.slice(prefix.length) : id
  const target = prefix === 'transition:' ? videoEditTransitionBinding(kind)?.entry.kind
    : prefix === 'effect:' && Object.hasOwn(MERGED_EFFECT_IDS, kind) ? MERGED_EFFECT_IDS[kind] : undefined
  return target ? `${prefix}${target}` : id
}

/** 收藏合并后去重，个人预设与效果链仍交给已有迁移处理。 */
export function migrateVideoEditLibraryCatalog(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.favorites)) return value
  return { ...value, favorites: [...new Set(value.favorites.map(id => typeof id === 'string' ? videoEditLibraryCatalogId(id) : id))] }
}

/** 多个来源并入同一条目时保留最高评分与默认标记，且不改动输入。 */
export function migrateVideoEditPresetCatalogPreferences(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  const result: unknown[] = []
  const byId = new Map<string, Record<string, unknown>>()
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.category !== 'transition') { result.push(item); continue }
    const id = videoEditLibraryCatalogId(item.id, item.category)
    const key = JSON.stringify([item.category, id])
    const previous = byId.get(key)
    if (previous) {
      const rating = (entry: Record<string, unknown>): number | undefined => entry.rating === undefined ? 0 : typeof entry.rating === 'number' ? entry.rating : undefined
      const left = rating(previous), right = rating(item)
      // 非法输入仍交给正式 schema 拒绝，不能在合并时把错误值转成合法默认。
      if (left === undefined || right === undefined || previous.isDefault !== undefined && typeof previous.isDefault !== 'boolean' || item.isDefault !== undefined && typeof item.isDefault !== 'boolean') { result.push({ ...item, id }); continue }
      previous.rating = Math.max(left, right)
      previous.isDefault = previous.isDefault === true || item.isDefault === true
    } else {
      const next = { ...item, id }
      byId.set(key, next); result.push(next)
    }
  }
  return result
}
