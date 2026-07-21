/**
 * 设置面板的导航坐标类型。
 * 单独成文件是为了让 stores（uiStore）与 components（Settings）共享同一套 id，
 * 而不产生 stores → components 的反向依赖。
 */

export type SettingsTabId = 'general' | 'api' | 'interface' | 'models'

export type SettingsSectionId =
  | 'general-basic'
  | 'general-storage'
  | 'general-behavior'
  | 'general-maintenance'
  | 'api-keys'
  | 'api-upload'
  | 'api-llm'
  | 'interface-layout'
  | 'interface-assets'
  | 'interface-canvas'
  | 'interface-theme'
  | 'models-visibility'

/** 打开设置面板时的定位目标；省略则回到默认分节 */
export interface SettingsNavigationTarget {
  tab: SettingsTabId
  sectionId?: SettingsSectionId
}
