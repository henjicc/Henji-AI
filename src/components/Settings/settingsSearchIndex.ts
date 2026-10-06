import { SETTINGS_TAB_SECTIONS, type SettingsSectionId, type SettingsTabId } from '@/core/types/settingsNavigation'

/**
 * 设置搜索的索引：每一项对应界面上的一行设置（或一组列表），文案直接引用界面用的 i18n key，
 * 中英文界面都能搜，改了标签文案搜索结果自动跟着变。
 *
 * 新增一行设置时在这里登记一条；`settingsSearchIndex.test.ts` 校验 key 在两种语言里都存在、每个分区至少有一条。
 * `keywords` 只放标签里没有、但用户可能会搜的说法（如“API Key”“MCP”）。
 */
export interface SettingsSearchEntry {
  sectionId: SettingsSectionId
  /** `命名空间:key`，命名空间省略时为 settings */
  labelKey: string
  keywords?: readonly string[]
}

const rows = (sectionId: SettingsSectionId, labelKeys: Array<string | [string, string[]]>): SettingsSearchEntry[] =>
  labelKeys.map((item) => (Array.isArray(item)
    ? { sectionId, labelKey: item[0], keywords: item[1] }
    : { sectionId, labelKey: item }))

export const SETTINGS_SEARCH_INDEX: readonly SettingsSearchEntry[] = [
  ...rows('general-basic', [
    ['sections.language.label', ['语言', 'language', '中文', 'English']],
    ['sections.interface.startupWorkspaceLabel', ['启动', 'startup']],
    ['onboarding:settings.onboardingTitle', ['引导', '欢迎', 'onboarding']],
  ]),
  ...rows('general-view', [
    ['sections.canvas.imageViewerInfoLabel', ['查看器', '分辨率', 'viewer']],
  ]),
  ...rows('general-appearance', [
    ['sections.theme.preset.label', ['主题', '深色', '浅色', 'dark', 'light', 'theme']],
    ['sections.theme.accent.label', ['颜色', 'color']],
    'sections.theme.contrast.label',
    'sections.theme.radius.label',
    ['sections.interface.uiScaleLabel', ['缩放', '字号', 'zoom', 'scale']],
    ['sections.theme.blur.label', ['模糊', 'blur']],
    ['sections.theme.portable.label', ['导入', '导出', 'import', 'export']],
  ]),
  ...rows('general-about', [
    ['sections.updates.currentVersionLabel', ['版本', '检查更新', 'version', 'update']],
    ['sections.updates.autoCheckLabel', ['更新', 'update']],
    'sections.updates.clearIgnoredLabel',
    'sections.about.authorLabel',
    'sections.about.homepageLabel',
    ['sections.about.licenseLabel', ['许可', 'license']],
    ['sections.about.componentsLabel', ['开源', '第三方', 'open source']],
  ]),
  ...rows('providers', [
    ['providerCenter.apiKey', ['密钥', 'API Key', 'key', 'token']],
    ['providerCenter.models', ['模型', '隐藏模型', 'model']],
    ['providerCenter.actions.renameModel', ['别名', '改名', 'alias', 'rename']],
    ['providerCenter.actions.addProvider', ['供应商', 'provider', 'DeepSeek', 'OpenAI']],
  ]),
  ...rows('workspace-generation', [
    ['onboarding:settings.primaryProvider', ['默认', 'default']],
    ['onboarding:settings.defaultModels.image', ['默认模型', 'default model']],
    'onboarding:settings.defaultModels.video',
    'onboarding:settings.defaultModels.audio',
    ['sections.concurrency.label', ['并发', '同时', 'queue']],
    ['sections.display.priceLabel', ['价格', '费用', 'price', 'cost']],
    ['sections.display.currencyModeLabel', ['币种', '人民币', '美元', 'currency']],
    ['sections.display.exchangeRateLabel', ['汇率', 'rate']],
    ['sections.promptOptimization.title', ['提示词', 'prompt']],
    'sections.display.autoFocusLabel',
    ['sections.interface.autoCollapseLabel', ['底部面板', '折叠', 'collapse']],
  ]),
  ...rows('workspace-canvas', [
    ['sections.canvas.lodLabel', ['卡顿', '性能', '流畅', 'performance']],
    'sections.canvas.autoInsertTextDisplayLabel',
    'sections.canvas.uploadFilenameTitleLabel',
    ['sections.canvas.storyboardKeepStyleLabel', ['分镜', 'storyboard']],
    'sections.canvas.storyboardNoTextLabel',
    'sections.canvas.storyboardAutoInferEmptyFrameLabel',
    'sections.canvas.ignoreAtTagLabel',
  ]),
  ...rows('workspace-video-edit', [
    ['videoEditShortcuts.label', ['快捷键', '键位', 'shortcut', 'hotkey']],
    ['sections.videoEdit.selectionFollowsPlayheadLabel', ['剪辑', '播放头', '自动选中', '效果控件', 'playhead', 'selection']],
  ]),
  ...rows('workspace-assets', [
    ['sections.assetLibrary.tabAction', ['资产', '素材', 'asset']],
    'sections.assetLibrary.panelPosition',
    'sections.assetLibrary.edgeTrigger',
  ]),
  ...rows('files-storage', [
    ['sections.dataPath.pathLabel', ['作品目录', '数据目录', '保存位置', '更换位置', '存储', 'works folder', 'storage', 'folder']],
  ]),
  ...rows('files-upload', [
    ['sections.largeUpload.strategyLabel', ['大文件', '复制', '引用', 'upload']],
    ['sections.upload.providerLabel', ['上传', '托管', 'upload']],
    'sections.upload.fallbackLabel',
  ]),
  ...rows('files-download', [
    ['sections.download.enableLabel', ['下载', 'download']],
    'sections.download.pathLabel',
    'sections.download.buttonOnlyLabel',
    ['sections.download.presetPathsLabel', ['保存到', '下载路径']],
  ]),
  ...rows('files-models', [
    ['sections.localModels.listLabel', ['模型', '抠像', '人脸', '文字', '跟踪', 'ONNX', 'model', 'matting']],
    ['sections.localModels.sourceLabel', ['ModelScope', 'Hugging Face', '国内', '国外', '镜像', 'mirror']],
  ]),
  ...rows('assistant-models', [
    ['agentModels.roles.primary', ['助手', '智能体', 'assistant', 'agent', 'LLM']],
    'agentModels.roles.router',
    'agentModels.roles.summarizer',
    'agentModels.roles.fallback',
    ['agentModels.roles.observer', ['视觉', 'vision']],
    ['agentModels.advanced', ['超时', '重试', 'Token', 'timeout']],
  ]),
  ...rows('assistant-preferences', [
    ['agentInstructions.label', ['指令', '偏好', '提示词', 'instructions']],
  ]),
  ...rows('assistant-mcp', [
    ['mcp.enable', ['MCP', 'Codex', 'Claude', '外部', '连接']],
    ['mcp.port', ['端口', 'port']],
    'mcp.allowWrites',
    'mcp.allowDelete',
    ['mcp.allowPaid', ['付费']],
    ['mcp.connectionsTitle', ['授权', 'authorization']],
  ]),
  ...rows('assistant-skills', [
    ['agentSkills.userGroup', ['技能', 'skill']],
    'agentSkills.builtinGroup',
    ['agentSkills.installGroup', ['安装', 'install']],
  ]),
]

export function settingsTabOfSection(sectionId: SettingsSectionId): SettingsTabId {
  const tab = (Object.keys(SETTINGS_TAB_SECTIONS) as SettingsTabId[])
    .find((id) => (SETTINGS_TAB_SECTIONS[id] as readonly string[]).includes(sectionId))
  if (!tab) throw new Error(`设置分区未登记大类：${sectionId}`)
  return tab
}

export interface SettingsSearchResult {
  entry: SettingsSearchEntry
  tab: SettingsTabId
  label: string
}

/**
 * 按标签、关键词、分区名与大类名做不区分大小写的包含匹配；标签命中排在前面，分区名/大类名只作兜底。
 * `translate` 由调用方传入当前语言的翻译函数（含命名空间前缀的 key 也要能解析）。
 */
export function searchSettings(
  query: string,
  translate: (key: string) => string,
): SettingsSearchResult[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const scored: Array<SettingsSearchResult & { score: number }> = []
  for (const entry of SETTINGS_SEARCH_INDEX) {
    const tab = settingsTabOfSection(entry.sectionId)
    const label = translate(entry.labelKey)
    const section = translate(`navSections.${entry.sectionId}`)
    const tabLabel = translate(`tabs.${tab}.label`)
    const hit = (value: string): boolean => value.toLocaleLowerCase().includes(needle)
    const score = hit(label) ? 0
      : (entry.keywords ?? []).some(hit) ? 1
        : hit(section) || hit(tabLabel) ? 2 : -1
    if (score >= 0) scored.push({ entry, tab, label, score })
  }
  // 只靠分区名或大类名命中的条目是兜底：有标签或关键词命中时不混进去（搜“下载”不该带出“上传”那几行）
  const direct = scored.filter((item) => item.score < 2)
  return (direct.length > 0 ? direct : scored)
    .sort((left, right) => left.score - right.score)
    .map(({ score: _score, ...result }) => result)
}
