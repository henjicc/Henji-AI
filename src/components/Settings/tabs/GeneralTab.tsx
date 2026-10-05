import React from 'react'
import { UiRegion } from '@/components/ui'
import { createLogger } from '@/core/logging'
import { createThemePayloadV2, parseThemePayload } from '@/core/theme/themeMigration'
import { VideoEditShortcutSettings } from '@/features/videoEdit/panels/VideoEditShortcutSettings'
import { useSettingsStore, type ThemeImportMode } from '@/stores/settingsStore'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS, SETTINGS_CONTENT_MAX_WIDTH_CLASS } from '../settingsLayout'
import LanguageSection from '../sections/LanguageSection'
import StartupSection from '../sections/StartupSection'
import OnboardingSection from '../sections/OnboardingSection'
import ImageViewerSection from '../sections/ImageViewerSection'
import ThemeSection from '../sections/ThemeSection'
import UpdateSection from '../sections/UpdateSection'
import AboutSection from '../sections/AboutSection'

const logger = createLogger('components.Settings.tabs.GeneralTab')

/** 导出 v2 主题文件：生效的种子、覆盖与圆角（毛玻璃是本机偏好，不进文件）。 */
function exportTheme(): void {
  const { themeSeed, themeOverrides, uiRadiusPreset } = useSettingsStore.getState()
  const payload = createThemePayloadV2({ seed: themeSeed, overrides: themeOverrides, uiRadiusPreset })
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'henji-theme.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 通用：语言与启动、查看与快捷键、外观、关于与更新。 */
const GeneralTab: React.FC = () => {
  const importThemePayload = useSettingsStore((state) => state.importThemePayload)

  /** 导入 v1/v2 主题文件：统一经 parseThemePayload（v1 自动迁移）。 */
  const handleImportTheme = async (file: File, mode: ThemeImportMode): Promise<boolean> => {
    try {
      const raw = await file.text()
      const payload = parseThemePayload(JSON.parse(raw))
      if (!payload) {
        logger.warn('主题文件格式不正确，已拒绝导入', { event: 'theme.import.rejected', context: { mode } })
        return false
      }
      importThemePayload(payload, mode)
      logger.info('主题文件已导入', { event: 'theme.import.completed', context: { mode } })
      return true
    } catch (error) {
      logger.error('主题文件导入失败', error, { event: 'theme.import.failed', context: { mode } })
      return false
    }
  }

  return (
    <UiRegion maxWidthClassName={SETTINGS_CONTENT_MAX_WIDTH_CLASS} className={SETTINGS_CONTENT_CLASS}>
      <SettingsSection id="general-basic">
        <LanguageSection />
        <StartupSection />
        <OnboardingSection />
      </SettingsSection>

      <SettingsSection id="general-view">
        <ImageViewerSection />
        <VideoEditShortcutSettings />
      </SettingsSection>

      <SettingsSection id="general-appearance">
        <ThemeSection onExportTheme={exportTheme} onImportTheme={handleImportTheme} />
      </SettingsSection>

      <SettingsSection id="general-about">
        <UpdateSection />
        <AboutSection />
      </SettingsSection>
    </UiRegion>
  )
}

export default GeneralTab
