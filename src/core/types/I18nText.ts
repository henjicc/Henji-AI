import i18n from '@/i18n'

const KNOWN_NAMESPACES = ['common', 'models', 'params', 'errors', 'ui', 'history', 'settings'] as const


const MODEL_KEY_PREFIX = 'models.defs.'
const MODEL_KEY_MARKERS = ['.meta.', '.params.', '.requirements.', '.auto.', '.inputLimits.', '.linkages.', '.endpoints.', '.request.', '.pricing.']
const MODEL_DEFS_PREFIX = 'defs.'
const MODEL_NAMESPACE = 'models'

function normalizeModelsKey(key: string): string {
  if (!key.startsWith(MODEL_KEY_PREFIX) || key.includes('\\.')) {
    return key
  }

  let markerIndex = -1
  for (const marker of MODEL_KEY_MARKERS) {
    const idx = key.indexOf(marker, MODEL_KEY_PREFIX.length)
    if (idx !== -1) {
      markerIndex = idx
      break
    }
  }

  if (markerIndex === -1) {
    return key
  }

  const modelId = key.slice(MODEL_KEY_PREFIX.length, markerIndex)
  const escapedId = modelId.replace(/\./g, '\\.')
  return `${MODEL_KEY_PREFIX}${escapedId}${key.slice(markerIndex)}`
}

function isModelKey(key: string): boolean {
  return key.startsWith('models:') || key.startsWith('models.') || key.startsWith(MODEL_DEFS_PREFIX)
}

function getNestedValue(obj: DynamicValue, path: string[]): DynamicValue {
  let current: DynamicValue = obj
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined
    const record = current as DynamicValueMap
    if (!(segment in record)) return undefined
    current = record[segment]
  }
  return current
}

function getModelResourceBundle(locale: string): DynamicValueMap | null {
  try {
    const bundle = i18n.getResourceBundle(locale, MODEL_NAMESPACE)
    if (bundle && typeof bundle === 'object') {
      return bundle as DynamicValueMap
    }
  } catch {
    return null
  }
  return null
}

function parseModelKey(rawKey: string): { modelId: string; path: string[] } | null {
  const normalized = rawKey.startsWith('models:') ? `models.${rawKey.slice('models:'.length)}` : rawKey
  const key = normalized.startsWith('models.') ? normalized.slice('models.'.length) : normalized
  if (!key.startsWith(MODEL_DEFS_PREFIX)) return null

  let markerIndex = -1
  for (const marker of MODEL_KEY_MARKERS) {
    const idx = key.indexOf(marker, MODEL_DEFS_PREFIX.length)
    if (idx !== -1) {
      markerIndex = idx
      break
    }
  }
  if (markerIndex === -1) return null

  const modelIdRaw = key.slice(MODEL_DEFS_PREFIX.length, markerIndex)
  if (!modelIdRaw) return null
  const modelId = modelIdRaw.replace(/\\\./g, '.')
  const tail = key.slice(markerIndex + 1)
  const path = tail.split('.').filter(Boolean)
  if (path.length === 0) return null
  return { modelId, path }
}

function getModelTranslation(rawKey: string, locale: string): string | undefined {
  const parsed = parseModelKey(rawKey)
  if (!parsed) return undefined

  const { modelId, path } = parsed
  const localeCandidates = [
    locale,
    locale.split('-')[0],
    'zh',
    'en'
  ]

  for (const candidate of localeCandidates) {
    if (!candidate) continue
    const bundle = getModelResourceBundle(candidate)
    if (!bundle) continue
    const defs = bundle.defs
    if (!defs || typeof defs !== 'object') continue
    const model = (defs as DynamicValueMap)[modelId]
    const value = getNestedValue(model, path)
    if (typeof value === 'string') return value
  }

  return undefined
}

/**
 * 国际化文本类型
 *
 * 支持纯字符串、多语言对象或 i18n key
 *
 * @example
 * ```typescript
 * // 纯字符串（默认语言）
 * const text1: I18nText = "Hello"
 *
 * // 多语言对象
 * const text2: I18nText = {
 *   zh: "你好",
 *   en: "Hello"
 * }
 * ```
 */
export type I18nText = string | {
  zh: string
  en: string
  [lang: string]: string  // 支持未来扩展其他语言
} | {
  key: string
  fallback?: string
  absolute?: boolean
}

type I18nKeyText = {
  key: string
  fallback?: string
  absolute?: boolean
}

function isI18nKeyText(text: Exclude<I18nText, string>): text is I18nKeyText {
  const record = text as DynamicValueMap
  if (typeof record.key !== 'string') return false

  // Avoid treating language maps as key objects just because they contain a "key" field.
  const hasFallback = 'fallback' in record
  const hasAbsolute = 'absolute' in record
  if (!hasFallback && !hasAbsolute) return false

  if (hasFallback && record.fallback !== undefined && typeof record.fallback !== 'string') return false
  if (hasAbsolute && record.absolute !== undefined && typeof record.absolute !== 'boolean') return false

  return true
}

/**
 * 翻译 I18nText 的函数类型
 */
export type TranslateI18nText = (text: I18nText) => string

/**
 * 获取国际化文本的实际值
 *
 * @param text - 国际化文本
 * @param locale - 语言代码（默认 'zh'）
 * @returns 实际文本值
 */
export function getI18nText(text: I18nText, locale: string = 'zh'): string {
  if (typeof text === 'string') {
    return text
  }

  if (isI18nKeyText(text)) {
    const fallback = typeof text.fallback === 'string' ? text.fallback : text.key
    const key = text.key
    if (isModelKey(key)) {
      const modelTranslation = getModelTranslation(key, locale)
      if (typeof modelTranslation === 'string') {
        return modelTranslation
      }
      return fallback
    }
    try {
      if (key.includes(':')) {
        if (key.startsWith('models:')) {
          const raw = key.slice('models:'.length)
          const normalized = normalizeModelsKey(`models.${raw}`)
          return i18n.t(`models:${normalized.slice('models.'.length)}`, { defaultValue: fallback })
        }
        return i18n.t(key, { defaultValue: fallback })
      }

      for (const ns of KNOWN_NAMESPACES) {
        const prefix = `${ns}.`
        if (key.startsWith(prefix)) {
          if (ns === 'models') {
            const normalized = normalizeModelsKey(key)
            return i18n.t(normalized.slice(prefix.length), { ns, defaultValue: fallback })
          }
          return i18n.t(key.slice(prefix.length), { ns, defaultValue: fallback })
        }
      }

      return i18n.t(key, { defaultValue: fallback })
    } catch {
      return fallback
    }
  }

  const dict = text as DynamicValueMap

  // 1. Exact locale match (e.g. 'zh-CN')
  const exact = dict[locale]
  if (typeof exact === 'string' && exact) return exact

  // 2. 尝试语言前缀匹配 (e.g. 'zh-CN' -> 'zh', 'en-US' -> 'en')
  const langPrefix = locale.split('-')[0]
  const prefixed = dict[langPrefix]
  if (typeof prefixed === 'string' && prefixed) return prefixed

  // 3. 如果请求的是英语但没找到，尝试找 en
  const enValue = dict.en
  if (langPrefix === 'en' && typeof enValue === 'string' && enValue) return enValue

  // 4. 默认回退（优先 zh，然后 en，最后第一个可用值）
  const zhValue = dict.zh
  if (typeof zhValue === 'string' && zhValue) return zhValue
  if (typeof enValue === 'string' && enValue) return enValue

  const firstKey = Object.keys(dict)[0]
  const firstValue = firstKey ? dict[firstKey] : undefined
  return typeof firstValue === 'string' ? firstValue : ''
}

/**
 * 判断是否为 I18nText 对象
 */
export function isI18nTextObject(text: I18nText): text is Exclude<I18nText, string> {
  return typeof text === 'object' && text !== null
}
