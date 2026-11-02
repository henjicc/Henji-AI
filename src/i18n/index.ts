/**
 * i18n 导出入口
 */

import i18n from './config'

export default i18n

/**
 * 切换语言
 */
export function changeLanguage(lang: string): Promise<DynamicValue> {
  return i18n.changeLanguage(lang)
}

/**
 * 获取当前语言
 */
export function getCurrentLanguage(): string {
  return i18n.language
}

