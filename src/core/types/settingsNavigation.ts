/**
 * 设置面板的导航坐标类型。
 * 单独成文件是为了让 stores（uiStore）与 components（Settings）共享同一套 id，
 * 而不产生 stores → components 的反向依赖。
 */

/**
 * 设置大类与分区的唯一清单（目录顺序即此处顺序）。
 *
 * 按用户要做的事分组，而不是按程序模块分组：生成相关的设置集中在「工作区 › 生成」，
 * 上传与下载集中在「文件与下载」，智能助手的模型、指令与外部连接集中在「智能助手」。
 * 「供应商与模型」「助手技能」是两栏控制台或不断变长的列表，单独成页（只有一个分区的大类在目录里显示为叶子）。
 *
 * 运行时可枚举：测试和能力门禁据此校验每个分区都有对应 Surface，不在别处复制一份分区列表。
 */
export const SETTINGS_TAB_SECTIONS = {
  general: ['general-basic', 'general-view', 'general-appearance', 'general-about'],
  providers: ['providers'],
  workspace: ['workspace-generation', 'workspace-canvas', 'workspace-video-edit', 'workspace-assets'],
  files: ['files-storage', 'files-upload', 'files-download'],
  assistant: ['assistant-models', 'assistant-preferences', 'assistant-mcp'],
  skills: ['assistant-skills'],
} as const

export type SettingsTabId = keyof typeof SETTINGS_TAB_SECTIONS

export const SETTINGS_TAB_IDS = Object.keys(SETTINGS_TAB_SECTIONS) as SettingsTabId[]

export const SETTINGS_SECTION_IDS = Object.values(SETTINGS_TAB_SECTIONS).flat()

export type SettingsSectionId = (typeof SETTINGS_TAB_SECTIONS)[SettingsTabId][number]

/** 打开设置面板时的定位目标；省略则回到默认分节 */
export interface SettingsNavigationTarget {
  tab: SettingsTabId
  sectionId?: SettingsSectionId
}
