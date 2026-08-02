/**
 * 设置面板的导航坐标类型。
 * 单独成文件是为了让 stores（uiStore）与 components（Settings）共享同一套 id，
 * 而不产生 stores → components 的反向依赖。
 */

export type SettingsTabId = 'general' | 'api' | 'interface' | 'models'

/**
 * 设置分区的唯一清单。运行时可枚举，测试和能力门禁据此校验每个分区都有对应
 * Surface，不再靠解析类型联合或在别处复制一份分区列表。
 */
export const SETTINGS_SECTION_IDS = [
  'general-basic',
  'general-storage',
  'general-behavior',
  'general-maintenance',
  'api-keys',
  'api-upload',
  'api-llm',
  'api-agent-preferences',
  'api-agent-skills',
  'interface-layout',
  'interface-assets',
  'interface-canvas',
  'interface-theme',
  'models-visibility',
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

/** 打开设置面板时的定位目标；省略则回到默认分节 */
export interface SettingsNavigationTarget {
  tab: SettingsTabId
  sectionId?: SettingsSectionId
}
