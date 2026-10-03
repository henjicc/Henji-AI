import { createLogger } from '@/core/logging'
import { UiRegion } from '@/components/ui'
import React from 'react'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS, SETTINGS_CONTENT_MAX_WIDTH_CLASS } from '../settingsLayout'
import { useSettings } from '../hooks/useSettings'
import BottomPanelSection from '../sections/BottomPanelSection'
import CanvasSection from '../sections/CanvasSection'
import StartupSection from '../sections/StartupSection'
import ThemeSection from '../sections/ThemeSection'
import AssetLibrarySection from '../sections/AssetLibrarySection'
import UiScaleSection from '../sections/UiScaleSection'
import { VideoEditShortcutSettings } from '@/features/videoEdit/panels/VideoEditShortcutSettings'
import { useSettingsStore, type ThemeImportMode } from '@/stores/settingsStore'
import { createThemePayloadV2, parseThemePayload } from '@/core/theme/themeMigration'

const logger = createLogger('components.Settings.tabs.InterfaceTab')

const InterfaceTab: React.FC = () => {
  const { settings, updateSetting } = useSettings()
  const importThemePayload = useSettingsStore((state) => state.importThemePayload)

  /** 导出 v2 主题文件：生效的种子、覆盖与圆角（毛玻璃是本机偏好，不进文件）。 */
  const handleExportTheme = (): void => {
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
      <SettingsSection id="interface-layout">
        <UiScaleSection />
        <StartupSection />
        <VideoEditShortcutSettings />
        <BottomPanelSection
          enableAutoCollapse={settings.enableAutoCollapse}
          collapseDelay={settings.collapseDelay}
          collapseOnScrollOnly={settings.collapseOnScrollOnly}
          onToggleAutoCollapse={(value) => updateSetting('enableAutoCollapse', value)}
          onChangeDelay={(value) => updateSetting('collapseDelay', value)}
          onToggleScrollOnly={(value) => updateSetting('collapseOnScrollOnly', value)}
        />
      </SettingsSection>

      <SettingsSection id="interface-assets">
        <AssetLibrarySection />
      </SettingsSection>

      <SettingsSection id="interface-canvas">
        <CanvasSection />
      </SettingsSection>

      <SettingsSection id="interface-theme">
        <ThemeSection onExportTheme={handleExportTheme} onImportTheme={handleImportTheme} />
      </SettingsSection>
    </UiRegion>
  )
}

export default InterfaceTab
