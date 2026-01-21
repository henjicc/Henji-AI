/**
 * i18n 导出入口
 */

import i18n from './config'

export default i18n

/**
 * 切换语言
 */
export function changeLanguage(lang: string): Promise<any> {
  return i18n.changeLanguage(lang)
}

/**
 * 获取当前语言
 */
export function getCurrentLanguage(): string {
  return i18n.language
}

/**
 * 支持的语言列表
 */
export const supportedLanguages = [
  { code: 'zh-CN', name: '中文' },
  { code: 'en-US', name: 'English' },
] as const

export type SupportedLanguage = typeof supportedLanguages[number]['code']
