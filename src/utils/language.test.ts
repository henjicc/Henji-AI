// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { changeLanguage } from './language'
import enSettings from '@/i18n/locales/en-US/settings.json'
import { createInstance } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
describe('跟随系统语言', () => {
  it('首次启动检测英文地区语言也使用英文', async () => {
    localStorage.clear()
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB')
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB'])
    const detected = createInstance().use(LanguageDetector)
    await detected.init({ ...i18n.options, lng: undefined, debug: false })
    expect(detected.language).toBe('en-US')
    expect(detected.t('sections.language.label', { ns: 'settings' })).toBe(enSettings.sections.language.label)
  })
  it.each(['en-GB', 'en-AU', 'en-IN', 'en-CA', 'en'])('%s 归一为英文资源', async language => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(language)
    await changeLanguage('auto')
    expect(i18n.language).toBe('en-US')
    expect(i18n.t('sections.language.label', { ns: 'settings' })).toBe(enSettings.sections.language.label)
    expect(localStorage.getItem('henji-language')).toBeNull()
  })
})
