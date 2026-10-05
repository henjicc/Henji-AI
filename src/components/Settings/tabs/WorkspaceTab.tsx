import React from 'react'
import { UiGroup, UiRegion } from '@/components/ui'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS, SETTINGS_CONTENT_MAX_WIDTH_CLASS } from '../settingsLayout'
import { useSettings } from '../hooks/useSettings'
import { useI18n } from '@/hooks/useI18n'
import DefaultModelsSection from '../sections/DefaultModelsSection'
import ConcurrencySection from '../sections/ConcurrencySection'
import DisplaySection from '../sections/DisplaySection'
import PromptOptimizationSection from '../sections/PromptOptimizationSection'
import BottomPanelSection from '../sections/BottomPanelSection'
import CanvasSection from '../sections/CanvasSection'
import AssetLibrarySection from '../sections/AssetLibrarySection'

/**
 * 工作区：按应用顶部的页面分节（生成 / 画布 / 资产库）。
 * 生成相关的设置以前散在「默认项与首次设置」「行为与并发」「界面 › 布局行为」三处，现在集中在这里。
 */
const WorkspaceTab: React.FC = () => {
  const { t } = useI18n('settings')
  const { settings, updateSetting } = useSettings()

  return (
    <UiRegion maxWidthClassName={SETTINGS_CONTENT_MAX_WIDTH_CLASS} className={SETTINGS_CONTENT_CLASS}>
      <SettingsSection id="workspace-generation">
        <DefaultModelsSection />
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
        </UiGroup>
      </SettingsSection>

      <SettingsSection id="workspace-canvas">
        <CanvasSection />
      </SettingsSection>

      <SettingsSection id="workspace-assets">
        <AssetLibrarySection />
      </SettingsSection>
    </UiRegion>
  )
}

export default WorkspaceTab
