/**
 * 国际化文本类型
 *
 * 支持纯字符串或多语言对象
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

  // 优先使用指定语言
  if (text[locale]) {
    return text[locale]
  }

  // 降级到中文
  if (text.zh) {
    return text.zh
  }

  // 降级到英文
  if (text.en) {
    return text.en
  }

  // 返回第一个可用的值
  const firstKey = Object.keys(text)[0]
  return text[firstKey] || ''
}

/**
 * 判断是否为 I18nText 对象
 */
export function isI18nTextObject(text: I18nText): text is Record<string, string> {
  return typeof text === 'object' && text !== null
}
