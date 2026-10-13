
import i18n, { normalizeLanguage } from '@/i18n/config'

export type LanguageOption = 'auto' | 'zh-CN' | 'en-US'

/**
 * Get current language setting
 */
export const getCurrentLanguage = (): LanguageOption => {
    const saved = localStorage.getItem('henji-language')
    if (!saved) return 'auto'
    return saved as LanguageOption
}

/**
 * Change application language
 * @param lang Language code or 'auto'
 */
export const changeLanguage = (lang: LanguageOption) => {
    if (lang === 'auto') {
        localStorage.removeItem('henji-language')
        // Re-detect language or fallback to browser default
        return i18n.changeLanguage(normalizeLanguage(navigator.language))
    } else {
        localStorage.setItem('henji-language', lang)
        return i18n.changeLanguage(normalizeLanguage(lang))
    }
}
