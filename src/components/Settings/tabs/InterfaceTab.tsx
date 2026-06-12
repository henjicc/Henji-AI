import { createLogger } from '@/core/logging'
import React from 'react'
import { useSettings } from '../hooks/useSettings'
import BottomPanelSection from '../sections/BottomPanelSection'
import CanvasSection from '../sections/CanvasSection'
import ThemeSection from '../sections/ThemeSection'
import { useSettingsStore } from '@/stores/settingsStore'
import {

  createRuntimeThemePayload,
  parseRuntimeThemePayload,
  type ThemeImportMode,
} from '@/core/theme/runtimeTheme'

const logger = createLogger('components.Settings.tabs.InterfaceTab')

interface InterfaceTabProps {
  sectionId?: string
}

const InterfaceTab: React.FC<InterfaceTabProps> = ({ sectionId }) => {
  const { settings, updateSetting } = useSettings()
  const currentSectionId = sectionId ?? 'interface-layout'
  const themeTonePreset = useSettingsStore((state) => state.themeTonePreset)
  const uiRadiusPreset = useSettingsStore((state) => state.uiRadiusPreset)
  const accentColor = useSettingsStore((state) => state.accentColor)
  const themeColors = useSettingsStore((state) => state.themeColors)
  const setThemeTonePreset = useSettingsStore((state) => state.setThemeTonePreset)
  const setUiRadiusPreset = useSettingsStore((state) => state.setUiRadiusPreset)
  const setAccentColor = useSettingsStore((state) => state.setAccentColor)
  const setThemeColor = useSettingsStore((state) => state.setThemeColor)
  const setThemeColors = useSettingsStore((state) => state.setThemeColors)
  const resetThemeColors = useSettingsStore((state) => state.resetThemeColors)

  const handleExportTheme = (): void => {
    const payload = createRuntimeThemePayload({
      themeTonePreset,
      uiRadiusPreset,
      accentColor,
      colors: themeColors,
    })
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'henji-theme.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleImportTheme = async (file: File, mode: ThemeImportMode): Promise<boolean> => {
    try {
      const raw = await file.text()
      const parsed = parseRuntimeThemePayload(JSON.parse(raw))
      if (!parsed) {
        return false
      }
      if (mode === 'all') {
        setThemeTonePreset(parsed.themeTonePreset)
        setUiRadiusPreset(parsed.uiRadiusPreset)
        setAccentColor(parsed.accentColor)
        setThemeColors(parsed.colors)
      } else if (mode === 'colorsOnly') {
        setAccentColor(parsed.accentColor)
        setThemeColors(parsed.colors)
      } else {
        setThemeTonePreset(parsed.themeTonePreset)
        setUiRadiusPreset(parsed.uiRadiusPreset)
      }
      return true
    } catch (error) {
      logger.error('[InterfaceTab] Failed to import theme:', error)
      return false
    }
  }

  return (
    <div className="p-4 space-y-5">
      {currentSectionId === 'interface-layout' && (
        <section className="space-y-5">
          <BottomPanelSection
            enableAutoCollapse={settings.enableAutoCollapse}
            collapseDelay={settings.collapseDelay}
            collapseOnScrollOnly={settings.collapseOnScrollOnly}
            onToggleAutoCollapse={(value) => updateSetting('enableAutoCollapse', value)}
            onChangeDelay={(value) => updateSetting('collapseDelay', value)}
            onToggleScrollOnly={(value) => updateSetting('collapseOnScrollOnly', value)}
          />
        </section>
      )}

      {currentSectionId === 'interface-canvas' && (
        <section className="space-y-5">
          <CanvasSection />
        </section>
      )}

      {currentSectionId === 'interface-theme' && (
        <section className="space-y-5">
          <ThemeSection
            themeTonePreset={themeTonePreset}
            uiRadiusPreset={uiRadiusPreset}
            accentColor={accentColor}
            colors={themeColors}
            onChangeThemeTone={setThemeTonePreset}
            onChangeUiRadius={setUiRadiusPreset}
            onChangeAccentColor={setAccentColor}
            onChangeThemeColor={setThemeColor}
            onApplyPalette={setThemeColors}
            onResetThemeColors={resetThemeColors}
            onExportTheme={handleExportTheme}
            onImportTheme={handleImportTheme}
          />
        </section>
      )}
    </div>
  )
}

export default InterfaceTab

