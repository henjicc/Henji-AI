import { SETTINGS_REGISTRATION, settingsTarget, settingsSectionTitleKey, type SettingsSectionId, type SettingsTabId } from '@/core/types/settingsNavigation'

/**
 * 设置搜索的索引：每一项对应界面上的一行设置（或一组列表），文案直接引用界面用的 i18n key，
 * 中英文界面都能搜，改了标签文案搜索结果自动跟着变。
 *
 * 新增一行设置时在 settingsDeclaration.ts 的所属分区登记搜索文案；`settingsSearchIndex.test.ts` 校验 key 在两种语言里都存在、每个分区至少有一条。
 * `keywords` 只放标签里没有、但用户可能会搜的说法（如“API Key”“MCP”）。
 */
export interface SettingsSearchEntry {
  sectionId: SettingsSectionId
  /** `命名空间:key`，命名空间省略时为 settings */
  labelKey: string
  keywords?: readonly string[]
}

export const SETTINGS_SEARCH_INDEX: readonly SettingsSearchEntry[] = SETTINGS_REGISTRATION.search

export function settingsTabOfSection(sectionId: SettingsSectionId): SettingsTabId {
  return settingsTarget(sectionId).tab
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
    const label = translate(entry.labelKey).replace(/\{\{[^}]+\}\}/g, '').replace(/\s*\(\s*s\)|\s*（\s*秒）/g, '').trim()
    const section = translate(settingsSectionTitleKey(entry.sectionId))
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
