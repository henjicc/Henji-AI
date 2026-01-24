
import i18n from '@/i18n/config'

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
        const browserLang = navigator.language
        i18n.changeLanguage(browserLang)
    } else {
        localStorage.setItem('henji-language', lang)
        i18n.changeLanguage(lang)
    }
}
