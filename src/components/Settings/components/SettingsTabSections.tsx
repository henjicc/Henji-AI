import React from 'react'
import { SETTINGS_DECLARATION } from '@/core/types/settingsDeclaration'
import type { SettingsTabId } from '@/core/types/settingsNavigation'
import { SETTINGS_SECTION_COMPONENTS, type SettingsSectionContext } from '../tabs/settingsSectionComponents'
import SettingsSection from './SettingsSection'

/** 内容次序和导航共用声明；组件绑定只负责渲染内容。 */
export function SettingsTabSections({ tab, fill = false, context = {} }: {
  tab: SettingsTabId
  fill?: boolean
  context?: SettingsSectionContext
}): React.ReactElement {
  return <>{SETTINGS_DECLARATION[tab].sections.map(section => (
    <SettingsSection key={section.id} id={section.id} fill={fill}>
      {section.componentKeys.map(key => {
        const Component = SETTINGS_SECTION_COMPONENTS[key]
        return <Component key={key} {...context} />
      })}
    </SettingsSection>
  ))}</>
}
