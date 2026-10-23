import React from 'react'
import { createLogger } from '@/core/logging'
import { createThemePayloadV2, parseThemePayload } from '@/core/theme/themeMigration'
import { useSettingsStore, type ThemeImportMode } from '@/stores/settingsStore'
import ThemeSection from '../sections/ThemeSection'
import { AudioCaptureSettingsForm } from '@/features/audioCapture'
import { useI18n } from '@/hooks/useI18n'
import { useLlmSettings } from '../hooks/useLlmSettings'
import AgentModelProfilesSection from '../sections/AgentModelProfilesSection'
import { useSettings } from '../hooks/useSettings'
import DefaultModelsSection from '../sections/DefaultModelsSection'
import ConcurrencySection from '../sections/ConcurrencySection'
import DisplaySection from '../sections/DisplaySection'
import PromptOptimizationSection from '../sections/PromptOptimizationSection'
import BottomPanelSection from '../sections/BottomPanelSection'
import DownloadSection from '../sections/DownloadSection'
import ProviderCenterSection from '../sections/ProviderCenterSection'
import { UiGroup, UiLoading } from '@/components/ui'

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


export function ThemeSettingsSection(): React.ReactElement {
  const importThemePayload = useSettingsStore((state) => state.importThemePayload)

  /** 导入主题文件：统一经 parseThemePayload，只接受当前 v2。 */
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

  return <ThemeSection onExportTheme={exportTheme} onImportTheme={handleImportTheme} />
}

export function GenerationSettingsSection(): React.ReactElement {
  const { t } = useI18n('settings')
  const { settings, updateSetting } = useSettings()
  return <><DefaultModelsSection />
        <UiGroup title={t('sections.generation.taskGroup')} titleTone="overline">
          <ConcurrencySection
            maxConcurrentTasks={settings.maxConcurrentTasks}
            onChange={(value) => updateSetting('maxConcurrentTasks', value)}
          />
          <DisplaySection
            showPriceEstimate={settings.showPriceEstimate}
            priceEstimateCurrencyMode={settings.priceEstimateCurrencyMode}
            usdToCnyRate={settings.usdToCnyRate}
            onToggleShowPrice={(value) => updateSetting('showPriceEstimate', value)}
            onChangePriceEstimateCurrencyMode={(value) => updateSetting('priceEstimateCurrencyMode', value)}
            onChangeUsdToCnyRate={(value) => updateSetting('usdToCnyRate', value)}
          />
        </UiGroup>
        <UiGroup title={t('sections.generation.inputGroup')} titleTone="overline">
          <PromptOptimizationSection
            behavior={settings.promptOptimizationButtonBehavior}
            onChangeBehavior={(value) => updateSetting('promptOptimizationButtonBehavior', value)}
            enableAutoFocusModelSearch={settings.enableAutoFocusModelSearch}
            onToggleAutoFocus={(value) => updateSetting('enableAutoFocusModelSearch', value)}
          />
          <BottomPanelSection
            enableAutoCollapse={settings.enableAutoCollapse}
            collapseDelay={settings.collapseDelay}
            collapseOnScrollOnly={settings.collapseOnScrollOnly}
            onToggleAutoCollapse={(value) => updateSetting('enableAutoCollapse', value)}
            onChangeDelay={(value) => updateSetting('collapseDelay', value)}
            onToggleScrollOnly={(value) => updateSetting('collapseOnScrollOnly', value)}
          />
        </UiGroup></>
}

export function DownloadSettingsSection(): React.ReactElement {
  const { settings, updateSetting } = useSettings()
  return (
    <DownloadSection
      enableQuickDownload={settings.enableQuickDownload}
      quickDownloadButtonOnly={settings.quickDownloadButtonOnly}
      quickDownloadPath={settings.quickDownloadPath}
      onToggleQuickDownload={(value) => updateSetting('enableQuickDownload', value)}
      onToggleButtonOnly={(value) => updateSetting('quickDownloadButtonOnly', value)}
      onChangePath={(value) => updateSetting('quickDownloadPath', value)}
    />
  )
}

export function AssistantModelsSection(): React.ReactElement {
  const { t } = useI18n('settings')
  const llm = useLlmSettings()
  return llm.loading
    ? <UiLoading size="sm" message={t('providerCenter.loading')} />
    : <AgentModelProfilesSection config={llm.config} saveConfig={llm.saveConfig} />
}

export interface SettingsSectionContext { llm?: ReturnType<typeof useLlmSettings> }

export function ProviderSettingsSection({ llm }: SettingsSectionContext): React.ReactElement {
  if (!llm) throw new Error('供应商设置缺少配置上下文')
  return <ProviderCenterSection llm={llm} />
}

export function RecordingSettingsSection(): React.ReactElement {
  return <AudioCaptureSettingsForm />
}
